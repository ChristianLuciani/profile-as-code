#!/usr/bin/env node
/**
 * release — the maintainer's one surface for cutting a release.
 *
 * WHY THIS IS NOT A `pasco` COMMAND. Cutting a release is maintainer work on
 * THIS repository: a tag push that owns the irreversible npm publish, a GitHub
 * Release, and a Pages deploy. `pasco` is the user's tool for a profile
 * workspace; a release command inside it would (a) ship a privileged operation
 * in a package anyone installs, (b) need git/gh/npm credentials on the user's
 * machine, and (c) name private release plumbing on a published surface
 * (AGENTS.md rule 9). The release path is `.github/workflows/release.yml`; this
 * script is the local front desk for it, versioned with the repo so the next
 * session finds it.
 *
 * WHAT IT DOES NOT DO. It never publishes. `cut` creates the tag and pushes it,
 * which is the human's irreversible step (AGENTS.md rule 6: never push to main,
 * the human merges; publishing is the same human gate): the script refuses
 * without `--yes` and prints every command. npm, the Release page and Pages stay
 * the workflow's job, and `verify` reads their result afterwards.
 *
 * The four steps, in order:
 *   check  — preconditions (version, CHANGELOG section, clean tree, HEAD is the
 *            tip, no tag locally or on origin); FETCHES ORIGIN by default,
 *            `--offline` skips the network and says so; exit 1 on any failure.
 *   cut    — runs check, then `git tag` + `git push origin vX.Y.Z` (human-run).
 *   pages  — the documented override that re-deploys the site from a commit
 *            (the tag run deploys from the tag commit; a post-tag docs commit
 *            needs this).
 *   verify — reads the registry, the Release and the live page: the tag
 *            published, with attestations, and the page says this version.
 *            npm processes a publish ASYNCHRONOUSLY ("may take a few minutes")
 *            and the Release and Pages jobs run after it, so a surface that is
 *            not live YET is not a failure: every pending surface shares ONE
 *            retry window of --deadline (default 10 min, #507) — the deadline
 *            is global to the run, never restarted per probe. Exit codes:
 *            0 VERIFIED, 2 PROCESSING (--no-wait: still pending, not failed),
 *            1 NOT VERIFIED — only after the window closes, naming what it
 *            never saw.
 *
 * Zero dependencies, node >=22. `cut --dry-run` and `pages --dry-run` make no
 * network call; `check` fetches origin unless `--offline`; `cut`, `pages` and
 * `verify` call git/gh/network when asked to act.
 *
 * Usage: node scripts/release/release.mjs <check|cut|pages|verify> [options]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { extractReleaseNotes } from "../../packages/cli/scripts/release-notes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CLI_MANIFEST = "packages/cli/package.json";
const CORE_MANIFEST = "packages/core/package.json";
const CHANGELOG = "CHANGELOG.md";
const TAG_RE = /^v(\d+\.\d+\.\d+)$/;

/** A refused operation: the caller asked for something the repo cannot do. */
class Refused extends Error {}

