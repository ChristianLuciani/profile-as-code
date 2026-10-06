/**
 * Shared paste-renderer core (#150): the ONE home of the paste invariant —
 * adapters delegate, never re-implement (the `structured-data.ts` v1.6 /
 * `packages/markdown` precedent; AGENTS.md map).
 */
import type { BioLength, PlatformProfile } from "./types.js";

/** Deterministic body priority for a paste surface: `long` > `medium` > `short`. */
const LENGTH_PRIORITY: readonly BioLength[] = ["long", "medium", "short"];

/**
 * Paste-source text for a compile() slice: EXACTLY ONE bios row's verbatim
 * text + "\n" — never a merge, because the D18 ledger hashes exactly one row
 * (`bios:<platform>.<length>@<lang>`): a composite would hash something no
 * single row owns and staleness could never match. "" → unbuild (§15.1).
 */
export function pasteSource(p: PlatformProfile): string {
  for (const length of LENGTH_PRIORITY) {
    const bio = p.bios.find((b) => b.length === length);
    if (bio !== undefined) return `${bio.text}\n`;
  }
  return "";
}
