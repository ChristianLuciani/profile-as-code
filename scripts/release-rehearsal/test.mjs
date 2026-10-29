#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
/**
 * Self-test for the release rehearsal (#313).
 *
 * A gate that checks nothing must not pass, and a gate that fails everything for one
 * reason is as useless as one that passes everything — so every refusal class is
 * asserted by BOTH its verdict and the exact reason (a marker substring), and the
 * permissive path is asserted too (a valid fixture must PASS). The classes:
 *
 *   - the publish ORDER (topological validity, completeness, duplicates, unknown
 *     members, a runtime edge onto a package nobody publishes in the run);
 *   - the packed manifest (name/version drift, `private`, mixed `publishConfig`,
 *     surviving `workspace:*`, a rewrite onto the wrong peer version, a missing
 *     entrypoint, a missing `files` directory, a `repository.url`/`directory`
 *     mismatch);
 *   - the workflow mechanism (`id-token`, `pnpm publish` vs `npm publish`, a
 *     missing/duplicated step, cohort-before-CLI ordering);
 *   - the end-to-end wiring: `check()` reads the tarball through `tar`, emits a
 *     receipt for all five, and turns a mutated packed manifest into a failure.
 *
 * The end-to-end fixture builds real `.tgz` files with `tar` and a stub packer, so
 * it needs no registry, no network and no pnpm; the production packer is exercised
 * by the workflow on the real workspace (and by `pnpm rehearse:release`).
 *
 * Zero dependencies, node >=22.  Usage: node scripts/release-rehearsal/test.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  check,
  executesScript,
  expectedRepositoryUrl,
  idTokenGranted,
  manifestViolations,
  orderViolations,
  parseSteps,
  publishInvocations,
  runCommands,
  runtimeDependencyViolations,
  SEAM_DIRS,
  targetPaths,
  uncoveredPublishables,
  workflowViolations,
} from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_URL = "git+https://github.com/ChristianLuciani/profile-as-code.git";

let passed = 0;
const failures = [];

function pass(label) {
  passed += 1;
  console.log(`PASS ${label}`);
}

/** Run one case; a thrown error is one failure, never a crashed suite. */
function test(label, fn) {
  try {
    fn();
    pass(label);
  } catch (error) {
    failures.push(`FAIL ${label}\n  ${error.message}`);
  }
}

/** Assert a refusal names the expected reason (marker), not just "failed". */
function refuses(violations, marker, label) {
  assert.ok(Array.isArray(violations), `${label}: expected a violations array`);
  assert.ok(
    violations.some((violation) => violation.includes(marker)),
    `${label}: no violation contains ${JSON.stringify(marker)}; got ${JSON.stringify(violations)}`,
  );
}

const manifest = (pkg, extra = {}) => ({
  name: `@profile-as-code/${pkg}`,
  version: pkg === "core" ? "0.1.1" : "0.1.0",
  private: false,
  publishConfig: { access: "public" },
  description: "fixture",
  license: "MIT",
  repository: { type: "git", url: REPO_URL, directory: `packages/${pkg}` },
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  files: ["dist"],
  ...extra,
});

const cohort = SEAM_DIRS.map((dir) => ({ dir, manifest: manifest(dir.slice("packages/".length)) }));

/**
 * The REAL shape of release.yml's cohort step: two publish branches (a `--dry-run`
 * smoke and the live one). A one-line fixture cannot catch a regression that mutates
 * only the live branch — the fresh-pass F1 finding — so the fixture carries both.
 */
const REAL_COHORT_RUN = [
  "          set -euo pipefail",
  '          ORDER="core markdown paste artifact github"',
  "          for pkg in $ORDER; do",
  '            dir="packages/$pkg"',
  '            name="$(node -p "require(\'./$dir/package.json\').name")"',
  '            version="$(node -p "require(\'./$dir/package.json\').version")"',
  '            if npm view "$name@$version" version --silent >/dev/null 2>&1; then',
  '              echo "skip $name@$version — already live on the registry"',
  "              continue",
  "            fi",
  // Concatenated so the fixture carries the workflow's literal GHA expression
  // without tripping the template-literal lint; it must mirror release.yml exactly.
  '            if [ "$' + '{{ inputs.dry_run }}" = "true" ]; then',
  '              (cd "$dir" && pnpm publish --access public --no-git-checks --dry-run)',
  "            else",
  '              (cd "$dir" && pnpm publish --access public --no-git-checks)',
  "            fi",
  "          done",
];

const COHORT_STEP = "Publish the seam cohort (pnpm publish, in dependency order)";
const BARRIER_STEP = "Rehearse the seam cohort (packs, publishes nothing) — issue #313";
const barrierLines = [
  `      - name: ${BARRIER_STEP}`,
  "        run: node scripts/release-rehearsal/check.mjs",
];

