/**
 * The cycle's rules have one written home (#389).
 *
 * A blind agent run reconstructed `fact-present`, the build source order and the
 * cap catalog by reading the bundled `dist` — 8.9 M cache reads in the strong
 * cell. They are contract behaviour, not implementation detail, so the package
 * README answers them without inventing a second copy of the rule.
 *
 * The guard is STRUCTURAL, because free prose was defeated four times: three
 * reviews rewrote the caps answer while keeping every token a token-level
 * assertion looked for, and one appended a false union claim beside a correct
 * quote. So the reference may contain only FOUR kinds of line — the heading, the
 * questions, quotes, and one enumerated pointer — and every quote must be a
 * verbatim clause of the SPEC §7 row that owns it. There is no free prose left to
 * contradict the contract, and a quote cannot survive a change to the clause.
 *
 * The behavioural case is the other half: the claim "no skill row reaches the
 * limit executor" is measured against the real CLI, with a control.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");
const REPO_DIR = join(PKG_DIR, "..", "..");
const README = readFileSync(join(PKG_DIR, "README.md"), "utf8");
const SPEC = readFileSync(join(REPO_DIR, "docs", "SPEC.md"), "utf8");
const CLI = join(PKG_DIR, "dist", "index.js");
const MINIMAL = join(REPO_DIR, "packages", "core", "tests", "fixtures", "minimal");

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 20_000 });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const norm = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The reference section, from its heading to the next `## ` heading. */
function referenceSection(): string {
  const heading = "## How the cycle resolves";
  const at = README.indexOf(heading);
  expect(at, "the package README must carry the reference section (#389)").toBeGreaterThanOrEqual(
    0,
  );
  // Exactly one: a second section with the same title could carry free prose
  // while the guard read only the first (pass 6, F1).
  expect(README.indexOf(heading, at + 1), "the reference section must be unique").toBe(-1);
  const next = README.indexOf("\n## ", at + 1);
  return README.slice(at, next < 0 ? undefined : next);
}

/** The §7 table row whose first cell starts with `command`. */
function specRow(command: string): string {
  const row = SPEC.split("\n").find((line) => line.startsWith(`| \`${command}`));
  expect(row, `SPEC §7 must keep its \`${command}\` row`).toBeDefined();
  return norm(row as string);
}

const POINTER =
  "Canonical home: [SPEC §7](https://github.com/ChristianLuciani/profile-as-code/blob/main/docs/SPEC.md#7-core-interfaces-deep-module).";

interface Answer {
  question: string;
  quotes: string[];
  pointer: string;
}

/** Parse the section into its three answers — the shape the guard enforces. */
function answers(): Answer[] {
  const parsed: Answer[] = [];
  let current: Answer | undefined;
  let block: string[] = [];
  const flush = (): void => {
    if (current !== undefined && block.length > 0) current.quotes.push(norm(block.join(" ")));
    block = [];
  };
  for (const raw of referenceSection().split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flush(); // a blank line closes a quote block
      continue;
    }
    if (line.startsWith(">")) {
      // A quote belongs to an answer, or it is unattributed prose wearing a `>`.
      expect(current, `a blockquote must follow a question, not float free: ${line}`).toBeDefined();
      block.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flush();
    if (line.startsWith("**") && line.endsWith("**")) {
      current = { question: line, quotes: [], pointer: "" };
      parsed.push(current);
      continue;
    }
    if (line.startsWith("Canonical home:")) {
      expect(current, "a pointer must follow an answer").toBeDefined();
      (current as Answer).pointer = line;
    }
  }
  flush();
  return parsed;
}

/**
 * The CLAUSE each answer may quote: a (row, start marker, end marker) window.
 *
 * Row membership was not enough — the union sentence lives in the same `pasco
 * check` row as the limit-executor clause, so "this row owns the answer" let it
 * through (pass 5, F1). The quote must equal the clause EXACTLY: derived here
 * from SPEC, so there is no second copy to keep in sync and no near-miss clause
 * that satisfies the check.
 */
interface Window {
  row: string;
  from: string;
  to: string;
}
const CLAUSES: Record<string, Window[]> = {
  "**What does `fact-present` compare?**": [
    { row: "fact-present", from: "**Symmetric**", to: "`contradiction`." },
    { row: "pasco check", from: "All are WARN", to: "never as OK" },
  ],
  "**In what order does `build` choose an artifact?**": [
    { row: "pasco build", from: "**The artifact source", to: "read the same tree." },
  ],
  "**Where do the per-platform character caps come from?**": [
    { row: "pasco check", from: "The **limit executor**", to: "reaches that executor." },
    { row: "pasco edit", from: "a platform with no sourced cap", to: "`--json`)" },
  ],
};

/** The exact clause a window selects, or a failure naming the marker that moved. */
function clauseOf(window: Window): string {
  const row = specRow(window.row);
  const start = row.indexOf(window.from);
  expect(
    start,
    `SPEC §7 \`${window.row}\` lost the marker "${window.from}"`,
  ).toBeGreaterThanOrEqual(0);
  const end = row.indexOf(window.to, start);
  expect(end, `SPEC §7 \`${window.row}\` lost the marker "${window.to}"`).toBeGreaterThan(start);
  return row.slice(start, end + window.to.length);
}

