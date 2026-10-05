/**
 * Renderer `buymeacoffee` (v1.8, issue #133) — Buy Me a Coffee: the creator page's profile body [?] — the paste
 * surface (About) is not verified yet (bot-blocked/JS pages, probed 2026-10-05); the skill follow-up sources it. Paste platform
 * (D9: no management API for the profile body — the deploy is a manual paste and
 * `pasco status --mark` records it, D18 ledger, `source: manual`; the per-platform
 * skill follow-up owns the platform's sourced facts, D16 parity caveat).
 * The artifact IS the paste source: plain text — no Markdown syntax is emitted
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

/** SPEC §7 Renderer contract (`deploySpec: 'git' | 'api' | 'manual'`). */
export const deploySpec = "manual" as const;

export interface RenderResult {
  text: string;
  assets?: string[];
}

/**
 * Deterministic length priority for the profile body: `long` (the free-form
 * main body) > `medium` > `short` (the compact one-liner slot). Buy Me a Coffee's profile body
 * is the page's main profile text — the longest curated bio wins.
 */
const LENGTH_PRIORITY: readonly ("long" | "medium" | "short")[] = ["long", "medium", "short"];

/**
 * Render the profile paste-source from the compile() slice. Emit exactly ONE
 * bios row's text — never a merge: the artifact maps 1:1 to the SSOT row the
 * deploy ledger hashes (D18); a merged text would hash a composite no single
 * row owns, and `pasco diff/status` staleness could never match. Empty string
 * = no buymeacoffee bio row for this platform+lang → the build unbuilds the artifact.
 */
export function render(p: PlatformProfile): RenderResult {
  for (const length of LENGTH_PRIORITY) {
    const bio = p.bios.find((b) => b.length === length);
    if (bio !== undefined) return { text: `${bio.text}\n` };
  }
  return { text: "" };
}
