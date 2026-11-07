/**
 * visibility.ts — the D27 migration surface (issue #498, schema v2.0).
 *
 * `isPublicEntry()` is the ONE visibility rule (§18.5): only `public` leaves
 * the workspace. Since schema v2.0 an absent field means `private`, so a
 * pre-v2.0 workspace must run `pasco migrate` once to keep publishing exactly
 * what it published before; the migration writes `visibility: public` on the
 * rows that predate the rule.
 *
 * This module owns the SET of row blocks that carry the field (the schema is
 * the authority on each row's shape; this list only names the migration
 * surface). `pasco migrate`, `pasco doctor --contract-delta` and the golden
 * non-regression test read it, so the three surfaces cannot disagree on what
 * "a row still missing visibility" means.
 */

import type { Profile } from "./types.js";

/** The row blocks whose visibility is optional with absent = private (v2.0).
 *  `achievements` is deliberately absent: it keeps `visibility` REQUIRED (v1.16,
 *  `pasco log` writes `private`), so there is nothing to migrate there. */
export const VISIBILITY_BLOCKS = ["credentials", "artifacts", "projects", "experience"] as const;

export type VisibilityBlock = (typeof VISIBILITY_BLOCKS)[number];

/** One row that predates schema v2.0: it has no explicit visibility and would
 *  become private if the engine read it (D27). */
export interface MissingVisibilityRow {
  block: VisibilityBlock;
  /** Zero-based index inside the block (what `doctor` prints). */
  index: number;
  /** The row's stable id when it declares one — makes the report actionable. */
  id?: string;
}

/** Every row in the four migration blocks that does not declare `visibility`.
 *  Deterministic order (block declaration order, then row index). */
export function missingVisibility(profile: Pick<Profile, VisibilityBlock>): MissingVisibilityRow[] {
  const missing: MissingVisibilityRow[] = [];
  for (const block of VISIBILITY_BLOCKS) {
    const rows = profile[block] ?? [];
    for (const [index, row] of rows.entries()) {
      if (row.visibility !== undefined) continue;
      missing.push({ block, index, ...(row.id === undefined ? {} : { id: row.id }) });
    }
  }
  return missing;
}

/** True when the workspace still has pre-v2.0 rows (the migration is pending). */
export function needsVisibilityMigration(profile: Pick<Profile, VisibilityBlock>): boolean {
  return missingVisibility(profile).length > 0;
}
