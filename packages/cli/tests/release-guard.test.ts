/**
 * Release guard (issue #81) — the publish invariant is only worth what it does on
 * the cases it exists to stop, so every mode is exercised against a REAL
 * throwaway git repository: a bare "origin" with two commits on `main`, a scratch
 * branch, and tags moved between them.
 *
 * The regression that motivates the suite is the fourth case: a tag pointing at a
 * commit that is *behind* `main` (on the branch, but missing merged fixes). The
 * first implementation of this guard checked ancestry and happily PASSED it.
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "release-guard.mjs");

/** The version THIS checkout declares. The guard compares the tag against the
 *  manifest it ships with, so the suite has to follow the release instead of
 *  pinning a version — a pinned literal makes every release-prep bump fail 13
 *  cases that assert the guard works, which is the opposite of a signal. */
const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const VERSION = JSON.parse(readFileSync(MANIFEST, "utf8")).version as string;
const TAG = `v${VERSION}`;

const tempDirs: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=test", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** git for setup steps that are legitimately allowed to fail (removing a tag
 *  that a previous case already removed). */
function gitAllowFailure(cwd: string, args: string[]): void {
  try {
    git(cwd, args);
  } catch {
    /* nothing to remove */
  }
}

/** Run the guard; returns its exit code and combined output. */
function guard(env: Record<string, string>, cwd: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [GUARD], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const dirs = { origin: "", work: "", stale: "", mismatch: "", tip: "", off: "", shallow: "" };

/** A fresh $GITHUB_OUTPUT file, which is how the workflow consumes the verified
 *  commit — the contract that keeps the build from drifting off the tag. */
function outputFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-guard-out-"));
  tempDirs.push(dir);
  const file = join(dir, "github-output.txt");
  writeFileSync(file, "");
  return file;
}

/** Point origin's release tag at a commit (how a real tag lands on origin), or
 *  remove it from BOTH origin and the clone so a case never inherits the previous
 *  one. The tag name is this checkout's version (`TAG`), because that is what the
 *  guard reads from the manifest it ships with. */
