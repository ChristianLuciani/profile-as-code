#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
/**
 * release-rehearsal — the seam-cohort publish is rehearsed before it is irreversible (#313).
 *
 * The five seam packages (`packages/{core,markdown,paste,artifact,github}`) publish
 * from `.github/workflows/release.yml` as a loop of `pnpm publish`, in dependency
 * order, `core` first. That loop has existed since #301 but had never published a
 * member (#313): the `v0.3.6` run logged five skips because every seam version was
 * already live. So the first real cohort publish — a seam version bump, an operator
 * tag, `pnpm publish` × 5 over OIDC — would be FIRST CONTACT, and npm cannot be
 * un-published. This gate is the rehearsal of that moment: it runs the same client
 * (`pnpm`) over the same five directories, offline, and publishes NOTHING.
 *
 * What it can prove offline, and therefore asserts:
 *   1. ORDER — the `ORDER="…"` list in release.yml is a valid topological order of
 *      the cohort's runtime workspace dependencies (a future `artifact → markdown`
 *      edge cannot silently publish a consumer before its dependency);
 *   2. TARBALL — for each package, `pnpm pack` (the client the publish uses, not
 *      `npm pack`) produces a manifest whose `name`/`version` equal the source
 *      manifest, whose `private`/`publishConfig.access` allow a public publish,
 *      whose `workspace:*` dependency protocol is rewritten to the peer's exact
 *      version (the #301 claim), and whose `main`/`types`/`exports`/`files`
 *      targets actually exist inside the tarball;
 *   3. MECHANISM — the publish JOB still grants `id-token: write`, every publish
 *      invocation outside a `--dry-run` branch is `pnpm publish` (only pnpm rewrites
 *      `workspace:*`), the loop iterates `$ORDER`, the rehearsal barrier exists before
 *      the loop, the cohort runs before the CLI's own `Publish` step, every
 *      publishable workspace member is in the cohort, and each manifest's
 *      `repository.url` matches the repo the workflow runs in (npm fails the
 *      publish on a mismatch).
 *
 * What it CANNOT prove, and says so in its own output: the OIDC exchange against
 * npm's trusted-publisher binding, the registry state (a live version is skipped,
 * not republished), and `dist.attestations`. Those exist only after a real publish;
 * they are #313's remaining evidence and the operator's release run closes them.
 * A dry run is not that evidence (release.yml deliberately does not validate
 * publish auth — see docs/ci-cd.md §"Rehearsing the cohort publish").
 *
 * Deterministic and offline: `pnpm pack` and `tar` are local, no registry call, no
 * clock. Exit 0 = the rehearsal passed; 1 = E-REHEARSAL with the exact package and
 * reason. Zero dependencies, node >=22.
 *
 * Usage:  node scripts/release-rehearsal/check.mjs [--root DIR] [--help]
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expandGlob, parseWorkspaceGlobs } from "../dep-gate/check.mjs";

/** Configuration/shape error: the rehearsal cannot verify what it was asked to verify. */
class GateError extends Error {}

/**
 * The cohort, in the order release.yml publishes it. Directory-keyed like the
 * publishable allowlist (`scripts/publishable-gate`, #190) — the subject is the
 * location. The CLI is deliberately NOT here: it publishes from its own step,
 * with `npm publish` and its `prepublishOnly`/`verify:pack` chain.
 */
export const SEAM_DIRS = [
  "packages/core",
  "packages/markdown",
  "packages/paste",
  "packages/artifact",
  "packages/github",
];

