/**
 * The per-surface rule catalog — ONE home for "which premise does this surface
 * declare?".
 *
 * A skill ships its own `checks.yaml` (`skills/<platform>/checks.yaml`, SPEC §16.1)
 * and `pasco check` runs the UNION of the workspace's `content/checks.yaml` and the
 * shipped skill catalog (SPEC §7). A rule executor that ignored the catalog would
 * run a premise nobody declared, on surfaces nobody asked for — and the catalog
 * note ("what this premise means") could say something different from the code,
 * which is the drift the engine exists to prevent.
 *
 * `fact-present` is the first rule to consult this (#283/F6): the rule runs only
 * for a surface whose catalog declares it, and `link-in-identity` stays a SEPARATE
 * premise (it asks "does every surface URL live in `identity.links`", a different
 * question from "does the surface carry the SSOT's facts").
 *
 * Read-only, deterministic, offline: the shipped tree is resolved by `skill-path`
 * (the one home for skill lookup, including `PASCO_SKILLS_DIR` and the packaged
 * copy). A package that ships no skills declares nothing — never an invented path.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadedProfile } from "@profile-as-code/core";
import { parse } from "yaml";
import { skillsDir } from "./skill-path.js";

/** One catalog row, structurally compatible with the workspace's `content/checks.yaml`. */
export interface CatalogRow {
  id?: string;
  platform: string;
  rule: string;
  value?: unknown;
  note?: string;
}

function isCatalogRow(value: unknown): value is CatalogRow {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.platform === "string" && typeof row.rule === "string";
}

/** The shipped skill catalog for one surface, or `[]` when it declares none. */
export function shippedChecks(platform: string): CatalogRow[] {
  const root = skillsDir();
  if (root === undefined) return [];
  const path = join(root, platform, "checks.yaml");
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = parse(readFileSync(path, "utf8"));
  } catch {
    // A malformed shipped catalog is a packaging bug, not a verdict: declare
    // nothing and let the rule report "not declared" rather than crash the CLI.
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isCatalogRow) : [];
}

/**
 * The surfaces among `candidates` whose catalog DECLARES `rule` — the workspace's
 * schema-validated rows (a row with `platform: all` covers every surface) unioned
 * with the shipped skill catalog. Deterministic order: the candidates' order.
 */
export function declaredSurfaces(
  rule: string,
  candidates: readonly string[],
  workspaceChecks: LoadedProfile["checks"],
): string[] {
  return candidates.filter((surface) => {
    const own = (workspaceChecks ?? []).some(
      (check) => (check.platform === "all" || check.platform === surface) && check.rule === rule,
    );
    if (own) return true;
    return shippedChecks(surface).some((check) => check.rule === rule);
  });
}
