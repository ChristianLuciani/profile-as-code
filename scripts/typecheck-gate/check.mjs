#!/usr/bin/env node
import { realpathSync } from "node:fs";
/**
 * Test-typecheck gate — issue #181.
 *
 * #181 wired a per-package `tsconfig.test.json` into every package's
 * `typecheck` script, but `pnpm -r typecheck` SKIPS a package that does not
 * declare the script: a package copied from a pre-#181 manifest (or written
 * from scratch, e.g. the planned `packages/server`) leaves its tests
 * unchecked and CI stays green. That is the exact class #181 exists to close
 * — an invariant declared without a mechanical gate — and the repo already
 * gives every other declared invariant a `--check` gate
 * (`dep-gate`, `renderer-map`, `gen-platforms`, `schema-check`).
 *
 * For every workspace package the gate asserts:
 *   1. `scripts.typecheck` references `tsconfig.test.json`;
 *   2. that config exists and parses as JSON;
 *   3. `include` carries both a `src/` and a `tests/` entry;
 *   4. `exclude` does not drop `tests` (an include a matching exclude would
 *      cancel — a silent-pass channel);
 *   5. `compilerOptions.noEmit` is `true`.
 *
 * Zero dependencies, `node >=22`. The workspace walk is the dep-gate's
 * canonical one (imported, never re-implemented): two walkers that disagree
 * on dotfile/symlink semantics silently drop a package from one gate and not
 * the other (the #165 F3 lesson). A workspace shape the gate cannot verify is
 * an explicit failure (E-GATE), never a silent pass.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expandGlob, parseWorkspaceGlobs } from "../dep-gate/check.mjs";

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
class GateError extends Error {}

const CONFIG_NAME = "tsconfig.test.json";

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Discover the workspace package dirs via the dep-gate's canonical walker. */
async function collectPackageDirs(root) {
  const workspaceFile = path.join(root, "pnpm-workspace.yaml");
  if (!(await exists(workspaceFile))) {
    throw new GateError(`no pnpm-workspace.yaml at ${path.resolve(root)}`);
  }
  const globs = parseWorkspaceGlobs(await readFile(workspaceFile, "utf8"));
  const entries = await Promise.all(globs.map((glob) => expandGlob(root, glob)));
  const dirs = [...new Set(entries.flat())].sort();
  if (dirs.length === 0) {
    throw new GateError(
      "the workspace globs match no package with a package.json — a gate that " +
        "checks nothing must not pass (wrong globs are a silent-pass channel)",
    );
  }
  return dirs;
}

/** Does an `exclude` entry name the tests tree (`tests`, `tests/**`, …)? */
function excludesTests(entry) {
  return typeof entry === "string" && (entry === "tests" || entry.startsWith("tests/"));
}

async function readManifest(dir) {
  const manifestPath = path.join(dir, "package.json");
  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new GateError(`unreadable ${manifestPath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GateError(`unparseable ${manifestPath}: ${error.message}`);
  }
}

/** Validate one package; returns the violations for it. */
async function checkPackage(dir, relDir) {
  const violations = [];
  const manifest = await readManifest(dir);
  const name =
    typeof manifest.name === "string" && manifest.name.length > 0 ? manifest.name : relDir;

  const script = manifest.scripts?.typecheck;
  if (typeof script !== "string" || script.length === 0) {
    violations.push(
      `'${relDir}' (${name}) declares no 'typecheck' script — 'pnpm -r typecheck' ` +
        "skips it silently, so its tests would never be type-checked (#181)",
    );
    return violations;
  }
  if (!script.includes(CONFIG_NAME)) {
    violations.push(
      `'${relDir}' (${name}) 'typecheck' is '${script}' — it must run 'tsc -p ${CONFIG_NAME}' ` +
        "so the test suite (not only src) is checked (#181)",
    );
  }

  const configPath = path.join(dir, CONFIG_NAME);
  if (!(await exists(configPath))) {
    violations.push(
      `'${relDir}' (${name}) has no ${CONFIG_NAME} — a tsconfig that excludes 'tests' ` +
        "leaves the suite unchecked (#181)",
    );
    return violations;
  }

  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new GateError(`unparseable ${path.join(relDir, CONFIG_NAME)}: ${error.message}`);
  }

  const include = config.include;
  if (!Array.isArray(include) || include.length === 0) {
    violations.push(`'${relDir}' (${name}) ${CONFIG_NAME} has no 'include' array`);
  } else {
    const hasSrc = include.some((entry) => typeof entry === "string" && entry.startsWith("src/"));
    const hasTests = include.some(
      (entry) => typeof entry === "string" && entry.startsWith("tests/"),
    );
    if (!hasSrc) violations.push(`'${relDir}' (${name}) ${CONFIG_NAME} does not include 'src/'`);
    if (!hasTests)
      violations.push(
        `'${relDir}' (${name}) ${CONFIG_NAME} does not include 'tests/' — the whole point of #181`,
      );
  }

  const exclude = Array.isArray(config.exclude) ? config.exclude : [];
  if (exclude.some(excludesTests)) {
    violations.push(
      `'${relDir}' (${name}) ${CONFIG_NAME} excludes 'tests' — an include a matching ` +
        "exclude cancels, so the suite stays unchecked",
    );
  }

  if (config.compilerOptions?.noEmit !== true) {
    violations.push(
      `'${relDir}' (${name}) ${CONFIG_NAME} does not set 'compilerOptions.noEmit: true'`,
    );
  }

  return violations;
}

/**
 * Run the gate against a workspace root. Returns `{ status, messages }` —
 * the verdict the self-test asserts on.
 */
export async function check(root) {
  const context = [`test-typecheck gate — workspace: ${path.resolve(root)}`];
  try {
    const dirs = await collectPackageDirs(root);
    context.push(`workspace packages: ${dirs.length}`);
    const violations = [];
    for (const dir of dirs) {
      const relDir = path.relative(path.resolve(root), dir).split(path.sep).join("/");
      violations.push(...(await checkPackage(dir, relDir)));
    }
    if (violations.length > 0) {
      return { status: "fail", messages: [...context, ...violations] };
    }
    return {
      status: "pass",
      messages: [...context, `every workspace package wires ${CONFIG_NAME} into 'typecheck'`],
    };
  } catch (error) {
    if (error instanceof GateError) {
      return { status: "fail", messages: [...context, `E-GATE: ${error.message}`] };
    }
    throw error;
  }
}

async function main() {
  const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
  const root = process.argv[2] ?? defaultRoot;
  const result = await check(root);
  for (const message of result.messages) console.log(message);
  console.log(`test-typecheck gate: ${result.status.toUpperCase()}`);
  process.exit(result.status === "pass" ? 0 : 1);
}

/**
 * Direct-execution guard. `import.meta.url` is the REALPATH of this module
 * while `process.argv[1]` is whatever path invoked it — on a machine where the
 * invocation path crosses a symlink (/tmp on macOS), comparing them as-is
 * never matches and the CLI silently no-ops (fail-open). Realpath first
 * (dep-gate premerge F2).
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