export function semver(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

function run(cmd, args, { root = ROOT, allowFail = false } = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
  if (result.error) {
    // A missing binary is a refusal for an action, but a FAILED CHECK for
    // `verify` (it reports the surfaces it could not read, never a crash).
    if (allowFail) return { status: 127, stdout: "", stderr: result.error.message };
    throw new Refused(`cannot run ${cmd}: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFail) {
    const why = (result.stderr || result.stdout || "").trim().split("\n")[0];
    throw new Refused(`${cmd} ${args.join(" ")} failed (${result.status}): ${why}`);
  }
  return {
    status: result.status ?? -1,
    stdout: (result.stdout ?? "").trim(),
    stderr: result.stderr ?? "",
  };
}

export function gitRead(root, args) {
  return run("git", args, { root }).stdout;
}

function gitMaybe(root, args) {
  return run("git", args, { root, allowFail: true });
}

function readJson(root, relative) {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8"));
}

function readText(root, relative) {
  try {
    return readFileSync(path.join(root, relative), "utf8");
  } catch {
    return null;
  }
}

/** `github.com/owner/name(.git)` from the origin remote — never hardcoded. */
export function repoSlog(root) {
  const url = gitMaybe(root, ["remote", "get-url", "origin"]).stdout;
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match === null) throw new Refused(`origin is not a github.com remote: ${url || "<none>"}`);
  return `${match[1]}/${match[2]}`;
}

/** The CHANGELOG section for one version, or null. It DELEGATES to the extractor
 *  `release.yml` runs before publishing, so the heading pattern has one home:
 *  a section this check accepts but the extractor refuses would publish nothing
 *  (the run dies before the publish) — a false PASS. */
export function changelogSection(text, version) {
  return extractReleaseNotes(text, version);
}

/** A release section needs at least one `### Added|Fixed|…` and one bullet. */
export function sectionIsSubstantive(section) {
  if (section === null) return false;
  const lines = section.split("\n");
  const hasHeading = lines.some((line) => /^### \S/.test(line));
  const hasBullet = lines.some((line) => /^- \S/.test(line));
  return hasHeading && hasBullet;
}

function previousTag(root, currentTag) {
  const tags = gitRead(root, ["tag", "--list", "v*", "--sort=-v:refname"])
    .split("\n")
    .filter((tag) => TAG_RE.test(tag) && tag !== currentTag);
  return tags[0] ?? null;
}

/**
 * The preconditions of a release. Every refusal names the fix.
 *
 * `ref` is what the tag must point at (the workflow guard requires the
 * default-branch tip at push time). By DEFAULT the check fetches origin and
 * reads the remote tip + remote tags: a local-only comparison is exactly how a
 * stale `origin/main` looked green while the remote had moved, and the guard
 * then refuses the tag after it was already pushed. `offline: true` skips the
 * network for fixtures and air-gapped reads and says so in a warning.
 */
export function checkRelease({ root = ROOT, ref = "origin/main", offline = false } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);

  const inside = gitMaybe(root, ["rev-parse", "--git-dir"]);
  if (inside.status !== 0) {
    return {
      errors: [`${root} is not a git repository`],
      warnings,
      version: null,
      commit: null,
      tag: null,
    };
  }

  if (offline) {
    warnings.push(
      "offline — the remote tip and remote tags were not verified (cut never uses this mode)",
    );
  } else {
    const fetched = gitMaybe(root, ["fetch", "--quiet", "--prune", "origin"]);
    if (fetched.status !== 0) {
      fail(
        `cannot verify the remote tip — git fetch origin failed: ${(fetched.stderr || "").trim().split("\n")[0]}`,
      );
    }
  }

  let cli;
  try {
    cli = readJson(root, CLI_MANIFEST);
  } catch (error) {
    return {
      errors: [`cannot read ${CLI_MANIFEST}: ${error.message}`],
      warnings,
      version: null,
      commit: null,
      tag: null,
    };
  }
  const version = cli.version;
  const tag = `v${version}`;
  if (!semver(version)) fail(`${CLI_MANIFEST} version "${version}" is not MAJOR.MINOR.PATCH`);

  // The workflow's tag guard: the tag must BE the default-branch tip.
  const head = gitRead(root, ["rev-parse", "HEAD"]);
  const refCommit = gitMaybe(root, ["rev-parse", `${ref}^{commit}`]);
  if (refCommit.status !== 0) {
    fail(`${ref} does not resolve locally — fetch first (git fetch origin)`);
  } else if (refCommit.stdout !== head) {
    fail(
      `HEAD ${head.slice(0, 7)} is not ${ref} ${refCommit.stdout.slice(0, 7)} — ` +
        "the tag guard refuses a tag that is not the default-branch tip; pull first",
    );
  }

  if (gitRead(root, ["tag", "--list", tag]) !== "") {
    fail(`tag ${tag} already exists locally — a release version is never reused`);
  }
  if (!offline) {
    const remoteTag = gitMaybe(root, [
      "ls-remote",
      "--tags",
      "origin",
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ]);
    if (remoteTag.status !== 0) {
      fail(
        `cannot verify remote tags — git ls-remote failed: ${(remoteTag.stderr || "").trim().split("\n")[0]}`,
      );
    } else if (remoteTag.stdout !== "") {
      fail(`tag ${tag} already exists on origin — a release version is never reused`);
    }
  }

  const dirty = gitRead(root, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty !== "") fail(`working tree is dirty (tracked files):\n${dirty}`);

  const changelog = readText(root, CHANGELOG);
  if (changelog === null) {
    fail(`${CHANGELOG} is missing`);
  } else {
    const section = changelogSection(changelog, version);
    if (section === null)
      fail(
        `${CHANGELOG} has no "## [${version}]" section — the release notes are extracted from it`,
      );
    else if (!sectionIsSubstantive(section))
      fail(`${CHANGELOG} section "## [${version}]" has no ### heading + bullet`);
  }

  let core;
  try {
    core = readJson(root, CORE_MANIFEST);
  } catch (error) {
    fail(`cannot read ${CORE_MANIFEST}: ${error.message}`);
    return { errors, warnings, version, tag, commit: head, coreVersion: null, previous: null };
  }
  if (!semver(core.version))
    fail(`${CORE_MANIFEST} version "${core.version}" is not MAJOR.MINOR.PATCH`);
  const previous = previousTag(root, tag);
  if (previous !== null) {
    const previousCore = gitMaybe(root, ["show", `${previous}:${CORE_MANIFEST}`]);
    if (previousCore.status === 0) {
      try {
        const before = JSON.parse(previousCore.stdout).version;
        if (before === core.version) {
          warnings.push(
            `core stays at ${core.version} (same as ${previous}) — a live version is skipped by the cohort, ` +
              "so bump it only if the seam changed",
          );
        }
      } catch {
        warnings.push(`cannot read ${CORE_MANIFEST} at ${previous}`);
      }
    }
  }

  return { errors, warnings, version, tag, commit: head, coreVersion: core.version, previous };
}

function printCheck(result, { ref }) {
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`release: REFUSED — ${error}`);
    return 1;
  }
  console.log(
    `release: PASS (${result.tag} at ${result.commit.slice(0, 7)}, checked against ${ref})`,
  );
  for (const warning of result.warnings) console.log(`release: NOTE — ${warning}`);
  console.log(`release: next — pnpm release:cut -- --yes`);
  return 0;
}

export function cutPlan(result) {
  return {
    tag: result.tag,
    commit: result.commit,
    commands: [
      ["git", ["tag", result.tag, result.commit]],
      ["git", ["push", "origin", result.tag]],
    ],
  };
}

function afterCut(result) {
  console.log(
    `release: pushed ${result.tag} — the tag run publishes (guard → cohort + CLI → Release → Pages).`,
  );
  console.log(
    "release: watch — gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')",
  );
  console.log(`release: verify — pnpm release:verify`);
}

function cmdCheck(args) {
  const { root, ref, offline } = parse(args, { ref: "origin/main", offline: false });
  return printCheck(checkRelease({ root, ref, offline }), { ref });
}

function cmdCut(args) {
  const options = parse(args, { ref: "origin/main", yes: false, dryRun: false });
  if (options.noPush !== undefined) {
    // A local-only tag looked like a release and left the next `check` refusing
    // "already exists locally": one state, one meaning — the push IS the release.
    throw new Refused(
      "--no-push is not supported — the release path is the push; use --dry-run to inspect the commands",
    );
  }
  if (options.offline === true) {
    throw new Refused("cut verifies origin before pushing — --offline is check-only");
  }
  const result = checkRelease({ root: options.root, ref: options.ref });
  const failed = printCheck(result, { ref: options.ref });
  if (failed !== 0) return failed;

  const plan = cutPlan(result);
  if (options.dryRun) {
    for (const [cmd, argv] of plan.commands) console.log(`${cmd} ${argv.join(" ")}`);
    return 0;
  }
  if (!options.yes) {
    console.error(
      "release: REFUSED — pushing a tag is the irreversible publish step; re-run with --yes",
    );
    return 1;
  }

  run("git", plan.commands[0][1], { root: options.root });
  run("git", plan.commands[1][1], { root: options.root });
  afterCut(result);
  return 0;
}

function cmdPages(args) {
  const options = parse(args, { ref: null, release: null, dryRun: false });
  if (options.ref === null) throw new Refused("pages needs --ref <commit-or-tag>");
  const slug = repoSlog(options.root);
  const argv = [
    "workflow",
    "run",
    "pages.yml",
    "--repo",
    slug,
    "--ref",
    "main",
    "-f",
    `ref=${options.ref}`,
  ];
  if (options.release !== null) argv.push("-f", `release=${options.release}`);
  const shown = `gh ${argv.join(" ")}`;
  if (options.dryRun) {
    console.log(shown);
    return 0;
  }
  run("gh", argv, { root: options.root });
  console.log(`release: dispatched — ${shown}`);
  console.log(
    "release: watch — gh run watch $(gh run list --workflow pages.yml --limit 1 --json databaseId --jq '.[0].databaseId')",
  );
  return 0;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) throw new Refused(`GET ${url} → HTTP ${response.status}`);
  return { status: response.status, body: await response.json() };
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Refused(`GET ${url} → HTTP ${response.status}`);
  return response.text();
}

/** Post-publish verification polls with backoff (#507): a single probe is a
 *  race, not a measurement — the registry, the Release page and the Pages
 *  deploy all land AFTER the publish steps, at different times. A probe that
 *  answers "not there YET" returns `pending` and is retried inside ONE window
 *  shared by the whole run (`startedAt` is the run's clock, never restarted
 *  per probe — otherwise four pending surfaces could wait 4× the deadline);
 *  only when the window closes does a pending probe FAIL, naming what it
 *  never saw. */
export const VERIFY_DEADLINE_MS = 10 * 60_000;
export const VERIFY_INTERVAL_MS = 5_000;
const VERIFY_MAX_INTERVAL_MS = 30_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs one probe until it settles or the shared window closes. A probe
 *  returns `[true | false | "pending", detail]`; `pending` means "not live
 *  yet". `deadlineMs: 0` is a single pass — a pending probe stays pending (the
 *  run reports PROCESSING, it does not fail). */
