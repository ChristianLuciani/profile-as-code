/**
 * Manual observations — a HUMAN reads the surfaces the machine cannot (SPEC
 * §7.10, issue #412).
 *
 * `discover` reads only schema.org `Person`/`Organization` JSON-LD, which is
 * exactly what a prospect's real surfaces do not publish (LinkedIn answers
 * `http-999`, ResearchGate `http-403`, ORCID/X/Instagram carry no `Person`). The
 * gap was scope, not a defect: the operator is left to invent a profile by hand
 * with no path back into the audit. This module is that path.
 *
 * The division of labour is the point: the human does the reading that the
 * machine cannot (a walled surface, a page with no structured data) and the
 * machine does what a human does not do reliably — diff N surfaces × M fields.
 *
 * It REUSES the provisional shape instead of growing a parallel one: every row
 * is turned into the same `SurfaceObservation` the transport produces (a
 * schema.org node the extractor already understands), so `provisionalProfile`,
 * `provenance`, `absent[]` and `discoveryFindings` run unchanged. There is one
 * assembly path and one findings path; this file owns only the row grammar.
 *
 * No network, ever: the row's `url` is a LABEL a reader can open (it becomes the
 * provenance pointer), never a fetch target — so the closed host allowlist of
 * §19.5 does not apply here and nothing is written.
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { DiscoveryError, experienceId, type SurfaceObservation } from "./discovery.js";

/**
 * The closed field vocabulary: exactly the facts the provisional profile can
 * hold, so a row can never declare something the audit would not read. A new
 * field is a SPEC change, not a typo the parser tolerates.
 */
export const OBSERVATION_FIELDS = ["name", "link", "experience"] as const;
export type ObservationField = (typeof OBSERVATION_FIELDS)[number];

const ROW_KEYS = ["surface", "field", "value", "url", "retrieved_at"] as const;
const EXPERIENCE_KEYS = ["role", "org", "start", "end"] as const;

const HTTP_URL = /^https?:\/\//u;
/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD` — the schema's own precision ladder. */
const DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u;
/** `YYYY-MM-DD`, optionally with a time and an explicit zone (never a bare
 *  local time: a retrieval instant without a zone is not an instant). */
const RETRIEVED_AT =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/u;

function at(index: number, reason: string): DiscoveryError {
  return new DiscoveryError(`observations: row ${index + 1}: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, index: number, key: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw at(index, `\`${key}\` must be a non-empty string`);
  }
  return value.trim();
}

/** Days in a month, calendar-strict: the shape regex alone accepts `2020-13`
 *  and `2026-02-31`, and a provenance date nobody can open is worse than a
 *  refusal (review F1). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True when the parts form a real calendar date at the written precision. */
function calendarDate(text: string): boolean {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/u.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = match[2] === undefined ? undefined : Number(match[2]);
  const day = match[3] === undefined ? undefined : Number(match[3]);
  if (month !== undefined && (month < 1 || month > 12)) return false;
  // Day 0 is not "the last day of the previous month" here: the input is a date,
  // and `2026-02-00` is not one (review round 2, F1).
  if (day !== undefined && (day < 1 || day > daysInMonth(year, month as number))) return false;
  return true;
}

/** A date as the human writes it: `2020`, `2020-03`, `2020-03-15`. A bare
 *  numeric year arrives as a YAML number (`start: 2020`) and is the same date,
 *  so it is accepted rather than turned into a puzzling type error. */
function dateValue(value: unknown, index: number, key: string): string {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !DATE.test(text.trim()) || !calendarDate(text.trim())) {
    throw at(index, `\`${key}\` must be a real date: YYYY, YYYY-MM or YYYY-MM-DD`);
  }
  return text.trim();
}

/** An experience end is a date or the literal `present` (the schema's own token,
 *  §6 `experienceItem.end`); `present` becomes the absence of an end date in the
 *  provisional profile, which is what "still there" means there. */
function endValue(value: unknown, index: number, key: string): string {
  if (typeof value === "string" && value.trim().toLowerCase() === "present") return "present";
  return dateValue(value, index, key);
}

function httpUrl(value: unknown, index: number, key: string): string {
  const text = nonEmptyString(value, index, key);
  if (!HTTP_URL.test(text)) throw at(index, `\`${key}\` must be an absolute http(s) URL`);
  try {
    new URL(text);
  } catch {
    throw at(index, `\`${key}\` is not a parseable URL: ${text}`);
  }
  return text;
}

/** A retrieval instant is provenance a reader may want to trust: a date-only
 *  value is normalized to the start of that day (UTC), so every record carries
 *  a full instant, exactly like the transport's `retrieved`. */
function retrievedAt(value: unknown, index: number): string {
  if (typeof value !== "string" || !RETRIEVED_AT.test(value.trim())) {
    throw at(
      index,
      "`retrieved_at` must be YYYY-MM-DD or an ISO 8601 date-time with an explicit zone (quote it in YAML)",
    );
  }
  const text = value.trim();
  // The date part is checked against the calendar (F1): `Date.parse` normalizes
  // `2026-02-31` instead of rejecting it, so a shape-only check would bless a
  // provenance instant that never existed.
  if (!calendarDate(text.slice(0, 10))) {
    throw at(index, `\`retrieved_at\` is not a real calendar date: ${text}`);
  }
  if (text.length === 10) return `${text}T00:00:00.000Z`;
  if (Number.isNaN(Date.parse(text)))
    throw at(index, `\`retrieved_at\` is not a valid date-time: ${text}`);
  return text;
}

function keysOf(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

function sameKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return keysOf(record).join(",") === [...allowed].sort().join(",");
}

