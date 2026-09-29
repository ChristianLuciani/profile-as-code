#!/usr/bin/env node
/**
 * Self-test for the D20 dependency gate (issue #98).
 *
 * Runs `check()` against every workspace-like fixture under `fixtures/` and
 * asserts the gate verdict matches the fixture's `_expect.json` (`"pass"` or
 * `"fail"`). Zero dependencies, `node scripts/dep-gate/test.mjs`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { check } from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");

const caseDirs = (await readdir(fixturesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (caseDirs.length === 0) {
  console.error("E-TEST: no fixtures found in", fixturesDir);
  process.exit(1);
}

const failures = [];
for (const name of caseDirs) {
  const root = path.join(fixturesDir, name);
  const expected = JSON.parse(await readFile(path.join(root, "_expect.json"), "utf8"));
  let result;
  try {
    result = await check(root);
  } catch (error) {
    failures.push(`FAIL ${name}: check() threw unexpectedly:\n  ${error.message}`);
    continue;
  }
  if (result.status !== expected.status) {
    const messages = result.messages.map((message) => `    ${message}`).join("\n");
    failures.push(`FAIL ${name}: expected ${expected.status}, got ${result.status}\n${messages}`);
    continue;
  }
  console.log(`PASS ${name}${expected.note ? ` — ${expected.note}` : ""}`);
}

console.log(`\n${caseDirs.length - failures.length}/${caseDirs.length} fixtures passed`);
if (failures.length > 0) {
  console.error(`\nE-TEST: ${failures.length} self-test failures:\n`);
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