/** The caps answer carries the gap ticket; the other two carry the plain pointer. */
const REQUIRED_POINTER: Record<string, string> = {
  "**What does `fact-present` compare?**": POINTER,
  "**In what order does `build` choose an artifact?**": POINTER,
  "**Where do the per-platform character caps come from?**": `${POINTER} The gap these clauses state is tracked in #455.`,
};

describe("the cycle's reference (#389)", () => {
  it("carries no prose of its own — only questions, contract quotes and pointers", () => {
    const section = referenceSection();
    const lines = section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(lines[0]).toBe("## How the cycle resolves (three questions)");
    for (const line of lines.slice(1)) {
      if (line.startsWith(">")) continue;
      // `Object.hasOwn`, not `in`: `constructor` must not read as a question.
      if (Object.hasOwn(CLAUSES, line)) continue;
      expect(
        Object.values(REQUIRED_POINTER).includes(line),
        `unexpected line in the reference — free prose is how the claim drifted: ${line}`,
      ).toBe(true);
    }

    const parsed = answers();
    expect(parsed.map((answer) => answer.question)).toEqual(Object.keys(CLAUSES));
    for (const answer of parsed) {
      expect(answer.quotes.length, `${answer.question} needs a quoted clause`).toBeGreaterThan(0);
      expect(answer.pointer, `${answer.question} needs its pointer`).toBe(
        REQUIRED_POINTER[answer.question],
      );
    }

    // The section is a fixed block of the README: nothing may be slipped between
    // it and the next section (a `## Note` right after the pointer was a hole).
    const after = README.slice(README.indexOf(section) + section.length).trimStart();
    expect(after.startsWith("## Commands"), "the reference must sit right before ## Commands").toBe(
      true,
    );
  });

  it("quotes each owning clause EXACTLY — no near-miss clause can stand in", () => {
    for (const answer of answers()) {
      const expected = (CLAUSES[answer.question] ?? []).map(clauseOf);
      expect(answer.quotes, `${answer.question} must quote its own clause(s), verbatim`).toEqual(
        expected,
      );
    }
  });

  // The claim "no skill row reaches the limit executor" is behaviour, so it gets
  // a behavioural test with a CONTROL: the shipped github-readme catalog declares
  // a 280 bio cap. A workspace row of the same shape must be applied (the control
  // — otherwise the measurement is not sensitive), while the shipped skill's
  // identical row must not be, and it must not leak into the DEFAULT_CHECKS
  // fallback either (the union option #455 names).
  it("does not apply the shipped skill's cap, while a workspace row does", () => {
    const skill = readFileSync(join(PKG_DIR, "skills", "github-readme", "checks.yaml"), "utf8");
    expect(skill, "the shipped catalog must still declare the row this test rules out").toContain(
      "gh-bio-max",
    );
    expect(skill).toMatch(/value:\s*280/);

    const address = "bios[platform=github-readme,lang=en,length=long].text";
    const workspaceWith = (checks: string): string => {
      const dir = mkdtempSync(join(tmpdir(), "pasco-389-"));
      tempDirs.push(dir);
      cpSync(MINIMAL, dir, { recursive: true });
      writeFileSync(join(dir, "content", "checks.yaml"), checks);
      return dir;
    };
    const row = (platform: string): string =>
      [
        `- id: cap-${platform}`,
        `  platform: ${platform}`,
        "  rule: max-chars",
        "  value: 280",
        "",
      ].join("\n");
    const preview = (dir: string) =>
      run(["edit", address, "--set", "y".repeat(300), "--check", "--json", "--workspace", dir]);
    const limitOf = (result: { stdout: string }) =>
      JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))).data as {
        limit: { cap: number } | null;
        over: boolean;
      };

    // CONTROL: the workspace declares the cap, so the executor must report it.
    const control = limitOf(preview(workspaceWith(row("github-readme"))));
    expect(control.limit).not.toBeNull();
    expect(control.limit?.cap).toBe(280);
    expect(control.over).toBe(true);

    // THE CLAIM: a catalog with no github-readme row (so DEFAULT_CHECKS is not the
    // fallback) must not inherit the skill's 280.
    const claimDir = workspaceWith(row("x"));
    const claim = limitOf(preview(claimDir));
    expect(claim.limit).toBeNull();
    expect(claim.over).toBe(false);
    const text = run([
      "edit",
      address,
      "--set",
      "y".repeat(300),
      "--check",
      "--workspace",
      claimDir,
    ]);
    expect(text.stdout).toContain("cap unknown");
    expect(text.stdout).not.toContain("vs cap 280");

    // THE FALLBACK: no catalog → DEFAULT_CHECKS; a union merged only into that
    // branch would surface the skill's 280 here.
    const bare = limitOf(preview(workspaceWith("")));
    expect(bare.limit).toBeNull();
    expect(bare.over).toBe(false);
  });
});
