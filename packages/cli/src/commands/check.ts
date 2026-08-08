/**
 * pac check [platform]
 *
 * STUB — reads the user's declarative checks from content/checks.yaml (the
 * schema-validated catalog) and reports them per platform. Rule EXECUTION ships
 * with the skills `checks.yaml` union (M3) + the full `pac check` (M4, SPEC §7).
 */

import { load, LoadError, SchemaValidationError } from '@profile-as-code/core';
import { parsePlatform } from '../contract.js';
import { EXIT } from '../exit.js';
import { isJsonMode, line, report, section } from '../output.js';

export const CHECK_OWNER = 'M3 skills checks.yaml union + M4 pac check execution (SPEC §12)';

export interface CheckArgs {
  workspace: string;
  platformArg?: string;
}

export function runCheck(args: CheckArgs): number {
  const platform = args.platformArg !== undefined ? parsePlatform(args.platformArg) : undefined;

  let profile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report('check', false, EXIT.FAIL, {
        error: {
          kind: 'schema',
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report('check', false, EXIT.FAIL, { error: { kind: 'load', message: err.message } });
    }
    throw err;
  }

  const checks = profile.checks.filter(
    (c) => platform === undefined || c.platform === 'all' || c.platform === platform,
  );

  if (isJsonMode()) {
    return report('check', true, EXIT.OK, {
      data: {
        workspace: args.workspace,
        platform: platform ?? 'all',
        implemented: false,
        checks,
        ownedBy: CHECK_OWNER,
      },
    });
  }

  line('pac check: STUB — rule engine not implemented yet');
  section(`user checks (content/checks.yaml, schema-validated catalog)${platform !== undefined ? ` for ${platform}` : ''}: ${checks.length}`);
  for (const c of checks) {
    const note = c.note !== undefined ? ` note="${c.note}"` : '';
    line(`  [${c.id ?? '?'}] platform=${c.platform} rule=${c.rule} value=${JSON.stringify(c.value)}${note}`);
  }
  line('  not executed — rule execution ships with the skills checks.yaml union (M3) and pac check (M4)');
  line(`  owner: ${CHECK_OWNER}`);

  return EXIT.OK;
}
