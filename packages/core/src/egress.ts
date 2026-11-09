/**
 * egress.ts — D28 egress authorization, the CONTRACT (SPEC §7.11, issue #503
 * slice S503a).
 *
 * D27 made `private` the default and the export public; it reduced the accident
 * but did not authorize anything: a `private → public` edit and a full `--all`
 * export are still operations an agent with write access can execute. D28 names
 * them what they are — **privileged acts** — and this module is the part of the
 * engine that can be shared by every egress surface: the exact MANIFEST of what
 * leaves, its digest, the comparison against the last recorded egress, and the
 * append-only audit record. Everything here is pure: file I/O (`.pasco/egress/`)
 * belongs to the CLI, which is the only writer (same split as §19's ledger).
 *
 * **S503a is the gate WITHOUT signatures.** The confirmation is the operator
 * echoing the manifest digest `--confirm sha256:…` — a receipt over the exact
 * manifest with no key behind it. S503b replaces it with a signed receipt
 * (hardware key/WebAuthn with user presence) that verifies offline; the record
 * carries `keyId: null` and `method: "digest-confirm"` today so that a signed
 * record is a FIELD appearing, never a different shape. The S503a limit is
 * declared, not papered over: an agent that can write the workspace can also run
 * the command with the digest, or delete `.pasco/egress/`; the key does not live
 * in the agent's environment until S503b.
 *
 * **What the digest covers.** The exact payload that leaves — the public
 * projection for a public egress, the whole SSOT for `--all` — under the
 * manifest version and the scope. It deliberately EXCLUDES the run metadata
 * (`source.commit`, `generatedAt`): the authorization is over the disclosed
 * data, so a commit that moves nothing does not invalidate a digest the operator
 * just read.
 *
 * **Why the disclosure units are keyed on the SSOT.** They are the rows whose
 * visibility decides egress (the four migration blocks plus `achievements`, the
 * fifth block that carries the field with it REQUIRED since v1.16). A row with a
 * stable `id` is addressed `block:id`; a row without one is addressed
 * `block[index]` at its SSOT position — never at its position in the filtered
 * projection, because filtering shifts those indices and every surviving row
 * would look new.
 *
 * The index address is a DECLARED limit, not a promise: it is only as stable as
 * the block's order. Inserting or removing a row before an id-less one renames
 * the later keys (a false POSITIVE — a confirmation prompt — which is safe), but a
 * DELETE followed by an INSERT at the same position reuses the key, and the new
 * row is then indistinguishable from a stable one: no transition is reported. A
 * stable `id` removes that class entirely, which is why §19.2 already treats an
 * id-less row as untrackable; the gate does the best it can with the address the
 * SSOT gives it instead of inventing one.
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "./ledger.js";
import { isPublicEntry } from "./registry.js";
import type { LoadedProfile } from "./types.js";
import { publicProjection, VISIBILITY_BLOCKS } from "./visibility.js";

/** The manifest contract version. Bumped additively when the record shape grows
 *  (S503b fills `keyId` with the signing key's id; the reader refuses a version
 *  it does not know). */
export const EGRESS_MANIFEST_VERSION = 1 as const;

/** Which view leaves the workspace: the D27 public projection or the full SSOT. */
export type EgressScope = "public" | "all";

/** The egress surfaces the gate covers in S503a. `build` writes the deploy
 *  artifacts and `export profile` hands the payload to a consumer; both are
 *  "publishing" in D28's sense. `preview` is deliberately NOT here — §7.9
 *  defines it as the local view "without publishing it" and gives it its own
 *  privacy gate. */
export type EgressOperation = "build" | "export-profile";

/** Why an egress is privileged. `--all` is a break-glass path (never the
 *  default); a private → public transition is the act D28 exists to authorize;
 *  an unreadable baseline makes the transition check IMPOSSIBLE, so the whole
 *  manifest has to be authorized instead of silently passing as clean. */
export type EgressReason = "private-to-public" | "full-export" | "baseline-unreadable";

/** The blocks whose rows are gated at egress. `VISIBILITY_BLOCKS` is the
 *  MIGRATION set (the four blocks whose field is optional with absent = private);
 *  `achievements` carries the same §18.5 rule with the field REQUIRED (v1.16),
 *  so it is gated here but has nothing to migrate. */
export const EGRESS_BLOCKS = [...VISIBILITY_BLOCKS, "achievements"] as const;

export type EgressBlock = (typeof EGRESS_BLOCKS)[number];