async function settle(label, probe, { startedAt, deadlineMs, intervalMs, now, sleep, log }) {
  let wait = intervalMs;
  for (;;) {
    let state;
    let detail;
    try {
      [state, detail] = await probe();
    } catch (error) {
      // A rejected fetch mid-window (timeout/5xx) is as transient as a 404:
      // the window exists to wait for the surfaces, so network errors retry
      // too and only FAIL when the window closes without an answer (#507).
      [state, detail] = ["pending", `unreachable: ${error.message}`];
    }
    if (state !== "pending") return [state, detail];
    if (deadlineMs === 0) return ["pending", detail];
    const elapsed = now() - startedAt;
    if (elapsed >= deadlineMs) {
      const what = detail.startsWith("unreachable") ? "never answered" : "never live";
      return [false, `${detail} — ${what} within the ${deadlineMs} ms window`];
    }
    log(`release: WAIT ${label} — ${detail} (${elapsed} of ${deadlineMs} ms window elapsed)`);
    await sleep(Math.min(wait, deadlineMs - elapsed));
    wait = Math.min(wait * 2, VERIFY_MAX_INTERVAL_MS);
  }
}

/** Tri-state: `{exists: true}` · `{exists: false}` (the Release genuinely does
 *  not exist YET — retry) · `{exists: false, error}` (gh itself failed: auth,
 *  network — NOT "not created yet"; the probe turns this into a hard FAIL, it
 *  must not burn the whole window waiting for a Release we cannot read). */
