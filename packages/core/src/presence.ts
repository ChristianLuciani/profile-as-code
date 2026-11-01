/**
 * D23 — the presence surface and the release fan-out (SPEC §22, issue #262).
 *
 * The unit of first class is the **presence surface**, not the profile. Two
 * consequences this module owns, both DERIVED and stored nowhere:
 *
 *   presenceBoard(profile)        the daily board: every surface a release has
 *                                 addressed, at its newest release, with state;
 *   releasePlan(profile, id?)     one release's ordered fan-out + base text.
 *
 * **No second state model.** A surface's state is the ledger's own
 * `in-sync` / `stale` / `never` (§19), derived from `deployments` for the release's
 * own `changedUnits`:
 *
 *   ANY changed unit has no ledger record on that surface  → never
 *   every changed unit has a record, and some record's
 *   contentHash != the unit's current hash                  → stale
 *   every record matches                                    → in-sync
 *
 * Partial coverage is NEVER in-sync: a release that changed two units and the
 * surface confirmed only one still owes the other, and `missingUnits` names it.
 *
 * **Two causes, two fields (#408).** "No ledger record" and "no such SSOT unit"
 * both make a surface `never`, but they mean opposite things to the operator: the
 * first is a pending fan-out of a CORRECT row, the second is the row being wrong.
 * They travel separately (`missingUnits` / `unknownUnits`) so a consumer never
 * reports one as the other.
 *
 * A surface the ledger cannot record (a repo-meta/distribution slug outside the
 * platform enum) therefore reads `never`: the honest v1 answer — the plan names
 * what must be touched; closing that loop is a later contract change, never a
 * second state invented here.
 *
 * Offline, deterministic, no clock: ordering is kind rank → registry slug.
 */

import { PLATFORM_KINDS, type SurfaceKind } from "./generated/platforms.gen.js";
import { trackableUnits } from "./ledger.js";
import type { LoadedProfile } from "./types.js";

/** A release row from the workspace (schema v1.15, D23). */
export type Release = NonNullable<LoadedProfile["releases"]>[number];

/** The state a surface carries for a release — the §19 ledger vocabulary. */
export type PresenceState = "in-sync" | "stale" | "never";

/** Fan-out order: the artifact's metadata → the identity bodies → the announcements. */
const KIND_RANK: Readonly<Record<SurfaceKind, number>> = {
  "repo-meta": 0,
  profile: 1,
  distribution: 2,
};

/** The per-kind editorial frame of the base text. The COPY per channel lives in
 *  `skills/` (D23 item 4 / rule 7); this is only the factual spine a skill starts
 *  from, derived from the release row and nothing else. */
const BASE_FRAME: Readonly<Record<SurfaceKind, string>> = {
  "repo-meta": "What shipped",
  profile: "Now on the profile",
  distribution: "Announcement",
};

/** An addressed surface that the registry does not know is a typo, not a kind. */
export class PresenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresenceError";
  }
}

export interface ReleaseSurface {
  surface: string;
  kind: SurfaceKind;
  state: PresenceState;
  /** changedUnits this surface still owes: the key IS an SSOT unit, but the
   *  ledger has no record of it on THIS surface yet. Any entry here means the
   *  surface is `never`, never a partial `in-sync` — and it is a pending
   *  fan-out, not a defect in the release row (#408). */
  missingUnits: string[];
  /** changedUnits that resolve to no SSOT unit at all: a release row citing a
   *  deleted or mistyped key. This one IS a defect in the row — reported apart
   *  from `missingUnits` so a correct row is never sent to be "fixed" (#408). */
  unknownUnits: string[];
}

export interface BaseText {
  kind: SurfaceKind;
  /** The factual spine: `"<frame>: v<version> (<date>) — <summary.en | id>"`. */
  text: string;
}

export interface ReleasePlan {
  release: {
    id: string;
    version: string;
    date: string;
    summary: string;
    changedUnits: string[];
  };
  /** Ordered by kind (repo-meta → profile → distribution), then slug. */
  surfaces: ReleaseSurface[];
  /** One entry per kind PRESENT in `surfaces`, in fan-out order. */
  baseText: BaseText[];
}

export interface PresenceRow extends ReleaseSurface {
  /** The newest release that declares this surface. */
  releaseId: string;
  version: string;
}

export interface PresenceBoard {
  releases: number;
  latest: { id: string; version: string; date: string } | null;
  /** One row per surface, at the newest release that declares it. */
  surfaces: PresenceRow[];
  counts: Record<PresenceState, number>;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Newest first: date desc, then id desc (a stable, clock-free tie-break). */
function newestFirst(a: Release, b: Release): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return byText(b.id, a.id);
}

function kindOf(surface: string): SurfaceKind {
  const kind = PLATFORM_KINDS[surface];
  if (kind === undefined) {
    throw new PresenceError(
      `surface "${surface}" is not declared in platforms/registry.yaml — fix the release row (a typo must not silently build a plan)`,
    );
  }
  return kind;
}

