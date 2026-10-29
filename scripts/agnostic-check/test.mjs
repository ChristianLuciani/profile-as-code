#!/usr/bin/env node
/**
 * Self-test for the public-surface agnostic gate (issue #274).
 *
 * A gate that judges a PR without being judged itself is how a class of leak
 * survives: `scripts/link-check` and `scripts/dep-gate` both prove the refusal
 * before they enforce it, and this gate follows the same mold. Each fixture
 * under `fixtures/` is a tree plus its own allowlist and `_expect.json`; the
 * suite spawns the REAL CLI (`check.mjs --root <tree> --allowlist <file>`) so
 * the production path — argument parsing, exit code, message shape — is what
 * gets exercised, never an in-process shortcut.
 *
 * What the fixtures prove, one refusal each:
 *   - a declared private NAME fails (`fail-private-name`);
 *   - a declared private REPO link fails — the #273 clause (`fail-private-repo`);
 *   - an absolute operator path fails (`fail-operator-path`);
 *   - `.github/` is in scope (`fail-github-workflow`);
 *   - hidden session dirs are out of scope (`pass-hidden-session-dir`);
 *   - a path-allowlisted dated record passes (`pass-allowlisted-record`);
 *   - the SAME phrase outside the allowlisted path still fails — exemption is
 *     by path, never by text (`fail-outside-allowlist`);
 *   - a malformed entry and overlapping entries are refused
 *     (`fail-malformed-allowlist`, `fail-overlapping-allowlist`);
 *   - an entry that suppresses nothing warns without failing
 *     (`pass-unused-allowlist`);
 *   - a clean tree, including the generic `/Users/…` documentation placeholder,
 *     passes (`pass-clean`).
 *
 * Fixtures are part of the CI contract: a fixture whose path falls under an
 * ignore pattern (`build/`, `dist/`, `.sota/`, …) never reaches a clean clone,
 * so the suite would pass on the author's machine and fail in CI with ENOENT —
 * a gate tested with a ghost. The runner therefore asserts the tree exists and
 * names the trap instead of surfacing a raw ENOENT.
 *
 * Zero dependencies, `node scripts/agnostic-check/test.mjs`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { check } from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const checkPath = path.join(here, "check.mjs");
const targetsPath = path.join(here, "private-targets.json");

/** Recursive file count, hidden entries included: a partial tree passes in void. */
function countTreeFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countTreeFiles(path.join(dir, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

const cases = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let failed = 0;
for (const name of cases) {
  const dir = path.join(fixturesDir, name);
  let expect;
  try {
    expect = JSON.parse(readFileSync(path.join(dir, "_expect.json"), "utf8"));
  } catch (error) {
    console.error(`FAIL ${name}: unreadable _expect.json: ${error.message}`);
    failed += 1;
    continue;
  }
  const treeDir = path.join(dir, "tree");
  const allowlist = path.join(dir, "allowlist.json");
  if (!existsSync(treeDir) || !existsSync(allowlist)) {
    failed += 1;
    console.error(
      `FAIL ${name}: fixture tree or allowlist is missing (${existsSync(treeDir) ? allowlist : treeDir}) — a fixture under an ignored path never reaches a clean clone`,
    );
    continue;
  }
  if (countTreeFiles(treeDir) !== expect.tree_files) {
    failed += 1;
    console.error(
      `FAIL ${name}: tree carries ${countTreeFiles(treeDir)} file(s), expected ${expect.tree_files} — a fixture file is missing or gitignored (a partial fixture can pass in void)`,
    );
    continue;
  }
  const result = spawnSync(
    process.execPath,
    [checkPath, "--root", treeDir, "--allowlist", path.join(dir, "allowlist.json")],
    { encoding: "utf8" },
  );
  const output = `${result.stdout}${result.stderr}`;
  const problems = [];
  if (result.status !== expect.exit) {
    problems.push(`exit ${result.status} != expected ${expect.exit}`);
  }
  for (const needle of expect.contains ?? []) {
    if (!output.includes(needle)) problems.push(`output is missing ${JSON.stringify(needle)}`);
  }
  for (const needle of expect.notContains ?? []) {
    if (output.includes(needle)) problems.push(`output must not contain ${JSON.stringify(needle)}`);
  }
  if (typeof expect.warnings === "number") {
    const inProcess = check({
      root: treeDir,
      allowlistPath: path.join(dir, "allowlist.json"),
      targetsPath,
    });
    if (inProcess.warnings.length !== expect.warnings) {
      problems.push(
        `machine-readable warnings ${inProcess.warnings.length} != expected ${expect.warnings}`,
      );
    }
  }
  if (problems.length > 0) {
    failed += 1;
    console.error(`FAIL ${name}: ${problems.join("; ")}`);
    console.error(output.trimEnd());
  } else {
    console.log(`ok   ${name} (exit ${result.status})`);
  }
}

if (failed > 0) {
  console.error(`agnostic-check self-test: FAIL — ${failed}/${cases.length} fixture(s) failed`);
  process.exit(1);
}
console.log(`agnostic-check self-test: PASS — ${cases.length}/${cases.length} fixtures`);
