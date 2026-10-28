/**
 * `pasco cite-check [<answers.ndjson>] [--json]` — the citation matcher over
 * saved answers (SPEC §7.4, issue #291).
 *
 * The engine answers one question about an answer-engine record: did this saved
 * answer cite this entity? The matching is `core/src/cite.ts` (pure); this module
 * owns the INPUT contract — the runner's NDJSON — and the output projection. It
 * reads no network, no model and no clock (D19): the input bytes decide the
 * output bytes.
 *
 * A malformed line is NEVER skipped: a skipped answer changes a rate silently,
 * which is the failure class this command exists to prevent, so it is a usage
 * error (exit 2) naming the 1-based line and the field. A non-citation is data,
 * not a failure: the command exits 0 whatever the matches.
 */

import { readFileSync } from "node:fs";
import type { CiteAnswer, CiteMatch, CiteVocabulary, LoadedProfile } from "@profile-as-code/core";
import {
  citeMatch,
  citeVocabulary,
  LoadError,
  load,
  SchemaValidationError,
} from "@profile-as-code/core";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";

/** The frozen contract version of the `--json` payload (SPEC §7.4). */
export const CITE_CHECK_SCHEMA_VERSION = "1";

/** One answer's row — the per-answer result, never aggregated. */
export interface CiteCheckRow extends CiteMatch {
  /** 1-based source line, so a consumer can join back to the NDJSON. */
  line: number;
  engine: string | null;
  askedAt: string | null;
  question: string | null;
}

export interface CiteCheckReport {
  schemaVersion: typeof CITE_CHECK_SCHEMA_VERSION;
  /** The declared vocabulary the matcher resolved (audit without re-reading the SSOT). */
  entity: CiteVocabulary;
  answers: CiteCheckRow[];
}

/** A malformed-input reading: the 1-based line, the field and what is wrong. */
export interface NdjsonIssue {
  line: number;
  field?: string;
  message: string;
}

export interface CiteCheckArgs {
  workspace: string;
  /** Path to the NDJSON, or `undefined`/`-` for stdin. */
  input?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  value: unknown,
  field: string,
): { value: string | null; issue?: NdjsonIssue } {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") {
    return { value: null, issue: { line: 0, field, message: `"${field}" must be a string` } };
  }
  return { value };
}

/** Read one answer object; `undefined` means the line is not the declared contract. */
export function parseAnswerLine(
  value: unknown,
  lineNumber: number,
): {
  answer?: CiteAnswer;
  issue?: NdjsonIssue;
} {
  if (!isRecord(value)) {
    return { issue: { line: lineNumber, message: "the line must be a JSON object" } };
  }
  const answer = value.answer;
  if (typeof answer !== "string") {
    return {
      issue: { line: lineNumber, field: "answer", message: `"answer" must be a string` },
    };
  }
  // The field is REQUIRED by the contract (SPEC §7.4): a missing `citations`
  // is a runner bug, and absorbing it as "no sources" would produce an
  // indistinguishable false "not cited" — the failure class this command
  // exists to prevent. An answer with no sources declares `"citations": []`.
  if (value.citations === undefined) {
    return {
      issue: {
        line: lineNumber,
        field: "citations",
        message: `"citations" is required (use [] for an answer with no sources)`,
      },
    };
  }
  const citations: CiteAnswer["citations"] = [];
  if (!Array.isArray(value.citations)) {
    return {
      issue: {
        line: lineNumber,
        field: "citations",
        message: `"citations" must be an array`,
      },
    };
  }
  for (const [index, row] of value.citations.entries()) {
    if (!isRecord(row) || typeof row.url !== "string") {
      return {
        issue: {
          line: lineNumber,
          field: `citations[${index}].url`,
          message: 'each citation must be an object with a string "url"',
        },
      };
    }
    citations.push({
      url: row.url,
      ...(typeof row.title === "string" ? { title: row.title } : {}),
    });
  }

  const engine = optionalString(value.engine, "engine");
  if (engine.issue) return { issue: { ...engine.issue, line: lineNumber } };
  const askedAt = optionalString(value.askedAt, "askedAt");
  if (askedAt.issue) return { issue: { ...askedAt.issue, line: lineNumber } };
  const question = optionalString(value.question, "question");
  if (question.issue) return { issue: { ...question.issue, line: lineNumber } };

  return {
    answer: {
      answer,
      citations,
      ...(engine.value !== null ? { engine: engine.value } : {}),
      ...(askedAt.value !== null ? { askedAt: askedAt.value } : {}),
      ...(question.value !== null ? { question: question.value } : {}),
    },
  };
}

