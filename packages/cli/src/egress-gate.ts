/**
 * egress-gate — the CLI side of D28 (SPEC §7.11, issue #503 slice S503a): the
 * `.pasco/egress/` state and the confirmation rule.
 *
 * The CONTRACT (manifest, digest, private → public comparison, audit record) is
 * core's (`@profile-as-code/core`); this module owns the two files the engine
 * writes and the decision it makes with them:
 *
 *   `.pasco/egress/audit.log`     APPEND-ONLY. One JSON line per egress, opened
 *                                 with O_APPEND — an earlier line is never
 *                                 rewritten, and a malformed line is reported,
 *                                 never repaired.
 *   `.pasco/egress/baseline.json` the last PUBLIC manifest (keys + digest),
 *                                 written atomically (tmp + rename).
 *
 * Both live with the workspace (like `preview`'s `.pasco/`), outside `content/`
 * and `profiles/`: the audit log is never rendered.
 *
 * **Order of the writes is the guarantee.** The record and the baseline are
 * written BEFORE the egress runs, and a write failure refuses the egress: an
 * operation that leaves the workspace is always on the record. The line states
 * the AUTHORIZATION of a manifest, not proof that the bytes were written — a
 * build that later fails on selection still leaves its authorized line.
 *
 * **S503a has no keys.** `--confirm <digest>` is the operator echoing the exact
 * manifest digest; the record carries `keyId: null` and
 * `method: "digest-confirm"`. The limits (an agent that can write the workspace
 * can also run the command with the digest, or delete `.pasco/egress/`) are
 * declared in SPEC §7.11 — the signed receipt and the keyless agent are S503b.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  EgressAuditRecord,
  EgressBaseline,
  EgressManifest,
  EgressOperation,
  EgressReason,
  EgressScope,
  EgressUnit,
  LoadedProfile,
} from "@profile-as-code/core";
import {
  egressAuditLine,
  egressAuditRecord,
  egressBaselineOf,
  egressManifest,
  newlyPublicUnits,
} from "@profile-as-code/core";

/** The state paths, relative to the workspace — the spelling every message and
 *  the SPEC use (a machine path in a published surface is rule-9 noise). */
export const EGRESS_AUDIT_REL = ".pasco/egress/audit.log";
export const EGRESS_BASELINE_REL = ".pasco/egress/baseline.json";
export const EGRESS_AUDIT_FLAG = "--confirm";

export function egressStateDir(workspace: string): string {
  return join(workspace, ".pasco", "egress");
}

export function egressAuditPath(workspace: string): string {
  return join(egressStateDir(workspace), "audit.log");
}

export function egressBaselinePath(workspace: string): string {
  return join(egressStateDir(workspace), "baseline.json");
}

/** Read the recorded baseline. A missing file is `absent` (the first egress);
 *  an unreadable or foreign file is `unreadable` with the exact problem — never
 *  silently `absent`, because the two mean different things to the gate. */
export function readEgressBaseline(workspace: string): {
  baseline: EgressBaseline | null;
  state: EgressAuditRecord["baseline"];
  problem?: string;
} {
  const path = egressBaselinePath(workspace);
  if (!existsSync(path)) return { baseline: null, state: "absent" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<EgressBaseline>;
    if (
      parsed.version !== 1 ||
      typeof parsed.digest !== "string" ||
      !Array.isArray(parsed.publicUnits) ||
      !parsed.publicUnits.every((key) => typeof key === "string")
    ) {
      return {
        baseline: null,
        state: "unreadable",
        problem: `${EGRESS_BASELINE_REL}: not an egress baseline (version 1 + digest + publicUnits)`,
      };
    }
    return {
      baseline: {
        version: 1,
        at: typeof parsed.at === "string" ? parsed.at : "",
        digest: parsed.digest,
        publicUnits: parsed.publicUnits,
      },
      state: "recorded",
    };
  } catch (err) {
    return {
      baseline: null,
      state: "unreadable",
      problem: `${EGRESS_BASELINE_REL}: ${(err as Error).message}`,
    };
  }
}

/** Write the baseline atomically: a temp file in the same directory, then a
 *  rename — a crash never leaves a half-written baseline to be misread. */
