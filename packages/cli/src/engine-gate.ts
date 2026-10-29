/**
 * `.pascorc` engine-version gate (SPEC §7.6, issue #348).
 *
 * A workspace declares the MINIMUM engine it requires:
 *
 *   { "workspace": ".", "engine": "0.4.0" }
 *
 * `validate`, `build` and `export profile` resolve that requirement BEFORE they
 * do any work, so a workspace written for a newer contract fails with the three
 * facts a user needs: the installed version, the required version and the exact
 * upgrade command. `pasco doctor` reports the same in one line without gating.
 *
 * **Declared syntax, deliberately not semver.** The field accepts exactly three
 * dot-separated ASCII decimal components (`MAJOR.MINOR.PATCH`, no `v` prefix, no
 * range operators, no pre-release/build suffix). The comparison is numeric on
 * the three components — a whole semver implementation (or a dependency) buys
 * nothing for the one question a workspace asks ("is this engine at least X?"),
 * and the accepted grammar is small enough to state completely. A future need
 * for an upper bound is an additive field, not a reinterpretation of this one.
 *
 * **Failure modes** (both exit 1, the workspace/config failure row of the exit
 * matrix; `2` stays usage):
 *  - the installed engine is older than the requirement;
 *  - `.pascorc.engine` is present but malformed (non-string, missing component,
 *    range operator, `v` prefix, non-numeric). It is refused, never coerced.
 * An absent field is no requirement (additive; every existing workspace passes).
 */

import type { Pascorc } from "./workspace.js";

/** The documented upgrade path (docs/USER-GUIDE.md §8.2). One home: the gate
 *  message, `pasco doctor` and the docs all quote it verbatim. */
export const ENGINE_UPGRADE_COMMAND = "npm i -g @profile-as-code/cli@latest";

export interface EngineVersion {
  major: number;
  minor: number;
  patch: number;
}

/** The accepted requirement grammar: exactly `MAJOR.MINOR.PATCH`, digits only. */
const REQUIRED_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** An installed version may carry a pre-release suffix (`1.0.0-rc.1`): the
 *  numeric triple is what the gate compares, and the engine has no release
 *  channel that would make a suffix mean "older than the same triple". */
const INSTALLED_VERSION = /^(\d+)\.(\d+)\.(\d+)/;

function toVersion(match: RegExpExecArray | null): EngineVersion | null {
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Parse a REQUIRED version — `null` when the value does not match the grammar. */
export function parseEngineVersion(value: string): EngineVersion | null {
  return toVersion(REQUIRED_VERSION.exec(value));
}

/** Parse the INSTALLED version (lenient about a pre-release suffix). */
export function parseInstalledVersion(value: string): EngineVersion | null {
  return toVersion(INSTALLED_VERSION.exec(value));
}

/** Negative when `a < b`, zero when equal, positive when `a > b`; `null` when
 *  either value does not parse. */
export function compareEngineVersions(a: string, b: string): number | null {
  const left = parseEngineVersion(a);
  const right = parseEngineVersion(b);
  if (left === null || right === null) return null;
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export interface EngineRequirement {
  /** The declared minimum, or `null` when `.pascorc` declares none. */
  declared: string | null;
  /** Whether the running engine satisfies the declaration. A malformed
   *  declaration is `false` and carries `problem`. */
  met: boolean;
  /** The exact refusal when the field exists but is not `MAJOR.MINOR.PATCH`. */
  problem?: string;
}

/** The expected syntax text, shared by the gate message and `pasco doctor`. */
export const ENGINE_SYNTAX = 'MAJOR.MINOR.PATCH (e.g. "0.4.0")';

/** Evaluate `.pascorc.engine` against the installed version. Pure. */
export function evaluateEngineRequirement(pascorc: Pascorc, installed: string): EngineRequirement {
  const declared = pascorc.engine;
  if (declared === undefined) return { declared: null, met: true };
  if (typeof declared !== "string" || parseEngineVersion(declared) === null) {
    return {
      declared: typeof declared === "string" ? declared : JSON.stringify(declared),
      met: false,
      problem: `\`.pascorc\` field "engine" must be a minimum version written as ${ENGINE_SYNTAX}; got ${JSON.stringify(declared)}`,
    };
  }
  const running = parseInstalledVersion(installed);
  const required = parseEngineVersion(declared);
  if (running === null || required === null) {
    // The running CLI always has a numeric version; if a packaging mistake
    // removed it, refuse rather than silently pass a gate we cannot evaluate.
    return {
      declared,
      met: false,
      problem: `cannot read the installed engine version (${JSON.stringify(installed)}) to evaluate the ".pascorc" engine requirement`,
    };
  }
  return { declared, met: compareParsed(running, required) >= 0 };
}

function compareParsed(left: EngineVersion, right: EngineVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export interface EngineGateError {
  kind: "engine" | "config";
  message: string;
}

/** The refusal to surface, or `null` when the requirement is absent or met. */
export function engineGateError(
  requirement: EngineRequirement,
  installed: string,
): EngineGateError | null {
  if (requirement.met) return null;
  if (requirement.problem !== undefined) {
    return { kind: "config", message: requirement.problem };
  }
  return {
    kind: "engine",
    message: `\`.pascorc\` requires engine ${requirement.declared} or newer — installed ${installed}; upgrade with \`${ENGINE_UPGRADE_COMMAND}\``,
  };
}
