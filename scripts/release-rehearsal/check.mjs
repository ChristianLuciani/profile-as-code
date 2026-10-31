#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
/**
 * release-rehearsal — the seam-cohort publish is rehearsed before it is irreversible (#313).
 *
 * The five seam packages (`packages/{core,markdown,paste,artifact,github}`) publish
 * from `.github/workflows/release.yml` as a loop of `pnpm publish`, in dependency
 * order, `core` first. That loop has existed since #301 but had never published a
 * member (#313): in the `v0.3.6` run, attempt 1 died at the OIDC exchange before
 * publishing anything and attempt 2 logged five skips because every seam version was
 * already live (published outside the workflow at 02:38–02:39Z). So the first real
 * cohort publish — a seam version bump, an operator
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
 *      invocation — the live branch AND its `--dry-run` twin — is `pnpm publish`
 *      (only pnpm rewrites `workspace:*`) and requests provenance explicitly with
 *      `--provenance` (#377), the loop iterates `$ORDER`, the rehearsal barrier exists
 *      before the loop, the cohort runs before the CLI's own `Publish` step, every
 *      publishable workspace member is in the cohort, and each manifest's
 *      `repository.url` matches the repo the workflow runs in (npm fails the
 *      publish on a mismatch). The flag is asserted on every invocation because a
 *      whole-body substring match would be satisfied by the branch that never
 *      publishes (the #301 F1 class).
 *
 * What it CANNOT prove, and says so in its own output: the OIDC exchange against
 * npm's trusted-publisher binding, the registry state (a live version is skipped,
 * not republished), and `dist.attestations`. Those exist only after a real publish.
 * The acceptance #377 declares is therefore narrower than "attested": the mechanism
 * REQUESTS provenance and this gate proves the request — the first release event
 * that publishes a seam member must record a `dist.attestations` entry for each one
 * it publishes, with the tag and date, in docs/ci-cd.md. A dry run is not that
 * evidence (release.yml deliberately does not validate publish auth).
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
 * The jobs of the workflow, with their line range and `needs:`. Job-level keys sit
 * at two spaces; everything at zero indent is workflow-level (`name`, `on`,
 * `permissions`, `concurrency`). A step belongs to the job whose range contains it
 * — the barrier's JOB matters, not only its position in a flat step list (a barrier
 * moved into a previous job without `needs:` still precedes in a flat index while
 * the publish job goes live unrehearsed).
 */
