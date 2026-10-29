/**
 * `pasco post` — the post MVP (week-1 experiment) + the long-form shape (#266).
 *
 * The CLI never calls an LLM. It emits the task bundle an executing agent works
 * from, records the human's choice, checks the chosen text against the channel
 * rules + the profile's URL/claim SSOT, and (optionally) builds a Postiz
 * `POST /posts` payload or a paste checklist. A post is a projection of a seed,
 * not an identity fact: the store lives in `posts/`, outside `content/` and
 * outside `profile.schema.json` (D17).
 *
 * Two seed formats (#266):
 *   short     — the distribution post; rules in skills/<channel>/posting.yaml.
 *   longform  — the essay/newsletter; rules in skills/<channel>/longform.yaml,
 *               field contract in the variant's YAML front matter (title/dek/…).
 * A short seed derived from an essay carries `derivedFrom: <essay-seed>` and
 * reads the parent's canonical text; its own dir has no seed.md.
 *
 * Subcommands: seed · task · choose · check · export · import · list.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LoadedProfile, Platform } from "@profile-as-code/core";
import { LoadError, load, SchemaValidationError } from "@profile-as-code/core";
import { parseDocument } from "yaml";
import { isQuantitativeClaim } from "../claims.js";
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
  type PostFormat,
  type PostLedger,
  postsDir,
  readLedger,
  seedDir,
  seedPath,
  seedText,
  variantPath,
  writeLedger,
} from "../post-store.js";
import { NOT_SHIPPED_MESSAGE, skillFile, skillsDir } from "../skill-path.js";
import type { Pascorc } from "../workspace.js";
import { defaultsLang } from "../workspace.js";

export const POST_OWNER =
  "post MVP (week-1 experiment): seed → task bundle → choose → check → optional Postiz draft payload or paste checklist; two seed formats (short/longform); no LLM call, no scheduler";

/** The long-form field set the contract requires (#266). A longform.yaml may
 *  extend it, but it must at least require these two. */
const LONGFORM_REQUIRED_FIELDS = ["title", "dek"] as const;
/** Front-matter fields that travel into an API platform's settings. */
const LONGFORM_SETTING_FIELDS = ["tags", "canonical", "list"] as const;

interface WordLimits {
  min?: number;
  max?: number;
}

interface PostingRules {
  platform?: string;
  /** A longform.yaml self-declares its shape; posting.yaml must not. */
  format?: PostFormat;
  /** Long-form: does this channel take a body API payload, or a paste? */
  export?: "api" | "paste";
  settings?: Record<string, unknown>;
  limits?: { maxChars?: number; minChars?: number; words?: WordLimits };
  links?: { policy?: string };
  hashtags?: { max?: number };
  structure?: string[];
  fields?: { required?: string[]; optional?: string[] };
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
  formatArg?: string;
  fromArg?: string;
  pascorc: Pascorc;
}

/* ---------------------------------------------------------------------------
 * skills + rules
 * ------------------------------------------------------------------------- */

function parseFormat(value: string | undefined): PostFormat {
  if (value === undefined) return "short";
  if (value === "short" || value === "longform") return value;
  throw new UsageError(`--format must be short|longform (got "${value}")`);
}

function rulesFile(format: PostFormat): string {
  return format === "longform" ? "longform.yaml" : "posting.yaml";
}

