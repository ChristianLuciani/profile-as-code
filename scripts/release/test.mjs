#!/usr/bin/env node
/**
 * release tooling — the self-test (offline unless a bare file remote is used).
 *
 * A gate that cannot fail is folklore: every refusal below is provoked against a
 * real temporary git repository, and the two acting commands are exercised
 * through `--dry-run` so the test never tags, pushes or dispatches. The
 * remote-verification cases use a bare repository on the local filesystem; no
 * network, no `gh`.
 *
 * What it proves:
 *   1. `check` PASSES on a well-formed release commit and REFUSES each broken
 *      precondition with its own reason (dirty tree, missing/non-canonical
 *      CHANGELOG section, existing tag locally AND on origin, HEAD behind the
 *      remote tip, bad semver, unreadable core manifest);
 *   2. a boolean flag's PRESENCE is its value: `cut --yes=false` is refused and
 *      creates no tag;
 *   3. `cut` refuses without `--yes`, never uses `--offline`, and prints the
 *      exact commands in `--dry-run`;
 *   4. `pages --dry-run` names `pages.yml`, the repo derived from `origin`, and
 *      both inputs;
 *   5. the entrypoint guard decides by realpath, so a symlinked invocation runs.
 *
 * Zero dependencies, node >=22. Usage: node scripts/release/test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changelogSection, sectionIsSubstantive } from "./release.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "release.mjs");
const CHANGELOG = (version) =>
  `# Changelog\n\n## [Unreleased]\n\n_(nothing yet — the next cycle)_\n\n## [${version}] - 2026-11-04\n\n### Added\n\n- a bullet the notes extractor can read.\n\n## [0.0.1] - 2026-01-01\n\n### Fixed\n\n- old.\n`;

let failures = 0;
function it(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(root, message) {
  git(root, [
    "-c",
    "user.name=Release Test",
    "-c",
    "user.email=release@example.test",
    "commit",
    "-q",
    "-m",
    message,
  ]);
}

/** A temporary repository shaped like this repo. */
function fixture({ version = "0.4.0", changelog = CHANGELOG(version) } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-test-"));
  mkdirSync(path.join(root, "packages", "cli"), { recursive: true });
  mkdirSync(path.join(root, "packages", "core"), { recursive: true });
  writeFileSync(
    path.join(root, "packages", "cli", "package.json"),
    JSON.stringify({ name: "@profile-as-code/cli", version }, null, 2),
  );
  writeFileSync(
    path.join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "@profile-as-code/core", version: "0.1.3" }, null, 2),
  );
  if (changelog !== null) writeFileSync(path.join(root, "CHANGELOG.md"), changelog);
  writeFileSync(path.join(root, "README.md"), "# fixture\n");

  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["remote", "add", "origin", "https://github.com/example/profile-as-code.git"]);
  git(root, ["add", "-A"]);
  commit(root, "release candidate");
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return root;
}

/** The same fixture with a real (bare, local) `origin` and its main pushed. */
function onlineFixture(options) {
  const root = fixture(options);
  const bare = mkdtempSync(path.join(os.tmpdir(), "release-bare-"));
  git(bare, ["init", "--bare", "-q"]);
  // Pin the bare HEAD: `git init` defaults to master on some hosts, and a clone
  // of a bare repo whose HEAD names a missing branch checks out nothing.
  git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(root, ["remote", "set-url", "origin", bare]);
  git(root, ["push", "-q", "-u", "origin", "main"]);
  return { root, bare };
}

