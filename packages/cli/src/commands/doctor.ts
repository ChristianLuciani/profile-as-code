/**
 * `pasco doctor [--json]` — engine · schema · workspace on one line (SPEC §7.6,
 * issue #348).
 *
 * `doctor` answers "which engine am I running, against which contract, and does
 * this workspace load?" without doing work: it loads the workspace once to
 * report validity, but writes nothing, reads no clock and touches no network.
 * It is deliberately separate from `--version` (which describes the binary, not
 * the workspace) and it does not replace the gate: when the `.pascorc`
 * requirement is unmet it reports the same three facts the gate refuses with,
 * and exits `1` because the workspace is unhealthy. The three commands still
 * refuse before doing any work.
 *
 * `--contract-delta` (#439) answers the follow-up question the one line raises:
 * the workspace declares a contract floor at birth (`"contract": "1.16"`, #439)
 * and this engine validates another one — which minors lie between, what did
 * each ADD, and which surface reads it. The table it reads is a projection of
 * the schema's own `description` narration (`../contract-history.ts`), pinned by
 * `consumer-contract.test.ts`, so a schema bump that forgets it fails `pnpm test`.
 * The floor is a reader for the delta; the one migration policy that consumes it
 * is reachable from `build`/`preview` (a notice) and `pasco migrate` (a refusal
 * for a >=2.0/INVALID floor while rows would be rewritten). `doctor` reports its
 * state without inventing a verdict the gate does not back — its own exit matrix
 * is unchanged by the flag.
 *
 * Exit matrix (the repo's): `0` healthy (workspace loads and any declared engine
 * requirement is met) · `1` unhealthy (the workspace fails to load, the engine
 * requirement is unmet or malformed) · `2` usage (dispatcher).
 */

import {
  LoadError,
  type LoadedProfile,
  load,
  missingVisibility,
  SchemaValidationError,
} from "@profile-as-code/core";
import type { ContractDeltaReport } from "../contract-history.js";
import {
  contractFloorAgeOf,
  evaluateContractDelta,
  evaluateContractFloor,
} from "../contract-history.js";
import type { EngineConfigSource, EngineRequirement } from "../engine-gate.js";
import {
  ENGINE_UPGRADE_COMMAND,
  engineGateError,
  evaluateEngineRequirements,
} from "../engine-gate.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report } from "../output.js";

/** The engine that produced the line — the CLI package, not the workspace. */
export const DOCTOR_ENGINE = "@profile-as-code/cli";

/** The frozen report shape (`--json` `data`). `workspace.error` is present only
 *  when the workspace cannot load; `requirement.problem` only when the field is
 *  malformed; `requirement.source` names the `.pascorc` that produced the
 *  effective (strictest) declaration, so doctor and the gate cannot disagree.
 *  `requirement.state` names the premise in ONE token — `absent` (nothing was
 *  declared: not a pass), `met`, `NOT MET`, or `INVALID` (malformed) — so a
 *  green line can never be read as "gate passed" when nothing was declared. A
 *  consumer reads `workspace.valid` and `requirement.met` for the verdict and
 *  `requirement.state` for what was actually read; the envelope's
 *  `ok`/`exitCode` carry the same verdict. */
export type DoctorRequirementState = "absent" | "met" | "NOT MET" | "INVALID";

export interface DoctorReport {
  engine: { name: typeof DOCTOR_ENGINE; version: string };
  schema: { version: string };
  workspace: {
    path: string;
    valid: boolean;
    error?: { kind: string; message: string; violations?: { path: string; message: string }[] };
  };
  requirement: {
    declared: string | null;
    met: boolean;
    state: DoctorRequirementState;
    problem?: string;
    source?: string;
  };
  /** Present only with `--contract-delta` (#439): the additive block, so a
   *  consumer that never passes the flag sees the frozen §7.6 shape unchanged.
   *  `rows` is the MINORS between the declared floor and the installed contract,
   *  each with the fields it added and the surface that reads them. */
  contractDelta?: ContractDeltaReport;
}

