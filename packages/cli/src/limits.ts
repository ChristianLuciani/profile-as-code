/**
 * The offline text-limit executor (#240) — ONE home.
 *
 * It was born inside `pasco check` (PR #244) because that was the only caller.
 * #242 gives it a second consumer — the derived publication-truth line asked
 * `pasco status` the same question per surface — and a second copy is exactly the
 * duplication D5/AGENTS rule 7 forbids. `check.ts` and `publication.ts` both
 * import this module; the catalog stays where it was (`content/checks.yaml` ∪
 * `DEFAULT_CHECKS`, #255).
 *
 * Contract preserved from #240: deterministic, offline, WARN-only (D12: facts
 * warn, schema fails), `surface:` scopes a title cap off a bio, and a
 * non-numeric value is a warning about the CHECK — never a crash.
 */

import type { LoadedProfile, Platform } from "@profile-as-code/core";

/** A text-limit finding is WARN by contract (D12: facts warn, schema fails). */
export interface LimitFinding {
  severity: "warn";
  code: "max-chars" | "min-chars";
  message: string;
  path: string;
}

/** The rows the executor can measure today: headlines and bios. */
function limitRows(profile: LoadedProfile): {
  label: string;
  platform: string;
  surface: "headline" | "bio";
  text: string;
  path: string;
}[] {
  return [
    ...(profile.headlines ?? []).map((h) => ({
      label: `headline ${h.platform}/${h.lang}`,
      platform: h.platform,
      surface: "headline" as const,
      text: h.text,
      path: `headlines:${h.platform}:${h.lang}`,
    })),
    ...(profile.bios ?? []).map((b) => ({
      label: `bio ${b.platform}/${b.lang}/${b.length}`,
      platform: b.platform,
      surface: "bio" as const,
      text: b.text,
      path: `bios:${b.platform}:${b.lang}:${b.length}`,
    })),
  ];
}

/**
 * Execute the `max-chars` / `min-chars` rows of the (already platform-filtered)
 * check catalog over the rows that exist today. No network; an optional `surface`
 * selector keeps a title cap off the bio.
 *
 * `platform` scopes the report to that surface's rows — both a `platform: all`
 * cap and a cap declared for this platform. A per-surface report (the
 * publication-truth line) must never count another platform's rows.
 */
export function limitFindings(
  profile: LoadedProfile,
  checks: LoadedProfile["checks"],
  platform?: Platform,
): LimitFinding[] {
  const rows = limitRows(profile);
  const findings: LimitFinding[] = [];
  for (const check of checks) {
    if (check.rule !== "max-chars" && check.rule !== "min-chars") continue;
    // Scope the CHECK before anything else — including the catalog warning: a
    // malformed cap declared for another platform is not this surface's finding
    // (premerge #256 round 2, M1).
    if (platform !== undefined && check.platform !== "all" && check.platform !== platform) continue;
    if (typeof check.value !== "number" || !Number.isFinite(check.value)) {
      findings.push({
        severity: "warn",
        code: check.rule,
        message: `check ${check.id ?? "(no id)"} has a non-numeric ${check.rule} value — skipped`,
        path: `checks:${check.id ?? "?"}`,
      });
      continue;
    }
    for (const row of rows) {
      // A per-SURFACE report must not borrow another surface's rows: when a
      // platform is named, only its rows are in scope (this also makes the `all`
      // scope below a no-op, which is the intended meaning of "for <platform>").
      if (platform !== undefined && row.platform !== platform) continue;
      if (check.platform !== "all" && check.platform !== row.platform) continue;
      const surface = check.surface ?? "both";
      if (surface !== "both" && surface !== row.surface) continue;
      const length = [...row.text].length;
      const over = check.rule === "max-chars" && length > check.value;
      const under = check.rule === "min-chars" && length < check.value;
      if (!over && !under) continue;
      findings.push({
        severity: "warn",
        code: check.rule,
        message: `${row.label} has ${length} chars, ${over ? "over max" : "under min"} ${check.value}${
          check.note === undefined ? "" : ` — ${check.note}`
        }`,
        path: row.path,
      });
    }
  }
  return findings;
}
