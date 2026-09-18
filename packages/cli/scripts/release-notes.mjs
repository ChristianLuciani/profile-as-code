#!/usr/bin/env node
/**
 * Release notes extractor — the CHANGELOG section for a published version
 * (issue #58).
 *
 * `release.yml` publishes to npm but never told GitHub that a release happened:
 * no Release, no notes, so the tag page carried nothing and the "tagged release"
 * public-readiness item (#58, STANDARDS.md item 3) could not be marked done. The
 * notes already exist — Keep a Changelog puts them under `## [<version>]` — this
 * script is the single, tested way to read them out.
 *
 * It lives beside `release-guard.mjs` (the other release-path assertion) and is
 * exercised by `packages/cli/tests/release-notes.test.ts`, because a parser that
 * silently grabs the WRONG section ships a release page with another version's
 * changes — worse than no notes at all.
 *
 * The match is exact: `## [0.1]` must NOT satisfy `0.1.0`, and the section ends
 * at the next level-2 heading, so `[Unreleased]` bullets never leak into a
 * released version's page.
 *
 * Exit 0 = notes extracted. Exit 1 = no such section (release must not proceed
 * with empty notes). Exit 2 = usage error.
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const USAGE = `usage: node scripts/release-notes.mjs --version <version> [options]

Extract the Keep-a-Changelog section for a version, for a GitHub Release body.

  --version <version>   the released version (e.g. 0.1.0) — required
  --changelog <path>    CHANGELOG file to read (default: CHANGELOG.md)
  --output <path>       write the notes here (default: stdout)
  -h, --help            show this message`;

function usage(message) {
  console.error(`\n✖ release-notes — ${message}\n\n${USAGE}\n`);
  process.exit(2);
}

function fail(message) {
  console.error(`\n✖ release-notes — ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { changelog: "CHANGELOG.md", output: null, version: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
    if (arg === "--version" || arg === "--changelog" || arg === "--output") {
      const value = argv[++i];
      if (value === undefined) usage(`${arg} requires a value`);
      if (arg === "--version") args.version = value;
      else if (arg === "--changelog") args.changelog = value;
      else args.output = value;
      continue;
    }
    usage(`unknown argument: ${arg}`);
  }
  if (args.version === null || args.version === "") usage("--version is required");
  return args;
}

/** The exact version, not a prefix: `## [0.1]` must not satisfy `0.1.0`. */
function headingPattern(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^## \\[${escaped}\\](?:\\s|$)`);
}

export function extractReleaseNotes(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => headingPattern(version).test(line));
  if (start === -1) return null;

  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    // A level-2 heading always ends the section (the next version, [Unreleased],
    // or a top-level section).
    if (/^## /.test(lines[i])) break;
    body.push(lines[i]);
  }

  const notes = body.join("\n").trim();
  return notes === "" ? null : notes;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changelog = readFileSync(args.changelog, "utf8");
  const notes = extractReleaseNotes(changelog, args.version);
  if (notes === null) {
    fail(
      `no non-empty \`## [${args.version}]\` section in ${args.changelog}.\n` +
        `The release page needs real notes — add the section (Keep a Changelog) or\nextract the version that exists.`,
    );
  }

  if (args.output === null) {
    process.stdout.write(`${notes}\n`);
  } else {
    writeFileSync(args.output, `${notes}\n`);
    console.log(`• wrote release notes for ${args.version} to ${args.output}`);
  }
}

// Importable for tests (the suite calls extractReleaseNotes directly); invoked as
// a script — directly or through a symlink — it must run main(). A guard that
// silently no-ops on a symlinked path would turn "no such version" into exit 0,
// i.e. a green release with no notes (the #81 failure class). realpath on both
// sides makes the decision about the file, not the spelling of its path.
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}
