/**
 * The `pasco status --json` report shape (D18, SPEC §19.5).
 *
 * One home for the payload BOTH write paths return (`status` and `status
 * --verify`), so a consumer sees a single shape and the additive §19.5 contract —
 * `units[].surfaces` (staleness) keeps its exact keys, `units[].certification` is
 * the new sibling — is asserted in one place rather than two.
 */

import type {
  CertificationRollup,
  LedgerReport,
  LoadedProfile,
  UnitStatus,
} from "@profile-as-code/core";
import { deployStatus } from "@profile-as-code/core";
import type { StatusArgs } from "./commands/status.js";

export function summaryOf(data: LedgerReport): {
  total: number;
  inSync: number;
  stale: number;
  never: number;
} {
  return {
    total: data.units.length,
    inSync: data.units.filter((u) => u.state === "in-sync").length,
    stale: data.units.filter((u) => u.state === "stale").length,
    never: data.units.filter((u) => u.state === "never").length,
  };
}

export function reportDataOf(data: LedgerReport, args: StatusArgs): Record<string, unknown> {
  return {
    workspace: args.workspace,
    platform: args.platformArg ?? null,
    ...summaryOf(data),
    units: data.units,
    untracked: data.untracked,
    removed: data.removed,
  };
}

/** The certification rollup of each trackable unit, keyed by ledger key — the
 *  ONE generated view (CHECKLIST.md) needs this shape, and it is a projection of
 *  the same read rule the report uses (`deployStatus`). */
export function certificationMap(
  profile: LoadedProfile,
): Record<string, CertificationRollup | null> {
  const map: Record<string, CertificationRollup | null> = {};
  for (const unit of deployStatus(profile).units) map[unit.key] = unit.certification;
  return map;
}

/** Filter the report to ONE surface (§19.3), carrying the §19.5 certification
 *  rollup along: a unit with no record on that surface has no certification →
 *  `null` (absence, the same rule as no ledger record). */
export function filterReport(reportData: LedgerReport, platform: string | undefined): LedgerReport {
  if (platform === undefined) return reportData;
  return {
    ...reportData,
    units: reportData.units.map((u): UnitStatus => {
      const onSurface = u.surfaces[platform];
      const state = onSurface === "in-sync" || onSurface === "stale" ? onSurface : "never";
      const surfaceCert = u.certification?.surfaces[platform];
      if (surfaceCert === undefined) return { ...u, surfaces: {}, state, certification: null };
      const certification = {
        state: surfaceCert.state,
        surfaces: { [platform]: surfaceCert },
        ...(surfaceCert.reason !== undefined ? { reason: surfaceCert.reason } : {}),
      };
      return {
        ...u,
        surfaces: onSurface === undefined ? {} : { [platform]: onSurface },
        state,
        certification,
      };
    }),
  };
}
