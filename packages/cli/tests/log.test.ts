/**
 * `pasco log` — the capture path's contract (D25/S2, issue #496, SPEC §23.6).
 *
 * The amendments of D27 are the point of this file:
 *   - on a metric only `--unit` is required; `target`-only is a plan and
 *     `value`-only a measurement;
 *   - a milestone carrying any metric flag is exit 2;
 *   - `--date` is optional and no clock is read (absent = undated);
 *   - visibility defaults to private and is printed.
 *
 * Every write test uses a throwaway workspace: the fixture is never mutated.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LoadError } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { appendAchievement, deriveAchievementId } from "../src/log-write.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");

const tempDirs: string[] = [];

function workspace(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-cli-log-"));
  tempDirs.push(dir);
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries({
    "identity.yaml": "name: Someone\n",
    ...files,
  })) {
    writeFileSync(join(content, name), body, "utf8");
  }
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

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
    file: string;
    created: boolean;
    id: string;
    visibility: string;
    row: { id: string; kind: string; status: string | null; date?: string; metric?: unknown };
    achievements?: { id: string; visibility?: string; status: string | null }[];
  };
  error?: { kind: string; message: string };
}

function json(result: RunResult): Envelope {
  return JSON.parse(result.stdout) as Envelope;
}

const BASE = ["log", "--statement", "Cut onboarding from 10 days to 3 days"];

describe("pasco log — the corrected metric contract (D27 amendment)", () => {
  it("target-only is a PLANNED goal: only --unit is required", () => {
    const dir = workspace();
    const result = run([
      ...BASE,
      "--kind",
      "metric",
      "--basis",
      "estimated",
      "--unit",
      "days",
      "--target",
      "3",
      "--date",
      "2026-11-07",
      "--json",
      "--workspace",
      dir,
    ]);
    expect(result.code).toBe(0);
    expect(json(result).data?.row.status).toBe("planned");
  });

  it("value-only is a MEASURED result: only --unit is required", () => {
    const dir = workspace();
    const result = run([
      ...BASE,
      "--kind",
      "metric",
      "--basis",
      "measured",
      "--unit",
      "days",
      "--value",
      "3",
      "--date",
      "2026-11-07",
      "--json",
      "--workspace",
      dir,
    ]);
    expect(result.code).toBe(0);
    expect(json(result).data?.row.status).toBe("measured");
  });

  it("a milestone with ANY metric flag is exit 2 and writes nothing", () => {
    const dir = workspace();
    for (const flag of [
      ["--unit", "days"],
      ["--value", "3"],
      ["--target", "3"],
      ["--baseline", "10"],
      ["--direction", "decrease"],
    ]) {
      const result = run([
        ...BASE,
        "--kind",
        "milestone",
        "--basis",
        "reported",
        ...flag,
        "--workspace",
        dir,
      ]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("milestone has no metric");
    }
    expect(existsSync(join(dir, "content", "achievements.yaml"))).toBe(false);
  });

  it("--basis is required (exit 2, no silent default)", () => {
    const dir = workspace();
    const result = run([...BASE, "--kind", "milestone", "--workspace", dir]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--basis is required");
    expect(existsSync(join(dir, "content", "achievements.yaml"))).toBe(false);
  });

  it("a malformed --date is exit 2 and writes nothing (no clock, no guess)", () => {
    const dir = workspace();
    const result = run([
      ...BASE,
      "--kind",
      "milestone",
      "--basis",
      "reported",
      "--date",
      "2026-02-30",
      "--workspace",
      dir,
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not a real calendar date");
  });
});

describe("pasco log — the written row", () => {
  it("defaults visibility to private, prints it and writes it (D27)", () => {
    const dir = workspace();
    const result = run([
      ...BASE,
      "--kind",
      "metric",
      "--basis",
      "reported",
      "--unit",
      "days",
      "--value",
      "3",
      "--json",
      "--workspace",
      dir,
    ]);
    expect(result.code).toBe(0);
    const envelope = json(result);
    expect(envelope.data?.visibility).toBe("private");
    expect(envelope.data?.created).toBe(true);
    expect(envelope.data?.row.date).toBeUndefined();
    const file = readFileSync(join(dir, "content", "achievements.yaml"), "utf8");
    expect(file).toContain("visibility: private");
    expect(file).not.toContain("date:");
    // The human view names the privacy decision instead of leaving it implicit.
    const human = run([
      "log",
      "--statement",
      "A second, distinct result",
      "--kind",
      "milestone",
      "--basis",
      "reported",
      "--workspace",
      dir,
    ]);
    expect(human.stdout).toContain("visibility: private");
    expect(human.stdout).toContain("D27");
  });

  it("the captured row appears in `pasco achievements` with its DERIVED status", () => {
    const dir = workspace();
    const wrote = run([
      ...BASE,
      "--kind",
      "metric",
      "--basis",
      "measured",
      "--unit",
      "days",
      "--value",
      "3",
      "--target",
      "3",
      "--direction",
      "decrease",
      "--date",
      "2026-11-07",
      "--json",
      "--workspace",
      dir,
    ]);
    expect(wrote.code).toBe(0);
    const view = run(["achievements", "--json", "--workspace", dir]);
    expect(view.code).toBe(0);
    const row = json(view).data?.achievements?.find(
      (entry) => entry.id === "ach-cut-onboarding-from-10-days-to-3-days-2026-11-07",
    );
    expect(row).toBeDefined();
    expect(row?.status).toBe("achieved");
  });

  it("--visibility public is written only when explicit", () => {
    const dir = workspace();
    const result = run([
      ...BASE,
      "--kind",
      "milestone",
      "--basis",
      "attested",
      "--visibility",
      "public",
      "--json",
      "--workspace",
      dir,
    ]);
    expect(result.code).toBe(0);
    expect(json(result).data?.visibility).toBe("public");
  });

  it("derives a deterministic id from the statement + date", () => {
    const dir = workspace();
    const args = [
      ...BASE,
      "--kind",
      "milestone",
      "--basis",
      "reported",
      "--date",
      "2026-11-07",
      "--json",
      "--workspace",
      dir,
    ];
    const first = json(run(args));
    expect(first.data?.id).toBe("ach-cut-onboarding-from-10-days-to-3-days-2026-11-07");
    const file = readFileSync(join(dir, "content", "achievements.yaml"), "utf8");
    // A second capture with the same identity is REFUSED, never an overwrite.
    const second = run(args);
    expect(second.code).toBe(1);
    expect(json(second).error?.message).toContain("already exists");
    expect(readFileSync(join(dir, "content", "achievements.yaml"), "utf8")).toBe(file);
  });

  it("refuses a declared --id collision (exit 1, nothing written)", () => {
    const dir = workspace({
      "achievements.yaml": `- id: ach-taken
  statement: { en: Already here }
  kind: milestone
  basis: reported
  visibility: private
`,
    });
    const bytes = readFileSync(join(dir, "content", "achievements.yaml"), "utf8");
    const result = run([
      ...BASE,
      "--kind",
      "milestone",
      "--basis",
      "reported",
      "--id",
      "ach-taken",
      "--workspace",
      dir,
    ]);
    expect(result.code).toBe(1);
    expect(readFileSync(join(dir, "content", "achievements.yaml"), "utf8")).toBe(bytes);
  });

  it("preserves the comments and layout of an existing file", () => {
    const commented = `# The impact log — hand-written comment survives.
- id: ach-old
  statement: { en: An older result } # inline comment survives
  kind: milestone
  basis: reported
  visibility: private

# trailing comment before the new row
`;
    const dir = workspace({ "achievements.yaml": commented });
    const result = run([...BASE, "--kind", "milestone", "--basis", "reported", "--workspace", dir]);
    expect(result.code).toBe(0);
    const file = readFileSync(join(dir, "content", "achievements.yaml"), "utf8");
    expect(file.startsWith(commented)).toBe(true);
    expect(file).toContain("statement: { en: An older result } # inline comment survives");
    expect(file).toContain("# trailing comment before the new row");
    expect(file).toContain("Cut onboarding from 10 days to 3 days");
    // and the workspace still loads, so the appended row is schema-valid
    const view = run(["achievements", "--json", "--workspace", dir]);
    expect(view.code).toBe(0);
    expect(json(view).data).toBeDefined();
  });

  it("accepts a repeated --ref and resolves it through load()", () => {
    const dir = workspace({
      "experience.yaml": `- id: exp-one
  role: Engineer
  org: One
  start: 2020-01-01
`,
    });
    const args = [
      ...BASE,
      "--kind",
      "metric",
      "--basis",
      "measured",
      "--unit",
      "days",
      "--value",
      "3",
      "--ref",
      "experience:exp-one",
      "--json",
      "--workspace",
      dir,
    ];
    const result = run(args);
    expect(result.code).toBe(0);
    const row = json(result).data?.row as { refs?: string[] } | undefined;
    expect(row?.refs).toEqual(["experience:exp-one"]);
  });

  it("a dangling --ref never reaches disk (invalid input leaves no file)", () => {
    const dir = workspace();
    const result = run([
      ...BASE,
      "--kind",
      "metric",
      "--basis",
      "measured",
      "--unit",
      "days",
      "--value",
      "3",
      "--ref",
      "projects:nope",
      "--workspace",
      dir,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('projects[].id "nope"');
    expect(existsSync(join(dir, "content", "achievements.yaml"))).toBe(false);
  });

  it("a flow-style root is refused with exit 1 (never re-serialized)", () => {
    const dir = workspace({
      "achievements.yaml": `[ { id: ach-flow, statement: { en: Flow }, kind: milestone, basis: reported, visibility: private } ]\n`,
    });
    const bytes = readFileSync(join(dir, "content", "achievements.yaml"), "utf8");
    const result = run([...BASE, "--kind", "milestone", "--basis", "reported", "--workspace", dir]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("FLOW style");
    expect(readFileSync(join(dir, "content", "achievements.yaml"), "utf8")).toBe(bytes);
  });
});

describe("pasco log — id derivation", () => {
  it("is deterministic and case/diacritic normalizing", () => {
    expect(deriveAchievementId("Redujo la conciliación de efectivo", "2021-05-31")).toBe(
      "ach-redujo-la-conciliacion-de-efectivo-2021-05-31",
    );
    expect(deriveAchievementId("Redujo la conciliación de efectivo", "2021-05-31")).toBe(
      deriveAchievementId("Redujo la conciliación de efectivo", "2021-05-31"),
    );
    expect(deriveAchievementId("No date here")).toBe("ach-no-date-here-undated");
  });

  it("falls back to a deterministic hash when the statement has no Latin slug", () => {
    const id = deriveAchievementId("削減時間", "2026-11-07");
    expect(id).toMatch(/^ach-[0-9a-f]{12}$/);
    expect(deriveAchievementId("削減時間", "2026-11-07")).toBe(id);
  });
});

describe("pasco log — atomicity", () => {
  it("an invalid resulting workspace leaves the original bytes and no temp file", () => {
    const dir = workspace({
      "achievements.yaml": `- id: ach-old
  statement: { en: Old }
  kind: milestone
  basis: reported
  visibility: private
`,
    });
    const file = join(dir, "content", "achievements.yaml");
    const before = readFileSync(file, "utf8");
    expect(() =>
      appendAchievement(
        {
          workspace: dir,
          row: {
            id: "ach-new",
            statement: { en: "New" },
            kind: "milestone",
            basis: "reported",
            visibility: "private",
          } as never,
        },
        {
          validate: () => {
            throw new LoadError("forced invalid");
          },
        },
      ),
    ).toThrow(LoadError);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readdirSync(join(dir, "content")).filter((name) => name.startsWith(".pasco-"))).toEqual(
      [],
    );
  });
});
