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
 * **Deliberately stricter than `validate`/`check` on these classes.** Drift facts
 * WARN there because D12 governs *validity*: a user may carry two intents on two
 * platforms. The audit's unit is *publishability*, and #283 freezes the class
 * severities (FAIL/FAIL/WARN) — so a drift fact that falls in a FAIL class exits 1
 * here and 0 there. That difference is the contract, declared in SPEC §7.1 and in
 * `--help`; it is not an accident of composition, and a test pins it.
 *
 * It COMPOSES the checks that already exist and re-implements none of them:
 *   load()/schema        → the error envelope (never a fabricated finding)
 *   reconciledDrift      → `driftCheck` + the #238 variant-store reconciliation
 *                          `validate` applies (one home: `drift-reconcile.ts`)
 *   geoCheck             → no class of its own: its codes are citability coverage
 *                          signals. The ONE premise it owns that is class-mappable is
 *                          the answer-surface deficiency (`geo/faq-coverage`, whose
 *                          ≥3-row / duplicate-`q` / unsourced-row rules stay in geo):
 *                          when the check scores 0, the audit reports the deficient
 *                          ROWS that assert a number with no `source`.
 *   completeness()       → the `evidence` premise decides whether claim sourcing is
 *                          measured at all (a policy weight of 0 opts the rule out)
 *   fact-present         → artifact facts vs the SSOT render, symmetric (#283)
 *
 * The `path` of a finding is a `factRef` (SPEC §7.1, cited from the ledger's
 * `PROP-017 §Scope`) for the blocks that grammar addresses, with the row id in
 * place of the array index when the row declares one. A block the grammar does not
 * address keeps its own address, and a finding about a SURFACE artifact has no
 * factRef by definition — the fact is not in the SSOT.
 */

import type { LoadedProfile } from "@profile-as-code/core";
import {
  completeness,
  geoCheck,
  LoadError,
  load,
  SchemaValidationError,
} from "@profile-as-code/core";
import { isQuantitativeClaim } from "../claims.js";
import { reconciledDrift } from "../drift-reconcile.js";
import { EXIT } from "../exit.js";
import { type FactFindingClass, factPresentFindings } from "../fact-present.js";
import { isJsonMode, line, report, section } from "../output.js";
import type { CatalogState } from "../skill-checks.js";
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

/**
 * What the artifact side of the audit actually measured. The SSOT-side rules always
 * run; this scope says whether `fact-present` had bytes to compare, so an empty
 * audit is never mistaken for a clean one (SPEC §7.1).
 */
export interface AuditScope {
  /** Whether this package ships a skills tree at all (#253): `not-shipped` is a
   *  bundle state, not "no premise declared". */
  catalog: CatalogState;
  /** Surfaces whose catalog declares the `fact-present` premise (workspace rows ∪
   *  the shipped skill catalog). Empty = the premise is not declared, so the
   *  artifact side measured nothing BY CONTRACT. */
  declared: string[];
  /** Declared surfaces whose built artifact was compared. */
  checked: string[];
  /** Declared surfaces with no artifact on disk or no renderer — NOT run. */
  notRun: string[];
}

export interface AuditReport {
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  scope: AuditScope;
  findings: AuditFinding[];
}

/** Severity is a property of the CLASS, fixed by the contract — never inherited
 *  from the severity the composing check happens to use (drift warns, the audit
 *  grades; see the header). */
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
const DRIFT_CLASS: Record<string, AuditClass | null> = {
  // Canonicalization, NOT a broken pointer: the URL resolves, it is simply not
  // mirrored in `identity.links`. `validate` warns (D12); the audit gives it no
  // class and does not report it — the same treatment `geoCheck` gets, declared in
  // SPEC §7.1 rather than forced into a class it does not fit.
  "drift/url-not-in-identity": null,
  "drift/active-platform-unknown": "dangling-ref",
  "drift/active-variant-missing": "dangling-ref",
  "drift/handle-claimed-not-linked": "dangling-ref",
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

/**
 * Block paths whose `[n]` becomes the row `id` when the row declares one. Restricted
 * to the blocks the `factRef` grammar addresses (SPEC §7.1) — `education`, `press`,
 * `faq` and `socialHandles` are NOT in it, so they keep their own index address
 * rather than a `block[id]` form this engine would be inventing.
 */
const BLOCK_PATH = /^(projects|experience|publications|credentials|artifacts)\[(\d+)\](.*)$/;

function rowsOf(profile: LoadedProfile, block: string): readonly { id?: string }[] {
  switch (block) {
    case "projects":
      return profile.projects ?? [];
    case "experience":
      return profile.experience ?? [];
    case "publications":
      return profile.publications ?? [];
    case "credentials":
      return profile.credentials ?? [];
    case "artifacts":
      return profile.artifacts ?? [];
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

  // `geo/faq-coverage` owns the premise (≥3 rows, duplicate `q`, a row without
  // `source`) — the audit only reports the deficient ROWS that are class-mappable
  // (a number with no source). No threshold is re-derived here.
  const faqDeficient = geoCheck(profile).checks.some(
    (check) => check.code === "geo/faq-coverage" && check.score === 0,
  );
  if (faqDeficient) {
    for (const [index, row] of (profile.faq ?? []).entries()) {
      if (row.source !== undefined) continue;
      // Address the FIELD that carries the claim: `path` is the machine contract a
      // fix plan consumes, so it must not point at the question when the number is
      // in the answer (the `.q`/`.a` mismatch of the round-2 review).
      const field = Object.values(row.a).some(isQuantitativeClaim)
        ? "a"
        : Object.values(row.q).some(isQuantitativeClaim)
          ? "q"
          : undefined;
      if (field === undefined) continue;
      const noun = field === "a" ? "answer" : "question";
      findings.push(
        finding(
          "unsourced-claim",
          `faq[${index}].${field}`,
          `the ${noun} carries a quantitative claim with no \`source\` — an unsourced claim (the block address is index-based: \`faq\` is outside the factRef grammar)`,
        ),
      );
    }
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

  const drift = reconciledDrift(args.workspace, profile).flatMap((issue) => {
    // An explicit `null` is "no class" (declared in §7.1); an unknown code falls
    // back to `contradiction` (visible) so a new drift code is never dropped.
    const mapped = Object.hasOwn(DRIFT_CLASS, issue.code)
      ? DRIFT_CLASS[issue.code]
      : "contradiction";
    if (mapped === null || mapped === undefined) return [];
    return [finding(mapped, factRef(profile, issue.path), `${issue.code} — ${issue.message}`)];
  });
  const facts = factPresentFindings({
    workspace: args.workspace,
    profile,
    pascorc: args.pascorc,
    checks: profile.checks,
  });
  const findings = ordered([
    ...drift,
    ...ssotFindings(profile, args.pascorc),
    ...facts.findings.map((item) =>
      finding(item.class, item.path, `${item.code} — ${item.message}`),
    ),
  ]);
  const failures = findings.filter((item) => item.severity === "FAIL").length;
  const exitCode = failures > 0 ? EXIT.FAIL : EXIT.OK;
  const scope: AuditScope = {
    catalog: facts.catalog,
    declared: facts.declared,
    checked: facts.checked,
    notRun: facts.notRun,
  };
  const reportData: AuditReport = { schemaVersion: AUDIT_SCHEMA_VERSION, scope, findings };

  if (isJsonMode()) {
    return report("audit", failures === 0, exitCode, { data: reportData });
  }

  section("audit — findings only (no score, no prioritisation)");
  const compared =
    scope.checked.length === 0
      ? "no surface measured"
      : `${scope.checked.length} surface(s) compared (${scope.checked.join(", ")})`;
  const missing = scope.notRun.length === 0 ? "" : ` · not run: ${scope.notRun.join(", ")}`;
  const declared =
    scope.catalog === "not-shipped"
      ? " · skills tree NOT SHIPPED with this package (the catalog cannot declare the premise)"
      : scope.declared.length === 0
        ? " · premise not declared by any catalog"
        : "";
  line(`  scope: ${compared}${missing}${declared}`);
  if (scope.checked.length === 0) {
    line(
      "  an empty scope is not a clean audit — no artifact to compare (run pasco build), or no catalog declares fact-present",
    );
  }
  if (findings.length === 0) {
    line("  no findings");
  } else {
    for (const item of findings) {
      line(`  ${item.severity} ${item.class} ${item.path}`);
      line(`    ${item.detail}`);
    }
  }
  const warnings = findings.length - failures;
  line(
    `pasco audit: ${findings.length} finding(s) — ${failures} FAIL · ${warnings} WARN — exit ${exitCode}`,
  );
  return exitCode;
}
