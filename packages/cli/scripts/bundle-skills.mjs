#!/usr/bin/env node
/**
 * Copy the repo's `skills/` into the CLI package before packing (issues #253/#254).
 *
 * The skills are authored once at `<repo>/skills/` and must remain the single
 * source; the package needs its own copy because npm can only pack files below
 * the package root. `build` and `prepack` both run this script, so a published
 * tarball always carries the skills its `refine`/`post` commands read — a user
 * has no engine checkout to fall back on.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(pkgDir, "..", "..", "skills");
const target = join(pkgDir, "skills");

function fail(message) {
  console.error(`bundle-skills FAIL: ${message}`);
  process.exit(1);
}

function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name));
    else total += 1;
  }
  return total;
}

if (!existsSync(source) || !existsSync(join(source, "github-readme", "SKILL.md"))) {
  fail(`source skills tree not found at ${source} (run from the repository)`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, {
  recursive: true,
  filter: (path) => !path.endsWith(".DS_Store"),
});

const files = countFiles(target);
if (files === 0) fail(`copied no files from ${source}`);
console.log(`bundle-skills: ${files} files -> ${target}`);
