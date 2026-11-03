/**
 * `pasco achievements [--targets] [--json]` — the career impact log (D24, SPEC
 * §23, issue #446).
 *
 * A READ-ONLY view. It writes nothing, resolves nothing at the network and
 * derives everything from `content/achievements.yaml`: the status of each row
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
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";

/** The frozen contract version of the `--json` payload. */
export const ACHIEVEMENTS_SCHEMA_VERSION = "1";

export interface AchievementsArgs {
  workspace: string;
  /** Only the `planned` rows (the goal view). */
  targets?: boolean;
}

/** A row as the JSON view emits it: the declared fields plus the DERIVED status. */
export type AchievementView = Achievement & { status: AchievementStatus | null };

export interface AchievementsPayload {
  schemaVersion: string;
  scope: AchievementScope;
  achievements: AchievementView[];
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

export function achievementsPayload(achievements: readonly Achievement[]): AchievementsPayload {
  return {
    schemaVersion: ACHIEVEMENTS_SCHEMA_VERSION,
    // `scope` counts the rows THIS view returned: an empty scope must read as
    // "nothing declared/measured here", never as a fabricated zero (§7.1 shape).
    scope: achievementScope(achievements),
    achievements: achievements.map((a) => ({ ...a, status: achievementStatus(a) ?? null })),
  };
}

export function runAchievements(args: AchievementsArgs): number {
  const loaded = loadOrReport("achievements", args.workspace);
  if ("fail" in loaded) return loaded.fail;
  const rows = args.targets === true ? targetRows(loaded.profile) : loaded.profile.achievements;

  if (isJsonMode()) {
    return report("achievements", true, EXIT.OK, { data: achievementsPayload(rows) });
  }

  if (rows.length === 0) {
    section(
      args.targets === true
        ? "Achievements — no planned targets"
        : "Achievements — the log is empty",
    );
    line(
      args.targets === true
        ? "No row declares a `target` without a `value` yet — the goal view is empty."
        : "Add content/achievements.yaml: one row per result, with `basis` and `visibility` (D24).",
    );
    return EXIT.OK;
  }

  const scope = achievementScope(rows);
  section(
    args.targets === true
      ? `Achievements — ${scope.total} planned target(s)`
      : `Achievements — ${scope.total} row(s) · planned ${scope.planned} · measured ${scope.measured} · achieved ${scope.achieved} · partial ${scope.partial}`,
  );
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
