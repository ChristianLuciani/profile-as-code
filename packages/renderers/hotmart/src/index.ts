/**
 * Renderer `hotmart` (v1.9, issue #137) — Hotmart: the storefront's profile body [?] — the
 * surface field is not verified (no public docs of a profile About/body field; the Hotmart
 * Space "personalized web address" shape is unverified — probes 404'd the JS-rendered SPA,
 * 2026-10-05); the skill follow-up sources it. Paste platform
 * (D9: no management API for the profile body is documented — the developers.hotmart.com
 * APIs cover sales/products [? — developer docs unreachable today, 403/JS-shell, 2026-10-05],
 * so the deploy is a manual paste and `pasco status --mark` records it, D18 ledger,
 * `source: manual`; the per-platform skill follow-up owns the platform's sourced facts,
 * D16 parity caveat).
 * The artifact IS the paste source: `pasteSource()` (`@profile-as-code/paste`,
 * #150/#157) passes the ONE SSOT bios row through VERBATIM (`${bio.text}\n`) —
 * it neither ADDS nor STRIPS Markdown/HTML, so a markdown-bearing row would
 * reach the paste target as-is; keeping the row plain is the skill's job
 * (byte-stable, §15.1).
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
 * `long` > `medium` > `short` (Hotmart's profile body is the page's main
 * profile text — the longest curated bio wins), single-row emission (the D18
 * ledger hashes exactly one bios row — never a merge), empty → "" (unbuild,
 * §15.1). Never re-implement it per adapter (the `packages/markdown` precedent).
 */
export function render(p: PlatformProfile): RenderResult {
  return { text: pasteSource(p) };
}
