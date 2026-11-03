/**
 * pasco validate — load + schema (FAIL, exit 1, D12) + drift (WARN, exit 0) + geo
 * report (not a gate). Mirror of schema/README.md "Validation semantics".
 */

import type { GeoSection, LoadedProfile } from "@profile-as-code/core";
import { geoCheck, LoadError, load, SchemaValidationError } from "@profile-as-code/core";
import { reconciledDrift } from "../drift-reconcile.js";
import { ENGINE_UPGRADE_COMMAND } from "../engine-gate.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";
import { readWorkspacePascorc } from "../workspace.js";

export interface ValidateArgs {
  workspace: string;
  /**
   * Whether any `.pascorc` the resolution consulted declares an engine floor
   * (#434). The dispatcher passes the SAME effective requirement the gate
   * evaluated (pointer file + workspace, stricter wins); when a caller invokes
   * `runValidate` directly it falls back to the workspace's own `.pascorc`.
   * It only decides whether the upgrade hint is printed — never the verdict.
   */
  floorDeclared?: boolean;
}

/**
 * The one-line upgrade hint (#434) — additive text on a failure that already
 * exists, never a new verdict. It fires only on the conjunction the issue
 * observed: the contract rejected an `Unrecognized key` AND the workspace
 * declares no engine floor. A declared floor is a claim about the engine, so
 * the normal gate message owns that case; an unrelated schema failure gets no
 * upgrade advice. Exported so the predicate is pinned by a unit test.
 */
export function unrecognizedKeyHint(
  issues: readonly { path?: string; message: string }[],
  floorDeclared: boolean,
): string | null {
  if (floorDeclared) return null;
  if (!issues.some((issue) => issue.message.trim().toLowerCase().startsWith("unrecognized key"))) {
    return null;
  }
  return (
    "hint: the data has a field this engine does not know and the workspace declares no engine floor — " +
    `the data may be newer than this CLI; upgrade with \`${ENGINE_UPGRADE_COMMAND}\`, then run \`pasco doctor\``
  );
}

/**
 * One human line per GEO section (SPEC §8/#399). Exported so the all-N/A branch,
 * which no shipped profile can reach, is still exercised by a unit test.
 */
export function geoSectionLine(s: GeoSection): string {
  return `  ${s.label}: ${s.applicable === false ? "n/a" : `${s.score}/100`} — ${s.detail}`;
}

export function runValidate(args: ValidateArgs): number {
  let profile: LoadedProfile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      const floorDeclared =
        args.floorDeclared ?? readWorkspacePascorc(args.workspace).engine !== undefined;
      const hint = unrecognizedKeyHint(err.issues, floorDeclared);
      return report("validate", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
          ...(hint === null ? {} : { hint }),
        },
      });
    }
    if (err instanceof LoadError) {
      return report("validate", false, EXIT.FAIL, {
        error: { kind: "load", message: err.message },
      });
    }
    throw err;
  }

  // #238: a variant-only surface is backed by the chosen body in the store; the
  // reconciliation lives in ONE home so `audit` cannot disagree with `validate`.
  const drift = reconciledDrift(args.workspace, profile);
  const geo = geoCheck(profile);

  if (isJsonMode()) {
    return report("validate", true, EXIT.OK, {
      data: { workspace: args.workspace, schema: "valid", drift, geo },
    });
  }

  section("schema");
  line("valid — profile conforms to profile.schema.json (D3/D12)");

  section("drift");
  if (drift.length === 0) {
    line("no drift warnings");
  } else {
    for (const issue of drift) {
      const where = issue.path ? ` (${issue.path})` : "";
      const surfaces = issue.surfaces?.length ? ` [${issue.surfaces.join(", ")}]` : "";
      line(`  warn: [${issue.code}]${surfaces} ${issue.message}${where}`);
    }
    line(`  ${drift.length} warning(s) — exit 0 (D12: facts warn, schema fails)`);
  }

  section("geo");
  // #433: the numbers below are an INDEX over the fields this workspace declares,
  // not a measurement of citations. The qualifier prints before the score on
  // every run (and the basis version is derived, never typed), so the number
  // cannot be read as observed citability. Nothing here changes a score.
  line(
    `  basis: heuristic index over the declared fields (${geo.basis}) — not a measurement of citations`,
  );
  line(`  overall score: ${geo.score}/100`);
  for (const s of Object.values(geo.sections)) {
    // §8/#399: an all-N/A section has no mean; `0/100` would read as a score.
    line(geoSectionLine(s));
  }
  // The severity tier is CONSUMED here (v1.10/#289, resolved by #322): a code
  // that scored 0 renders one line, prefixed by its tier — `info` is a NOTE,
  // never a warning (D12: facts warn); absent = `warn` (the pre-v1.10 checks
  // are all warnings and carry no tier key). A code that is N/A (§8/#399) is
  // stated instead of dropped: it carries no weight in the score above.
  for (const c of geo.checks) {
    if (c.applicable === false) {
      line(`  n/a: [${c.code}] ${c.detail}`);
      continue;
    }
    if (c.score > 0) continue;
    const prefix = c.severity === "info" ? "info" : "warn";
    line(`  ${prefix}: [${c.code}] ${c.detail}`);
  }

  return EXIT.OK;
}
