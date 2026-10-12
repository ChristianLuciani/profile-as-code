/**
 * D18 — per-entry deploy-status ledger (SPEC §19, issue #37).
 *
 * Deploy state is DATA (content/deployments.yaml), not hand-maintained prose.
 * This module owns everything the ledger needs beyond Zod:
 *
 *   - canonical hashing (sorted keys, sans ledger metadata id/origin — adding an
 *     id to an already-deployed entry must not flip it `stale`);
 *   - the §19.2 key space: root blocks, bios/headlines/skills/handles composite
 *     keys, row blocks addressed by their optional `id`;
 *   - integrity checks JSON Schema cannot express (uniqueness, ambiguity-when-
 *     addressed, key patterns — gen-zod drops `propertyNames`) — load() runs them
 *     post-Zod as a D12 fail-on-schema violation;
 *   - the status rollup `deployStatus` consumed by `pasco status`.
 *
 * Only `pasco` mutates the ledger (write rule shared with refine --choose, D14) —
 * the CLI writes via this module's hash, never by hand-edited YAML.
 */

import { createHash } from "node:crypto";
import type { LoadedProfile, Profile } from "./types.js";
import { PLATFORMS, textOf } from "./types.js";

/** Ledger metadata is provenance/identity, not content — stripped before hashing. */
const LEDGER_META = new Set(["id", "origin"]);

/** Canonical serialization: recursively sorted keys → stable across insertion order,
 *  YAML formatting and locale. This is what `contentHash` is computed over. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = sort((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/** SHA-256 (hex) of the canonical serialization of a unit, sans ledger metadata. */
export function hashUnit(unit: unknown): string {
  const stripped: Record<string, unknown> = {};
  if (unit !== null && typeof unit === "object" && !Array.isArray(unit)) {
    for (const [key, value] of Object.entries(unit as Record<string, unknown>)) {
      if (!LEDGER_META.has(key)) stripped[key] = value;
    }
  }
  return createHash("sha256").update(canonicalJson(stripped)).digest("hex");
}

/** The §19.2 ledger key space. Row blocks are prefixed `block:id`; scalar root
 *  blocks are addressed by their bare name. Enforced here AND in the schema's
 *  `propertyNames` (JSON Schema consumers) — Zod drops propertyNames, so load()
 *  re-checks with this exact pattern (single behavior, documented twice). */
export const LEDGER_KEY_PATTERN =
  /^(identity|positioning|keywords)$|^(bios|headlines|skills|socialHandles|experience|projects|publications|education|press):.+$/;

/** The row blocks that carry optional stable `id`s (v1.3, additive). */
const ROW_BLOCKS = ["experience", "projects", "publications", "education", "press"] as const;

export type UnitKind = "root" | "bio" | "headline" | "skill" | "handle" | "row";
export type Origin = "user" | "template";
export type SyncState = "in-sync" | "stale";

/* ---------------------------------------------------------------------------
 * §19.5 (v1.10, issue #132) — dual certification: the SECOND dimension.
 *
 * Orthogonal to staleness by construction: staleness answers "did the SSOT move
 * after the deploy was confirmed?" over `contentHash`; certification answers "how
 * was the deploy confirmed, and does the live surface still match?" over the
 * fetch evidence and the `artifactHash` anchor. Neither reads the other's
 * comparison, which is why `stale` + `verified` and `stale` +
 * `out-of-band-drift` are both expressible.
 * ------------------------------------------------------------------------- */

/** §19.5: the four values. Three are STRENGTHS of confirmation; the fourth
 *  (`out-of-band-drift`) is positive CONTRARY evidence — a completed check that
 *  contradicts the ledger — and folding it into any strength would make the
 *  report lie. */
export type CertificationState = "verified" | "attested" | "unverifiable" | "out-of-band-drift";

/** §19.5: per-`(ledgerKey, surface)` certification. The field set is NOT uniform:
 *  `state` selects what is meaningful (an `unverifiable` cannot borrow an
 *  `out-of-band-drift`'s digests). `ZodProfile` re-checks the shape at load; the
 *  schema is the serialization contract (D3). */
export interface SurfaceCertification {
  state: CertificationState;
  reason?: string;
  /** THE ANCHOR — the extractor's digest of the artifact as confirmed at deploy
   *  time. Compared against `liveHash`; never against a freshly re-rendered
   *  artifact (§19.5: that would conflate "the live page changed" with "the
   *  source moved"). */
  artifactHash?: string;
  method?: "fetch";
  fetchedAt?: string;
  liveHash?: string;
  evidenceUrl?: string;
}