const workflow = (options = {}) => {
  const {
    cohortStep = COHORT_STEP,
    cohortRun = REAL_COHORT_RUN,
    barrier = true,
    barrierAfter = false,
    cliFirst = false,
    idToken = "  id-token: write",
    publishPermissions = [],
    publishExtra = [],
    preJobs = [],
    extraJobs = [],
  } = options;
  const cohort = [`      - name: ${cohortStep}`, "        run: |", ...cohortRun];
  const cliPublish = ["      - name: Publish", "        run: npm publish --access public"];
  const steps = ["    steps:", "      - uses: actions/checkout@v7"];
  if (cliFirst) {
    steps.push(...cliPublish);
    if (barrier) steps.push(...barrierLines);
    steps.push(...cohort);
  } else {
    if (barrier && !barrierAfter) steps.push(...barrierLines);
    steps.push(...cohort);
    if (barrier && barrierAfter) steps.push(...barrierLines);
    steps.push(...cliPublish);
  }
  return [
    "name: release",
    "permissions:",
    "  contents: read",
    ...(idToken ? [idToken] : []),
    "jobs:",
    // preJobs land BEFORE `publish:` — the only way to fixture the "barrier in an
    // earlier job" shape. Appending the job after the publish steps (the old
    // `extraJobs` only) fixtures a LATER job, which fails for the ordering reason
    // and never exercises the `needs:` rule it claims to pin (F4).
    ...preJobs,
    "  publish:",
    "    runs-on: ubuntu-24.04",
    ...(publishPermissions.length > 0
      ? ["    permissions:", ...publishPermissions.map((entry) => `      ${entry}`)]
      : []),
    ...publishExtra,
    ...steps,
    ...extraJobs,
  ]
    .flat()
    .join("\n");
};

/** Flip the LIVE publish branch (never the `--dry-run` one) to `npm publish`. */
const mutateLiveBranch = (run) =>
  run.map((line) =>
    line.includes("pnpm publish") && !line.includes("--dry-run")
      ? line.replace("pnpm publish", "npm publish")
      : line,
  );

// ── the workflow mechanism ────────────────────────────────────────────────────
test("parseSteps — names the steps of the cohort and CLI publish", () => {
  const steps = parseSteps(workflow());
  const names = steps.map((step) => step.name);
  assert.ok(names.includes(COHORT_STEP));
  assert.ok(names.includes(BARRIER_STEP));
  assert.ok(names.includes("Publish"));
});

test("workflowViolations — a valid workflow yields no violations", () => {
  const result = workflowViolations(workflow());
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.order, ["core", "markdown", "paste", "artifact", "github"]);
});

test("publishInvocations — the real two-branch step yields exactly one live pnpm invocation", () => {
  const invocations = publishInvocations(REAL_COHORT_RUN.join("\n"));
  const live = invocations.filter((invocation) => !invocation.dryRun);
  const dry = invocations.filter((invocation) => invocation.dryRun);
  assert.equal(live.length, 1);
  assert.equal(dry.length, 1);
  assert.equal(live[0].client, "pnpm");
  assert.equal(dry[0].client, "pnpm");
});

test("workflowViolations — F1: mutating ONLY the live branch to npm publish is refused", () => {
  // The finding: the dry-run branch kept its `pnpm publish`, so a whole-body match
  // stayed green while the branch that actually publishes regressed to #301's bug.
  const yaml = workflow({ cohortRun: mutateLiveBranch(REAL_COHORT_RUN) });
  const violations = workflowViolations(yaml).violations;
  refuses(violations, "live branch", "live branch npm publish");
  assert.ok(
    violations.some((violation) => violation.includes("npm publish")),
    JSON.stringify(violations),
  );
});

test("workflowViolations — F1: a step with only a dry-run publish is refused", () => {
  const run = REAL_COHORT_RUN.map((line) =>
    line.includes("pnpm publish") && !line.includes("--dry-run")
      ? "              echo nothing to do"
      : line,
  );
  refuses(
    workflowViolations(workflow({ cohortRun: run })).violations,
    "outside a `--dry-run` branch",
    "dry-run only",
  );
});

test("workflowViolations — F1: a loop that ignores $ORDER is refused", () => {
  const run = REAL_COHORT_RUN.map((line) =>
    line.includes("for pkg in $ORDER")
      ? "          for pkg in core markdown paste artifact github; do"
      : line,
  );
  refuses(
    workflowViolations(workflow({ cohortRun: run })).violations,
    "does not iterate `$ORDER`",
    "hardcoded loop",
  );
});

test("workflowViolations — F2: a missing rehearsal barrier is refused", () => {
  refuses(workflowViolations(workflow({ barrier: false })).violations, "found 0", "no barrier");
});

test("workflowViolations — F2: a barrier AFTER the cohort step is refused", () => {
  refuses(
    workflowViolations(workflow({ barrierAfter: true })).violations,
    "runs AFTER the seam-cohort step",
    "barrier after",
  );
});

test("workflowViolations — F2b: a barrier that only ECHOES the script path is refused", () => {
  // The finding: the barrier was located by "does this step's text contain the path",
  // so `run: echo "node scripts/release-rehearsal/check.mjs"` passed green without
  // executing anything.
  const yaml = workflow().replace(
    "        run: node scripts/release-rehearsal/check.mjs",
    '        run: echo "node scripts/release-rehearsal/check.mjs"',
  );
  const violations = workflowViolations(yaml).violations;
  refuses(violations, "does not EXECUTE it", "echo barrier");
  refuses(violations, "found 0", "echo barrier count");
});

test("workflowViolations — F2b: a barrier gated by a constant-false if-expression is refused", () => {
  const yaml = workflow().replace(
    `      - name: ${BARRIER_STEP}`,
    `      - name: ${BARRIER_STEP}\n        if: \${{ false }}`,
  );
  refuses(workflowViolations(yaml).violations, "never true", "false-gated barrier");
});

