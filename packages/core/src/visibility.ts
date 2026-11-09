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

import { isPublicEntry } from "./registry.js";
import type { Deployments, LoadedProfile, Profile } from "./types.js";

/** The row blocks whose visibility is optional with absent = private (v2.0).
 *  `achievements` is deliberately absent: it keeps `visibility` REQUIRED (v1.16,
 *  `pasco log` writes `private`), so there is nothing to migrate there.
 *  This is the MIGRATION set — not the set of blocks that carry the field (see
 *  {@link PUBLISHABLE_BLOCKS}); conflating the two leaked a private
 *  `achievements:` address through the public projection. */
export const VISIBILITY_BLOCKS = ["credentials", "artifacts", "projects", "experience"] as const;

export type VisibilityBlock = (typeof VISIBILITY_BLOCKS)[number];

/** Every row block that carries `visibility` (§18.5) — the four migration
 *  blocks plus `achievements`, whose field is required. The §19 address space a
 *  record can name is the union, so `publicProjection()` and the release/presence
 *  boards must filter over THIS set, never over the migration one. */
export const PUBLISHABLE_BLOCKS = [...VISIBILITY_BLOCKS, "achievements"] as const;

export type PublishableBlock = (typeof PUBLISHABLE_BLOCKS)[number];

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

/**
 * The §19.2 ledger keys whose entry is NOT publishable (D27). Only the blocks
 * that carry `visibility` can appear here — {@link PUBLISHABLE_BLOCKS}, i.e. the
 * four migration blocks **plus `achievements`**: `identity`, `bios`,
 * `headlines`, `skills`, `publications`, `education`, `press` and the handles
 * carry no field and are publishable by contract. A row without an `id` is not a
 * trackable unit, so it has no key to omit (§19.2: addressed ⇒ resolvable).
 *
 * One home, three readers: `publicProjection()` filters with it, and
 * `releasePlan`/`presenceBoard` report it as `notPublishableUnits` (§7.8).
 */
export function notPublishableKeys(profile: LoadedProfile): Set<string> {
  const keys = new Set<string>();
  for (const block of PUBLISHABLE_BLOCKS) {
    for (const row of (profile[block] ?? []) as { id?: string; visibility?: string }[]) {
      if (row.id !== undefined && !isPublicEntry(row)) keys.add(`${block}:${row.id}`);
    }
  }
  return keys;
}

/**
 * The D27 PUBLIC PROJECTION (SPEC §7.5): the loaded profile with every
 * non-public entry removed from the five blocks that carry visibility, the
 * ledger/release records that address those units dropped with them, and the
 * inbound pointers to a removed unit stripped from the rows that survive.
 *
 * What it is NOT: a re-derivation. Every surviving row carries the SAME values
 * `load()` returned (nothing is recomputed); the only edits are removals — the
 * invisible rows, the records addressed to them, and a pointer (`artifactRefs`,
 * `evidence[].credentialId`/`artifactId`) whose target is gone. A consumer never
 * sees a different fact, only a smaller set with no dangling join: `load()`
 * refuses a dangling ref in the SSOT, and the projection must keep that property
 * or the default export would hand out ids a reader cannot resolve. The roots
 * stay present (a list root that empties is `[]`, not absent), and the blocks
 * without a visibility field are passed through untouched — `identity`,
 * `bios`/`headlines`, `publications`, `press`, `education`, `skills`, `faq` and
 * the rest are public by contract (§18.5).
 *
 * `deployments` is keyed by the §19 ledger address, so a record for a private
 * unit leaks the unit's existence (and its name). It is dropped. `releases[]`
 * follows the same rule: `changedUnits` is filtered to the publishable keys, and
 * a release that changed only non-public units is omitted — its fan-out is not
 * public, so it has no public row. `active` needs no filter: it is keyed by
 * PLATFORM and chooses among `bios`/`headlines` variants, blocks that carry no
 * visibility field (§18.5).
 *
 * The leak rule (`pasco check`'s `no-private-in-public-output`) is what blocks a
 * PUBLIC row pointing at a private target at build time. This projection is not
 * a second copy of that gate: it is the view the gate's verdict produces, so a
 * workspace that has not run `check` still gets a self-consistent payload. It is
 * also not a renderer: no text is produced here.
 */