/** The certification rollup of one unit (§19.5): the aggregate state, the
 *  per-surface detail it was folded from, and — when the rollup is not a
 *  confirmation — the representative reason. */
export interface CertificationRollup {
  state: CertificationState;
  reason?: string;
  surfaces: Record<string, SurfaceCertification>;
}

/** §19.5: what a surface's renderer adapter DECLARES about live verification.
 *  The extractor and the fetch allowlist live with the artifact's producer (the
 *  renderer adapter — one home); `core` never imports a renderer. Optional fields
 *  are the honest declaration of absence: no extractor means the fifth row of the
 *  §19.5 table (`unverifiable: no-extractor`). */
export interface SurfaceCapability {
  extractor?: (text: string) => string;
  fetchHosts?: readonly string[];
  /** The artifact URL, derived from the URL SSOT (§15.4/§18.4) — never a new
   *  hand-maintained field. `null` when the surface cannot derive one. */
  artifactUrl?: string | null;
}

/** surface → declared capability. A surface absent from the map declares nothing
 *  (§19.5 fifth row). */
export type SurfaceCapabilities = Readonly<Record<string, SurfaceCapability>>;

/** §19.5: the two non-fetchable reasons `core` derives from a declaration. The
 *  fetch-time reasons (`host-not-allowed`, `http-*`, `network-error`,
 *  `unattributed`) are produced by the pass, which owns the request. */
export type DeclaredUnverifiable = "no-extractor" | "no-artifact-url";

function reasonField(reason: string | undefined): { reason?: string } {
  return reason === undefined ? {} : { reason };
}

/** §19.5: the reason a DECLARATION yields for this surface — `undefined` when the
 *  surface can be checked today. One home for the ladder, shared by the read rule
 *  (`certifiedSurface`) and the pass (`attemptRecord`), so the two can never
 *  disagree about which surface is fetchable. */
export function declaredReason(
  capability: SurfaceCapability | undefined,
): DeclaredUnverifiable | undefined {
  if (capability === undefined || capability.extractor === undefined) return "no-extractor";
  if (capability.artifactUrl === null || capability.artifactUrl === undefined) {
    return "no-artifact-url";
  }
  return undefined;
}

/**
 * §19.5 — THE read rule: certification as it stands NOW for one
 * `(ledgerKey, surface)`, from the record and the surface's declared capability.
 *
 * The order is the whole point: the DECLARED ladder is judged first, then the
 * record, then the anchor. A stored `unverifiable` is not an answer — it is a
 * snapshot of a check that did not complete, so a surface that cannot be checked
 * today reads its current declared reason no matter what it recorded earlier
 * (§19.5: "the verdict cannot be lost by a stale write" — and, symmetrically, a
 * stale write cannot pin a derived verdict either). Confirmed states
 * (`attested`/`verified`/`out-of-band-drift`) ARE answers and are returned
 * verbatim; a `--mark` never becomes `verified`, only the C1 pass does that.
 *
 * A record with no block is NOT confirmation strength: with a capable surface it
 * has no anchor, so the honest reading is row 5 (`unattributed` — observable, not
 * judgeable), not `attested`. That is also the pre-v1.10 legacy record's true
 * state, and the declared v1 forward-only limit closes it with one `--mark`.
 */
export function certifiedSurface(
  record: SurfaceCertification | undefined,
  capability: SurfaceCapability | undefined,
): SurfaceCertification {
  const declared = declaredReason(capability);
  if (declared !== undefined) return { state: "unverifiable", reason: declared };

  // Fetchable today: a confirmed verdict stands; a snapshot does not.
  if (record?.state === "attested" || record?.state === "verified") return { ...record };
  if (record?.state === "out-of-band-drift") return { ...record };

  // §19.5 row 5 — a completed check whose record carries no anchor cannot judge;
  // neither can an attempt that did not complete. Either way the reason is
  // `unattributed`, derived here rather than pinned in the ledger.
  return { state: "unverifiable", reason: "unattributed" };
}

/** §19.5 rollup. *Fully certified* ⇔ every recorded surface is `verified` or
 *  `attested`. Per unit: `verified` when EVERY surface is `verified`; otherwise
 *  `attested` when all surfaces are in {`verified`, `attested`} with at least one
 *  `attested`; otherwise the most severe non-confirmed state present, ordered
 *  `out-of-band-drift` before `unverifiable`. `reason` names the leading
 *  non-confirmed surface (sorted surface order) so the rollup stays explainable
 *  without re-reading every surface. A unit with no surfaces has no certification
 *  (`null`) — that decision belongs to the caller, which knows about the ledger
 *  record; `null` is absence, never `never` (which belongs to staleness). */