test("workflowViolations — F2: every spelling of `continue-on-error: true` is refused", () => {
  // The finding: only the bare literal at end of line matched, so an expression, a
  // different case and an inline comment all left the swallow in place.
  // The expression form is assembled so the fixture carries the literal Actions
  // syntax without tripping the template-placeholder lint (same idiom as above).
  const expressionTrue = ["$", "{{ true }}"].join("");
  for (const value of ["true", "TRUE", "True", expressionTrue, "true # comment", "'true'"]) {
    const yaml = workflow().replace(
      `      - name: ${BARRIER_STEP}`,
      `      - name: ${BARRIER_STEP}\n        continue-on-error: ${value}`,
    );
    refuses(
      workflowViolations(yaml).violations,
      "continue-on-error",
      `swallowed barrier failure (${value})`,
    );
  }
});

test("workflowViolations — F3: `node <path> || true` is refused (exit code discarded)", () => {
  const yaml = workflow().replace(
    "        run: node scripts/release-rehearsal/check.mjs",
    "        run: node scripts/release-rehearsal/check.mjs || true",
  );
  const violations = workflowViolations(yaml).violations;
  refuses(violations, "last effective command with the exit code kept", "|| true barrier");
  refuses(violations, "found 0", "|| true barrier count");
});

test("workflowViolations — F3: a barrier after `set +e` is refused (errexit disabled)", () => {
  const yaml = workflow().replace(
    "        run: node scripts/release-rehearsal/check.mjs",
    [
      "        run: |",
      "          set +e",
      "          node scripts/release-rehearsal/check.mjs",
    ].join("\n"),
  );
  refuses(
    workflowViolations(yaml).violations,
    "last effective command with the exit code kept",
    "set +e barrier",
  );
});

test("workflowViolations — F3: a command AFTER the barrier is refused", () => {
  const yaml = workflow().replace(
    "        run: node scripts/release-rehearsal/check.mjs",
    [
      "        run: |",
      "          node scripts/release-rehearsal/check.mjs",
      "          echo done",
    ].join("\n"),
  );
  refuses(
    workflowViolations(yaml).violations,
    "last effective command with the exit code kept",
    "command after barrier",
  );
});

test("workflowViolations — F3: a barrier PIPED into another command is refused", () => {
  // `bash -e -c 'false | cat'` exits 0: the pipeline status is the LAST command's, so
  // piping the rehearsal away discards exactly the failure the gate propagates.
  const yaml = workflow().replace(
    "        run: node scripts/release-rehearsal/check.mjs",
    "        run: node scripts/release-rehearsal/check.mjs | tee /tmp/rehearsal.log",
  );
  refuses(
    workflowViolations(yaml).violations,
    "last effective command with the exit code kept",
    "piped barrier",
  );
});

test("workflowViolations — F3: a BACKGROUNDED barrier (`&`) is refused", () => {
  // `bash -e -c 'false &'` exits 0 — the background job's status is never observed.
  const yaml = workflow().replace(
    "        run: node scripts/release-rehearsal/check.mjs",
    "        run: node scripts/release-rehearsal/check.mjs &",
  );
  refuses(
    workflowViolations(yaml).violations,
    "last effective command with the exit code kept",
    "backgrounded barrier",
  );
});

test("workflowViolations — F2: a CONDITIONAL barrier (`cmd || node`) is refused", () => {
  // `true || node <path>` exits 0 without running the rehearsal: splitting on `||`
  // and keeping only the last segment read it as unconditional.
  for (const prefix of ["true", '[ -n "$X" ]']) {
    const yaml = workflow().replace(
      "        run: node scripts/release-rehearsal/check.mjs",
      `        run: ${prefix} || node scripts/release-rehearsal/check.mjs`,
    );
    refuses(
      workflowViolations(yaml).violations,
      "last effective command with the exit code kept",
      `conditional barrier (${prefix} ||)`,
    );
  }
});

test("workflowViolations — F2: `cmd && node` is refused too (not the last unconditional step)", () => {
  const yaml = workflow().replace(
    "        run: node scripts/release-rehearsal/check.mjs",
    "        run: cd . && node scripts/release-rehearsal/check.mjs",
  );
  refuses(
    workflowViolations(yaml).violations,
    "last effective command with the exit code kept",
    "&& chain",
  );
});

test("workflowViolations — F5: the compact `- run: node <path>` form is read", () => {
  const yaml = workflow().replace(
    [`      - name: ${BARRIER_STEP}`, "        run: node scripts/release-rehearsal/check.mjs"].join(
      "\n",
    ),
    "      - run: node scripts/release-rehearsal/check.mjs",
  );
  assert.deepEqual(workflowViolations(yaml).violations, []);
});

test("workflowViolations — F3: redirections on the barrier are NOT read as a pipe", () => {
  // `> file 2>&1` keeps the exit status; the operator scan must not over-reject it.
  const yaml = workflow().replace(
    "        run: node scripts/release-rehearsal/check.mjs",
    "        run: node scripts/release-rehearsal/check.mjs > /tmp/rehearsal.log 2>&1",
  );
  assert.deepEqual(workflowViolations(yaml).violations, []);
});

