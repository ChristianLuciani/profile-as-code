/**
 * D24 — the career impact log (issue #446, SPEC §23).
 *
 * Behavior under test:
 *   - `achievementStatus()` is the ONE derivation: `planned` (a target with no
 *     value) · `measured` (a value with no goal) · `achieved` (both numbers, the
 *     direction is met) · `partial` (both numbers, goal missed) · a milestone has
 *     no status · a metric with neither number has none either. `direction` is
 *     OPTIONAL and absent means `increase` — declared, never inferred from the
 *     baseline.
 *   - `achievementScope()` counts per status; a milestone lands in `total` only.
 *   - `achievements[]` is additive: a workspace without it loads with an empty
 *     list.
 *   - the post-Zod integrity checks fail `load`: duplicate ids, dangling
 *     `refs`/`artifactId`/`credentialId`, the `kind` ↔ `metric` invariant and the
 *     §18.5 leak (a PUBLIC achievement pointing at a private credential or
 *     artifact, including through `refs[]`).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Achievement } from "../src/index.js";
import {
  achievementScope,
  achievementStatus,
  DEFAULT_ACHIEVEMENT_DIRECTION,
  load,
  SchemaValidationError,
} from "../src/index.js";

const MINIMAL = new URL("./fixtures/minimal/", import.meta.url).pathname;
const ACHIEVEMENTS = new URL("./fixtures/achievements/", import.meta.url).pathname;

/** A row with only the fields the status derivation reads. */
function row(
  fields: Partial<Achievement> & Pick<Achievement, "kind" | "basis" | "visibility">,
): Achievement {
  return {
    id: "ach-x",
    statement: { en: "A result" },
    ...fields,
  } as Achievement;
}

describe("achievementStatus — the derived status (table-driven)", () => {
  it("a target with no value is PLANNED", () => {
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "estimated",
          visibility: "public",
          metric: { target: 100, unit: "tutors" },
        }),
      ),
    ).toBe("planned");
  });

  it("a value with no target is MEASURED", () => {
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "reported",
          visibility: "public",
          metric: { value: 36, unit: "tutors" },
        }),
      ),
    ).toBe("measured");
  });

  it("both numbers with no declared direction default to INCREASE (declared, not inferred)", () => {
    expect(DEFAULT_ACHIEVEMENT_DIRECTION).toBe("increase");
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "reported",
          visibility: "public",
          metric: { value: 5, target: 5, unit: "x" },
        }),
      ),
    ).toBe("achieved");
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "reported",
          visibility: "public",
          metric: { value: 4, target: 5, unit: "x" },
        }),
      ),
    ).toBe("partial");
  });

  it("increase: value >= target is ACHIEVED, below is PARTIAL", () => {
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "reported",
          visibility: "public",
          metric: { value: 6, target: 5, unit: "x", direction: "increase" },
        }),
      ),
    ).toBe("achieved");
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "reported",
          visibility: "public",
          metric: { value: 4, target: 5, unit: "x", direction: "increase" },
        }),
      ),
    ).toBe("partial");
  });

  it("decrease: value <= target is ACHIEVED, above is PARTIAL", () => {
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "reported",
          visibility: "public",
          metric: { value: 4, target: 5, unit: "h", direction: "decrease" },
        }),
      ),
    ).toBe("achieved");
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "reported",
          visibility: "public",
          metric: { value: 6, target: 5, unit: "h", direction: "decrease" },
        }),
      ),
    ).toBe("partial");
  });

  it("maintain: only an exact match is ACHIEVED", () => {
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "reported",
          visibility: "public",
          metric: { value: 5, target: 5, unit: "x", direction: "maintain" },
        }),
      ),
    ).toBe("achieved");
    expect(
      achievementStatus(
        row({
          kind: "metric",
          basis: "reported",
          visibility: "public",
          metric: { value: 6, target: 5, unit: "x", direction: "maintain" },
        }),
      ),
    ).toBe("partial");
  });

  it("a milestone has NO status (a point event has no progress)", () => {
    expect(
      achievementStatus(row({ kind: "milestone", basis: "attested", visibility: "public" })),
    ).toBeUndefined();
  });

  it("a metric that declares neither value nor target has no status", () => {
    expect(
      achievementStatus(
        row({ kind: "metric", basis: "reported", visibility: "public", metric: { unit: "x" } }),
      ),
    ).toBeUndefined();
  });
});

