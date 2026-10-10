#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Self-test for the publishable-surface gate (issue #190).
 *
 * Fixtures are stored under names Dependabot does NOT discover
 * (`fixture.package.json`, `fixture.pnpm-workspace.yaml`, the #166 precedent):
 * a placeholder version in a discoverable manifest opens a permanent
 * `Dependabot Updates` failure over a file it cannot parse. Each fixture is
 * therefore MATERIALIZED into a temp dir under the REAL manifest names before
 * it is exercised, so the gate under test is the production path:
 * `check(root)` and `check.mjs` run against a real workspace layout,
 * `check.mjs` itself is untouched.
 *
 * Every case asserts BOTH the verdict and WHY it failed (a `marker` substring
 * in the gate's output), so a violation fired for the wrong reason — or the
 * wrong package — fails this suite too: a gate that fails everything for one
 * reason is as broken as one that passes everything. The CLI exit-code
 * contract is asserted by spawning `check.mjs`, and the allowlist EXEMPTION is
 * exercised through `check(root, { publishable })` — the seam that proves a
 * directory is exempt because it is allowlisted, not because it is hardcoded.
 *
 * Zero dependencies, `node scripts/publishable-gate/test.mjs`.
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
  // A manifest that is deliberately INVALID JSON is stored without a `.json`
  // suffix: a committed broken `.json` makes Biome fail on a file it cannot
  // parse, an unrelated second red. Materialized under the real name it
  // exercises the gate's parse-error path.
  ["fixture.package.invalid-json", "package.json"],
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

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "publishable-fixtures-"));
const materializedRoot = path.join(tmpRoot, "materialized");
mkdirSync(materializedRoot, { recursive: true });
const materialized = new Map();
for (const name of caseDirs) {
  const dest = path.join(materializedRoot, name);
  materializeFixture(path.join(fixturesDir, name), dest);
  materialized.set(name, dest);
}

// Hard assertion: a materializer that silently skips a fixture would shrink
// the suite into a vacuous pass — the failure mode this gate exists to make
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
    // An `_expect.json` carrying `publishable` exercises the allowlist seam;
    // absent, the gate's own default allowlist applies (the CLI path).
    result = await check(root, { publishable: expected.publishable });
  } catch (error) {
    failures.push(`FAIL ${name}: check() threw unexpectedly:\n  ${error.message}`);
    continue;
  }
  const okStatus = result.status === expected.status;
  // `marker` pins WHY a fixture fails — a violation fired for the wrong reason
  // (or naming the wrong package) must fail this suite too, not just produce
  // some fail.
  const okMarker =
    !expected.marker || result.messages.some((message) => message.includes(expected.marker));
  const messages = result.messages.map((message) => `    ${message}`).join("\n");
  if (!okStatus) {
    failures.push(`FAIL ${name}: expected ${expected.status}, got ${result.status}\n${messages}`);
  } else if (!okMarker) {
    failures.push(`FAIL ${name}: expected a '${expected.marker}' finding, got:\n${messages}`);
  } else {
    passed += 1;
    console.log(`PASS ${name}${expected.note ? ` — ${expected.note}` : ""}`);
  }
}

// The CI gate observes the CLI's EXIT CODE, not check()'s status string — and
// the live check is a thin wrapper over check(), so a broken exit mapping
// would only surface in CI. Assert the mapping here, via spawn, against the
// materialized roots (the real manifest names the CLI reads). The CLI always
// uses the gate's default allowlist, so these two are chosen accordingly.
const cliPass = spawnSync(
  process.execPath,
  [path.join(here, "check.mjs"), materialized.get("pass-cli-publishable-rest-private")],
  { encoding: "utf8" },
);
const cliFail = spawnSync(
  process.execPath,
  [path.join(here, "check.mjs"), materialized.get("fail-extra-package-not-private")],
  { encoding: "utf8" },
);

let cliOk = true;
if (cliPass.status !== 0 || !cliPass.stdout.includes("publishable gate: PASS")) {
  failures.push(
    `FAIL cli exit: pass fixture exited ${cliPass.status}\n  ${cliPass.stdout}${cliPass.stderr}`,
  );
  cliOk = false;
}
if (cliFail.status !== 1 || !cliFail.stdout.includes("'packages/server' (@fixture/server)")) {
  failures.push(
    `FAIL cli exit: fail fixture exited ${cliFail.status} (expected 1 naming packages/server)\n  ` +
      `${cliFail.stdout}${cliFail.stderr}`,
  );
  cliOk = false;
}
if (cliOk) {
  console.log(
    "PASS cli exit codes — pass fixture exits 0, fail fixture exits 1 naming the offending package",
  );
}

// Invoking the CLI through a SYMLINKED path must still run: import.meta.url
// carries the real path while argv[1] carries the symlinked one, so an as-is
// comparison silently no-ops (no output, exit 0 — fail-open; the dep-gate
// premerge F2 repro). /tmp is a symlink on macOS, mirroring it here.
const linkedDir = path.join(tmpRoot, "via-symlink");
symlinkSync(here, linkedDir, "dir");
const cliSymlink = spawnSync(
  process.execPath,
  [path.join(linkedDir, "check.mjs"), materialized.get("pass-cli-publishable-rest-private")],
  { encoding: "utf8" },
);
if (cliSymlink.status === 0 && cliSymlink.stdout.includes("publishable gate: PASS")) {
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
