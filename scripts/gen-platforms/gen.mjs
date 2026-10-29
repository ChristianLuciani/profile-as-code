#!/usr/bin/env node
import { realpathSync } from "node:fs";
/**
 * gen-platforms — project `platforms/registry.yaml` into every derived surface (#154).
 *
 * The platform METADATA has exactly one data home: `platforms/registry.yaml`.
 * The reviewed CONTRACT stays hand-authored in `schema/profile.schema.json`
 * (`$defs.platform.enum`, D3) — this generator owns neither, it projects the
 * registry and REFUSES every disagreement (never a silent pass):
 *
 *   E-GATE  a `status: member` slug missing from the schema enum, an enum member
 *           with no `status: member` entry, or a `status: backlog` slug that IS
 *           an enum entry (the registry is exhaustive by contract);
 *   E-GATE  `postiz.count` != the number of entries with `origin: postiz`;
 *   E-GATE  a renderer manifest (`packages/renderers/<p>/package.json`,
 *           `pasco.platform` — #165) that disagrees with `renderer:` (the
 *           explicit "not implemented yet" the reverse assert requires);
 *   E-GATE  a renderer's `pasco.deploySpec` != the registry `deploy` (D9);
 *   E-GATE  a `fixture:` naming a missing `packages/core/tests/fixtures/<name>`;
 *   --check stale projection (a registry edit without `pnpm gen:platforms`).
 *
 * Derived surfaces (all committed, never hand-edited):
 *   packages/core/src/generated/platforms.gen.ts  slug list + host maps + tests
 *   packages/core/src/generated/ai-policy.gen.ts  the `ai:` crawler policy (#290)
 *   docs/SPEC.md    between `<!-- gen:platform-families -->` … `<!-- /gen -->`
 *                   and between `<!-- gen:ai-policy -->` … `<!-- /gen -->`
 *   README.md       between `<!-- gen:platform-status -->` … `<!-- /gen -->`
 *
 * The renderer walk is REUSED, not re-implemented: `collectRenderers` is
 * exported by `scripts/renderer-map/gen.mjs` (#165) and self-tested there, so
 * the two gates can never disagree on what a renderer is.
 *
 * Zero-dependency node >=22 except `yaml` (a root devDependency), like
 * `scripts/schema-check` and the D3 gates it mirrors.
 *
 * Usage:  node scripts/gen-platforms/gen.mjs [--root DIR] [--check]
 *         pnpm gen:platforms            # write the projections
 * Exit:   0 written/in sync · 1 E-GATE refusal (reason on stdout)
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { collectRenderers, SURFACE_KINDS } from "../renderer-map/gen.mjs";

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
class GateError extends Error {}

const REGISTRY_REL = path.join("platforms", "registry.yaml");
const SCHEMA_REL = path.join("schema", "profile.schema.json");
const OUT_REL = path.join("packages", "core", "src", "generated", "platforms.gen.ts");
const SPEC_REL = path.join("docs", "SPEC.md");
const README_REL = "README.md";
const FIXTURES_REL = path.join("packages", "core", "tests", "fixtures");
const SKILLS_REL = "skills";
const DEPLOY_KINDS = ["git", "api", "manual"];
const STATUSES = ["member", "backlog"];
const ORIGINS = ["postiz", "extra"];
const AI_OUT_REL = path.join("packages", "core", "src", "generated", "ai-policy.gen.ts");
const SPEC_MARKER = "gen:platform-families";
const SPEC_AI_MARKER = "gen:ai-policy";
const README_MARKER = "gen:platform-status";
const AI_FAMILIES = ["retrieval", "training"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A REAL calendar date, not just an ISO-shaped string (#290 review F5): a
 * pattern-only check accepts `2026-13-45`, which parses to `NaN` and silently
 * disables every age comparison downstream.
 */
const isRealDate = (value) => {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
};
const HTTP_URL = /^https?:\/\/[^\s]+$/;
const CRAWLER_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const GEN_CLOSE = "<!-- /gen -->";

const rel = (root, target) => path.relative(root, target) || ".";

async function readText(target, what) {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    throw new GateError(`cannot read ${what} (${target}): ${error.message}`);
  }
}

async function readJson(target, what) {
  const source = await readText(target, what);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new GateError(`${what} is not valid JSON (${target}): ${error.message}`);
  }
}

