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
 *   - the identity-design corpus name fails in BOTH measured forms — a bare token
 *     and a repo-relative path (#370) (`fail-private-corpus-identeco`).
 *
 * Two cases are not fixtures. The REAL allowlist (#369 rounds 2-3): a throwaway
 * tree carries one private name in a file covered by each of the six narrowed
 * entries, and the production `allowlist.json` must report all six — reverting
 * any entry to file-wide makes that case fail, which a fixture with its own
 * allowlist could never catch. The CATEGORY guard (#369 round 3): a declared
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
 * Behavioral guard for the REAL allowlist (#369 rounds 2-3). The fixtures above
 * carry their own allowlists, so reverting any production entry to file-wide
 * would leave every one of them green. This injects, in a throwaway tree, one
 * private name into a file covered by each NARROWED entry and runs the
 * production `allowlist.json` over it: a narrowed entry reports the injected
 * name, a file-wide entry suppresses it silently (exit 0) and this case fails.
 * Each row uses a name the entry does NOT declare, so only the narrowing can
 * report it; the names are built from parts because this file is scanned by the
 * gate it tests.
 */
function realAllowlistScope() {
  const names = {
    shortAlias: "pre" + "merge",
    contractName: "dev-" + "methodology",
    evidence: "claims-" + "evidence",
    taskBoard: "TASK" + "HUB",
    governance: "repo-" + "governance",
    community: "community-" + "first",
  };
  // One row per narrowed entry: where the entry lives, the private name that
  // entry does not declare, and the probe file that must carry it.
  const rows = [
    {
      entry: "packages/cli/tests/cli.test.ts",
      name: names.shortAlias,
      file: "packages/cli/tests/cli.test.ts",
    },
    {
      entry: "packages/renderers/github-readme/tests/",
      name: names.contractName,
      file: "packages/renderers/github-readme/tests/role.test.ts",
    },
    {
      entry: "packages/cli/scripts/verify-pack.mjs",
      name: names.evidence,
      file: "packages/cli/scripts/verify-pack.mjs",
    },
    {
      entry: "packages/cli/tests/audit.test.ts",
      name: names.taskBoard,
      file: "packages/cli/tests/audit.test.ts",
    },
    {
      entry: "packages/cli/tests/fixtures/",
      name: names.governance,
      file: "packages/cli/tests/fixtures/case.md",
    },
    {
      entry: "packages/core/tests/fixtures/",
      name: names.community,
      file: "packages/core/tests/fixtures/case.md",
    },
  ];
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
    const problems = [];
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
