/**
 * sameTextAcrossPlatforms(profile) — the ADVISORY narrative rule (SPEC §21.8).
 *
 * Facts are one and identical across surfaces; narrative is per surface. The
 * engine can never judge voice, but it CAN see the one mechanical signature of a
 * narrative that was propagated "for consistency" instead of written: two
 * different platforms carrying byte-identical text. That is a heuristic, so it
 * warns and cites — it never blocks (D12: facts warn, schema fails).
 *
 * What it compares:
 *
 *   `text/same-across-platforms`  a `headline` (any lang) or a `bio` of the same
 *                                 `length` whose text is byte-identical on two
 *                                 different platforms; the finding names every
 *                                 platform that shares it.
 *
 * What is exempt, by construction:
 *
 *   - the SAME platform across langs — a translation that happens to coincide is
 *     not homogenization (the comparison only fires on distinct platforms);
 *   - the bios of a DIFFERENT `length` — the same words at 160 and 300 chars is
 *     not the same text, it is a different row;
 *   - `identity.definition` — a single shared identity fact, not a per-platform
 *     text (SPEC §21.8); it is not in `headlines[]`/`bios[]`, so it is never read.
 *
 * Pure, deterministic, offline — no platform reads. Consumed by `pasco check`
 * (`packages/cli/src/commands/check.ts`); it is not a drift code, because drift
 * is the fact-contradiction register and this rule is about storytelling.
 */

import type { Platform, Profile } from "./types.js";

/** A text row the advisory can compare — headlines have no `length`. */
export type TextKind = "headline" | "bio";

/** A finding: a narrative shared verbatim by two or more different platforms. */
export interface TextFinding {
  /** WARN by contract: a copied narrative is not a schema or a fact failure. */
  severity: "warn";
  code: "text/same-across-platforms";
  kind: TextKind;
  /** Every platform that carries this exact text, in profile order. */
  surfaces: Platform[];
  /** The shared text, verbatim (the operator's own words). */
  text: string;
  message: string;
  path: string;
}

interface Row {
  platform: Platform;
  text: string;
  /** The bios' `length` band; absent for headlines (never part of the key). */
  bucket?: string;
  path: string;
}

/** Group by the exact comparison key, then keep the groups that span platforms. */
function acrossPlatforms(rows: Row[], kind: TextKind, keyOf: (row: Row) => string): TextFinding[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }

  const findings: TextFinding[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Distinct platforms only: the same platform across langs is exempt.
    const surfaces: Platform[] = [];
    for (const row of group) {
      if (!surfaces.includes(row.platform)) surfaces.push(row.platform);
    }
    if (surfaces.length < 2) continue;
    const first = group[0];
    if (first === undefined) continue;
    const excerpt = first.text.length > 60 ? `${first.text.slice(0, 57)}…` : first.text;
    findings.push({
      severity: "warn",
      code: "text/same-across-platforms",
      kind,
      surfaces,
      text: first.text,
      message: `the ${kind} "${excerpt}" is byte-identical on ${surfaces.join(", ")} — facts stay identical across surfaces, the narrative does not: identical text on different platforms is the signature of a copied narrative, not an adaptation (SPEC §21.8)`,
      path: first.path,
    });
  }
  return findings;
}

/** The advisory findings, in profile order: headlines first, then bios. */
export function sameTextAcrossPlatforms(profile: Profile): TextFinding[] {
  const headlines: Row[] = (profile.headlines ?? []).map((h) => ({
    platform: h.platform,
    text: h.text,
    path: `headlines:${h.platform}:${h.lang}`,
  }));
  const bios: Row[] = (profile.bios ?? []).map((b) => ({
    platform: b.platform,
    text: b.text,
    bucket: b.length,
    path: `bios:${b.platform}:${b.lang}:${b.length}`,
  }));

  return [
    ...acrossPlatforms(headlines, "headline", (row) => row.text),
    // Bios compare within their length band: a short and a long row are
    // different texts even when their opening words coincide (#462).
    ...acrossPlatforms(bios, "bio", (row) => `${row.bucket ?? ""}\u0000${row.text}`),
  ];
}
