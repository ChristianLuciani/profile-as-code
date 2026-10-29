/**
 * `pasco doctor [--json]` — engine · schema · workspace on one line (SPEC §7.6,
 * issue #348).
 *
 * `doctor` answers "which engine am I running, against which contract, and does
 * this workspace load?" without doing work: it loads the workspace once to
 * report validity, but writes nothing, reads no clock and touches no network.
 * It is deliberately separate from `--version` (which describes the binary, not
 * the workspace) and it does NOT gate: when the `.pascorc` requirement is unmet
 * it reports the same three facts the gate refuses with, but exits `1` because
 * the workspace is unhealthy.
 *
 * Exit matrix (the repo's): `0` healthy (workspace loads and any declared engine
 * requirement is met) · `1` unhealthy (the workspace fails to load, the engine
 * requirement is unmet or malformed) · `2` usage (dispatcher).
 */

import { LoadError, load, SchemaValidationError } from "@profile-as-code/core";
import type { EngineRequirement } from "../engine-gate.js";
import {
  ENGINE_UPGRADE_COMMAND,
  engineGateError,
  evaluateEngineRequirement,
} from "../engine-gate.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report } from "../output.js";
import type { Pascorc } from "../workspace.js";

/** The engine that produced the line — the CLI package, not the workspace. */
export const DOCTOR_ENGINE = "@profile-as-code/cli";

/** The frozen report shape (`--json` `data`). `workspace.error` is present only
 *  when the workspace cannot load; `requirement.problem` only when the field is
 *  malformed. A consumer reads `workspace.valid` and `requirement.met`; the
 *  envelope's `ok`/`exitCode` carry the same verdict. */
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
    problem?: string;
  };
}

export interface DoctorArgs {
  workspace: string;
  /** The installed CLI version, resolved by the dispatcher from package.json. */
  engineVersion: string;
  /** The profile-contract version the CLI was built against (core's generated
   *  `PROFILE_SCHEMA_VERSION`, derived from the schema `$id`). */
  schemaVersion: string;
  pascorc: Pascorc;
}

function loadWorkspace(workspace: string): {
  valid: boolean;
  error?: DoctorReport["workspace"]["error"];
} {
  try {
    load(workspace);
    return { valid: true };
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
  pascorc: Pascorc,
  engineVersion: string,
): DoctorReport["requirement"] & EngineRequirement {
  const requirement = evaluateEngineRequirement(pascorc, engineVersion);
  return {
    declared: requirement.declared,
    met: requirement.met,
    ...(requirement.problem === undefined ? {} : { problem: requirement.problem }),
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
  let requirementText: string;
  if (requirement.declared === null) {
    requirementText = "no engine requirement";
  } else if (requirement.problem !== undefined) {
    requirementText = `engine requirement INVALID: ${requirement.problem}`;
  } else if (requirement.met) {
    requirementText = `requires engine >= ${requirement.declared} (met)`;
  } else {
    requirementText = `requires engine >= ${requirement.declared} (NOT MET — upgrade: ${ENGINE_UPGRADE_COMMAND})`;
  }
  return `engine ${reportData.engine.version} · schema v${reportData.schema.version} · workspace ${reportData.workspace.path} (${workspaceState}) · ${requirementText}`;
}

export function runDoctor(args: DoctorArgs): number {
  const workspace = loadWorkspace(args.workspace);
  const requirement = requirementOf(args.pascorc, args.engineVersion);
  const data: DoctorReport = {
    engine: { name: DOCTOR_ENGINE, version: args.engineVersion },
    schema: { version: args.schemaVersion },
    workspace: {
      path: args.workspace,
      valid: workspace.valid,
      ...(workspace.error === undefined ? {} : { error: workspace.error }),
    },
    requirement,
  };
  const healthy = workspace.valid && engineGateError(requirement, args.engineVersion) === null;

  if (isJsonMode()) {
    return report("doctor", healthy, healthy ? EXIT.OK : EXIT.FAIL, { data });
  }
  line(describe(data));
  return healthy ? EXIT.OK : EXIT.FAIL;
}
