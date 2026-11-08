/**
 * platform-icons.ts — the icon-coverage rule (#511).
 *
 * `PLATFORM_ICONS` (generated from `platforms/registry.yaml`) is the ONE home of
 * badge/link icon metadata: a surface that draws an icon reads it and keeps no
 * table of its own. This module owns the rule that keeps that promise visible —
 * a `platform` named in `identity.links[]` with no icon entry is a WARN, never a
 * failure, because the link still renders as text: the missing badge is a
 * presentation gap, not a broken profile (severity decided on #511). The engine
 * holds no fallback icon map, so the silence that let a declared link ship with
 * no badge is gone.
 *
 * The rule is offline and deterministic: it compares declared data with declared
 * data, no network, no clock.
 */

import { PLATFORM_ICONS } from "./generated/platforms.gen.js";
import type { Profile } from "./types.js";

/** `check/link-platform-icon` finding — WARN by contract (the link still renders). */
export interface LinkIconFinding {
  /** Stable machine-readable code (the `pasco check` finding vocabulary). */
  code: "check/link-platform-icon";
  severity: "warn";
  /** Human-readable explanation in EN (docs convention, D8). */
  message: string;
  /** Dot-path into the profile where the finding lives. */
  path: string;
}

/**
 * One finding per platform that a declared identity link names without icon
 * metadata. Duplicates collapse — the subject is the PLATFORM, and reporting it
 * once per link would multiply the same gap by how many times it is linked.
 */
export function linkIconFindings(profile: Pick<Profile, "identity">): LinkIconFinding[] {
  const findings: LinkIconFinding[] = [];
  const seen = new Set<string>();
  for (const [index, link] of (profile.identity.links ?? []).entries()) {
    const platform = link.platform;
    if (platform === undefined || platform === "" || seen.has(platform)) continue;
    seen.add(platform);
    if (PLATFORM_ICONS[platform] !== undefined) continue;
    findings.push({
      code: "check/link-platform-icon",
      severity: "warn",
      // No path into the reader's workspace here: the icon table is engine data,
      // so a "fix this file" instruction would point at something they cannot
      // open (AGENTS.md rule 9).
      message: `identity link platform "${platform}" has no icon metadata — the badge is skipped and the link still renders as text (the icon table ships with the engine)`,
      path: `identity.links[${index}].platform`,
    });
  }
  return findings;
}