/** `$defs.platform.enum` — the hand-authored contract (D3/D16), never re-listed. */
async function schemaPlatforms(root) {
  const schema = await readJson(path.join(root, SCHEMA_REL), "the profile schema");
  const values = schema?.$defs?.platform?.enum;
  if (!Array.isArray(values) || values.length === 0 || values.some((v) => typeof v !== "string")) {
    throw new GateError(
      `${SCHEMA_REL}: $defs.platform.enum is not a non-empty string array — the platform contract is unreadable`,
    );
  }
  return values;
}

const VERSION_RE = /^v\d+(?:\.\d+)?$/;
const versionKey = (v) => {
  const [, major, minor = "0"] = /^v(\d+)(?:\.(\d+))?$/.exec(v);
  return [Number(major), Number(minor)];
};

/** Parse + shape-check the registry. Returns `{ families, platforms, postiz }`. */
async function loadRegistry(root) {
  const source = await readText(path.join(root, REGISTRY_REL), REGISTRY_REL);
  let registry;
  try {
    registry = parseYaml(source);
  } catch (error) {
    throw new GateError(`${REGISTRY_REL} is not valid YAML: ${error.message}`);
  }
  if (registry === null || typeof registry !== "object") {
    throw new GateError(`${REGISTRY_REL}: top level must be a mapping`);
  }
  const platforms = registry.platforms;
  if (platforms === null || typeof platforms !== "object" || Array.isArray(platforms)) {
    throw new GateError(`${REGISTRY_REL}: "platforms" must be a mapping of slug → metadata`);
  }
  const postiz = registry.postiz;
  if (
    postiz === null ||
    typeof postiz !== "object" ||
    !Number.isInteger(postiz.count) ||
    postiz.count < 0
  ) {
    throw new GateError(`${REGISTRY_REL}: "postiz.count" must be a non-negative integer`);
  }
  const families = registry.families ?? {};
  if (families === null || typeof families !== "object" || Array.isArray(families)) {
    throw new GateError(`${REGISTRY_REL}: "families" must be a mapping when present`);
  }
  for (const [id, family] of Object.entries(families)) {
    if (family === null || typeof family !== "object" || Array.isArray(family)) {
      throw new GateError(`${REGISTRY_REL}: family "${id}" must be a mapping`);
    }
    for (const field of ["display", "purpose"]) {
      if (typeof family[field] !== "string" || family[field].length === 0) {
        throw new GateError(`${REGISTRY_REL}: family "${id}".${field} must be a non-empty string`);
      }
    }
  }

  for (const [slug, entry] of Object.entries(platforms)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new GateError(`${REGISTRY_REL}: "${slug}" must be a mapping`);
    }
    if (!STATUSES.includes(entry.status)) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".status must be one of ${STATUSES.join(" | ")}`,
      );
    }
    if (entry.family !== undefined && !(entry.family in families)) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".family "${entry.family}" is not declared under "families"`,
      );
    }
    if (
      !Array.isArray(entry.sources) ||
      entry.sources.length === 0 ||
      entry.sources.some((s) => typeof s !== "string" || s.length === 0)
    ) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".sources must be a non-empty array of strings (evidence rule)`,
      );
    }
    if (entry.status === "backlog") {
      // A backlog slug is NOT an enum entry: it carries only its family, its kind
      // and the sourced descriptor — no deploy/hosts/renderer until it is promoted.
      if (typeof entry.family !== "string" || entry.family.length === 0) {
        throw new GateError(`${REGISTRY_REL}: backlog "${slug}" must declare a family`);
      }
      if (entry.kind !== undefined && !SURFACE_KINDS.includes(entry.kind)) {
        throw new GateError(
          `${REGISTRY_REL}: "${slug}".kind must be one of ${SURFACE_KINDS.join(" | ")} (D23)`,
        );
      }
      continue;
    }
    // D23: the enum is the PROFILE bodies. A member with any other kind would
    // claim that a profile renderer emits repo metadata — the exact confusion
    // this axis exists to end.
    const kind = entry.kind ?? "profile";
    if (!SURFACE_KINDS.includes(kind)) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".kind must be one of ${SURFACE_KINDS.join(" | ")} (D23)`,
      );
    }
    if (kind !== "profile") {
      throw new GateError(
        `${REGISTRY_REL}: member "${slug}" declares kind "${kind}" — the enum is the profile bodies; declare a non-profile surface as status: backlog (D23)`,
      );
    }
    if (!ORIGINS.includes(entry.origin)) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".origin must be one of ${ORIGINS.join(" | ")}`,
      );
    }
    if (typeof entry.since !== "string" || !VERSION_RE.test(entry.since)) {
      throw new GateError(`${REGISTRY_REL}: "${slug}".since must look like "v1.8"`);
    }
    if (!DEPLOY_KINDS.includes(entry.deploy)) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".deploy must be one of ${DEPLOY_KINDS.join(" | ")} (D9)`,
      );
    }
    if (typeof entry.renderer !== "boolean") {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".renderer must be boolean — false is the explicit "not implemented yet"`,
      );
    }
    for (const field of ["hosts", "subdomain_hosts", "handle_hosts"]) {
      const values = entry[field];
      if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) {
        throw new GateError(`${REGISTRY_REL}: "${slug}".${field} must be an array of strings`);
      }
    }
  }
  return { families, platforms, postiz, ai: registry.ai };
}

