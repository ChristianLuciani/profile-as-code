/**
 * `pasco achievements [--targets] [--json]` — the career impact log (D24, SPEC
 * §23, issue #446).
 *
 * A READ-ONLY view. It writes nothing, resolves nothing at the network and
 * derives everything from `facts/achievements.yaml`: the status of each row
 * comes from `core/src/achievements.ts` (`achievementStatus`), never from the
 * workspace (a stored status could disagree with the numbers it describes).
 *
 * Two views:
 *   default    the log, grouped by the units the rows belong to (`refs[]`), with
 *              "Unattached" for the rows that point at no unit;
 *   --targets  the goal view: only the `planned` rows (a target with no value).
 *
 * Exit: 0 a successful read · 1 the workspace does not load (schema or the
 * post-Zod integrity checks — `load` fails on a dangling ref, so a resolved
 * `refs[]` is a precondition of this command, never a re-implementation of it).
 */

import type {
  Achievement,
  AchievementMetric,
  AchievementScope,
  AchievementStatus,
  LoadedProfile,
} from "@profile-as-code/core";
import {
  achievementScope,
  achievementStatus,
  LoadError,
  load,
  SchemaValidationError,
  textOf,
} from "@profile-as-code/core";
import { parseCalendarDate, UsageError } from "../contract.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";

/** The frozen contract version of the `--json` payload. `scope.undated` (#497)
 *  is ADDITIVE to v1: no field was removed or renamed, so a consumer of the
 *  frozen shape keeps working (the acceptance of #497 forbids a breaking bump). */
export const ACHIEVEMENTS_SCHEMA_VERSION = "1";

export interface AchievementsArgs {
  workspace: string;
  /** Only the `planned` rows (the goal view). */
  targets?: boolean;
  /** Inclusive lower bound on `date` (D25/S3). */
  since?: string;
  /** Inclusive upper bound on `date` (D25/S3). */
  until?: string;
}

/** The scope of a view: the derived-status counters plus the date-less rows.
 *  `undated` is not a status bucket — it is the honesty counter (#497): rows the
 *  range could not place are declared, never dropped. */
export interface AchievementsViewScope extends AchievementScope {
  undated: number;
}

/** The rows a view returns and the rows/date-less rows it considered. */
export interface AchievementSelection {
  rows: Achievement[];
  /** Rows in the STATUS-filtered set, before the range (#497). */
  considered: number;
  /** Rows without `date` among the STATUS-filtered set, before the range. */
  undated: number;
  /** The range the view applied, or `null` when no bound was declared. */
  range: { since?: string; until?: string } | null;
}

/** A row as the JSON view emits it: the declared fields plus the DERIVED status. */
export type AchievementView = Achievement & { status: AchievementStatus | null };

export interface AchievementsPayload {
  schemaVersion: string;
  scope: AchievementsViewScope;
  achievements: AchievementView[];
}

/** Validate the declared bounds and refuse an impossible period (exit 2). */
export function parseRange(
  since?: string,
  until?: string,
): { since?: string; until?: string } | null {
  if (since === undefined && until === undefined) return null;
  const lower = since === undefined ? undefined : parseCalendarDate(since, "--since");
  const upper = until === undefined ? undefined : parseCalendarDate(until, "--until");
  if (lower !== undefined && upper !== undefined && lower > upper) {
    throw new UsageError(`--since ${lower} is after --until ${upper} — the period would be empty`);
  }
  return {
    ...(lower !== undefined ? { since: lower } : {}),
    ...(upper !== undefined ? { until: upper } : {}),
  };
}

/** A dated row is in range when it is not before `since` and not after `until`;
 *  both boundaries are INCLUSIVE. A date-less row is never "in range". */
export function inRange(row: Achievement, range: { since?: string; until?: string }): boolean {
  if (row.date === undefined) return false;
  if (range.since !== undefined && row.date < range.since) return false;
  if (range.until !== undefined && row.date > range.until) return false;
  return true;
}

/**
 * The composition rule of #497. The two filters are ANDed, and the counter has
 * ONE defined basis:
 *
 *   - the status filter (`--targets` → `planned`) produces the considered set
 *     and `undated` is counted ON that set (a date-less row is a goal only if
 *     it is planned);
 *   - a declared range then keeps only the DATED rows inside it — plus, in the
 *     goal view only, the date-less goals (a goal is date-less by nature);
 *   - in the log view a date-less row is withheld from the range and declared
 *     in `undated`, never dropped.
 *
 * Without a range, nothing is filtered by date and `undated` counts the rows
 * the view returned.
 */
