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
 * copy). The three states of that lookup are PRESERVED here (#253): "this package
 * ships no skills" (a broken bundle), "the tree ships but this surface has no
 * catalog" (nothing declared), and "found". Collapsing them would let a broken
 * bundle read as "the premise is not declared anywhere" — the same silent-absence
 * failure the audit exists to prevent, one level up.
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

/** Whether this package ships a skills tree at all — the `not-shipped` leg of the
 *  #253 three-state contract, carried all the way to the audit payload. */
export type CatalogState = "shipped" | "not-shipped";

export function catalogState(): CatalogState {
  return skillsDir() === undefined ? "not-shipped" : "shipped";
}

/** One surface's shipped catalog, with the state that produced it. */
export type ShippedCatalog =
  | { state: "found"; rows: CatalogRow[] }
  | { state: "no-catalog"; rows: CatalogRow[] }
  | { state: "not-shipped"; rows: CatalogRow[] };

/** Resolve a surface's catalog under an explicit skills root — pure, so the three
 *  states are testable without hiding the packaged tree. */
export function catalogAt(root: string | undefined, platform: string): ShippedCatalog {
  if (root === undefined) return { state: "not-shipped", rows: [] };
  const path = join(root, platform, "checks.yaml");
  if (!existsSync(path)) return { state: "no-catalog", rows: [] };
  let parsed: unknown;
  try {
    parsed = parse(readFileSync(path, "utf8"));
  } catch {
    // A malformed shipped catalog is a packaging bug, not a verdict: declare
    // nothing and let the rule report "no catalog" rather than crash the CLI.
    return { state: "no-catalog", rows: [] };
  }
  const rows = Array.isArray(parsed) ? parsed.filter(isCatalogRow) : [];
  return { state: "found", rows };
}

/** The shipped catalog for one surface under the resolved skills tree. */
export function shippedCatalog(platform: string): ShippedCatalog {
  return catalogAt(skillsDir(), platform);
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
    return shippedCatalog(surface).rows.some((check) => check.rule === rule);
  });
}