export function parseJobs(yaml) {
  const lines = yaml.split("\n");
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt < 0) return [];
  const jobs = [];
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^ {2}(['"]?)([A-Za-z0-9_.-]+)\1\s*:\s*$/);
    if (match) jobs.push({ index: i, name: match[2], start: i, end: lines.length, needs: [] });
  }
  for (let i = 0; i < jobs.length; i += 1) {
    if (i + 1 < jobs.length) jobs[i].end = jobs[i + 1].index;
    const block = lines.slice(jobs[i].start, jobs[i].end);
    const needsAt = block.findIndex((line) => /^ {4}needs\s*:/.test(line));
    if (needsAt < 0) continue;
    const inline = block[needsAt].match(/^ {4}needs\s*:\s*(.+)$/);
    if (inline) {
      jobs[i].needs = inline[1]
        .replace(/^\[/, "")
        .replace(/\]\s*$/, "")
        .split(",")
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else {
      for (let j = needsAt + 1; j < block.length; j += 1) {
        const item = block[j].match(/^ {6}- ([A-Za-z0-9_.-]+)\s*$/);
        if (!item) break;
        jobs[i].needs.push(item[1]);
      }
    }
  }
  return jobs;
}

/**
 * Split `.github/workflows/release.yml` into named steps (6-space `- ` items) so the
 * mechanism assertions read a step, not a line window. Steps without a `name:` are
 * kept (their `uses:` is the identity) and never match a name lookup. Each step
 * carries the `job:` it belongs to (null outside `jobs:`).
 */
export function parseSteps(yaml) {
  const lines = yaml.split("\n");
  const jobs = parseJobs(yaml);
  const jobAt = (lineIndex) => {
    const owner = jobs.find((job) => lineIndex > job.index && lineIndex < job.end);
    return owner ? owner.name : null;
  };
  const steps = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {6}- /.test(line)) {
      current = { name: null, job: jobAt(i), lines: [line] };
      steps.push(current);
      const name = line.match(/^ {6}- name\s*:\s*(.+)$/);
      if (name) current.name = name[1].trim().replace(/^['"]|['"]$/g, "");
    } else if (current) {
      current.lines.push(line);
    }
  }
  return steps.map((step) => ({ name: step.name, job: step.job, body: step.lines.join("\n") }));
}

/**
 * The shell commands a step runs, each with the operator that introduces it
 * (`start`, `;`, `&&`, `||`). Reads the step's `run:` value only — inline, the
 * compact `- run: …` form, or a block scalar — drops comment lines and splits on
 * `&&`/`||`/`;`, keeping the operator. `env:`, `with:` and YAML comments never
 * yield a command: matching the script path anywhere in the step text let an
 * `echo "<path>"` pass as a barrier (F2b), and discarding the operator let
 * `cmd || node <path>` pass as unconditional (F2, fourth pass).
 */
export function runSegments(body) {
  const lines = body.split("\n");
  const collected = [];
  for (let i = 0; i < lines.length; i += 1) {
    // The key must sit at the STEP indentation (8 spaces, or 6 + `- ` for the
    // compact form). Anchoring at 8 also keeps a literal `run: …` line inside a
    // block scalar/heredoc from being read as a key (F2, fourth pass).
    const inline = lines[i].match(/^( {6}- | {8})run\s*:\s*(.*)$/);
    if (!inline) continue;
    const value = inline[2].trim();
    if (value && !/^[|>][+-]?\s*(?:#.*)?$/.test(value)) {
      collected.push(value);
      continue;
    }
    const runIndent = inline[1].length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === "") continue;
      const indent = lines[j].match(/^ */)[0].length;
      if (indent <= runIndent) break;
      collected.push(lines[j]);
    }
  }
  const segments = [];
  let lineStart = "start";
  for (const raw of collected) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const pieces = line.split(/(\|\||&&|;)/);
    let pending = lineStart;
    for (const piece of pieces) {
      if (piece === "||" || piece === "&&" || piece === ";") {
        pending = piece;
        continue;
      }
      const command = piece.trim();
      if (!command) continue;
      segments.push({ operator: pending, command });
      pending = ";";
    }
    lineStart = ";";
  }
  return segments;
}

/**
 * The shell commands of a step in order, without their operators (`runSegments`
 * keeps them). Both are exported because the mention/invocation checks only need
 * the text, while the execution check needs to know whether the barrier is
 * conditional (`cmd || node <path>` skips the barrier when `cmd` succeeds — F2).
 */
export function runCommands(body) {
  return runSegments(body).map((segment) => segment.command);
}

/** Whether one shell segment is `node <scriptPath>` (leading `VAR=value` allowed). */
function isNodeScript(segment, scriptPath) {
  const tokens = segment
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/^['"]|['"]$/g, ""));
  let at = 0;
  while (at < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[at])) at += 1;
  return tokens[at] === "node" && tokens[at + 1] === scriptPath;
}

/** Whether a step's `run:` mentions `node <scriptPath>` at all (any position). */
export function invokesScript(commands, scriptPath) {
  return commands.some((command) => isNodeScript(command, scriptPath));
}