/** Dependency maps that can carry a workspace reference into the published manifest. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
];

/** Manifest targets a consumer resolves: they must exist in the tarball. */
const TARGET_FIELDS = ["main", "types", "browser", "module"];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Read `package.json` as an object; a shape that cannot be read is a GateError. */
function readManifestFile(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw new GateError(`unreadable ${file}: ${error.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new GateError(`unparseable ${file}: ${error.message}`);
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new GateError(`${file} is not a JSON object`);
  }
  return manifest;
}

/**
 * Split `.github/workflows/release.yml` into named steps (6-space `- ` items) so the
 * mechanism assertions read a step, not a line window. Steps without a `name:` are
 * kept (their `uses:` is the identity) and never match a name lookup.
 */
export function parseSteps(yaml) {
  const lines = yaml.split("\n");
  const steps = [];
  let current = null;
  for (const line of lines) {
    if (/^ {6}- /.test(line)) {
      current = { name: null, lines: [line] };
      steps.push(current);
      const name = line.match(/^ {6}- name:\s*(.+)$/);
      if (name) current.name = name[1].trim().replace(/^['"]|['"]$/g, "");
    } else if (current) {
      current.lines.push(line);
    }
  }
  return steps.map((step) => ({ name: step.name, body: step.lines.join("\n") }));
}

function findStep(steps, name) {
  const matches = steps.filter((step) => step.name === name);
  if (matches.length !== 1) {
    throw new GateError(
      `expected exactly one step named "${name}" in release.yml, found ${matches.length}`,
    );
  }
  return matches[0];
}

/**
 * The publish-order invariants, as a pure function of the declared order and the
 * cohort manifests. Returns human-readable violations; empty = valid.
 *
 * `packages` is `[{ dir, manifest }]` (source manifests). A runtime edge is a
 * `dependencies`/`optionalDependencies`/`peerDependencies` entry naming another
 * cohort member — devDependencies do not ship, so they cannot break a publish.
 */
export function orderViolations(order, packages) {
  const violations = [];
  const dirByPackageName = new Map();
  for (const { dir, manifest } of packages) {
    if (typeof manifest.name === "string") dirByPackageName.set(manifest.name, dir);
  }
  const cohortManifest = new Map(packages.map((entry) => [entry.dir, entry.manifest]));

  if (new Set(order).size !== order.length) {
    violations.push(`E-REHEARSAL: the publish ORDER has duplicate entries: ${order.join(" ")}`);
  }
  const declared = new Set(order);
  for (const { dir } of packages) {
    const relative = dir.replace(/^packages\//, "");
    if (!declared.has(relative)) {
      violations.push(
        `E-REHEARSAL: ${dir} is a member of the cohort but the publish ORDER omits it ` +
          `(declared: ${order.join(" ")}), so it would publish with no rehearsal`,
      );
    }
  }

  for (const relative of order) {
    const dir = `packages/${relative}`;
    const manifest = cohortManifest.get(dir);
    if (!manifest) {
      violations.push(
        `E-REHEARSAL: the publish ORDER names "${relative}" but ${dir} is not a cohort member ` +
          "(the loop would fail on a missing directory)",
      );
      continue;
    }
    const at = order.indexOf(relative);
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const deps = manifest[field];
      if (!deps || typeof deps !== "object") continue;
      for (const [dependencyName, range] of Object.entries(deps)) {
        const dependencyDir = dirByPackageName.get(dependencyName);
        if (!dependencyDir || dependencyDir === dir) continue;
        const dependencyRelative = dependencyDir.replace(/^packages\//, "");
        const dependencyAt = order.indexOf(dependencyRelative);
        if (dependencyAt < 0) {
          violations.push(
            `E-REHEARSAL: ${manifest.name} (${relative}) has a runtime ${field} on ` +
              `${dependencyName} (${dependencyRelative}), which is not in the publish ORDER — ` +
              "the published manifest would point at a version nobody published in this run",
          );
        } else if (dependencyAt > at) {
          violations.push(
            `E-REHEARSAL: publish order publishes ${relative} before ${dependencyRelative}, ` +
              `but ${manifest.name} declares ${field} ${dependencyName}: ${range} — a consumer ` +
              "would publish before its dependency",
          );
        }
      }
    }
  }
  return violations;
}

/**
 * A cohort member may only carry a RUNTIME dependency on another cohort member.
 * A dependency on a workspace package that is not published (a renderer, the CLI,
 * a future server) would ship an exact version nobody published in the run — the
 * same uninstallable class as a surviving `workspace:*`, one step earlier.
 * `workspaceNames` is the set of names of every workspace member.
 */
export function runtimeDependencyViolations(packages, workspaceNames) {
  const violations = [];
  const cohortNames = new Set(packages.map(({ manifest }) => manifest.name));
  for (const { dir, manifest } of packages) {
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      const deps = manifest[field];
      if (!deps || typeof deps !== "object") continue;
      for (const dependencyName of Object.keys(deps)) {
        if (!workspaceNames.has(dependencyName) || cohortNames.has(dependencyName)) continue;
        violations.push(
          `E-REHEARSAL: ${dir}: ${field}.${dependencyName} is a workspace package outside the ` +
            "publish cohort — the published manifest would require a version this run never " +
            "publishes",
        );
      }
    }
  }
  return violations;
}

/** Every path a consumer resolves from a shipped manifest (`./dist/x.js` → `dist/x.js`). */
export function targetPaths(manifest) {
  const targets = [];
  for (const field of TARGET_FIELDS) {
    if (typeof manifest[field] === "string") targets.push([field, manifest[field]]);
  }
  const exportsField = manifest.exports;
  const walk = (value, keyPath) => {
    if (typeof value === "string") targets.push([keyPath, value]);
    else if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) walk(nested, `${keyPath}.${key}`);
    }
  };
  if (exportsField !== undefined) walk(exportsField, "exports");
  return targets.filter(([, value]) => value.startsWith("./"));
}

/**
 * The packed-manifest invariants for one package, as a pure function. `shipped` is
 * the `package.json` read out of the tarball; `entries` is the tarball's file list
 * (`package/…`). `expectedRepoUrl` is null when the environment cannot supply the
 * repo the workflow runs in (then the match is a declared skip, never a silent pass).
 */
export function manifestViolations({
  dir,
  source,
  shipped,
  entries,
  expectedRepoUrl,
  cohortVersions = new Map(),
}) {
  const violations = [];
  const label = dir;
  const version = source.version;

  if (shipped.name !== source.name) {
    violations.push(
      `E-REHEARSAL: ${label}: the packed manifest is named ${JSON.stringify(shipped.name)}, ` +
        `the source manifest ${JSON.stringify(source.name)} — the tarball would publish the wrong package`,
    );
  }
  if (shipped.version !== version) {
    violations.push(
      `E-REHEARSAL: ${label}: the packed version is ${JSON.stringify(shipped.version)}, ` +
        `the source manifest ${JSON.stringify(version)}`,
    );
  }
  if (shipped.private === true) {
    violations.push(
      `E-REHEARSAL: ${label}: the packed manifest is "private": true — npm publishes EPRIVATE`,
    );
  }
  if (shipped.publishConfig?.access !== "public") {
    violations.push(
      `E-REHEARSAL: ${label}: publishConfig.access is ` +
        `${JSON.stringify(shipped.publishConfig?.access)} — a scoped package needs "public" (#259)`,
    );
  }

  const entrySet = new Set(entries);
  for (const [target, value] of targetPaths(shipped)) {
    const expected = `package/${value.replace(/^\.\//, "")}`;
    if (!entrySet.has(expected)) {
      violations.push(
        `E-REHEARSAL: ${label}: ${target} points at ${value} but the tarball has no ` +
          `${expected} — the published entrypoint would be broken`,
      );
    }
  }
  for (const file of Array.isArray(shipped.files) ? shipped.files : []) {
    const prefix = `package/${String(file).replace(/^\.\//, "").replace(/\/+$/, "")}`;
    if (!entries.some((entry) => entry === prefix || entry.startsWith(`${prefix}/`))) {
      violations.push(
        `E-REHEARSAL: ${label}: files declares ${JSON.stringify(file)} but the tarball ` +
          `contains no ${prefix} — a build artifact is missing from the published package`,
      );
    }
  }

  // The rewrite must resolve to the version the same run publishes for that peer:
  // a rewrite to an older exact version still points at a resolvable release, but
  // it would not be the TARBALL this run shipped, which is the #301 claim.
  for (const field of DEPENDENCY_FIELDS) {
    const deps = shipped[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [dependencyName, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.includes("workspace:")) {
        violations.push(
          `E-REHEARSAL: ${label}: ${field}.${dependencyName} is ${JSON.stringify(range)} — ` +
            "the workspace protocol survived packing; the published package would be " +
            "uninstallable (#301)",
        );
      }
    }
  }
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = shipped[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [dependencyName, range] of Object.entries(deps)) {
      const peerVersion = cohortVersions.get(dependencyName);
      if (peerVersion === undefined || typeof range !== "string") continue;
      if (range !== peerVersion) {
        violations.push(
          `E-REHEARSAL: ${label}: ${field}.${dependencyName} is ${JSON.stringify(range)} but ` +
            `this workspace's ${dependencyName} is ${peerVersion} — pnpm's rewrite did not land ` +
            "on the version this release publishes",
        );
      }
    }
  }

  if (expectedRepoUrl !== null) {
    const declared = shipped.repository?.url;
    if (declared !== expectedRepoUrl) {
      violations.push(
        `E-REHEARSAL: ${label}: repository.url is ${JSON.stringify(declared)}, the workflow runs ` +
          `in ${expectedRepoUrl} — npm fails the publish on a mismatch (and provenance binds to it)`,
      );
    }
    if (shipped.repository?.directory !== dir) {
      violations.push(
        `E-REHEARSAL: ${label}: repository.directory is ` +
          `${JSON.stringify(shipped.repository?.directory)}, expected ${JSON.stringify(dir)} ` +
          "(the package's monorepo home)",
      );
    }
  }
  return violations;
}