function release(root, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args, "--root", root], {
    encoding: "utf8",
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function tags(root) {
  return git(root, ["tag", "--list"]);
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

console.log("release — self-test");

it("changelogSection delegates to the extractor: exact version, never [Unreleased]", () => {
  const text = CHANGELOG("0.4.0");
  const section = changelogSection(text, "0.4.0");
  assert.ok(section !== null);
  assert.match(section, /^### Added/);
  assert.ok(!section.includes("[Unreleased]"));
  assert.equal(changelogSection(text, "9.9.9"), null);
  assert.ok(sectionIsSubstantive(section));
  assert.ok(!sectionIsSubstantive("### Added\n"));
});

it("the canonical heading pattern is the extractor's, not a looser one", () => {
  // A linked heading is not what `release-notes.mjs` extracts, so `check` must
  // refuse it too — otherwise the release run dies after the tag is pushed.
  const linked = "## [0.4.0](https://example.test/0.4.0) - 2026-11-04\n\n### Added\n\n- x\n";
  assert.equal(changelogSection(linked, "0.4.0"), null);
});

it("check passes on a well-formed release commit", () => {
  const root = fixture();
  try {
    const result = release(root, ["check", "--offline"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release: PASS \(v0\.4\.0 at [0-9a-f]{7}/);
    assert.match(result.stdout, /remote tip and remote tags were not verified/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a dirty tracked tree", () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, "README.md"), "# changed\n");
    const result = release(root, ["check", "--offline"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /working tree is dirty/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a missing CHANGELOG section", () => {
  const root = fixture({ changelog: "# Changelog\n\n## [Unreleased]\n" });
  try {
    const result = release(root, ["check", "--offline"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no "## \[0\.4\.0\]" section/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a section with no heading and bullet", () => {
  const root = fixture({ changelog: "# Changelog\n\n## [0.4.0] - 2026-11-04\n\nprose only\n" });
  try {
    const result = release(root, ["check", "--offline"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no ### heading \+ bullet/);
  } finally {
    cleanup(root);
  }
});

it("check refuses an existing local tag", () => {
  const root = fixture();
  try {
    git(root, ["tag", "v0.4.0"]);
    const result = release(root, ["check", "--offline"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists locally/);
  } finally {
    cleanup(root);
  }
});

it("check fetches origin and refuses a HEAD that is not the remote tip", () => {
  const { root, bare } = onlineFixture();
  const other = mkdtempSync(path.join(os.tmpdir(), "release-other-"));
  try {
    const first = release(root, ["check"]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    // Someone else pushes to main after our checkout: a local-only check would
    // still read green, and the tag guard would refuse the pushed tag.
    git(os.tmpdir(), ["clone", "-q", bare, other]);
    writeFileSync(path.join(other, "README.md"), "# moved remotely\n");
    git(other, ["add", "-A"]);
    git(other, [
      "-c",
      "user.name=Other",
      "-c",
      "user.email=other@example.test",
      "commit",
      "-qm",
      "move",
    ]);
    git(other, ["push", "-q", "origin", "main"]);

    // The offline read cannot see the move and says it did not verify it;
    // the online read fetches and refuses. (The fetch updates the local
    // remote-tracking ref, so this order is the only one that can show both.)
    assert.equal(release(root, ["check", "--offline"]).status, 0);
    const online = release(root, ["check"]);
    assert.equal(online.status, 1);
    assert.match(online.stderr, /is not origin\/main/);
  } finally {
    cleanup(root);
    cleanup(bare);
    cleanup(other);
  }
});

it("check refuses a tag that exists only on origin", () => {
  const { root, bare } = onlineFixture();
  try {
    git(root, ["tag", "v0.4.0"]);
    git(root, ["push", "-q", "origin", "v0.4.0"]);
    git(root, ["tag", "-d", "v0.4.0"]);
    const result = release(root, ["check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists on origin/);
  } finally {
    cleanup(root);
    cleanup(bare);
  }
});

it("check refuses a HEAD that is not the local tip", () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, "README.md"), "# moved\n");
    git(root, ["add", "-A"]);
    commit(root, "unpushed");
    const result = release(root, ["check", "--offline"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not origin\/main/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a non-semver manifest version", () => {
  const root = fixture({ version: "0.4" });
  try {
    const result = release(root, ["check", "--offline"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not MAJOR\.MINOR\.PATCH/);
  } finally {
    cleanup(root);
  }
});

it("check reports an unreadable core manifest instead of crashing", () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, "packages", "core", "package.json"), "{ not json");
    const result = release(root, ["check", "--offline"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot read packages\/core\/package\.json/);
    assert.doesNotMatch(result.stderr, /at Object\.|TypeError|SyntaxError/);
  } finally {
    cleanup(root);
  }
});

it("a boolean flag's presence is its value: --yes=false never publishes", () => {
  const { root, bare } = onlineFixture();
  try {
    const result = release(root, ["cut", "--yes=false"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--yes takes no value/);
    assert.equal(tags(root), "");
    assert.equal(git(bare, ["tag", "--list"]), "", "a refused cut must not push a tag");
  } finally {
    cleanup(root);
    cleanup(bare);
  }
});

it("cut refuses --offline (it must verify origin before pushing)", () => {
  const { root, bare } = onlineFixture();
  try {
    const result = release(root, ["cut", "--yes", "--offline"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--offline is check-only/);
    assert.equal(tags(root), "");
  } finally {
    cleanup(root);
    cleanup(bare);
  }
});

it("cut refuses without --yes and never tags", () => {
  const { root, bare } = onlineFixture();
  try {
    const result = release(root, ["cut"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /irreversible publish step/);
    assert.equal(tags(root), "");
  } finally {
    cleanup(root);
    cleanup(bare);
  }
});

it("cut --dry-run prints the tag and push for the checked commit", () => {
  const { root, bare } = onlineFixture();
  try {
    const head = git(root, ["rev-parse", "HEAD"]);
    const result = release(root, ["cut", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`git tag v0.4.0 ${head}`), result.stdout);
    assert.ok(result.stdout.includes("git push origin v0.4.0"), result.stdout);
    assert.equal(tags(root), "");
  } finally {
    cleanup(root);
    cleanup(bare);
  }
});

it("pages --dry-run derives the repo from origin and passes both inputs", () => {
  const root = fixture();
  try {
    const result = release(root, ["pages", "--ref", "abc123", "--release", "v0.4.0", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      result.stdout.includes(
        "gh workflow run pages.yml --repo example/profile-as-code --ref main -f ref=abc123 -f release=v0.4.0",
      ),
      result.stdout,
    );
  } finally {
    cleanup(root);
  }
});

it("pages refuses without --ref", () => {
  const root = fixture();
  try {
    const result = release(root, ["pages", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /needs --ref/);
  } finally {
    cleanup(root);
  }
});

it("the entrypoint guard decides by realpath, so a symlinked invocation runs", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "release-link-"));
  try {
    const link = path.join(dir, "release.mjs");
    symlinkSync(SCRIPT, link);
    const result = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release — cut a profile-as-code release/);
  } finally {
    cleanup(dir);
  }
});

it("cut refuses --no-push: the push IS the release", () => {
  const { root, bare } = onlineFixture();
  try {
    const result = release(root, ["cut", "--no-push"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--no-push is not supported/);
    assert.equal(tags(root), "");
  } finally {
    cleanup(root);
    cleanup(bare);
  }
});

it("verify refuses a tag that is not local, before touching the network", () => {
  const root = fixture();
  try {
    const result = release(root, ["verify"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tag v0\.4\.0 does not resolve locally/);
  } finally {
    cleanup(root);
  }
});

it("verify refuses a non-semver version", () => {
  const root = fixture();
  try {
    const result = release(root, ["verify", "--version", "0.4"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not MAJOR\.MINOR\.PATCH/);
  } finally {
    cleanup(root);
  }
});

it("verify reports unreadable manifests instead of crashing", () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, "packages", "core", "package.json"), "{ not json");
    const result = release(root, ["verify"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot read the release manifests/);
    assert.doesNotMatch(result.stderr, /SyntaxError|at Object\./);
  } finally {
    cleanup(root);
  }
});

it("pages refuses an origin that is not github.com", () => {
  const root = fixture();
  try {
    git(root, ["remote", "set-url", "origin", "/tmp/not-github"]);
    const result = release(root, ["pages", "--ref", "abc", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /origin is not a github\.com remote/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a directory that is not a git repository", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-nogit-"));
  try {
    const result = release(root, ["check", "--offline"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not a git repository/);
  } finally {
    cleanup(root);
  }
});

it("an unknown command is refused, not ignored", () => {
  const root = fixture();
  try {
    const result = release(root, ["publish"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown command "publish"/);
  } finally {
    cleanup(root);
  }
});

if (failures > 0) {
  console.error(`release self-test: ${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log("release self-test: PASS");
}
