/**
 * load(workspace) — parse `content/*.yaml` of a profile-data workspace, merge
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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { profileSchema } from './generated/schema.zod.js';
import type { LoadedProfile, Profile } from './types.js';

/** Workspace-level failure: missing/unreadable content dir, bad YAML, config error. */
export class LoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LoadError';
  }
}

/** The profile violates the contract schema → FAIL (D12). Carries every violation. */
export class SchemaValidationError extends LoadError {
  readonly issues: readonly { path: string; message: string }[];

  constructor(issues: readonly { path: string; message: string }[]) {
    super(
      `profile.schema.json validation failed (D12 fail-on-schema) — ${issues.length} violation(s):\n` +
        issues.map((i) => `  ${i.path || '<root>'}: ${i.message}`).join('\n'),
    );
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

/** Validate an arbitrary merged object against the generated Zod schema. Throws SchemaValidationError. */
export function validateProfile(value: unknown): Profile {
  const result = profileSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join('.') : '<root>',
      message: issue.message,
    }));
    throw new SchemaValidationError(issues);
  }
  return result.data;
}

/**
 * Normalize a validated profile: the contract makes most root collections optional,
 * but consumers (drift/geo/compile) should never null-check. Returns the same data
 * with array properties defaulted to empty arrays.
 */
export function normalizeProfile(profile: Profile): LoadedProfile {
  return {
    ...profile,
    bios: profile.bios ?? [],
    headlines: profile.headlines ?? [],
    skills: profile.skills ?? [],
    experience: profile.experience ?? [],
    projects: profile.projects ?? [],
    publications: profile.publications ?? [],
    checks: profile.checks ?? [],
    education: profile.education ?? [],
    languages: profile.languages ?? [],
  };
}

/** Read and merge every `content/*.yaml` (or `*.yml`) of a workspace.
 *  File name = root property: `bios.yaml` contributes `{ bios: <list> }`,
 *  `identity.yaml` contributes `{ identity: <object> }`, … (schema/README.md
 *  mapping table). An empty file contributes nothing. */
function readContentFiles(workspace: string): Record<string, unknown> {
  const contentDir = join(workspace, 'content');
  if (!existsSync(contentDir)) {
    throw new LoadError(`workspace has no content/ directory: ${contentDir} (expected content/*.yaml per schema/README.md)`);
  }

  const files = readdirSync(contentDir)
    .filter((file) => /\.ya?ml$/i.test(file) && !file.startsWith('.'))
    .sort();

  const merged: Record<string, unknown> = {};
  for (const file of files) {
    const rootKey = file.replace(/\.ya?ml$/i, '');
    const fullPath = join(contentDir, file);
    const doc = parseDocument(readFileSync(fullPath, 'utf8'));
    if (doc.errors.length > 0) {
      throw new LoadError(`content/${file}: invalid YAML — ${doc.errors[0]?.message ?? 'parse error'}`);
    }
    const node = doc.toJS({ maxAliasCount: 100 });
    if (node === null || node === undefined) continue; // empty file → no contribution
    if (rootKey in merged) {
      throw new LoadError(
        `content/${file}: duplicate root property "${rootKey}" (already provided by another content file) — each root property belongs to exactly one file`,
      );
    }
    merged[rootKey] = node;
  }
  return merged;
}

/**
 * Load a profile-data workspace into a normalized, schema-valid Profile.
 *
 * @param workspace path to the workspace root (must contain `content/`)
 * @throws LoadError — workspace problems (missing content dir, YAML errors, duplicate root keys)
 * @throws SchemaValidationError — merged profile violates the contract (D12: fail on schema)
 */
export function load(workspace: string): LoadedProfile {
  const merged = readContentFiles(workspace);
  const profile = validateProfile(merged);
  return normalizeProfile(profile);
}