/** One row that leaves the workspace, addressed on the SSOT (§19.2 key style
 *  for rows that declare an `id`; `block[index]` otherwise). */
export interface EgressUnit {
  key: string;
  block: EgressBlock;
  /** Zero-based position inside the SSOT block — the index the key uses. */
  index: number;
  id?: string;
}

/** What a scope discloses, plus the digest that names it. `units` is the list
 *  the operator can read; `digest` is what the confirmation covers. */
export interface EgressManifest {
  version: typeof EGRESS_MANIFEST_VERSION;
  scope: EgressScope;
  units: EgressUnit[];
  /** `sha256:<hex>` over the canonical serialization of the disclosed payload. */
  digest: string;
}

/** The last egress the engine recorded for this workspace — the memory that
 *  makes "private → public" a transition instead of a state. Stored as STATE
 *  (`.pasco/egress/baseline.json`), never derived: it answers "what was
 *  disclosed before", which no current file can reconstruct. */
export interface EgressBaseline {
  version: typeof EGRESS_MANIFEST_VERSION;
  /** When the baseline was recorded (ISO 8601) — the audit record's timestamp. */
  at: string;
  /** Digest of the PUBLIC manifest it recorded. Validated on read (a malformed
   *  value makes the file unreadable) and the anchor a future signed receipt can
   *  name without re-deriving the payload. */
  digest: string;
  /** The keys of the units that were public at that egress. */
  publicUnits: string[];
}

/** One line of the append-only audit log (`.pasco/egress/audit.log`). The four
 *  fields D28 requires are `operation`, `digest`, `keyId` and `at`; `scope`,
 *  `units`, `method` and `reasons` are what make the line explainable without
 *  re-reading the workspace. `keyId` is `null` in S503a — the honest absence of
 *  the key S503b adds, never a fabricated id. `method` names HOW the act was
 *  authorized: `digest-confirm` (the operator echoed the manifest digest) or
 *  `none` (the egress was not privileged and needed no authorization). */
export interface EgressAuditRecord {
  version: typeof EGRESS_MANIFEST_VERSION;
  at: string;
  operation: EgressOperation;
  scope: EgressScope;
  digest: string;
  units: number;
  keyId: string | null;
  method: "digest-confirm" | "none";
  reasons: EgressReason[];
  /** What the gate had to compare against: the recorded baseline (`recorded`),
   *  none yet (`absent` — the first egress of a workspace, declared as the
   *  S503a limit) or an unreadable file (`unreadable` — the run was NOT silently
   *  treated as clean; it is on the record). */
  baseline: "recorded" | "absent" | "unreadable";
}