async function defaultReleasePageExists(root, slug, tag) {
  const gh = run("gh", ["release", "view", tag, "--repo", slug, "--json", "tagName"], {
    root,
    allowFail: true,
  });
  if (gh.status === 0) return { exists: true };
  const out = `${gh.stdout}\n${gh.stderr}`;
  if (/not found|no releases|does not exist/i.test(out)) return { exists: false };
  const error = (gh.stderr || gh.stdout || `gh exited ${gh.status}`).trim().split("\n")[0];
  return { exists: false, error };
}

/** a vs b: negative / 0 / positive (MAJOR.MINOR.PATCH). */
function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** Reads the published surfaces. Every surface is ATTEMPTED: one unreachable
 *  URL is a FAIL row, never the end of the report (and a rejected fetch is
 *  caught, not a stack). A surface that is merely not live YET is retried up
 *  to `deadlineMs` (#507). `deps` injects the network/gh/clock surfaces so the
 *  self-test runs offline. Exit: 0 VERIFIED, 2 PROCESSING, 1 NOT VERIFIED. */
export async function verifyRelease({
  root = ROOT,
  version = null,
  deadlineMs = VERIFY_DEADLINE_MS,
  intervalMs = VERIFY_INTERVAL_MS,
  deps = {},
} = {}) {
  const fetchJsonImpl = deps.fetchJson ?? fetchJson;
  const fetchTextImpl = deps.fetchText ?? fetchText;
  const releasePageExists = deps.releasePageExists ?? defaultReleasePageExists;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? ((line) => console.log(line));
  let cli;
  let core;
  try {
    cli = readJson(root, CLI_MANIFEST);
    core = readJson(root, CORE_MANIFEST);
  } catch (error) {
    throw new Refused(`cannot read the release manifests: ${error.message}`);
  }
  const target = version ?? cli.version;
  if (!semver(target)) throw new Refused(`"${target}" is not MAJOR.MINOR.PATCH`);
  const tag = `v${target}`;
  const tagCommit = gitMaybe(root, ["rev-parse", `${tag}^{commit}`]);
  if (tagCommit.status !== 0) throw new Refused(`tag ${tag} does not resolve locally`);

  const checks = [];
  // ONE window for the whole run: the clock starts before the first probe, so
  // a probe that begins late finds the window already (partly) consumed.
  const startedAt = now();
  const record = async (label, probe) => {
    try {
      const [state, detail] = await settle(label, probe, {
        startedAt,
        deadlineMs,
        intervalMs,
        now,
        sleep,
        log,
      });
      checks.push([label, state, detail]);
    } catch (error) {
      checks.push([label, false, `unreachable: ${error.message}`]);
    }
  };

  let cliMeta = { status: 0, body: null };
  await record("npm @profile-as-code/cli", async () => {
    cliMeta = await fetchJsonImpl(`https://registry.npmjs.org/@profile-as-code/cli/${target}`);
    if (cliMeta.status === 200) return [true, `published, gitHead ${cliMeta.body.gitHead ?? "?"}`];
    if (cliMeta.status === 404) return ["pending", "not on the registry yet"];
    return [false, `registry answered HTTP ${cliMeta.status}`];
  });
  if (cliMeta.status === 200) {
    await record("cli gitHead is the tag", async () => [
      cliMeta.body.gitHead === tagCommit.stdout,
      `want ${tagCommit.stdout.slice(0, 7)}`,
    ]);
    await record("cli attestations", async () => [
      Boolean(cliMeta.body.dist?.attestations),
      "dist.attestations present",
    ]);
  }

  let coreMeta = { status: 0, body: null };
  await record("npm @profile-as-code/core", async () => {
    coreMeta = await fetchJsonImpl(
      `https://registry.npmjs.org/@profile-as-code/core/${core.version}`,
    );
    if (coreMeta.status === 200) return [true, `published ${core.version}`];
    if (coreMeta.status === 404) return ["pending", "not on the registry yet"];
    return [false, `registry answered HTTP ${coreMeta.status}`];
  });
  if (coreMeta.status === 200) {
    await record("core attestations", async () => [
      Boolean(coreMeta.body.dist?.attestations),
      "dist.attestations present",
    ]);
  }

  let slug = null;
  await record("origin remote", async () => {
    slug = repoSlog(root);
    return [slug !== null, slug];
  });
  if (slug !== null) {
    await record("GitHub Release", async () => {
      const result = await releasePageExists(root, slug, tag);
      if (result.error !== undefined) return [false, `cannot read the Release: ${result.error}`];
      return result.exists
        ? [true, `${tag} page exists`]
        : ["pending", "no Release for the tag yet"];
    });
    const [owner, name] = slug.split("/");
    await record("live page softwareVersion", async () => {
      const html = await fetchTextImpl(`https://${owner}.github.io/${name}/`);
      const live = html.match(/"softwareVersion"\s*:\s*"([^"]+)"/)?.[1] ?? null;
      if (live === target) return [true, `page says ${live}`];
      if (live === null) return [false, "page does not expose softwareVersion"];
      if (!semver(live))
        return [false, `page exposes softwareVersion "${live}", which is not MAJOR.MINOR.PATCH`];
      // A page NEWER than the tag is not "deploying this release": it is a
      // hard FAIL, never retried as pending.
      if (compareSemver(live, target) > 0)
        return [
          false,
          `page says ${live} — NEWER than the tag ${tag}; the live page is not this release`,
        ];
      return ["pending", `page says ${live} (Pages deploys last)`];
    });
  }

  let failed = 0;
  let pending = 0;
  for (const [label, state, detail] of checks) {
    if (state === false) failed += 1;
    else if (state === "pending") pending += 1;
    const mark = state === true ? "OK  " : state === "pending" ? "WAIT" : "FAIL";
    log(`release: ${mark} ${label} — ${detail}`);
  }
  if (failed > 0) {
    log(`release: NOT VERIFIED ${tag} — ${failed} check(s) failed`);
    return 1;
  }
  if (pending > 0) {
    log(
      `release: PROCESSING ${tag} — ${pending} surface(s) not live yet; ` +
        "re-run, or pass a longer --deadline",
    );
    return 2;
  }
  log(`release: VERIFIED ${tag}`);
  return 0;
}

