/**
 * `pasco audit [--json]` — the shared diagnostic projection (SPEC §7.1, #283).
 *
 * Findings only: no score, no prioritisation, no branding. That boundary is the
 * contract — the consuming layer (`PROP-017 §Module boundary`) owns ranking, and a
 * score inside the engine would breach it. The projection is OFFLINE and
 * deterministic (D19): no network, no clock, no AI.
 *
 * Three fixed classes (severity is a property of the class, never of the source
 * check that raised it):
 *   dangling-ref    a pointer that does not resolve in the current view   FAIL
 *   contradiction   two surfaces assert incompatible values for one datum  FAIL
 *   unsourced-claim a quantitative claim with no evidence                 WARN
 * Exit 1 iff a FAIL finding exists; 0 otherwise (WARN-only included); a schema or
 * load failure is the standard error envelope at exit 1 (D12: schema fails).
 *
 * It COMPOSES the checks that already exist and re-implements none of them:
 *   load()/schema        → the error envelope (never a fabricated finding)
 *   driftCheck           → SSOT-internal contradictions + unresolved pointers
 *   geoCheck             → NO v1 class: its codes are citability coverage signals
 *                          (a definition that is absent or long is not a pointer, and
 *                          a claimed handle outside `sameAs` is the legitimate `@id`
 *                          exclusion, not a dangling reference). The one premise that
 *                          IS class-mappable — an answer row without a source — is
 *                          reported row-level below instead of by parsing the check's
 *                          prose detail.
 *   completeness()       → the `evidence` premise decides whether claim sourcing is
 *                          measured at all (a policy weight of 0 opts the rule out)
 *   fact-present         → artifact fact tokens vs the SSOT render (check.ts)
 *
 * The `path` of a finding is a `factRef` (SPEC §7.1, cited from the ledger's
 * `PROP-017 §Scope`), with the row id in place of the array index when the row
 * declares one. A finding about a SURFACE artifact has no factRef by definition —
 * the fact is not in the SSOT — so it addresses the artifact path instead.
 */

import type { LoadedProfile } from "@profile-as-code/core";
import {
  completeness,
  driftCheck,
  LoadError,
  load,
  SchemaValidationError,
} from "@profile-as-code/core";
import { EXIT } from "../exit.js";
import {
  type FactFindingClass,
  factPresentFindings,
  isQuantitativeClaim,
} from "../fact-present.js";
import { isJsonMode, line, report, section } from "../output.js";
import { type Pascorc, sanitizeCompletenessPolicy } from "../workspace.js";

/** The frozen contract version of the `--json` payload (SPEC §7.1). A consumer
 *  refuses a version it does not know instead of guessing at the shape. */
export const AUDIT_SCHEMA_VERSION = "1";

export type AuditClass = FactFindingClass;

export interface AuditFinding {
  class: AuditClass;
  severity: "FAIL" | "WARN";
  /** factRef (or the artifact path for a surface finding). */
  path: string;
  detail: string;
}

export interface AuditReport {
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  findings: AuditFinding[];
}

/** Severity is a property of the CLASS, fixed by the contract — never inherited
 *  from the severity the composing check happens to use (drift warns, the audit
 *  grades). */
export const AUDIT_SEVERITY: Record<AuditClass, "FAIL" | "WARN"> = {
  "dangling-ref": "FAIL",
  contradiction: "FAIL",
  "unsourced-claim": "WARN",
};

/**
 * Drift codes → audit class. Pointers that do not resolve are `dangling-ref`; the
 * contradiction/duplicate families are `contradiction`. An unmapped code falls
 * back to `contradiction` (FAIL, visible) rather than disappearing: a new drift
 * code must never be silently dropped from the audit.
 */
const DRIFT_CLASS: Record<string, AuditClass> = {
  "drift/active-platform-unknown": "dangling-ref",
  "drift/active-variant-missing": "dangling-ref",
  "drift/handle-claimed-not-linked": "dangling-ref",
  "drift/url-not-in-identity": "dangling-ref",
  "drift/date-range-inverted": "contradiction",
  "drift/duplicate-bio": "contradiction",
  "drift/duplicate-experience": "contradiction",
  "drift/duplicate-handle": "contradiction",
  "drift/duplicate-headline": "contradiction",
  "drift/duplicate-identity-link": "contradiction",
  "drift/duplicate-project": "contradiction",
  "drift/handle-host-mismatch": "contradiction",
  "drift/orcid-conflict": "contradiction",
  "drift/orcid-mismatch": "contradiction",
  "drift/publication-conflict": "contradiction",
  "drift/publication-duplicate": "contradiction",
  "drift/skill-conflict": "contradiction",
};

/** Block paths whose `[n]` becomes the row `id` when the row declares one. */
const BLOCK_PATH =
  /^(projects|experience|publications|press|credentials|artifacts|education|faq)\[(\d+)\](.*)$/;

/** The row blocks the factRef grammar addresses (education/faq added by the same
 *  `block[id].field` shape — SPEC §7.1 cites the grammar, it does not re-invent it). */