/** Whitespace-normalized comparison (a SPEC paragraph wraps; the stance is one sentence). */
const normalize = (value) => value.replace(/\s+/g, " ").trim();

/**
 * The `ai:` block (#290): the crawler policy the `pasco export ai-policy`
 * artifact is generated from. It is data, and UNSOURCED DATA IS THE FAILURE MODE
 * this gate exists for — a UA classified from memory makes the whole artifact
 * worthless, so every entry must name the operator's own page and the date it
 * was read, and the policy stance must appear verbatim in the SPEC.
 */
function loadAiPolicy(ai, specSource) {
  if (ai === null || typeof ai !== "object" || Array.isArray(ai)) {
    throw new GateError(`${REGISTRY_REL}: "ai" must be a mapping (the AI crawler policy, #290)`);
  }
  const policy = ai.policy;
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    throw new GateError(`${REGISTRY_REL}: "ai.policy" must be a mapping`);
  }
  if (!Number.isInteger(policy.version) || policy.version < 1) {
    throw new GateError(`${REGISTRY_REL}: ai.policy.version must be a positive integer`);
  }
  if (!isRealDate(policy.as_of)) {
    throw new GateError(`${REGISTRY_REL}: ai.policy.as_of must be a real ISO date (YYYY-MM-DD)`);
  }
  if (typeof policy.stance !== "string" || policy.stance.length === 0) {
    throw new GateError(`${REGISTRY_REL}: ai.policy.stance must be a non-empty string`);
  }
  if (!normalize(specSource).includes(normalize(policy.stance))) {
    throw new GateError(
      `${REGISTRY_REL}: ai.policy.stance is not present verbatim in ${SPEC_REL} — the artifact quotes it, so the stated position cannot drift from the SPEC`,
    );
  }

  const crawlers = ai.crawlers;
  if (crawlers === null || typeof crawlers !== "object" || Array.isArray(crawlers)) {
    throw new GateError(`${REGISTRY_REL}: "ai.crawlers" must be a mapping of slug → metadata`);
  }
  const slugs = Object.keys(crawlers);
  if (slugs.length === 0) {
    throw new GateError(`${REGISTRY_REL}: "ai.crawlers" declares no entry`);
  }
  // RFC 9309 §2.2.1 matches a product token case-insensitively: `GPTBot` and
  // `gptbot` are one crawler, and two entries would render two groups for it
  // (#290 review F4).
  const seenUa = new Map();
  const rows = slugs.map((slug) => {
    const entry = crawlers[slug];
    if (!CRAWLER_SLUG.test(slug)) {
      throw new GateError(`${REGISTRY_REL}: ai crawler "${slug}" must be a kebab-case slug`);
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new GateError(`${REGISTRY_REL}: ai crawler "${slug}" must be a mapping`);
    }
    const { ua, family, operator, source, as_of: asOf } = entry;
    if (typeof ua !== "string" || ua.length === 0 || /\s/.test(ua)) {
      throw new GateError(
        `${REGISTRY_REL}: ai crawler "${slug}".ua must be one robots.txt token (no whitespace)`,
      );
    }
    const token = ua.toLowerCase();
    if (seenUa.has(token)) {
      throw new GateError(
        `${REGISTRY_REL}: ai crawlers "${seenUa.get(token)}" and "${slug}" both declare ua "${ua}" — one entry per token (robots.txt matches tokens case-insensitively)`,
      );
    }
    seenUa.set(token, slug);
    if (!AI_FAMILIES.includes(family)) {
      throw new GateError(
        `${REGISTRY_REL}: ai crawler "${slug}".family must be one of ${AI_FAMILIES.join(" | ")}`,
      );
    }
    if (typeof operator !== "string" || operator.length === 0) {
      throw new GateError(
        `${REGISTRY_REL}: ai crawler "${slug}".operator must be a non-empty string`,
      );
    }
    if (typeof source !== "string" || !HTTP_URL.test(source)) {
      throw new GateError(
        `${REGISTRY_REL}: ai crawler "${slug}".source must be the operator's http(s) page — an unsourced classification does not ship`,
      );
    }
    if (!isRealDate(asOf)) {
      throw new GateError(
        `${REGISTRY_REL}: ai crawler "${slug}".as_of must be a real ISO date (YYYY-MM-DD)`,
      );
    }
    return { slug, ua, family, operator, source, as_of: asOf };
  });
  // The policy date SEALS these rows: a stamp older than the data it seals is a
  // leftover, not a review date (#290 review F2).
  const newest = rows
    .map((row) => row.as_of)
    .sort()
    .at(-1);
  if (newest !== undefined && policy.as_of < newest) {
    throw new GateError(
      `${REGISTRY_REL}: ai.policy.as_of (${policy.as_of}) predates the newest crawler review (${newest}) — the stamp cannot seal data younger than itself`,
    );
  }
  for (const family of AI_FAMILIES) {
    if (!rows.some((row) => row.family === family)) {
      throw new GateError(
        `${REGISTRY_REL}: the ai policy declares no "${family}" crawler — a robots.txt without that group does not express the policy`,
      );
    }
  }
  return {
    policy: { version: policy.version, as_of: policy.as_of, stance: policy.stance },
    crawlers: rows,
  };
}