export async function cmdVerify(args, deps = {}) {
  const options = parse(args, {
    version: null,
    deadline: VERIFY_DEADLINE_MS,
    interval: VERIFY_INTERVAL_MS,
    noWait: false,
  });
  // `--no-wait` must not silently override an explicit window: refuse the mix.
  if (
    options.noWait &&
    args.some(
      (a) =>
        a === "--deadline" ||
        a.startsWith("--deadline=") ||
        a === "--interval" ||
        a.startsWith("--interval="),
    )
  ) {
    throw new Refused("--no-wait cannot be combined with --deadline/--interval — pick one");
  }
  // An EMPTY value (`--deadline=`) must not become Number("") === 0: that
  // would silently turn the run into a single pass (PROCESSING) while the
  // refusal below claims it validates a non-negative number.
  if (!options.noWait && String(options.deadline).trim() === "")
    throw new Refused('--deadline needs a value (got "")');
  if (String(options.interval).trim() === "")
    throw new Refused('--interval needs a value (got "")');
  const deadlineMs = options.noWait ? 0 : Number(options.deadline);
  const intervalMs = Number(options.interval);
  if (!Number.isFinite(deadlineMs) || deadlineMs < 0)
    throw new Refused(`--deadline must be a non-negative number of ms (got "${options.deadline}")`);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0)
    throw new Refused(`--interval must be a positive number of ms (got "${options.interval}")`);
  return await verifyRelease({
    root: options.root,
    version: options.version,
    deadlineMs,
    intervalMs,
    deps,
  });
}