function readRules(channel: string, format: PostFormat): PostingRules {
  const file = rulesFile(format);
  const path = skillFile(channel, file);
  if (path === undefined) {
    throw new UsageError(
      skillsDir() === undefined
        ? NOT_SHIPPED_MESSAGE
        : `no ${format} post skill for "${channel}" — expected skills/${channel}/${file}`,
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
  if (format === "longform") {
    if (rules.format !== "longform") {
      throw new UsageError(`${path}: format must be "longform"`);
    }
    if (rules.export !== "api" && rules.export !== "paste") {
      throw new UsageError(`${path}: export must be "api" or "paste"`);
    }
    const required = rules.fields?.required ?? [];
    for (const field of LONGFORM_REQUIRED_FIELDS) {
      if (!required.includes(field)) {
        throw new UsageError(`${path}: fields.required must include "${field}"`);
      }
    }
  } else if (rules.format === "longform") {
    throw new UsageError(`${path}: format "longform" belongs in longform.yaml, not posting.yaml`);
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
 * front matter (long-form field contract)
 * ------------------------------------------------------------------------- */

interface FrontMatter {
  fields?: Record<string, unknown>;
  body: string;
  error?: string;
}

/** Split `---`-delimited YAML front matter from the body. A long-form variant
 *  without front matter is not an error at parse time: `check` reports the
 *  missing required fields, which is what the reader needs to fix. */
export function parseFrontMatter(text: string): FrontMatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  if (match === null) {
    if (/^---[ \t]*\r?\n/.test(text)) {
      return { body: text, error: "unterminated front matter (no closing --- line)" };
    }
    return { body: text };
  }
  const body = text.slice(match[0].length);
  const doc = parseDocument(match[1] ?? "");
  if (doc.errors.length > 0) {
    return { body, error: `invalid front matter — ${doc.errors[0]?.message ?? "parse error"}` };
  }
  const raw = doc.toJS({ maxAliasCount: 100 }) as unknown;
  if (raw === null) return { fields: {}, body };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { body, error: "front matter must be a YAML mapping (field: value)" };
  }
  return { fields: raw as Record<string, unknown>, body };
}

function fieldString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isBlankField(value: unknown): boolean {
  return fieldString(value).trim() === "";
}

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words === null ? 0 : words.length;
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

function urlFindings(content: string, profile: LoadedProfile): Finding[] {
  const findings: Finding[] = [];
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
  return findings;
}

function claimFindings(content: string): Finding[] {
  const findings: Finding[] = [];
  for (const rawLine of content.split("\n")) {
    const lineText = rawLine.trim();
    if (lineText === "" || lineText.includes("{{fact:") || lineText.includes("evidence:")) continue;
    if (isQuantitativeClaim(lineText)) {
      findings.push({
        code: "unsourced-claim",
        severity: "warn",
        message: `numeric claim without a {{fact:...}} or evidence: marker — "${lineText.slice(0, 80)}"`,
      });
    }
  }
  return findings;
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

  findings.push(...urlFindings(content, profile));

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

  findings.push(...claimFindings(content));
  return findings;
}

/** Long-form check (#266): required front-matter fields, word-count band, the
 *  SSOT URL rule (body + field values, canonical included), claim markers. */
export function checkLongform(
  text: string,
  rules: PostingRules,
  profile: LoadedProfile,
): Finding[] {
  const findings: Finding[] = [];
  const front = parseFrontMatter(text);
  if (front.error !== undefined) {
    findings.push({ code: "front-matter", severity: "error", message: front.error });
  }
  const fields = front.fields ?? {};
  const required = rules.fields?.required ?? [...LONGFORM_REQUIRED_FIELDS];
  for (const name of required) {
    if (isBlankField(fields[name])) {
      findings.push({
        code: "missing-field",
        severity: "error",
        message: `long-form post has no "${name}" — add it to the variant's front matter`,
      });
    }
  }

  const words = countWords(front.body);
  const min = rules.limits?.words?.min;
  const max = rules.limits?.words?.max;
  const channel = rules.platform ?? "channel";
  if (max !== undefined && words > max) {
    findings.push({
      code: "word-count",
      severity: "error",
      message: `body is ${words} words; ${channel} long-form allows at most ${max}`,
    });
  }
  if (min !== undefined && words < min) {
    findings.push({
      code: "word-count",
      severity: "error",
      message: `body is ${words} words; ${channel} long-form requires at least ${min}`,
    });
  }

  const urlText = [front.body, ...Object.values(fields).map((value) => fieldString(value))].join(
    "\n",
  );
  findings.push(...urlFindings(urlText, profile));
  findings.push(...claimFindings(front.body));
  return findings;
}

/* ---------------------------------------------------------------------------
 * task bundle
 * ------------------------------------------------------------------------- */

function rulesSummary(rules: PostingRules): string[] {
  return [
    `  settings: ${JSON.stringify(rules.settings ?? {})}`,
    `  links: ${rules.links?.policy ?? "identity-ssot-only"}`,
    `  structure: ${(rules.structure ?? []).join(" → ") || "—"}`,
    `  sources: ${
      (rules.sources ?? [])
        .map((source) => `${source.url ?? "—"} (${source.date ?? "—"})`)
        .join("; ") || "—"
    }`,
  ];
}

function buildTask(args: {
  seedId: string;
  channel: Platform;
  seed: string;
  profile: LoadedProfile;
  rules: PostingRules;
  skill: string | undefined;
  variants: number;
  lang: string;
  derivedFrom?: string;
}): string {
  const { seedId, channel, seed, profile, rules, skill, variants, lang, derivedFrom } = args;
  const facts = factLines(profile).join("\n  ");
  const derivedLine =
    derivedFrom === undefined
      ? []
      : [
          `Derived from long-form seed: ${derivedFrom} (the essay is canonical; derive, do not rewrite).`,
          ``,
        ];
  return [
    `# pasco post task — ${seedId} / ${channel}`,
    ``,
    ...derivedLine,
    `Write ${variants} variant(s) of a ${channel} POST in ${lang}. You are the agent:`,
    `the CLI never calls an LLM. Read the skill FIRST:`,
    `  ${skill ?? `(missing skills/${channel}/post.md)`}`,
    ``,
    `${derivedFrom === undefined ? "Seed" : "Source essay"} (canonical — do not rewrite its meaning):`,
    seed.trim(),
    ``,
    `Facts (byte-identical; cite with {{fact:<pointer>}}):`,
    `  ${facts}`,
    ``,
    `Channel rules (from skills/${channel}/posting.yaml):`,
    `  maxChars: ${rules.limits?.maxChars ?? "—"}`,
    `  hashtags (max): ${rules.hashtags?.max ?? "—"}`,
    ...rulesSummary(rules),
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

function buildLongformTask(args: {
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
  const required = (rules.fields?.required ?? [...LONGFORM_REQUIRED_FIELDS]).join(", ");
  const optional = (rules.fields?.optional ?? []).join(", ") || "—";
  const min = rules.limits?.words?.min;
  const max = rules.limits?.words?.max;
  const words =
    min !== undefined && max !== undefined
      ? `${min}–${max}`
      : min !== undefined
        ? `at least ${min}`
        : max !== undefined
          ? `at most ${max}`
          : "—";
  const fieldsTemplate = [
    ...(rules.fields?.required ?? [...LONGFORM_REQUIRED_FIELDS]).map((name) =>
      name === "tags" ? "tags: [tag-one, tag-two]" : `${name}: <${name}>`,
    ),
    ...(rules.fields?.optional ?? []).map((name) => `# ${name}: <optional>`),
  ];
  return [
    `# pasco post task — ${seedId} / ${channel} (longform)`,
    ``,
    `Write ${variants} variant(s) of a ${channel} LONG-FORM piece in ${lang} (essay/newsletter).`,
    `You are the agent: the CLI never calls an LLM. Read the rules FIRST:`,
    `  contract: skills/${channel}/longform.yaml`,
    `  judgment: ${skill ?? `skills/${channel}/post.md is not shipped for this channel yet`}`,
    ``,
    `Seed (canonical essay — do not rewrite its meaning):`,
    seed.trim(),
    ``,
    `Facts (byte-identical; cite with {{fact:<pointer>}}):`,
    `  ${facts}`,
    ``,
    `Long-form contract (from skills/${channel}/longform.yaml):`,
    `  fields required: ${required}`,
    `  fields optional: ${optional}`,
    `  words: ${words}`,
    `  export: ${rules.export ?? "—"} (${rules.export === "paste" ? "paste surface — no body API" : "API platform — Postiz settings mapping"})`,
    `  maxChars: ${rules.limits?.maxChars ?? "—"}`,
    ...rulesSummary(rules),
    ``,
    `Output: save each variant at`,
    `  posts/${seedId}/${channel}/${channel}-<n>.md`,
    `as YAML front matter + a markdown body (the front matter IS the field contract):`,
    `  ---`,
    ...fieldsTemplate.map((field) => `  ${field}`),
    `  ---`,
    `  <body in markdown>`,
    `Then record the choice:`,
    `  pasco post choose ${seedId} --channel ${channel} --variant ${channel}-<n>`,
    ``,
    `Constraints:`,
    `  - The title and dek are fields, never the first lines of the body.`,
    `  - Facts never change (D4). Quote them as {{fact:<pointer>}}; do not paraphrase a number, date or URL.`,
    `  - Links (canonical included) only from the identity SSOT — never invent URLs.`,
    `  - Keep the channel's native long-form shape; the skill is the strategy, not the template.`,
    ``,
  ].join("\n");
}

/* ---------------------------------------------------------------------------
 * postiz + paste
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

function buildPasteChecklist(args: {
  seedId: string;
  channel: string;
  fields: Record<string, unknown>;
  body: string;
  rules: PostingRules;
}): string {
  const { seedId, channel, fields, body, rules } = args;
  const declared = [
    ...(rules.fields?.required ?? [...LONGFORM_REQUIRED_FIELDS]),
    ...(rules.fields?.optional ?? []),
  ];
  const fieldLines = declared
    .filter((name) => fields[name] !== undefined)
    .map((name) => `- ${name}: ${fieldString(fields[name])}`);
  return [
    `# Paste checklist — ${seedId} / ${channel}`,
    ``,
    `This channel is a **paste surface** (no body API): the body and the fields go`,
    `into the platform's own editor. Facts are already rendered (no {{fact:...}} left).`,
    ``,
    `## Fields`,
    ``,
    ...(fieldLines.length > 0 ? fieldLines : ["- (no fields declared)"]),
    ``,
    `## Body`,
    ``,
    body.trim(),
    ``,
    `## After pasting`,
    ``,
    `- [ ] Title and dek are in the platform's own fields, not duplicated in the body.`,
    `- [ ] The body rendered with zero placeholders (search for "{{fact:").`,
    `- [ ] Every link (canonical included) is an SSOT URL.`,
    `- [ ] Tags/list match the front matter above.`,
    ``,
  ].join("\n");
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
  const format = parseFormat(args.formatArg);
  if (args.fromArg !== undefined) {
    throw new UsageError("--from only applies to `pasco post task --format short`");
  }
  if (args.textArg === undefined) {
    throw new UsageError(
      "usage: pasco post seed <seed-id> --text <file> [--format short|longform]",
    );
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
  const ledger = createSeed(args.workspace, seedId, text, "authored", { format });
  if (isJsonMode()) {
    return report("post", true, EXIT.OK, {
      data: {
        mode: "seed",
        seedId,
        format,
        seedPath: seedPath(args.workspace, seedId),
        ledger,
      },
    });
  }
  line(`seeded ${seedId} (${format}) at ${seedPath(args.workspace, seedId)}`);
  return EXIT.OK;
}

function handleTask(args: PostArgs): number {
  const seedId = requireSeed(args);
  const format = parseFormat(args.formatArg);
  const from = args.fromArg;
  if (from !== undefined) {
    if (format !== "short") {
      throw new UsageError("--from only applies to --format short (the derived family)");
    }
    if (!isSafeSeedId(from)) {
      throw new UsageError(
        "--from must be a safe seed id (letters, digits, dot, underscore, dash)",
      );
    }
    if (from === seedId) throw new UsageError("--from must name a different seed than <seed-id>");
  }
  const channels = splitChannels(args.channelArg);
  // A long-form piece is usually one projection; a short family wants variants.
  const variants = parseVariants(
    args.variantsArg,
    format === "longform" ? 1 : (args.pascorc.defaults?.variants ?? 3),
  );
  const lang = parseLang(defaultsLang(args.pascorc));

  let seed: string;
  if (from !== undefined) {
    if (!existsSync(ledgerPath(args.workspace, from))) {
      throw new UsageError(
        `--from ${from}: no post ledger at ${ledgerPath(args.workspace, from)} — seed the essay first`,
      );
    }
    const parent = readLedger(args.workspace, from);
    if (parent.format !== "longform") {
      throw new UsageError(
        `--from ${from} is a "${parent.format}" seed; the derived family needs a long-form (essay) seed`,
      );
    }
    seed = seedText(args.workspace, from);
  } else {
    seed = seedText(args.workspace, seedId);
  }

  const existing = existsSync(ledgerPath(args.workspace, seedId))
    ? readLedger(args.workspace, seedId)
    : undefined;
  if (existing !== undefined) {
    if (existing.format !== format) {
      throw new UsageError(
        `seed ${seedId} is format "${existing.format}"; a seed's format is fixed — rerun with --format ${existing.format}, or use a new seed id`,
      );
    }
    if (existing.derivedFrom !== from) {
      throw new UsageError(
        existing.derivedFrom === undefined
          ? `seed ${seedId} is a root seed; --from needs a new short seed id`
          : `seed ${seedId} is derived from "${existing.derivedFrom}", not "${from ?? "(none)"}"`,
      );
    }
  } else {
    createSeed(args.workspace, seedId, from === undefined ? seed : undefined, "authored", {
      format,
      ...(from !== undefined ? { derivedFrom: from } : {}),
    });
  }

  const loaded = loadProfile(args.workspace);
  if (typeof loaded === "number") return loaded;
  const profile = loaded;
  const results: {
    channel: string;
    format: PostFormat;
    derivedFrom?: string;
    taskPath: string;
    skill: string | undefined;
    maxChars?: number;
    words?: WordLimits;
  }[] = [];
  for (const channel of channels) {
    const rules = readRules(channel, format);
    const skill = skillFile(channel, "post.md");
    const task =
      format === "longform"
        ? buildLongformTask({ seedId, channel, seed, profile, rules, skill, variants, lang })
        : buildTask({
            seedId,
            channel,
            seed,
            profile,
            rules,
            skill,
            variants,
            lang,
            ...(from !== undefined ? { derivedFrom: from } : {}),
          });
    const taskPath = join(seedDir(args.workspace, seedId), channel, "task.md");
    mkdirSync(dirname(taskPath), { recursive: true });
    writeFileSync(taskPath, task);
    results.push({
      channel: String(channel),
      format,
      ...(from !== undefined ? { derivedFrom: from } : {}),
      taskPath,
      skill,
      maxChars: rules.limits?.maxChars,
      ...(rules.limits?.words !== undefined ? { words: rules.limits.words } : {}),
    });
    line(`task: ${taskPath} (${format}${from !== undefined ? `, derivedFrom ${from}` : ""})`);
    line(`  skill: ${skill ?? "(missing)"}`);
    if (format === "longform") {
      line(`  words: ${rules.limits?.words?.min ?? "—"}–${rules.limits?.words?.max ?? "—"}`);
      line(`  export: ${rules.export ?? "—"}`);
    } else {
      line(`  maxChars: ${rules.limits?.maxChars ?? "—"}`);
    }
  }
  if (isJsonMode()) {
    return report("post", true, EXIT.OK, {
      data: {
        mode: "task",
        seedId,
        format,
        derivedFrom: from ?? null,
        lang,
        variants,
        channels: results,
      },
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
  const ledger = readLedger(args.workspace, seedId);
  readRules(channel, ledger.format);
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

function derivedFindings(workspace: string, ledger: PostLedger): Finding[] {
  const findings: Finding[] = [];
  // A root seed (long-form essay, or a standalone short) derives from nothing.
  if (ledger.derivedFrom === undefined) return findings;
  if (ledger.format !== "short") {
    findings.push({
      code: "derived-from",
      severity: "error",
      message: `a ${ledger.format} seed cannot be derived; derivedFrom is for the short family`,
    });
  }
  const parentLedger = ledgerPath(workspace, ledger.derivedFrom);
  if (!existsSync(parentLedger)) {
    findings.push({
      code: "dangling-derived-from",
      severity: "error",
      message: `derivedFrom "${ledger.derivedFrom}" has no post ledger at ${parentLedger}`,
    });
    return findings;
  }
  const parent = readLedger(workspace, ledger.derivedFrom);
  if (parent.format !== "longform") {
    findings.push({
      code: "derived-from",
      severity: "error",
      message: `derivedFrom "${ledger.derivedFrom}" is a "${parent.format}" seed; the parent must be long-form`,
    });
  }
  return findings;
}

function handleCheck(args: PostArgs): number {
  const seedId = requireSeed(args);
  const loaded = loadProfile(args.workspace);
  if (typeof loaded === "number") return loaded;
  const profile = loaded;
  const ledger = readLedger(args.workspace, seedId);
  const seedFindings = derivedFindings(args.workspace, ledger);
  const findingsByChannel: { channel: string; findings: Finding[] }[] = [];
  let errors = 0;
  let warnings = 0;
  const count = (findings: Finding[]): void => {
    for (const finding of findings) {
      if (finding.severity === "error") errors += 1;
      else warnings += 1;
    }
  };
  count(seedFindings);
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
      rules = readRules(channel, ledger.format);
    } catch (err) {
      findings.push({
        code: "unsupported-channel",
        severity: "error",
        message: (err as Error).message,
      });
    }
    if (rules !== undefined) {
      findings.push(
        ...(ledger.format === "longform"
          ? checkLongform(rendered.text, rules, profile)
          : checkText(rendered.text, rules, profile)),
      );
    }
    count(findings);
    findingsByChannel.push({ channel, findings });
  }
  if (findingsByChannel.length === 0 && seedFindings.length === 0) {
    return report("post", false, EXIT.FAIL, {
      error: { kind: "empty", message: `${seedId} has no chosen variant` },
    });
  }
  if (isJsonMode()) {
    return report("post", errors === 0, errors === 0 ? EXIT.OK : EXIT.FAIL, {
      data: {
        mode: "check",
        seedId,
        format: ledger.format,
        derivedFrom: ledger.derivedFrom ?? null,
        errors,
        warnings,
        findings: seedFindings,
        channels: findingsByChannel,
      },
    });
  }
  section(`post check — ${seedId} (${ledger.format})`);
  if (seedFindings.length > 0) {
    line("seed:");
    for (const finding of seedFindings) {
      line(`  error [${finding.code}] ${finding.message}`);
    }
  }
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
  const integrationIds = readPostizConfig(args.workspace);
  const posts: PostizPost[] = [];
  const checklists: { channel: string; path: string }[] = [];
  for (const [channel, state] of Object.entries(ledger.channels)) {
    if (state.chosen === undefined) continue;
    const chosen = chosenVariant(args.workspace, ledger, channel);
    if (chosen === undefined) {
      throw new Error(
        `channel ${channel}: chosen variant "${state.chosen}" has no body at ${variantPath(
          args.workspace,
          ledger.id,
          channel,
          state.chosen,
        )}`,
      );
    }
    const rendered = renderFacts(chosen.text, profile);
    if (rendered.dangling.length > 0) {
      throw new Error(`channel ${channel}: dangling fact ref(s): ${rendered.dangling.join(", ")}`);
    }
    const rules = readRules(channel, ledger.format);
    const settings: Record<string, unknown> = {
      ...(rules.settings ?? {}),
      __type: rules.settings?.__type ?? channel,
    };

    if (ledger.format === "longform") {
      const front = parseFrontMatter(rendered.text);
      if (front.error !== undefined) throw new UsageError(`channel ${channel}: ${front.error}`);
      const fields = front.fields ?? {};
      const missing = (rules.fields?.required ?? [...LONGFORM_REQUIRED_FIELDS]).filter((name) =>
        isBlankField(fields[name]),
      );
      if (missing.length > 0) {
        throw new UsageError(
          `channel ${channel}: long-form field(s) missing: ${missing.join(", ")} — run pasco post check ${seedId}`,
        );
      }
      if (rules.export === "paste") {
        const path = join(seedDir(args.workspace, ledger.id), channel, "paste-checklist.md");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(
          path,
          buildPasteChecklist({ seedId, channel, fields, body: front.body, rules }),
        );
        checklists.push({ channel, path });
        continue;
      }
      settings.title = fieldString(fields.title);
      for (const key of LONGFORM_SETTING_FIELDS) {
        if (fields[key] !== undefined) settings[key] = fields[key];
      }
      posts.push({
        integration: { id: integrationIds[channel] ?? "REPLACE_ME" },
        value: [{ content: front.body.trim(), image: [] }],
        settings,
      });
      continue;
    }

    posts.push({
      integration: { id: integrationIds[channel] ?? "REPLACE_ME" },
      value: [{ content: rendered.text.trim(), image: [] }],
      settings,
    });
  }
  if (posts.length === 0 && checklists.length === 0) {
    return report("post", false, EXIT.FAIL, {
      error: { kind: "empty", message: `${seedId} has no chosen variant to export` },
    });
  }
  if (posts.length === 0 && args.outArg !== undefined) {
    throw new UsageError(
      `--out needs an API channel: ${seedId} only has paste channels (checklists are written next to each channel)`,
    );
  }
  const payload: PostizPayload = { type, date, shortLink: false, tags: [], posts };
  const out = args.outArg ?? join(seedDir(args.workspace, seedId), "postiz.json");
  if (posts.length > 0) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (isJsonMode()) {
    return report("post", true, EXIT.OK, {
      data: {
        mode: "export",
        seedId,
        format: ledger.format,
        out: posts.length > 0 ? out : null,
        payload,
        pasteChecklists: checklists,
      },
    });
  }
  if (posts.length > 0) {
    line(`wrote ${out}`);
    line(
      `  ${payload.posts.length} channel(s); integration IDs: ${payload.posts
        .map((post) => post.integration.id)
        .join(", ")}`,
    );
    if (payload.posts.some((post) => post.integration.id === "REPLACE_ME")) {
      warn("some integration IDs are REPLACE_ME — add postiz.yaml (channels: {<platform>: <id>})");
    }
    line(
      `  POST it: curl -X POST "$POSTIZ_API_URL/posts" -H "Authorization: $POSTIZ_API_KEY" -H "Content-Type: application/json" -d @${out}`,
    );
  }
  for (const checklist of checklists) {
    line(`wrote paste checklist: ${checklist.path}`);
  }
  if (checklists.length > 0) {
    line(
      `  ${checklists.map((checklist) => checklist.channel).join(", ")}: paste surface (no body API) — paste the body, then the fields`,
    );
  }
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
  readRules(channel, "short");
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
      return {
        id,
        source: ledger.source,
        status: ledger.status,
        format: ledger.format,
        derivedFrom: ledger.derivedFrom ?? null,
        channels,
      };
    } catch {
      return {
        id,
        source: "?",
        status: "?",
        format: "?",
        derivedFrom: null,
        channels: "?",
      };
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
    const derived = row.derivedFrom === null ? "" : `  derivedFrom=${row.derivedFrom}`;
    line(`${row.id}  [${row.source}/${row.status}/${row.format}]  ${row.channels}${derived}`);
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