/** Renderer platforms from the manifests — the #165 walk, reused. */
async function rendererIndex(root) {
  let entries;
  try {
    entries = await collectRenderers(root);
  } catch (error) {
    throw new GateError(`renderer manifests unreadable: ${error.message}`);
  }
  const index = new Map();
  for (const entry of entries) index.set(entry.platform, entry);
  return index;
}

/** Build the projection model + refuse every registry ↔ enum ↔ renderer mismatch. */
async function buildModel(root) {
  const enumPlatforms = await schemaPlatforms(root);
  const { families, platforms, postiz, ai } = await loadRegistry(root);
  const aiPolicy = loadAiPolicy(ai, await readText(path.join(root, SPEC_REL), SPEC_REL));
  const renderers = await rendererIndex(root);

  const enumSet = new Set(enumPlatforms);
  const registrySlugs = Object.keys(platforms);
  const memberSlugs = registrySlugs.filter((slug) => platforms[slug].status === "member");
  const backlogSlugs = registrySlugs.filter((slug) => platforms[slug].status === "backlog");
  const memberSet = new Set(memberSlugs);
  const missing = enumPlatforms.filter((slug) => !memberSet.has(slug));
  const surplus = memberSlugs.filter((slug) => !enumSet.has(slug));
  const backlogInEnum = backlogSlugs.filter((slug) => enumSet.has(slug));
  if (missing.length > 0 || surplus.length > 0 || backlogInEnum.length > 0) {
    throw new GateError(
      `${REGISTRY_REL} and ${SCHEMA_REL} $defs.platform.enum disagree: ` +
        (missing.length > 0
          ? `enum members without a status:member registry entry: ${missing.join(", ")}. `
          : "") +
        (surplus.length > 0
          ? `status:member slugs outside the enum: ${surplus.join(", ")}. `
          : "") +
        (backlogInEnum.length > 0
          ? `status:backlog slugs that ARE enum entries: ${backlogInEnum.join(", ")}.`
          : ""),
    );
  }

  const postizMembers = memberSlugs.filter((slug) => platforms[slug].origin === "postiz");
  if (postizMembers.length !== postiz.count) {
    throw new GateError(
      `${REGISTRY_REL}: postiz.count is ${postiz.count} but ${postizMembers.length} entries declare origin: postiz`,
    );
  }

  // Reverse assert (#154): the enum must have a renderer OR an explicit
  // `renderer: false`; a manifest must never disagree with the declaration.
  for (const slug of memberSlugs) {
    const declared = platforms[slug].renderer;
    const manifest = renderers.get(slug);
    if (declared && manifest === undefined) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}" declares renderer: true but no renderer manifest declares pasco.platform "${slug}" (${rel(root, path.join("packages", "renderers"))}/)`,
      );
    }
    if (!declared && manifest !== undefined) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}" declares renderer: false but ${manifest.where} declares it — flip the registry or remove the manifest`,
      );
    }
    if (manifest !== undefined && manifest.deploySpec !== platforms[slug].deploy) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".deploy is "${platforms[slug].deploy}" but ${manifest.where} declares pasco.deploySpec "${manifest.deploySpec}" (D9 must agree)`,
      );
    }
    // D23 gate: a renderer that emits REPO METADATA while the registry calls it a
    // profile body (or the mirror) would put repo description/topics through a
    // profile renderer. The manifest's declared surface and the registry kind must
    // be one value; absent pasco.surface keeps its pre-D23 meaning, `profile`.
    if (manifest !== undefined && manifest.surface !== (platforms[slug].kind ?? "profile")) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".kind is "${platforms[slug].kind ?? "profile"}" but ${manifest.where} declares pasco.surface "${manifest.surface}" — a repo-metadata emitter cannot be kind: profile (D23)`,
      );
    }
  }

  // Fixture check: a declared fixture must exist (the "slugs have fixtures" CI check).
  for (const slug of memberSlugs) {
    const fixture = platforms[slug].fixture;
    if (fixture === undefined) continue;
    let entries;
    try {
      entries = await readdir(path.join(root, FIXTURES_REL));
    } catch (error) {
      throw new GateError(`cannot read ${FIXTURES_REL}/: ${error.message}`);
    }
    if (!entries.includes(fixture)) {
      throw new GateError(
        `${REGISTRY_REL}: "${slug}".fixture "${fixture}" does not exist under ${FIXTURES_REL}/`,
      );
    }
  }
  // A paste renderer (manual deploy) must name the test workspace that exercises
  // it — the skeleton is a check, not a silent gap. `git` surfaces (github-readme,
  // github-org) are exercised by the template/scaffold instead and are exempt.
  for (const slug of memberSlugs) {
    const entry = platforms[slug];
    if (entry.renderer && entry.deploy === "manual" && entry.fixture === undefined) {
      throw new GateError(
        `${REGISTRY_REL}: renderer platform "${slug}" (manual deploy) declares no fixture — name the test workspace that exercises it`,
      );
    }
  }

  const hosts = new Set();
  for (const slug of memberSlugs) {
    for (const host of platforms[slug].hosts) hosts.add(host);
  }
  const subdomainHosts = {};
  const handleHosts = {};
  for (const slug of memberSlugs) {
    if (platforms[slug].subdomain_hosts.length > 0) {
      subdomainHosts[slug] = platforms[slug].subdomain_hosts;
    }
    if (platforms[slug].handle_hosts.length > 0) handleHosts[slug] = platforms[slug].handle_hosts;
  }

  // Paste test enumeration: creator-monetization members added v1.8+ (the shared
  // family fixture), derived instead of a hand-extended `it.each` list.
  const paste = memberSlugs
    .filter((slug) => {
      const entry = platforms[slug];
      if (entry.family !== "creator-monetization") return false;
      const [major, minor] = versionKey(entry.since);
      return major > 1 || (major === 1 && minor >= 8);
    })
    .map((slug) => {
      const host = platforms[slug].handle_hosts[0];
      if (host === undefined) {
        throw new GateError(
          `${REGISTRY_REL}: paste platform "${slug}" has no handle_host for the test enumeration`,
        );
      }
      return { platform: slug, host };
    });

  const extras = memberSlugs.filter((slug) => platforms[slug].origin === "extra");
  const extrasByVersion = new Map();
  for (const slug of extras) {
    const since = platforms[slug].since;
    extrasByVersion.set(since, (extrasByVersion.get(since) ?? 0) + 1);
  }
  const extraCounts = [...extrasByVersion.entries()]
    .sort(([a], [b]) => {
      const [am, an] = versionKey(a);
      const [bm, bn] = versionKey(b);
      return am - bm || an - bn;
    })
    .map(([, count]) => count);

  let skills = 0;
  try {
    const entries = await readdir(path.join(root, SKILLS_REL), { withFileTypes: true });
    skills = entries.filter((entry) => entry.isDirectory()).length;
  } catch {
    // No skills dir in a synthetic tree — the count is then 0, not a refusal.
  }

  return {
    enumPlatforms,
    ai: aiPolicy,
    families,
    platforms,
    memberSlugs,
    backlogSlugs,
    hosts: [...hosts].sort(),
    subdomainHosts,
    handleHosts,
    paste,
    counts: {
      total: memberSlugs.length,
      postiz: postiz.count,
      extras: extras.length,
      extraCounts,
    },
    renderers: renderers.size,
    skills,
  };
}

