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

import { collectMedia, driftCheck, load, LoadError, registryCheck, SchemaValidationError } from '@profile-as-code/core';
import { parsePlatform } from '../contract.js';
import { EXIT } from '../exit.js';
import { isJsonMode, line, report, section } from '../output.js';

export const CHECK_OWNER = 'M6: handle-matrix rules (brand, offline) executed; M7 (D17/§18.8): registry checks (credential-expiry, no-private-in-public-output) executed; M8 (§18.6): media-transport rules executed; remaining catalog ships with M3/M4 (SPEC §7)';

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

  // Evidence registry (v1.4/D17, §18.8): offline, deterministic. Warn findings
  // report; ERROR findings (the §18.5 leak gate `no-private-in-public-output`)
  // fail the check — renderers emit only public, so a leak must block, not warn.
  const registry = registryCheck(profile);
  // M8 (§18.6 media transport): same severity contract — a broken in-workspace
  // SSOT (missing/unsafe file, declared-checksum mismatch) is an error; per-
  // machine external state (no evidence root, symlink escape, oversize) warns.
  const media = collectMedia(profile, args.workspace).findings;
  const failErrors = [...registry, ...media].filter((f) => f.severity === 'error');

  if (isJsonMode()) {
    return report('check', failErrors.length === 0, failErrors.length === 0 ? EXIT.OK : EXIT.FAIL, {
      data: {
        workspace: args.workspace,
        platform: platform ?? 'all',
        flavor: profile.flavor,
        // Per-rule, machine-readable: handle rules exist for brand only (D15/§17),
        // registry rules run for every flavor (D17/§18.8). A single boolean would
        // overload two different facts.
        implemented: { handleMatrix: profile.flavor === 'brand', registry: true, media: true },
        checks,
        handleMatrix,
        handleIssues,
        registry,
        media,
        ownedBy: CHECK_OWNER,
      },
    });
  }

  section(`evidence registry (D17/§18.8)${platform !== undefined ? ` for ${platform}` : ''}: ${registry.length} finding(s)`);
  for (const finding of registry) {
    line(`  ${finding.severity}: [${finding.code}] ${finding.message} (${finding.path})`);
  }
  if (registry.length === 0) {
    line('  credential-expiry / no-private-in-public-output: OK');
  } else if (registry.filter((f) => f.severity === 'error').length > 0) {
    line(`  ${registry.filter((f) => f.severity === 'error').length} leak error(s) — FAIL (§18.5: public output renders only public entries)`);
  }

  section(`media pipeline (M8/§18.6)${platform !== undefined ? ` for ${platform}` : ''}: ${media.length} finding(s)`);
  for (const finding of media) {
    line(`  ${finding.severity}: [${finding.code}] ${finding.message} (${finding.path})`);
  }
  if (media.length === 0) {
    line('  media transport: OK (no findings)');
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

  line('pasco check: rule engine for the remaining catalog ships M3/M4 (registry + handle rules already executed above)');
  section(`user checks (content/checks.yaml, schema-validated catalog)${platform !== undefined ? ` for ${platform}` : ''}: ${checks.length}`);
  for (const c of checks) {
    const note = c.note !== undefined ? ` note="${c.note}"` : '';
    line(`  [${c.id ?? '?'}] platform=${c.platform} rule=${c.rule} value=${JSON.stringify(c.value)}${note}`);
  }
  line('  not executed — rule execution ships with the skills checks.yaml union (M3) and pasco check (M4)');
  line(`  owner: ${CHECK_OWNER}`);

  return failErrors.length === 0 ? EXIT.OK : EXIT.FAIL;
}
