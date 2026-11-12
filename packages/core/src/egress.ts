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
 * **What the digest covers.** The exact PROFILE VIEW that leaves — the public
 * projection for a public egress, the whole SSOT for `--all` — under the manifest
 * version and the scope. It deliberately EXCLUDES two things: the run metadata
 * (`source.commit`, `generatedAt`), and a surface's own formatting/announcement
 * bytes (a Postiz payload's text, `date` and integration ids; a rendered
 * artifact's prose). The authorization is over the disclosed FACTS, so a commit
 * that moves nothing — or a re-render of the same facts — does not invalidate a
 * digest the operator just read.
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
 *  it does not know). Version 2 adds the integrity chain (#520): `prev`,
 *  `baselineHash` and `hash` on every audit line, `logTail` on the baseline —
 *  a pre-chain v1 log or baseline reads as `unreadable`, the safe direction
 *  (one `--confirm` re-arms the workspace). */
export const EGRESS_MANIFEST_VERSION = 2 as const;

/** Which view leaves the workspace: the D27 public projection or the full SSOT. */
export type EgressScope = "public" | "all";

/** The egress surfaces the gate covers in S503a. `build` writes the deploy
 *  artifacts, `export profile` hands the payload to a consumer and `post export`
 *  materializes the announcement payload (Postiz) from the workspace facts; all
 *  three are "publishing" in D28's sense. `preview` is deliberately NOT here —
 *  §7.9 defines it as the local view "without publishing it" and gives it its
 *  own privacy gate. */
export type EgressOperation = "build" | "export-profile" | "post-export";

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

/** The state paths, in the spelling every message and the SPEC use (a machine
 *  path in a published surface is rule-9 noise). The CLI re-exports these. */
export const EGRESS_AUDIT_REL = ".pasco/egress/audit.log";
export const EGRESS_BASELINE_REL = ".pasco/egress/baseline.json";

/** The digest shape every manifest/baseline/hash value must have. */
const SHA256 = /^sha256:[0-9a-f]{64}$/;

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
 *  disclosed before", which no current file can reconstruct.
 *
 *  ONE memory, ONE scope (#520): the baseline always records the PUBLIC
 *  manifest (`egressBaselineOf` refuses any other), and it is the gate's only
 *  comparison memory — the audit log is evidence, never a second memory. */
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
  /** The `hash` of the audit line this baseline sits at. A legitimately
   *  written baseline always has one (the append precedes the write), so an
   *  absent or unhash-shaped `logTail` is itself a failed binding. */
  logTail: string;
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
  /** The previous line's `hash`; `null` starts a chain segment — the first
   *  line of the log, or the re-arm after an unreadable state (#520). */
  prev: string | null;
  /** `sha256:` over the baseline state this line produced, EXCLUDING
   *  `logTail` — the content binding between the line and its memory. */
  baselineHash: string;
  /** `sha256:` over the canonical serialization of this line EXCLUDING `hash`
   *  and `baselineHash` — the chain link the next line's `prev` names. */
  hash: string;
}

/** The record before it is sealed: everything except the two chain fields the
 *  seal computes. */
export type EgressRecordCore = Omit<EgressAuditRecord, "hash" | "baselineHash">;

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

/** The baseline content a manifest records — the PUBLIC manifest is the only
 *  valid input: the baseline answers "what was published", and `--all`
 *  publishes nothing even though it discloses everything. The `logTail` that
 *  binds it to the audit line is added by `egressSeal`, which knows the line's
 *  hash; the content WITHOUT the binding is what `baselineHash` covers. */
export function egressBaselineOf(
  manifest: EgressManifest,
  at: string,
): Omit<EgressBaseline, "logTail"> {
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
  baseline: Pick<EgressBaseline, "publicUnits"> | null,
): EgressUnit[] {
  if (manifest.scope !== "public") {
    throw new Error(`newlyPublicUnits: compare the public manifest, got scope "${manifest.scope}"`);
  }
  if (baseline === null) return [];
  const before = new Set(baseline.publicUnits);
  return manifest.units.filter((unit) => !before.has(unit.key));
}

/** The audit record of one egress, before sealing. The caller supplies `at`
 *  (the ONE clock read of the gate — an audit line is history, not a rendered
 *  artifact), `keyId` (`null` until S503b) and `prev` (the verified tail's
 *  `hash`, or `null` to start a chain segment). */
export function egressAuditRecord(args: {
  at: string;
  operation: EgressOperation;
  manifest: EgressManifest;
  reasons: readonly EgressReason[];
  keyId: string | null;
  baseline: EgressAuditRecord["baseline"];
  prev: string | null;
}): EgressRecordCore {
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
    prev: args.prev,
  };
}

