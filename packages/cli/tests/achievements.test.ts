/**
 * `pasco achievements [--targets] [--json]` — the D24 CLI contract (issue #446,
 * SPEC §23).
 *
 * The command is exercised through the BUILT binary (the cli.test.ts pattern):
 * the envelope shape, the grouping, the derived status and the read-only posture
 * are the contract. The fixture is the core `achievements` workspace, reused not
 * duplicated.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Achievement } from "@profile-as-code/core";
import { describe, expect, it } from "vitest";
import { formatMetric, groupByRef } from "../src/commands/achievements.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const ACHIEVEMENTS = join(__dirname, "..", "..", "core", "tests", "fixtures", "achievements");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 15_000 });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

interface Envelope {
  command: string;
  ok: boolean;
  exitCode: number;
  data?: {
    schemaVersion: string;
    scope: Record<string, number>;
    achievements: (Achievement & { status: string | null })[];
  };
  error?: { kind: string; message: string };
}

function json(result: RunResult): Envelope {
  return JSON.parse(result.stdout) as Envelope;
}

describe("formatMetric — the one metric formatter", () => {
  it("renders a declared delta with the unit on both sides", () => {
    expect(
      formatMetric({ value: 4, baseline: 72, target: 4, unit: "hours", direction: "decrease" }),
    ).toBe("72 hours → 4 hours (target 4 hours) · decrease");
  });

  it("renders a measurement with no goal as the bare number", () => {
    expect(formatMetric({ value: 36, unit: "tutors" })).toBe("36 tutors");
  });

  it("renders a goal with only a target", () => {
    expect(formatMetric({ target: 100, unit: "tutors" })).toBe("target 100 tutors");
  });

  it("never invents a delta without a baseline", () => {
    expect(formatMetric({ value: 4, unit: "hours" })).not.toContain("→");
  });
});

/** A throwaway workspace with an achievements file. */
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-cli-achievements-"));
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries({ "identity.yaml": "name: Someone\n", ...files })) {
    writeFileSync(join(content, name), body, "utf8");
  }
  return dir;
}

describe("pasco achievements --json", () => {
  it("emits the frozen schemaVersion, the scope counters and the DERIVED status", () => {
    const result = run(["achievements", "--json", "--workspace", ACHIEVEMENTS]);
    expect(result.code).toBe(0);
    const envelope = json(result);
    expect(envelope.command).toBe("achievements");
    expect(envelope.ok).toBe(true);
    expect(envelope.data?.schemaVersion).toBe("1");
    expect(envelope.data?.scope).toEqual({
      total: 4,
      planned: 1,
      measured: 1,
      achieved: 1,
      partial: 0,
      // ach-next-cohort declares no date: counted, never hidden (#497).
      undated: 1,
    });
    const rows = envelope.data?.achievements ?? [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("ach-reconcile-time")?.status).toBe("achieved");
    expect(byId.get("ach-tutors")?.status).toBe("measured");
    expect(byId.get("ach-next-cohort")?.status).toBe("planned");
    // A milestone has no status — null, never a fabricated bucket.
    expect(byId.get("ach-certified")?.status).toBeNull();
  });

  it("--targets emits only the planned rows (the goal view)", () => {
    const result = run(["achievements", "--targets", "--json", "--workspace", ACHIEVEMENTS]);
    expect(result.code).toBe(0);
    const envelope = json(result);
    expect(envelope.data?.achievements.map((row) => row.id)).toEqual(["ach-next-cohort"]);
    // `scope` counts the rows THIS view returned: an empty scope is "nothing
    // planned here", not a fabricated zero over a log that has rows.
    expect(envelope.data?.scope).toEqual({
      total: 1,
      planned: 1,
      measured: 0,
      achieved: 0,
      partial: 0,
      undated: 1,
    });
  });

  it("an empty log emits an empty scope, not an error", () => {
    const result = run(["achievements", "--json", "--workspace", MINIMAL]);
    expect(result.code).toBe(0);
    expect(json(result).data?.scope).toEqual({
      total: 0,
      planned: 0,
      measured: 0,
      achieved: 0,
      partial: 0,
      undated: 0,
    });
  });
});

/**
 * The retrieval by period (D25/S3, #497). The fixture is the same one the rest
 * of the file uses: four rows, one of them (ach-next-cohort) date-less, one
 * private (ach-reconcile-time, 2021-05-31) and one exactly on a boundary
 * (ach-certified, 2022-03-01).
 */