test("workflowViolations — F3: a barrier that ENDS the script (with `set -e`) is accepted", () => {
  const yaml = workflow().replace(
    "        run: node scripts/release-rehearsal/check.mjs",
    [
      "        run: |",
      "          set -euo pipefail",
      "          node scripts/release-rehearsal/check.mjs",
    ].join("\n"),
  );
  assert.deepEqual(workflowViolations(yaml).violations, []);
});

const priorBarrierJob = ["  rehearse:", "    runs-on: ubuntu-24.04", "    steps:", ...barrierLines];

test("F4 — the fixture really emits the barrier job BEFORE `publish:`", () => {
  // The finding this pins: the old fixture appended the extra job after the publish
  // steps, so it fixtured a LATER job and the `needs:` rule was never exercised.
  const steps = parseSteps(workflow({ barrier: false, preJobs: priorBarrierJob }));
  assert.equal(steps[0].job, "rehearse");
  assert.equal(steps[0].name, BARRIER_STEP);
  assert.ok(steps.findIndex((step) => step.name === COHORT_STEP) > 0);
});

test("workflowViolations — F4: a barrier in a prior job WITHOUT `needs:` is refused", () => {
  // A flat step index made the prior job's barrier "before the cohort" while the
  // publish job could start in parallel (or first) — the gate was decorative. The
  // job must come BEFORE `publish:` for this to test `needs:` and not "runs AFTER".
  const yaml = workflow({ barrier: false, preJobs: priorBarrierJob });
  const violations = workflowViolations(yaml).violations;
  refuses(violations, "does not `needs:`", "prior job no needs");
  assert.ok(
    !violations.some((violation) => violation.includes("runs AFTER")),
    `the prior-job case must not fail for the ordering reason: ${JSON.stringify(violations)}`,
  );
});

test("workflowViolations — a barrier in a prior job the publish job `needs:` is accepted", () => {
  const yaml = workflow({
    barrier: false,
    preJobs: priorBarrierJob,
    publishExtra: ["    needs: rehearse"],
  });
  assert.deepEqual(workflowViolations(yaml).violations, []);
});

test("workflowViolations — F2: a barrier JOB with `continue-on-error: true` is refused", () => {
  const yaml = workflow({
    barrier: false,
    preJobs: [
      "  rehearse:",
      "    runs-on: ubuntu-24.04",
      "    continue-on-error: true",
      "    steps:",
      ...barrierLines,
    ],
    publishExtra: ["    needs: rehearse"],
  });
  refuses(
    workflowViolations(yaml).violations,
    "continue-on-error",
    "job-level swallowed barrier failure",
  );
});

test("runCommands — reads only the `run:` value, never `env:`/`with:` or comments", () => {
  const body = [
    "      - name: x",
    "        env:",
    "          HINT: node scripts/release-rehearsal/check.mjs",
    "        # run: node scripts/release-rehearsal/check.mjs",
    "        run: |",
    "          # a comment inside the script",
    "          set -euo pipefail",
    "          node scripts/release-rehearsal/check.mjs --root .",
  ].join("\n");
  const commands = runCommands(body);
  assert.deepEqual(commands, [
    "set -euo pipefail",
    "node scripts/release-rehearsal/check.mjs --root .",
  ]);
  const script = "scripts/release-rehearsal/check.mjs";
  assert.equal(executesScript(commands, script), true);
  assert.equal(executesScript([...commands, "echo done"], script), false);
  assert.equal(executesScript(["set +e", `node ${script}`], script), false);
  assert.equal(executesScript(runCommands(`        run: node ${script} || true`), script), false);
  assert.equal(executesScript([`echo "node ${script}"`], script), false);
  assert.equal(executesScript([`SITE_REF=x node ${script}`], script), true);
});

test("workflowViolations — F4: id-token only on a comment is refused", () => {
  const yaml = workflow({ idToken: "  # id-token: write" });
  refuses(workflowViolations(yaml).violations, "publish job does not grant", "commented id-token");
});

test("workflowViolations — F4: a job-level permissions block without id-token overrides the default", () => {
  const yaml = workflow({ publishPermissions: ["contents: read"] });
  const token = idTokenGranted(yaml);
  assert.equal(token.granted, false);
  assert.equal(token.scope, "publish job permissions");
  refuses(workflowViolations(yaml).violations, "publish job does not grant", "job override");
});

test("idTokenGranted — the effective grant is read from the job, flow style included", () => {
  assert.deepEqual(idTokenGranted(workflow()), {
    granted: true,
    scope: "top-level permissions",
  });
  const flow = workflow({
    publishExtra: ["    permissions: { contents: read, id-token: write }"],
  });
  // The SCOPE is asserted, not only the grant: a job-level flow block that fell
  // through to the top-level default also reads `granted: true` — the tautology that
  // let F4b hide (the finding: this case passed by the fallback it should catch).
  assert.deepEqual(idTokenGranted(flow), {
    granted: true,
    scope: "publish job permissions",
  });
});

test("idTokenGranted — F4b: a job-level flow block without id-token is NOT the top-level default", () => {
  // The false positive: the flow branch matched only column 0, so this job-level
  // `permissions: {contents: read}` fell through to the workflow default (which
  // grants `id-token: write`) and the rehearsal read a grant the job does not have.
  const flow = workflow({ publishExtra: ["    permissions: {contents: read}"] });
  assert.deepEqual(idTokenGranted(flow), {
    granted: false,
    scope: "publish job permissions",
  });
  refuses(workflowViolations(flow).violations, "publish job does not grant", "flow job override");
});

