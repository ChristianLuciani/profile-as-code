#!/usr/bin/env node
import { realpathSync } from "node:fs";
/**
 * gen-packages — the workspace package INVENTORY has one source: the globs (#226).
 *
 * The `## Map` table in `AGENTS.md` lists which package lives where. Before this
 * gate those rows were hand-written with NOTHING to cross-check them against:
 * `pnpm-workspace.yaml` declares `packages/*` and `packages/renderers/*`, and
 * #216 had to add `packages/artifact` to the Map by hand — nothing would have
 * failed had it been forgotten (exactly how a stale inventory ships).
 *
 * The source is the workspace globs, DERIVED not hardcoded: every directory that
 * `pnpm-workspace.yaml` matches AND that carries a `package.json` is a package
 * (`packages/renderers/` itself carries none, so it is not one — its eight
 * children are). The target is the Map; the gate asserts the two agree:
 *
 *   E-GATE  a workspace package the Map does not cover — an omitted package
 *           (the #216 shape), refused instead of shipped;
 *   E-GATE  a Map row naming a `packages/…` path that is neither a workspace
 *           package nor a directory containing one — a package that does not
 *           exist, or a directory (e.g. `packages/server/`) the workspace does
 *           not include;
 *   E-GATE  the degenerate escape hatch: a single row for the package ROOT
 *           (`packages`) would "cover" everything and verify nothing;
 *   E-GATE  no `packages/…` row at all, or an unreadable Map.
 *
 * There is nothing to WRITE: the Map's `What`/`Notes` columns are hand-authored
 * prose, so the projection target is the assertion itself. `--check` emits the
 * CI verdict; the default mode additionally prints the derived inventory.
 * The workspace walk is REUSED, not re-implemented: `parseWorkspaceGlobs` and
 * `expandGlob` come from `scripts/dep-gate/check.mjs` (the same walker
 * `scripts/renderer-map/gen.mjs` uses), so two gates can never disagree on what
 * a workspace member is.
 *
 * Zero dependencies, node >=22 — like `scripts/dep-gate` and the D3 gates it
 * mirrors. Exit: 0 in sync · 1 E-GATE refusal (reason on stdout).
 *
 * Usage:  node scripts/gen-packages/gen.mjs [--root DIR] [--check]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expandGlob, parseWorkspaceGlobs } from "../dep-gate/check.mjs";

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
class GateError extends Error {}

const WORKSPACE_REL = "pnpm-workspace.yaml";
const AGENTS_REL = "AGENTS.md";
const ROOT_PREFIX = "packages";

const rel = (root, target) => path.relative(root, target) || ".";

/** POSIX-normalized, no trailing slash: `packages/core/` → `packages/core`. */
const normalize = (value) => value.replace(/\/+$/, "");

/**
 * The `packages/…` paths named in the `## Map` table of `AGENTS.md`.
 *
 * Scoped to the Map section on purpose: package paths also appear in prose
 * (`packages/core/src/generated/schema.zod.ts`) and in other tables, and those
 * are not inventory rows. Only a row's FIRST cell counts — the Map's `Where`
 * column — so a path mentioned inside `What`/`Notes` cannot be read as a row.
 */