export function selectRows(
  achievements: readonly Achievement[],
  options: { targets?: boolean; since?: string; until?: string },
): AchievementSelection {
  const statusRows =
    options.targets === true
      ? achievements.filter((achievement) => achievementStatus(achievement) === "planned")
      : [...achievements];
  const considered = statusRows.length;
  const undated = statusRows.filter((achievement) => achievement.date === undefined).length;
  const range = parseRange(options.since, options.until);
  if (range === null) return { rows: statusRows, considered, undated, range: null };
  const rows = statusRows.filter(
    (achievement) =>
      inRange(achievement, range) || (options.targets === true && achievement.date === undefined),
  );
  return { rows, considered, undated, range };
}

/** The formatter of a metric (`72 h → 4 h`, `4 h (target 3 h)`, `36 tutors`).
 *
 *  Pure and deterministic: the arrow only appears when a baseline exists, so a
 *  row without one never reads as a delta it did not declare. The unit is
 *  repeated on both sides of the arrow — `72 → 4 h` is ambiguous about which
 *  number carried the unit. */
export function formatMetric(metric: AchievementMetric): string {
  const unit = metric.unit;
  const suffix =
    metric.target !== undefined && metric.value !== undefined
      ? ` (target ${metric.target} ${unit})`
      : "";
  const direction =
    metric.direction !== undefined && metric.direction !== "increase"
      ? ` · ${metric.direction}`
      : "";
  if (metric.baseline !== undefined && metric.value !== undefined) {
    return `${metric.baseline} ${unit} → ${metric.value} ${unit}${suffix}${direction}`;
  }
  if (metric.value !== undefined) return `${metric.value} ${unit}${suffix}${direction}`;
  if (metric.target !== undefined) return `target ${metric.target} ${unit}${direction}`;
  return `— ${unit}${direction}`;
}

/** The pointer a row declares, or `(no pointer)` — the capture-first posture made
 *  visible instead of implying that every row is proven (§23). */
export function achievementPointer(achievement: Achievement): string {
  if (achievement.source !== undefined) return achievement.source;
  if (achievement.artifactId !== undefined) return `artifacts:${achievement.artifactId}`;
  if (achievement.credentialId !== undefined) return `credentials:${achievement.credentialId}`;
  return "(no pointer)";
}

/** The one-line human rendering of a row: `[status] statement — metric · basis · pointer`.
 *
 *  A row with no derived status is labelled by its KIND (F1 of the pre-merge
 *  review): a `kind: metric` row that declares only a `unit` — valid per §23.2,
 *  it has nothing to plan or measure — was printed as `[milestone]`, i.e. as the
 *  other kind. The label only falls back to the kind when there is no status. */
function rowLine(achievement: Achievement): string {
  const status = achievementStatus(achievement);
  const label = status ?? achievement.kind;
  const metric =
    achievement.kind === "metric" && achievement.metric !== undefined
      ? ` — ${formatMetric(achievement.metric)}`
      : "";
  return `[${label}] ${textOf(achievement.statement)}${metric} · basis: ${achievement.basis} · ${achievementPointer(achievement)}`;
}

/** Group rows by their FIRST ref (declaration order); `Unattached` collects rows
 *  without refs and always prints last. A row with several refs appears once —
 *  the group is a reading aid, and duplicating a result would reintroduce the
 *  per-row `outcomes[]` duplication D24 rejected. */
export function groupByRef(achievements: readonly Achievement[]): Map<string, Achievement[]> {
  const groups = new Map<string, Achievement[]>();
  for (const achievement of achievements) {
    const key = achievement.refs?.[0] ?? "Unattached";
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [achievement]);
    else bucket.push(achievement);
  }
  return new Map(
    [...groups.entries()].sort(([a], [b]) =>
      a === "Unattached" ? 1 : b === "Unattached" ? -1 : a < b ? -1 : a > b ? 1 : 0,
    ),
  );
}

function loadOrReport(
  command: string,
  workspace: string,
): { profile: LoadedProfile } | { fail: number } {
  try {
    return { profile: load(workspace) };
  } catch (err) {
    if (err instanceof SchemaValidationError || err instanceof LoadError) {
      return {
        fail: report(command, false, EXIT.FAIL, {
          error: {
            kind: "load",
            message: err.message,
            ...(err instanceof SchemaValidationError ? { violations: [...err.issues] } : {}),
          },
        }),
      };
    }
    throw err;
  }
}

/** The rows this view emits: the whole log, or only the planned goals. */
export function targetRows(profile: LoadedProfile): Achievement[] {
  return profile.achievements.filter((a) => achievementStatus(a) === "planned");
}