test("idTokenGranted — F1: a scalar job override is read, not skipped to the default", () => {
  // `permissions: read-all` / `write-all` is valid GitHub Actions syntax and REPLACES
  // the workflow default, exactly like the block form. Matching only block/flow let it
  // fall through to the top-level grant — F4b one spelling over.
  const readAll = workflow({ publishExtra: ["    permissions: read-all"] });
  assert.deepEqual(idTokenGranted(readAll), {
    granted: false,
    scope: "publish job permissions (`read-all`)",
  });
  refuses(workflowViolations(readAll).violations, "publish job does not grant", "scalar read-all");

  const writeAll = workflow({ publishExtra: ["    permissions: write-all"] });
  assert.deepEqual(idTokenGranted(writeAll), {
    granted: true,
    scope: "publish job permissions (`write-all`)",
  });

  const empty = workflow({ publishExtra: ["    permissions: {}"] });
  assert.deepEqual(idTokenGranted(empty), {
    granted: false,
    scope: "publish job permissions",
  });
  refuses(workflowViolations(empty).violations, "publish job does not grant", "empty flow");

  // An unreadable scalar fails closed and says so; it never falls back to the default.
  const unknown = workflow({ publishExtra: ["    permissions: read-none"] });
  assert.deepEqual(idTokenGranted(unknown), {
    granted: false,
    scope: "publish job permissions (unrecognized scalar `read-none`)",
  });
  refuses(workflowViolations(unknown).violations, "publish job does not grant", "unknown scalar");
});

test("F2 — a key with a space before the colon is still that key", () => {
  // YAML allows `permissions : read-all`; a matcher anchored on `permissions:` read
  // nothing, fell through to the workflow default and re-opened F1. Same for the
  // step/job settings the barrier depends on.
  const flow = workflow({ publishExtra: ["    permissions : { contents: read }"] });
  assert.deepEqual(idTokenGranted(flow), {
    granted: false,
    scope: "publish job permissions",
  });
  refuses(workflowViolations(flow).violations, "publish job does not grant", "spaced flow block");

  const scalar = workflow({ publishExtra: ["    permissions : read-all"] });
  assert.deepEqual(idTokenGranted(scalar), {
    granted: false,
    scope: "publish job permissions (`read-all`)",
  });

  const swallow = workflow().replace(
    `      - name: ${BARRIER_STEP}`,
    `      - name: ${BARRIER_STEP}\n        continue-on-error : true`,
  );
  refuses(workflowViolations(swallow).violations, "continue-on-error", "spaced swallow key");

  const gated = workflow().replace(
    `      - name: ${BARRIER_STEP}`,
    `      - name: ${BARRIER_STEP}\n        if : \${{ false }}`,
  );
  refuses(workflowViolations(gated).violations, "never true", "spaced if key");
});

test("F3 — a constant-false `if:` with a trailing comment still gates the barrier", () => {
  // `staticallyFalseIf` did not strip the comment (unlike `staticallyTrue`), so the
  // condition read as `false }} # disabled` and never matched — the barrier stayed
  // green while never running.
  const step = workflow().replace(
    `      - name: ${BARRIER_STEP}`,
    `      - name: ${BARRIER_STEP}\n        if: \${{ false }} # disabled`,
  );
  refuses(workflowViolations(step).violations, "never true", "commented false step if");

  const job = workflow({
    barrier: false,
    preJobs: [
      "  rehearse:",
      "    runs-on: ubuntu-24.04",
      ["    if: ", "$", "{{ false }} # disabled"].join(""),
      "    steps:",
      ...barrierLines,
    ],
    publishExtra: ["    needs: rehearse"],
  });
  refuses(workflowViolations(job).violations, "never true", "commented false job if");
});

test("F1 — an UNREADABLE job permissions shape fails closed, never the default", () => {
  // The BLOCKER: a flow mapping split across lines (valid YAML) matched none of the
  // patterns, `permissionOverride` returned null and the grant was read from the
  // WORKFLOW default — green while the job had replaced it.
  const multiLineFlow = workflow({
    publishExtra: ["    permissions: {", "      contents: read", "    }"],
  });
  const verdict = idTokenGranted(multiLineFlow);
  assert.equal(verdict.granted, false);
  assert.equal(verdict.scope, 'publish job permissions (unreadable `permissions:` "{")');
  refuses(
    workflowViolations(multiLineFlow).violations,
    "publish job does not grant",
    "multiline flow",
  );

  const anchored = workflow({ publishExtra: ["    permissions: &p { contents: read }"] });
  assert.equal(idTokenGranted(anchored).granted, false);
  assert.match(idTokenGranted(anchored).scope, /unreadable/);
  refuses(workflowViolations(anchored).violations, "publish job does not grant", "anchored flow");

  const aliased = workflow({ publishExtra: ["    permissions: *alias"] });
  assert.equal(idTokenGranted(aliased).granted, false);
  assert.match(idTokenGranted(aliased).scope, /unreadable/);
  refuses(workflowViolations(aliased).violations, "publish job does not grant", "aliased block");
});