export interface DoctorArgs {
  workspace: string;
  /** The installed CLI version, resolved by the dispatcher from package.json. */
  engineVersion: string;
  /** The profile-contract version the CLI was built against (core's generated
   *  `PROFILE_SCHEMA_VERSION`, derived from the schema `$id`). */
  schemaVersion: string;
  /** Every `.pascorc` the workspace resolution consulted (cwd pointer +
   *  workspace), so the report matches what the gate enforces. */
  engineSources: readonly EngineConfigSource[];
  /** Issue #439: include the contract delta (the `--contract-delta` flag). */
  contractDelta: boolean;
}

function loadWorkspace(workspace: string): {
  valid: boolean;
  error?: DoctorReport["workspace"]["error"];
  profile?: LoadedProfile;
} {
  try {
    return { valid: true, profile: load(workspace) };
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return {
        valid: false,
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      };
    }
    if (err instanceof LoadError) {
      return { valid: false, error: { kind: "load", message: err.message } };
    }
    throw err;
  }
}

function requirementOf(
  sources: readonly EngineConfigSource[],
  engineVersion: string,
): DoctorReport["requirement"] & EngineRequirement {
  const requirement = evaluateEngineRequirements(sources, engineVersion);
  const state: DoctorRequirementState =
    requirement.problem !== undefined
      ? "INVALID"
      : requirement.declared === null
        ? "absent"
        : requirement.met
          ? "met"
          : "NOT MET";
  return {
    declared: requirement.declared,
    met: requirement.met,
    state,
    ...(requirement.problem === undefined ? {} : { problem: requirement.problem }),
    ...(requirement.source === undefined ? {} : { source: requirement.source }),
  };
}

/** The one human line: `engine X · schema vY · workspace <path> (<state>) · …`. */
function describe(reportData: DoctorReport): string {
  const workspaceState = reportData.workspace.valid
    ? "valid"
    : `invalid: ${reportData.workspace.error?.kind ?? "unknown"} — ${
        reportData.workspace.error?.message ?? "cannot load"
      }`;
  const requirement = reportData.requirement;
  const from = requirement.source === undefined ? "" : `, declared in ${requirement.source}`;
  // One derivation, not two: the line branches on the SAME `state` the JSON
  // reports, so the two surfaces cannot drift apart (#436 fresh pass, F3).
  let requirementText: string;
  switch (requirement.state) {
    case "INVALID":
      requirementText = `engine requirement INVALID: ${requirement.problem ?? "malformed declaration"}${from}`;
      break;
    case "absent":
      // `absent` is a state, not a pass: the word is printed even though the
      // exit stays 0 for a workspace with no declaration (SPEC §7.6).
      requirementText = "engine requirement absent — no .pascorc declares one";
      break;
    case "met":
      requirementText = `requires engine >= ${requirement.declared} (met${from})`;
      break;
    case "NOT MET":
      requirementText = `requires engine >= ${requirement.declared} (NOT MET — upgrade: ${ENGINE_UPGRADE_COMMAND}${from})`;
      break;
  }
  return `engine ${reportData.engine.version} · schema v${reportData.schema.version} · workspace ${reportData.workspace.path} (${workspaceState}) · ${requirementText}`;
}

/**
 * The `--contract-delta` block: one line per MINOR the workspace has not been
 * told about, then the fields and what they buy. Branches on the SAME `state`
 * the JSON reports — the two surfaces cannot drift apart.
 */
function describeMigration(delta: ContractDeltaReport): string[] {
  if (delta.migration === undefined) {
    return ["migration — not measured (the workspace does not load)"];
  }
  const { rows, total, note } = delta.migration;
  if (total === 0 && note !== undefined) return [`migration — ${note}`];
  if (total === 0) {
    return [
      "migration — every credentials/artifacts/projects/experience row declares visibility (schema v2.0)",
    ];
  }
  const shown = rows
    .slice(0, 20)
    .map((row) => `${row.block}[${row.index}]${row.id === undefined ? "" : ` (${row.id})`}`);
  const more = total > shown.length ? `, +${total - shown.length} more` : "";
  const lines = [
    `migration — ${total} row(s) still lack visibility (schema v2.0 default is private); run \`pasco migrate\` once: ${shown.join(", ")}${more}`,
  ];
  if (note !== undefined) lines.push(`  ${note}`);
  return lines;
}

