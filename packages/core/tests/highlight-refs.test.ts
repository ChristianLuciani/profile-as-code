/**
 * D31 (#529) — `experience[].highlightRefs`: the highlights channel gains an
 * explicit `block:id` pointer per row, resolved by core with the exact
 * `achievements[].refs` grammar (same block table, same pattern):
 *
 *   - a dangling `highlightRefs[]` entry fails `load` (same class as
 *     `artifactRefs`), naming row + field + index;
 *   - a PUBLIC experience row pointing at a private/unlisted entry is the §18.5
 *     leak, the same rule `achievements[].refs` answers to;
 *   - the field is additive: a workspace without it loads unchanged.
 *
 * The claim findings (`claim-against-unbuilt` / `claim-without-proof`) are
 * `pasco audit` classes and are tested in packages/cli/tests/audit.test.ts.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { load, SchemaValidationError } from "../src/index.js";

function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-highlight-refs-"));
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "identity.yaml"), "name: Someone\n", "utf8");
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(content, name), body, "utf8");
  }
  return dir;
}

function loadFails(files: Record<string, string>): SchemaValidationError {
  const dir = makeWorkspace(files);
  try {
    expect(() => load(dir)).toThrow(SchemaValidationError);
    try {
      load(dir);
    } catch (err) {
      return err as SchemaValidationError;
    }
    throw new Error("unreachable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function loads(files: Record<string, string>): void {
  const dir = makeWorkspace(files);
  try {
    load(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const EXPERIENCE_WITH_REFS = `
- id: exp-x
  role: Consultant
  org: Independent
  start: 2024-01-01
  highlights:
    en: SaaS architecture for clinical management (see CLAPPS.AI).
  highlightRefs: ["projects:proj-clapps"]
  visibility: public
`;

describe("checkExperienceHighlightRefs — load fails on contract violations (D31)", () => {
  it("a dangling highlightRefs entry fails load, naming row, field and index", () => {
    const err = loadFails({
      "experience.yaml": `
- id: exp-x
  role: Consultant
  org: Independent
  start: 2024-01-01
  highlights:
    en: Something.
  highlightRefs: ["projects:nope"]
  visibility: public
`,
    });
    expect(err.issues[0]?.path).toBe("experience[0].highlightRefs[0]");
    expect(err.issues[0]?.message).toContain('"nope"');
    expect(err.issues[0]?.message).toContain("dangling cross-ref");
  });

  it("a public experience row highlighting a private project is the §18.5 leak", () => {
    const err = loadFails({
      "experience.yaml": EXPERIENCE_WITH_REFS,
      "projects.yaml": `
- id: proj-clapps
  name: CLAPPS.AI
  status: planning
  description:
    en: Clinical management.
`,
    });
    expect(err.issues[0]?.path).toBe("experience[0].highlightRefs[0]");
    expect(err.issues[0]?.message).toContain('"private"');
    expect(err.issues[0]?.message).toContain("public output renders only public entries");
  });

  it("a public experience highlighting a public project loads", () => {
    loads({
      "experience.yaml": EXPERIENCE_WITH_REFS,
      "projects.yaml": `
- id: proj-clapps
  name: CLAPPS.AI
  status: active
  description:
    en: Clinical management.
  evidence:
    - claim:
        en: 10k clinics onboard.
      source: https://example.com/metrics
  visibility: public
`,
    });
  });

  it("a workspace without highlightRefs loads unchanged (additive)", () => {
    loads({
      "experience.yaml": `
- role: Senior AI Engineer
  org: Nimbus Labs
  start: 2022-03-01
  highlights:
    en: Lead the sovereign inference stack.
  visibility: public
`,
    });
  });
});
