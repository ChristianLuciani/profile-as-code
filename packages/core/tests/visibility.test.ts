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
  notPublishableKeys,
  publicProjection,
  registryCheck,
  SchemaValidationError,
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

describe("D27 — selection sees only the rows the artifact can emit", () => {
  it("lets a view exclude a row that visibility now hides (the excludeKey still resolves)", () => {
    const dir = workspace({
      "identity.yaml": "name: Example\n",
      "projects.yaml":
        "- id: secret\n  name: Secret\n" + "- id: pub\n  name: Public\n  visibility: public\n",
    });
    const slice = compile(load(dir), "github-readme", "en", {
      selection: {
        views: { "github-readme": { excludeKeys: ["projects:secret"] } },
      },
    });
    expect(slice.projects.map((project) => project.id)).toEqual(["pub"]);
    expect(slice.selection?.selected.projects).toBe(1);
  });

  it("warns when visibility empties a view that selected rows", () => {
    const dir = workspace({
      "identity.yaml": "name: Example\n",
      "projects.yaml": "- id: secret\n  name: Secret\n",
    });
    const slice = compile(load(dir), "github-readme", "en", {
      selection: { views: { "github-readme": { mode: "all" } } },
    });
    expect(slice.projects).toEqual([]);
    expect(slice.selection?.selected.projects).toBe(0);
    expect(
      slice.selection?.findings.some((finding) => finding.code === "selection/empty-facts"),
    ).toBe(true);
  });

  it("does not count a private row in the SelectionReport", () => {
    const dir = workspace({
      "identity.yaml": "name: Example\n",
      "projects.yaml":
        "- id: pub-proj\n  name: Public\n  visibility: public\n" +
        "- id: priv-proj\n  name: Private\n",
    });
    const slice = compile(load(dir), "github-readme", "en", {
      selection: { views: { "github-readme": { mode: "all" } } },
    });
    expect(slice.projects.map((project) => project.id)).toEqual(["pub-proj"]);
    expect(slice.selection?.selected.projects).toBe(1);
  });
});