describe("achievementScope — counters per derived status", () => {
  it("counts the fixture log and never buckets a milestone", () => {
    const profile = load(ACHIEVEMENTS);
    expect(profile.achievements).toHaveLength(4);
    expect(achievementScope(profile.achievements)).toEqual({
      total: 4,
      planned: 1,
      measured: 1,
      achieved: 1,
      partial: 0,
    });
  });
});

/** A throwaway workspace with the given content files. */
function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-achievements-"));
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

describe("achievements[] — additive contract", () => {
  it("a workspace without achievements[] loads with an empty list", () => {
    expect(load(MINIMAL).achievements).toEqual([]);
  });
});

describe("checkAchievementIntegrity — load fails on contract violations", () => {
  it("duplicate achievement ids", () => {
    const err = loadFails({
      "achievements.yaml": `
- id: ach-dup
  statement: { en: One }
  kind: milestone
  basis: reported
  visibility: private
- id: ach-dup
  statement: { en: Two }
  kind: milestone
  basis: reported
  visibility: private
`,
    });
    expect(err.issues.map((i) => i.path)).toContain("achievements[1].id");
  });

  it("a dangling refs[] entry", () => {
    const err = loadFails({
      "achievements.yaml": `
- id: ach-x
  statement: { en: One }
  kind: milestone
  refs: ["experience:nope"]
  basis: reported
  visibility: private
`,
    });
    expect(err.issues[0]?.path).toBe("achievements[0].refs[0]");
    expect(err.issues[0]?.message).toContain('"nope"');
  });

  it("a dangling artifactId and credentialId", () => {
    const err = loadFails({
      "achievements.yaml": `
- id: ach-x
  statement: { en: One }
  kind: milestone
  artifactId: art-nope
  credentialId: cred-nope
  basis: attested
  visibility: private
`,
    });
    expect(err.issues.map((i) => i.path)).toEqual([
      "achievements[0].credentialId",
      "achievements[0].artifactId",
    ]);
  });

  it("kind: metric without a metric block", () => {
    const err = loadFails({
      "achievements.yaml": `
- id: ach-x
  statement: { en: One }
  kind: metric
  basis: reported
  visibility: private
`,
    });
    expect(err.issues[0]?.path).toBe("achievements[0].metric");
  });

  it("kind: milestone WITH a metric block", () => {
    const err = loadFails({
      "achievements.yaml": `
- id: ach-x
  statement: { en: One }
  kind: milestone
  metric: { value: 1, unit: "x" }
  basis: reported
  visibility: private
`,
    });
    expect(err.issues[0]?.path).toBe("achievements[0].metric");
    expect(err.issues[0]?.message).toContain("must NOT carry");
  });

  it("a PUBLIC achievement attesting a PRIVATE credential (§18.5 leak)", () => {
    const err = loadFails({
      "credentials.yaml": `
- id: cred-private
  kind: award
  title: Internal award
  issuer: Acme
  visibility: private
`,
      "achievements.yaml": `
- id: ach-x
  statement: { en: One }
  kind: milestone
  credentialId: cred-private
  basis: attested
  visibility: public
`,
    });
    expect(err.issues[0]?.path).toBe("achievements[0].credentialId");
    expect(err.issues[0]?.message).toContain("§18.5");
  });

  it("a PUBLIC achievement reaching a private credential through refs[] is the same leak", () => {
    const err = loadFails({
      "credentials.yaml": `
- id: cred-private
  kind: award
  title: Internal award
  issuer: Acme
  visibility: private
`,
      "achievements.yaml": `
- id: ach-x
  statement: { en: One }
  kind: milestone
  refs: ["credentials:cred-private"]
  basis: reported
  visibility: public
`,
    });
    expect(err.issues[0]?.path).toBe("achievements[0].refs[0]");
  });

  it("a PRIVATE achievement may point at a private credential (no leak)", () => {
    const dir = makeWorkspace({
      "credentials.yaml": `
- id: cred-private
  kind: award
  title: Internal award
  issuer: Acme
  visibility: private
`,
      "achievements.yaml": `
- id: ach-x
  statement: { en: One }
  kind: milestone
  credentialId: cred-private
  basis: attested
  visibility: private
`,
    });
    try {
      const profile = load(dir);
      expect(profile.achievements[0]?.credentialId).toBe("cred-private");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
