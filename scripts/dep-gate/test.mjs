#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Self-test for the D20 dependency gate (issue #98).
 *
 * The fixture manifests are stored under names Dependabot does NOT discover
 * (`fixture.package.json`, `fixture.pnpm-workspace.yaml`, issue #166) — a
 * placeholder version in a discoverable manifest opens a permanent
 * `Dependabot Updates` failure over a file it cannot parse. Each fixture is
 * therefore MATERIALIZED into a temp dir under the REAL manifest names before
 * it is exercised, so the gate under test is the production path: `check(root)`
 * and `check.mjs` run against a real workspace layout, `check.mjs` itself is
 * untouched. A materializer that drops fixtures fails the suite loudly.
 *
 * Runs `check()` against every workspace-like fixture under `fixtures/` and
 * asserts the gate verdict matches the fixture's `_expect.json` (`"pass"` or
 * `"fail"`), then asserts the CLI's exit-code contract by spawning
 * `check.mjs` on the materialized pass and fail fixtures. Zero dependencies,
 * `node scripts/dep-gate/test.mjs`.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { check } from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");

/** Stored name -> real manifest name, restored when materializing a fixture. */
const MANIFEST_NAMES = new Map([
  ["fixture.package.json", "package.json"],
  ["fixture.pnpm-workspace.yaml", "pnpm-workspace.yaml"],
]);

/**
 * Copy a stored fixture tree into `dest`, restoring the real manifest names.
 * Recurses in full: an entry the materializer cannot copy is an error, never a
 * silently skipped file.
 */
function materializeFixture(source, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(dest, MANIFEST_NAMES.get(entry.name) ?? entry.name);
    if (entry.isDirectory()) {
      materializeFixture(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
    } else {
      throw new Error(`E-TEST: unsupported fixture entry (not a file or directory): ${from}`);
    }
  }
}

const caseDirs = (await readdir(fixturesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (caseDirs.length === 0) {
  console.error("E-TEST: no fixtures found in", fixturesDir);
  process.exit(1);
}

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "d20-fixtures-"));
const materializedRoot = path.join(tmpRoot, "materialized");
mkdirSync(materializedRoot, { recursive: true });
const materialized = new Map();
for (const name of caseDirs) {
  const dest = path.join(materializedRoot, name);
  materializeFixture(path.join(fixturesDir, name), dest);
  materialized.set(name, dest);
}

// Hard assertion: a materializer that silently skips a fixture would shrink the
// suite into a vacuous pass — the failure mode this gate exists to make
// impossible. What actually landed on disk must equal the fixture dirs
// discovered, so a dropped fixture is a loud failure, never a smaller suite.
const materializedCount = readdirSync(materializedRoot, { withFileTypes: true }).filter((entry) =>
  entry.isDirectory(),
).length;
if (materializedCount !== caseDirs.length) {
  rmSync(tmpRoot, { recursive: true, force: true });
  console.error(
    `E-TEST: materialized ${materializedCount}/${caseDirs.length} fixtures — ` +
      "the materializer dropped fixtures; refusing to run a silently shrunk suite",
  );
  process.exit(1);
}

const failures = [];
let passed = 0;
for (const name of caseDirs) {
  const root = materialized.get(name);
  const expected = JSON.parse(await readFile(path.join(fixturesDir, name, "_expect.json"), "utf8"));
  let result;
  try {
    result = await check(root);
  } catch (error) {
    failures.push(`FAIL ${name}: check() threw unexpectedly:\n  ${error.message}`);
    continue;
  }
  const okStatus = result.status === expected.status;
  // `rule` pins WHY a fixture fails — a violation fired by the wrong rule must
  // fail this suite too, not just produce some fail.
  const okRule =
    !expected.rule || result.messages.some((message) => message.includes(expected.rule));
  const messages = result.messages.map((message) => `    ${message}`).join("\n");
  if (!okStatus) {
    failures.push(`FAIL ${name}: expected ${expected.status}, got ${result.status}\n${messages}`);
  } else if (!okRule) {
    failures.push(`FAIL ${name}: expected a '${expected.rule}' finding, got:\n${messages}`);
  } else {
    passed += 1;
    console.log(`PASS ${name}${expected.note ? ` — ${expected.note}` : ""}`);
  }
}

// The CI gate observes the CLI's EXIT CODE, not check()'s status string — and
// the live check is vacuous today, so a broken exit mapping would only surface
// once packages/server already exists. Assert the mapping here, via spawn,
// against the materialized roots (the real manifest names the CLI reads):
const cliPass = spawnSync(
  process.execPath,
  [path.join(here, "check.mjs"), materialized.get("pass-vacuous-absent-server")],
  { encoding: "utf8" },
);
const cliFail = spawnSync(
  process.execPath,
  [path.join(here, "check.mjs"), materialized.get("fail-server-third-party-dep")],
  { encoding: "utf8" },
);

let cliOk = true;
if (cliPass.status !== 0) {
  failures.push(
    `FAIL cli exit: pass fixture exited ${cliPass.status}\n  ${cliPass.stdout}${cliPass.stderr}`,
  );
  cliOk = false;
}
if (cliFail.status !== 1 || !cliFail.stdout.includes("Rule A:")) {
  failures.push(
    `FAIL cli exit: fail fixture exited ${cliFail.status} (expected 1 with a Rule A finding)\n  ${cliFail.stdout}${cliFail.stderr}`,
  );
  cliOk = false;
}
if (cliOk) {
  console.log(
    "PASS cli exit codes — pass fixture exits 0, fail fixture exits 1 with a Rule A finding",
  );
}

// Invoking the CLI through a SYMLINKED path must still run: import.meta.url
// carries the real path while argv[1] carries the symlinked one, so an
// as-is comparison silently no-ops (no output, exit 0 — fail-open; the
// premerge-review F2 repro). /tmp is a symlink on macOS, mirroring it here:
const linkedDir = path.join(tmpRoot, "via-symlink");
symlinkSync(here, linkedDir, "dir");
const cliSymlink = spawnSync(
  process.execPath,
  [path.join(linkedDir, "check.mjs"), materialized.get("pass-vacuous-absent-server")],
  { encoding: "utf8" },
);
if (cliSymlink.status === 0 && cliSymlink.stdout.includes("D20 gate: PASS")) {
  console.log("PASS symlink invocation — the CLI runs through a symlinked path (no silent no-op)");
} else {
  failures.push(
    `FAIL cli symlink: invoking through ${linkedDir} must run the CLI (silent no-op or error)\n  ` +
      `status=${cliSymlink.status} ${cliSymlink.stdout}${cliSymlink.stderr}`,
  );
}

rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${passed}/${caseDirs.length} fixtures passed`);
if (failures.length > 0) {
  console.error(`\nE-TEST: ${failures.length} self-test failures:\n`);
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