test("F4 — an `id-token : write` grant written with spaces still counts", () => {
  // Rejecting it was a false RED on valid YAML the docs say the gate tolerates.
  const block = workflow({ publishPermissions: ["id-token : write"] });
  assert.deepEqual(idTokenGranted(block), {
    granted: true,
    scope: "publish job permissions",
  });
  const flow = workflow({
    publishExtra: ["    permissions: { contents: read, id-token : write }"],
  });
  assert.deepEqual(idTokenGranted(flow), {
    granted: true,
    scope: "publish job permissions",
  });
  const doubleSpace = workflow({ publishPermissions: ["id-token:  write"] });
  assert.equal(idTokenGranted(doubleSpace).granted, true);
});

test("idTokenGranted — F1: a scalar TOP-LEVEL default is read too", () => {
  const yaml = workflow().replace(
    ["permissions:", "  contents: read", "  id-token: write"].join("\n"),
    "permissions: read-all",
  );
  assert.deepEqual(idTokenGranted(yaml), {
    granted: false,
    scope: "top-level permissions (`read-all`)",
  });
  refuses(workflowViolations(yaml).violations, "publish job does not grant", "top scalar");
});

test("workflowViolations — a missing ORDER is refused", () => {
  const run = REAL_COHORT_RUN.filter((line) => !line.includes("ORDER="));
  refuses(workflowViolations(workflow({ cohortRun: run })).violations, "no ORDER", "missing ORDER");
});

test("workflowViolations — a missing cohort step is refused", () => {
  const yaml = workflow().replace(`      - name: ${COHORT_STEP}`, "      - name: Publish the seam");
  refuses(workflowViolations(yaml).violations, "exactly one step named", "renamed step");
});

test("workflowViolations — the CLI publishing before the cohort is refused", () => {
  refuses(
    workflowViolations(workflow({ cliFirst: true })).violations,
    "runs before the seam-cohort",
    "CLI before cohort",
  );
});

test("uncoveredPublishables — F3: a publishable workspace member outside the cohort is refused", () => {
  const workspacePackages = [
    ...cohort,
    { dir: "packages/server", manifest: manifest("server") },
    { dir: "packages/cli", manifest: { name: "@profile-as-code/cli", private: false } },
    {
      dir: "packages/renderers/kofi",
      manifest: { name: "@profile-as-code/renderers-kofi", private: true },
    },
  ];
  refuses(uncoveredPublishables(workspacePackages), "packages/server", "uncovered publishable");
  assert.deepEqual(uncoveredPublishables(cohort), []);
});

// ── the publish ORDER ─────────────────────────────────────────────────────────

test("orderViolations — the declared order is valid for the cohort's real edges", () => {
  const withEdges = cohort.map((entry) =>
    entry.dir === "packages/paste" || entry.dir === "packages/github"
      ? {
          ...entry,
          manifest: { ...entry.manifest, dependencies: { "@profile-as-code/core": "0.1.1" } },
        }
      : entry,
  );
  assert.deepEqual(
    orderViolations(["core", "markdown", "paste", "artifact", "github"], withEdges),
    [],
  );
  assert.deepEqual(
    orderViolations(["core", "markdown", "paste", "artifact", "github"], cohort),
    [],
  );
});

test("orderViolations — a consumer published before its dependency is refused", () => {
  const withEdges = cohort.map((entry) =>
    entry.dir === "packages/paste"
      ? {
          ...entry,
          manifest: { ...entry.manifest, dependencies: { "@profile-as-code/core": "0.1.1" } },
        }
      : entry,
  );
  refuses(
    orderViolations(["paste", "core", "markdown", "artifact", "github"], withEdges),
    "publishes paste before core",
    "consumer first",
  );
});

test("orderViolations — an omitted cohort member is refused", () => {
  refuses(
    orderViolations(["core", "markdown", "paste", "artifact"], cohort),
    "omits it",
    "omitted member",
  );
});

test("orderViolations — an unknown ORDER entry is refused", () => {
  refuses(
    orderViolations(["core", "markdown", "paste", "artifact", "github", "server"], cohort),
    "not a cohort member",
    "unknown member",
  );
});

test("orderViolations — duplicate ORDER entries are refused", () => {
  refuses(
    orderViolations(["core", "markdown", "paste", "artifact", "github", "core"], cohort),
    "duplicate",
    "duplicates",
  );
});

test("runtimeDependencyViolations — a runtime edge onto an unpublished workspace package is refused", () => {
  const withEdges = cohort.map((entry) =>
    entry.dir === "packages/github"
      ? {
          ...entry,
          manifest: {
            ...entry.manifest,
            dependencies: { "@profile-as-code/renderers-github-readme": "0.1.0" },
          },
        }
      : entry,
  );
  const workspaceNames = new Set([
    ...SEAM_DIRS.map((dir) => `@profile-as-code/${dir.slice("packages/".length)}`),
    "@profile-as-code/renderers-github-readme",
    "@profile-as-code/cli",
  ]);
  refuses(
    runtimeDependencyViolations(withEdges, workspaceNames),
    "outside the publish cohort",
    "unpublished workspace dep",
  );
  assert.deepEqual(runtimeDependencyViolations(cohort, workspaceNames), []);
});

// ── the packed manifest ───────────────────────────────────────────────────────
const entriesFor = () => [
  "package/package.json",
  "package/dist/index.js",
  "package/dist/index.d.ts",
];

