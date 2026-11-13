/**
 * load(workspace) — parse the facts files (`facts/*.yaml`, legacy `content/*.yaml`
 * — D30) of a profile-data workspace, merge
 * into one Profile, validate against the generated Zod schema (fail on schema,
 * D12) and normalize.
 *
 * File → root property mapping (schema/README.md): the file NAME is the root
 * property — `identity.yaml` contributes `identity`, `bios.yaml` contributes
 * `bios[]`, `active.yaml` contributes `active`, … Files are optional except that
 * the merged profile must satisfy the schema (`identity` is required at profile
 * level). Unknown top-level properties fail validation — `additionalProperties:
 * false` (that IS the fail-on-schema side of D12). Unknown *files* therefore also
 * fail, via their root key.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { checkAchievementIntegrity } from "./achievements.js";
import { profileSchema } from "./generated/schema.zod.js";
import { checkLedgerIntegrity } from "./ledger.js";
import { checkRegistryIntegrity } from "./registry.js";
import type { LoadedProfile, Profile } from "./types.js";

/** Workspace-level failure: missing/unreadable facts dir, bad YAML, config error. */
export class LoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LoadError";
  }
}

/** The profile violates the contract schema → FAIL (D12). Carries every violation. */
export class SchemaValidationError extends LoadError {
  readonly issues: readonly { path: string; message: string }[];

  constructor(issues: readonly { path: string; message: string }[]) {
    super(
      `profile.schema.json validation failed (D12 fail-on-schema) — ${issues.length} violation(s):\n` +
        issues.map((i) => `  ${i.path || "<root>"}: ${i.message}`).join("\n"),
    );
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

/** Validate an arbitrary merged object against the generated Zod schema. Throws SchemaValidationError. */
export function validateProfile(value: unknown): Profile {
  const result = profileSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join(".") : "<root>",
      message: issue.message,
    }));
    throw new SchemaValidationError(issues);
  }
  return result.data;
}

/**
 * Normalize a validated profile: the contract makes most root collections optional,
 * but consumers (drift/geo/compile) should never null-check. Returns the same data
 * with array properties defaulted to empty arrays and `flavor` defaulted to `person`
 * (D15: absent flavor = person — every v1 workspace stays valid).
 */
export function normalizeProfile(profile: Profile): LoadedProfile {
  return {
    ...profile,
    flavor: profile.flavor ?? "person",
    bios: profile.bios ?? [],
    headlines: profile.headlines ?? [],
    skills: profile.skills ?? [],
    experience: profile.experience ?? [],
    projects: profile.projects ?? [],
    publications: profile.publications ?? [],
    checks: profile.checks ?? [],
    socialHandles: profile.socialHandles ?? [],
    press: profile.press ?? [],
    education: profile.education ?? [],
    languages: profile.languages ?? [],
    deployments: profile.deployments ?? {},
    credentials: profile.credentials ?? [],
    artifacts: profile.artifacts ?? [],
    // #348: `faq[]` is the one list root added after `normalizeProfile` was
    // written; leaving it undefined made the loaded shape depend on whether the
    // workspace declares answers. Every list root defaults here, so the one
    // assembler (`load()`, §15.4) returns a shape a consumer reads without a
    // per-root null check.
    faq: profile.faq ?? [],
    // v1.15 (D23): the release events a workspace declares. Optional and additive
    // — an old workspace without it reads the same, now with an empty list.
    releases: profile.releases ?? [],
    // v1.16 (D24, #446): the career impact log. Same rule — the loaded shape never
    // depends on whether the workspace declares results.
    achievements: profile.achievements ?? [],
  };
}

/** The facts directory (D30): new workspaces use `facts/`; `content/` is the
 *  pre-D30 name, still read so every existing workspace keeps loading. */
export const FACTS_DIR = "facts";
export const LEGACY_FACTS_DIR = "content";

/**
 * The workspace's facts directory: `facts/` when it exists, else the legacy
 * `content/` (D30). Having BOTH is ambiguous — the ledger, the active-variant
 * skin and every write path would have to guess which one is the SSOT — so it
 * is a LoadError, never a silent pick (D12). A candidate name that exists but
 * is not a directory is the same defect class — readdir would die on a raw
 * ENOTDIR — so the boundary names the actual problem instead (D12).
 *
 * @param workspace path to the workspace root
 * @returns the directory NAME (`facts` or `content`), not a path
 * @throws LoadError — both directories exist, or a candidate name is not a directory
 */