export function publicProjection(profile: LoadedProfile): LoadedProfile {
  const privateKeys = notPublishableKeys(profile);

  // The ledger: keep only records whose addressed unit is publishable.
  const deployments: Deployments = {};
  for (const [key, surfaces] of Object.entries(profile.deployments ?? {})) {
    if (privateKeys.has(key)) continue;
    deployments[key] = surfaces;
  }

  // The release events: a release whose changed set is entirely non-public has
  // no public fan-out (SPEC §7.8/§22.2), so it is not part of the projection.
  const releases = profile.releases.flatMap((release) => {
    const changed = release.changedUnits;
    if (changed === undefined) return [release];
    const publishable = changed.filter((key) => !privateKeys.has(key));
    if (changed.length > 0 && publishable.length === 0) return [];
    return [{ ...release, changedUnits: publishable }];
  });

  // Inbound pointers: a surviving row may reference a registry row the
  // projection just removed. Keeping the id would hand a consumer a join it
  // cannot resolve (§7.5's "every emitted id resolves"); the POINTER is dropped,
  // never the row, so the claim and its text stay published.
  const publicArtifacts = (profile.artifacts ?? []).filter(isPublicEntry);
  const publicCredentials = (profile.credentials ?? []).filter(isPublicEntry);
  const artifactIds = new Set(publicArtifacts.map((artifact) => artifact.id));
  const credentialIds = new Set(publicCredentials.map((credential) => credential.id));
  const keepArtifactRefs = (refs: readonly string[] | undefined): string[] | undefined =>
    refs === undefined ? undefined : refs.filter((id) => artifactIds.has(id));

  const projects = (profile.projects ?? []).filter(isPublicEntry).map((project) => {
    // Identity is preserved unless a pointer actually has to go: the audit maps a
    // finding back to the workspace row by reference (then by id), so cloning
    // every row would make an id-less row unaddressable (review D1).
    const refsNeedStrip = project.artifactRefs?.some((id) => !artifactIds.has(id)) ?? false;
    const evidenceNeedsStrip = (project.evidence ?? []).some(
      (evidence) =>
        (evidence.credentialId !== undefined && !credentialIds.has(evidence.credentialId)) ||
        (evidence.artifactId !== undefined && !artifactIds.has(evidence.artifactId)),
    );
    if (!refsNeedStrip && !evidenceNeedsStrip) return project;
    const row = { ...project };
    if (project.artifactRefs !== undefined)
      row.artifactRefs = keepArtifactRefs(project.artifactRefs);
    if (project.evidence !== undefined) {
      row.evidence = project.evidence.map((evidence) => {
        const claim = { ...evidence };
        if (claim.credentialId !== undefined && !credentialIds.has(claim.credentialId)) {
          delete claim.credentialId;
        }
        if (claim.artifactId !== undefined && !artifactIds.has(claim.artifactId)) {
          delete claim.artifactId;
        }
        return claim;
      });
    }
    return row;
  });
  const publications = (profile.publications ?? []).map((publication) => {
    if (publication.artifactRefs === undefined) return publication;
    if (publication.artifactRefs.every((id) => artifactIds.has(id))) return publication;
    return { ...publication, artifactRefs: keepArtifactRefs(publication.artifactRefs) };
  });
  const press = (profile.press ?? []).map((mention) => {
    if (mention.artifactRefs === undefined) return mention;
    if (mention.artifactRefs.every((id) => artifactIds.has(id))) return mention;
    return { ...mention, artifactRefs: keepArtifactRefs(mention.artifactRefs) };
  });

  return {
    ...profile,
    credentials: publicCredentials,
    artifacts: publicArtifacts,
    projects,
    experience: (profile.experience ?? []).filter(isPublicEntry),
    achievements: (profile.achievements ?? []).filter(isPublicEntry),
    publications,
    press,
    deployments,
    releases,
  };
}