const base = {
  dir: "packages/paste",
  source: manifest("paste", {
    dependencies: { "@profile-as-code/core": "workspace:*" },
  }),
  entries: entriesFor(manifest("paste")),
  expectedRepoUrl: REPO_URL,
  cohortVersions: new Map([
    ["@profile-as-code/core", "0.1.1"],
    ["@profile-as-code/markdown", "0.1.0"],
    ["@profile-as-code/paste", "0.1.0"],
    ["@profile-as-code/artifact", "0.1.0"],
    ["@profile-as-code/github", "0.1.0"],
  ]),
};

test("manifestViolations — a correctly packed manifest passes", () => {
  const shipped = manifest("paste", { dependencies: { "@profile-as-code/core": "0.1.1" } });
  assert.deepEqual(manifestViolations({ ...base, shipped, entries: entriesFor(shipped) }), []);
});

test("manifestViolations — a name/version drift is refused", () => {
  refuses(
    manifestViolations({
      ...base,
      shipped: manifest("paste", { name: "@profile-as-code/other" }),
      entries: entriesFor(manifest("paste")),
    }),
    "packed manifest is named",
    "name drift",
  );
  refuses(
    manifestViolations({
      ...base,
      shipped: manifest("paste", { version: "0.2.0" }),
      entries: entriesFor(manifest("paste")),
    }),
    "packed version",
    "version drift",
  );
});

test("manifestViolations — private / non-public publishConfig are refused", () => {
  refuses(
    manifestViolations({
      ...base,
      shipped: manifest("paste", { private: true }),
      entries: entriesFor(manifest("paste")),
    }),
    "private",
    "private",
  );
  refuses(
    manifestViolations({
      ...base,
      shipped: manifest("paste", { publishConfig: {} }),
      entries: entriesFor(manifest("paste")),
    }),
    "publishConfig.access",
    "mixed access",
  );
});

test("manifestViolations — surviving `workspace:*` is refused (#301)", () => {
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
    "devDependencies",
  ]) {
    const shipped = manifest("paste", { [field]: { "@profile-as-code/core": "workspace:*" } });
    refuses(
      manifestViolations({ ...base, shipped, entries: entriesFor(shipped) }),
      "survived packing",
      `workspace residue in ${field}`,
    );
  }
});

test("manifestViolations — a rewrite onto the wrong peer version is refused", () => {
  const shipped = manifest("paste", { dependencies: { "@profile-as-code/core": "0.1.0" } });
  refuses(
    manifestViolations({ ...base, shipped, entries: entriesFor(shipped) }),
    "did not land",
    "stale rewrite",
  );
});

test("manifestViolations — a missing entrypoint is refused", () => {
  const shipped = manifest("paste");
  refuses(
    manifestViolations({ ...base, shipped, entries: ["package/package.json"] }),
    "the tarball has no package/dist/index.js",
    "missing entrypoint",
  );
});

test("manifestViolations — a missing `files` directory is refused", () => {
  const shipped = manifest("paste", { files: ["dist", "skills"] });
  refuses(
    manifestViolations({ ...base, shipped, entries: entriesFor(shipped) }),
    "contains no package/skills",
    "missing files dir",
  );
});

test("manifestViolations — a repository mismatch is refused", () => {
  const shipped = manifest("paste", {
    repository: {
      type: "git",
      url: "git+https://github.com/someone/fork.git",
      directory: "packages/paste",
    },
  });
  refuses(
    manifestViolations({ ...base, shipped, entries: entriesFor(shipped) }),
    "repository.url",
    "repo url",
  );
  refuses(
    manifestViolations({
      ...base,
      shipped: manifest("paste", { repository: { url: REPO_URL, directory: "packages/other" } }),
      entries: entriesFor(manifest("paste")),
    }),
    "repository.directory",
    "repo directory",
  );
});

test("manifestViolations — an underivable repo URL SKIPS the match visibly, never passes silently", () => {
  const shipped = manifest("paste", {
    repository: { url: "git+https://github.com/someone/else.git", directory: "packages/paste" },
  });
  assert.deepEqual(
    manifestViolations({
      ...base,
      shipped,
      entries: entriesFor(shipped),
      expectedRepoUrl: null,
    }),
    [],
  );
});

test("targetPaths — collects main/types/exports targets only", () => {
  const targets = targetPaths(
    manifest("paste", {
      browser: "./dist/browser.js",
      exports: { "./conformance": "./dist/conformance.js" },
    }),
  );
  const values = targets.map(([, value]) => value);
  assert.ok(values.includes("./dist/index.js"));
  assert.ok(values.includes("./dist/index.d.ts"));
  assert.ok(values.includes("./dist/browser.js"));
  assert.ok(values.includes("./dist/conformance.js"));
});

test("expectedRepositoryUrl — GITHUB_REPOSITORY wins over the git remote", () => {
  assert.equal(
    expectedRepositoryUrl("/nonexistent", {
      GITHUB_REPOSITORY: "ChristianLuciani/profile-as-code",
    }),
    REPO_URL,
  );
});

// ── end-to-end wiring of check() ──────────────────────────────────────────────
/** Write a valid fixture workspace and return its root. */
function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rehearsal-fixture-"));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  writeFileSync(path.join(root, ".github/workflows/release.yml"), workflow());
  for (const pkg of ["core", "markdown", "paste", "artifact", "github"]) {
    const dir = path.join(root, "packages", pkg);
    mkdirSync(dir, { recursive: true });
    const extra =
      pkg === "paste" || pkg === "github"
        ? { dependencies: { "@profile-as-code/core": "0.1.1" } }
        : {};
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest(pkg, extra), null, 2));
  }
  return root;
}