export function factsDir(workspace: string): string {
  const factsPath = join(workspace, FACTS_DIR);
  const legacyPath = join(workspace, LEGACY_FACTS_DIR);
  for (const [name, path] of [
    [FACTS_DIR, factsPath],
    [LEGACY_FACTS_DIR, legacyPath],
  ] as const) {
    if (existsSync(path) && !statSync(path).isDirectory()) {
      throw new LoadError(
        `workspace has a file named ${name}/ — expected a directory (D30): rename or remove it`,
      );
    }
  }
  const hasFacts = existsSync(factsPath);
  const hasLegacy = existsSync(legacyPath);
  if (hasFacts && hasLegacy) {
    throw new LoadError(
      `workspace has both ${FACTS_DIR}/ and ${LEGACY_FACTS_DIR}/ — ambiguous (D30): keep exactly one (run pasco migrate, or remove the leftover directory)`,
    );
  }
  return hasFacts ? FACTS_DIR : LEGACY_FACTS_DIR;
}

/** Read and merge every `<factsDir>/*.yaml` (or `*.yml`) of a workspace.
 *  File name = root property: `bios.yaml` contributes `{ bios: <list> }`,
 *  `identity.yaml` contributes `{ identity: <object> }`, … (schema/README.md
 *  mapping table). An empty file contributes nothing. */
function readFactsFiles(workspace: string): Record<string, unknown> {
  const dirName = factsDir(workspace);
  const dir = join(workspace, dirName);
  if (!existsSync(dir)) {
    throw new LoadError(
      `workspace has no ${dirName}/ directory: ${dir} (expected ${dirName}/*.yaml per schema/README.md)`,
    );
  }

  const files = readdirSync(dir)
    .filter((file) => /\.ya?ml$/i.test(file) && !file.startsWith("."))
    .sort();

  const merged: Record<string, unknown> = {};
  for (const file of files) {
    const rootKey = file.replace(/\.ya?ml$/i, "");
    const fullPath = join(dir, file);
    const doc = parseDocument(readFileSync(fullPath, "utf8"));
    if (doc.errors.length > 0) {
      throw new LoadError(
        `${dirName}/${file}: invalid YAML — ${doc.errors[0]?.message ?? "parse error"}`,
      );
    }
    const node = doc.toJS({ maxAliasCount: 100 });
    if (node === null || node === undefined) continue; // empty file → no contribution
    if (rootKey in merged) {
      throw new LoadError(
        `${dirName}/${file}: duplicate root property "${rootKey}" (already provided by another content file) — each root property belongs to exactly one file`,
      );
    }
    merged[rootKey] = node;
  }
  return merged;
}

/**
 * Load a profile-data workspace into a normalized, schema-valid Profile.
 *
 * @param workspace path to the workspace root (must contain the facts dir — D30)
 * @throws LoadError — workspace problems (missing facts dir, YAML errors, duplicate root keys)
 * @throws SchemaValidationError — merged profile violates the contract (D12: fail on schema),
 *   including the post-Zod ledger integrity checks (D18 §19: duplicate ids, ambiguous
 *   composite keys when addressed, ledger key pattern, surface enum — gen-zod drops
 *   `propertyNames`, so they cannot live in the generated schema) and the registry
 *   integrity checks (D17 §18: duplicate ids, dangling cross-refs, locator XOR).
 */
export function load(workspace: string): LoadedProfile {
  const merged = readFactsFiles(workspace);
  const profile = validateProfile(merged);
  const ledgerIssues = checkLedgerIntegrity(profile);
  if (ledgerIssues.length > 0) {
    throw new SchemaValidationError(ledgerIssues);
  }
  const registryIssues = checkRegistryIntegrity(profile);
  if (registryIssues.length > 0) {
    throw new SchemaValidationError(registryIssues);
  }
  const achievementIssues = checkAchievementIntegrity(profile);
  if (achievementIssues.length > 0) {
    throw new SchemaValidationError(achievementIssues);
  }
  return normalizeProfile(profile);
}