/**
 * The workflow-mechanism invariants, as a pure function of release.yml's text. The
 * file is the contract the real run executes; a rehearsal that packs correctly but
 * publishes with `npm publish` would still ship `workspace:*` (#301).
 *
 * The publish check is per INVOCATION, not a substring of the step: the real step
 * has two branches (a `--dry-run` one and the live one), so a single `pnpm publish`
 * match is satisfied by the branch that never publishes (fresh-pass F1). Lines with
 * `--dry-run` are treated as the smoke branch; every other invocation must be
 * `pnpm publish`, and at least one must exist. The loop must also iterate `$ORDER`,
 * or the order this gate validated would be decorative.
 */

/** A publish invocation found in a step body: `pnpm publish` / `npm publish`. */
export function publishInvocations(body) {
  const invocations = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    // Comments in the step must not be able to satisfy the assertion.
    if (line.startsWith("#")) continue;
    const re = /(^|[^\w-])(pnpm|npm)\s+publish\b/g;
    let match = re.exec(line);
    while (match !== null) {
      invocations.push({ client: match[2], dryRun: line.includes("--dry-run"), line });
      match = re.exec(line);
    }
  }
  return invocations;
}

/** The `publish` job's line range, or null when the job (or `jobs:`) is absent. */
function jobBlock(lines, name) {
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt < 0) return null;
  let start = -1;
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    if (new RegExp(`^ {2}${name}:\\s*$`).test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_.-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** The entries of a `permissions:` block at `indent` spaces, flow style included. */
function permissionEntries(lines, from, to, indent) {
  const pad = " ".repeat(indent);
  for (let i = from; i < to; i += 1) {
    const flow = lines[i].match(/^permissions:\s*\{(.*)\}\s*$/);
    if (flow) {
      return flow[1].split(",").map((entry) => entry.replace(/\s+#.*$/, "").trim());
    }
    if (lines[i] === `${pad}permissions:`) {
      const entries = [];
      for (let j = i + 1; j < to; j += 1) {
        if (!lines[j].startsWith(`${pad}  `)) break;
        const text = lines[j].trim().replace(/\s+#.*$/, "");
        if (text && !text.startsWith("#")) entries.push(text);
      }
      return entries;
    }
  }
  return null;
}

/**
 * Whether the `publish` job can exchange an OIDC token: its own `permissions:` when
 * declared (a job-level block REPLACES the workflow default), the top-level block
 * otherwise. A comment, or the `site` job's permission, no longer satisfies it
 * (fresh-pass F4).
 */
export function idTokenGranted(yaml) {
  const lines = yaml.split("\n");
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt < 0) return { granted: false, scope: "no jobs: block" };
  const job = jobBlock(lines, "publish");
  if (!job) return { granted: false, scope: "no publish job" };
  const jobPermissions = permissionEntries(lines, job.start, job.end, 4);
  if (jobPermissions !== null) {
    return {
      granted: jobPermissions.includes("id-token: write"),
      scope: "publish job permissions",
    };
  }
  const topPermissions = permissionEntries(lines, 0, jobsAt, 0);
  if (topPermissions === null) return { granted: false, scope: "no permissions block" };
  return { granted: topPermissions.includes("id-token: write"), scope: "top-level permissions" };
}

/** A workspace member that is publishable (`private !== true`) must be in the cohort. */
export function uncoveredPublishables(workspacePackages, cohortDirs = SEAM_DIRS) {
  const violations = [];
  const cohort = new Set(cohortDirs);
  for (const { dir, manifest } of workspacePackages) {
    if (dir === "packages/cli" || cohort.has(dir)) continue;
    if (manifest.private === true) continue;
    violations.push(
      `E-REHEARSAL: ${dir} (${manifest.name}) is publishable (private is not true) but is not ` +
        "in the seam cohort — it would never be published by the release, with every gate green " +
        "(the #313 class one level up). Add it to the cohort and to release.yml's ORDER",
    );
  }
  return violations;
}

export function workflowViolations(yaml) {
  const violations = [];
  const steps = parseSteps(yaml);

  const token = idTokenGranted(yaml);
  if (!token.granted) {
    violations.push(
      `E-REHEARSAL: the publish job does not grant \`id-token: write\` (${token.scope}) — ` +
        "trusted publishing (OIDC) cannot exchange a token",
    );
  }

  let cohortStep;
  try {
    cohortStep = findStep(steps, "Publish the seam cohort (pnpm publish, in dependency order)");
  } catch (error) {
    if (error instanceof GateError) {
      violations.push(`E-REHEARSAL: release.yml: ${error.message}`);
      return { violations, order: null };
    }
    throw error;
  }
  // Exclude the `- name:` line: the step is NAMED "… (pnpm publish, …)", so a
  // regression to `npm publish` in the command would otherwise match its own name.
  const command = cohortStep.body
    .split("\n")
    .filter((line) => !/^\s*-\s*name:/.test(line))
    .join("\n");

  const invocations = publishInvocations(command);
  const live = invocations.filter((invocation) => !invocation.dryRun);
  if (live.length === 0) {
    violations.push(
      "E-REHEARSAL: the cohort step has no publish invocation outside a `--dry-run` branch — " +
        "the rehearsal would vet a step that only smokes",
    );
  }
  for (const invocation of live) {
    if (invocation.client === "pnpm") continue;
    violations.push(
      `E-REHEARSAL: the cohort step publishes with \`${invocation.client} publish\` ` +
        `(live branch): ${JSON.stringify(invocation.line)} — \`npm publish\` does not rewrite ` +
        "`workspace:*`, so the published manifests would be uninstallable (#301)",
    );
  }
  if (!/for\s+\w+\s+in\s+"?\$\{?ORDER\}?"?/.test(command)) {
    violations.push(
      "E-REHEARSAL: the cohort step does not iterate `$ORDER` — the publish order this gate " +
        "validates would be decorative",
    );
  }

  const order = command.match(/ORDER="([^"]+)"/);
  if (!order) {
    violations.push(
      'E-REHEARSAL: the cohort step has no ORDER="…" declaration — the publish order is ' +
        "unverifiable from the workflow",
    );
  }

  // The barrier is part of the mechanism: a release that does not rehearse before the
  // loop is exactly the first contact #313 is about (fresh-pass F2).
  const barrier = steps
    .map((step, index) => ({ index, step }))
    .filter(({ step }) => {
      const body = step.body
        .split("\n")
        .filter((line) => !/^\s*-\s*name:/.test(line) && !line.trim().startsWith("#"))
        .join("\n");
      return body.includes("scripts/release-rehearsal/check.mjs");
    });
  if (barrier.length !== 1) {
    violations.push(
      `E-REHEARSAL: expected exactly one step invoking \`scripts/release-rehearsal/check.mjs\` ` +
        `before the cohort (the pre-publish barrier), found ${barrier.length}`,
    );
  } else if (barrier[0].index > steps.indexOf(cohortStep)) {
    violations.push(
      "E-REHEARSAL: the rehearsal barrier runs AFTER the seam-cohort step — the release would " +
        "publish before rehearsing",
    );
  }

  let cliPublish;
  try {
    cliPublish = findStep(steps, "Publish");
  } catch (error) {
    if (error instanceof GateError) {
      violations.push(`E-REHEARSAL: release.yml: ${error.message}`);
      return { violations, order: null };
    }
    throw error;
  }
  if (steps.indexOf(cohortStep) > steps.indexOf(cliPublish)) {
    violations.push(
      "E-REHEARSAL: the CLI `Publish` step runs before the seam-cohort step — the CLI would " +
        "publish before the seam it bundles from is on the registry",
    );
  }
  return { violations, order: order ? order[1].trim().split(/\s+/).filter(Boolean) : null };
}

/** Resolve the repo URL the workflow runs in, or null when it cannot be determined. */
export function expectedRepositoryUrl(root, env = process.env) {
  if (env.GITHUB_REPOSITORY) return `git+https://github.com/${env.GITHUB_REPOSITORY}.git`;
  const res = spawnSync("git", ["-C", root, "config", "--get", "remote.origin.url"], {
    encoding: "utf8",
  });
  const url = `${res.stdout ?? ""}`.trim();
  const match =
    url.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/) ??
    url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? `git+https://github.com/${match[1]}.git` : null;
}

/** Pack one cohort member with pnpm into `destination`; return the tarball path. */
function pack(dir, destination) {
  const res = spawnSync("pnpm", ["pack", "--pack-destination", destination], {
    cwd: dir,
    encoding: "utf8",
  });
  if (res.error) throw new GateError(`cannot run pnpm pack in ${dir}: ${res.error.message}`);
  if (res.status !== 0) {
    throw new GateError(
      `\`pnpm pack\` failed in ${dir} (exit ${res.status}): ${`${res.stderr ?? ""}`.trim()}`,
    );
  }
  const tarballs = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new GateError(
      `expected exactly one tarball in ${destination} after packing ${dir}, found ` +
        `${tarballs.length} (${tarballs.join(", ") || "none"})`,
    );
  }
  return { file: path.join(destination, tarballs[0]), name: tarballs[0] };
}

