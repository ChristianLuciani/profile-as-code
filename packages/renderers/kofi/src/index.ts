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

import { type PlatformProfile, pasteSource } from "@profile-as-code/core";

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
 * Render the About paste-source from the compile() slice, delegating to the
 * shared paste core (#150): length priority, single-row emission (the D18
 * ledger hashes exactly one bios row), empty → "" (unbuild, §15.1). Never
 * re-implement it per adapter (the `packages/markdown` precedent).
 */
export function render(p: PlatformProfile): RenderResult {
  return { text: pasteSource(p) };
}