export function parseMapRows(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Map\s*$/.test(line));
  if (start === -1) {
    throw new GateError(`${AGENTS_REL}: missing the "## Map" section`);
  }
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|");
    const first = cells[1] ?? "";
    const match = first.match(/`([^`]+)`/);
    if (match === null) continue;
    const where = normalize(match[1]);
    if (where === ROOT_PREFIX || where.startsWith(`${ROOT_PREFIX}/`)) rows.push(where);
  }
  return rows;
}

/** Derive the workspace packages from the globs — the walker, reused. */
async function derivePackages(root) {
  let source;
  try {
    source = await readFile(path.join(root, WORKSPACE_REL), "utf8");
  } catch (error) {
    throw new GateError(`cannot read ${WORKSPACE_REL}: ${error.message}`);
  }
  let globs;
  try {
    globs = parseWorkspaceGlobs(source);
  } catch (error) {
    // dep-gate's parser (reused, self-tested there): by its contract any throw
    // is a shape it refuses to read — never a silent pass. Translate the error
    // class so this gate's refusals stay one vocabulary (E-GATE).
    throw new GateError(`${WORKSPACE_REL}: ${error.message}`);
  }
  const found = new Set();
  for (const segments of globs) {
    let dirs;
    try {
      dirs = await expandGlob(root, segments);
    } catch (error) {
      throw new GateError(`${WORKSPACE_REL}: ${error.message}`);
    }
    for (const dir of dirs) found.add(normalize(rel(root, dir).split(path.sep).join("/")));
  }
  if (found.size === 0) {
    throw new GateError(`${WORKSPACE_REL} matches no package with a package.json`);
  }
  return [...found].sort();
}

/** The coverage model, or an `E-GATE` reason. */
export function coverage(packages, rows) {
  if (rows.length === 0) {
    throw new GateError(
      `${AGENTS_REL}: the Map lists no \`${ROOT_PREFIX}/…\` package — the inventory has no rows to verify`,
    );
  }
  // The degenerate row: `packages` alone is an ancestor of every package, so it
  // would "cover" the whole inventory while naming none of it (a fail-open).
  const degenerate = rows.filter((row) => row === ROOT_PREFIX);
  if (degenerate.length > 0) {
    throw new GateError(
      `${AGENTS_REL}: the Map covers the inventory with a single \`${ROOT_PREFIX}\` row — name each package (a row for the package root verifies nothing)`,
    );
  }

  const omitted = packages.filter(
    (pkg) => !rows.some((row) => row === pkg || pkg.startsWith(`${row}/`)),
  );
  if (omitted.length > 0) {
    throw new GateError(
      `${AGENTS_REL}: the Map omits ${omitted.length} workspace package(s) that ${WORKSPACE_REL} includes: ${omitted.join(", ")} — add a row (or a directory row covering them)`,
    );
  }

  const covered = new Set();
  for (const pkg of packages) for (const row of rows) if (row === pkg) covered.add(row);

  const phantom = [];
  for (const row of rows) {
    const isPackage = packages.includes(row);
    const isAncestor = packages.some((pkg) => pkg.startsWith(`${row}/`));
    if (!isPackage && !isAncestor) phantom.push(row);
  }
  if (phantom.length > 0) {
    throw new GateError(
      `${AGENTS_REL}: the Map lists ${phantom.length} \`${ROOT_PREFIX}/…\` path(s) that are not workspace packages (${WORKSPACE_REL} matches no package.json there): ${phantom.join(", ")}`,
    );
  }

  return { packages, rows, direct: [...covered].sort() };
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const rootIndex = argv.indexOf("--root");
  const root =
    rootIndex === -1
      ? fileURLToPath(new URL("../../", import.meta.url))
      : path.resolve(argv[rootIndex + 1] ?? "");

  try {
    const packages = await derivePackages(root);
    let agents;
    try {
      agents = await readFile(path.join(root, AGENTS_REL), "utf8");
    } catch (error) {
      throw new GateError(`cannot read ${AGENTS_REL}: ${error.message}`);
    }
    const rows = parseMapRows(agents);
    const model = coverage(packages, rows);

    if (!check) {
      for (const pkg of model.packages) {
        console.log(`  ${pkg}${model.direct.includes(pkg) ? "" : " (covered by a directory row)"}`);
      }
    }
    console.log(
      `gen-packages: in sync (${model.packages.length} workspace package(s) covered by the ${AGENTS_REL} Map)`,
    );
  } catch (error) {
    if (error instanceof GateError) {
      console.log(`E-GATE: ${error.message}`);
      console.log("gen-packages: FAIL");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Direct-execution guard (the dep-gate idiom): `import.meta.url` is the REALPATH
 * of this module while `process.argv[1]` is whatever path invoked it — on a
 * machine where the invocation crosses a symlink (/tmp is one on macOS) the two
 * never match as-is and the CLI silently no-ops (a fail-open).
 */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // unresolvable path — compare as-is rather than fail closed on a probe
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isMain()) {
  await main();
}
