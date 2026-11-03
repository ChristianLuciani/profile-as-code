/**
 * achievements.ts — the career impact log (D24, SPEC §23, issue #446).
 *
 * The contract models what a person DID (`experience[].highlights`) and what can
 * be PROVEN (`projects[].evidence[]`), but not what CHANGED. This module owns the
 * one thing the block cannot store: the **status**, DERIVED from the numbers at
 * read time.
 *
 *   achievementStatus(a)   planned | measured | achieved | partial — or undefined
 *                          for a milestone (a point event has no progress) and for
 *                          a metric that declares neither `value` nor `target`
 *                          (nothing to plan, nothing to measure).
 *   achievementScope(list) the counters the CLI's `--json` `scope` reports, so
 *                          "nothing measured" is distinguishable from "clean"
 *                          (the `pasco audit` shape discipline, §7.1).
 *   checkAchievementIntegrity(profile) the post-Zod contract checks the generated
 *                          Zod cannot express (D12 fail class): duplicate ids,
 *                          dangling `refs`/`artifactId`/`credentialId`, the
 *                          `kind` ↔ `metric` invariant, and the §18.5 leak (a
 *                          PUBLIC achievement pointing at a private credential or
 *                          artifact). `load()` throws on any violation.
 *
 * Offline and deterministic (D19): no network, no clock, no AI. `direction` is
 * OPTIONAL — absent means `increase`, a DECLARED default (never inferred from the
 * baseline: a `72 → 4` row without a direction is `decrease` only if it says so).
 */

import { isPublicEntry, type RegistryIssue } from "./registry.js";
import type { LoadedProfile, Profile } from "./types.js";

/** A row of the impact log (schema v1.16, D24). */
export type Achievement = NonNullable<LoadedProfile["achievements"]>[number];
/** The numeric shape of a `metric` row. */
export type AchievementMetric = NonNullable<Achievement["metric"]>;
/** HOW the result is known — the honesty field, not a gate. */
export type AchievementBasis = NonNullable<Achievement["basis"]>;
/** Which way is better. */
export type AchievementDirection = NonNullable<AchievementMetric["direction"]>;
/** The DERIVED status. `planned` is a goal; `measured` a number with no goal. */
export type AchievementStatus = "planned" | "measured" | "achieved" | "partial";

/** Absent `direction` = `increase`. Declared here once; every reader calls it. */
export const DEFAULT_ACHIEVEMENT_DIRECTION: AchievementDirection = "increase";

/** The counters `pasco achievements --json` reports under `scope`. */
export interface AchievementScope {
  total: number;
  planned: number;
  measured: number;
  achieved: number;
  partial: number;
}

/**
 * The DIRECTION verdict for a row that has both `value` and `target`.
 * `increase`: value >= target · `decrease`: value <= target · `maintain`: equal.
 */
function directionMet(value: number, target: number, direction: AchievementDirection): boolean {
  switch (direction) {
    case "increase":
      return value >= target;
    case "decrease":
      return value <= target;
    case "maintain":
      return value === target;
  }
}

/**
 * The DERIVED status of one row (never stored, §23):
 *
 *   target, no value            planned
 *   value, no target            measured
 *   both, direction met         achieved
 *   both, direction not met     partial
 *   kind: milestone             undefined (a point event has no progress)
 *   metric with neither number  undefined (nothing to plan, nothing to measure)
 *
 * A `kind: milestone` row carrying a `metric` is a contract violation that
 * `checkAchievementIntegrity` rejects at load; this function does not guess a
 * status for it.
 */
export function achievementStatus(achievement: Achievement): AchievementStatus | undefined {
  if (achievement.kind !== "metric") return undefined;
  const metric = achievement.metric;
  if (metric === undefined) return undefined;
  const { value, target } = metric;
  if (target !== undefined && value === undefined) return "planned";
  if (value !== undefined && target === undefined) return "measured";
  if (value === undefined || target === undefined) return undefined;
  const direction = metric.direction ?? DEFAULT_ACHIEVEMENT_DIRECTION;
  return directionMet(value, target, direction) ? "achieved" : "partial";
}

/** The `scope` counters of a log: total plus one bucket per derived status. */
export function achievementScope(achievements: readonly Achievement[]): AchievementScope {
  const scope: AchievementScope = {
    total: achievements.length,
    planned: 0,
    measured: 0,
    achieved: 0,
    partial: 0,
  };
  for (const achievement of achievements) {
    const status = achievementStatus(achievement);
    if (status !== undefined) scope[status] += 1;
  }
  return scope;
}

/** The blocks a `refs[]` entry may address (the schema pattern, one home). */
const REF_BLOCKS = [
  "experience",
  "projects",
  "publications",
  "education",
  "press",
  "credentials",
  "artifacts",
] as const;
type RefBlock = (typeof REF_BLOCKS)[number];

/** `block:id` ids the profile actually declares, per block. */
function declaredIds(profile: Profile): Map<RefBlock, Set<string>> {
  const rows: Record<RefBlock, { id?: string }[] | undefined> = {
    experience: profile.experience,
    projects: profile.projects,
    publications: profile.publications,
    education: profile.education,
    press: profile.press,
    credentials: profile.credentials,
    artifacts: profile.artifacts,
  };
  const map = new Map<RefBlock, Set<string>>();
  for (const block of REF_BLOCKS) {
    const ids = new Set<string>();
    for (const row of rows[block] ?? []) if (row.id !== undefined) ids.add(row.id);
    map.set(block, ids);
  }
  return map;
}