/** The §19 ledger derivation for one `(release, surface)` pair. */
function surfaceState(
  profile: LoadedProfile,
  release: Release,
  surface: string,
  unitHashes: ReadonlyMap<string, string>,
): { state: PresenceState; missingUnits: string[]; unknownUnits: string[] } {
  const missingUnits: string[] = [];
  const unknownUnits: string[] = [];
  const changed = release.changedUnits ?? [];
  if (changed.length === 0) return { state: "never", missingUnits, unknownUnits };
  let stale = false;
  for (const key of changed) {
    const hash = unitHashes.get(key);
    // (a) No SSOT unit behind the key: the RELEASE ROW is wrong (a deleted or
    // mistyped key), so the operator has something to fix.
    if (hash === undefined) {
      unknownUnits.push(key);
      continue;
    }
    // `deployments` is keyed by ledger key then by the platform enum; a
    // non-profile surface simply has no record there (→ never, declared above).
    const record = (profile.deployments as Record<string, Record<string, unknown>>)[key]?.[
      surface
    ] as { contentHash?: unknown } | undefined;
    // (b) A valid SSOT unit with no record on THIS surface is a pending
    // fan-out, not an absence to ignore and not a row to fix: it makes the
    // surface `never` (SPEC §7.8/§22.2, #408).
    if (record === undefined) {
      missingUnits.push(key);
      continue;
    }
    if (record.contentHash !== hash) stale = true;
  }
  if (missingUnits.length > 0 || unknownUnits.length > 0) {
    return { state: "never", missingUnits, unknownUnits };
  }
  return { state: stale ? "stale" : "in-sync", missingUnits, unknownUnits };
}

function unitHashMap(profile: LoadedProfile): Map<string, string> {
  const map = new Map<string, string>();
  for (const unit of trackableUnits(profile)) {
    map.set(unit.key, unit.hash);
  }
  return map;
}

function compareSurfaces(a: ReleaseSurface, b: ReleaseSurface): number {
  const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  return rank !== 0 ? rank : byText(a.surface, b.surface);
}

/**
 * Release ids are addresses and surface lists are sets: a duplicate makes the
 * answer ambiguous (`selectRelease` would silently return the first) and, in the
 * ledger's own shape, duplicates are a D12 fail class. Refuse both with the exact
 * reason, never pick a winner.
 */
function assertUniqueReleases(releases: readonly Release[]): void {
  const ids = new Set<string>();
  for (const release of releases) {
    if (ids.has(release.id)) {
      throw new PresenceError(
        `release id "${release.id}" is declared more than once — release ids must be unique`,
      );
    }
    ids.add(release.id);
    const surfaces = new Set<string>();
    for (const surface of release.surfaces) {
      if (surfaces.has(surface)) {
        throw new PresenceError(
          `release "${release.id}" declares surface "${surface}" more than once — surfaces must be unique`,
        );
      }
      surfaces.add(surface);
    }
  }
}

/** The release a caller asked for, or the newest one (no clock, no guess). */
export function selectRelease(profile: LoadedProfile, id?: string): Release {
  assertUniqueReleases(profile.releases);
  const releases = [...profile.releases].sort(newestFirst);
  if (releases.length === 0) {
    throw new PresenceError(
      "the workspace declares no releases[] — add one to content/releases.yaml (schema v1.15, D23)",
    );
  }
  if (id === undefined) return releases[0] as Release;
  const found = releases.find((release) => release.id === id);
  if (found === undefined) {
    throw new PresenceError(
      `release "${id}" is not declared — known releases: ${releases.map((r) => r.id).join(", ")}`,
    );
  }
  return found;
}

/** One release's ordered fan-out and the per-kind factual spine. */
export function releasePlan(profile: LoadedProfile, id?: string): ReleasePlan {
  const release = selectRelease(profile, id);
  const unitHashes = unitHashMap(profile);
  const surfaces: ReleaseSurface[] = release.surfaces
    .map((surface) => {
      const kind = kindOf(surface);
      return {
        surface,
        kind,
        ...surfaceState(profile, release, surface, unitHashes),
      };
    })
    .sort(compareSurfaces);
  const summary = release.summary?.en ?? release.id;
  const kinds: SurfaceKind[] = [];
  for (const row of surfaces) if (!kinds.includes(row.kind)) kinds.push(row.kind);
  const baseText = kinds.map((kind) => ({
    kind,
    text: `${BASE_FRAME[kind]}: v${release.version} (${release.date}) — ${summary}`,
  }));
  return {
    release: {
      id: release.id,
      version: release.version,
      date: release.date,
      summary,
      changedUnits: [...(release.changedUnits ?? [])],
    },
    surfaces,
    baseText,
  };
}

/**
 * The daily board (option B, operator 2026-10-28): every surface the workspace's
 * releases have addressed, at its NEWEST release, with the same ledger-derived
 * state. Deriving from the newest release keeps the board a reading of the
 * releases, never a second ledger.
 */
export function presenceBoard(profile: LoadedProfile): PresenceBoard {
  assertUniqueReleases(profile.releases);
  const releases = [...profile.releases].sort(newestFirst);
  const unitHashes = unitHashMap(profile);
  const seen = new Map<string, PresenceRow>();
  for (const release of releases) {
    for (const surface of release.surfaces) {
      if (seen.has(surface)) continue;
      const kind = kindOf(surface);
      const state = surfaceState(profile, release, surface, unitHashes);
      seen.set(surface, {
        surface,
        kind,
        ...state,
        releaseId: release.id,
        version: release.version,
      });
    }
  }
  const rows = [...seen.values()].sort(compareSurfaces);
  const counts: Record<PresenceState, number> = { "in-sync": 0, stale: 0, never: 0 };
  for (const row of rows) counts[row.state] += 1;
  const latest = releases[0];
  return {
    releases: releases.length,
    latest:
      latest === undefined ? null : { id: latest.id, version: latest.version, date: latest.date },
    surfaces: rows,
    counts,
  };
}