export function achievementsPayload(
  achievements: readonly Achievement[],
  undated = 0,
): AchievementsPayload {
  return {
    schemaVersion: ACHIEVEMENTS_SCHEMA_VERSION,
    // `scope` counts the rows THIS view returned: an empty scope must read as
    // "nothing declared/measured here", never as a fabricated zero (§7.1 shape).
    // `undated` is NOT a status bucket: it declares the date-less rows the range
    // could not place (#497).
    scope: { ...achievementScope(achievements), undated },
    achievements: achievements.map((a) => ({ ...a, status: achievementStatus(a) ?? null })),
  };
}

/** The human label of a range, WITH its preposition — callers never prepend one
 *  (`in from 2010-01-01` was the defect): both bounds, or the one declared. */
export function rangeLabel(range: { since?: string; until?: string }): string {
  if (range.since !== undefined && range.until !== undefined) {
    return `in ${range.since} … ${range.until} (inclusive)`;
  }
  if (range.since !== undefined) return `since ${range.since} (inclusive)`;
  return `through ${range.until} (inclusive)`;
}

export function runAchievements(args: AchievementsArgs): number {
  const loaded = loadOrReport("achievements", args.workspace);
  if ("fail" in loaded) return loaded.fail;

  let selection: AchievementSelection;
  try {
    selection = selectRows(loaded.profile.achievements, args);
  } catch (err) {
    if (err instanceof UsageError) {
      return report("achievements", false, EXIT.USAGE, {
        error: { kind: "usage", message: err.message },
      });
    }
    throw err;
  }
  const { rows, considered, undated, range } = selection;

  if (isJsonMode()) {
    return report("achievements", true, EXIT.OK, { data: achievementsPayload(rows, undated) });
  }

  if (rows.length === 0) {
    if (range !== null && considered > 0) {
      // A declared range that matches nothing is NOT an empty log: #497 requires
      // the range and the count, and the add-file hint would be false.
      section(
        args.targets === true
          ? `Achievements — 0 of ${considered} planned target(s) ${rangeLabel(range)}`
          : `Achievements — 0 of ${considered} row(s) ${rangeLabel(range)}`,
      );
      line(
        args.targets === true
          ? `No planned goal falls ${rangeLabel(range)}.`
          : `No dated row falls ${rangeLabel(range)}.`,
      );
      if (undated > 0) {
        line(
          `${undated} row(s) declare no \`date\` and are NOT placed in this range — undated is reported, never hidden.`,
        );
      }
      return EXIT.OK;
    }
    // Nothing was declared (or no goal exists): the empty message is the truth,
    // and under `--targets` a declared range is still named so the filter is
    // visible.
    section(
      args.targets === true
        ? `Achievements — no planned targets${range === null ? "" : ` ${rangeLabel(range)}`}`
        : `Achievements — the log is empty${range === null ? "" : ` ${rangeLabel(range)}`}`,
    );
    line(
      args.targets === true
        ? "No row declares a `target` without a `value` yet — the goal view is empty."
        : "Add facts/achievements.yaml: one row per result, with `basis` and `visibility` (D24).",
    );
    return EXIT.OK;
  }

  const scope = achievementScope(rows);
  const period =
    range === null
      ? ""
      : args.targets === true
        ? ` ${rangeLabel(range)}${undated > 0 ? ` · ${undated} undated goal(s) included` : ""}`
        : ` ${rangeLabel(range)}${undated > 0 ? ` · ${undated} undated not placed` : ""}`;
  const undatedNote = range === null && undated > 0 ? ` · undated ${undated}` : "";
  section(
    args.targets === true
      ? `Achievements — ${scope.total} planned target(s)${period}`
      : `Achievements — ${scope.total} row(s)${period} · planned ${scope.planned} · measured ${scope.measured} · achieved ${scope.achieved} · partial ${scope.partial}${undatedNote}`,
  );
  if (range !== null && undated > 0 && args.targets !== true) {
    line("");
    line(
      `${undated} row(s) declare no \`date\` and are NOT placed in this range — undated is reported, never hidden.`,
    );
  }
  for (const [group, groupRows] of groupByRef(rows)) {
    line("");
    line(group === "Unattached" ? "Unattached" : group);
    for (const achievement of groupRows) {
      const refs = achievement.refs ?? [];
      const extra = refs.length > 1 ? ` [also: ${refs.slice(1).join(", ")}]` : "";
      line(`  ${rowLine(achievement)}${extra}`);
    }
  }
  line("");
  line(
    "Status is DERIVED from the numbers (planned · measured · achieved · partial) — never stored.",
  );
  return EXIT.OK;
}
