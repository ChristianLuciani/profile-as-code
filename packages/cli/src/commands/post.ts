/**
 * `pasco post` — the post MVP (week-1 experiment).
 *
 * The CLI never calls an LLM. It emits the task bundle an executing agent works
 * from, records the human's choice, checks the chosen text against the channel
 * rules + the profile's URL/claim SSOT, and (optionally) builds a Postiz
 * `POST /posts` payload. A post is a projection of a seed, not an identity
 * fact: the store lives in `posts/`, outside `content/` and outside
 * `profile.schema.json`.
 *
 * Subcommands: seed · task · choose · check · export · import · list.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LoadedProfile, Platform } from "@profile-as-code/core";
import { LoadError, load, SchemaValidationError } from "@profile-as-code/core";
import { parseDocument } from "yaml";
import { parseLang, parsePlatform, parseVariants, UsageError } from "../contract.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section, warn } from "../output.js";
import {
  chooseVariant,
  chosenVariant,
  createSeed,
  hashText,
  isSafeSeedId,
  ledgerPath,
  listSeedIds,
  type PostLedger,
  postsDir,
  readLedger,
  seedDir,
  seedPath,
  seedText,
  variantPath,
  writeLedger,
} from "../post-store.js";
import { skillFile } from "../skill-path.js";
import type { Pascorc } from "../workspace.js";
import { defaultsLang } from "../workspace.js";

export const POST_OWNER =
  "post MVP (week-1 experiment): seed → task bundle → choose → check → optional Postiz draft payload; no LLM call, no scheduler";

interface PostingRules {
  platform?: string;
  settings?: Record<string, unknown>;
  limits?: { maxChars?: number; minChars?: number };
  links?: { policy?: string };
  hashtags?: { max?: number };
  structure?: string[];
  sources?: { url?: string; date?: string; note?: string }[];
}

interface Finding {
  code: string;
  severity: "error" | "warn";
  message: string;
}

export interface PostArgs {
  workspace: string;
  subcommand?: string;
  seedArg?: string;
  channelArg?: string;
  variantsArg?: string;
  variantArg?: string;
  textArg?: string;
  targetArg?: string;
  outArg?: string;
  typeArg?: string;
  dateArg?: string;
  pascorc: Pascorc;
}

/* ---------------------------------------------------------------------------
 * skills + rules
 * ------------------------------------------------------------------------- */

function postSkillPath(channel: string): string | undefined {
  return skillFile(channel, "post.md");
}

function postingPath(channel: string): string | undefined {
  return skillFile(channel, "posting.yaml");
}

function readPosting(channel: string): PostingRules {
  const path = postingPath(channel);
  if (path === undefined) {
    throw new UsageError(
      `no post skill for "${channel}" — expected skills/${channel}/posting.yaml + post.md`,
    );
  }
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.errors.length > 0) {
    throw new UsageError(`${path}: invalid YAML — ${doc.errors[0]?.message ?? "parse error"}`);
  }
  const raw = doc.toJS({ maxAliasCount: 100 }) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UsageError(`${path} must contain a mapping`);
  }
  const rules = raw as PostingRules;
  if (rules.platform !== undefined && rules.platform !== channel) {
    throw new UsageError(
      `${path}: platform "${rules.platform}" does not match channel "${channel}"`,
    );
  }
  const type = rules.settings?.__type;
  if (type !== undefined && String(type) !== channel) {
    throw new UsageError(
      `${path}: settings.__type "${String(type)}" does not match channel "${channel}"`,
    );
  }
  return rules;
}

/* ---------------------------------------------------------------------------
 * profile + facts
 * ------------------------------------------------------------------------- */