function experienceNode(value: unknown, index: number): Record<string, unknown> {
  if (!isRecord(value)) {
    throw at(index, "`value` for field `experience` must be a map with role, org and start");
  }
  const unknown = keysOf(value).filter(
    (key) => !(EXPERIENCE_KEYS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw at(
      index,
      `unknown experience key(s): ${unknown.join(", ")} (allowed: ${EXPERIENCE_KEYS.join(", ")})`,
    );
  }
  const missing = EXPERIENCE_KEYS.filter((key) => key !== "end" && !Object.hasOwn(value, key));
  if (missing.length > 0) {
    throw at(
      index,
      `\`value\` for field \`experience\` requires role, org and start (missing: ${missing.join(", ")})`,
    );
  }
  const role = nonEmptyString(value.role, index, "value.role");
  const org = nonEmptyString(value.org, index, "value.org");
  const start = dateValue(value.start, index, "value.start");
  const end = value.end === undefined ? undefined : endValue(value.end, index, "value.end");
  // The extractor reads schema.org: `jobTitle` + `worksFor.startDate/endDate`.
  // Absence of an end IS "present" in the provisional profile; an explicit
  // `present` token is accepted as the same fact rather than dropped silently.
  return {
    "@type": "Person",
    jobTitle: role,
    worksFor: {
      "@type": "Organization",
      name: org,
      startDate: start,
      ...(end !== undefined && end !== "present" ? { endDate: end } : {}),
    },
  };
}

/** One validated row → the schema.org node the extractor already understands. */
function nodeFor(field: ObservationField, value: unknown, index: number): Record<string, unknown> {
  switch (field) {
    case "name":
      return { "@type": "Person", name: nonEmptyString(value, index, "value") };
    case "link":
      return { "@type": "Person", sameAs: [httpUrl(value, index, "value")] };
    case "experience":
      return experienceNode(value, index);
  }
}

function rowFrom(raw: unknown, index: number): SurfaceObservation {
  if (!isRecord(raw)) throw at(index, "each row must be a map (- surface: …, field: …, value: …)");
  if (!sameKeys(raw, ROW_KEYS)) {
    const unknown = keysOf(raw).filter((key) => !(ROW_KEYS as readonly string[]).includes(key));
    const missing = ROW_KEYS.filter((key) => !Object.hasOwn(raw, key));
    throw at(
      index,
      unknown.length > 0
        ? `unknown key(s): ${unknown.join(", ")} (allowed: ${ROW_KEYS.join(", ")})`
        : `missing key(s): ${missing.join(", ")} (required: ${ROW_KEYS.join(", ")})`,
    );
  }
  const surface = nonEmptyString(raw.surface, index, "surface");
  const field = raw.field;
  if (typeof field !== "string" || !(OBSERVATION_FIELDS as readonly string[]).includes(field)) {
    throw at(
      index,
      `\`field\` must be one of ${OBSERVATION_FIELDS.join(", ")} (got ${JSON.stringify(raw.field)})`,
    );
  }
  const url = httpUrl(raw.url, index, "url");
  const retrieved = retrievedAt(raw.retrieved_at, index);
  return {
    surface,
    url,
    retrieved,
    jsonLd: [nodeFor(field as ObservationField, raw.value, index)],
    text: "",
    links: [],
  };
}

/**
 * Parse the operator's observation file into the transport's own
 * `SurfaceObservation` shape — one observation per row, in file order, so
 * per-fact provenance points at the row that declared it.
 *
 * Shape problems are data errors, not usage errors: the flag is well formed and
 * the file is what it is, so every refusal is a `DiscoveryError` naming the row
 * (exit 1, the same refusal path as "no surface declared a name"). An empty file
 * or an empty list is refused rather than reported as a clean audit.
 */
export function parseObservations(text: string): SurfaceObservation[] {
  let document: unknown;
  try {
    document = parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DiscoveryError(`observations: not valid YAML — ${message}`);
  }
  if (document === null || document === undefined) {
    throw new DiscoveryError("observations: the file is empty — expected a YAML sequence of rows");
  }
  if (!Array.isArray(document)) {
    throw new DiscoveryError(
      "observations: the file must be a YAML sequence of rows (- surface: …, field: …, value: …)",
    );
  }
  if (document.length === 0) {
    throw new DiscoveryError("observations: the sequence declares no rows");
  }
  const observations = document.map((row, index) => rowFrom(row, index));
  // The provisional profile keys an employment row by (surface, org) — through
  // `experienceId`, the ONE key rule. A second manual row with the same key
  // would be dropped by the assembly, so it is refused here, naming BOTH rows
  // (review F2 — the silent-collapse class). Two spellings (`Acme`/`ACME`) are
  // the same key because the id is slugged.
  const employment = new Map<string, { index: number; org: string }>();
  for (const [index, observation] of observations.entries()) {
    const node = observation.jsonLd[0] as Record<string, unknown> | undefined;
    const worksFor = node?.worksFor as Record<string, unknown> | undefined;
    if (worksFor === undefined) continue;
    const org = String(worksFor.name);
    const key = experienceId(observation.surface, org);
    const first = employment.get(key);
    if (first !== undefined) {
      throw at(
        index,
        `experience for ${observation.surface} / ${org} is already declared by row ${first.index + 1} (${first.org}) — the provisional profile holds ONE employment row per surface and org, so a second role at the same org cannot be represented; keep one row per (surface, org)`,
      );
    }
    employment.set(key, { index, org });
  }
  return observations;
}

/** Read the operator's file and parse it. A missing/unreadable file is the same
 *  refusal class as a malformed one: nothing is guessed from an absent input. */
export function loadObservations(path: string): SurfaceObservation[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DiscoveryError(`observations: cannot read ${path} — ${message}`);
  }
  return parseObservations(text);
}
