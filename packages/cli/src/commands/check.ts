/**
 * pasco check [platform]
 *
 * Runs the deterministic, offline rules NOW (brand handle matrix, v1.1/§17) and
 * reports the user's declarative checks from content/checks.yaml (the
 * schema-validated catalog) per platform. The offline limit slice (#240) now
 * executes `max-chars` / `min-chars` over the headline/bio rows that exist;
 * the remaining catalog (live links, fact presence) ships with the skills
 * checks.yaml union (M3) + the full `pasco check` (M4, SPEC §7).
 *
 * Brand flavor (D15/§17): `handle-claimed` and `handle-consistent` are executed
 * here — drift's handle codes (duplicate-handle, handle-claimed-not-linked,
 * handle-host-mismatch) run offline against the SSOT; live reachability is the
 * github-org skill's `url-live` check (network, not drift).
 */

import type { LoadedProfile, Platform } from "@profile-as-code/core";
import {
  collectMedia,
  driftCheck,
  LoadError,
  load,
  registryCheck,
  SchemaValidationError,
} from "@profile-as-code/core";
import { parsePlatform } from "../contract.js";
import { DEFAULT_CHECKS } from "../default-checks.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";

export const CHECK_OWNER =
  "M6: handle-matrix rules (brand, offline) executed; M7 (D17/§18.8): registry checks (credential-expiry, no-private-in-public-output) executed; M8 (§18.6): media-transport rules executed; limits: max-chars/min-chars over existing rows executed (offline); remaining catalog ships with M3/M4 (SPEC §7)";

/** A text-limit finding is WARN by contract (D12: facts warn, schema fails). */
export interface LimitFinding {
  severity: "warn";
  code: "max-chars" | "min-chars";
  message: string;
  path: string;
}

/**
 * Execute the `max-chars` / `min-chars` rows of the (already platform-filtered)
 * check catalog over the rows that exist today: headlines and bios. No network;
 * an optional `surface` selector keeps a title cap off the bio; a non-numeric
 * value is a warn, never a crash (#240).
 */
function limitFindings(
  profile: LoadedProfile,
  checks: LoadedProfile["checks"],
  platform?: Platform,
): LimitFinding[] {
  const rows = [
    ...(profile.headlines ?? []).map((h) => ({
      label: `headline ${h.platform}/${h.lang}`,
      platform: h.platform,
      surface: "headline" as const,
      text: h.text,
      path: `headlines:${h.platform}:${h.lang}`,
    })),
    ...(profile.bios ?? []).map((b) => ({
      label: `bio ${b.platform}/${b.lang}/${b.length}`,
      platform: b.platform,
      surface: "bio" as const,
      text: b.text,
      path: `bios:${b.platform}:${b.lang}:${b.length}`,
    })),
  ];
  const findings: LimitFinding[] = [];
  for (const check of checks) {
    if (check.rule !== "max-chars" && check.rule !== "min-chars") continue;
    if (typeof check.value !== "number" || !Number.isFinite(check.value)) {
      findings.push({
        severity: "warn",
        code: check.rule,
        message: `check ${check.id ?? "(no id)"} has a non-numeric ${check.rule} value — skipped`,
        path: `checks:${check.id ?? "?"}`,
      });
      continue;
    }
    for (const row of rows) {
      if (check.platform !== "all" && check.platform !== row.platform) continue;
      // `all` means every surface in the workspace, but a scoped command must
      // not report another platform's rows under a "for <platform>" header.
      if (check.platform === "all" && platform !== undefined && row.platform !== platform) continue;
      const surface = check.surface ?? "both";
      if (surface !== "both" && surface !== row.surface) continue;
      const length = [...row.text].length;
      const over = check.rule === "max-chars" && length > check.value;
      const under = check.rule === "min-chars" && length < check.value;
      if (!over && !under) continue;
      findings.push({
        severity: "warn",
        code: check.rule,
        message: `${row.label} has ${length} chars, ${over ? "over max" : "under min"} ${check.value}${
          check.note === undefined ? "" : ` — ${check.note}`
        }`,
        path: row.path,
      });
    }
  }
  return findings;
}

/** Handle drift codes the offline handle-matrix execution reports. */
const HANDLE_CODES = new Set([
  "drift/duplicate-handle",
  "drift/handle-claimed-not-linked",
  "drift/handle-host-mismatch",
]);

export interface CheckArgs {
  workspace: string;
  platformArg?: string;
}