/** A stub packer: builds a real tarball from the source manifest, optionally mutated. */
function stubPack(mutate = (m) => m) {
  return (dir, destination) => {
    const source = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const shipped = mutate(structuredClone(source));
    const staging = mkdtempSync(path.join(os.tmpdir(), "rehearsal-staging-"));
    mkdirSync(path.join(staging, "package/dist"), { recursive: true });
    writeFileSync(path.join(staging, "package/package.json"), JSON.stringify(shipped, null, 2));
    writeFileSync(path.join(staging, "package/dist/index.js"), "export const fixture = 1;\n");
    writeFileSync(
      path.join(staging, "package/dist/index.d.ts"),
      "export declare const fixture: 1;\n",
    );
    const file = path.join(
      destination,
      `profile-as-code-${path.basename(dir)}-${shipped.version}.tgz`,
    );
    const tar = spawnSync("tar", ["-czf", file, "-C", staging, "package"], { encoding: "utf8" });
    rmSync(staging, { recursive: true, force: true });
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
    return { file, name: path.basename(file) };
  };
}

async function runAsync(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (error) {
    failures.push(`FAIL ${label}\n  ${error.message}`);
  }
}

// node:test is not used: the suite is a plain script like every other self-test
// here, but check() is async, so the end-to-end cases run through a small runner.
await (async () => {
  const fixtures = [];
  try {
    await runAsync("check — a valid workspace passes and receipts all five packages", async () => {
      const root = makeFixture();
      fixtures.push(root);
      const result = await check(root, { pack: stubPack(), repositoryUrl: REPO_URL });
      assert.equal(result.status, "pass", JSON.stringify(result.messages));
      assert.equal(result.receipt.length, 5);
      for (const entry of result.receipt) {
        assert.match(entry.sha256, /^[0-9a-f]{64}$/);
        assert.ok(entry.bytes > 0);
      }
      assert.ok(result.messages.some((message) => message.includes("publishes: nothing")));
      assert.ok(result.messages.some((message) => message.includes("NOT CHECKED")));
    });

    await runAsync("check — a mutated packed manifest fails with the exact reason", async () => {
      const root = makeFixture();
      fixtures.push(root);
      const result = await check(root, {
        pack: stubPack((shipped) =>
          shipped.name === "@profile-as-code/paste"
            ? { ...shipped, dependencies: { "@profile-as-code/core": "0.0.9" } }
            : shipped,
        ),
        repositoryUrl: REPO_URL,
      });
      assert.equal(result.status, "fail");
      assert.ok(
        result.messages.some(
          (message) =>
            message.includes("dependencies.@profile-as-code/core") && message.includes("0.0.9"),
        ),
        JSON.stringify(result.messages),
      );
    });

    await runAsync(
      "check — F3: a publishable workspace member outside the cohort fails",
      async () => {
        const root = makeFixture();
        fixtures.push(root);
        const server = path.join(root, "packages/server");
        mkdirSync(server, { recursive: true });
        writeFileSync(
          path.join(server, "package.json"),
          JSON.stringify(manifest("server"), null, 2),
        );
        const result = await check(root, { pack: stubPack(), repositoryUrl: REPO_URL });
        assert.equal(result.status, "fail");
        assert.ok(
          result.messages.some(
            (message) => message.includes("packages/server") && message.includes("publishable"),
          ),
          JSON.stringify(result.messages),
        );
      },
    );

    await runAsync("check — a workspace member missing from the globs is refused", async () => {
      const root = makeFixture();
      fixtures.push(root);
      writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/core\n");
      const result = await check(root, { pack: stubPack(), repositoryUrl: REPO_URL });
      assert.equal(result.status, "fail");
      assert.ok(
        result.messages.some((message) => message.includes("not of the workspace")),
        JSON.stringify(result.messages),
      );
    });

    await runAsync(
      "check — the CLI publishes through a symlinked path (no silent no-op)",
      async () => {
        const linkedDir = path.join(os.tmpdir(), `rehearsal-linked-${process.pid}`);
        rmSync(linkedDir, { recursive: true, force: true });
        mkdirSync(linkedDir, { recursive: true });
        // Spawn the real CLI via a symlink to the gate's directory: argv[1] carries
        // the symlinked path, import.meta.url the real one (the dep-gate F2 repro).
        const link = path.join(linkedDir, "rehearsal");
        symlinkSync(here, link, "dir");
        const res = spawnSync(process.execPath, [path.join(link, "check.mjs"), "--help"], {
          encoding: "utf8",
        });
        rmSync(linkedDir, { recursive: true, force: true });
        assert.equal(res.status, 0, res.stderr);
        assert.ok(res.stdout.includes("usage: node scripts/release-rehearsal/check.mjs"));
      },
    );
  } finally {
    for (const root of fixtures) rmSync(root, { recursive: true, force: true });
  }
})();

console.log(`\n${passed}/${passed + failures.length} cases passed`);
if (failures.length > 0) {
  console.error(`\nE-TEST: ${failures.length} self-test failures:\n`);
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