const identifier = (value) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
const key = (value) => (identifier(value) ? value : JSON.stringify(value));
const stringArray = (values) => `[${values.map((v) => JSON.stringify(v)).join(", ")}]`;

/** `packages/core/src/generated/platforms.gen.ts` — the code projection. */
export function renderPlatformsModule(model) {
  const slugs = model.enumPlatforms.map((slug) => `  ${JSON.stringify(slug)},`).join("\n");
  const kinds = Object.entries(model.platforms)
    .map(([slug, entry]) => `  ${key(slug)}: ${JSON.stringify(entry.kind ?? "profile")},`)
    .join("\n");
  const hosts = model.hosts.map((host) => `  ${JSON.stringify(host)},`).join("\n");
  const subdomains = Object.entries(model.subdomainHosts)
    .map(([slug, values]) => `  ${key(slug)}: ${stringArray(values)},`)
    .join("\n");
  const handles = Object.entries(model.handleHosts)
    .map(([slug, values]) => `  ${key(slug)}: ${stringArray(values)},`)
    .join("\n");
  const paste = model.paste
    .map((c) => `  { platform: ${JSON.stringify(c.platform)}, host: ${JSON.stringify(c.host)} },`)
    .join("\n");
  return `/**
 * GENERATED by scripts/gen-platforms/gen.mjs from platforms/registry.yaml — DO NOT EDIT BY HAND (#154).
 *
 * The platform METADATA has exactly one data home: \`platforms/registry.yaml\`.
 * The reviewed CONTRACT stays hand-authored in \`schema/profile.schema.json\`
 * (\`$defs.platform.enum\`, D3) — this module owns neither, it is a projection.
 * Run \`pnpm gen:platforms\` after editing the registry; CI asserts this file,
 * the enum and the registry agree (\`scripts/schema-check/check.py\`,
 * \`node scripts/gen-platforms/gen.mjs --check\`).
 */

/** The enum members, in schema-enum order (the contract's order). */
export const PLATFORM_SLUGS = [
${slugs}
] as const;

/** Apex hosts that are platform surfaces (drift \`isPlatformSurface\`). */
export const PLATFORM_HOSTS: readonly string[] = [
${hosts}
];

/**
 * D23 (issue #262): the surface KIND of every registry entry — the enum members
 * (always \`profile\`) plus the declared non-profile backlog (repo metadata and
 * distribution channels). \`PLATFORM_SLUGS\` stays the 49-slug profile contract;
 * this map is the axis a release plan orders by, never a second enum.
 */
export type SurfaceKind = "profile" | "repo-meta" | "distribution";
export const PLATFORM_KINDS: Readonly<Record<string, SurfaceKind>> = {
${kinds}
};

/** Platform → hosts whose SUBDOMAINS are profile surfaces (\`user.substack.com\`). */
export const PLATFORM_SUBDOMAIN_HOSTS: Readonly<Record<string, readonly string[]>> = {
${subdomains}
};

/** Platform → expected host(s) for socialHandles URLs; an absent key means any host. */
export const HANDLE_HOSTS: Readonly<Record<string, readonly string[]>> = {
${handles}
};

/** One creator-monetization paste platform exercised by the shared family test. */
export interface PastePlatformCase {
  readonly platform: string;
  readonly host: string;
}

/** Creator-monetization members added v1.8+ (derived; the tests' \`it.each\` list). */
export const PASTE_PLATFORMS: readonly PastePlatformCase[] = [
${paste}
];
`;
}