/** Flags that carry no value (the rest consume the next token). */
const BOOLEAN_FLAGS = new Set(["yes", "dryRun", "noPush", "offline"]);

/** Minimal option parser: `--flag`, `--key value`, `--key=value`, and the `--`
 *  separator every runner inserts. */
function parse(args, defaults) {
  const options = { ...defaults, root: ROOT };
  // Unknown options are refused, never silently ignored: `--deadline-ms` is
  // not `--deadline`, and a silently dropped flag is exactly how a release
  // tool lies (the pass-1 MAJOR of #538 was born on this ground).
  const known = new Set([...BOOLEAN_FLAGS, ...Object.keys(defaults), "root"]);
  const rest = [...args];
  while (rest.length > 0) {
    const token = rest.shift();
    if (token === "--") {
      // The `--` that `pnpm run <script> -- <args>` inserts is meant to be
      // CONSUMED by the runner. npm does; pnpm v11 forwards it verbatim
      // (measured 2026-11-05: `cut -- --dry-run --ref HEAD` reached the check,
      // lost `--dry-run`, and refused asking for `--yes`), so the script — the
      // process that receives it — must consume it: the pre-fix parser read it
      // as an option with an EMPTY name and swallowed the following token as
      // that option's value, which made the form this tool prints
      // (`pnpm release:cut -- --yes`) unable to publish. POSIX guideline 10 is
      // the norm; cargo and npm implement the same consumption for their
      // wrappers.
      continue;
    }
    if (!token.startsWith("--")) throw new Refused(`unexpected argument "${token}"`);
    const [key, inline] = token.slice(2).split("=", 2);
    const name = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!known.has(name)) throw new Refused(`unknown option "--${key}" (see --help)`);
    const isBoolean =
      BOOLEAN_FLAGS.has(name) || defaults[name] === true || defaults[name] === false;
    if (inline !== undefined) {
      // A boolean flag's presence IS the value: `--yes=false` once published.
      if (isBoolean) throw new Refused(`--${key} takes no value (got "${inline}")`);
      options[name] = inline;
    } else if (isBoolean) {
      options[name] = true;
    } else {
      const value = rest.shift();
      if (value === undefined) throw new Refused(`--${key} needs a value`);
      options[name] = value;
    }
  }
  options.root = path.resolve(options.root);
  return options;
}