export function certificationRollup(surfaces: Record<string, SurfaceCertification>): {
  state: CertificationState;
  reason?: string;
} {
  const entries = Object.entries(surfaces).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return { state: "attested" };
  if (entries.every(([, c]) => c.state === "verified")) return { state: "verified" };
  if (entries.every(([, c]) => c.state === "verified" || c.state === "attested")) {
    return { state: "attested" };
  }
  const drift = entries.find(([, c]) => c.state === "out-of-band-drift");
  const lead = drift ?? entries.find(([, c]) => c.state === "unverifiable");
  return { state: lead?.[1].state ?? "unverifiable", ...reasonField(lead?.[1].reason) };
}

/**
 * §19.5 — the verdict: a TOTAL function of (fetch outcome, anchor presence,
 * comparison) over one `(ledgerKey, surface)` record. Every combination lands
 * somewhere explicit; nothing is silently inherited. The five rows of the SPEC
 * table, in order:
 *
 *   1. fetch failed / non-2xx          → `unverifiable` (reason computed elsewhere)
 *   2. not fetchable (declared)        → `unverifiable: no-extractor` — `live === null`
 *   3. ok + anchor present + equal     → `verified`
 *   4. ok + anchor present + different → `out-of-band-drift: live-mismatch`
 *   5. ok + anchor absent              → `unverifiable: unattributed`
 *
 * `unverifiable` carries NO reason here because the reason is the caller's: the
 * fetch reasons (`http-403`, `http-429`, `network-error`) and the request-level
 * `host-not-allowed` are all the pass's knowledge, and `core` owns no request.
 *
 * Anchoring at confirmation also anchors the comparison: it is `liveHash` ↔
 * `artifactHash`, NEVER against a freshly re-rendered artifact — so an unrelated
 * unit's staleness can never decide this record's verdict.
 */
export function certificationVerdict(
  record: { certification?: SurfaceCertification },
  live: { status: number; digest?: string } | null,
): { state: CertificationState; reason?: string } {
  // Row 2 — declared non-fetchable, or no attempt was made.
  if (live === null) return { state: "unverifiable" };

  // Row 1 — the attempt did not complete. `core` does not invent the reason.
  if (live.status < 200 || live.status >= 300) return { state: "unverifiable" };

  const anchor = record.certification?.artifactHash;
  // Row 5 — observed but not judgeable: no anchor to compare against.
  if (anchor === undefined) return { state: "unverifiable", reason: "unattributed" };

  // A 2xx that produced no digest cannot judge either — same honest class: the
  // record is observable, the comparison never happened.
  if (live.digest === undefined) return { state: "unverifiable", reason: "unattributed" };

  // Row 3 / row 4 — the anchor is the only thing the live digest is compared to.
  return live.digest === anchor
    ? { state: "verified" }
    : { state: "out-of-band-drift", reason: "live-mismatch" };
}

/**
 * §19.5 — the ledger record a pass writes. `verdict` is the comparison; `digests`
 * is the fetch evidence the CLI observed (it owns the request). The anchor is
 * preserved from the existing record (`previous`) — a verification never rewrites
 * what the deploy confirmed. The `unverifiable` row is the RECORDED one: an
 * attempt that did not complete is durable evidence, not a transient print; a
 * DECLARED `unverifiable` never reaches here (it is derived at read time).
 */