/** The chain link of one audit line: `sha256:` over the canonical
 *  serialization of the record EXCLUDING `hash` and `baselineHash` (#520). The
 *  exclusions are what break the would-be cycle between the two bindings: the
 *  line's `baselineHash` names the baseline, the baseline's `logTail` names the
 *  line's `hash`. */
export function egressLineHash(core: EgressRecordCore): string {
  return `sha256:${createHash("sha256").update(canonicalJson(core)).digest("hex")}`;
}

/** The content binding of one audit line: `sha256:` over the canonical
 *  serialization of the baseline the line produced, EXCLUDING `logTail` (#520).
 *  Editing the baseline's memory (its `publicUnits`) without re-signing the
 *  line that produced it fails exactly here. */
export function egressBaselineHash(content: Omit<EgressBaseline, "logTail">): string {
  return `sha256:${createHash("sha256").update(canonicalJson(content)).digest("hex")}`;
}

/**
 * Seal one egress: the audit record and the baseline it produces, with the two
 * bindings computed in the only order that terminates —
 *
 *   1. the record core (with `prev` = the verified tail, or `null`),
 *   2. `hash` over the core,
 *   3. the baseline content from the PUBLIC manifest, with `logTail` = `hash`,
 *   4. `baselineHash` over the content (which excludes `logTail`).
 *
 * The caller appends the record BEFORE writing the baseline (the append is the
 * authorization; the baseline is the memory that follows it).
 */
export function egressSeal(args: {
  at: string;
  operation: EgressOperation;
  /** The manifest that was AUTHORIZED — `--all` seals the SSOT digest. */
  manifest: EgressManifest;
  /** The PUBLIC manifest the baseline records — one memory, one scope. */
  publicManifest: EgressManifest;
  reasons: readonly EgressReason[];
  keyId: string | null;
  baseline: EgressAuditRecord["baseline"];
  prev: string | null;
}): { record: EgressAuditRecord; baseline: EgressBaseline } {
  const core = egressAuditRecord({
    at: args.at,
    operation: args.operation,
    manifest: args.manifest,
    reasons: args.reasons,
    keyId: args.keyId,
    baseline: args.baseline,
    prev: args.prev,
  });
  const hash = egressLineHash(core);
  const content = egressBaselineOf(args.publicManifest, args.at);
  return {
    record: { ...core, baselineHash: egressBaselineHash(content), hash },
    baseline: { ...content, logTail: hash },
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
    if (
      record.operation !== "build" &&
      record.operation !== "export-profile" &&
      record.operation !== "post-export"
    ) {
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
    if (record.prev !== null && (typeof record.prev !== "string" || !SHA256.test(record.prev))) {
      problems.push("prev");
    }
    if (typeof record.baselineHash !== "string" || !SHA256.test(record.baselineHash)) {
      problems.push("baselineHash");
    }
    if (typeof record.hash !== "string" || !SHA256.test(record.hash)) {
      problems.push("hash");
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
      prev: record.prev as string | null,
      baselineHash: record.baselineHash as string,
      hash: record.hash as string,
    });
  }
  return { records, malformed };
}

/** What a read of the egress state found. `state` uses the audit record's
 *  vocabulary (`recorded` / `absent` / `unreadable`); `tailHash` is the hash a
 *  new line links to — meaningful only when the log's chain verified. */
export interface EgressStateRead {
  state: EgressAuditRecord["baseline"];
  baseline: EgressBaseline | null;
  problem?: string;
  tailHash: string | null;
}

/**
 * Verify the egress state — the log's chain plus its binding to the baseline
 * — WITHOUT repairing anything (#520). The gate decides from the baseline
 * alone; this read exists so a tampered state can never pass as clean:
 *
 *   - both files missing → `absent` (the declared fresh-workspace limit);
 *   - a malformed line anywhere, a broken `prev`/`hash` in the CURRENT segment
 *     (the lines after the last `prev: null` genesis), a `logTail` that is not
 *     the current tail, or a baseline whose content does not hash to the tail's
 *     `baselineHash` → `unreadable` with the exact problem;
 *   - one file without the other → `unreadable` (deleting either memory is not
 *     a reset: the log cannot rebuild the baseline — `units` is a count — and
 *     a baseline without its log has no evidence);
 *   - otherwise `recorded`, with the parsed baseline.
 *
 * An old chain segment (before the last genesis) is unverifiable history: a
 * re-arm starts a new segment exactly because the old one broke, so enforcing
 * it would keep the workspace bricked forever. The re-arm line records
 * `baseline: "unreadable"`, which is where the break stays visible.
 */
