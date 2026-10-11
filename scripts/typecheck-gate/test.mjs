#!/usr/bin/env node
/**
 * Self-test for the test-typecheck gate (issue #181).
 *
 * Fixtures are SYNTHESIZED into temp dirs (never committed as real
 * `package.json` files): a committed placeholder manifest would open a
 * permanent Dependabot failure over a file it cannot parse (#166), and
 * materializing from stored copies buys nothing when the tree is this small.
 * `check(root)` and `check.mjs` run against real workspace layouts.
 *
 * Each case asserts BOTH the verdict and WHY it failed (a marker), so a
 * violation fired for the wrong reason fails this suite too — a gate that
 * fails everything for one reason is as broken as one that passes everything.
 * The CLI's exit-code contract is asserted by spawning `check.mjs`.
 *
 * Zero dependencies, `node scripts/typecheck-gate/test.mjs`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { check } from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const WORKSPACE = "packages:\n  - packages/*\n";

const VALID_CONFIG = `${JSON.stringify(
  {
    extends: "./tsconfig.json",
    compilerOptions: { noEmit: true, rootDir: "." },
    include: ["src/**/*.ts", "tests/**/*.ts"],
    exclude: ["dist", "node_modules"],
  },
  null,
  2,
)}\n`;

function write(root, rel, content) {
  const target = path.join(root, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function packageJson(root, name, script) {
  const manifest = { name, version: "0.0.0", scripts: {} };
  if (script !== undefined) manifest.scripts.typecheck = script;
  write(root, "packages/alpha/package.json", `${JSON.stringify(manifest, null, 2)}\n`);
}

/** name -> { build(root), expect: { status, marker? } } */
const CASES = {
  pass: {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", "tsc -p tsconfig.test.json");
      write(root, "packages/alpha/tsconfig.test.json", VALID_CONFIG);
    },
    expect: { status: "pass" },
  },
  "pass-two-packages": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", "tsc -p tsconfig.test.json");
      write(root, "packages/alpha/tsconfig.test.json", VALID_CONFIG);
      write(
        root,
        "packages/beta/package.json",
        `${JSON.stringify({ name: "beta", scripts: { typecheck: "tsc -p tsconfig.test.json" } })}\n`,
      );
      write(root, "packages/beta/tsconfig.test.json", VALID_CONFIG);
    },
    expect: { status: "pass" },
  },
  "fail-missing-script": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", undefined);
      write(root, "packages/alpha/tsconfig.test.json", VALID_CONFIG);
    },
    expect: { status: "fail", marker: "declares no 'typecheck' script" },
  },
  "fail-old-script": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", "tsc -p tsconfig.json --noEmit");
      write(root, "packages/alpha/tsconfig.test.json", VALID_CONFIG);
    },
    expect: { status: "fail", marker: "must run 'tsc -p tsconfig.test.json'" },
  },
  "fail-missing-config": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", "tsc -p tsconfig.test.json");
    },
    expect: { status: "fail", marker: "has no tsconfig.test.json" },
  },
  "fail-include-no-tests": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", "tsc -p tsconfig.test.json");
      write(
        root,
        "packages/alpha/tsconfig.test.json",
        `${JSON.stringify({ compilerOptions: { noEmit: true }, include: ["src/**/*.ts"] })}\n`,
      );
    },
    expect: { status: "fail", marker: "does not include 'tests/'" },
  },
  "fail-exclude-tests": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", "tsc -p tsconfig.test.json");
      write(
        root,
        "packages/alpha/tsconfig.test.json",
        `${JSON.stringify(
          {
            compilerOptions: { noEmit: true },
            include: ["src/**/*.ts", "tests/**/*.ts"],
            exclude: ["tests"],
          },
          null,
          2,
        )}\n`,
      );
    },
    expect: { status: "fail", marker: "excludes 'tests'" },
  },
  "fail-noemit": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", "tsc -p tsconfig.test.json");
      write(
        root,
        "packages/alpha/tsconfig.test.json",
        `${JSON.stringify({ include: ["src/**/*.ts", "tests/**/*.ts"] })}\n`,
      );
    },
    expect: { status: "fail", marker: "noEmit: true" },
  },
  "fail-unparseable-config": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", "tsc -p tsconfig.test.json");
      write(root, "packages/alpha/tsconfig.test.json", "{ include: [ }");
    },
    expect: { status: "fail", marker: "E-GATE: unparseable" },
  },
  "fail-null-manifest": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      write(root, "packages/alpha/package.json", "null\n");
    },
    // A manifest that PARSES as the JSON literal `null` has no `.name`/`.scripts`
    // to read — the gate must refuse it in its E-GATE vocabulary instead of
    // crashing on the property access (#198).
    expect: { status: "fail", marker: "is not a JSON object (found: null)" },
  },
  "fail-null-config": {
    build(root) {
      write(root, "pnpm-workspace.yaml", WORKSPACE);
      packageJson(root, "alpha", "tsc -p tsconfig.test.json");
      write(root, "packages/alpha/tsconfig.test.json", "null\n");
    },
    // Same class as `fail-null-manifest`, on the other JSON document the gate
    // parses: `null` has no `.include`/`.compilerOptions` (#198b).
    expect: {
      status: "fail",
      marker: "tsconfig.test.json' is not a JSON object (found: null)",
    },
  },
  "fail-workspace-glob-shape": {
    build(root) {
      write(root, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    },
    // `parseWorkspaceGlobs` is dep-gate's module: it throws dep-gate's
    // `GateError`, which this gate's `catch (error instanceof GateError)` does
    // not match — so without an explicit translation the refusal escapes as an
    // uncaught exception instead of E-GATE (the translation publishable-gate
    // added in #199; #198b).
    expect: { status: "fail", marker: "E-GATE: pnpm-workspace.yaml" },
  },
  "fail-empty-workspace": {
    build(root) {
      write(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    },
    expect: { status: "fail", marker: "match no package" },
  },
  "fail-no-workspace": {
    build() {},
    expect: { status: "fail", marker: "no pnpm-workspace.yaml" },
  },
};

const names = Object.keys(CASES).sort();
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "typecheck-gate-"));
const failures = [];
let passed = 0;

for (const name of names) {
  const { build, expect } = CASES[name];
  const root = path.join(tmpRoot, name);
  mkdirSync(root, { recursive: true });
  build(root);
  let result;
  try {
    result = await check(root);
  } catch (error) {
    failures.push(`FAIL ${name}: check() threw unexpectedly:\n  ${error.message}`);
    continue;
  }
  const okStatus = result.status === expect.status;
  const okMarker =
    !expect.marker || result.messages.some((message) => message.includes(expect.marker));
  const messages = result.messages.map((message) => `    ${message}`).join("\n");
  if (!okStatus) {
    failures.push(`FAIL ${name}: expected ${expect.status}, got ${result.status}\n${messages}`);
  } else if (!okMarker) {
    failures.push(`FAIL ${name}: expected a '${expect.marker}' finding, got:\n${messages}`);
  } else {
    passed += 1;
    console.log(`PASS ${name}`);
  }
}

// CI observes the CLI's exit code, not check()'s status string — assert the mapping.
const cliPass = spawnSync(
  process.execPath,
  [path.join(here, "check.mjs"), path.join(tmpRoot, "pass")],
  {
    encoding: "utf8",
  },
);
const cliFail = spawnSync(
  process.execPath,
  [path.join(here, "check.mjs"), path.join(tmpRoot, "fail-missing-script")],
  { encoding: "utf8" },
);
let cliOk = true;
if (cliPass.status !== 0 || !cliPass.stdout.includes("test-typecheck gate: PASS")) {
  failures.push(
    `FAIL cli exit: pass fixture exited ${cliPass.status}\n  ${cliPass.stdout}${cliPass.stderr}`,
  );
  cliOk = false;
}
if (cliFail.status !== 1 || !cliFail.stdout.includes("test-typecheck gate: FAIL")) {
  failures.push(
    `FAIL cli exit: fail fixture exited ${cliFail.status} (expected 1)\n  ${cliFail.stdout}${cliFail.stderr}`,
  );
  cliOk = false;
}
if (cliOk) console.log("PASS cli exit codes — pass exits 0, fail exits 1");

// Invoking through a SYMLINKED path must still run (#181 fail-open class).
const linkedDir = path.join(tmpRoot, "via-symlink");
symlinkSync(here, linkedDir, "dir");
const cliSymlink = spawnSync(
  process.execPath,
  [path.join(linkedDir, "check.mjs"), path.join(tmpRoot, "pass")],
  { encoding: "utf8" },
);
if (cliSymlink.status === 0 && cliSymlink.stdout.includes("test-typecheck gate: PASS")) {
  console.log("PASS symlink invocation — the CLI runs through a symlinked path");
} else {
  failures.push(
    `FAIL cli symlink: invoking through ${linkedDir} must run the CLI\n  ` +
      `status=${cliSymlink.status} ${cliSymlink.stdout}${cliSymlink.stderr}`,
  );
}

rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${passed}/${names.length} fixtures passed`);
if (failures.length > 0) {
  console.error(`\nE-TEST: ${failures.length} self-test failures:\n`);
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