function rowsOf(profile: LoadedProfile, block: EgressBlock): Record<string, unknown>[] {
  const rows = (profile as unknown as Record<string, unknown>)[block];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Every row the scope discloses, in SSOT order (block order, then row index). */
export function disclosureUnits(profile: LoadedProfile, scope: EgressScope): EgressUnit[] {
  const units: EgressUnit[] = [];
  for (const block of EGRESS_BLOCKS) {
    rowsOf(profile, block).forEach((row, index) => {
      if (scope === "public" && !isPublicEntry(row)) return;
      const declared = row.id;
      const id = typeof declared === "string" && declared !== "" ? declared : undefined;
      units.push({
        key: id === undefined ? `${block}[${index}]` : `${block}:${id}`,
        block,
        index,
        ...(id === undefined ? {} : { id }),
      });
    });
  }
  return units;
}

/** The manifest of one egress: the units (SSOT-keyed) and the digest over the
 *  payload that actually leaves. */
export function egressManifest(profile: LoadedProfile, scope: EgressScope): EgressManifest {
  const view = scope === "public" ? publicProjection(profile) : profile;
  const digest = createHash("sha256")
    .update(canonicalJson({ version: EGRESS_MANIFEST_VERSION, scope, profile: view }))
    .digest("hex");
  return {
    version: EGRESS_MANIFEST_VERSION,
    scope,
    units: disclosureUnits(profile, scope),
    digest: `sha256:${digest}`,
  };
}

/** The baseline a manifest records — the PUBLIC manifest is the only valid
 *  input: the baseline answers "what was published", and `--all` publishes
 *  nothing even though it discloses everything. */
export function egressBaselineOf(manifest: EgressManifest, at: string): EgressBaseline {
  if (manifest.scope !== "public") {
    throw new Error(
      `egressBaselineOf: the baseline tracks the public manifest, got scope "${manifest.scope}"`,
    );
  }
  return {
    version: EGRESS_MANIFEST_VERSION,
    at,
    digest: manifest.digest,
    publicUnits: manifest.units.map((unit) => unit.key),
  };
}

/**
 * The private → public transition: units public NOW that were not public at the
 * last recorded egress. `null` (no baseline) detects nothing — the declared
 * S503a limit: a fresh workspace, a fresh clone or a deleted baseline has no
 * "before", and the first egress becomes the baseline. S503b's receipt closes
 * that hole by making the authorization itself the durable record.
 *
 * `null` also covers an UNREADABLE baseline, and the two are NOT the same fact:
 * the caller is the one that knows which one it read, and it must not let the
 * unreadable case borrow "nothing to compare" (the CLI makes it a privileged
 * reason instead — SPEC §7.11).
 */
export function newlyPublicUnits(
  manifest: EgressManifest,
  baseline: EgressBaseline | null,
): EgressUnit[] {
  if (manifest.scope !== "public") {
    throw new Error(`newlyPublicUnits: compare the public manifest, got scope "${manifest.scope}"`);
  }
  if (baseline === null) return [];
  const before = new Set(baseline.publicUnits);
  return manifest.units.filter((unit) => !before.has(unit.key));
}

/** The audit record of one egress. The caller supplies `at` (the ONE clock read
 *  of the gate — an audit line is history, not a rendered artifact) and `keyId`
 *  (`null` until S503b). */
export function egressAuditRecord(args: {
  at: string;
  operation: EgressOperation;
  manifest: EgressManifest;
  reasons: readonly EgressReason[];
  keyId: string | null;
  baseline: EgressAuditRecord["baseline"];
}): EgressAuditRecord {
  return {
    version: EGRESS_MANIFEST_VERSION,
    at: args.at,
    operation: args.operation,
    scope: args.manifest.scope,
    digest: args.manifest.digest,
    units: args.manifest.units.length,
    keyId: args.keyId,
    method: args.reasons.length > 0 ? "digest-confirm" : "none",
    reasons: [...args.reasons],
    baseline: args.baseline,
  };
}

/** One append-only line. JSONL: a record per line, so an append never rewrites
 *  a previous one (the writer opens with O_APPEND; this function owns the bytes). */
export function egressAuditLine(record: EgressAuditRecord): string {
  return `${JSON.stringify(record)}\n`;
}

/** Read an audit log without repairing it. A malformed line is REPORTED with its
 *  number — silently dropping it would make the trail look clean, and rewriting
 *  it would break append-only. */
export function parseEgressAudit(text: string): {
  records: EgressAuditRecord[];
  malformed: { line: number; reason: string }[];
} {
  const records: EgressAuditRecord[] = [];
  const malformed: { line: number; reason: string }[] = [];
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    if (raw.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (err) {
      malformed.push({ line, reason: `not JSON (${(err as Error).message})` });
      continue;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      malformed.push({ line, reason: "not a record object" });
      continue;
    }
    const record = value as Partial<EgressAuditRecord>;
    const problems: string[] = [];
    if (record.version !== EGRESS_MANIFEST_VERSION) problems.push("version");
    if (typeof record.at !== "string") problems.push("at");
    if (record.operation !== "build" && record.operation !== "export-profile") {
      problems.push("operation");
    }
    if (record.scope !== "public" && record.scope !== "all") problems.push("scope");
    if (typeof record.digest !== "string") problems.push("digest");
    if (typeof record.units !== "number") problems.push("units");
    if (record.keyId !== null && typeof record.keyId !== "string") problems.push("keyId");
    if (record.method !== "digest-confirm" && record.method !== "none") problems.push("method");
    if (!Array.isArray(record.reasons)) problems.push("reasons");
    if (
      record.baseline !== "recorded" &&
      record.baseline !== "absent" &&
      record.baseline !== "unreadable"
    ) {
      problems.push("baseline");
    }
    if (problems.length > 0) {
      malformed.push({ line, reason: `missing/invalid: ${problems.join(", ")}` });
      continue;
    }
    records.push({
      version: record.version as typeof EGRESS_MANIFEST_VERSION,
      at: record.at as string,
      operation: record.operation as EgressOperation,
      scope: record.scope as EgressScope,
      digest: record.digest as string,
      units: record.units as number,
      keyId: record.keyId as string | null,
      method: record.method as "digest-confirm" | "none",
      reasons: record.reasons as EgressReason[],
      baseline: record.baseline as EgressAuditRecord["baseline"],
    });
  }
  return { records, malformed };
}
