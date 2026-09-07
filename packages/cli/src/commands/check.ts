/**
 * pasco check [platform]
 *
 * Runs the deterministic, offline rules NOW (brand handle matrix, v1.1/§17) and
 * reports the user's declarative checks from content/checks.yaml (the
 * schema-validated catalog) per platform. Rule EXECUTION for the remaining
 * catalog (limits, live links, fact presence) ships with the skills checks.yaml
 * union (M3) + the full `pasco check` (M4, SPEC §7).
 *
 * Brand flavor (D15/§17): `handle-claimed` and `handle-consistent` are executed
 * here — drift's handle codes (duplicate-handle, handle-claimed-not-linked,
 * handle-host-mismatch) run offline against the SSOT; live reachability is the
 * github-org skill's `url-live` check (network, not drift).
 */

import { driftCheck, load, LoadError, SchemaValidationError } from '@profile-as-code/core';
import { parsePlatform } from '../contract.js';
import { EXIT } from '../exit.js';
import { isJsonMode, line, report, section } from '../output.js';

export const CHECK_OWNER = 'M6: handle-matrix rules (brand, offline) executed; remaining catalog ships with M3/M4 (SPEC §7)';

/** Handle drift codes the offline handle-matrix execution reports. */
const HANDLE_CODES = new Set(['drift/duplicate-handle', 'drift/handle-claimed-not-linked', 'drift/handle-host-mismatch']);

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

  // Brand handle matrix (D15/§17): deterministic, offline execution of
  // handle-claimed + handle-consistent (drift codes) + a per-row report.
  const handleIssues =
    profile.flavor === 'brand' ? driftCheck(profile).filter((i) => HANDLE_CODES.has(i.code)) : [];
  const handleMatrix = profile.socialHandles.map((h) => ({
    platform: h.platform,
    handle: h.handle,
    status: h.status,
    ...(h.url !== undefined ? { url: h.url } : {}),
    ...(h.note !== undefined ? { note: h.note } : {}),
  }));

  if (isJsonMode()) {
    return report('check', true, EXIT.OK, {
      data: {
        workspace: args.workspace,
        platform: platform ?? 'all',
        flavor: profile.flavor,
        implemented: profile.flavor === 'brand', // handle rules are implemented for brand
        checks,
        handleMatrix,
        handleIssues,
        ownedBy: CHECK_OWNER,
      },
    });
  }

  if (profile.flavor === 'brand') {
    section('handle matrix (brand, §17)');
    if (profile.socialHandles.length === 0) {
      line('  (no socialHandles rows)');
    } else {
      for (const h of profile.socialHandles) {
        const url = h.url !== undefined ? ` → ${h.url}` : '';
        const note = h.note !== undefined ? ` (${h.note})` : '';
        line(`  [${h.status}] ${h.platform} @${h.handle}${url}${note}`);
      }
    }
    if (handleIssues.length === 0) {
      line('  handle-claimed / handle-consistent: OK (no offline violations)');
    } else {
      for (const issue of handleIssues) {
        line(`  warn: [${issue.code}] ${issue.message} (${issue.path})`);
      }
      line(`  ${handleIssues.length} handle warning(s) — fix before deploy (live check: github-org skill url-live)`);
    }
  }

  line('pasco check: STUB for the remaining catalog — rule engine ships M3/M4');
  section(`user checks (content/checks.yaml, schema-validated catalog)${platform !== undefined ? ` for ${platform}` : ''}: ${checks.length}`);
  for (const c of checks) {
    const note = c.note !== undefined ? ` note="${c.note}"` : '';
    line(`  [${c.id ?? '?'}] platform=${c.platform} rule=${c.rule} value=${JSON.stringify(c.value)}${note}`);
  }
  line('  not executed — rule execution ships with the skills checks.yaml union (M3) and pasco check (M4)');
  line(`  owner: ${CHECK_OWNER}`);

  return EXIT.OK;
}