export function writeEgressBaseline(workspace: string, baseline: EgressBaseline): string {
  const path = egressBaselinePath(workspace);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(baseline, null, 2)}\n`);
  renameSync(temp, path);
  return path;
}

/** Append one audit line. `appendFileSync` opens the file with O_APPEND, so the
 *  previous bytes are never read, rewritten or truncated: the log is append-only
 *  by construction, not by convention. */
export function appendEgressAudit(workspace: string, record: EgressAuditRecord): string {
  const path = egressAuditPath(workspace);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, egressAuditLine(record));
  return path;
}

export interface EgressRequest {
  workspace: string;
  /** The loaded SSOT — never the projection: the units are addressed on it. */
  profile: LoadedProfile;
  operation: EgressOperation;
  scope: EgressScope;
  /** `--confirm <digest>`: the operator's echo of the manifest they read. */
  confirm?: string;
  /** The ONE clock read of the gate (an audit line is history). Injectable so a
   *  test can pin it; the CLI passes `new Date().toISOString()`. */
  at: string;
  keyId?: string | null;
}

export interface EgressRefusal {
  ok: false;
  code: "confirmation-required" | "confirm-mismatch" | "audit-failed";
  manifest: EgressManifest;
  reasons: EgressReason[];
  transitions: EgressUnit[];
  message: string;
  hint: string;
  violations: { path: string; message: string }[];
}

export interface EgressAuthorized {
  ok: true;
  manifest: EgressManifest;
  reasons: EgressReason[];
  transitions: EgressUnit[];
  /** Where the line landed, relative to the workspace (`EGRESS_AUDIT_REL`). */
  auditRel: string;
  baseline: EgressAuditRecord["baseline"];
  /** Declared, non-blocking facts (`baseline` unreadable) — printed as warnings. */
  notices: string[];
}

function reasonViolation(reason: EgressReason, count: number): { path: string; message: string } {
  return reason === "full-export"
    ? {
        path: "--all",
        message: "the full SSOT leaves the workspace — private rows included",
      }
    : {
        path: "private → public",
        message: `${count} unit(s) are public now and were not public at the last recorded egress`,
      };
}

function reasonText(reasons: readonly EgressReason[], count: number): string {
  return reasons
    .map((reason) =>
      reason === "full-export"
        ? "`--all` is a break-glass export of the full SSOT"
        : `${count} unit(s) moved private → public since the last recorded egress`,
    )
    .join("; ");
}

/**
 * The gate. Build the manifest, compare it against the last recorded egress,
 * require the operator's digest when the act is privileged, then record the
 * authorization. A refusal writes NOTHING: no audit line, no baseline move — so
 * the next attempt still sees the same transition (re-running is not a bypass).
 */
export function authorizeEgress(req: EgressRequest): EgressAuthorized | EgressRefusal {
  const publicManifest = egressManifest(req.profile, "public");
  const manifest = req.scope === "all" ? egressManifest(req.profile, "all") : publicManifest;
  const { baseline, state: baselineState, problem } = readEgressBaseline(req.workspace);
  const transitions = newlyPublicUnits(publicManifest, baseline);
  const reasons: EgressReason[] = [];
  if (req.scope === "all") reasons.push("full-export");
  if (transitions.length > 0) reasons.push("private-to-public");
  const violations = reasons.map((reason) => reasonViolation(reason, transitions.length));
  // The transition list is the actionable half of the message: one line per
  // unit, so the operator reads WHAT is about to be published, not a count.
  for (const unit of transitions) {
    violations.push({
      path: unit.key,
      message: "public now, not public at the last recorded egress",
    });
  }

  if (reasons.length > 0) {
    if (req.confirm === undefined) {
      return {
        ok: false,
        code: "confirmation-required",
        manifest,
        reasons,
        transitions,
        message: `egress authorization required (D28, SPEC §7.11): ${reasonText(reasons, transitions.length)}`,
        hint: `nothing was written and the audit log gained no record — re-run with ${EGRESS_AUDIT_FLAG} ${manifest.digest} to authorize exactly this manifest`,
        violations,
      };
    }
    if (req.confirm !== manifest.digest) {
      return {
        ok: false,
        code: "confirm-mismatch",
        manifest,
        reasons,
        transitions,
        message: `${EGRESS_AUDIT_FLAG} does not match this manifest (confirmed ${req.confirm}; current ${manifest.digest}) — the workspace changed since you read it`,
        hint: `run the command without ${EGRESS_AUDIT_FLAG} to read the current manifest digest, then confirm that one`,
        violations,
      };
    }
  }

  const record = egressAuditRecord({
    at: req.at,
    operation: req.operation,
    manifest,
    reasons,
    keyId: req.keyId ?? null,
    baseline: baselineState,
  });
  try {
    appendEgressAudit(req.workspace, record);
    writeEgressBaseline(req.workspace, egressBaselineOf(publicManifest, req.at));
  } catch (err) {
    return {
      ok: false,
      code: "audit-failed",
      manifest,
      reasons,
      transitions,
      message: `the egress could not be recorded (${EGRESS_AUDIT_REL}) — ${(err as Error).message}`,
      hint: "nothing was written: an egress the engine cannot record is not authorized. Fix the workspace permissions and retry",
      violations,
    };
  }

  return {
    ok: true,
    manifest,
    reasons,
    transitions,
    auditRel: EGRESS_AUDIT_REL,
    baseline: baselineState,
    notices:
      problem === undefined
        ? []
        : [
            `egress baseline unreadable — ${problem}; the private → public check ran with no baseline`,
          ],
  };
}

/** The machine payload of a refusal: the digest a caller needs to re-run with
 *  `--confirm`, never a nudge to retry blindly. */
export function egressRefusalData(refusal: EgressRefusal): {
  egress: {
    refused: true;
    code: EgressRefusal["code"];
    scope: EgressScope;
    digest: string;
    units: number;
    reasons: EgressReason[];
    transitions: string[];
    keyId: null;
    audit: string;
  };
} {
  return {
    egress: {
      refused: true,
      code: refusal.code,
      scope: refusal.manifest.scope,
      digest: refusal.manifest.digest,
      units: refusal.manifest.units.length,
      reasons: refusal.reasons,
      transitions: refusal.transitions.map((unit) => unit.key),
      keyId: null,
      audit: EGRESS_AUDIT_REL,
    },
  };
}

/** The receipt a successful egress prints: what left, why it was privileged and
 *  where the line lives. */
export function egressReceipt(res: EgressAuthorized): string {
  const why =
    res.reasons.length > 0
      ? `authorized (${res.reasons.join(", ")})`
      : "not privileged (no confirmation required)";
  return `egress: ${res.manifest.scope} · ${res.manifest.units.length} unit(s) · ${res.manifest.digest} · ${why} · recorded in ${res.auditRel}`;
}