function tagAt(target: string | null): void {
  gitAllowFailure(dirs.work, ["tag", "-d", TAG]);
  gitAllowFailure(dirs.work, ["push", "--delete", "origin", `refs/tags/${TAG}`]);
  if (target === null) return;
  git(dirs.work, ["tag", TAG, target]);
  git(dirs.work, ["push", "--force", "origin", TAG]);
}

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "pasco-release-guard-"));
  tempDirs.push(base);
  const seed = join(base, "seed");
  dirs.origin = join(base, "origin.git");
  dirs.work = join(base, "work");

  // A repository whose `main` has an older commit (`stale`) and a tip (`tip`).
  // Commits go through git() so they carry an explicit identity: CI runners have
  // no global user.name/email, and a raw `git commit` fails there with status 128
  // while passing on a developer machine that has one configured.
  git(base, ["init", "--quiet", "-b", "main", seed]);
  // Every commit carries a manifest: the guard reads the version from INSIDE the
  // commit it publishes, not from the working tree.
  const commit = (message: string, contents: string, version = VERSION): void => {
    appendFileSync(join(seed, "f"), contents);
    mkdirSync(join(seed, "packages", "cli"), { recursive: true });
    writeFileSync(
      join(seed, "packages", "cli", "package.json"),
      JSON.stringify({ name: "@profile-as-code/cli", version }),
    );
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "--quiet", "-m", message]);
  };
  commit("one", "one\n");
  dirs.stale = git(seed, ["rev-parse", "HEAD"]);
  // On `main`, but its manifest declares a version the tag name does not.
  commit("mismatch", "two\n", "9.9.9");
  dirs.mismatch = git(seed, ["rev-parse", "HEAD"]);
  commit("tip", "three\n");
  dirs.tip = git(seed, ["rev-parse", "HEAD"]);

  // An off-branch commit that never landed on `main`.
  git(seed, ["checkout", "--quiet", "-b", "scratch"]);
  commit("three", "three\n");
  dirs.off = git(seed, ["rev-parse", "HEAD"]);
  git(seed, ["checkout", "--quiet", "main"]);

  // origin = bare clone of seed; work = a clone whose origin is that bare repo.
  execFileSync("git", ["clone", "--quiet", "--bare", seed, dirs.origin], { stdio: "ignore" });
  execFileSync("git", ["clone", "--quiet", dirs.origin, dirs.work], { stdio: "ignore" });

  // A genuinely shallow clone. `file://` is required: a local path clone silently
  // ignores --depth and hands back the full history (which is how a first, invalid
  // version of this very check passed while testing nothing).
  dirs.shallow = join(base, "shallow");
  execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${dirs.origin}`, dirs.shallow], {
    stdio: "ignore",
  });
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const TAG_PUSH = { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: TAG, DEFAULT_BRANCH: "main" };
const DISPATCH = { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main", DEFAULT_BRANCH: "main" };

describe("release guard — tag push (identity: the tag must BE the tip)", () => {
  it("publishes when the tag is the current tip", () => {
    tagAt(dirs.tip);
    const { code, out } = guard(TAG_PUSH, dirs.work);
    expect(code).toBe(0);
    expect(out).toContain("= the current main tip");
  });

  it("REFUSES a tag that is behind the tip — the #81 repro (stale local main)", () => {
    tagAt(dirs.stale);
    const { code, out } = guard(TAG_PUSH, dirs.work);
    expect(code).toBe(1);
    // ancestry alone accepts this commit; the message must say what is wrong and what to do
    expect(out).toContain("BEHIND the tip");
    expect(out).toContain(dirs.tip.slice(0, 8));
    expect(out).toContain("git pull --ff-only");
  });

  it("REFUSES a tag on a commit that never landed on the branch", () => {
    tagAt(dirs.off);
    const { code, out } = guard(TAG_PUSH, dirs.work);
    expect(code).toBe(1);
    expect(out).toContain("not on the branch at all");
  });

  it("emits the verified commit and tag for the workflow to build", () => {
    tagAt(dirs.tip);
    const out = outputFile();
    const { code } = guard({ ...TAG_PUSH, GITHUB_OUTPUT: out }, dirs.work);
    expect(code).toBe(0);
    const written = readFileSync(out, "utf8");
    expect(written).toContain(`commit=${dirs.tip}`);
    expect(written).toContain(`tag=${TAG}`);
  });

  it("REFUSES a tag whose name disagrees with the manifest", () => {
    tagAt(dirs.tip);
    const { code, out } = guard({ ...TAG_PUSH, GITHUB_REF_NAME: "v9.9.9" }, dirs.work);
    expect(code).toBe(1);
    expect(out).toContain("but this package is");
  });
});

describe("release guard — workflow_dispatch (ancestry: a retry is legitimate)", () => {
  it("publishes a tag that is behind the tip — the documented retry path", () => {
    tagAt(dirs.stale);
    const { code, out } = guard(DISPATCH, dirs.work);
    expect(code).toBe(0);
    expect(out).toContain("manual dispatch");
  });

  it("emits the TAGGED commit on a retry, not the branch tip — verifying a commit is not publishing it", () => {
    // The hole this closes: the guard approved while the checkout sat at the tip,
    // so the retry path would have built a tree no tag identifies.
    tagAt(dirs.stale);
    const out = outputFile();
    const { code } = guard({ ...DISPATCH, GITHUB_OUTPUT: out }, dirs.work);
    expect(code).toBe(0);
    const written = readFileSync(out, "utf8");
    expect(written).toContain(`commit=${dirs.stale}`);
    expect(written).not.toContain(`commit=${dirs.tip}`);
  });

  it("REFUSES a tag whose TREE declares another version — the artifact, not the checkout, decides", () => {
    // The checkout declares the current version (that is how the tag was chosen)
    // but the tagged commit's manifest says 9.9.9, and the build is pinned to
    // that commit.
    tagAt(dirs.mismatch);
    const { code, out } = guard(DISPATCH, dirs.work);
    expect(code).toBe(1);
    expect(out).toContain("declares 9.9.9");
    expect(out).toContain("would publish 9.9.9");
  });

  it("REFUSES when the version is not tagged on origin", () => {
    tagAt(null);
    const { code, out } = guard(DISPATCH, dirs.work);
    expect(code).toBe(1);
    expect(out).toContain("has no exception");
  });

  it("REFUSES a tag on a commit that never landed on the branch", () => {
    tagAt(dirs.off);
    const { code, out } = guard(DISPATCH, dirs.work);
    expect(code).toBe(1);
    expect(out).toContain("must have landed on");
  });
});

describe("release guard — shallow clone (the check must not lie about why it refused)", () => {
  it('REFUSES the ancestry check with the real reason, not "it never landed on the branch"', () => {
    tagAt(dirs.stale);
    const { code, out } = guard(DISPATCH, dirs.shallow);
    expect(code).toBe(1);
    expect(out).toContain("SHALLOW");
    expect(out).toContain("fetch-depth: 0");
    // the misleading verdict this replaces
    expect(out).not.toContain("must have landed on");
  });

  it("still allows a retry whose tag IS the tip — ancestry is trivially true, so shallow must not refuse it", () => {
    tagAt(dirs.tip);
    const { code, out } = guard(DISPATCH, dirs.shallow);
    expect(code).toBe(0);
    expect(out).toContain("= the current main tip");
  });

  it("still publishes a tag at the tip — identity needs no history, so a shallow clone must not block it", () => {
    tagAt(dirs.tip);
    const { code, out } = guard(TAG_PUSH, dirs.shallow);
    expect(code).toBe(0);
    expect(out).toContain("= the current main tip");
  });
});

describe("release guard — dry run and failure modes", () => {
  it("a dry run still reports whether the tag exists — the pre-tag smoke signal", () => {
    tagAt(dirs.tip);
    const withTag = guard({ ...DISPATCH, DRY_RUN: "true" }, dirs.work);
    expect(withTag.code).toBe(0);
    expect(withTag.out).toContain("exists on origin");

    tagAt(null);
    const without = guard({ ...DISPATCH, DRY_RUN: "true" }, dirs.work);
    expect(without.code).toBe(0);
    expect(without.out).toContain("does NOT exist on origin");
  });

  it("passes a dry run but says which invariants were NOT enforced", () => {
    tagAt(null);
    const { code, out } = guard({ ...DISPATCH, DRY_RUN: "true" }, dirs.work);
    expect(code).toBe(0);
    expect(out).toContain("NOT enforced");
  });

  it("fails closed, with a distinct message, when the branch cannot be resolved", () => {
    tagAt(dirs.tip);
    const { code, out } = guard({ ...TAG_PUSH, DEFAULT_BRANCH: "no-such-branch" }, dirs.work);
    expect(code).toBe(1);
    // "the check could not run" must not be reported as "the check said no"
    expect(out).toContain("could not fetch origin/no-such-branch");
  });
});
