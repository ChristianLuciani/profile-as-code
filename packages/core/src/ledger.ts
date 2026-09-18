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
 *  plus dangling ledger keys (removed units) and untracked rows. */
export function deployStatus(profile: LoadedProfile): LedgerReport {
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
    let stale = false;
    let deployed = 0;
    for (const [surface, record] of Object.entries(records)) {
      deployed += 1;
      const inSync = record.contentHash === unit.hash;
      surfaces[surface] = inSync ? "in-sync" : "stale";
      if (!inSync) stale = true;
    }
    return {
      ...unit,
      surfaces,
      state: stale ? "stale" : deployed > 0 ? "in-sync" : "never",
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