export function verifyEgressState(
  logText: string | null,
  baselineText: string | null,
): EgressStateRead {
  if (logText === null && baselineText === null) {
    return { state: "absent", baseline: null, tailHash: null };
  }
  if (logText === null) {
    return {
      state: "unreadable",
      baseline: null,
      tailHash: null,
      problem: `${EGRESS_BASELINE_REL} exists but ${EGRESS_AUDIT_REL} does not — the memory without its evidence`,
    };
  }
  const { records, malformed } = parseEgressAudit(logText);
  if (malformed.length > 0) {
    const first = malformed[0];
    if (first === undefined) throw new Error("malformed is non-empty");
    return {
      state: "unreadable",
      baseline: null,
      tailHash: null,
      problem: `${EGRESS_AUDIT_REL} line ${first.line}: ${first.reason}`,
    };
  }
  if (records.length === 0) {
    return baselineText === null
      ? { state: "absent", baseline: null, tailHash: null }
      : {
          state: "unreadable",
          baseline: null,
          tailHash: null,
          problem: `${EGRESS_AUDIT_REL} is empty but ${EGRESS_BASELINE_REL} exists`,
        };
  }

  let genesis = -1;
  for (let index = records.length - 1; index >= 0; index--) {
    if (records[index]?.prev === null) {
      genesis = index;
      break;
    }
  }
  if (genesis === -1) {
    return {
      state: "unreadable",
      baseline: null,
      tailHash: records[records.length - 1]?.hash ?? null,
      problem: `${EGRESS_AUDIT_REL}: no chain genesis — every segment starts with prev: null`,
    };
  }
  for (let index = genesis; index < records.length; index++) {
    const record = records[index];
    if (record === undefined) break;
    const { hash: _hash, baselineHash: _baselineHash, ...core } = record;
    if (egressLineHash(core) !== record.hash) {
      return {
        state: "unreadable",
        baseline: null,
        tailHash: null,
        problem: `${EGRESS_AUDIT_REL} line ${index + 1}: hash does not recompute`,
      };
    }
    if (index > genesis && record.prev !== records[index - 1]?.hash) {
      return {
        state: "unreadable",
        baseline: null,
        tailHash: null,
        problem: `${EGRESS_AUDIT_REL} line ${index + 1}: prev does not link to line ${index}`,
      };
    }
  }
  const tail = records[records.length - 1];
  if (tail === undefined) {
    return {
      state: "unreadable",
      baseline: null,
      tailHash: null,
      problem: `${EGRESS_AUDIT_REL}: no tail record`,
    };
  }
  if (baselineText === null) {
    return {
      state: "unreadable",
      baseline: null,
      tailHash: tail.hash,
      problem: `${EGRESS_BASELINE_REL} is missing while ${EGRESS_AUDIT_REL} has ${records.length} record(s) — the log cannot rebuild the memory (units is a count)`,
    };
  }

  let parsed: Partial<EgressBaseline>;
  try {
    parsed = JSON.parse(baselineText) as Partial<EgressBaseline>;
  } catch (err) {
    return {
      state: "unreadable",
      baseline: null,
      tailHash: tail.hash,
      problem: `${EGRESS_BASELINE_REL}: ${(err as Error).message}`,
    };
  }
  if (
    parsed.version !== EGRESS_MANIFEST_VERSION ||
    typeof parsed.digest !== "string" ||
    !SHA256.test(parsed.digest) ||
    !Array.isArray(parsed.publicUnits) ||
    !parsed.publicUnits.every((key) => typeof key === "string") ||
    typeof parsed.logTail !== "string" ||
    !SHA256.test(parsed.logTail)
  ) {
    return {
      state: "unreadable",
      baseline: null,
      tailHash: tail.hash,
      problem: `${EGRESS_BASELINE_REL}: not an egress baseline (version ${EGRESS_MANIFEST_VERSION} + sha256 digest + publicUnits + logTail)`,
    };
  }
  const baseline: EgressBaseline = {
    version: EGRESS_MANIFEST_VERSION,
    at: typeof parsed.at === "string" ? parsed.at : "",
    digest: parsed.digest,
    publicUnits: parsed.publicUnits,
    logTail: parsed.logTail,
  };
  if (baseline.logTail !== tail.hash) {
    return {
      state: "unreadable",
      baseline: null,
      tailHash: tail.hash,
      problem: `${EGRESS_BASELINE_REL} binds to ${baseline.logTail}, the log's tail is ${tail.hash}`,
    };
  }
  const { logTail: _logTail, ...content } = baseline;
  if (egressBaselineHash(content) !== tail.baselineHash) {
    return {
      state: "unreadable",
      baseline: null,
      tailHash: tail.hash,
      problem: `${EGRESS_BASELINE_REL} does not match the line that produced it (${EGRESS_AUDIT_REL} line ${records.length})`,
    };
  }
  return { state: "recorded", baseline, tailHash: tail.hash };
}
