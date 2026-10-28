/**
 * `pasco cite-check` — the input contract and the exit matrix (SPEC §7.4, #291).
 *
 * What must hold at the CLI seam:
 *   1. one row per input line, in input order, with `line` 1-based — a consumer
 *      joins the result back to its NDJSON by that number;
 *   2. malformed NDJSON is exit `2` and NO results — never a silent skip (a
 *      skipped line would change a rate);
 *   3. a successful read is exit `0` whatever the matches: a non-citation is
 *      data, not a failure;
 *   4. stdin is the default input, so the runner can pipe without a temp file;
 *   5. the JSON payload is the frozen, per-answer contract — never a rate.
 *
 * The matcher itself is tested in core (`cite.test.ts`); this file exercises the
 * seam, so the assertions stay about parsing, ordering and exit codes.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CITE_CHECK_SCHEMA_VERSION,
  type CiteCheckReport,
  parseAnswerLine,
  parseAnswers,
  runCiteCheck,
} from "../src/commands/cite-check.js";
import { type JsonEnvelope, setJsonMode } from "../src/output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURES = join(__dirname, "fixtures", "cite-check");
const PERSON = join(__dirname, "..", "..", "core", "tests", "fixtures", "cite-person");
const BRAND = join(__dirname, "..", "..", "core", "tests", "fixtures", "cite-brand");
const INVALID = join(__dirname, "fixtures", "invalid");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], input?: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    ...(input !== undefined ? { input } : {}),
    timeout: 15_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function envelope(stdout: string): JsonEnvelope {
  return JSON.parse(stdout) as JsonEnvelope;
}

/** Capture stdout for a direct command run (the JSON envelope goes there). */
function capture<T>(fn: () => T): { code: T; out: string } {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: fn(), out };
  } finally {
    process.stdout.write = original;
    setJsonMode(false);
  }
}

describe("the NDJSON input contract", () => {
  it("ignores blank lines and keeps the input order", () => {
    const { entries, issue } = parseAnswers(
      '{"answer":"one"}\n\n{"answer":"two","citations":[]}\n',
    );
    expect(issue).toBeUndefined();
    expect(entries.map((entry) => entry.answer.answer)).toEqual(["one", "two"]);
    // The SOURCE line, not the row index: a blank line must not shift the join key.
    expect(entries.map((entry) => entry.line)).toEqual([1, 3]);
  });

  it("carries the optional fields through, and leaves the absent ones out", () => {
    const { entries } = parseAnswers(
      '{"engine":"chatgpt","askedAt":"2026-10-23T15:00:00Z","question":"q","answer":"a"}\n',
    );
    expect(entries[0]?.answer).toEqual({
      engine: "chatgpt",
      askedAt: "2026-10-23T15:00:00Z",
      question: "q",
      answer: "a",
      citations: [],
    });
  });

  it("reports the 1-based line of invalid JSON and returns no answers", () => {
    const { entries, issue } = parseAnswers('{"answer":"ok"}\n{"answer":\n');
    expect(entries).toEqual([]);
    expect(issue?.line).toBe(2);
    expect(issue?.message).toContain("not valid JSON");
  });

  it("reports the missing field, never a silent skip", () => {
    const { issue } = parseAnswers('{"engine":"chatgpt","question":"no answer"}\n');
    expect(issue).toMatchObject({ line: 1, field: "answer" });
  });

  it("rejects a citation without a string url", () => {
    const parsed = parseAnswerLine({ answer: "a", citations: [{ url: 42 }] }, 1);
    expect(parsed.answer).toBeUndefined();
    expect(parsed.issue?.field).toBe("citations[0].url");
  });
});

