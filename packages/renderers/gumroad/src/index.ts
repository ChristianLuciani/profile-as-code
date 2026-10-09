/**
 * Renderer `gumroad` (v1.8, issue #133) — Gumroad: the creator profile's profile body [?] — profile URLs
 * (`<user>.gumroad.com`) are verified live, 2026-10-05, but the profile page is an SPA: the bio FIELD is
 * not verified; the skill follow-up sources it. Paste platform
 * (D9: no management API for the profile body — the deploy is a manual paste and
 * `pasco status --mark` records it, D18 ledger, `source: manual`; the per-platform
 * skill follow-up owns the platform's sourced facts, D16 parity caveat).
 * The artifact IS the paste source: `pasteSource()` (`@profile-as-code/paste`,
 * #150/#157) passes the ONE SSOT bios row through VERBATIM (`${bio.text}\n`) —
 * it neither ADDS nor STRIPS Markdown/HTML, so a markdown-bearing row would
 * reach the paste target as-is; keeping the row plain is the skill's job
 * (the per-platform skill's research owns the sourced formatting facts,
 * applied by a human step — no check rule covers markdown absence; byte-stable,
 * §15.1).
 *
 * Deterministic: same input → same bytes (§15.1). No network, no AI, no
 * randomness. Facts pass through untouched from the SSOT; texts are the
 * platform+lang slice — compile() filters `bios` by EXACT platform+lang (bio
 * rows do NOT fall back to en), so a missing lang yields an empty artifact.
 * `pasco build` UNBUILDS on the empty render (no artifact left on disk, §15.1
 * pure function) — the skill's lang rule (follow-up) is what surfaces the gap to
 * the operator. There is no renderer-side lang override on purpose: the bios are
 * already the compile() slice, so one would be dead code.
 */

import type { PlatformProfile } from "@profile-as-code/core";
import { pasteSource } from "@profile-as-code/paste";

/** SPEC §7 Renderer contract (`deploySpec: 'git' | 'api' | 'manual'`). */
export const deploySpec = "manual" as const;

export interface RenderResult {
  text: string;
  assets?: string[];
}

/**
 * Render the profile paste-source from the compile() slice, delegating to the
 * shared paste core (`@profile-as-code/paste`, #150/#157): length priority
 * `long` > `medium` > `short` (Gumroad's profile body is the page's main
 * profile text — the longest curated bio wins), single-row emission (the D18
 * ledger hashes exactly one bios row — never a merge), empty → "" (unbuild,
 * §15.1). Never re-implement it per adapter (the `packages/markdown` precedent).
 */
export function render(p: PlatformProfile): RenderResult {
  return { text: pasteSource(p) };
}