/** `packages/core/src/generated/ai-policy.gen.ts` — the AI crawler policy projection (#290). */
export function renderAiPolicyModule(model) {
  const { policy, crawlers } = model.ai;
  const rows = crawlers
    .map(
      (crawler) =>
        `  { slug: ${JSON.stringify(crawler.slug)}, ua: ${JSON.stringify(crawler.ua)}, family: ${JSON.stringify(crawler.family)}, operator: ${JSON.stringify(crawler.operator)}, source: ${JSON.stringify(crawler.source)}, as_of: ${JSON.stringify(crawler.as_of)} },`,
    )
    .join("\n");
  return `/**
 * GENERATED by scripts/gen-platforms/gen.mjs from platforms/registry.yaml — DO NOT EDIT BY HAND (#290).
 *
 * The AI crawler policy has exactly one data home: the \`ai:\` block of
 * \`platforms/registry.yaml\`, where every entry names the operator's own page
 * and the date it was read. \`pasco export ai-policy\` renders these rows into
 * robots.txt / llms.txt / AI-POLICY.md; a UA list kept in the CLI would rot
 * without a failing command. Run \`pnpm gen:platforms\` after editing the
 * registry; CI asserts this file is fresh.
 */

/** The two robots.txt groups the policy is expressed as — never one wildcard. */
export type AiCrawlerFamily = "retrieval" | "training";

/** One robots.txt token and the evidence behind its classification. */
export interface AiCrawler {
  /** Registry slug — the entry a reader is pointed at. */
  readonly slug: string;
  /** The robots.txt \`User-agent\` token, verbatim. */
  readonly ua: string;
  /** retrieval = the output is a citation · training = foundation-model corpus. */
  readonly family: AiCrawlerFamily;
  /** The company/foundation that runs it. */
  readonly operator: string;
  /** That operator's own page documenting the token. */
  readonly source: string;
  /** ISO date \`source\` was read (the \`--check\` staleness anchor). */
  readonly as_of: string;
}

/** The policy contract version (a consumer refuses a version it does not know). */
export const AI_POLICY_VERSION = ${policy.version};

/** The date the policy was last reviewed (the generated files' dated stamp). */
export const AI_POLICY_AS_OF = ${JSON.stringify(policy.as_of)};

/** The stated position, verbatim from the SPEC §12 M9 floor (gate-checked). */
export const AI_POLICY_STANCE = ${JSON.stringify(policy.stance)};

/** The crawler rows, in registry order (retrieval first, then training). */
export const AI_CRAWLERS: readonly AiCrawler[] = [
${rows}
];
`;
}

