/**
 * Which cap rows the limit executor measures — ONE home (#dogfood 2026-11-04).
 *
 * The workspace's declared catalog when it declares checks, else the conservative
 * caps shipped with the package (#240). Two facts made this a module instead of a
 * repeated ternary:
 *
 *  - the rule was copied in four call sites (`check`, `edit` twice, and
 *    `publicationOfCaller` for `status`), so a change had to find them all;
 *  - two published surfaces (the `check` report and `preview`'s limits table)
 *    attributed the rows to `facts/checks.yaml` even when that file did not
 *    exist — it printed over the package defaults on a real workspace with no
 *    catalog at all.
 *
 * The FILENAME is deliberately not derivable from here. `load()` merges every
 * `facts/*.y{a,}ml` by root property and reports no source, so no surface can
 * know which file declared the rows: claiming the conventional name was false for
 * an empty `checks.yaml` (declared, zero rows) and for a workspace using
 * `checks.yml`. Surfaces name the SOURCE (workspace vs package), which is the
 * fact the executor actually resolved.
 */

import type { LoadedProfile } from "@profile-as-code/core";

/** Where the cap rows came from: the workspace's catalog, or the package's. */
export type CatalogSource = "workspace" | "defaults";

/** The rows the limit executor measures for this workspace. */
export function capCatalog(
  profile: LoadedProfile,
  defaults: LoadedProfile["checks"],
): LoadedProfile["checks"] {
  return profile.checks.length > 0 ? profile.checks : defaults;
}

/** The source `capCatalog` resolved — for the surfaces that must say it. */
export function catalogSource(profile: LoadedProfile): CatalogSource {
  return profile.checks.length > 0 ? "workspace" : "defaults";
}

/** The text report's sentence for a source (the HTML preview phrases its own).
 *  Names the SOURCE, never the file: `load()` merges the facts dir's
 *  `*.y{a,}ml` by root property and reports no source, and the directory name
 *  itself varies (D30 alias) — a hardcoded path would be a claim the engine
 *  cannot make (false for a legacy `facts/` workspace, false for `checks.yml`). */
export function catalogLabel(source: CatalogSource): string {
  return source === "workspace"
    ? "workspace checks (schema-validated catalog)"
    : "workspace checks: none declared — the conservative caps shipped with pasco apply (#240)";
}
