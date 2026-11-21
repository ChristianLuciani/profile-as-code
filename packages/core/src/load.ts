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
import { parse as parseToml } from "@iarna/toml";
import { parseDocument } from "yaml";
import { checkAchievementIntegrity, checkExperienceHighlightRefs } from "./achievements.js";
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

/** Read and merge every `<factsDir>/*.yaml`, `*.yml`, or `*.toml` of a workspace.
 *  File name = root property: `bios.yaml` contributes `{ bios: <list> }`,
 *  `identity.yaml` contributes `{ identity: <object> }`, … (schema/README.md
 *  mapping table). An empty file contributes nothing.
 *  TOML files are supported for user editing convenience (parsed via @iarna/toml). */

/** The ONE "is a fact file" predicate, shared by `load()` and the sync utilities
 *  (toml-sync.ts) so enumeration can never diverge: case-insensitive on purpose
 *  (`identity.Yml`, `identity.TOML` are fact files) and dotfiles excluded.
 *  Never re-express this as a glob brace pattern (`*.{toml,TOML}`) — braces only
 *  cover all-lower/all-upper and silently miss mixed case, and glob's `nocase`
 *  option is platform-dependent. */
export const FACT_FILE_RE = /\.(ya?ml|toml)$/i;
export function isFactFileName(name: string): boolean {
  return FACT_FILE_RE.test(name) && !name.startsWith(".");
}

function readFactsFiles(workspace: string): Record<string, unknown> {
  const dirName = factsDir(workspace);
  const dir = join(workspace, dirName);
  if (!existsSync(dir)) {
    throw new LoadError(
      `workspace has no ${dirName}/ directory: ${dir} (expected ${dirName}/*.{yaml,yml,toml} per schema/README.md)`,
    );
  }

  const files = readdirSync(dir).filter(isFactFileName).sort();

  // Priority order for file extensions: .yaml > .yml > .toml
  // This ensures backward compatibility while allowing TOML as an input format
  const extensionPriority = (file: string): number => {
    const lower = file.toLowerCase();
    if (lower.endsWith(".yaml")) return 3;
    if (lower.endsWith(".yml")) return 2;
    if (lower.endsWith(".toml")) return 1;
    return 0;
  };

  const merged: Record<string, unknown> = {};
  const loadedRoots = new Map<string, { file: string; priority: number }>();

  for (const file of files) {
    const rootKey = file.replace(/\.(ya?ml|toml)$/i, "");
    const fullPath = join(dir, file);
    const fileLower = file.toLowerCase();
    const priority = extensionPriority(file);

    // Check if we already loaded this root key
    const existing = loadedRoots.get(rootKey);
    if (existing) {
      const newIsYaml = fileLower.endsWith(".yaml") || fileLower.endsWith(".yml");
      const existingIsYaml =
        existing.file.toLowerCase().endsWith(".yaml") ||
        existing.file.toLowerCase().endsWith(".yml");
      // Same-format clash (.yaml + .yml, or .toml + .TOML): each root property
      // belongs to exactly one file — a hard error, never a silent skip.
      if (newIsYaml === existingIsYaml) {
        throw new LoadError(
          `${dirName}/${file}: duplicate root property "${rootKey}" (already provided by another content file) — each root property belongs to exactly one file`,
        );
      }
      // If we already have a YAML file and this is TOML, skip the TOML file
      if (existing.priority >= priority) {
        // Skip this file - we already have a higher or equal priority version
        // Warn if we're skipping a TOML file in favor of YAML
        if (
          fileLower.endsWith(".toml") &&
          (existing.file.toLowerCase().endsWith(".yaml") ||
            existing.file.toLowerCase().endsWith(".yml"))
        ) {
          console.warn(
            `Warning: ${dirName}/${file} is ignored because ${existing.file} already provides root property "${rootKey}" (YAML takes precedence); use \`pasco sync\` to keep files in sync`,
          );
        }
        continue;
      }
      // A higher-priority file replaces a lower-priority one: when a YAML file
      // wins over a TOML root, say so — the mirror of the skip warning above.
      if (
        (fileLower.endsWith(".yaml") || fileLower.endsWith(".yml")) &&
        existing.file.toLowerCase().endsWith(".toml")
      ) {
        console.warn(
          `Warning: ${dirName}/${existing.file} is ignored because ${file} also provides root property "${rootKey}" (YAML takes precedence); use \`pasco sync\` to keep files in sync`,
        );
      }
    }

    let node: unknown;
    if (fileLower.endsWith(".toml")) {
      node = parseToml(readFileSync(fullPath, "utf8"));
      // An empty TOML document parses to {} — like an empty YAML file (null),
      // it contributes nothing instead of injecting an empty root.
      if (
        node !== null &&
        typeof node === "object" &&
        !Array.isArray(node) &&
        Object.keys(node).length === 0
      ) {
        continue;
      }
    } else {
      const doc = parseDocument(readFileSync(fullPath, "utf8"));
      if (doc.errors.length > 0) {
        throw new LoadError(
          `${dirName}/${file}: invalid YAML — ${doc.errors[0]?.message ?? "parse error"}`,
        );
      }
      node = doc.toJS({ maxAliasCount: 100 });
    }
    if (node === null || node === undefined) continue; // empty file \u2192 no contribution

    // Store the loaded root with its priority
    loadedRoots.set(rootKey, { file, priority });
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
  const highlightRefIssues = checkExperienceHighlightRefs(profile);
  if (highlightRefIssues.length > 0) {
    throw new SchemaValidationError(highlightRefIssues);
  }
  return normalizeProfile(profile);
}
