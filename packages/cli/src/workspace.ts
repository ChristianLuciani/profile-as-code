/**
 * Workspace resolution (D14): `pasco` reads a profile-data workspace by
 * CONFIGURED PATH, never by copying or owning user data.
 *
 * Resolution order:
 *   1. `--workspace <path>` flag (explicit, wins).
 *   2. `.pascorc` found in the current directory — `workspace` field, resolved
 *      relative to the `.pascorc` file (so a .pascorc at the workspace root with
 *      `"workspace": "."` means the workspace root itself).
 *   3. The current directory.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The workspace product name (SPEC §9 terminology) — the SSOT repo a user
 * owns with their professional facts. Single source for every user-facing
 * string that names the workspace (init templates, help text) — never
 * hardcoded per file.
 */
export const WORKSPACE_NAME = 'profile-data';

export interface PascorcDefaults {
  lang?: 'en' | 'es' | 'fr';
  variants?: number;
}

export interface Pascorc {
  /** Workspace path relative to the .pascorc file location. */
  workspace?: string;
  defaults?: PascorcDefaults;
  diff?: { tagPattern?: string };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readPascorc(dir: string): { pascorc: Pascorc; pascorcPath: string } | null {
  const pascorcPath = join(dir, '.pascorc');
  if (!existsSync(pascorcPath)) {
    // Migration guard (issue #38, sota-review round 2): a legacy `.pacrc` would be
    // silently ignored — its `workspace` path and defaults would vanish. Make the
    // stale state self-announcing instead of silent (poka-yoke).
    const legacy = join(dir, '.pacrc');
    if (existsSync(legacy)) {
      throw new ConfigError(
        `legacy .pacrc found at ${legacy} — rename it to .pascorc (the bin was renamed pac → pasco; issue #38)`,
      );
    }
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(pascorcPath, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read ${pascorcPath}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${pascorcPath}: invalid JSON in .pascorc`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${pascorcPath}: .pascorc must be a JSON object`);
  }
  return { pascorc: parsed as Pascorc, pascorcPath };
}

/**
 * Resolve the workspace path for a command.
 *
 * @param cwd    process.cwd()
 * @param flag   the `--workspace` value, if given (resolved against cwd)
 */
export function resolveWorkspace(cwd: string, flag?: string): string {
  if (flag !== undefined) return resolve(cwd, flag);

  const found = readPascorc(cwd);
  if (found !== null && found.pascorc.workspace !== undefined) {
    // Relative to the DIRECTORY that holds the .pascorc file (dirname), so a
    // workspace in another directory works and `"workspace": "."` at the
    // workspace root resolves to the workspace root itself.
    return resolve(dirname(found.pascorcPath), found.pascorc.workspace);
  }
  return cwd;
}

/** Read .pascorc for the resolved workspace (defaults, diff config). Never throws when no
 *  config file exists; throws with a migration hint when a legacy `.pacrc` is present. */
export function readWorkspacePascorc(workspace: string): Pascorc {
  const found = readPascorc(workspace);
  return found?.pascorc ?? {};
}

export function defaultsLang(pascorc: Pascorc, requested?: string): 'en' | 'es' | 'fr' {
  if (requested !== undefined) return requested as 'en' | 'es' | 'fr';
  return pascorc.defaults?.lang ?? 'en';
}