export function attemptRecord(
  verdict: { state: CertificationState; reason?: string },
  evidence: {
    artifactHash?: string;
    liveHash?: string;
    fetchedAt?: string;
    evidenceUrl?: string;
  },
): SurfaceCertification {
  if (verdict.state === "verified") {
    return {
      state: "verified",
      ...(evidence.artifactHash !== undefined ? { artifactHash: evidence.artifactHash } : {}),
      method: "fetch",
      ...(evidence.fetchedAt !== undefined ? { fetchedAt: evidence.fetchedAt } : {}),
      ...(evidence.liveHash !== undefined ? { liveHash: evidence.liveHash } : {}),
      ...(evidence.evidenceUrl !== undefined ? { evidenceUrl: evidence.evidenceUrl } : {}),
    };
  }
  if (verdict.state === "out-of-band-drift") {
    return {
      state: "out-of-band-drift",
      reason: verdict.reason ?? "live-mismatch",
      ...(evidence.artifactHash !== undefined ? { artifactHash: evidence.artifactHash } : {}),
      ...(evidence.liveHash !== undefined ? { liveHash: evidence.liveHash } : {}),
      method: "fetch",
      ...(evidence.fetchedAt !== undefined ? { fetchedAt: evidence.fetchedAt } : {}),
      ...(evidence.evidenceUrl !== undefined ? { evidenceUrl: evidence.evidenceUrl } : {}),
    };
  }
  // `unverifiable` (or `attested`, which a pass never produces): honest
  // degradation — only the fields the attempt actually produced. The anchor is
  // NEVER part of this shape: an `unverifiable` with a comparison would lie.
  // DECLARED reasons do not belong here at all — they are derived at read time by
  // `certifiedSurface` from the surface's capability, never pinned into the file.
  return {
    state: "unverifiable",
    reason: verdict.reason ?? "network-error",
    ...(evidence.fetchedAt !== undefined || evidence.evidenceUrl !== undefined
      ? { method: "fetch" as const }
      : {}),
    ...(evidence.fetchedAt !== undefined ? { fetchedAt: evidence.fetchedAt } : {}),
    ...(evidence.evidenceUrl !== undefined ? { evidenceUrl: evidence.evidenceUrl } : {}),
  };
}

/** §19.5: the record a confirmation writes (`--mark`): `attested`, plus the
 *  anchor WHEN the surface has an extractor and the artifact rendered. A surface
 *  without an extractor records NO anchor — the declared forward-only v1 limit
 *  (a later `--verify` reports row 5 instead of pretending to judge). */
export function attestedRecord(anchor: string | undefined): SurfaceCertification {
  return { state: "attested", ...(anchor !== undefined ? { artifactHash: anchor } : {}) };
}

/** §19.5: the reason a completed fetch produced. `status: 0` is the transport
 *  failure the caller reports as `network-error`; a 2xx never lands here. */
export function fetchFailureReason(status: number): string {
  return status === 0 ? "network-error" : `http-${status}`;
}

/**
 * §19.5 — per-surface certification derived at READ time, from the ledger record
 * plus the surface's declared capability. The READ half of the dimension, and the
 * single home of the derivation rules `deployStatus` and `certifySurfaces` share:
 *
 *   - the record carries an `attested`/`verified`/durable-`unverifiable`/drift
 *     block → that block is the answer (an ATTEMPT is durable evidence);
 *   - a record with NO block reads `attested` when the surface can be checked
 *     live (every pre-v1.10 record was the human `--mark`);
 *   - otherwise the DECLARED reason (`no-extractor` / `no-artifact-url`) is
 *     derived here, so a workspace needs no ledger row per walled platform and a
 *     stale write cannot lose the verdict. A 403 from the platform's WAF is an
 *     ATTEMPT outcome (recorded, row 1 of the table) — not a declaration.
 */
export function certifySurfaces(
  profile: LoadedProfile,
  capabilities?: SurfaceCapabilities,
): Record<string, CertificationRollup | null> {
  const out: Record<string, CertificationRollup | null> = {};
  for (const unit of trackableUnits(profile)) {
    const records = profile.deployments?.[unit.key] ?? {};
    const surfaces: Record<string, SurfaceCertification> = {};
    for (const [surface, record] of Object.entries(records)) {
      surfaces[surface] = certifiedSurface(record.certification, capabilities?.[surface]);
    }
    const rollup = certificationRollup(surfaces);
    out[unit.key] =
      Object.keys(surfaces).length === 0
        ? null
        : { state: rollup.state, surfaces, ...reasonField(rollup.reason) };
  }
  return out;
}

export interface TrackableUnit {
  key: string;
  kind: UnitKind;
  block: string;
  /** Human label (role @ org, skill name, bio platform/lang/length…). */
  label: string;
  origin: Origin;
  /** SHA-256 of the unit sans id/origin — the deploy-time comparison basis. */
  hash: string;
}

export interface UnitStatus extends TrackableUnit {
  /** Deployed surfaces with their per-surface sync state. */
  surfaces: Record<string, SyncState>;
  /** Rollup: any stale → stale; any surface → in-sync; else never. */
  state: "never" | "in-sync" | "stale";
  /** §19.5 (v1.10, ADDITIVE): the certification rollup. `null` ⇔ the unit has no
   *  ledger record — absence, not `never` (which belongs to staleness). The
   *  staleness fields above are UNCHANGED, so existing consumers keep working. */
  certification: CertificationRollup | null;
}

