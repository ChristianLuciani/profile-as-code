/**
 * D27 / schema v2.0 — the visibility default and the migration surface
 * (issue #498, S4a).
 *
 * `isPublicEntry` is the ONE §18.5 rule: only `public` leaves the workspace.
 * Since v2.0 an ABSENT field is private, so a pre-v2.0 workspace must run
 * `pasco migrate`; `missingVisibility` is the list that drives both the
 * migration and `pasco doctor --contract-delta`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compile,
  isPublicEntry,
  load,
  missingVisibility,
  needsVisibilityMigration,
  registryCheck,
} from "../src/index.js";
import type { Profile } from "../src/types.js";

function profile(overrides: Partial<Profile>): Profile {
  return { identity: { name: "Example" }, ...overrides } as Profile;
}

describe("the D27 visibility default (schema v2.0)", () => {
  it("only an explicit `public` is public — absent is private", () => {
    expect(isPublicEntry({ visibility: "public" })).toBe(true);
    expect(isPublicEntry({ visibility: "unlisted" })).toBe(false);
    expect(isPublicEntry({ visibility: "private" })).toBe(false);
    expect(isPublicEntry({})).toBe(false);
  });
});

describe("missingVisibility — the rows `pasco migrate` must make explicit", () => {
  it("reports every row in the four migration blocks, with its index and id", () => {
    const missing = missingVisibility(
      profile({
        credentials: [
          { id: "cred-public", kind: "certificate", title: "A", issuer: "B", visibility: "public" },
          { id: "cred-absent", kind: "award", title: "C", issuer: "D" },
        ],
        artifacts: [
          {
            id: "art-private",
            kind: "code",
            title: "E",
            locator: { url: "https://example.com" },
            visibility: "private",
          },
          { id: "art-absent", kind: "code", title: "F", locator: { url: "https://example.com/f" } },
        ],
        projects: [
          { id: "proj-absent", name: "G" },
          { id: "proj-public", name: "H", visibility: "public" },
        ],
        experience: [
          { id: "exp-absent", role: "Engineer", org: "I", start: "2024-01-01" },
          {
            id: "exp-unlisted",
            role: "Advisor",
            org: "J",
            start: "2023-01-01",
            visibility: "unlisted",
          },
        ],
      }),
    );
    expect(missing).toEqual([
      { block: "credentials", index: 1, id: "cred-absent" },
      { block: "artifacts", index: 1, id: "art-absent" },
      { block: "projects", index: 0, id: "proj-absent" },
      { block: "experience", index: 0, id: "exp-absent" },
    ]);
  });

  it("is empty when every row declares a value (the migrated state)", () => {
    const migrated = profile({
      credentials: [
        { id: "c", kind: "certificate", title: "A", issuer: "B", visibility: "public" },
      ],
      artifacts: [
        {
          id: "a",
          kind: "code",
          title: "C",
          locator: { url: "https://example.com" },
          visibility: "public",
        },
      ],
      projects: [{ id: "p", name: "D", visibility: "public" }],
      experience: [
        { id: "e", role: "Engineer", org: "F", start: "2024-01-01", visibility: "private" },
      ],
    });
    expect(missingVisibility(migrated)).toEqual([]);
    expect(needsVisibilityMigration(migrated)).toBe(false);
  });

  it("never reports achievements — its visibility is required, not migrated", () => {
    const withAchievements = profile({
      achievements: [
        {
          id: "ach",
          statement: { en: "Shipped it" },
          kind: "milestone",
          basis: "reported",
          visibility: "private",
        },
      ],
    });
    expect(missingVisibility(withAchievements)).toEqual([]);
  });
});

const tempDirs: string[] = [];
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-visibility-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "content"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, "content", name), text);
  }
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("D27 — private rows never reach a compiled renderer slice", () => {
  it("compile() filters projects and experience by visibility", () => {
    const dir = workspace({
      "identity.yaml": "name: Example\n",
      "experience.yaml":
        "- id: pub-exp\n  role: Engineer\n  org: A\n  start: 2024-01-01\n  visibility: public\n" +
        "- id: priv-exp\n  role: Advisor\n  org: B\n  start: 2023-01-01\n",
      "projects.yaml":
        "- id: pub-proj\n  name: Public\n  visibility: public\n" +
        "- id: priv-proj\n  name: Private\n",
    });
    const slice = compile(load(dir), "github-readme", "en");
    expect(slice.experience.map((entry) => entry.id)).toEqual(["pub-exp"]);
    expect(slice.projects.map((project) => project.id)).toEqual(["pub-proj"]);
  });
});

describe("D27 — the leak check follows the PROJECT's own visibility", () => {
  const registry = {
    "identity.yaml": "name: Example\n",
    "credentials.yaml":
      "- id: private-cred\n  kind: award\n  title: Internal award\n  issuer: Example\n  visibility: private\n",
    "artifacts.yaml":
      "- id: private-art\n  kind: code\n  title: Internal code\n  locator:\n    url: https://example.com/code\n  visibility: private\n",
  };

  it("does not flag a private project that references private registry rows", () => {
    const dir = workspace({
      ...registry,
      "projects.yaml":
        "- id: internal\n  name: Internal project\n  visibility: private\n  artifactRefs:\n    - private-art\n  evidence:\n    - claim:\n        en: Internal proof\n      source: https://example.com/proof\n      artifactId: private-art\n",
    });
    const findings = registryCheck(load(dir)).filter(
      (finding) => finding.code === "check/private-in-public-output",
    );
    expect(findings).toEqual([]);
  });

  it("still flags a PUBLIC project that references private registry rows", () => {
    const dir = workspace({
      ...registry,
      "projects.yaml":
        "- id: public\n  name: Public project\n  visibility: public\n  artifactRefs:\n    - private-art\n",
    });
    const findings = registryCheck(load(dir)).filter(
      (finding) => finding.code === "check/private-in-public-output",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.path).toContain("projects[0].artifactRefs");
  });
});