/** One parsed answer and the 1-based SOURCE line it came from. */
export interface ParsedAnswer {
  line: number;
  answer: CiteAnswer;
}

/**
 * Parse the runner's NDJSON. Blank lines are ignored; the FIRST malformed line
 * aborts the whole read — the command reports it instead of returning a
 * partial result that a rate would silently absorb.
 *
 * The source line is carried per answer, not derived from the row index: an
 * NDJSON file with blank lines would otherwise shift every `line` and a consumer
 * joining back to its input would read the wrong record.
 */
export function parseAnswers(text: string): { entries: ParsedAnswer[]; issue?: NdjsonIssue } {
  const entries: ParsedAnswer[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? "";
    if (raw.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        entries: [],
        issue: {
          line: index + 1,
          message: `not valid JSON — ${(err as Error).message}`,
        },
      };
    }
    const reading = parseAnswerLine(parsed, index + 1);
    if (reading.answer === undefined) return { entries: [], issue: reading.issue };
    entries.push({ line: index + 1, answer: reading.answer });
  }
  return { entries };
}

function loadProfile(
  workspace: string,
): { profile: LoadedProfile; error?: never } | { profile?: never; error: number } {
  try {
    return { profile: load(workspace) };
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return {
        error: report("cite-check", false, EXIT.FAIL, {
          error: {
            kind: "schema",
            message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
            violations: [...err.issues],
          },
        }),
      };
    }
    if (err instanceof LoadError) {
      return {
        error: report("cite-check", false, EXIT.FAIL, {
          error: { kind: "load", message: err.message },
        }),
      };
    }
    throw err;
  }
}

/** Read the NDJSON from a path or stdin. */
function readInput(input: string | undefined): { text: string; label: string } | { error: string } {
  const label = input === undefined || input === "-" ? "stdin" : input;
  try {
    const text =
      input === undefined || input === "-" ? readFileSync(0, "utf8") : readFileSync(input, "utf8");
    return { text, label };
  } catch (err) {
    return { error: `cannot read "${label}": ${(err as Error).message}` };
  }
}

/** One line describing a span for the human output. */
function describeSpan(span: CiteCheckRow["spans"][number]): string {
  if (span.kind === "citation-url") return `citation-url ${span.url ?? ""}`.trim();
  return `${span.kind}@${span.start}-${span.end}`;
}

/** Build the per-answer report rows (the pure projection of `citeMatch`). */
export function citeCheckRows(
  profile: LoadedProfile,
  entries: readonly ParsedAnswer[],
): CiteCheckRow[] {
  return entries.map((entry) => ({
    line: entry.line,
    engine: entry.answer.engine ?? null,
    askedAt: entry.answer.askedAt ?? null,
    question: entry.answer.question ?? null,
    ...citeMatch(profile, entry.answer),
  }));
}

export function runCiteCheck(args: CiteCheckArgs): number {
  const loaded = loadProfile(args.workspace);
  if (loaded.profile === undefined) return loaded.error;
  const profile = loaded.profile;

  const source = readInput(args.input);
  if ("error" in source) {
    return report("cite-check", false, EXIT.FAIL, {
      error: { kind: "input", message: source.error },
    });
  }

  const parsed = parseAnswers(source.text);
  if (parsed.issue !== undefined) {
    const { line: badLine, field, message } = parsed.issue;
    const at = field === undefined ? `line ${badLine}` : `line ${badLine} (${field})`;
    return report("cite-check", false, EXIT.USAGE, {
      error: {
        kind: "input",
        message: `malformed NDJSON at ${at} — ${message}`,
        violations: [{ path: `line ${badLine}`, message }],
      },
    });
  }

  const rows = citeCheckRows(profile, parsed.entries);
  const entity = citeVocabulary(profile);

  if (isJsonMode()) {
    const data: CiteCheckReport = {
      schemaVersion: CITE_CHECK_SCHEMA_VERSION,
      entity,
      answers: rows,
    };
    return report("cite-check", true, EXIT.OK, { data });
  }

  section(`cite-check — ${rows.length} answer(s) from ${source.label}`);
  line(`  entity: ${entity.name}`);
  for (const row of rows) {
    const label = row.cited ? `cited (${row.confidence})` : `not cited (${row.confidence})`;
    line(`#${row.line} — ${label}`);
    if (row.question !== null) line(`  q: ${row.question}`);
    line(`  spans: ${row.spans.length === 0 ? "(none)" : row.spans.map(describeSpan).join(" · ")}`);
    line(`  reasons: ${row.reasons.length === 0 ? "(none)" : row.reasons.join(", ")}`);
  }
  line(`pasco cite-check: ${rows.length} answer(s) read`);
  return EXIT.OK;
}