function loadProfile(workspace: string): LoadedProfile | number {
  try {
    return load(workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report("post", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report("post", false, EXIT.FAIL, { error: { kind: "load", message: err.message } });
    }
    throw err;
  }
}

function splitChannels(value: string | undefined): Platform[] {
  if (value === undefined || value.trim() === "") {
    throw new UsageError("--channel is required (comma-separated, e.g. linkedin,x)");
  }
  const seen = new Set<string>();
  const out: Platform[] = [];
  for (const raw of value.split(",")) {
    const name = raw.trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    out.push(parsePlatform(name));
  }
  if (out.length === 0) throw new UsageError("--channel is required (comma-separated)");
  return out;
}

/** Resolve a `{{fact:<pointer>}}` pointer against the loaded profile. */
export function resolveFact(profile: LoadedProfile, pointer: string): string | undefined {
  const segments = pointer.split(".");
  let current: unknown = profile;
  for (const segment of segments) {
    const match = /^([A-Za-z0-9_]+)(?:\[([^\]]+)\])?$/.exec(segment);
    if (match === null) return undefined;
    const key = match[1] ?? "";
    const selector = match[2];
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
    if (selector !== undefined) {
      if (Array.isArray(current)) {
        const index = Number(selector);
        current = Number.isInteger(index)
          ? current[index]
          : current.find(
              (item) =>
                item !== null &&
                typeof item === "object" &&
                (item as Record<string, unknown>).id === selector,
            );
      } else if (current !== null && typeof current === "object") {
        current = (current as Record<string, unknown>)[selector];
      } else {
        return undefined;
      }
    }
  }
  if (typeof current === "string") return current;
  if (typeof current === "number" || typeof current === "boolean") return String(current);
  return undefined;
}

export function renderFacts(
  text: string,
  profile: LoadedProfile,
): { text: string; dangling: string[] } {
  const dangling: string[] = [];
  const rendered = text.replace(/\{\{fact:([^}]+)\}\}/g, (_whole, pointer: string) => {
    const value = resolveFact(profile, pointer.trim());
    if (value === undefined) {
      dangling.push(pointer.trim());
      return `{{fact:${pointer}}}`;
    }
    return value;
  });
  return { text: rendered, dangling };
}

function allowedUrls(profile: LoadedProfile): Set<string> {
  const urls = new Set<string>();
  const add = (value: string | undefined): void => {
    if (value !== undefined && value !== "") urls.add(value);
  };
  for (const link of profile.identity.links ?? []) add(link.url);
  for (const project of profile.projects) for (const url of project.links ?? []) add(url);
  for (const publication of profile.publications) add(publication.url);
  for (const press of profile.press ?? []) add(press.url);
  for (const credential of profile.credentials ?? []) add(credential.verifyUrl);
  for (const artifact of profile.artifacts ?? []) add(artifact.locator?.url);
  return urls;
}

function factLines(profile: LoadedProfile): string[] {
  const lines: string[] = [];
  lines.push(`identity.name = ${profile.identity.name}`);
  if (profile.identity.location !== undefined) {
    lines.push(`identity.location = ${profile.identity.location}`);
  }
  (profile.identity.links ?? []).forEach((link, index) => {
    lines.push(`identity.links[${index}].url = ${link.url}`);
  });
  profile.projects.forEach((project, index) => {
    const selector = project.id ?? String(index);
    lines.push(`projects[${selector}].name = ${project.name}`);
    if (project.status !== undefined) {
      lines.push(`projects[${selector}].status = ${project.status}`);
    }
    (project.links ?? []).forEach((url, linkIndex) => {
      lines.push(`projects[${selector}].links[${linkIndex}] = ${url}`);
    });
  });
  profile.experience.forEach((item, index) => {
    const selector = item.id ?? String(index);
    lines.push(`experience[${selector}].role = ${item.role}`);
    lines.push(`experience[${selector}].org = ${item.org}`);
    lines.push(`experience[${selector}].start = ${item.start}`);
    if (item.end !== undefined) lines.push(`experience[${selector}].end = ${item.end}`);
  });
  profile.publications.forEach((publication, index) => {
    const selector = publication.id ?? String(index);
    lines.push(`publications[${selector}].title = ${publication.title}`);
    if (publication.doi !== undefined) {
      lines.push(`publications[${selector}].doi = ${publication.doi}`);
    }
    if (publication.url !== undefined) {
      lines.push(`publications[${selector}].url = ${publication.url}`);
    }
  });
  (profile.press ?? []).forEach((item, index) => {
    if (item.url !== undefined) lines.push(`press[${index}].url = ${item.url}`);
  });
  for (const credential of profile.credentials ?? []) {
    if (credential.id === undefined) continue;
    lines.push(`credentials[${credential.id}].title = ${credential.title}`);
    if (credential.verifyUrl !== undefined) {
      lines.push(`credentials[${credential.id}].verifyUrl = ${credential.verifyUrl}`);
    }
  }
  for (const artifact of profile.artifacts ?? []) {
    if (artifact.id === undefined) continue;
    lines.push(`artifacts[${artifact.id}].title = ${artifact.title}`);
    if (artifact.locator?.url !== undefined) {
      lines.push(`artifacts[${artifact.id}].locator.url = ${artifact.locator.url}`);
    }
  }
  return lines;
}