/** `docs/SPEC.md` §7.3 block — the crawler table the artifact is generated from. */
export function renderSpecAiBlock(model) {
  const { policy, crawlers } = model.ai;
  const count = (family) => crawlers.filter((crawler) => crawler.family === family).length;
  const rows = crawlers.map(
    (crawler) =>
      `| \`${crawler.slug}\` | \`${crawler.ua}\` | ${crawler.family} | ${crawler.operator} | [source](${crawler.source}) | ${crawler.as_of} |`,
  );
  return [
    "<!-- GENERATED by scripts/gen-platforms/gen.mjs from platforms/registry.yaml — do not edit by hand. -->",
    `ai-policy v${policy.version} · as of ${policy.as_of} · ${count("retrieval")} retrieval (allowed) + ${count("training")} training (blocked) = **${crawlers.length}** crawler(s).`,
    "",
    "| Registry entry | User-agent | Family | Operator | Source | As of |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/** `docs/SPEC.md` §6 block — the family table + the count arithmetic. */
export function renderSpecBlock(model) {
  const { counts } = model;
  const arithmetic = `${counts.extraCounts.join(" + ")} = ${counts.extras} extras; ${counts.postiz} + ${counts.extras} = **${counts.total}**.`;
  const rows = Object.entries(model.families).map(([id, family]) => {
    const label = (slug) => {
      const note = model.platforms[slug].note;
      return note === undefined ? `\`${slug}\`` : `\`${slug}\` (${note})`;
    };
    const members = model.memberSlugs.filter((slug) => model.platforms[slug].family === id);
    const backlog = model.backlogSlugs.filter((slug) => model.platforms[slug].family === id);
    return `| \`${id}\` | ${family.display} | ${family.purpose} | ${members.length > 0 ? members.map(label).join(", ") : "— (no enum entries)"} | ${backlog.length > 0 ? backlog.map(label).join(", ") : "—"} |`;
  });
  return [
    "<!-- GENERATED by scripts/gen-platforms/gen.mjs from platforms/registry.yaml — do not edit by hand. -->",
    arithmetic,
    "",
    "| Family (label) | Display | Purpose | Members (enum) | Backlog (not enum — eligibility page before any claim) |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/** `README.md` block — the derived status counts. */
export function renderReadmeBlock(model) {
  const { counts } = model;
  return [
    "<!-- GENERATED by scripts/gen-platforms/gen.mjs from platforms/registry.yaml — do not edit by hand. -->",
    `Plataformas (enum D16): **${counts.total}** (${counts.postiz} Postiz + ${counts.extras} operator extras) · renderers: **${model.renderers}** · skills: **${model.skills}**.`,
  ].join("\n");
}

/** Replace the region between `<!-- <marker> -->` and `<!-- /gen -->`. */
export function renderBlock(source, marker, inner, where) {
  const open = `<!-- ${marker} -->`;
  const start = source.indexOf(open);
  if (start === -1) throw new GateError(`${where}: missing ${open} marker`);
  const end = source.indexOf(GEN_CLOSE, start + open.length);
  if (end === -1) throw new GateError(`${where}: missing ${GEN_CLOSE} after ${open}`);
  const rendered = `${source.slice(0, start)}${open}\n${inner}\n${GEN_CLOSE}${source.slice(end + GEN_CLOSE.length)}`;
  return { rendered, committed: source.slice(start, end + GEN_CLOSE.length) };
}

/** First divergence between a committed projection and the generated bytes. */
function firstDifference(committed, generated) {
  const a = committed.split("\n");
  const b = generated.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}: committed ${JSON.stringify(a[i] ?? "<eof>")} vs registry ${JSON.stringify(b[i] ?? "<eof>")}`;
    }
  }
  return "no line differs";
}

const OPEN = (marker) => `<!-- ${marker} -->`;

/** All three projections for a root, plus the errors a --check must report. */
async function project(root) {
  const model = await buildModel(root);
  const generated = {
    module: renderPlatformsModule(model),
    ai: renderAiPolicyModule(model),
    spec: renderSpecBlock(model),
    specAi: renderSpecAiBlock(model),
    readme: renderReadmeBlock(model),
  };
  return { model, generated };
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const rootIndex = argv.indexOf("--root");
  const root =
    rootIndex === -1
      ? fileURLToPath(new URL("../../", import.meta.url))
      : path.resolve(argv[rootIndex + 1] ?? "");

  try {
    const { model, generated } = await project(root);

    const targets = [
      {
        name: "platforms.gen.ts",
        out: path.join(root, OUT_REL),
        rel: rel(root, path.join(root, OUT_REL)),
        generated: generated.module,
      },
      {
        name: "ai-policy.gen.ts",
        out: path.join(root, AI_OUT_REL),
        rel: rel(root, path.join(root, AI_OUT_REL)),
        generated: generated.ai,
      },
      {
        name: "SPEC.md block",
        out: path.join(root, SPEC_REL),
        rel: SPEC_REL,
        marker: SPEC_MARKER,
        generated: generated.spec,
      },
      {
        name: "SPEC.md ai block",
        out: path.join(root, SPEC_REL),
        rel: SPEC_REL,
        marker: SPEC_AI_MARKER,
        generated: generated.specAi,
      },
      {
        name: "README.md block",
        out: path.join(root, README_REL),
        rel: README_REL,
        marker: README_MARKER,
        generated: generated.readme,
      },
    ];

    if (check) {
      let stale = 0;
      for (const target of targets) {
        const committed = await readText(target.out, target.rel);
        let actual;
        let expected;
        if (target.marker === undefined) {
          actual = committed;
          expected = target.generated;
        } else {
          actual = renderBlock(committed, target.marker, target.generated, target.rel).committed;
          expected = `${OPEN(target.marker)}\n${target.generated}\n${GEN_CLOSE}`;
        }
        if (actual !== expected) {
          console.log(
            `E-GATE: ${target.rel} is stale against ${REGISTRY_REL} — run \`pnpm gen:platforms\` (${target.name}: ${firstDifference(actual, expected)})`,
          );
          stale++;
        }
      }
      if (stale > 0) {
        console.log("gen-platforms: FAIL");
        process.exit(1);
      }
      console.log(
        `gen-platforms: in sync (${model.counts.total} platforms, ${model.renderers} renderer(s), ${model.skills} skill(s))`,
      );
      return;
    }

    await mkdir(path.dirname(path.join(root, OUT_REL)), { recursive: true });
    await writeFile(path.join(root, OUT_REL), generated.module);
    await writeFile(path.join(root, AI_OUT_REL), generated.ai);
    for (const [relPath, marker, inner] of [
      [SPEC_REL, SPEC_MARKER, generated.spec],
      [SPEC_REL, SPEC_AI_MARKER, generated.specAi],
      [README_REL, README_MARKER, generated.readme],
    ]) {
      const target = path.join(root, relPath);
      const source = await readText(target, relPath);
      const { rendered } = renderBlock(source, marker, inner, relPath);
      await writeFile(target, rendered);
    }
    console.log(
      `gen-platforms: wrote ${rel(root, path.join(root, OUT_REL))}, ${rel(root, path.join(root, AI_OUT_REL))}, ${SPEC_REL} + ${README_REL} (` +
        `${model.counts.total} platforms, ${model.renderers} renderer(s), ${model.skills} skill(s))`,
    );
  } catch (error) {
    if (error instanceof GateError) {
      console.log(`E-GATE: ${error.message}`);
      console.log("gen-platforms: FAIL");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Direct-execution guard (the dep-gate idiom): `import.meta.url` is the REALPATH
 * of this module while `process.argv[1]` is whatever path invoked it.
 */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // unresolvable path — compare as-is rather than fail closed on a probe
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isMain()) {
  await main();
}
