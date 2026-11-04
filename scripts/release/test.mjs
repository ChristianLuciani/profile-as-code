#!/usr/bin/env node
/**
 * release tooling — the self-test (offline, no network, no `gh`).
 *
 * A gate that cannot fail is folklore: every refusal below is provoked against a
 * real temporary git repository (local refs only), and the two acting commands
 * are exercised through `--dry-run` so the test never tags or dispatches.
 *
 * What it proves:
 *   1. `check` PASSES on a well-formed release commit and REFUSES each broken
 *      precondition with its own reason (dirty tree, missing/empty CHANGELOG
 *      section, existing tag, HEAD behind the tip, bad semver);
 *   2. `cut` refuses without `--yes` and prints the exact commands in `--dry-run`;
 *   3. `pages --dry-run` names `pages.yml`, the repo derived from `origin`, and
 *      both inputs — no hardcoded owner;
 *   4. `changelogSection` selects the version's own section and never
 *      `[Unreleased]`.
 *
 * Zero dependencies, node >=22. Usage: node scripts/release/test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/** A temporary repository shaped like this repo, with a local origin/main ref. */
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

function release(root, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args, "--root", root], {
    encoding: "utf8",
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

console.log("release — self-test");

it("changelogSection selects the version, never [Unreleased]", () => {
  const text = CHANGELOG("0.4.0");
  const section = changelogSection(text, "0.4.0");
  assert.ok(section !== null);
  assert.match(section, /^## \[0\.4\.0\]/);
  assert.ok(!section.includes("[Unreleased]"));
  assert.equal(changelogSection(text, "9.9.9"), null);
  assert.ok(sectionIsSubstantive(section));
  assert.ok(!sectionIsSubstantive("## [0.4.0] - 2026-11-04\n\n### Added\n"));
});

it("check passes on a well-formed release commit", () => {
  const root = fixture();
  try {
    const result = release(root, ["check"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release: PASS \(v0\.4\.0 at [0-9a-f]{7}/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a dirty tracked tree", () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, "README.md"), "# changed\n");
    const result = release(root, ["check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /working tree is dirty/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a missing CHANGELOG section", () => {
  const root = fixture({ changelog: "# Changelog\n\n## [Unreleased]\n" });
  try {
    const result = release(root, ["check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no "## \[0\.4\.0\]" section/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a section with no heading and bullet", () => {
  const root = fixture({ changelog: "# Changelog\n\n## [0.4.0] - 2026-11-04\n\nprose only\n" });
  try {
    const result = release(root, ["check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no ### heading \+ bullet/);
  } finally {
    cleanup(root);
  }
});

it("check refuses an existing tag", () => {
  const root = fixture();
  try {
    git(root, ["tag", "v0.4.0"]);
    const result = release(root, ["check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a HEAD that is not the tip the tag must match", () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, "README.md"), "# moved\n");
    git(root, ["add", "-A"]);
    commit(root, "unpushed");
    const result = release(root, ["check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not origin\/main/);
  } finally {
    cleanup(root);
  }
});

it("check refuses a non-semver manifest version", () => {
  const root = fixture({ version: "0.4" });
  try {
    const result = release(root, ["check"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not MAJOR\.MINOR\.PATCH/);
  } finally {
    cleanup(root);
  }
});

it("cut refuses without --yes and never tags", () => {
  const root = fixture();
  try {
    const result = release(root, ["cut"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /irreversible publish step/);
    assert.equal(
      spawnSync("git", ["tag", "--list", "v0.4.0"], { cwd: root, encoding: "utf8" }).stdout.trim(),
      "",
    );
  } finally {
    cleanup(root);
  }
});

it("cut --dry-run prints the tag and push for the checked commit", () => {
  const root = fixture();
  try {
    const head = git(root, ["rev-parse", "HEAD"]);
    const result = release(root, ["cut", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`git tag v0.4.0 ${head}`), result.stdout);
    assert.ok(result.stdout.includes("git push origin v0.4.0"), result.stdout);
    assert.equal(git(root, ["tag", "--list", "v0.4.0"]), "");
  } finally {
    cleanup(root);
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