/** Blank out single-/double-quoted spans and escapes so operators can be found. */
function stripQuotes(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      out += " ";
    } else if (char === '"' || char === "'") {
      quote = char;
      out += " ";
    } else if (char === "\\") {
      out += " ";
      i += 1;
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * The operators that discard or transform a command's exit status in POSIX shell:
 * a single `|` (the pipeline status is the LAST command's), `|&`, and a background
 * `&`. Redirections (`>&`, `&>`), `&&`, `||` and quoted text are not included —
 * `&&`/`||`/`;` are handled by `runCommands` splitting, not here.
 */
export function statusDiscardingOperators(script) {
  const text = stripQuotes(script);
  const operators = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "|") {
      if (text[i + 1] === "|") {
        i += 1;
        continue;
      }
      if (text[i + 1] === "&") {
        operators.push("|&");
        i += 1;
        continue;
      }
      operators.push("|");
    } else if (char === "&") {
      if (text[i + 1] === "&" || text[i + 1] === ">") {
        i += 1;
        continue;
      }
      if (i > 0 && (text[i - 1] === ">" || text[i - 1] === "<")) continue;
      operators.push("&");
    }
  }
  return operators;
}

/**
 * Whether the step runs the rehearsal as its LAST effective command, with the exit
 * code kept. `commands` are the step's shell segments in order (`runCommands`): the
 * final one must be `node <scriptPath>`, it must not be piped or backgrounded (a
 * `| tee` or a `&` discards the status — `bash -e -c 'false | cat'` exits 0), and no
 * segment may disable errexit (`set +e`). A trailing `|| true` / `; true`, any
 * command after the barrier, a pipe/background on it, or a `set +e` before it
 * discards the failure the gate exists to propagate (F3, third pass).
 */
export function executesScript(commands, scriptPath) {
  const segments = commands.map((entry) =>
    typeof entry === "string" ? { operator: "start", command: entry } : entry,
  );
  if (segments.length === 0) return false;
  if (segments.some(({ command }) => /^set\s+\+/.test(command.trim()))) return false;
  const last = segments[segments.length - 1];
  if (!isNodeScript(last.command, scriptPath)) return false;
  // It must run UNCONDITIONALLY: `cmd || node <path>` skips the barrier when `cmd`
  // succeeds, and `cmd && node <path>` only runs it on success (F2, fourth pass).
  if (last.operator === "||" || last.operator === "&&") return false;
  return statusDiscardingOperators(last.command).length === 0;
}

/**
 * A YAML/expression value normalized once: trailing comment, quotes, a `${{ }}`
 * wrapper and case are all removed. Used by `staticallyTrue`; a value that must be
 * PROVABLE (`literallyFalse`) is deliberately not normalized this way.
 */
function normalizedValue(raw) {
  return raw
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^\$\{\{\s*/, "")
    .replace(/\s*\}\}$/, "")
    .trim();
}

/**
 * Whether a YAML/expression value is statically `true`: the literal in any case,
 * quoted, inside a `${{ }}` expression, or followed by a YAML comment. The step
 * swallow check matched only a bare `true` at end of line, so `${{ true }}`,
 * `TRUE` and `true # comment` passed (F2).
 */
export function staticallyTrue(raw) {
  return normalizedValue(raw).toLowerCase() === "true";
}

/**
 * The key as it may appear in YAML: bare, double-quoted or single-quoted. All three
 * name the SAME key, so a lexical gate that only matched the bare spelling resolved
 * `"if": false` as ABSENT and let it through (F1 of the #364 round-2 pass) — an
 * unreadable form must be DENIED, never defaulted, the rule this gate already applies
 * to `permissions:`.
 */
