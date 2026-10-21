/**
 * Skill path resolution — one home for "where is the platform skill?".
 *
 * The CLI is bundled to `packages/cli/dist/index.js`, so the installed package
 * carries its skills at `<pkg>/skills/` — the primary probe (issue #253). A
 * repo checkout is the second probe: walk up from the bundle until a `skills/`
 * directory appears (repo dev flow), with `PASCO_SKILLS_DIR` as an explicit
 * override. An install that does not ship `skills/` gets `undefined` — the
 * caller must say so, never invent a path, and never reference a repo the
 * reader cannot open (#254).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function skillsDir(): string | undefined {
  const override = process.env.PASCO_SKILLS_DIR;
  if (override !== undefined && override !== "" && isDirectory(override)) return override;

  const here = dirname(fileURLToPath(import.meta.url)); // <pkg>/dist when bundled
  const shipped = join(here, "..", "skills"); // <pkg>/skills — what npm ships
  if (isDirectory(shipped)) return shipped;

  let dir = here;
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "skills");
    if (isDirectory(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/** Every channel directory the skills tree carries (SKILL.md channel + post-only channels). */
export function listChannels(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Platform ids whose directory carries `file`, sorted. */
export function listSkills(root: string, file = "SKILL.md"): string[] {
  return listChannels(root).filter((channel) => existsSync(join(root, channel, file)));
}

export function skillFile(channel: string, file: string): string | undefined {
  const root = skillsDir();
  if (root === undefined) return undefined;
  const path = join(root, channel, file);
  return existsSync(path) ? path : undefined;
}

export const NOT_SHIPPED_MESSAGE =
  "skills not shipped with this package — this build carries no skills/; report it at https://github.com/ChristianLuciani/profile-as-code/issues";

export type SkillLookup =
  | { state: "found"; path: string; root: string }
  | { state: "no-skill"; channel: string; root: string; shipped: string[] }
  | { state: "not-shipped" };

/**
 * Resolve one channel's skill file. The three states are intentionally
 * distinct: "found", "this channel has no skill yet", and "this package ships
 * none" — the ambiguity #253 reported.
 */
export function lookupSkill(channel: string, file = "SKILL.md"): SkillLookup {
  const root = skillsDir();
  if (root === undefined) return { state: "not-shipped" };
  const path = join(root, channel, file);
  if (existsSync(path)) return { state: "found", path, root };
  return { state: "no-skill", channel, root, shipped: listSkills(root, file) };
}

/** Human/agent line for the refine task template. */
export function skillLine(lookup: SkillLookup): string {
  if (lookup.state === "found") return lookup.path;
  if (lookup.state === "not-shipped") return NOT_SHIPPED_MESSAGE;
  return `no skill for ${lookup.channel} yet — this package ships: ${lookup.shipped.join(", ")}; fall back to the deterministic renderer output (the platform's limits are not encoded yet)`;
}