describe("the JSON payload (SPEC §7.4)", () => {
  it("is one row per line, per answer and never aggregated", () => {
    setJsonMode(true);
    const { code, out } = capture(() =>
      runCiteCheck({ workspace: PERSON, input: join(FIXTURES, "answers-person.ndjson") }),
    );
    expect(code).toBe(0);
    const body = envelope(out);
    expect(body.ok).toBe(true);
    const data = body.data as CiteCheckReport;
    expect(data.schemaVersion).toBe(CITE_CHECK_SCHEMA_VERSION);
    expect(data.answers).toHaveLength(3);
    expect(data.answers.map((row) => row.line)).toEqual([1, 2, 3]);
    expect(data.entity.name).toBe("Pasco");

    const [named, homonym, cited] = data.answers;
    expect(named).toMatchObject({ cited: true, confidence: "high" });
    expect(named?.reasons).toContain("exact-name");
    expect(homonym).toMatchObject({ cited: false, confidence: "low" });
    expect(homonym?.reasons).toContain("ambiguous-term:pasco");
    // cited without naming: the citation rung needs no text match.
    expect(cited).toMatchObject({ cited: true, confidence: "high" });
    expect(cited?.spans).toEqual([
      {
        start: 0,
        end: 0,
        kind: "citation-url",
        url: "https://github.com/pascocli",
      },
    ]);
    expect(cited?.reasons).toEqual(expect.arrayContaining(["citation-url", "identity-domain"]));
    expect(body.data).not.toHaveProperty("rate");
    expect(body.data).not.toHaveProperty("score");
  });

  it("resolves alias and contrast on the brand fixture", () => {
    setJsonMode(true);
    const { code, out } = capture(() =>
      runCiteCheck({ workspace: BRAND, input: join(FIXTURES, "answers-brand.ndjson") }),
    );
    expect(code).toBe(0);
    const data = envelope(out).data as CiteCheckReport;
    expect(data.answers[0]).toMatchObject({ cited: true, confidence: "high" });
    expect(data.answers[1]).toMatchObject({ cited: true, confidence: "medium" });
    expect(data.answers[1]?.reasons).toContain("alias");
    expect(data.answers[2]).toMatchObject({ cited: false, confidence: "low" });
    expect(data.answers[2]?.reasons).toContain("contrast-context");
  });

  it("reads stdin when no path is given", () => {
    const input = '{"answer":"Pasco is a CLI for profile-as-code, built in Ecuador."}\n';
    const result = run(["cite-check", "--json", "--workspace", PERSON], input);
    expect(result.code).toBe(0);
    const data = envelope(result.stdout).data as CiteCheckReport;
    expect(data.answers[0]?.cited).toBe(true);
  });

  it("exits 0 on an empty input (a successful read of nothing)", () => {
    const result = run([
      "cite-check",
      join(FIXTURES, "empty.ndjson"),
      "--json",
      "--workspace",
      PERSON,
    ]);
    expect(result.code).toBe(0);
    expect((envelope(result.stdout).data as CiteCheckReport).answers).toEqual([]);
  });
});

describe("the exit matrix (SPEC §7.4)", () => {
  it("exit 2 on malformed NDJSON, naming the line, with no results", () => {
    const result = run([
      "cite-check",
      join(FIXTURES, "malformed", "answers.ndjson"),
      "--json",
      "--workspace",
      PERSON,
    ]);
    expect(result.code).toBe(2);
    const body = envelope(result.stdout);
    expect(body.ok).toBe(false);
    expect(body.exitCode).toBe(2);
    expect(body.error?.message).toContain("malformed NDJSON at line 2");
    expect(body.data).toBeUndefined();
  });

  it("exit 2 on a line that is not the contract (missing answer)", () => {
    const result = run([
      "cite-check",
      join(FIXTURES, "malformed", "missing-answer.ndjson"),
      "--workspace",
      PERSON,
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("line 1 (answer)");
  });

  it("exit 1 when the workspace cannot load", () => {
    const result = run([
      "cite-check",
      join(FIXTURES, "answers-person.ndjson"),
      "--workspace",
      INVALID,
    ]);
    expect(result.code).toBe(1);
  });

  it("exit 1 when the input path cannot be read", () => {
    const result = run([
      "cite-check",
      join(FIXTURES, "no-such-file.ndjson"),
      "--workspace",
      PERSON,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("cannot read");
  });
});

describe("the published surface", () => {
  it("--help documents the ladder, the low rule and the exit matrix", () => {
    const result = run(["cite-check", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("citation-url");
    expect(result.stdout).toContain("NEVER a citation");
    expect(result.stdout).toContain("malformed NDJSON");
    expect(result.stdout).toContain("NEVER aggregated");
  });

  it("human output reports per answer and no citation rate", () => {
    const result = run([
      "cite-check",
      join(FIXTURES, "answers-person.ndjson"),
      "--workspace",
      PERSON,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("#1 — cited (high)");
    expect(result.stdout).toContain("#2 — not cited (low)");
    expect(result.stdout).toContain("3 answer(s) read");
    expect(result.stdout).not.toMatch(/rate|percentage|score/i);
  });
});
