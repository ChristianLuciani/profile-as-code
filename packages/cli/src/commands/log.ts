/**
 * `pasco log` — the CAPTURE path of the impact log (D25/S2, issue #496, SPEC
 * §23.6).
 *
 * One command writes one row of `achievements[]`: the block is only useful if
 * filing a result does not require opening the YAML. The row is validated
 * BEFORE anything touches disk, so an invalid input is an exit code, not a
 * half-written file.
 *
 * The contract the issue's D27 amendment fixed:
 *
 *   - `--kind metric` requires ONLY `--unit`: `--target` without `--value` is a
 *     `planned` goal and `--value` without `--target` a `measured` result
 *     (§23.2). Requiring both would delete the two cases D24 exists for.
 *   - a `milestone` carrying ANY metric flag is exit 2, nothing written (the
 *     `kind` ↔ `metric` invariant is enforced here and in core, §23.4).
 *   - `--date` is OPTIONAL and no clock is read (D19): absent means the row is
 *     `undated`, which `pasco achievements` reports instead of hiding. A malformed
 *     or impossible date is exit 2.
 *   - `--visibility` defaults to `private` (D27) and is printed in both views.
 *   - `--basis` is required: the honesty posture is the price of entry (§23.3).
 *
 * Exit: 0 written · 1 the workspace fails to load, the id collides, or the file
 * cannot be appended safely (nothing written) · 2 usage or an invalid input.
 */

import type { Achievement, AchievementBasis, AchievementMetric } from "@profile-as-code/core";
import {
  ACHIEVEMENT_REF_BLOCKS,
  achievementStatus,
  LoadError,
  SchemaValidationError,
} from "@profile-as-code/core";
import { parseCalendarDate, UsageError } from "../contract.js";
import { StaleEditError, WriteRefusedError } from "../edit-write.js";
import { EXIT } from "../exit.js";
import { appendAchievement, deriveAchievementId } from "../log-write.js";
import { isJsonMode, line, report, section } from "../output.js";

/** The `$defs/entryId` / `refs[]` id pattern — the contract's, not a new grammar. */
const ENTRY_ID = /^[a-z0-9][a-z0-9._:-]*$/;
/** The refs alternation is BUILT from the core list, never re-typed (the core
 *  list is pinned to the schema): a block added to the contract cannot make the
 *  capture path refuse a valid `--ref` (F6 of the #446 review, #496). */
const REF = new RegExp(`^(${ACHIEVEMENT_REF_BLOCKS.join("|")}):[a-z0-9][a-z0-9._:-]*$`);
const KINDS: readonly string[] = ["metric", "milestone"] as const;
const BASES: readonly string[] = ["measured", "estimated", "reported", "attested"] as const;
const DIRECTIONS: readonly string[] = ["increase", "decrease", "maintain"] as const;
const VISIBILITIES: readonly string[] = ["public", "unlisted", "private"] as const;

export interface LogArgs {
  workspace: string;
  statement?: string;
  kind?: string;
  basis?: string;
  unit?: string;
  value?: string;
  target?: string;
  baseline?: string;
  direction?: string;
  date?: string;
  refs?: string[];
  source?: string;
  artifactId?: string;
  credentialId?: string;
  visibility?: string;
  id?: string;
}

function oneLine(value: string, flag: string): string {
  if (value.trim().length === 0) throw new UsageError(`${flag} must not be empty`);
  if (value.includes("\n") || value.includes("\r")) {
    throw new UsageError(`${flag} must be a single line (got a line break)`);
  }
  return value;
}

function numberFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  const parsed = Number(text);
  if (text.length === 0 || !Number.isFinite(parsed)) {
    throw new UsageError(`${flag} must be a finite number (got "${value}")`);
  }
  return parsed;
}

/** One of a closed enum, or a usage error that names what is allowed. */
function oneOf<T extends string>(
  value: string | undefined,
  flag: string,
  allowed: readonly string[],
  fallback?: T,
): T {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new UsageError(`${flag} is required (allowed: ${allowed.join(", ")})`);
  }
  if (!allowed.includes(value)) {
    throw new UsageError(`unknown ${flag} "${value}" (allowed: ${allowed.join(", ")})`);
  }
  return value as T;
}

/**
 * Build the row from the flags, applying every rule BEFORE the write. Pure and
 * exported so the tests pin the contract without spawning a process.
 */