export function runCheck(args: CheckArgs): number {
  const platform = args.platformArg !== undefined ? parsePlatform(args.platformArg) : undefined;

  let profile: LoadedProfile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report("check", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report("check", false, EXIT.FAIL, { error: { kind: "load", message: err.message } });
    }
    throw err;
  }

  // A workspace that predates the catalog (or deliberately has no file) still
  // gets the conservative defaults; the dogfood case must not stay silent.
  const baseChecks = profile.checks.length > 0 ? profile.checks : DEFAULT_CHECKS;
  const checks = baseChecks.filter(
    (c) => platform === undefined || c.platform === "all" || c.platform === platform,
  );

  // Brand handle matrix (D15/§17): deterministic, offline execution of
  // handle-claimed + handle-consistent (drift codes) + a per-row report.
  const handleIssues =
    profile.flavor === "brand" ? driftCheck(profile).filter((i) => HANDLE_CODES.has(i.code)) : [];
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
  const limits = limitFindings(profile, checks, platform);
  const failErrors = [...registry, ...media].filter((f) => f.severity === "error");

  if (isJsonMode()) {
    return report("check", failErrors.length === 0, failErrors.length === 0 ? EXIT.OK : EXIT.FAIL, {
      data: {
        workspace: args.workspace,
        platform: platform ?? "all",
        flavor: profile.flavor,
        // Per-rule, machine-readable: handle rules exist for brand only (D15/§17),
        // registry rules run for every flavor (D17/§18.8). A single boolean would
        // overload two different facts.
        implemented: {
          handleMatrix: profile.flavor === "brand",
          registry: true,
          media: true,
          limits: true,
        },
        checks,
        handleMatrix,
        handleIssues,
        registry,
        media,
        limits,
        ownedBy: CHECK_OWNER,
      },
    });
  }

  section(
    `evidence registry (D17/§18.8)${platform !== undefined ? ` for ${platform}` : ""}: ${registry.length} finding(s)`,
  );
  for (const finding of registry) {
    line(`  ${finding.severity}: [${finding.code}] ${finding.message} (${finding.path})`);
  }
  if (registry.length === 0) {
    line("  credential-expiry / no-private-in-public-output: OK");
  } else if (registry.filter((f) => f.severity === "error").length > 0) {
    line(
      `  ${registry.filter((f) => f.severity === "error").length} leak error(s) — FAIL (§18.5: public output renders only public entries)`,
    );
  }

  section(
    `media pipeline (M8/§18.6)${platform !== undefined ? ` for ${platform}` : ""}: ${media.length} finding(s)`,
  );
  for (const finding of media) {
    line(`  ${finding.severity}: [${finding.code}] ${finding.message} (${finding.path})`);
  }
  if (media.length === 0) {
    line("  media transport: OK (no findings)");
  }

  section(
    `text limits (max-chars/min-chars, offline)${platform !== undefined ? ` for ${platform}` : ""}: ${limits.length} finding(s)`,
  );
  for (const finding of limits) {
    line(`  warn: [${finding.code}] ${finding.message} (${finding.path})`);
  }
  if (limits.length === 0) {
    line("  text limits: OK (no findings)");
  }

  if (profile.flavor === "brand") {
    section("handle matrix (brand, §17)");
    if (profile.socialHandles.length === 0) {
      line("  (no socialHandles rows)");
    } else {
      for (const h of profile.socialHandles) {
        const url = h.url !== undefined ? ` → ${h.url}` : "";
        const note = h.note !== undefined ? ` (${h.note})` : "";
        line(`  [${h.status}] ${h.platform} @${h.handle}${url}${note}`);
      }
    }
    if (handleIssues.length === 0) {
      line("  handle-claimed / handle-consistent: OK (no offline violations)");
    } else {
      for (const issue of handleIssues) {
        line(`  warn: [${issue.code}] ${issue.message} (${issue.path})`);
      }
      line(
        `  ${handleIssues.length} handle warning(s) — fix before deploy (live check: github-org skill url-live)`,
      );
    }
  }

  line(
    "pasco check: rule engine for the remaining catalog ships M3/M4 (registry + handle rules already executed above)",
  );
  section(
    `user checks (content/checks.yaml, schema-validated catalog)${platform !== undefined ? ` for ${platform}` : ""}: ${checks.length}`,
  );
  for (const c of checks) {
    const note = c.note !== undefined ? ` note="${c.note}"` : "";
    const executed = c.rule === "max-chars" || c.rule === "min-chars";
    line(
      `  [${c.id ?? "?"}] platform=${c.platform} rule=${c.rule} value=${JSON.stringify(c.value)}${note} — ${executed ? "executed" : "not executed"}`,
    );
  }
  line(
    "  max-chars/min-chars executed above; the remaining rules ship with the skills checks.yaml union (M3) and pasco check (M4)",
  );
  line(`  owner: ${CHECK_OWNER}`);

  return failErrors.length === 0 ? EXIT.OK : EXIT.FAIL;
}