function keyPattern(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(?:${escaped}|"${escaped}"|'${escaped}')`;
}

/** A step-level setting value (`continue-on-error`, `if`), or null when absent. */
function stepSetting(body, key) {
  const pattern = keyPattern(key);
  for (const line of body.split("\n")) {
    // The value group is `.*`, not `.+`: a bare `if:` (empty) still COUNTS as present.
    const match =
      line.match(new RegExp(`^ {6}- ${pattern}\\s*:\\s*(.*)$`)) ??
      line.match(new RegExp(`^ {8}${pattern}\\s*:\\s*(.*)$`));
    if (match) return match[1].trim();
  }
  return null;
}

/** A job-level setting value (`continue-on-error`, `if`), or null when absent. */
export function jobSetting(yaml, name, key) {
  const lines = yaml.split("\n");
  const job = parseJobs(yaml).find((entry) => entry.name === name);
  if (!job) return null;
  const pattern = keyPattern(key);
  for (let i = job.start + 1; i < job.end; i += 1) {
    const match = lines[i].match(new RegExp(`^ {4}${pattern}\\s*:\\s*(.*)$`));
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Whether a `continue-on-error` value is literally boolean `false`: the only
 * spelling a lexical gate can PROVE does not swallow a failure (#364, option 1).
 * Unlike `staticallyTrue` this deliberately does not unwrap `${{ }}` or quotes: an
 * expression (`${{ inputs.soft }}`) or a quoted string is not literally false, so
 * the barrier refuses it instead of assuming a runtime result it cannot evaluate.
 */
export function literallyFalse(raw) {
  return /^false\s*(?:#.*)?$/i.test(raw.trim());
}

/** The step's `if:` condition, or null. Step keys sit at 6 spaces (`- if:`) or 8. */
export function stepCondition(body) {
  return stepSetting(body, "if");
}

/** Every job the named job transitively `needs:` (empty when it needs nothing). */
export function jobAncestors(jobs, name) {
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const seen = new Set();
  const stack = [...(byName.get(name)?.needs ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(byName.get(current)?.needs ?? []));
  }
  return seen;
}

/** The job-level `if:` of a named job (4-space key), or null when it has none. */
export function jobCondition(yaml, name) {
  return jobSetting(yaml, name, "if");
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

/**
 * The shell CODE of a line: everything before a `#` that starts a comment. A `#`
 * inside quotes is text (`echo "# --provenance"`), and the shell itself treats a
 * `#` as a comment only at the start of a word — the same rule here, so a flag
 * written in a trailing comment can never satisfy an assertion the command does
 * not carry (F1 of the #377 round-2 pass).
 */
export function stripShellComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"') i += 1;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/** A publish invocation found in a step body: `pnpm publish` / `npm publish`. */
export function publishInvocations(body) {
  const invocations = [];
  for (const raw of body.split("\n")) {
    const line = stripShellComment(raw).trim();
    // Comments in the step must not be able to satisfy the assertion.
    if (line === "") continue;
    const re = /(^|[^\w-])(pnpm|npm)\s+publish\b/g;
    let match = re.exec(line);
    while (match !== null) {
      invocations.push({ client: match[2], dryRun: line.includes("--dry-run"), line });
      match = re.exec(line);
    }
  }
  return invocations;
}

/**
 * Whether a publish invocation REQUESTS provenance (`--provenance`). The request is
 * what an offline gate can prove: pnpm's implicit path (`options.provenance` unset)
 * only attests after a best-effort visibility probe and degrades to a warning, so
 * the absence of the flag is not a safe default (#377). `--no-provenance` and
 * `--provenance=false` do NOT count — a lexical gate that matched the substring
 * would accept the negation.
 */
export function provenanceRequested(line) {
  // The value stops at shell punctuation (`)`, `;`), so `--provenance=false)` is `false`,
  // not the unrecognized `false)` that a `\S+` capture would let pass as a request.
  // The LAST flag wins: pnpm's option parser (@pnpm/nopt, verified on the pinned
  // 11.20.0) overwrites as it reads, so `--provenance --no-provenance` publishes
  // WITHOUT provenance — a first-match gate read that as a request (F2 of the
  // #377 round-2 pass).
  let requested = false;
  for (const match of line.matchAll(
    /(?:^|\s)(--provenance|--no-provenance)(?:=([A-Za-z0-9]+))?/g,
  )) {
    if (match[1] === "--no-provenance") requested = false;
    else requested = match[2] === undefined || !/^(?:false|0)$/i.test(match[2]);
  }
  return requested;
}

/** The `publish` job's line range, or null when the job (or `jobs:`) is absent. */
function jobBlock(lines, name) {
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt < 0) return null;
  let start = -1;
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    if (new RegExp(`^ {2}${name}\\s*:\\s*$`).test(lines[i])) {
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

/**
 * The `permissions:` override at `indent`, in the three single-key spellings this
 * gate reads: block (`permissions:` + `key: value` lines), flow (`permissions: {…}`
 * on one line), and scalar (`permissions: read-all` / `write-all`). Returns null
 * when no `permissions:` is declared at that indent.
 *
 * A `permissions` KEY at that indent that does not match one of those shapes — a
 * flow mapping split across lines, a YAML anchor/alias, anything else — is returned
 * as `{style: "unreadable"}` and DENIED by the caller. Falling back to the workflow
 * default there was the worst failure of the gate: it asserted the top-level grant
 * while the job had replaced it (F1, fourth pass).
 *
 * Every pattern is anchored on the SAME indent as the block form. An unanchored
 * `/^permissions:/` matched only column 0, so a job-level override fell through to
 * the workflow default — first for flow style (F4b), then the scalar spellings (F1),
 * then any shape the gate could not read (F1, pass 4).
 */
function permissionOverride(lines, from, to, indent) {
  const pad = " ".repeat(indent);
  const keyLine = new RegExp(`^${pad}permissions\\s*:(.*)$`);
  for (let i = from; i < to; i += 1) {
    const key = lines[i].match(keyLine);
    if (!key) continue;
    const rest = key[1].replace(/\s+#.*$/, "").trim();
    if (rest === "") {
      const entries = [];
      for (let j = i + 1; j < to; j += 1) {
        if (!lines[j].startsWith(`${pad}  `)) break;
        const text = lines[j].trim().replace(/\s+#.*$/, "");
        if (text && !text.startsWith("#")) entries.push(text);
      }
      return { style: "block", entries };
    }
    const flow = rest.match(/^\{(.*)\}$/);
    if (flow) {
      return {
        style: "flow",
        entries: flow[1]
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      };
    }
    if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(rest)) return { style: "scalar", scalar: rest };
    return { style: "unreadable", raw: rest };
  }
  return null;
}

/**
 * Whether an override grants OIDC. `write-all` sets every available scope to write
 * (`id-token` included); `read-all` cannot grant it (`id-token` has no read value);
 * an unreadable shape or an unrecognized scalar fails closed, naming what could not
 * be read ([OFICIAL] GitHub Docs, workflow syntax §permissions, checked 2026-10-29).
 */
function overrideGrant(override) {
  if (override.style === "unreadable") {
    return { granted: false, note: `unreadable \`permissions:\` ${JSON.stringify(override.raw)}` };
  }
  if (override.style === "scalar") {
    if (override.scalar === "write-all") return { granted: true };
    if (override.scalar === "read-all") return { granted: false };
    return { granted: false, note: `unrecognized scalar \`${override.scalar}\`` };
  }
  // `id-token : write` / `id-token:  write` are the same grant as `id-token: write`.
  const grants = override.entries.some((entry) => {
    const pair = entry.match(/^([^:]+?)\s*:\s*(.+)$/);
    return pair !== null && pair[1].trim() === "id-token" && pair[2].trim() === "write";
  });
  return { granted: grants };
}

/** The `{granted, scope}` verdict for one effective `permissions:` override. */
function permissionVerdict(override, base) {
  const grant = overrideGrant(override);
  const detail = grant.note ?? (override.style === "scalar" ? `\`${override.scalar}\`` : null);
  return { granted: grant.granted, scope: detail ? `${base} (${detail})` : base };
}

/**
 * Whether the `publish` job can exchange an OIDC token: its own `permissions:` when
 * declared (a job-level block REPLACES the workflow default), the top-level block
 * otherwise. Block, flow and scalar spellings are all read at the job's own indent;
 * a comment, or another job's permission, never satisfies it (fresh-pass F4/F4b/F1).
 */
export function idTokenGranted(yaml) {
  const lines = yaml.split("\n");
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt < 0) return { granted: false, scope: "no jobs: block" };
  const job = jobBlock(lines, "publish");
  if (!job) return { granted: false, scope: "no publish job" };
  const jobOverride = permissionOverride(lines, job.start, job.end, 4);
  if (jobOverride !== null) return permissionVerdict(jobOverride, "publish job permissions");
  const topOverride = permissionOverride(lines, 0, jobsAt, 0);
  if (topOverride === null) return { granted: false, scope: "no permissions block" };
  return permissionVerdict(topOverride, "top-level permissions");
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
  // Both branches: the `--dry-run` one must exercise the SAME invocation the live
  // one runs, or the rehearsal vets a command that never publishes (#377 round 2).
  for (const invocation of invocations) {
    if (invocation.client === "pnpm") continue;
    violations.push(
      `E-REHEARSAL: the cohort step publishes with \`${invocation.client} publish\` ` +
        `(${invocation.dryRun ? "`--dry-run` " : "live "}branch): ${JSON.stringify(invocation.line)} — ` +
        "`npm publish` does not rewrite `workspace:*`, so the published manifests would be uninstallable (#301)",
    );
  }
  // Provenance is asserted per invocation, on BOTH branches (#377): the live one is
  // what the registry sees, the `--dry-run` one must exercise the same invocation.
  // A whole-body substring match would be satisfied by the branch that never publishes.
  for (const invocation of invocations) {
    if (provenanceRequested(invocation.line)) continue;
    violations.push(
      `E-REHEARSAL: the cohort step's ${invocation.dryRun ? "`--dry-run` " : "live "}` +
        `publish invocation does not request provenance: ${JSON.stringify(invocation.line)} — ` +
        "pnpm's implicit path attests only after a best-effort visibility probe and degrades " +
        "to a warning, so an unattested member is indistinguishable from one built elsewhere " +
        "(#377); add `--provenance`",
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
  // loop is exactly the first contact #313 is about (fresh-pass F2). A text match let
  // several non-barriers through, all closed here (F2b/F3):
  //   - `run: echo "<path>"` mentions the script without executing it;
  //   - the exit code is discarded — `node <path> || true`, a `set +e`, or another
  //     command after the barrier, so a failing rehearsal does not stop the publish;
  //   - any `if:` on the barrier step, or on the job that hosts it, keeps the step
  //     from running — a constant OR a `${{ }}` expression the gate cannot evaluate;
  //   - `continue-on-error` on the barrier step or its job swallows the failure —
  //     only an absent key or the literal `false` is provable (#364, fail closed on
  //     the form: presence is refused, never evaluated);
  //   - a barrier moved into a prior job WITHOUT `needs:` still precedes in a flat
  //     step index while the publish job goes live unrehearsed.
  const BARRIER = "scripts/release-rehearsal/check.mjs";
  // Three widening sets: steps that MENTION the path anywhere in a command, steps
  // that INVOKE `node <path>`, and the one that executes it as the last effective
  // command with the exit code kept. The first two exist so a near-miss names its
  // own reason instead of collapsing into "found 0" (F2b/F3).
  const barrierCandidates = steps
    .map((step, index) => {
      const segments = runSegments(step.body);
      return { index, step, segments, commands: segments.map((entry) => entry.command) };
    })
    .filter(({ commands }) => commands.some((command) => command.includes(BARRIER)));
  const invoking = barrierCandidates.filter(({ commands }) => invokesScript(commands, BARRIER));
  const executing = barrierCandidates.filter(({ segments }) => executesScript(segments, BARRIER));
  for (const { index, step } of barrierCandidates.filter((entry) => !invoking.includes(entry))) {
    const label = step.name ? ` (${JSON.stringify(step.name)})` : "";
    violations.push(
      `E-REHEARSAL: step ${index + 1}${label} mentions \`${BARRIER}\` but does not EXECUTE it — ` +
        `not a \`run:\` of \`node ${BARRIER}\`, so the publish would not be rehearsed`,
    );
  }
  for (const { index, step } of invoking.filter((entry) => !executing.includes(entry))) {
    const label = step.name ? ` (${JSON.stringify(step.name)})` : "";
    violations.push(
      `E-REHEARSAL: step ${index + 1}${label} runs \`node ${BARRIER}\` but not as its last ` +
        "effective command with the exit code kept — a trailing `|| true`/`;`, a command after " +
        "it, or a `set +e` swallows the failure the gate must propagate (F3)",
    );
  }
  if (executing.length !== 1) {
    violations.push(
      `E-REHEARSAL: expected exactly one step EXECUTING \`${BARRIER}\` before the cohort ` +
        `(the pre-publish barrier), found ${executing.length}`,
    );
  } else {
    const { index, step } = executing[0];
    // Fail closed on the FORM (#364, option 1): a lexical reader cannot evaluate an
    // Actions expression, so ANY `if:` on the barrier — constant or expression,
    // step or job — is refused instead of assumed harmless. Same for
    // `continue-on-error`: only an absent key or literally `false` is provable.
    const condition = stepCondition(step.body);
    if (condition !== null) {
      violations.push(
        "E-REHEARSAL: the rehearsal barrier has an `if:` condition " +
          `(${JSON.stringify(condition)}) — a lexical gate cannot evaluate it, so any ` +
          "`if:` on the barrier is refused (fail closed on the form, #364): the step " +
          "may never run",
      );
    }
    const stepSwallow = stepSetting(step.body, "continue-on-error");
    if (stepSwallow !== null && !literallyFalse(stepSwallow)) {
      violations.push(
        "E-REHEARSAL: the rehearsal barrier has `continue-on-error: " +
          `${stepSwallow}\` — only an absent key or literally \`false\` proves the failure ` +
          "is not swallowed (fail closed on the form, #364)",
      );
    }
    if (step.job === "publish") {
      if (index > steps.indexOf(cohortStep)) {
        violations.push(
          "E-REHEARSAL: the rehearsal barrier runs AFTER the seam-cohort step — the release " +
            "would publish before rehearsing",
        );
      }
    } else if (step.job === null || !jobAncestors(parseJobs(yaml), "publish").has(step.job)) {
      const where = step.job === null ? "no job" : `job "${step.job}"`;
      violations.push(
        `E-REHEARSAL: the rehearsal barrier sits in ${where}, which the \`publish\` job does not ` +
          "`needs:` — the publish job can start before the rehearsal finishes, so the gate is " +
          "decorative",
      );
    }
    // The hosting job's own settings gate the barrier wherever it sits — including
    // the `publish` job itself, the shape the #364 repro mutates.
    if (step.job !== null) {
      const jobIf = jobCondition(yaml, step.job);
      if (jobIf !== null) {
        violations.push(
          `E-REHEARSAL: the barrier job "${step.job}" has an \`if:\` condition ` +
            `(${JSON.stringify(jobIf)}) — a lexical gate cannot evaluate it, so any ` +
            "`if:` on the barrier is refused (fail closed on the form, #364): the " +
            "rehearsal may never run",
        );
      }
      const jobSwallow = jobSetting(yaml, step.job, "continue-on-error");
      if (jobSwallow !== null && !literallyFalse(jobSwallow)) {
        violations.push(
          `E-REHEARSAL: the barrier job "${step.job}" has \`continue-on-error: ` +
            `${jobSwallow}\` — only an absent key or literally \`false\` proves a failing ` +
            "rehearsal would stop the publish it gates (fail closed on the form, #364)",
        );
      }
    }
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
    "`dist.attestations`. This gate proves the cohort step REQUESTS provenance",
    "(`--provenance` on both branches, #377); it cannot prove the registry received the",
    "attestation. Acceptance #377: the first release event that publishes a seam member",
    "records `dist.attestations` for each one it publishes, with the tag and date, in",
    "docs/ci-cd.md. Until then the criterion is: the mechanism asks and this gate proves it.",
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
      "rewrite, resolvable entrypoints) and the workflow mechanism (pnpm publish with",
      "an explicit --provenance request, OIDC permission, cohort before CLI). Publishes",
      "nothing, offline, deterministic.",
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