export interface LedgerReport {
  units: UnitStatus[];
  untracked: { block: string; label: string }[];
  removed: { key: string; surfaces: string[] }[];
}

interface RowConfig {
  block: (typeof ROW_BLOCKS)[number];
  label: (row: Record<string, unknown>) => string;
}

const ROW_CONFIG: Record<(typeof ROW_BLOCKS)[number], RowConfig> = {
  experience: {
    block: "experience",
    label: (r) => `${textOf(r.role as string | undefined)} @ ${String(r.org ?? "")}`,
  },
  projects: { block: "projects", label: (r) => String(r.name ?? "") },
  publications: { block: "publications", label: (r) => String(r.title ?? "") },
  education: {
    block: "education",
    label: (r) => `${textOf(r.degree as string | undefined)} @ ${String(r.institution ?? "")}`,
  },
  press: { block: "press", label: (r) => textOf(r.title as string | undefined) },
};

/** Enumerate every §19.2 trackable unit of a profile, in a deterministic order.
 *  Rows without an `id` are NOT units — the caller lists them as untracked. */
export function trackableUnits(profile: LoadedProfile): TrackableUnit[] {
  const units: TrackableUnit[] = [];
  const push = (
    key: string,
    kind: UnitKind,
    block: string,
    label: string,
    unit: unknown,
    origin: Origin = "user",
  ) => {
    units.push({ key, kind, block, label, origin, hash: hashUnit(unit) });
  };

  // Root scalar blocks — the block itself is the unit (only when present).
  for (const block of ["identity", "positioning", "keywords"] as const) {
    const value = (profile as unknown as Record<string, unknown>)[block];
    if (value !== undefined) push(block, "root", block, block, value);
  }
  // Composite-key blocks.
  for (const bio of profile.bios) {
    push(
      `bios:${bio.platform}:${bio.lang}:${bio.length}`,
      "bio",
      "bios",
      `${bio.platform} ${bio.lang}/${bio.length}`,
      bio,
    );
  }
  for (const h of profile.headlines) {
    push(
      `headlines:${h.platform}:${h.lang}`,
      "headline",
      "headlines",
      `${h.platform} ${h.lang}`,
      h,
    );
  }
  for (const s of profile.skills) {
    push(`skills:${s.name}`, "skill", "skills", s.name, s);
  }
  for (const h of profile.socialHandles) {
    push(`socialHandles:${h.platform}`, "handle", "socialHandles", `${h.platform} @${h.handle}`, h);
  }
  // Row blocks — only rows carrying a stable id.
  for (const { block } of Object.values(ROW_CONFIG)) {
    const rows = (profile as unknown as Record<string, unknown>)[block];
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      if (typeof row.id !== "string" || row.id === "") continue;
      const origin: Origin = row.origin === "template" ? "template" : "user";
      push(`${block}:${row.id}`, "row", block, ROW_CONFIG[block].label(row), row, origin);
    }
  }
  return units;
}

/** Rows without an `id` — listed by `pasco status` as untracked (add one to track). */
export function untrackedRows(profile: LoadedProfile): { block: string; label: string }[] {
  const out: { block: string; label: string }[] = [];
  for (const { block } of Object.values(ROW_CONFIG)) {
    const rows = (profile as unknown as Record<string, unknown>)[block];
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      if (typeof row.id !== "string" || row.id === "") {
        out.push({ block, label: ROW_CONFIG[block].label(row) });
      }
    }
  }
  return out;
}

/** The status rollup (§19.3): current units ∩ ledger → in-sync / stale / never,
 *  plus dangling ledger keys (removed units) and untracked rows.
 *
 *  §19.5 (v1.10, issue #132): each unit ALSO carries the certification rollup of
 *  its recorded surfaces. Staleness is untouched — `stale` + `verified` stays a
 *  legal pair. `capabilities` declares which surfaces CAN be checked live; when
 *  omitted, no surface can (the derived `unverifiable: no-extractor` default),
 *  which is exactly the honest read for a caller that knows nothing about
 *  renderers. A record with no `certification` block reads `attested`. */