function issue(path: string, message: string): RegistryIssue {
  return { path, message };
}

/**
 * Post-Zod contract checks for the impact log (load fails on any of them, D12):
 *
 * - duplicate `achievements[].id`;
 * - a `refs[]`, `artifactId` or `credentialId` that does not resolve (same class
 *   as the registry cross-refs: a dangling pointer is never silently ignored);
 * - `kind: metric` without `metric` / `kind: milestone` with one — the `if/then`
 *   the issue rejected is enforced here and in the CLI, not in JSON Schema;
 * - a PUBLIC achievement pointing at a `private`/`unlisted` credential or artifact
 *   (the §18.5 leak rule, same one `projects[].artifactRefs` answers to).
 */
export function checkAchievementIntegrity(profile: Profile): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const achievements = profile.achievements ?? [];
  const ids = declaredIds(profile);
  const credentials = profile.credentials ?? [];
  const artifacts = profile.artifacts ?? [];

  const seen = new Map<string, number>();
  for (const [index, achievement] of achievements.entries()) {
    const first = seen.get(achievement.id);
    if (first !== undefined) {
      issues.push(
        issue(
          `achievements[${index}].id`,
          `duplicate achievement id "${achievement.id}" (first used at achievements[${first}]) — achievement ids are unique per block (load fails, D12 fail class)`,
        ),
      );
    } else {
      seen.set(achievement.id, index);
    }

    // kind ↔ metric (§23 — the two shapes are exclusive; `if/then` is not used).
    if (achievement.kind === "metric" && achievement.metric === undefined) {
      issues.push(
        issue(
          `achievements[${index}].metric`,
          `kind: metric requires a "metric" block (unit is required; value/target/baseline are the numbers) — without it there is no status to derive`,
        ),
      );
    }
    if (achievement.kind === "milestone" && achievement.metric !== undefined) {
      issues.push(
        issue(
          `achievements[${index}].metric`,
          `kind: milestone must NOT carry a "metric" block — a point event has no progress to derive; use kind: metric, or move the numbers into the statement`,
        ),
      );
    }

    // refs[] — a dangling pointer is a load failure, not a warning.
    for (const [refIndex, ref] of (achievement.refs ?? []).entries()) {
      const separator = ref.indexOf(":");
      const block = ref.slice(0, separator) as RefBlock;
      const id = ref.slice(separator + 1);
      if (!ids.get(block)?.has(id)) {
        issues.push(
          issue(
            `achievements[${index}].refs[${refIndex}]`,
            `references ${block}[].id "${id}" which does not exist (dangling cross-ref, load fails)`,
          ),
        );
      }
    }

    if (achievement.credentialId !== undefined) {
      const credential = credentials.find((c) => c.id === achievement.credentialId);
      if (credential === undefined) {
        issues.push(
          issue(
            `achievements[${index}].credentialId`,
            `references credentials[].id "${achievement.credentialId}" which does not exist (dangling cross-ref, load fails)`,
          ),
        );
      } else if (achievement.visibility === "public" && !isPublicEntry(credential)) {
        issues.push(
          issue(
            `achievements[${index}].credentialId`,
            `a public achievement attests credential "${credential.id}" with visibility "${credential.visibility}" — public output renders only public entries (§18.5); make it public, or make the achievement non-public`,
          ),
        );
      }
    }

    if (achievement.artifactId !== undefined) {
      const artifact = artifacts.find((a) => a.id === achievement.artifactId);
      if (artifact === undefined) {
        issues.push(
          issue(
            `achievements[${index}].artifactId`,
            `references artifacts[].id "${achievement.artifactId}" which does not exist (dangling cross-ref, load fails)`,
          ),
        );
      } else if (achievement.visibility === "public" && !isPublicEntry(artifact)) {
        issues.push(
          issue(
            `achievements[${index}].artifactId`,
            `a public achievement points at artifact "${artifact.id}" with visibility "${artifact.visibility}" — public output renders only public entries (§18.5); make it public, or make the achievement non-public`,
          ),
        );
      }
    }

    // A public achievement that references a private entry THROUGH refs[] is the
    // same leak: the ref is what a renderer groups the row by.
    if (achievement.visibility === "public") {
      for (const [refIndex, ref] of (achievement.refs ?? []).entries()) {
        const separator = ref.indexOf(":");
        const block = ref.slice(0, separator);
        const id = ref.slice(separator + 1);
        const target =
          block === "credentials"
            ? credentials.find((c) => c.id === id)
            : block === "artifacts"
              ? artifacts.find((a) => a.id === id)
              : undefined;
        if (target !== undefined && !isPublicEntry(target)) {
          issues.push(
            issue(
              `achievements[${index}].refs[${refIndex}]`,
              `a public achievement references ${block}[].id "${id}" with visibility "${target.visibility}" — public output renders only public entries (§18.5)`,
            ),
          );
        }
      }
    }
  }

  return issues;
}
