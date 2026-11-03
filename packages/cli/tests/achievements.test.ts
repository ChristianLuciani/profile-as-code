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
    });
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
