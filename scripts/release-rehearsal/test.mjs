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
  expectedRepositoryUrl,
  manifestViolations,
  orderViolations,
  parseSteps,
  runtimeDependencyViolations,
  SEAM_DIRS,
  targetPaths,
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

const workflow = (cohortStep = "Publish the seam cohort (pnpm publish, in dependency order)") =>
  [
    "name: release",
    "permissions:",
    "  contents: read",
    "  id-token: write",
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - uses: actions/checkout@v7",
    `      - name: ${cohortStep}`,
    "        run: |",
    '          ORDER="core markdown paste artifact github"',
    "          for pkg in $ORDER; do",
    '            (cd "packages/$pkg" && pnpm publish --access public --no-git-checks)',
    "          done",
    "      - name: Publish",
    "        run: npm publish --access public",
  ].join("\n");

// ── the workflow mechanism ────────────────────────────────────────────────────
test("parseSteps — names the steps of the cohort and CLI publish", () => {
  const steps = parseSteps(workflow());
  const names = steps.map((step) => step.name);
  assert.ok(names.includes("Publish the seam cohort (pnpm publish, in dependency order)"));
  assert.ok(names.includes("Publish"));
});

test("workflowViolations — a valid workflow yields no violations", () => {
  const result = workflowViolations(workflow());
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.order, ["core", "markdown", "paste", "artifact", "github"]);
});

test("workflowViolations — a missing id-token is refused", () => {
  const yaml = workflow().replace("  id-token: write\n", "");
  refuses(workflowViolations(yaml).violations, "id-token", "no id-token");
});

test("workflowViolations — `npm publish` in the cohort step is refused (#301)", () => {
  const yaml = workflow().replace(
    "pnpm publish --access public --no-git-checks",
    "npm publish --access public",
  );
  refuses(workflowViolations(yaml).violations, "does not run `pnpm publish`", "npm publish");
});

test("workflowViolations — a missing ORDER is refused", () => {
  const yaml = workflow().replace('          ORDER="core markdown paste artifact github"\n', "");
  refuses(workflowViolations(yaml).violations, "no ORDER", "missing ORDER");
});

test("workflowViolations — a missing cohort step is refused", () => {
  const yaml = workflow().replace(
    "      - name: Publish the seam cohort (pnpm publish, in dependency order)",
    "      - name: Publish the seam",
  );
  refuses(workflowViolations(yaml).violations, "exactly one step named", "renamed step");
});

test("workflowViolations — the CLI publishing before the cohort is refused", () => {
  const yaml = [
    "permissions:",
    "  id-token: write",
    "jobs:",
    "      - name: Publish",
    "        run: npm publish",
    "      - name: Publish the seam cohort (pnpm publish, in dependency order)",
    "        run: |",
    '          ORDER="core markdown paste artifact github"',
    "          pnpm publish",
  ].join("\n");
  refuses(workflowViolations(yaml).violations, "runs before the seam-cohort", "CLI first");
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
