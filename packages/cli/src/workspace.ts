/**
 * Workspace resolution (D14): `pac` reads a user-brand-data workspace by
 * CONFIGURED PATH, never by copying or owning user data.
 *
 * Resolution order:
 *   1. `--workspace <path>` flag (explicit, wins).
 *   2. `.pacrc` found in the current directory — `workspace` field, resolved
 *      relative to the `.pacrc` file (so a .pacrc at the workspace root with
 *      `"workspace": "."` means the workspace root itself).
 *   3. The current directory.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface PacrcDefaults {
  lang?: 'en' | 'es' | 'fr';
  variants?: number;
}

export interface Pacrc {
  /** Workspace path relative to the .pacrc file location. */
  workspace?: string;
  defaults?: PacrcDefaults;
  diff?: { tagPattern?: string };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readPacrc(dir: string): { pacrc: Pacrc; pacrcPath: string } | null {
  const pacrcPath = join(dir, '.pacrc');
  if (!existsSync(pacrcPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(pacrcPath, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read ${pacrcPath}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${pacrcPath}: invalid JSON in .pacrc`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${pacrcPath}: .pacrc must be a JSON object`);
  }
  return { pacrc: parsed as Pacrc, pacrcPath };
}

/**
 * Resolve the workspace path for a command.
 *
 * @param cwd    process.cwd()
 * @param flag   the `--workspace` value, if given (resolved against cwd)
 */
export function resolveWorkspace(cwd: string, flag?: string): string {
  if (flag !== undefined) return resolve(cwd, flag);

  const found = readPacrc(cwd);
  if (found !== null && found.pacrc.workspace !== undefined) {
    // Relative to the .pacrc file, so a workspace in another directory works
    // and `"workspace": "."` at the workspace root works.
    return resolve(found.pacrcPath, found.pacrc.workspace);
  }
  return cwd;
}

/** Read .pacrc for the resolved workspace (defaults, diff config). Never throws for absence. */
export function readWorkspacePacrc(workspace: string): Pacrc {
  const found = readPacrc(workspace);
  return found?.pacrc ?? {};
}

export function defaultsLang(pacrc: Pacrc, requested?: string): 'en' | 'es' | 'fr' {
  if (requested !== undefined) return requested as 'en' | 'es' | 'fr';
  return pacrc.defaults?.lang ?? 'en';
}