/** Read the tarball's file list and its `package/package.json`. */
function readTarball(file) {
  const list = spawnSync("tar", ["-tzf", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (list.status !== 0) {
    throw new GateError(`cannot list ${file}: ${`${list.stderr ?? ""}`.trim()}`);
  }
  const entries = `${list.stdout ?? ""}`.split("\n").filter(Boolean);
  const manifest = spawnSync("tar", ["-xzOf", file, "package/package.json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (manifest.status !== 0) {
    throw new GateError(
      `cannot read package/package.json from ${file}: ${`${manifest.stderr ?? ""}`.trim()}`,
    );
  }
  let shipped;
  try {
    shipped = JSON.parse(manifest.stdout);
  } catch (error) {
    throw new GateError(`unparseable package.json inside ${file}: ${error.message}`);
  }
  return { entries, shipped, bytes: readFileSync(file) };
}

/**
 * Run the rehearsal against a workspace root. Returns `{ status, messages, receipt }`
 * — the verdict the self-test and the CLI share. `options.pack` is the seam for the
 * self-test (it can substitute a packer that fails); the CLI never passes it.
 */
export async function check(root, options = {}) {
  const context = [`release rehearsal — workspace: ${path.resolve(root)}`, "publishes: nothing"];
  const violations = [];
  const receipt = [];
  let temp;
  try {
    let workspace;
    try {
      workspace = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    } catch (error) {
      throw new GateError(`unreadable pnpm-workspace.yaml: ${error.message}`);
    }
    let globs;
    try {
      globs = parseWorkspaceGlobs(workspace);
    } catch (error) {
      throw new GateError(`pnpm-workspace.yaml: ${error.message}`);
    }
    const members = new Set(
      (await Promise.all(globs.map((glob) => expandGlob(root, glob))))
        .flat()
        .map((dir) => path.relative(root, dir).split(path.sep).join("/")),
    );
    const workspaceNames = new Set();
    const workspacePackages = [];
    for (const member of members) {
      const memberManifest = readManifestFile(path.join(root, member, "package.json"));
      if (typeof memberManifest.name === "string") workspaceNames.add(memberManifest.name);
      workspacePackages.push({ dir: member, manifest: memberManifest });
    }
    violations.push(...uncoveredPublishables(workspacePackages));
    for (const dir of SEAM_DIRS) {
      if (!members.has(dir)) {
        violations.push(
          `E-REHEARSAL: ${dir} is a member of the publish cohort but not of the workspace ` +
            "(`pnpm-workspace.yaml` globs) — it cannot be published from the release job",
        );
      }
    }
    const packages = SEAM_DIRS.map((dir) => ({
      dir,
      manifest: readManifestFile(path.join(root, dir, "package.json")),
    }));
    const cohortVersions = new Map(
      packages
        .filter(({ manifest }) => typeof manifest.name === "string")
        .map(({ manifest }) => [manifest.name, manifest.version]),
    );
    for (const { dir, manifest } of packages) {
      if (manifest.private === true) {
        violations.push(
          `E-REHEARSAL: ${dir}: the SOURCE manifest is "private": true — the cohort cannot publish (#259)`,
        );
      }
      if (!manifest.name?.startsWith("@profile-as-code/")) {
        violations.push(
          `E-REHEARSAL: ${dir}: package name ${JSON.stringify(manifest.name)} is not in the ` +
            "`@profile-as-code/` scope",
        );
      }
    }

    const workflowPath = path.join(root, ".github/workflows/release.yml");
    let workflow;
    try {
      workflow = readFileSync(workflowPath, "utf8");
    } catch (error) {
      throw new GateError(`unreadable ${workflowPath}: ${error.message}`);
    }
    violations.push(...runtimeDependencyViolations(packages, workspaceNames));
    const mechanism = workflowViolations(workflow);
    violations.push(...mechanism.violations);
    if (mechanism.order) {
      violations.push(...orderViolations(mechanism.order, packages));
      context.push(`publish ORDER (release.yml): ${mechanism.order.join(" → ")}`);
    }

    const expectedRepoUrl =
      "repositoryUrl" in options ? options.repositoryUrl : expectedRepositoryUrl(root);
    context.push(
      expectedRepoUrl === null
        ? "repository.url match: SKIPPED (no GITHUB_REPOSITORY and no parseable origin remote)"
        : `repository.url expected: ${expectedRepoUrl}`,
    );

    temp = mkdtempSync(path.join(os.tmpdir(), "release-rehearsal-"));
    for (const { dir, manifest } of packages) {
      const destination = path.join(temp, dir.replace(/^packages\//, ""));
      mkdirSync(destination, { recursive: true });
      const packed = (options.pack ?? pack)(path.join(root, dir), destination);
      const { entries, shipped, bytes } = readTarball(packed.file);
      violations.push(
        ...manifestViolations({
          dir,
          source: manifest,
          shipped,
          entries,
          expectedRepoUrl,
          cohortVersions,
        }),
      );
      const runtimeDeps = Object.fromEntries(
        Object.entries(shipped.dependencies ?? {}).filter(([, value]) => typeof value === "string"),
      );
      receipt.push({
        dir,
        name: shipped.name,
        version: shipped.version,
        tarball: packed.name,
        bytes: bytes.length,
        sha256: sha256(bytes),
        dependencies: runtimeDeps,
        files: entries.length,
      });
    }
  } catch (error) {
    if (error instanceof GateError) {
      violations.push(`E-REHEARSAL: ${error.message}`);
    } else {
      throw error;
    }
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }

  const unverifiable = [
    "NOT CHECKED (needs a real publish): the OIDC exchange against npm's trusted-publisher",
    "binding, whether a version is already live (npm skips, cannot republish), and",
    "`dist.attestations`. Those are #313's open evidence; the operator's release run closes them.",
  ];
  if (violations.length > 0) {
    return { status: "fail", messages: [...context, ...violations, ...unverifiable], receipt };
  }
  return {
    status: "pass",
    messages: [
      ...context,
      ...receipt.map(
        (entry) =>
          `${entry.name}@${entry.version} — ${entry.tarball} (${entry.bytes} B, ` +
          `sha256 ${entry.sha256.slice(0, 12)}…, ${entry.files} files, deps: ` +
          `${JSON.stringify(entry.dependencies)})`,
      ),
      ...unverifiable,
    ],
    receipt,
  };
}

function usage() {
  console.log(
    [
      "usage: node scripts/release-rehearsal/check.mjs [--root DIR]",
      "",
      "Packs the five seam packages with `pnpm pack` and asserts the publish ORDER",
      "(release.yml), the packed manifests (name/version/public access, workspace:*",
      "rewrite, resolvable entrypoints) and the workflow mechanism (pnpm publish,",
      "OIDC permission, cohort before CLI). Publishes nothing, offline, deterministic.",
    ].join("\n"),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }
  const rootFlag = args.indexOf("--root");
  const root =
    rootFlag >= 0
      ? path.resolve(args[rootFlag + 1] ?? "")
      : fileURLToPath(new URL("../../", import.meta.url));
  const result = await check(root);
  for (const message of result.messages) console.log(message);
  console.log(`release rehearsal: ${result.status.toUpperCase()}`);
  process.exit(result.status === "pass" ? 0 : 1);
}

/**
 * Direct-execution guard (the dep-gate/publishable-gate convention): `import.meta.url`
 * is the module's realpath, `argv[1]` may cross a symlink, so realpath it first or
 * the CLI silently no-ops with exit 0.
 */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // unresolvable path — compare as-is rather than fail closed on a probe
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isMain()) {
  await main();
}