export function buildAchievement(args: LogArgs): Achievement {
  const statement = oneLine(args.statement ?? "", "--statement");
  const kind = oneOf(args.kind, "--kind", KINDS) as Achievement["kind"];
  const basis = oneOf(args.basis, "--basis", BASES) as AchievementBasis;

  const metricFlags = [
    ["--unit", args.unit],
    ["--value", args.value],
    ["--target", args.target],
    ["--baseline", args.baseline],
    ["--direction", args.direction],
  ] as const;
  const declaredMetricFlags = metricFlags.filter(([, value]) => value !== undefined);
  if (kind === "milestone" && declaredMetricFlags.length > 0) {
    throw new UsageError(
      `--kind milestone has no metric — remove ${declaredMetricFlags.map(([flag]) => flag).join(", ")} (a point event has no progress; use --kind metric, or move the numbers into --statement)`,
    );
  }

  let metric: AchievementMetric | undefined;
  if (kind === "metric") {
    if (args.unit === undefined) {
      throw new UsageError(
        "--unit is required for --kind metric (the only required metric field: --target alone is a plan, --value alone a measurement)",
      );
    }
    const unit = oneLine(args.unit, "--unit");
    const value = numberFlag(args.value, "--value");
    const target = numberFlag(args.target, "--target");
    const baseline = numberFlag(args.baseline, "--baseline");
    const direction =
      args.direction === undefined
        ? undefined
        : (oneOf(args.direction, "--direction", DIRECTIONS) as AchievementMetric["direction"]);
    metric = {
      unit,
      ...(value !== undefined ? { value } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(baseline !== undefined ? { baseline } : {}),
      ...(direction !== undefined ? { direction } : {}),
    } as AchievementMetric;
  }

  const date = args.date === undefined ? undefined : parseCalendarDate(args.date, "--date");

  const refs = args.refs ?? [];
  for (const ref of refs) {
    if (!REF.test(ref)) {
      throw new UsageError(
        `--ref "${ref}" must be "block:id" (allowed blocks: ${ACHIEVEMENT_REF_BLOCKS.join(", ")})`,
      );
    }
  }

  if (args.source !== undefined) {
    if (!/^https?:\/\//.test(args.source) || args.source.includes("\n")) {
      throw new UsageError(`--source must be an http(s) URL (got "${args.source}")`);
    }
    try {
      new URL(args.source);
    } catch {
      throw new UsageError(`--source is not a valid URL (got "${args.source}")`);
    }
  }
  if (args.artifactId !== undefined && !ENTRY_ID.test(args.artifactId)) {
    throw new UsageError(`--artifactId "${args.artifactId}" is not a valid entry id`);
  }
  if (args.credentialId !== undefined && !ENTRY_ID.test(args.credentialId)) {
    throw new UsageError(`--credentialId "${args.credentialId}" is not a valid entry id`);
  }
  if (args.id !== undefined && !ENTRY_ID.test(args.id)) {
    throw new UsageError(`--id "${args.id}" is not a valid entry id`);
  }
  const visibility = oneOf(args.visibility, "--visibility", VISIBILITIES, "private" as const);

  const id = args.id ?? deriveAchievementId(statement, date);
  return {
    id,
    statement: { en: statement },
    kind,
    ...(metric !== undefined ? { metric } : {}),
    ...(refs.length > 0 ? { refs } : {}),
    ...(args.source !== undefined ? { source: args.source } : {}),
    ...(args.artifactId !== undefined ? { artifactId: args.artifactId } : {}),
    ...(args.credentialId !== undefined ? { credentialId: args.credentialId } : {}),
    basis,
    ...(date !== undefined ? { date } : {}),
    visibility,
  } as Achievement;
}

export function runLog(args: LogArgs): number {
  let row: Achievement;
  try {
    row = buildAchievement(args);
  } catch (err) {
    if (err instanceof UsageError) {
      return report("log", false, EXIT.USAGE, {
        error: { kind: "usage", message: err.message },
      });
    }
    throw err;
  }

  let outcome: ReturnType<typeof appendAchievement>;
  try {
    outcome = appendAchievement({ workspace: args.workspace, row });
  } catch (err) {
    if (err instanceof WriteRefusedError || err instanceof StaleEditError) {
      return report("log", false, EXIT.FAIL, {
        error: {
          kind: err instanceof StaleEditError ? "stale" : "refused",
          message: err.message,
        },
      });
    }
    if (err instanceof SchemaValidationError || err instanceof LoadError) {
      return report("log", false, EXIT.FAIL, {
        error: {
          kind: err instanceof SchemaValidationError ? "schema" : "load",
          message: err.message,
          ...(err instanceof SchemaValidationError ? { violations: [...err.issues] } : {}),
        },
      });
    }
    throw err;
  }

  const status = achievementStatus(row) ?? null;
  if (isJsonMode()) {
    return report("log", true, EXIT.OK, {
      data: {
        file: outcome.file,
        created: outcome.created,
        id: row.id,
        visibility: row.visibility,
        row: { ...row, status },
      },
    });
  }

  section("Log — one achievement written");
  line(`  file:       ${outcome.file}${outcome.created ? " (created)" : ""}`);
  line(`  id:         ${row.id}`);
  line(`  kind:       ${row.kind}${status === null ? "" : ` (${status})`}`);
  line(`  basis:      ${row.basis}`);
  line(
    `  visibility: ${row.visibility}${row.visibility === "public" ? " (published by renderers)" : " (not published — D27)"}`,
  );
  line("");
  line(
    "The status is DERIVED from the numbers (planned · measured · achieved · partial) — never stored.",
  );
  return EXIT.OK;
}
