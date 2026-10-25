/**
 * pasco validate — load + schema (FAIL, exit 1, D12) + drift (WARN, exit 0) + geo
 * report (not a gate). Mirror of schema/README.md "Validation semantics".
 */

import type { LoadedProfile } from "@profile-as-code/core";
import {
  driftCheck,
  geoCheck,
  LoadError,
  load,
  SchemaValidationError,
} from "@profile-as-code/core";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";
import { hasVariantBody } from "../variant-store.js";

export interface ValidateArgs {
  workspace: string;
}

export function runValidate(args: ValidateArgs): number {
  let profile: LoadedProfile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report("validate", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
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
  // core drift check cannot see the workspace file, so reconcile it here.
  const drift = driftCheck(profile).filter((issue) => {
    if (issue.code !== "drift/active-variant-missing") return true;
    const platform = issue.surfaces?.[0];
    if (platform === undefined) return true;
    const active = profile.active?.[platform];
    if (active === undefined) return true;
    return !hasVariantBody(args.workspace, platform, active.variantId);
  });
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
  line(`  overall score: ${geo.score}/100`);
  for (const s of Object.values(geo.sections)) {
    line(`  ${s.label}: ${s.score}/100 — ${s.detail}`);
  }
  // The severity tier is CONSUMED here (v1.10/#289, resolved by #322): a code
  // that scored 0 renders one line, prefixed by its tier — `info` is a NOTE,
  // never a warning (D12: facts warn); absent = `warn` (the pre-v1.10 checks
  // are all warnings and carry no tier key).
  for (const c of geo.checks) {
    if (c.score > 0) continue;
    const prefix = c.severity === "info" ? "info" : "warn";
    line(`  ${prefix}: [${c.code}] ${c.detail}`);
  }

  return EXIT.OK;
}
