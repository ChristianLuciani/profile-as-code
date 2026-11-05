/**
 * The two-axis rule has ONE home and every platform skill cites it (#462).
 *
 * SPEC §21.8 states the norm: facts are one and identical across surfaces,
 * narrative is per surface. The rule itself is defined once, in
 * `skills/FACTS-VS-NARRATIVE.md`; a skill may keep its platform's own gold rule
 * but may not present a second definition nor contradict the shared one — and
 * since "may not contradict" is not mechanizable, the enforceable half is the
 * POINTER: every `SKILL.md` links the shared statement, which is what makes a
 * missing or divergent citation a red test instead of a review best-effort.
 *
 * The class this closes: the norm was declared in the SPEC while the skills tree
 * could silently grow a skill that never cites it (the failure that let
 * `linkedin`/`x` ship with no strategy file at all).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, "..", "..", "..");
const SKILLS_DIR = join(REPO_DIR, "skills");
const SHARED = join(SKILLS_DIR, "FACTS-VS-NARRATIVE.md");
const POINTER = "../FACTS-VS-NARRATIVE.md";

interface SkillDoc {
  platform: string;
  text: string;
}

function skillDocs(): SkillDoc[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ platform: entry.name, path: join(SKILLS_DIR, entry.name, "SKILL.md") }))
    .filter(({ path }) => existsSync(path))
    .map(({ platform, path }) => ({ platform, text: readFileSync(path, "utf8") }));
}

describe("the two-axis rule has one home and every skill cites it (#462)", () => {
  it("the shared statement exists and is the normative one", () => {
    expect(existsSync(SHARED), "skills/FACTS-VS-NARRATIVE.md must exist").toBe(true);
    const text = readFileSync(SHARED, "utf8");
    expect(text).toContain("SPEC §21.8");
    // The advisory instrument it describes is the one `pasco check` ships.
    expect(text).toContain("text/same-across-platforms");
    // The two axes and the order rule — the sentence a copying agent needs.
    expect(text).toMatch(/order/i);
    expect(text).toContain("identity.definition");
  });

  it("every platform skill links the shared statement", () => {
    const docs = skillDocs();
    expect(docs.length).toBeGreaterThan(0);
    for (const { platform, text } of docs) {
      expect(text, `${platform}/SKILL.md must cite ${POINTER}`).toContain(POINTER);
    }
  });

  it("no channel directory ships without a SKILL.md", () => {
    // `skillDocs()` filters by existence, so a `skills/<new>/post.md` with no
    // strategy file would slip through — exactly the state #462 fixed. The
    // inventory is the assertion: every channel directory is in the cited set.
    const channels = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const cited = new Set(skillDocs().map(({ platform }) => platform));
    expect(channels.filter((channel) => !cited.has(channel))).toEqual([]);
  });

  it("carries the two channels this issue named", () => {
    const platforms = skillDocs().map(({ platform }) => platform);
    expect(platforms).toContain("linkedin");
    expect(platforms).toContain("x");
  });

  it("no skill redefines the rule: a skill cites it, or it is the shared file", () => {
    // A second full definition is the drift this test exists to prevent; the
    // pointer plus a platform gold rule is the allowed shape. A heading that
    // claims to define BOTH axes inside a SKILL.md is the tell.
    for (const { platform, text } of skillDocs()) {
      expect(text, `${platform}/SKILL.md must not define the two axes itself`).not.toMatch(
        /^##\s+Facts are unique.{0,40}narrative is per surface/m,
      );
    }
  });
});