export function deployStatus(
  profile: LoadedProfile,
  capabilities?: SurfaceCapabilities,
): LedgerReport {
  const units = trackableUnits(profile);
  const ledger = profile.deployments ?? {};
  const byKey = new Set(units.map((u) => u.key));

  const removed: LedgerReport["removed"] = [];
  for (const [key, surfaces] of Object.entries(ledger)) {
    if (!byKey.has(key)) {
      removed.push({ key, surfaces: Object.keys(surfaces).sort() });
    }
  }

  const statuses: UnitStatus[] = units.map((unit) => {
    const records = ledger[unit.key] ?? {};
    const surfaces: Record<string, SyncState> = {};
    const certification: Record<string, SurfaceCertification> = {};
    let stale = false;
    let deployed = 0;
    for (const [surface, record] of Object.entries(records)) {
      deployed += 1;
      const inSync = record.contentHash === unit.hash;
      surfaces[surface] = inSync ? "in-sync" : "stale";
      if (!inSync) stale = true;
      certification[surface] = certifiedSurface(record.certification, capabilities?.[surface]);
    }
    const rollup = certificationRollup(certification);
    return {
      ...unit,
      surfaces,
      state: stale ? "stale" : deployed > 0 ? "in-sync" : "never",
      certification:
        deployed === 0
          ? null
          : { state: rollup.state, surfaces: certification, ...reasonField(rollup.reason) },
    };
  });

  return { units: statuses, untracked: untrackedRows(profile), removed };
}

export type LedgerIssue = { path: string; message: string };

/** Post-Zod integrity (D12 fail class) — everything the generated Zod cannot
 *  express. load() runs this and throws SchemaValidationError on any issue. */
export function checkLedgerIntegrity(profile: Profile): LedgerIssue[] {
  const issues: LedgerIssue[] = [];
  const root = profile as unknown as Record<string, unknown>;

  // 1. Duplicate ids within a row block — the ledger address must be unique.
  //    (The field is new in v1.3, so no pre-v1.3 workspace can violate this.)
  for (const block of ROW_BLOCKS) {
    const rows = root[block];
    if (!Array.isArray(rows)) continue;
    const seen = new Map<string, number>();
    rows.forEach((raw, index) => {
      const id = (raw as Record<string, unknown>).id;
      if (typeof id !== "string" || id === "") return;
      const count = seen.get(id) ?? 0;
      if (count > 0) {
        issues.push({
          path: `${block}[${index}].id`,
          message: `duplicate id "${id}" in ${block} — entry ids must be unique per block (D18 §19.2)`,
        });
      }
      seen.set(id, count + 1);
    });
  }

  const ledger = root.deployments as Record<string, Record<string, unknown>> | undefined;
  if (ledger === undefined) return issues;

  // 2. Ledger keys must be in the §19.2 key space (propertyNames is dropped by gen-zod).
  for (const key of Object.keys(ledger)) {
    if (!LEDGER_KEY_PATTERN.test(key)) {
      issues.push({
        path: `deployments.${key}`,
        message: `"${key}" is not a valid ledger key (D18 §19.2 key space: root block names or block:key composite)`,
      });
    }
  }

  // 3. Surface keys must be in the ONE platform enum (D16).
  const platforms = new Set<string>(PLATFORMS);
  for (const [key, surfaces] of Object.entries(ledger)) {
    for (const surface of Object.keys(surfaces)) {
      if (!platforms.has(surface)) {
        issues.push({
          path: `deployments.${key}.${surface}`,
          message: `surface "${surface}" is not in the platform set (D16)`,
        });
      }
    }
  }

  // 4. Ambiguous composite keys — fail ONLY when the ledger addresses them
  //    (a legacy workspace may legitimately carry duplicate natural keys;
  //    ambiguity is only a defect when something tries to address it).
  const compositeCount = (
    prefix: string,
    key: (row: Record<string, unknown>) => string,
    rows: unknown,
  ) => {
    if (!Array.isArray(rows)) return;
    const counts = new Map<string, number>();
    for (const raw of rows) {
      const k = key(raw as Record<string, unknown>);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [key2, count] of counts) {
      if (count > 1 && ledger[`${prefix}:${key2}`] !== undefined) {
        issues.push({
          path: `deployments.${prefix}:${key2}`,
          message: `ambiguous ledger key "${prefix}:${key2}" — ${count} rows share this natural key; disambiguate before tracking (D18 §19.2)`,
        });
      }
    }
  };
  compositeCount("bios", (r) => `${r.platform}:${r.lang}:${r.length}`, root.bios);
  compositeCount("headlines", (r) => `${r.platform}:${r.lang}`, root.headlines);
  compositeCount("skills", (r) => String(r.name), root.skills);
  compositeCount("socialHandles", (r) => String(r.platform), root.socialHandles);

  return issues;
}
