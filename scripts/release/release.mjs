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
 *   check  — offline preconditions (version, CHANGELOG section, clean tree,
 *            HEAD is the tip, no existing tag); exit 1 on any failure.
 *   cut    — runs check, then `git tag` + `git push origin vX.Y.Z` (human-run).
 *   pages  — the documented override that re-deploys the site from a commit
 *            (the tag run deploys from the tag commit; a post-tag docs commit
 *            needs this).
 *   verify — reads the registry, the Release and the live page: the tag
 *            published, with attestations, and the page says this version.
 *
 * Zero dependencies, node >=22. `check`/`cut --dry-run`/`pages --dry-run` are
 * offline; `cut`, `pages` and `verify` call git/gh/network when asked to act.
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
  const options = parse(args, { ref: "origin/main", yes: false, dryRun: false, push: true });
  if (options.noPush === true) options.push = false;
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
  if (options.push) run("git", plan.commands[1][1], { root: options.root });
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
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) throw new Refused(`GET ${url} → HTTP ${response.status}`);
  return { status: response.status, body: await response.json() };
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Refused(`GET ${url} → HTTP ${response.status}`);
  return response.text();
}

/** Reads the published surfaces. Every surface is ATTEMPTED: one unreachable
 *  URL is a FAIL row, never the end of the report (and a rejected fetch is
 *  caught, not a stack). */
export async function verifyRelease({ root = ROOT, version = null } = {}) {
  const cli = readJson(root, CLI_MANIFEST);
  const core = readJson(root, CORE_MANIFEST);
  const target = version ?? cli.version;
  if (!semver(target)) throw new Refused(`"${target}" is not MAJOR.MINOR.PATCH`);
  const tag = `v${target}`;
  const tagCommit = gitMaybe(root, ["rev-parse", `${tag}^{commit}`]);
  if (tagCommit.status !== 0) throw new Refused(`tag ${tag} does not resolve locally`);

  const checks = [];
  const record = async (label, probe) => {
    try {
      const [ok, detail] = await probe();
      checks.push([label, ok, detail]);
    } catch (error) {
      checks.push([label, false, `unreachable: ${error.message}`]);
    }
  };

  let cliMeta = { status: 0, body: null };
  await record("npm @profile-as-code/cli", async () => {
    cliMeta = await fetchJson(`https://registry.npmjs.org/@profile-as-code/cli/${target}`);
    return cliMeta.status === 200
      ? [true, `published, gitHead ${cliMeta.body.gitHead ?? "?"}`]
      : [false, "not on the registry"];
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
    coreMeta = await fetchJson(`https://registry.npmjs.org/@profile-as-code/core/${core.version}`);
    return coreMeta.status === 200
      ? [true, `published ${core.version}`]
      : [false, "not on the registry"];
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
      const gh = run("gh", ["release", "view", tag, "--repo", slug, "--json", "tagName"], {
        root,
        allowFail: true,
      });
      return [gh.status === 0, gh.status === 0 ? `${tag} page exists` : "no Release for the tag"];
    });
    const [owner, name] = slug.split("/");
    await record("live page softwareVersion", async () => {
      const html = await fetchText(`https://${owner}.github.io/${name}/`);
      const live = html.match(/"softwareVersion"\s*:\s*"([^"]+)"/)?.[1] ?? null;
      return [
        live === target,
        live === null ? "page does not expose softwareVersion" : `page says ${live}`,
      ];
    });
  }

  let failed = 0;
  for (const [label, ok, detail] of checks) {
    if (!ok) failed += 1;
    console.log(`release: ${ok ? "OK  " : "FAIL"} ${label} — ${detail}`);
  }
  console.log(
    failed === 0 ? `release: VERIFIED ${tag}` : `release: NOT VERIFIED — ${failed} check(s) failed`,
  );
  return failed === 0 ? 0 : 1;
}

/** Flags that carry no value (the rest consume the next token). */
const BOOLEAN_FLAGS = new Set(["yes", "dryRun", "noPush", "offline"]);

/** Minimal option parser: `--flag`, `--key value`, `--key=value`. */
function parse(args, defaults) {
  const options = { ...defaults, root: ROOT };
  const rest = [...args];
  while (rest.length > 0) {
    const token = rest.shift();
    if (!token.startsWith("--")) throw new Refused(`unexpected argument "${token}"`);
    const [key, inline] = token.slice(2).split("=", 2);
    const name = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
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
      "  cut     [--yes] [--dry-run] [--no-push] [--ref ..]  tag + push (human-run)",
      "  pages   --ref <commit-or-tag> [--release vX] [--dry-run]   re-deploy the site",
      "  verify  [--version X.Y.Z]                            registry + Release + page",
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
        return await verifyRelease(parse(args, {}));
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