describe("pasco achievements --since/--until (D25/S3)", () => {
  it("filters by the fact date with BOTH boundaries inclusive", () => {
    const exact = run([
      "achievements",
      "--since",
      "2021-05-31",
      "--until",
      "2021-05-31",
      "--json",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(exact.code).toBe(0);
    expect(json(exact).data?.achievements.map((row) => row.id)).toEqual(["ach-reconcile-time"]);
    expect(json(exact).data?.scope).toEqual({
      total: 1,
      planned: 0,
      measured: 0,
      achieved: 1,
      partial: 0,
      // The date-less planned goal is declared, not dropped.
      undated: 1,
    });
  });

  it("accepts a one-sided range (--since alone / --until alone)", () => {
    const from = run([
      "achievements",
      "--since",
      "2022-01-01",
      "--json",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(from.code).toBe(0);
    expect(
      json(from)
        .data?.achievements.map((row) => row.id)
        .sort(),
    ).toEqual(["ach-certified", "ach-tutors"]);
    const until = run([
      "achievements",
      "--until",
      "2021-12-31",
      "--json",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(until.code).toBe(0);
    expect(json(until).data?.achievements.map((row) => row.id)).toEqual(["ach-reconcile-time"]);
  });

  it("the goal view returns undated goals inside a range and declares them", () => {
    const result = run([
      "achievements",
      "--targets",
      "--since",
      "2020-01-01",
      "--until",
      "2020-12-31",
      "--json",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(result.code).toBe(0);
    expect(json(result).data?.achievements.map((row) => row.id)).toEqual(["ach-next-cohort"]);
    expect(json(result).data?.scope).toEqual({
      total: 1,
      planned: 1,
      measured: 0,
      achieved: 0,
      partial: 0,
      undated: 1,
    });
  });

  it("never loses a date-less row in the log view: it is counted and said out loud", () => {
    const result = run([
      "achievements",
      "--since",
      "2020-01-01",
      "--until",
      "2020-12-31",
      "--json",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(result.code).toBe(0);
    expect(json(result).data?.achievements).toEqual([]);
    expect(json(result).data?.scope.undated).toBe(1);

    const human = run([
      "achievements",
      "--since",
      "2020-01-01",
      "--until",
      "2020-12-31",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("1 row(s) declare no `date`");
    expect(human.stdout).toContain("never hidden");
  });

  it("includes PRIVATE rows: retrieval is local, not the public projection (D27)", () => {
    const view = run(["achievements", "--json", "--workspace", ACHIEVEMENTS]);
    const row = json(view).data?.achievements.find((entry) => entry.id === "ach-reconcile-time");
    expect(row).toBeDefined();
    expect((row as { visibility?: string }).visibility).toBe("private");
    const ranged = run([
      "achievements",
      "--since",
      "2021-01-01",
      "--until",
      "2021-12-31",
      "--json",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(ranged.code).toBe(0);
    expect(json(ranged).data?.achievements.map((entry) => entry.id)).toEqual([
      "ach-reconcile-time",
    ]);
  });

  it("an invalid date or since > until is exit 2 (never an empty range)", () => {
    const malformed = run([
      "achievements",
      "--since",
      "2021-13-01",
      "--json",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(malformed.code).toBe(2);
    expect(json(malformed).error?.kind).toBe("usage");

    const backwards = run([
      "achievements",
      "--since",
      "2024-01-01",
      "--until",
      "2021-01-01",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(backwards.code).toBe(2);
    expect(backwards.stderr).toContain("is after");
  });

  it('keeps schemaVersion "1": undated is an additive key, not a breaking bump', () => {
    const result = run([
      "achievements",
      "--since",
      "2020-01-01",
      "--until",
      "2026-12-31",
      "--json",
      "--workspace",
      ACHIEVEMENTS,
    ]);
    expect(result.code).toBe(0);
    expect(json(result).data?.schemaVersion).toBe("1");
    expect(json(result).data?.scope.undated).toBeDefined();
  });
});

/**
 * F1 of the fresh review: a declared range that matches NOTHING is not an empty
 * log — the text must print the range and the count, and never the add-file hint.
 */
describe("pasco achievements — a range that matches nothing (F1)", () => {
  it("log view: prints 0 of N in the range, never 'the log is empty'", () => {
    const dir = workspace({
      "achievements.yaml": `- id: ach-old
  statement: { en: Old result }
  kind: milestone
  basis: reported
  date: 2024-01-01
  visibility: private
`,
    });
    const result = run([
      "achievements",
      "--since",
      "2020-01-01",
      "--until",
      "2020-12-31",
      "--workspace",
      dir,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("0 of 1 row(s) in 2020-01-01 … 2020-12-31 (inclusive)");
    expect(result.stdout).not.toContain("the log is empty");
    expect(result.stdout).not.toContain("Add facts/achievements.yaml");
  });

  it("goal view: prints 0 of N planned in the range, never 'the goal view is empty'", () => {
    const dir = workspace({
      "achievements.yaml": `- id: ach-plan
  statement: { en: A dated goal }
  kind: metric
  metric: { target: 10, unit: days }
  basis: estimated
  date: 2019-01-01
  visibility: private
`,
    });
    const result = run(["achievements", "--targets", "--since", "2020-01-01", "--workspace", dir]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("0 of 1 planned target(s) since 2020-01-01 (inclusive)");
    expect(result.stdout).not.toContain("the goal view is empty");
  });

  it("an EMPTY log with a declared range still says the log is empty (no '0 of 0')", () => {
    const result = run(["achievements", "--since", "2020-01-01", "--workspace", MINIMAL]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("the log is empty");
    expect(result.stdout).toContain("since 2020-01-01 (inclusive)");
    expect(result.stdout).toContain("Add facts/achievements.yaml");
    expect(result.stdout).not.toContain("0 of 0");
  });

  it("a one-sided range prints its own preposition, never 'in since/from'", () => {
    const since = run(["achievements", "--since", "2022-01-01", "--workspace", ACHIEVEMENTS]);
    expect(since.code).toBe(0);
    expect(since.stdout).toContain("row(s) since 2022-01-01 (inclusive)");
    expect(since.stdout).not.toContain("in since");
    const until = run(["achievements", "--until", "2021-12-31", "--workspace", ACHIEVEMENTS]);
    expect(until.code).toBe(0);
    expect(until.stdout).toContain("row(s) through 2021-12-31 (inclusive)");
    expect(until.stdout).not.toContain("in until");
  });
});

describe("pasco achievements — human view", () => {
  it("groups by the first ref, prints status · metric · basis · pointer", () => {
    const result = run(["achievements", "--workspace", ACHIEVEMENTS]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("experience:exp-auditor");
    expect(result.stdout).toContain("[achieved] Cut cash reconciliation from 72 h to 4 h");
    expect(result.stdout).toContain("basis: reported");
    expect(result.stdout).toContain("36 tutors");
    // A milestone reads as `[milestone]`, never as a status it does not have.
    expect(result.stdout).toContain("[milestone] Became an AWS Solutions Architect");
    expect(result.stdout).toContain("basis: attested");
  });

  it("names the extra refs of a multi-ref row once (`also:`), no duplicated groups", () => {
    const result = run(["achievements", "--workspace", ACHIEVEMENTS]);
    expect(result.stdout).toContain("[also: artifacts:art-portfolio]");
    expect(result.stdout.match(/experience:exp-auditor/g)?.length).toBe(1);
  });

  it("--targets prints the planned rows and says so", () => {
    const result = run(["achievements", "--targets", "--workspace", ACHIEVEMENTS]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("1 planned target(s)");
    expect(result.stdout).toContain("Reach 100 tutors in the next cohort");
    expect(result.stdout).not.toContain("Cut cash reconciliation");
  });

  it("is READ-ONLY: the workspace is byte-identical after the read", () => {
    const before = readdirSync(ACHIEVEMENTS, { recursive: true }).sort();
    const snapshot = join(ACHIEVEMENTS, "content", "achievements.yaml");
    const mtime = statSync(snapshot).mtimeMs;
    const bytes = readFileSync(snapshot, "utf8");
    const result = run(["achievements", "--json", "--workspace", ACHIEVEMENTS]);
    expect(result.code).toBe(0);
    expect(readdirSync(ACHIEVEMENTS, { recursive: true }).sort()).toEqual(before);
    expect(statSync(snapshot).mtimeMs).toBe(mtime);
    expect(readFileSync(snapshot, "utf8")).toBe(bytes);
  });
});

describe("pasco achievements — the status-less label names the KIND (F1)", () => {
  it("a metric that declares only a unit reads [metric], never [milestone]", () => {
    const dir = workspace({
      "achievements.yaml": `
- id: ach-unit-only
  statement: { en: A unit with no number }
  kind: metric
  metric: { unit: "tutors" }
  basis: reported
  visibility: private
`,
    });
    try {
      const human = run(["achievements", "--workspace", dir]);
      expect(human.code).toBe(0);
      expect(human.stdout).toContain("[metric] A unit with no number");
      expect(human.stdout).not.toContain("[milestone]");
      const envelope = json(run(["achievements", "--json", "--workspace", dir]));
      // No status to derive: null, and the kind is what names the row.
      expect(envelope.data?.achievements[0]?.status).toBeNull();
      expect(envelope.data?.achievements[0]?.kind).toBe("metric");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pasco achievements — refusals", () => {
  it("exit 1 with the violation path when a ref does not resolve (load fails)", () => {
    const dir = workspace({
      "achievements.yaml": `
- id: ach-x
  statement: { en: One }
  kind: milestone
  refs: ["projects:nope"]
  basis: reported
  visibility: private
`,
    });
    try {
      const result = run(["achievements", "--json", "--workspace", dir]);
      expect(result.code).toBe(1);
      const envelope = json(result);
      expect(envelope.ok).toBe(false);
      expect(envelope.error?.kind).toBe("load");
      expect(envelope.error?.message).toContain("achievements[0].refs[0]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown flag with a usage error (exit 2)", () => {
    const result = run(["achievements", "--nope"]);
    expect(result.code).toBe(2);
  });
});

describe("groupByRef", () => {
  const row = (id: string, refs?: string[]): Achievement =>
    ({
      id,
      statement: { en: id },
      kind: "milestone",
      basis: "reported",
      visibility: "private",
      ...(refs !== undefined ? { refs } : {}),
    }) as Achievement;

  it("orders groups alphabetically and puts Unattached last", () => {
    const groups = groupByRef([row("a"), row("b", ["projects:p"]), row("c", ["experience:e"])]);
    expect([...groups.keys()]).toEqual(["experience:e", "projects:p", "Unattached"]);
  });
});
