/**
 * Renderer `kofi` (v1.7, issue #130) — Ko-fi creator page About, paste platform
 * (D9: no API deploy). The artifact IS the paste source: plain text for the
 * Ko-fi About section — no Markdown syntax is emitted (see
 * skills/kofi/research for the sourced formatting facts).
 *
 * Deterministic: same input → same bytes (§15.1). No network, no AI, no
 * randomness. Facts pass through untouched from the SSOT; texts are the
 * platform+lang slice — compile() filters `bios` by EXACT platform+lang (bio
 * rows do NOT fall back to en), so a missing lang yields an empty artifact.
 * `pasco build` UNBUILDS on the empty render (no artifact left on disk, §15.1
 * pure function) — the skill's lang rule is what surfaces the gap to the
 * operator. There is no renderer-side lang override on purpose: the bios are
 * already the compile() slice, so one would be dead code.
 */

import type { PlatformProfile } from "@profile-as-code/core";

/** SPEC §7 Renderer contract (`deploySpec: 'git' | 'api' | 'manual'`). Ko-fi
 *  has no write API — the deploy is a MANUAL paste (D9; "paste" stays the
 *  prose term in the skill/playbook) and `pasco status --mark` records it
 *  (D18 ledger, `source: manual`). */
export const deploySpec = "manual" as const;

export interface RenderResult {
  text: string;
  assets?: string[];
}

/**
 * Deterministic length priority for the About body: `long` (the free-form
 * main body) > `medium` > `short` (the compact one-liner slot). Ko-fi's About
 * is the page's only profile body — the longest curated bio wins.
 */
const LENGTH_PRIORITY: readonly ("long" | "medium" | "short")[] = ["long", "medium", "short"];

/**
 * Render the About paste-source from the compile() slice. Emit exactly ONE
 * bios row's text — never a merge: the artifact maps 1:1 to the SSOT row the
 * deploy ledger hashes (D18); a merged text would hash a composite no single
 * row owns, and `pasco diff/status` staleness could never match. Empty string
 * = no ko-fi bio row for this platform+lang → the build skips the artifact.
 */
export function render(p: PlatformProfile): RenderResult {
  for (const length of LENGTH_PRIORITY) {
    const bio = p.bios.find((b) => b.length === length);
    if (bio !== undefined) return { text: `${bio.text}\n` };
  }
  return { text: "" };
}
