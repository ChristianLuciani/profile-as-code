#!/usr/bin/env node
/**
 * Self-test for the documentation link gate (#149) — the `scripts/dep-gate`
 * idiom: prove the gate REFUSES every failure class it claims to close, and
 * that a clean tree passes. A gate whose tests cannot fail with the defect
 * present is not a test, so `fail-broken-relative/` is the acceptance fixture:
 * the suite fails unless that deliberately broken relative link is reported.
 *
 * Anti-vacuity: a parser that silently extracts nothing would turn every case
 * into a pass. The suite therefore asserts each exercised fixture actually
 * yielded links — a broken extractor is a loud failure, never a smaller suite.
 *
 * The fixture trees are committed under `fixtures/<case>/` (a tree, not a
 * synthesized string: the gate's subject IS the file layout, so a fixture must
 * be able to hold real paths, directories and anchors). Each case carries
 * `_expect.json` (`status`, optional `rule`, optional `warn`, optional `note`)
 * and may carry its own `allowlist.json` so the private-target contract is
 * exercised without reading the repo's real allowlist.
 *
 * Zero dependencies, `node >=22`.
 *
 * Usage: node scripts/link-check/test.mjs
 * Exit:  0 all cases pass · 1 any case fails
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { check, slugify } from "./check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const CHECK = path.join(HERE, "check.mjs");
const EMPTY_ALLOWLIST = { privateTargets: [] };

const caseDirs = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (caseDirs.length === 0) {
  console.error("E-TEST: no fixtures found in", FIXTURES);
  process.exit(1);
}

const failures = [];
let passed = 0;

/** Load a fixture's allowlist if it has one; empty otherwise (hermetic). */
function allowlistFor(name) {
  try {
    return JSON.parse(readFileSync(path.join(FIXTURES, name, "allowlist.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return EMPTY_ALLOWLIST;
    throw new Error(`E-TEST: ${name}/allowlist.json is unreadable: ${error.message}`);
  }
}

for (const name of caseDirs) {
  const root = path.join(FIXTURES, name);
  let expected;
  try {
    expected = JSON.parse(readFileSync(path.join(root, "_expect.json"), "utf8"));
  } catch (error) {
    failures.push(`FAIL ${name}: cannot read _expect.json: ${error.message}`);
    continue;
  }

  let result;
  try {
    result = check(root, { allowlist: allowlistFor(name) });
  } catch (error) {
    failures.push(`FAIL ${name}: check() threw unexpectedly:\n  ${error.message}`);
    continue;
  }

  const messages = result.messages.map((message) => `    ${message}`).join("\n");
  const problems = [];
  if (result.status !== expected.status) {
    problems.push(`expected ${expected.status}, got ${result.status}`);
  }
  if (expected.rule && !result.messages.some((message) => message.includes(expected.rule))) {
    problems.push(`expected a '${expected.rule}' finding`);
  }
  if (expected.warn && !result.messages.some((message) => message.includes(expected.warn))) {
    problems.push(`expected a '${expected.warn}' warning`);
  }
  // Anti-vacuity: a fixture expecting findings must also have parsed links —
  // an extractor that silently found nothing cannot pass by finding nothing.
  // Cases that legitimately parse zero links (a masked-code tree, an allowlist
  // refused before the scan) opt out with `"minLinks": 0`.
  const minLinks = expected.minLinks ?? 1;
  if (result.links < minLinks) {
    problems.push(
      `parsed ${result.links} links, expected at least ${minLinks} (extractor is vacuous?)`,
    );
  }

  if (problems.length > 0) {
    failures.push(`FAIL ${name}: ${problems.join("; ")}\n${messages}`);
  } else {
    passed += 1;
    console.log(`PASS ${name}${expected.note ? ` — ${expected.note}` : ""}`);
  }
}

// The acceptance fixture must exist and must fail BY NAME — a refactor that
// drops it would otherwise shrink the suite silently.
if (!caseDirs.includes("fail-broken-relative")) {
  failures.push("FAIL acceptance: fixtures/fail-broken-relative is missing (#149 criterion)");
} else {
  const broken = check(path.join(FIXTURES, "fail-broken-relative"), { allowlist: EMPTY_ALLOWLIST });
  if (broken.status !== "fail") {
    failures.push("FAIL acceptance: a deliberately broken relative link did not fail the gate");
  } else {
    console.log("PASS acceptance — a deliberately broken relative link fails the gate (#149)");
  }
}

// Slug oracle: the expected anchors are `github-slugger@2.0.0` — the reference
// implementation — committed as data (`slug-oracle.json`), so a slugger
// regression fails CI without adding a dependency. This is the falsifiable
// answer to "does the gate really follow GitHub's rules?".
const oracle = JSON.parse(readFileSync(path.join(HERE, "slug-oracle.json"), "utf8"));
let oracleOk = true;
for (const { heading, slug } of oracle.cases) {
  const got = slugify(heading);
  if (got !== slug) {
    failures.push(`FAIL slug oracle: ${JSON.stringify(heading)} → ${got}, expected ${slug}`);
    oracleOk = false;
  }
}
if (oracleOk) {
  console.log(`PASS slug oracle — ${oracle.cases.length} headings match github-slugger@2.0.0`);
}

// The CI gate observes the CLI's EXIT CODE, not check()'s status string.
const cliPass = spawnSync(process.execPath, [CHECK, path.join(FIXTURES, "pass-clean")], {
  encoding: "utf8",
});
const cliFail = spawnSync(process.execPath, [CHECK, path.join(FIXTURES, "fail-broken-relative")], {
  encoding: "utf8",
});
let cliOk = true;
if (cliPass.status !== 0) {
  failures.push(
    `FAIL cli exit: clean fixture exited ${cliPass.status} (expected 0)\n  ${cliPass.stdout}${cliPass.stderr}`,
  );
  cliOk = false;
}
if (cliFail.status !== 1 || !cliFail.stdout.includes("E-LINK-MISSING")) {
  failures.push(
    `FAIL cli exit: broken fixture exited ${cliFail.status} (expected 1 with an E-LINK-MISSING finding)\n  ${cliFail.stdout}${cliFail.stderr}`,
  );
  cliOk = false;
}
if (cliOk) {
  console.log("PASS cli exit codes — clean fixture exits 0, broken fixture exits 1");
}

// Invoking the CLI through a SYMLINKED path must still run (dep-gate precedent,
// review F2): import.meta.url carries the realpath while argv[1] carries
// the symlinked one, so an as-is comparison silently no-ops (fail-open).
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "link-check-symlink-"));
const linkedDir = path.join(tmpRoot, "via-symlink");
symlinkSync(HERE, linkedDir, "dir");
const cliSymlink = spawnSync(
  process.execPath,
  [path.join(linkedDir, "check.mjs"), path.join(FIXTURES, "pass-clean")],
  { encoding: "utf8" },
);
if (cliSymlink.status === 0 && cliSymlink.stdout.includes("Link gate: PASS")) {
  console.log("PASS symlink invocation — the CLI runs through a symlinked path (no silent no-op)");
} else {
  failures.push(
    `FAIL cli symlink: invoking through ${linkedDir} must run the CLI\n  ` +
      `status=${cliSymlink.status} ${cliSymlink.stdout}${cliSymlink.stderr}`,
  );
}
rmSync(tmpRoot, { recursive: true, force: true });

// ── the generated census block (#226) ───────────────────────────────────────
//
// Synthesized trees, not committed fixtures: the subject here is the CLI
// contract (write / `--check` / staleness / missing block), and the correct
// block body is a function of the tree's own census — committing it would pin a
// number that the next fixture edit invalidates. The committed fixture trees
// above still carry the LAYOUT contract, where the layout IS the subject.
{
  const { renderDocLinksBlock, GateError } = await import("./check.mjs");
  // A LOCAL assertion helper: `check` is the link gate imported from check.mjs,
  // so reusing that name here would run the gate on the case name and count
  // nothing — a vacuous suite (the anti-vacuity trap this file already warns
  // about). Counted separately so the fixture tally stays the fixture tally.
  let blockPassed = 0;
  let blockCases = 0;
  const expect = (name, ok, detail = "") => {
    blockCases += 1;
    if (ok) {
      blockPassed += 1;
      return;
    }
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  };

  expect(
    "#226 check.mjs exports GateError (the gen-platforms mold)",
    typeof GateError === "function",
  );

  const mkTree = ({ block = "markers" } = {}) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "link-check-block-"));
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "README.md"), "# Doc\n\n[a](docs/a.md)\n");
    writeFileSync(path.join(root, "docs", "a.md"), "# A\n\ntext\n");
    if (block !== "absent") {
      const body =
        block === "markers" ? "<!-- gen:doc-links -->\n<!-- /gen -->\n" : "# Doc\n\nno block\n";
      writeFileSync(path.join(root, "docs", "ci-cd.md"), `# CI\n\n${body}`);
    }
    return root;
  };
  const temps = [];
  const make = (opts) => {
    const root = mkTree(opts);
    temps.push(root);
    return root;
  };
  const cli = (root, ...args) =>
    spawnSync(process.execPath, [CHECK, root, ...args], { encoding: "utf8" });

  try {
    // 1. write mode fills the block from the tree's own census
    //    (README.md + docs/a.md + docs/ci-cd.md = 3 files, 1 link)
    const writeRoot = make();
    const wrote = cli(writeRoot);
    const filled = readFileSync(path.join(writeRoot, "docs", "ci-cd.md"), "utf8");
    expect(
      "#226 write mode fills the gen:doc-links block",
      wrote.status === 0 && filled.includes("**3 files, 1 links**"),
      `status=${wrote.status} ${wrote.stdout}${wrote.stderr}`,
    );

    // 2. idempotence — the block must not move the census it reports
    cli(writeRoot);
    expect(
      "#226 regeneration is byte-stable (the block cannot move the census)",
      readFileSync(path.join(writeRoot, "docs", "ci-cd.md"), "utf8") === filled,
    );

    // 3. --check passes a fresh block and reports the census
    const fresh = cli(writeRoot, "--check");
    expect(
      "#226 --check passes a fresh block and says in sync",
      fresh.status === 0 && fresh.stdout.includes("link-check: in sync (3 files, 1 links)"),
      `status=${fresh.status} ${fresh.stdout}${fresh.stderr}`,
    );

    // 4. --check refuses a block that disagrees with the computation
    const staleRoot = make();
    cli(staleRoot);
    const stalePath = path.join(staleRoot, "docs", "ci-cd.md");
    writeFileSync(
      stalePath,
      readFileSync(stalePath, "utf8").replace("**3 files, 1 links**", "**7 files, 7 links**"),
    );
    const stale = cli(staleRoot, "--check");
    expect(
      "#226 --check refuses a stale block",
      stale.status === 1 && stale.stdout.includes("E-GATE:") && stale.stdout.includes("is stale"),
      `status=${stale.status} ${stale.stdout}${stale.stderr}`,
    );
    expect(
      "#226 staleness names the fix",
      stale.stdout.includes("pnpm gen:doc-links"),
      stale.stdout.trim(),
    );

    // 5. --check refuses a home with no marker (fail-closed, never a pass)
    const noMarker = cli(make({ block: "no-marker" }), "--check");
    expect(
      "#226 --check refuses a block home without the marker",
      noMarker.status === 1 && noMarker.stdout.includes("missing <!-- gen:doc-links --> marker"),
      `status=${noMarker.status} ${noMarker.stdout}${noMarker.stderr}`,
    );

    // 6. --check refuses a tree with no block home at all
    const noHome = cli(make({ block: "absent" }), "--check");
    expect(
      "#226 --check refuses a tree whose block has no home",
      noHome.status === 1 && noHome.stdout.includes("has no home"),
      `status=${noHome.status} ${noHome.stdout}${noHome.stderr}`,
    );

    // 7. write mode on a tree with no block home stays a pure report (the
    //    committed fixture trees rely on this: no docs/ci-cd.md, exit 0)
    const report = cli(make({ block: "absent" }));
    expect(
      "#226 write mode is a no-op where the block has no home",
      report.status === 0 && report.stdout.includes("Link gate: PASS"),
      `status=${report.status} ${report.stdout}${report.stderr}`,
    );

    // 8. the block body is inert for the gate — no link destination, no heading
    const body = renderDocLinksBlock({ files: 1, links: 1 });
    expect(
      "#226 the block body carries no link destination and no heading",
      !body.includes("](") && !/^\s{0,3}#{1,6}\s/m.test(body),
      body,
    );

    // 9. prose in the SAME file may name the marker (in backticks, inline): the
    //    region is the own-line block, not the earliest textual mention — else a
    //    document could break its own gate by describing it.
    const mentionRoot = make();
    const mentionPath = path.join(mentionRoot, "docs", "ci-cd.md");
    writeFileSync(
      mentionPath,
      `# CI\n\nProse naming \`<!-- gen:doc-links -->\` inline.\n\n<!-- gen:doc-links -->\n<!-- /gen -->\n`,
    );
    const mentionWrite = cli(mentionRoot);
    const mentionCheck = cli(mentionRoot, "--check");
    expect(
      "#226 an inline prose mention of the marker does not capture the region",
      mentionWrite.status === 0 &&
        mentionCheck.status === 0 &&
        mentionCheck.stdout.includes("link-check: in sync"),
      `write=${mentionWrite.status} check=${mentionCheck.status} ${mentionCheck.stdout}${mentionCheck.stderr}`,
    );
  } finally {
    for (const root of temps) rmSync(root, { recursive: true, force: true });
  }

  // Anti-vacuity: the case count is asserted, so a refactor that drops the
  // block's cases cannot shrink the suite silently.
  expect(
    "#226 the census-block suite actually ran its cases",
    blockCases >= 10,
    `ran ${blockCases}`,
  );
  console.log(
    `PASS #226 census block — ${blockPassed}/${blockCases} cases (write, --check, staleness, fail-closed)`,
  );
}

console.log(`\n${passed}/${caseDirs.length} fixtures passed`);
if (failures.length > 0) {
  console.error(`\nE-TEST: ${failures.length} self-test failures:\n`);
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