/* ---------------------------------------------------------------------------
 * checks
 * ------------------------------------------------------------------------- */

/** Extract URL-like candidates, including scheme-less and www forms, and
 *  normalize the scheme so the SSOT comparison is case-insensitive there. */
function urlCandidates(text: string): string[] {
  const out = new Set<string>();
  const pattern = /\b(?:https?:\/\/|www\.)[^\s)\]]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s)\]]*/gi;
  for (const match of text.matchAll(pattern)) {
    let raw = (match[0] ?? "").replace(/[.,;:!?]+$/, "");
    if (raw === "") continue;
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    out.add(raw.replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase()));
  }
  return [...out];
}

export function checkText(text: string, rules: PostingRules, profile: LoadedProfile): Finding[] {
  const findings: Finding[] = [];
  const content = text.trim();
  const max = rules.limits?.maxChars;
  const min = rules.limits?.minChars;
  if (max !== undefined && content.length > max) {
    findings.push({
      code: "max-chars",
      severity: "error",
      message: `post is ${content.length} chars; ${rules.platform ?? "channel"} allows ${max}`,
    });
  }
  if (min !== undefined && content.length < min) {
    findings.push({
      code: "min-chars",
      severity: "error",
      message: `post is ${content.length} chars; ${rules.platform ?? "channel"} requires at least ${min}`,
    });
  }

  const allowed = allowedUrls(profile);
  for (const url of urlCandidates(content)) {
    if (!allowed.has(url)) {
      findings.push({
        code: "url-not-in-ssot",
        severity: "error",
        message: `${url} is not in the profile URL SSOT (identity.links / projects / publications / credentials / artifacts)`,
      });
    }
  }

  const maxTags = rules.hashtags?.max;
  if (maxTags !== undefined) {
    const tags = content.match(/(^|\s)#[A-Za-z0-9_]+/g) ?? [];
    if (tags.length > maxTags) {
      findings.push({
        code: "hashtags",
        severity: "warn",
        message: `${tags.length} hashtags; the ${rules.platform ?? "channel"} skill recommends at most ${maxTags}`,
      });
    }
  }

  for (const rawLine of content.split("\n")) {
    const lineText = rawLine.trim();
    if (lineText === "" || lineText.includes("{{fact:") || lineText.includes("evidence:")) continue;
    if (/\d/.test(lineText) && /[%$]|\b\d{2,}\b/.test(lineText)) {
      findings.push({
        code: "unsourced-claim",
        severity: "warn",
        message: `numeric claim without a {{fact:...}} or evidence: marker — "${lineText.slice(0, 80)}"`,
      });
    }
  }
  return findings;
}

/* ---------------------------------------------------------------------------
 * task bundle
 * ------------------------------------------------------------------------- */

function buildTask(args: {
  seedId: string;
  channel: Platform;
  seed: string;
  profile: LoadedProfile;
  rules: PostingRules;
  skill: string | undefined;
  variants: number;
  lang: string;
}): string {
  const { seedId, channel, seed, profile, rules, skill, variants, lang } = args;
  const facts = factLines(profile).join("\n  ");
  const structure = (rules.structure ?? []).join(" → ") || "—";
  const sources = (rules.sources ?? [])
    .map((source) => `${source.url ?? "—"} (${source.date ?? "—"})`)
    .join("; ");
  return [
    `# pasco post task — ${seedId} / ${channel}`,
    ``,
    `Write ${variants} variant(s) of a ${channel} POST in ${lang}. You are the agent:`,
    `the CLI never calls an LLM. Read the skill FIRST:`,
    `  ${skill ?? `(missing skills/${channel}/post.md)`}`,
    ``,
    `Seed (canonical — do not rewrite its meaning):`,
    seed.trim(),
    ``,
    `Facts (byte-identical; cite with {{fact:<pointer>}}):`,
    `  ${facts}`,
    ``,
    `Channel rules (from skills/${channel}/posting.yaml):`,
    `  maxChars: ${rules.limits?.maxChars ?? "—"}`,
    `  settings: ${JSON.stringify(rules.settings ?? {})}`,
    `  links: ${rules.links?.policy ?? "identity-ssot-only"}`,
    `  hashtags (max): ${rules.hashtags?.max ?? "—"}`,
    `  structure: ${structure}`,
    `  sources: ${sources || "—"}`,
    ``,
    `Output: save each variant as ONE text block at`,
    `  posts/${seedId}/${channel}/${channel}-<n>.md`,
    `Then record the choice:`,
    `  pasco post choose ${seedId} --channel ${channel} --variant ${channel}-<n>`,
    ``,
    `Constraints:`,
    `  - Facts never change (D4). Quote them as {{fact:<pointer>}}; do not paraphrase a number, date or URL.`,
    `  - Links only from identity.links / projects[].links / publications[].url /`,
    `    credentials[].verifyUrl / artifacts[].locator.url — the SSOT is the only URL source.`,
    `  - Never invent URLs, DOIs or numbers.`,
    `  - Keep the channel's native shape; the skill is the strategy, not the template.`,
    ``,
  ].join("\n");
}

/* ---------------------------------------------------------------------------
 * postiz
 * ------------------------------------------------------------------------- */

function readPostizConfig(workspace: string): Record<string, string> {
  const path = join(workspace, "postiz.yaml");
  if (!existsSync(path)) return {};
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.errors.length > 0) {
    throw new UsageError(`${path}: invalid YAML — ${doc.errors[0]?.message ?? "parse error"}`);
  }
  const raw = doc.toJS({ maxAliasCount: 100 }) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const channels = (raw as Record<string, unknown>).channels;
  if (channels === null || typeof channels !== "object" || Array.isArray(channels)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(channels as Record<string, unknown>)) {
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

interface PostizPost {
  integration: { id: string };
  value: { content: string; image: never[] }[];
  settings: Record<string, unknown>;
}

interface PostizPayload {
  type: string;
  date: string;
  shortLink: boolean;
  tags: never[];
  posts: PostizPost[];
}

function buildPostizPayload(args: {
  workspace: string;
  ledger: PostLedger;
  profile: LoadedProfile;
  type: string;
  date: string;
}): PostizPayload {
  const integrationIds = readPostizConfig(args.workspace);
  const posts: PostizPost[] = [];
  for (const [channel, state] of Object.entries(args.ledger.channels)) {
    if (state.chosen === undefined) continue;
    const chosen = chosenVariant(args.workspace, args.ledger, channel);
    if (chosen === undefined) {
      throw new Error(
        `channel ${channel}: chosen variant "${state.chosen}" has no body at ${variantPath(
          args.workspace,
          args.ledger.id,
          channel,
          state.chosen,
        )}`,
      );
    }
    const rendered = renderFacts(chosen.text, args.profile);
    if (rendered.dangling.length > 0) {
      throw new Error(`channel ${channel}: dangling fact ref(s): ${rendered.dangling.join(", ")}`);
    }
    const rules = readPosting(channel);
    const settings: Record<string, unknown> = {
      ...(rules.settings ?? {}),
      __type: rules.settings?.__type ?? channel,
    };
    posts.push({
      integration: { id: integrationIds[channel] ?? "REPLACE_ME" },
      value: [{ content: rendered.text.trim(), image: [] }],
      settings,
    });
  }
  return {
    type: args.type,
    date: args.date,
    shortLink: false,
    tags: [],
    posts,
  };
}

/* ---------------------------------------------------------------------------
 * subcommands
 * ------------------------------------------------------------------------- */

function requireSeed(args: PostArgs): string {
  if (args.seedArg === undefined || args.seedArg === "") {
    throw new UsageError("a <seed-id> is required");
  }
  if (!isSafeSeedId(args.seedArg)) {
    throw new UsageError(
      "seed id must be a safe path segment (letters, digits, dot, underscore, dash)",
    );
  }
  return args.seedArg;
}

function handleSeed(args: PostArgs): number {
  const seedId = requireSeed(args);
  if (args.textArg === undefined) {
    throw new UsageError("usage: pasco post seed <seed-id> --text <file>");
  }
  if (!existsSync(args.textArg)) {
    throw new UsageError(`seed file not found: ${args.textArg}`);
  }
  const text = readFileSync(args.textArg, "utf8");
  if (text.trim() === "") throw new UsageError("seed text is empty");
  if (existsSync(seedPath(args.workspace, seedId))) {
    throw new UsageError(
      `seed ${seedId} already exists at ${seedPath(args.workspace, seedId)}; edit it directly`,
    );
  }
  const ledger = createSeed(args.workspace, seedId, text);
  if (isJsonMode()) {
    return report("post", true, EXIT.OK, {
      data: { mode: "seed", seedId, seedPath: seedPath(args.workspace, seedId), ledger },
    });
  }
  line(`seeded ${seedId} at ${seedPath(args.workspace, seedId)}`);
  return EXIT.OK;
}

function handleTask(args: PostArgs): number {
  const seedId = requireSeed(args);
  const channels = splitChannels(args.channelArg);
  const variants = parseVariants(args.variantsArg, args.pascorc.defaults?.variants ?? 3);
  const lang = parseLang(defaultsLang(args.pascorc));
  const seed = seedText(args.workspace, seedId);
  const loaded = loadProfile(args.workspace);
  if (typeof loaded === "number") return loaded;
  const profile = loaded;
  if (!existsSync(ledgerPath(args.workspace, seedId))) {
    createSeed(args.workspace, seedId, seed);
  }
  const results: {
    channel: string;
    taskPath: string;
    skill: string | undefined;
    maxChars?: number;
  }[] = [];
  for (const channel of channels) {
    const rules = readPosting(channel);
    const skill = postSkillPath(channel);
    const task = buildTask({
      seedId,
      channel,
      seed,
      profile,
      rules,
      skill,
      variants,
      lang,
    });
    const taskPath = join(seedDir(args.workspace, seedId), channel, "task.md");
    mkdirSync(dirname(taskPath), { recursive: true });
    writeFileSync(taskPath, task);
    results.push({ channel, taskPath, skill, maxChars: rules.limits?.maxChars });
    line(`task: ${taskPath}`);
    line(`  skill: ${skill ?? "(missing)"}`);
    line(`  maxChars: ${rules.limits?.maxChars ?? "—"}`);
  }
  if (isJsonMode()) {
    return report("post", true, EXIT.OK, {
      data: { mode: "task", seedId, lang, variants, channels: results },
    });
  }
  return EXIT.OK;
}

function handleChoose(args: PostArgs): number {
  const seedId = requireSeed(args);
  const channel = parsePlatform(args.channelArg ?? "");
  if (args.variantArg === undefined || args.variantArg === "") {
    throw new UsageError("--variant is required");
  }
  readPosting(channel);
  if (args.textArg !== undefined) {
    if (!existsSync(args.textArg)) throw new UsageError(`variant file not found: ${args.textArg}`);
    const target = variantPath(args.workspace, seedId, channel, args.variantArg);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(args.textArg, "utf8"));
  }
  const loaded = loadProfile(args.workspace);
  if (typeof loaded === "number") return loaded;
  const variantFile = variantPath(args.workspace, seedId, channel, args.variantArg);
  if (!existsSync(variantFile)) {
    throw new UsageError(`no variant body at ${variantFile}`);
  }
  const rendered = renderFacts(readFileSync(variantFile, "utf8"), loaded);
  if (rendered.dangling.length > 0) {
    throw new UsageError(`dangling fact ref(s): ${rendered.dangling.join(", ")}`);
  }
  const result = chooseVariant(args.workspace, seedId, channel, args.variantArg, rendered.text);
  if (isJsonMode()) {
    return report("post", true, EXIT.OK, {
      data: {
        mode: "choose",
        seedId,
        channel,
        variant: args.variantArg,
        contentHash: result.contentHash,
        path: result.path,
      },
    });
  }
  line(
    `chose ${seedId}/${channel} = ${args.variantArg} (sha256 ${result.contentHash.slice(0, 12)}…)`,
  );
  return EXIT.OK;
}

function handleCheck(args: PostArgs): number {
  const seedId = requireSeed(args);
  const loaded = loadProfile(args.workspace);
  if (typeof loaded === "number") return loaded;
  const profile = loaded;
  const ledger = readLedger(args.workspace, seedId);
  const findingsByChannel: { channel: string; findings: Finding[] }[] = [];
  let errors = 0;
  let warnings = 0;
  for (const channel of Object.keys(ledger.channels)) {
    const state = ledger.channels[channel];
    if (state?.chosen === undefined) continue;
    const chosen = chosenVariant(args.workspace, ledger, channel);
    if (chosen === undefined) {
      errors += 1;
      findingsByChannel.push({
        channel,
        findings: [
          {
            code: "missing-body",
            severity: "error",
            message: `chosen variant "${state.chosen}" has no body at ${variantPath(
              args.workspace,
              ledger.id,
              channel,
              state.chosen,
            )}`,
          },
        ],
      });
      continue;
    }
    const rendered = renderFacts(chosen.text, profile);
    const findings: Finding[] = rendered.dangling.map((pointer) => ({
      code: "dangling-ref",
      severity: "error",
      message: `{{fact:${pointer}}} does not resolve in the profile`,
    }));
    let rules: PostingRules | undefined;
    try {
      rules = readPosting(channel);
    } catch (err) {
      findings.push({
        code: "unsupported-channel",
        severity: "error",
        message: (err as Error).message,
      });
    }
    if (rules !== undefined) findings.push(...checkText(rendered.text, rules, profile));
    for (const finding of findings) {
      if (finding.severity === "error") errors += 1;
      else warnings += 1;
    }
    findingsByChannel.push({ channel, findings });
  }
  if (findingsByChannel.length === 0) {
    return report("post", false, EXIT.FAIL, {
      error: { kind: "empty", message: `${seedId} has no chosen variant` },
    });
  }
  if (isJsonMode()) {
    return report("post", errors === 0, errors === 0 ? EXIT.OK : EXIT.FAIL, {
      data: { mode: "check", seedId, errors, warnings, channels: findingsByChannel },
    });
  }
  section(`post check — ${seedId}`);
  for (const entry of findingsByChannel) {
    line(`${entry.channel}:`);
    if (entry.findings.length === 0) line("  ok");
    for (const finding of entry.findings) {
      const prefix = finding.severity === "error" ? "  error" : "  warn";
      line(`${prefix} [${finding.code}] ${finding.message}`);
    }
  }
  line(`\n${errors} error(s), ${warnings} warning(s)`);
  return errors === 0 ? EXIT.OK : EXIT.FAIL;
}

function handleExport(args: PostArgs): number {
  const seedId = requireSeed(args);
  const target = args.targetArg ?? "postiz";
  if (target !== "postiz") {
    throw new UsageError(`unsupported target "${target}" (only "postiz" today)`);
  }
  const type = args.typeArg ?? "draft";
  if (!["draft", "schedule", "now"].includes(type)) {
    throw new UsageError(`--type must be draft|schedule|now (got "${type}")`);
  }
  const date = args.dateArg ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(date))) {
    throw new UsageError(`--date must be an ISO date (got "${date}")`);
  }
  if (type === "schedule" && args.dateArg === undefined) {
    throw new UsageError("--type schedule requires --date");
  }
  const loaded = loadProfile(args.workspace);
  if (typeof loaded === "number") return loaded;
  const profile = loaded;
  const ledger = readLedger(args.workspace, seedId);
  const payload = buildPostizPayload({
    workspace: args.workspace,
    ledger,
    profile,
    type,
    date,
  });
  if (payload.posts.length === 0) {
    return report("post", false, EXIT.FAIL, {
      error: { kind: "empty", message: `${seedId} has no chosen variant to export` },
    });
  }
  const out = args.outArg ?? join(seedDir(args.workspace, seedId), "postiz.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  if (isJsonMode()) {
    return report("post", true, EXIT.OK, { data: { mode: "export", seedId, out, payload } });
  }
  line(`wrote ${out}`);
  line(
    `  ${payload.posts.length} channel(s); integration IDs: ${payload.posts
      .map((post) => post.integration.id)
      .join(", ")}`,
  );
  if (payload.posts.some((post) => post.integration.id === "REPLACE_ME")) {
    warn(
      "some integration IDs are REPLACE_ME — add postiz.yaml (channels: {linkedin: <id>, x: <id>})",
    );
  }
  line(
    `  POST it: curl -X POST "$POSTIZ_API_URL/posts" -H "Authorization: $POSTIZ_API_KEY" -H "Content-Type: application/json" -d @${out}`,
  );
  return EXIT.OK;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function handleImport(args: PostArgs): number {
  if (args.seedArg === undefined) {
    throw new UsageError("usage: pasco post import <dir> --channel <channel>");
  }
  const sourceDir = args.seedArg;
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new UsageError(`import dir not found: ${sourceDir}`);
  }
  const channel = parsePlatform(args.channelArg ?? "");
  readPosting(channel);
  const files = readdirSync(sourceDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  if (files.length === 0) throw new UsageError(`no .md files in ${sourceDir}`);
  const started = Date.now();
  const imported: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(sourceDir, file), "utf8");
    if (text.trim() === "") continue;
    const base = slugify(file.replace(/\.md$/, "")) || "post";
    let id = `imported-${base}`;
    let n = 2;
    while (existsSync(seedDir(args.workspace, id))) id = `imported-${base}-${n++}`;
    createSeed(args.workspace, id, text, "imported");
    const target = variantPath(args.workspace, id, channel, "imported");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    const ledger = readLedger(args.workspace, id);
    ledger.channels[channel] = {
      chosen: "imported",
      chosenAt: new Date().toISOString(),
      contentHash: hashText(text),
      publishedAt: null,
      url: null,
      sync: "published",
      certification: "unverifiable",
    };
    ledger.status = "published";
    writeLedger(args.workspace, ledger);
    imported.push(id);
  }
  const elapsed = Date.now() - started;
  if (isJsonMode()) {
    return report("post", true, EXIT.OK, {
      data: { mode: "import", channel, imported, elapsedMs: elapsed },
    });
  }
  line(`imported ${imported.length} post(s) as ${channel} seeds in ${elapsed} ms`);
  for (const id of imported) line(`  ${id}`);
  return EXIT.OK;
}