function rowsOf(profile: LoadedProfile, block: string): readonly { id?: string }[] {
  switch (block) {
    case "projects":
      return profile.projects ?? [];
    case "experience":
      return profile.experience ?? [];
    case "publications":
      return profile.publications ?? [];
    case "press":
      return profile.press ?? [];
    case "credentials":
      return profile.credentials ?? [];
    case "artifacts":
      return profile.artifacts ?? [];
    case "education":
      return profile.education ?? [];
    case "faq":
      return profile.faq ?? [];
    default:
      return [];
  }
}

/** `publications[1].year` → `publications[vasquez-2024].year` when the row has an
 *  id. A row without one keeps its index: the address stays resolvable. */
export function factRef(profile: LoadedProfile, path: string): string {
  const match = BLOCK_PATH.exec(path);
  if (match === null) return path;
  const [, block, indexText, rest] = match;
  if (block === undefined || indexText === undefined || rest === undefined) return path;
  const row = rowsOf(profile, block)[Number(indexText)];
  const id = row?.id;
  if (id === undefined) return path;
  return `${block}[${id}]${rest}`;
}

function finding(cls: AuditClass, path: string, detail: string): AuditFinding {
  return { class: cls, severity: AUDIT_SEVERITY[cls], path, detail };
}

/** Every SSOT-side finding: drift, project evidence, faq claims. */
function ssotFindings(profile: LoadedProfile, pascorc: Pascorc): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const issue of driftCheck(profile)) {
    const cls = DRIFT_CLASS[issue.code] ?? "contradiction";
    findings.push(finding(cls, factRef(profile, issue.path), `${issue.code} — ${issue.message}`));
  }

  // The completeness `evidence` item is the premise of the claim rule: when the
  // workspace policy drops it (weight 0), it does not measure claims and the audit
  // must not measure them either. Per-project rows are reported here because the
  // completeness report is an aggregate and a finding needs an address.
  const report = completeness(profile, sanitizeCompletenessPolicy(pascorc.completeness));
  const measuresEvidence = report.items.some((item) => item.id === "evidence");
  if (measuresEvidence) {
    for (const [index, project] of (profile.projects ?? []).entries()) {
      const claims = [project.name, ...Object.values(project.description ?? {})];
      if (!claims.some(isQuantitativeClaim)) continue;
      const sourced = (project.evidence ?? []).some((evidence) => evidence.source.trim() !== "");
      if (sourced) continue;
      const row = project.id ?? String(index);
      findings.push(
        finding(
          "unsourced-claim",
          `projects[${row}].description`,
          "the project asserts a quantitative claim with no evidence row that carries a `source` — a claim with no evidence behind it",
        ),
      );
    }
  }

  for (const [index, row] of (profile.faq ?? []).entries()) {
    if (row.source !== undefined) continue;
    const claims = [...Object.values(row.q), ...Object.values(row.a)];
    if (!claims.some(isQuantitativeClaim)) continue;
    const addressed = row.id ?? String(index);
    findings.push(
      finding(
        "unsourced-claim",
        `faq[${addressed}].q`,
        "the answer carries a quantitative claim with no `source` — an unsourced claim",
      ),
    );
  }

  return findings;
}

const CLASS_ORDER: Record<AuditClass, number> = {
  "dangling-ref": 0,
  contradiction: 1,
  "unsourced-claim": 2,
};

/** Deterministic order: class, then address, then detail. Same input, same bytes. */
function ordered(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort(
    (a, b) =>
      CLASS_ORDER[a.class] - CLASS_ORDER[b.class] ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      (a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0),
  );
}

export interface AuditArgs {
  workspace: string;
  pascorc: Pascorc;
}

export function runAudit(args: AuditArgs): number {
  let profile: LoadedProfile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report("audit", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report("audit", false, EXIT.FAIL, { error: { kind: "load", message: err.message } });
    }
    throw err;
  }

  const facts = factPresentFindings({ workspace: args.workspace, profile, pascorc: args.pascorc });
  const findings = ordered([
    ...ssotFindings(profile, args.pascorc),
    ...facts.findings.map((item) =>
      finding(item.class, item.path, `${item.code} — ${item.message}`),
    ),
  ]);
  const failures = findings.filter((item) => item.severity === "FAIL").length;
  const exitCode = failures > 0 ? EXIT.FAIL : EXIT.OK;
  const reportData: AuditReport = { schemaVersion: AUDIT_SCHEMA_VERSION, findings };

  if (isJsonMode()) {
    return report("audit", failures === 0, exitCode, { data: reportData });
  }

  section(`audit — findings only (no score, no prioritisation)`);
  if (findings.length === 0) {
    line("  no findings");
  } else {
    for (const item of findings) {
      line(`  ${item.severity} ${item.class} ${item.path}`);
      line(`    ${item.detail}`);
    }
  }
  if (facts.notRun.length > 0) {
    line(
      `  fact-present not run for ${facts.notRun.join(", ")} — no artifact on disk (run pasco build) or no renderer for this workspace`,
    );
  }
  const warnings = findings.length - failures;
  line(
    `pasco audit: ${findings.length} finding(s) — ${failures} FAIL · ${warnings} WARN — exit ${exitCode}`,
  );
  return exitCode;
}
