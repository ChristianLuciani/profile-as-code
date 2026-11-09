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
import { notPublishableKeys } from "./visibility.js";

/** A release row from the workspace (schema v1.15, D23). */
export type Release = NonNullable<LoadedProfile["releases"]>[number];

/** The state a surface carries for a release — the §19 ledger vocabulary. */
export type PresenceState = "in-sync" | "stale" | "never";

/**
 * The kinds a RELEASE can address (#511): `identity` is a registry kind, not a
 * release one — a link target has no body to render, so a release row naming it
 * is a mistake, not a fan-out step. Excluding it here makes that a type error
 * rather than a runtime surprise, and `kindOf` refuses it with a reason.
 */
export type ReleaseSurfaceKind = Exclude<SurfaceKind, "identity">;

/** Fan-out order: the artifact's metadata → the identity bodies → the announcements. */
const KIND_RANK: Readonly<Record<ReleaseSurfaceKind, number>> = {
  "repo-meta": 0,
  profile: 1,
  distribution: 2,
};

/** The per-kind editorial frame of the base text. The COPY per channel lives in
 *  `skills/` (D23 item 4 / rule 7); this is only the factual spine a skill starts
 *  from, derived from the release row and nothing else. */
const BASE_FRAME: Readonly<Record<ReleaseSurfaceKind, string>> = {
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
  kind: ReleaseSurfaceKind;
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

/** A plan row: the derived state plus its 1-based fan-out position. `order` is
 *  the SAME number the human plan prints in its ORDER column (#421), so a
 *  machine consumer reads it instead of counting array indices — an implicit
 *  contract a consumer can get wrong. Additive: the array order is unchanged. */
export interface ReleasePlanSurface extends ReleaseSurface {
  order: number;
}

export interface BaseText {
  kind: ReleaseSurfaceKind;
  /** The factual spine: `"<frame>: v<version> (<date>) — <summary.en | id>"`. */
  text: string;
}

export interface ReleasePlan {
  release: {
    id: string;
    version: string;
    date: string;
    summary: string;
    /** The PUBLIC changed set (D27): the keys this plan can fan out. The
     *  non-publishable ones travel in `notPublishableUnits`, never here. */
    changedUnits: string[];
  };
  /**
   * D27/§7.8: changed units whose entry is `private`/`unlisted`. They are NOT
   * `never` (that means missing) and NOT `in-sync`: they are simply not
   * publishable, so they get no fan-out step. A release that changed only
   * private units has no public fan-out (`surfaces: []`).
   */
  notPublishableUnits: string[];
  /** Ordered by kind (repo-meta → profile → distribution), then slug; each row
   *  carries its 1-based `order` (the human ORDER column, #421). */
  surfaces: ReleasePlanSurface[];
  /** One entry per kind PRESENT in `surfaces`, in fan-out order. */
  baseText: BaseText[];
}

export interface PresenceRow extends ReleaseSurface {
  /** The newest release that declares this surface. */
  releaseId: string;
  version: string;
  /** D27/§7.8: the non-publishable units of the release this row reads, so the
   *  board can say "this surface owes nothing because the change is private"
   *  without inventing a second state. */
  notPublishableUnits: string[];
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

function kindOf(surface: string): ReleaseSurfaceKind {
  const kind = PLATFORM_KINDS[surface];
  if (kind === undefined) {
    throw new PresenceError(
      `surface "${surface}" is not declared in platforms/registry.yaml — fix the release row (a typo must not silently build a plan)`,
    );
  }
  // #511: `identity` rows exist so `identity.links[].platform` resolves against
  // the registry — they are link targets, not fan-out surfaces. Refusing them
  // here is what keeps the typo guard real: a `github` (instead of
  // `github-readme`) in a release row is still an error, now named for what it
  // is rather than accepted as a profile surface.
  if (kind === "identity") {
    throw new PresenceError(
      `surface "${surface}" is an identity link target (kind: identity) — it has no renderable body, so a release cannot address it; did you mean the platform whose body the engine renders?`,
    );
  }
  return kind;
}

/** The §19 ledger derivation for one `(release, surface)` pair, over the
 *  PUBLISHABLE changed set (D27: a private unit has no fan-out step). */
function surfaceState(
  profile: LoadedProfile,
  changedUnits: readonly string[],
  surface: string,
  unitHashes: ReadonlyMap<string, string>,
): { state: PresenceState; missingUnits: string[]; unknownUnits: string[] } {
  const missingUnits: string[] = [];
  const unknownUnits: string[] = [];
  const changed = changedUnits;
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
  const privateKeys = notPublishableKeys(profile);
  const declared = release.changedUnits ?? [];
  const notPublishableUnits = declared.filter((key) => privateKeys.has(key));
  const publishable = declared.filter((key) => !privateKeys.has(key));
  // D27/§7.8: a release that changed only non-public units has NO public
  // fan-out. `surfaces: []` says exactly that — it never turns them into
  // `never` rows (which would ask the operator to fix a correct row).
  const noPublicFanOut = declared.length > 0 && publishable.length === 0;
  const surfaces: ReleasePlanSurface[] = noPublicFanOut
    ? []
    : release.surfaces
        .map((surface) => {
          const kind = kindOf(surface);
          return {
            surface,
            kind,
            ...surfaceState(profile, publishable, surface, unitHashes),
          };
        })
        .sort(compareSurfaces)
        .map((row, index) => ({ order: index + 1, ...row }));
  const summary = release.summary?.en ?? release.id;
  const kinds: ReleaseSurfaceKind[] = [];
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
      changedUnits: publishable,
    },
    notPublishableUnits,
    surfaces,
    baseText,
  };
}

/**
 * The daily board (option B, operator 2026-10-28): every surface the workspace's
 * releases have addressed, at its NEWEST release, with the same ledger-derived
 * state. Deriving from the newest release keeps the board a reading of the
 * releases, never a second ledger.
 *
 * D27: it reads the public projection. A release that changed only private
 * units has no public fan-out, so it is not a board row's newest release — the
 * private units travel as `notPublishableUnits`, never as a `never` surface.
 */
export function presenceBoard(profile: LoadedProfile): PresenceBoard {
  assertUniqueReleases(profile.releases);
  const privateKeys = notPublishableKeys(profile);
  const published = [...profile.releases].sort(newestFirst).filter((release) => {
    const declared = release.changedUnits ?? [];
    return declared.length === 0 || declared.some((key) => !privateKeys.has(key));
  });
  const unitHashes = unitHashMap(profile);
  const seen = new Map<string, PresenceRow>();
  for (const release of published) {
    const declared = release.changedUnits ?? [];
    const publishable = declared.filter((key) => !privateKeys.has(key));
    const notPublishableUnits = declared.filter((key) => privateKeys.has(key));
    for (const surface of release.surfaces) {
      if (seen.has(surface)) continue;
      const kind = kindOf(surface);
      const state = surfaceState(profile, publishable, surface, unitHashes);
      seen.set(surface, {
        surface,
        kind,
        ...state,
        releaseId: release.id,
        version: release.version,
        notPublishableUnits,
      });
    }
  }
  const rows = [...seen.values()].sort(compareSurfaces);
  const counts: Record<PresenceState, number> = { "in-sync": 0, stale: 0, never: 0 };
  for (const row of rows) counts[row.state] += 1;
  const latest = published[0];
  return {
    releases: published.length,
    latest:
      latest === undefined ? null : { id: latest.id, version: latest.version, date: latest.date },
    surfaces: rows,
    counts,
  };
}