function handleList(args: PostArgs): number {
  const ids = listSeedIds(args.workspace);
  const rows = ids.map((id) => {
    try {
      const ledger = readLedger(args.workspace, id);
      const channels = Object.entries(ledger.channels)
        .map(([channel, state]) => `${channel}:${state.chosen ?? "—"}`)
        .join(" ");
      return { id, source: ledger.source, status: ledger.status, channels };
    } catch {
      return { id, source: "?", status: "?", channels: "?" };
    }
  });
  if (isJsonMode()) {
    return report("post", true, EXIT.OK, { data: { mode: "list", posts: rows } });
  }
  if (rows.length === 0) {
    line(`no posts under ${postsDir(args.workspace)}`);
    return EXIT.OK;
  }
  for (const row of rows) {
    line(`${row.id}  [${row.source}/${row.status}]  ${row.channels}`);
  }
  return EXIT.OK;
}

export function runPost(args: PostArgs): number {
  switch (args.subcommand) {
    case "seed":
      return handleSeed(args);
    case "task":
      return handleTask(args);
    case "choose":
      return handleChoose(args);
    case "check":
      return handleCheck(args);
    case "export":
      return handleExport(args);
    case "import":
      return handleImport(args);
    case "list":
      return handleList(args);
    default:
      throw new UsageError(
        "usage: pasco post <seed|task|choose|check|export|import|list> … (run pasco post --help)",
      );
  }
}