function describeContractDelta(delta: ContractDeltaReport): string[] {
  const from = delta.source === undefined ? "" : ` (declared in ${delta.source})`;
  switch (delta.state) {
    case "none":
      // The equality case the issue names verbatim: nothing to adopt.
      return ["no delta (workspace floor = installed contract)"];
    case "absent":
      // `absent` is a state, not a pass — same discipline as the engine floor.
      // The remedy must name the version the workspace is coming FROM: declaring
      // the INSTALLED contract resolves to `none` and erases the very answer the
      // user asked for (fresh pass F1). `pasco init` is not a remedy either — it
      // refuses a directory that already has `facts/` (F3).
      return [
        `no delta — no .pascorc declares a contract floor, so there is nothing to diff (add "contract" with the contract version this workspace was written against — the one your previous engine validated — then re-run)`,
      ];
    case "INVALID":
      return [`contract floor INVALID: ${delta.problem ?? "malformed declaration"}`];
    case "ahead":
      return [
        `no delta — contract floor ${delta.floor} is AHEAD of the installed contract v${delta.installed}; this engine cannot validate a workspace written for a newer contract (upgrade: ${ENGINE_UPGRADE_COMMAND})`,
      ];
    case "delta": {
      const minors = delta.rows.length;
      const lines = [
        `contract delta — floor ${delta.floor}${from} → installed v${delta.installed} · ${minors} minor${minors === 1 ? "" : "s"} to adopt`,
      ];
      for (const minor of delta.rows) {
        lines.push(`  v${minor.version}  ${minor.fields.join(" · ")}`);
        lines.push(`         ${minor.buys}`);
      }
      return lines;
    }
  }
}

export function runDoctor(args: DoctorArgs): number {
  const workspace = loadWorkspace(args.workspace);
  const requirement = requirementOf(args.engineSources, args.engineVersion);
  const contractDelta = args.contractDelta
    ? (() => {
        const report = evaluateContractDelta(args.engineSources, args.schemaVersion);
        if (workspace.profile === undefined) return report;
        // The DELTA uses the lowest floor ("what did I miss"); the migration
        // policy uses the STRICTEST declared floor, so a v2.0 workspace is never
        // outvoted by a legacy parent pointer (the engine gate's rule).
        const strictest = evaluateContractFloor(args.engineSources, "highest");
        const age = contractFloorAgeOf(strictest);
        if (age === "unknown" || report.state === "INVALID") {
          return {
            ...report,
            migration: {
              rows: [],
              total: 0,
              note: `contract floor INVALID (${strictest.problem ?? "malformed"}) — fix .pascorc before deciding; rows without visibility are private (D27) and were not measured`,
            },
          };
        }
        const rows = missingVisibility(workspace.profile);
        if (age === "legacy") {
          return {
            ...report,
            migration: {
              rows,
              total: rows.length,
              ...(strictest.declared === null
                ? {
                    note: "no contract floor declared — treated as pre-v2.0; if this is a v2.0 workspace, declare contract 2.0 and leave the rows private",
                  }
                : {}),
            },
          };
        }
        return {
          ...report,
          migration: {
            rows: [],
            total: 0,
            note: `contract floor ${strictest.declared} >= 2.0 — absent visibility is the intentional private default, no migration is due`,
          },
        };
      })()
    : undefined;
  const data: DoctorReport = {
    engine: { name: DOCTOR_ENGINE, version: args.engineVersion },
    schema: { version: args.schemaVersion },
    workspace: {
      path: args.workspace,
      valid: workspace.valid,
      ...(workspace.error === undefined ? {} : { error: workspace.error }),
    },
    requirement,
    ...(contractDelta === undefined ? {} : { contractDelta }),
  };
  const healthy = workspace.valid && engineGateError(requirement, args.engineVersion) === null;

  if (isJsonMode()) {
    return report("doctor", healthy, healthy ? EXIT.OK : EXIT.FAIL, { data });
  }
  line(describe(data));
  if (contractDelta !== undefined) {
    for (const deltaLine of describeContractDelta(contractDelta)) line(deltaLine);
    for (const migrationLine of describeMigration(contractDelta)) line(migrationLine);
  }
  return healthy ? EXIT.OK : EXIT.FAIL;
}
