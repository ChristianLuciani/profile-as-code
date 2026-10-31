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
 *     by path and, when the entry narrows it, by the NAMES it declares, never
 *     by arbitrary text (`fail-outside-allowlist`);
 *   - an entry narrowed by `names` exempts only those `privateNames`: another
 *     private name in the same file still fails (`fail-allowlist-name-scope`),
 *     and the same file passes when it names only the declared one
 *     (`pass-allowlist-names`);
 *   - a name outside the declared scope is a finding AND does not count as a
 *     suppression, so `W-ALLOWLIST-UNUSED` still fires
 *     (`fail-allowlist-name-out-of-scope`);
 *   - a declared name with no reference warns like a dead entry, without
 *     failing (`pass-allowlist-unused-name`), and an entry with `names` over a
 *     clean file warns and passes (`pass-allowlist-names-clean`);
 *   - when ALL declared names are dead the per-name warnings win over the
 *     entry-level one instead of being skipped by it
 *     (`pass-allowlist-all-names-dead`);
 *   - `names` accepts ONLY inventory `privateNames`: a repo target is refused
 *     (`fail-allowlist-name-repo-target`), and an empty array, a duplicate and
 *     a non-array value are `E-ALLOWLIST-INVALID` (`fail-allowlist-names-*`);
 *   - a `names` value the inventory does not declare is refused, never a silent
 *     no-op (`fail-allowlist-unknown-name`);
 *   - a malformed entry, an unknown entry key and overlapping entries are
 *     refused (`fail-malformed-allowlist`, `fail-allowlist-unknown-key`,
 *     `fail-overlapping-allowlist`);
 *   - an entry that suppresses nothing warns without failing
 *     (`pass-unused-allowlist`);
 *   - a clean tree, including the generic `/Users/…` documentation placeholder,
 *     passes (`pass-clean`);
 *   - each private CONTRACT name in the inventory fails, so removing one from the
 *     list turns its fixture green and the suite red (`fail-private-contract-*`);
 *   - the identity-design corpus name fails in BOTH measured forms — a repo-relative path
 *     and a cross-repo ref (#370) (`fail-private-corpus-identeco`).
 *
 * Two cases are not fixtures. The REAL allowlist (#369 rounds 2-3, #372): the
 * table is DERIVED from the production `allowlist.json`, one row per entry that
 * declares `names`, and each row probes an inventory name that entry does NOT
 * declare — a throwaway tree carrying it must be reported, which a fixture with
 * its own allowlist could never catch. Because the rows come from the data, a
 * narrowed entry added tomorrow is covered without touching this file; a fixed
 * table would be a second source of the same allowlist and drift in silence.
 * The CATEGORY guard (#369 round 3): a declared
 * name that is also an operator-path source is exempt as a name and REPORTED as
 * a path — the exemption never crosses categories, even when the strings are
 * identical.
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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * Behavioral guard for the REAL allowlist (#369 rounds 2-3, #372). The fixtures
 * above carry their own allowlists, so reverting any production entry to
 * file-wide would leave every one of them green. Two things are proven here, and
 * they are different guarantees:
 *
 *  1. The CONTRACT: every entry is either narrowed (`names`) or EXPLICITLY
 *     file-wide (`fileWide: true`) — never silently file-wide. This catches the
 *     case a derived table cannot: dropping `names` from an entry used to widen
 *     it back to whole-file with every row still green (#372, round 2). The same
 *     contract is enforced by the gate itself (`E-ALLOWLIST-INVALID`), so the
 *     repo fails even if this self-test is not run.
 *  2. The BEHAVIOUR: for each narrowed entry, one inventory name that entry does
 *     NOT declare is injected into a file the entry covers, and the production
 *     allowlist runs over that throwaway tree. Every row must come back as a
 *     reported finding; if the gate stopped honouring the narrowing, the
 *     injected citation would be suppressed silently (exit 0) and this case
 *     fails.
 *
 * The rows are DERIVED from the production data, never enumerated: a fixed table
 * is a second source of the allowlist and drifts in silence, while derived rows
 * cover a new narrowed entry the day it lands. Names are read from the inventory
 * at runtime, so this file — which the gate it tests scans — never carries one
 * literally.
 */
function realAllowlistScope() {
  const inventory = JSON.parse(readFileSync(targetsPath, "utf8"));
  const inventoryNames = inventory.privateNames.map((entry) => entry.name);
  const production = JSON.parse(readFileSync(path.join(here, "allowlist.json"), "utf8"));
  const problems = [];
  const rows = [];
  for (const entry of production.entries) {
    const narrow = Array.isArray(entry.names);
    const fileWide = entry.fileWide === true;
    if (narrow === fileWide) {
      problems.push(
        `entry ${JSON.stringify(entry.path)} is ${narrow ? "both narrowed and explicit-whole-file" : "neither narrowed (names) nor explicitly file-wide (fileWide: true)"} — a widening must be declared, never silent (#372)`,
      );
    }
    if (!narrow) continue;
    const undeclared = inventoryNames.find((name) => !entry.names.includes(name));
    if (undeclared === undefined) {
      problems.push(
        `entry ${JSON.stringify(entry.path)} declares every inventory name — no undeclared name is left to probe the narrowing`,
      );
      continue;
    }
    // A directory entry (declared with a trailing slash) needs a file INSIDE it;
    // a file entry is its own probe target.
    const file = entry.path.endsWith("/") ? `${entry.path}probe.md` : entry.path;
    rows.push({ entry: entry.path, name: undeclared, file });
  }
  if (rows.length === 0) {
    problems.push(
      "the real allowlist declares no narrowed entry — the guard would pass while testing nothing",
    );
    return problems;
  }
  const root = mkdtempSync(path.join(tmpdir(), "agnostic-real-allowlist-"));
  try {
    for (const row of rows) {
      const file = path.join(root, row.file);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `// injected citation: ${row.name}\n`);
    }
    const result = spawnSync(
      process.execPath,
      [checkPath, "--root", root, "--allowlist", path.join(here, "allowlist.json")],
      { encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;
    if (result.status !== 1) problems.push(`exit ${result.status} != expected 1`);
    for (const row of rows) {
      const needle = `private name "${row.name}"`;
      if (!output.includes(needle)) {
        problems.push(`the real allowlist does not report ${needle} (entry ${row.entry})`);
      }
      if (!output.includes(`${row.file}:1`)) {
        problems.push(`no finding at ${row.file}:1 (entry ${row.entry})`);
      }
    }
    return problems;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const scopeProblems = realAllowlistScope();
if (scopeProblems.length > 0) {
  failed += 1;
  console.error(
    `FAIL real-allowlist-name-scope: ${scopeProblems.join("; ")} — the real allowlist is exempting those files whole again`,
  );
} else {
  console.log("ok   real-allowlist-name-scope (exit 1)");
}

/**
 * The category guard (#369 round 3): `names` exempts only `privateNames`
 * findings, even when a declared name's exact string is also a valid
 * operator-path source. Purpose-built targets + allowlist, run through the
 * exported `check()`, so the `finding.category === "privateNames"` guard is
 * exercised directly instead of only by a string that happens to be unique.
 */
function categoryGuardProblems() {
  // Built from parts: this file is scanned by the gate it tests.
  const declaredName = "skills-" + "studio";
  const root = mkdtempSync(path.join(tmpdir(), "agnostic-category-"));
  try {
    const tree = path.join(root, "tree");
    mkdirSync(tree, { recursive: true });
    writeFileSync(
      path.join(tree, "doc.md"),
      `The ${declaredName} name appears here, and is a path source too.\n`,
    );
    const targets = path.join(root, "targets.json");
    writeFileSync(
      targets,
      JSON.stringify(
        {
          privateNames: [{ name: declaredName, reason: "a declared private name" }],
          privateRepos: [],
          operatorPaths: [
            {
              pattern: declaredName,
              label: "colliding path source",
              reason: "a pattern whose source is exactly the declared name",
            },
          ],
        },
        null,
        2,
      ),
    );
    const allowlist = path.join(root, "allowlist.json");
    writeFileSync(
      allowlist,
      JSON.stringify(
        {
          entries: [
            {
              path: "doc.md",
              names: [declaredName],
              reason: "the declared name is exempt here",
              removalTrigger: "never in this case",
            },
          ],
        },
        null,
        2,
      ),
    );
    const result = check({ root: tree, allowlistPath: allowlist, targetsPath: targets });
    const problems = [];
    if (result.status !== "fail") problems.push(`status ${result.status} != expected fail`);
    if (result.findings.length !== 1) {
      problems.push(
        `${result.findings.length} finding(s) reported, expected 1 (the operator path)`,
      );
    }
    const reported = result.findings[0];
    if (reported?.category !== "operatorPaths") {
      problems.push(`reported category ${reported?.category} != operatorPaths`);
    }
    if (result.suppressed !== 1) {
      problems.push(`${result.suppressed} suppressed, expected 1 (the privateNames finding)`);
    }
    return problems;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const guardProblems = categoryGuardProblems();
if (guardProblems.length > 0) {
  failed += 1;
  console.error(`FAIL category-does-not-exempt-another: ${guardProblems.join("; ")}`);
} else {
  console.log("ok   category-does-not-exempt-another (exit 1)");
}

if (failed > 0) {
  console.error(`agnostic-check self-test: FAIL — ${failed}/${cases.length + 2} case(s) failed`);
  process.exit(1);
}
console.log(`agnostic-check self-test: PASS — ${cases.length + 2}/${cases.length + 2} cases`);