function usage() {
  console.log(
    [
      "release — cut a profile-as-code release (maintainer tooling)",
      "",
      "  check   [--ref origin/main] [--root DIR] [--offline] preconditions (fetches origin)",
      "  cut     [--yes] [--dry-run] [--ref ..]              tag + push (human-run)",
      "  pages   --ref <commit-or-tag> [--release vX] [--dry-run]   re-deploy the site",
      "  verify  [--version X.Y.Z] [--deadline MS] [--interval MS] [--no-wait]",
      "           registry + Release + page; pending surfaces share ONE --deadline",
      "           window (default 600000 ms, global to the run): exit 0 VERIFIED,",
      "           2 PROCESSING, 1 NOT VERIFIED (only after the window closes)",
      "           --no-wait is a single pass and cannot be combined with --deadline/--interval",
      "",
      "cut refuses without --yes: the tag push is the irreversible publish step.",
      "The workflow publishes; this script never does.",
    ].join("\n"),
  );
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    switch (command) {
      case "check":
        return cmdCheck(args);
      case "cut":
        return cmdCut(args);
      case "pages":
        return cmdPages(args);
      case "verify":
        return await cmdVerify(args);
      case "--help":
      case "-h":
      case undefined:
        usage();
        return 0;
      default:
        throw new Refused(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof Refused) {
      console.error(`release: REFUSED — ${error.message}`);
      return 1;
    }
    throw error;
  }
}

// Compared by REALPATH: a symlinked invocation (e.g. /tmp → /private/tmp on
// macOS) must still run main(). Following release-notes.mjs, where "could not
// decide" must never read as "did nothing, exit 0".
function isMainModule() {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  process.exitCode = await main();
}
