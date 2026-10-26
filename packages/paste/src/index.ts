/**
 * Shared paste-renderer core (#150, re-homed in #157): the ONE home of the
 * paste invariant — every paste adapter delegates to `pasteSource()`, none
 * re-implements it (the `structured-data.ts` v1.6 / `packages/markdown`
 * precedent; AGENTS.md map).
 *
 * The module is blind to platform, voice, framing and format: it receives the
 * already-filtered `compile()` slice and only picks the row by length priority,
 * emitting it verbatim. If a platform ever needs a different composition than
 * "one row verbatim" (a header, links, its own truncation), that adapter keeps
 * its own logic and is not obliged to use this helper.
 */
import type { PlatformProfile } from "@profile-as-code/core";

/** Deterministic body priority for a paste surface: `long` > `medium` > `short`.
 *  Exported because a consumer that has to NAME the published row (`pasco edit`
 *  explains "the artifact publishes the `medium` bio") must not re-state it. */
export const PASTE_LENGTH_PRIORITY = ["long", "medium", "short"] as const;

/**
 * Paste-source text for a compile() slice: EXACTLY ONE bios row's verbatim
 * text + "\n" — never a merge, because the D18 ledger hashes exactly one row
 * per entry (`trackableUnits()`, SPEC §19.1): a composite would hash something
 * no single row owns and staleness could never match. "" → unbuild (§15.1).
 *
 * Two rows sharing `platform+lang+length` are not rejected upstream
 * (`registry.ts` dedupes credentials/artifacts only); `find` is first-match-wins
 * over `load`'s preserved input order. A schema-level bios-uniqueness rule is a
 * separate decision, not pinned here.
 */
export function pasteSource(p: PlatformProfile): string {
  for (const length of PASTE_LENGTH_PRIORITY) {
    const bio = p.bios.find((b) => b.length === length);
    if (bio !== undefined) return `${bio.text}\n`;
  }
  return "";
}
