/**
 * Skill path resolution — one home for "where is the platform skill?".
 *
 * The CLI is bundled to `packages/cli/dist/index.js`, so `import.meta.url` is
 * NOT `dist/commands/<file>.js`: a fixed `../../../../skills` resolves outside
 * the repo. Walk up from the bundle until a `skills/` directory appears (repo
 * dev flow), with `PASCO_SKILLS_DIR` as an explicit override. An npm install
 * that does not ship `skills/` gets `undefined` — the caller must say so, never
 * invent a path (issue #253).
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function skillsDir(): string | undefined {
  const override = process.env.PASCO_SKILLS_DIR;
  if (override !== undefined && override !== "" && existsSync(override)) return override;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "skills");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function skillFile(channel: string, file: string): string | undefined {
  const root = skillsDir();
  if (root === undefined) return undefined;
  const path = join(root, channel, file);
  return existsSync(path) ? path : undefined;
}
