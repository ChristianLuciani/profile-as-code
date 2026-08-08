/**
 * pac validate — load + schema (FAIL, exit 1, D12) + drift (WARN, exit 0) + geo
 * report (not a gate). Mirror of schema/README.md "Validation semantics".
 */

import { driftCheck, geoCheck, load, LoadError, SchemaValidationError } from '@profile-as-code/core';
import { EXIT } from '../exit.js';
import { isJsonMode, line, report, section } from '../output.js';

export interface ValidateArgs {
  workspace: string;
}

export function runValidate(args: ValidateArgs): number {
  let profile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report('validate', false, EXIT.FAIL, {
        error: {
          kind: 'schema',
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report('validate', false, EXIT.FAIL, { error: { kind: 'load', message: err.message } });
    }
    throw err;
  }

  const drift = driftCheck(profile);
  const geo = geoCheck(profile);

  if (isJsonMode()) {
    return report('validate', true, EXIT.OK, {
      data: { workspace: args.workspace, schema: 'valid', drift, geo },
    });
  }

  section('schema');
  line('valid — profile conforms to profile.schema.json (D3/D12)');

  section('drift');
  if (drift.length === 0) {
    line('no drift warnings');
  } else {
    for (const issue of drift) {
      const where = issue.path ? ` (${issue.path})` : '';
      const surfaces = issue.surfaces?.length ? ` [${issue.surfaces.join(', ')}]` : '';
      line(`  warn: [${issue.code}]${surfaces} ${issue.message}${where}`);
    }
    line(`  ${drift.length} warning(s) — exit 0 (D12: facts warn, schema fails)`);
  }

  section('geo');
  line(`  overall score: ${geo.score}/100`);
  for (const s of Object.values(geo.sections)) {
    line(`  ${s.label}: ${s.score}/100 — ${s.detail}`);
  }

  return EXIT.OK;
}