describe("D27 — the achievements leak gate names the effective value + remedy", () => {
  it("covers refs[] to private projects and experience too", () => {
    const dir = workspace({
      "identity.yaml": "name: Example\n",
      "projects.yaml": "- id: secret-proj\n  name: Secret project\n",
      "experience.yaml": "- id: secret-exp\n  role: Engineer\n  org: Secret\n  start: 2024-01-01\n",
      "achievements.yaml":
        "- id: ach\n  statement:\n    en: Shipped it\n  kind: milestone\n  basis: reported\n  visibility: public\n  refs:\n    - projects:secret-proj\n    - experience:secret-exp\n",
    });
    try {
      load(dir);
      throw new Error("load should have failed");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const messages = (err as SchemaValidationError).issues.map((issue) => issue.message);
      expect(messages.join("\n")).toContain('visibility "private"');
      expect(messages.join("\n")).toContain("projects");
      expect(messages.join("\n")).toContain("experience");
    }
  });

  it("reports `private` (never `undefined`) and points at pasco migrate", () => {
    const dir = workspace({
      "identity.yaml": "name: Example\n",
      "credentials.yaml":
        "- id: private-cred\n  kind: award\n  title: Internal award\n  issuer: Example\n",
      "achievements.yaml":
        "- id: ach\n  statement:\n    en: Shipped it\n  kind: milestone\n  basis: reported\n  visibility: public\n  credentialId: private-cred\n",
    });
    try {
      load(dir);
      throw new Error("load should have failed");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const message = (err as SchemaValidationError).issues[0]?.message ?? "";
      expect(message).toContain('visibility "private"');
      expect(message).not.toContain('visibility "undefined"');
      expect(message).toContain("pasco migrate");
    }
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

/** A workspace that exercises every part of the projection: the five blocks that
 *  carry visibility, the ledger records that address them, the release events and
 *  the variant choices. */
const PROJECTION_FILES: Record<string, string> = {
  "identity.yaml":
    "name: Example\nlinks:\n  - platform: github-readme\n    url: https://example.com\n",
  "credentials.yaml":
    "- id: pub-cred\n  kind: certificate\n  title: Public cert\n  issuer: Example\n  visibility: public\n" +
    "- id: private-cred\n  kind: award\n  title: Internal award\n  issuer: Example\n",
  "artifacts.yaml":
    "- id: pub-art\n  kind: code\n  title: Public code\n  locator:\n    url: https://example.com/pub\n  visibility: public\n" +
    "- id: private-art\n  kind: code\n  title: Internal code\n  locator:\n    url: https://example.com/priv\n",
  "projects.yaml":
    "- id: pub-proj\n  name: Public project\n  visibility: public\n" +
    "- id: secret-proj\n  name: Secret project\n",
  "experience.yaml":
    "- id: pub-exp\n  role: Engineer\n  org: A\n  start: 2024-01-01\n  visibility: public\n" +
    "- id: secret-exp\n  role: Advisor\n  org: B\n  start: 2023-01-01\n",
  "achievements.yaml":
    "- id: pub-ach\n  statement:\n    en: Shipped it\n  kind: milestone\n  basis: reported\n  visibility: public\n" +
    "- id: secret-ach\n  statement:\n    en: Internal result\n  kind: milestone\n  basis: reported\n  visibility: private\n",
  "deployments.yaml":
    'identity:\n  github-readme:\n    deployedAt: "2026-01-01T00:00:00Z"\n    contentHash: ' +
    "a".repeat(64) +
    "\n    source: git\n" +
    'projects:pub-proj:\n  github-readme:\n    deployedAt: "2026-01-01T00:00:00Z"\n    contentHash: ' +
    "b".repeat(64) +
    "\n    source: git\n" +
    'projects:secret-proj:\n  github-readme:\n    deployedAt: "2026-01-01T00:00:00Z"\n    contentHash: ' +
    "c".repeat(64) +
    "\n    source: git\n" +
    'experience:secret-exp:\n  github-readme:\n    deployedAt: "2026-01-01T00:00:00Z"\n    contentHash: ' +
    "d".repeat(64) +
    "\n    source: git\n",
  "releases.yaml":
    "- id: v-priv-only\n  version: 1.0.0\n  date: 2026-01-01\n  changedUnits: [projects:secret-proj]\n  surfaces: [github-readme]\n" +
    "- id: v-mixed\n  version: 1.1.0\n  date: 2026-01-02\n  changedUnits: [projects:pub-proj, projects:secret-proj]\n  surfaces: [github-readme]\n" +
    "- id: v-identity\n  version: 1.2.0\n  date: 2026-01-03\n  changedUnits: [identity]\n  surfaces: [github-readme]\n",
};

describe("D27 — publicProjection(): the projection is the ONE filter (SPEC §7.5)", () => {
  it("names the non-publishable ledger keys of the five visibility blocks", () => {
    const profile = load(workspace(PROJECTION_FILES));
    // `achievements` carries the field (required) but is never MIGRATED, so a
    // key filter that read the migration set missed it — and a release with
    // `changedUnits: [achievements:<private-id>]` survived the public view.
    expect([...notPublishableKeys(profile)].sort()).toEqual([
      "achievements:secret-ach",
      "artifacts:private-art",
      "credentials:private-cred",
      "experience:secret-exp",
      "projects:secret-proj",
    ]);
  });

  it("drops private/unlisted entries from every visibility block, keeps public rows", () => {
    const profile = load(workspace(PROJECTION_FILES));
    const projected = publicProjection(profile);
    expect(projected.credentials.map((row) => row.id)).toEqual(["pub-cred"]);
    expect(projected.artifacts.map((row) => row.id)).toEqual(["pub-art"]);
    expect(projected.projects.map((row) => row.id)).toEqual(["pub-proj"]);
    expect(projected.experience.map((row) => row.id)).toEqual(["pub-exp"]);
    expect(projected.achievements.map((row) => row.id)).toEqual(["pub-ach"]);
    // Blocks without the field pass through untouched.
    expect(projected.identity.name).toBe("Example");
    expect(projected.identity.links).toEqual(profile.identity.links);
  });

  it("filters the ledger to the records that address a publishable unit", () => {
    const profile = load(workspace(PROJECTION_FILES));
    const projected = publicProjection(profile);
    expect(Object.keys(projected.deployments).sort()).toEqual(["identity", "projects:pub-proj"]);
    // The source profile is untouched: the projection is a reading, not a mutation.
    expect(Object.keys(profile.deployments)).toContain("projects:secret-proj");
    expect(profile.projects).toHaveLength(2);
  });

  it("filters release changedUnits and omits a release with no public unit", () => {
    const profile = load(workspace(PROJECTION_FILES));
    const projected = publicProjection(profile);
    expect(projected.releases.map((release) => release.id)).toEqual(["v-mixed", "v-identity"]);
    expect(projected.releases[0]?.changedUnits).toEqual(["projects:pub-proj"]);
    expect(projected.releases[1]?.changedUnits).toEqual(["identity"]);
  });

  it("drops an inbound pointer to a removed registry row (no dangling join)", () => {
    const dir = workspace({
      "identity.yaml": "name: Example\n",
      "credentials.yaml":
        "- id: pub-cred\n  kind: certificate\n  title: Public cert\n  issuer: Example\n  visibility: public\n" +
        "- id: secret-cred\n  kind: award\n  title: Internal award\n  issuer: Example\n",
      "artifacts.yaml":
        "- id: pub-art\n  kind: code\n  title: Public code\n  locator:\n    url: https://example.com/pub\n  visibility: public\n" +
        "- id: secret-art\n  kind: code\n  title: Internal code\n  locator:\n    url: https://example.com/priv\n",
      "projects.yaml":
        "- id: pub-proj\n  name: Public project\n  visibility: public\n  artifactRefs:\n    - pub-art\n    - secret-art\n" +
        "  evidence:\n    - claim:\n        en: Public proof\n      source: https://example.com/proof\n      credentialId: secret-cred\n      artifactId: secret-art\n",
      "publications.yaml":
        "- title: Public paper\n  venue: Venue\n  year: 2024\n  artifactRefs:\n    - secret-art\n",
      "press.yaml":
        "- outlet: Outlet\n  title:\n    en: Public mention\n  url: https://example.com/press\n  date: 2024-01-01\n  artifactRefs:\n    - secret-art\n",
    });
    const profile = load(dir);
    const projected = publicProjection(profile);
    expect(projected.artifacts.map((row) => row.id)).toEqual(["pub-art"]);
    expect(projected.projects[0]?.artifactRefs).toEqual(["pub-art"]);
    const evidence = projected.projects[0]?.evidence?.[0];
    // The CLAIM survives; only the pointers to a hidden row are dropped.
    expect(evidence?.claim.en).toBe("Public proof");
    expect(evidence?.credentialId).toBeUndefined();
    expect(evidence?.artifactId).toBeUndefined();
    expect(projected.publications[0]?.artifactRefs).toEqual([]);
    expect(projected.press[0]?.artifactRefs).toEqual([]);
    // The SSOT keeps the declared pointers: the projection is a reading.
    expect(profile.projects[0]?.artifactRefs).toEqual(["pub-art", "secret-art"]);
  });

  it("keeps the roots present: a filtered list is [], never absent", () => {
    const dir = workspace({
      "identity.yaml": "name: Example\n",
      "projects.yaml": "- id: secret\n  name: Secret\n",
    });
    const projected = publicProjection(load(dir));
    expect(projected.projects).toEqual([]);
    expect(projected.experience).toEqual([]);
    expect(projected.releases).toEqual([]);
    expect(projected.deployments).toEqual({});
    expect(projected.identity.name).toBe("Example");
  });
});
