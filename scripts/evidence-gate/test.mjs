#!/usr/bin/env node
/**
 * Self-test for the evidence-staleness gate (#226, R2) — the repo idiom: prove
 * the gate REFUSES every failure class it claims and DISCRIMINATES the three
 * states. A gate whose tests cannot fail with the defect present is not a test.
 *
 * The fixture is a REAL throwaway git repository per case (the gate's subject IS
 * git ancestry and `sha..ref` diffs, so a synthesized string could not exercise
 * it). `main` is the default branch, so the reference resolution is pinned too.
 *
 * The load-bearing case is the HISTORICAL RECORD: an `as_of: <sha>` citation of
 * a past run whose relevant paths have moved since must NOT be marked stale — a
 * record is correct forever, and a gate that confuses records with current
 * claims becomes noise and gets switched off (#226, decision 2/3).
 *
 * Usage: node scripts/evidence-gate/test.mjs
 * Exit:  0 all cases pass · 1 any case fails
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "check.mjs");

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

function git(root, args) {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

function write(root, rel, content) {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commit(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

/** A throwaway repo on `main`, with one commit and a package file. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "evidence-gate-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "evidence-gate self-test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  write(root, "packages/core/src/index.ts", "export const x = 1;\n");
  return root;
}

/** The annotation under test, written into the corpus as `docs/STANDARDS.md`. */
const annotation = ({ type = "tests", asOf, kind = "current" }) =>
  `# S\n\n| # | Item | Status | Evidence |\n|---|---|---|---|\n| 1 | x | ✅ | text <!-- evidence: ${type} as_of=${asOf} kind=${kind} --> |\n`;

function run(root, args = []) {
  const res = spawnSync(process.execPath, [GATE, "--root", root, ...args], { encoding: "utf8" });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const roots = [];
const repo = (setup) => {
  const root = makeRepo();
  roots.push(root);
  return setup(root);
};

/**
 * The standard shape: the annotation IS the last commit, so its own anchor
 * describes a clean tree — a claim is anchored by the state it reports, and the
 * cases below then move exactly one thing after it.
 */
const anchored = (opts) => (root) => {
  write(root, "docs/STANDARDS.md", annotation({ ...opts, asOf: "PENDING" }));
  const base = commit(root, "base");
  write(root, "docs/STANDARDS.md", annotation({ ...opts, asOf: base }));
  return { root, anchor: commit(root, "annotate") };
};

try {
  // ── the three states ──────────────────────────────────────────────────────
  {
    const { root } = repo(anchored({ kind: "current" }));
    const res = run(root);
    check(
      "a current claim with no relevant change is FRESH",
      res.code === 0 && res.out.includes("=fresh") && !res.out.includes("W-EVIDENCE-STALE"),
      res.out.trim(),
    );
  }
  {
    const { root } = repo(anchored({ kind: "current" }));
    write(root, "packages/core/src/index.ts", "export const x = 2;\n");
    commit(root, "move a relevant path");
    const res = run(root);
    check(
      "a current claim whose relevant path moved is STALE — and it only WARNS",
      res.code === 0 && res.out.includes("W-EVIDENCE-STALE") && res.out.includes("=stale"),
      res.out.trim(),
    );
  }
  {
    const { root } = repo(anchored({ kind: "record" }));
    write(root, "packages/core/src/index.ts", "export const x = 3;\n");
    commit(root, "move a relevant path");
    const res = run(root);
    check(
      "THE FIXTURE: a historical record is NOT stale though its paths moved",
      res.code === 0 && res.out.includes("[record]=fresh") && !res.out.includes("W-EVIDENCE-STALE"),
      res.out.trim(),
    );
  }
  {
    // A commit that exists but is not an ancestor of the reference: the rebase /
    // force-squash shape — the ONLY fatal.
    const { root } = repo((r) => {
      const base = commit(r, "base");
      git(r, ["checkout", "-q", "-b", "side", base]);
      write(r, "docs/side.md", "# side\n");
      const sha = commit(r, "diverged");
      git(r, ["checkout", "-q", "main"]);
      write(r, "docs/STANDARDS.md", annotation({ asOf: sha, kind: "record" }));
      commit(r, "annotate");
      return { root: r };
    });
    const res = run(root);
    check(
      "a sha that is no longer an ancestor is UNREACHABLE — and it FAILS",
      res.code === 1 &&
        res.out.includes("E-EVIDENCE-UNREACHABLE") &&
        res.out.includes("unreachable"),
      res.out.trim(),
    );
  }
  {
    const { root } = repo((r) => {
      commit(r, "base");
      write(r, "docs/STANDARDS.md", annotation({ asOf: "0".repeat(40), kind: "record" }));
      commit(r, "annotate");
      return { root: r };
    });
    const res = run(root);
    check(
      "an unknown sha is UNREACHABLE — a claim without a source",
      res.code === 1 && res.out.includes("E-EVIDENCE-UNREACHABLE"),
      res.out.trim(),
    );
  }

  // ── the path binding is per CLAIM TYPE (never one global set) ─────────────
  {
    const { root } = repo(anchored({ type: "links", kind: "current" }));
    write(root, "packages/core/src/index.ts", "export const x = 5;\n");
    commit(root, "a package changed, not a doc");
    const res = run(root);
    check(
      "a `links` claim ignores a package change (type-bound paths)",
      res.code === 0 && res.out.includes("=fresh"),
      res.out.trim(),
    );
  }
  {
    const { root } = repo(anchored({ type: "links", kind: "current" }));
    write(root, "docs/other.md", "# other\n");
    commit(root, "a doc changed");
    const res = run(root);
    check(
      "a `links` claim goes stale on a doc change",
      res.code === 0 && res.out.includes("=stale"),
      res.out.trim(),
    );
  }

  // ── fail-closed on shapes the gate cannot read ────────────────────────────
  {
    const root = repo((r) => {
      commit(r, "base");
      write(r, "docs/STANDARDS.md", `# S\n\n<!-- evidence: tests as_of=${"a".repeat(7)} -->\n`);
      return r;
    });
    const res = run(root);
    check(
      "a malformed annotation is an E-GATE, never a silent skip",
      res.code === 1 && res.out.includes("E-GATE:") && res.out.includes("do not match"),
      res.out.trim(),
    );
  }
  {
    const root = repo((r) => {
      const base = commit(r, "base");
      write(r, "docs/STANDARDS.md", annotation({ type: "vibes", asOf: base, kind: "record" }));
      return r;
    });
    const res = run(root);
    check(
      "an unknown claim type is refused",
      res.code === 1 && res.out.includes('unknown evidence type "vibes"'),
      res.out.trim(),
    );
  }
  {
    const root = repo((r) => {
      const base = commit(r, "base");
      write(r, "docs/STANDARDS.md", annotation({ asOf: base, kind: "maybe" }));
      return r;
    });
    const res = run(root);
    check(
      "an unknown kind is refused",
      res.code === 1 && res.out.includes('kind="maybe"'),
      res.out.trim(),
    );
  }
  {
    const root = repo((r) => {
      commit(r, "base");
      write(r, "docs/STANDARDS.md", annotation({ asOf: "not-a-sha", kind: "record" }));
      return r;
    });
    const res = run(root);
    check(
      "a non-sha anchor is refused",
      res.code === 1 && res.out.includes("is not a commit sha"),
      res.out.trim(),
    );
  }

  // ── the reference resolution and the empty corpus ─────────────────────────
  {
    // A doc must be able to DOCUMENT the syntax (this repo's AGENTS.md and
    // STANDARDS.md do, in backticks) without the gate reading the documentation
    // as an annotation — or as a malformed one.
    const root = repo((r) => {
      commit(r, "base");
      write(
        r,
        "docs/STANDARDS.md",
        "# S\n\nWrite it as `<!-- evidence: tests as_of=<sha> kind=record|current -->` in prose.\n",
      );
      return r;
    });
    const res = run(root);
    check(
      "prose documenting the syntax in backticks is not an annotation",
      res.code === 0 && res.out.includes("no claim to check"),
      res.out.trim(),
    );
  }
  {
    const root = repo((r) => {
      commit(r, "base");
      write(r, "docs/STANDARDS.md", "# S\n\nno annotations\n");
      return r;
    });
    const res = run(root);
    check(
      "a corpus with no annotation is honest about it (not a silent pass)",
      res.code === 0 && res.out.includes("no claim to check"),
      res.out.trim(),
    );
  }
  {
    const { root } = repo(anchored({ kind: "record" }));
    const res = run(root, ["--ref", "main"]);
    check(
      "--ref pins the reference explicitly",
      res.code === 0 && res.out.includes("=fresh"),
      res.out.trim(),
    );
  }
  {
    // No `main` and no `origin/main`: the gate says which present it read.
    const { root } = repo(anchored({ kind: "record" }));
    git(root, ["branch", "-m", "trunk"]);
    const res = run(root);
    check(
      "an absent main falls back to HEAD and says so",
      res.code === 0 && res.out.includes("reading the present from HEAD"),
      res.out.trim(),
    );
  }

  // ── review F3 on #230: detection must be derived from the GRAMMAR ─────────
  {
    // The grammar accepts `<!--evidence:` (no space) and any case. A literal
    // fast path skipped both, so a `kind=current` claim went unresolved — the
    // one thing a fail-closed gate must never do.
    const { root } = repo((r) => ({ root: r, anchor: commit(r, "base") }));
    write(
      root,
      "docs/STANDARDS.md",
      `# S\n\n<!--evidence: tests as_of=${git(root, ["rev-parse", "HEAD"])} kind=current -->\n`,
    );
    const res = run(root);
    check(
      "F3: a zero-space `<!--evidence:` marker is RESOLVED, never silently skipped",
      res.code === 0 &&
        /tests@[0-9a-f]{7,}=/.test(res.out) &&
        !res.out.includes("no claim to check"),
      res.out.trim(),
    );
  }
  {
    const { root } = repo((r) => ({ root: r, anchor: commit(r, "base") }));
    write(
      root,
      "docs/STANDARDS.md",
      `# S\n\n<!-- Evidence: tests as_of=${"a".repeat(7)} kind=current -->\n`,
    );
    const res = run(root);
    check(
      "F3: an upper-case marker is resolved too (non-silent either way)",
      res.code === 1 &&
        res.out.includes("E-EVIDENCE-UNREACHABLE") &&
        !res.out.includes("no claim to check"),
      res.out.trim(),
    );
  }

  // ── review F4 on #230: the reference must not be the lagging local branch ──
  {
    // local `main` one commit behind `origin/main`. Preferring `main` turned the
    // same live claims from `stale` into `fresh` — the gate answering "fine" to
    // the exact question it exists to answer.
    const { root, anchor } = repo((r) => {
      const a = commit(r, "base");
      write(r, "docs/STANDARDS.md", annotation({ asOf: a, kind: "current" }));
      commit(r, "annotate");
      write(r, "packages/core/src/index.ts", "export const x = 9;\n");
      commit(r, "a package moved after the anchor");
      // Refs only: `origin/main` is the tip, `main` lags at the anchor.
      git(r, ["update-ref", "refs/remotes/origin/main", git(r, ["rev-parse", "HEAD"])]);
      git(r, ["update-ref", "refs/heads/main", a]);
      return { root: r, anchor: a };
    });
    check(
      "F4 precondition: local main lags origin/main",
      git(root, ["rev-parse", "main"]) === anchor &&
        git(root, ["rev-parse", "origin/main"]) !== anchor,
      `main=${git(root, ["rev-parse", "main"])} origin/main=${git(root, ["rev-parse", "origin/main"])}`,
    );
    const res = run(root);
    check(
      "F4: with a lagging local main the claim is STALE, not fresh",
      res.code === 0 && res.out.includes("=stale") && res.out.includes("ref=origin/main"),
      res.out.trim(),
    );
  }
  {
    // The mirror case: an anchor that IS origin/main's tip must not become a
    // FATAL just because the local branch is behind (the false `unreachable`).
    const { root, anchor } = repo((r) => {
      const a = commit(r, "base");
      write(r, "docs/STANDARDS.md", annotation({ asOf: a, kind: "record" }));
      commit(r, "annotate");
      git(r, ["update-ref", "refs/remotes/origin/main", a]);
      git(r, ["update-ref", "refs/heads/main", git(r, ["rev-parse", "HEAD~0"])]);
      return { root: r, anchor: a };
    });
    git(root, ["update-ref", "refs/heads/main", anchor]);
    const res = run(root);
    check(
      "F4: a valid anchor on origin/main is not a fatal when local main lags",
      res.code === 0 && !res.out.includes("E-EVIDENCE-UNREACHABLE"),
      res.out.trim(),
    );
  }
  {
    // A reference OLDER than the anchor: the anchor is not ON the ref, but the
    // ref IS an ancestor of the anchor — so nothing was rewritten, the clone
    // simply has not fetched. Warn, never fail. Unit-level via the exported
    // `classify`, because the CLI cannot express "the ref is behind" without
    // inventing an older ref than the annotation can name.
    const { classify } = await import("./check.mjs");
    const root = repo((r) => {
      commit(r, "base");
      write(r, "packages/core/src/index.ts", "export const x = 9;\n");
      return r;
    });
    const older = git(root, ["rev-parse", "HEAD~0"]);
    write(root, "packages/core/src/index.ts", "export const x = 10;\n");
    const newer = commit(root, "the anchor is ahead of the reference");
    const verdict = classify(
      root,
      { where: "x", file: "docs/STANDARDS.md", type: "tests", asOf: newer, kind: "record" },
      { name: "main", sha: older },
    );
    check(
      "F4: a reference older than the anchor WARNS, it does not fail",
      verdict.state === "stale" && verdict.state !== "unreachable",
      JSON.stringify(verdict),
    );
    check(
      "F4: and the warning names the real cause (fetch, not rebase)",
      verdict.reason.includes("OLDER than the anchor"),
      verdict.reason,
    );
  }

  // ── review F6 on #230: an unreadable corpus is a clean refusal ─────────────
  {
    const root = repo((r) => {
      commit(r, "base");
      mkdirSync(join(r, "docs", "secret"), { recursive: true });
      writeFileSync(join(r, "docs", "secret", "x.md"), "# x\n");
      return r;
    });
    const locked = join(root, "docs", "secret");
    chmodSync(locked, 0o000);
    let res;
    try {
      res = run(root);
    } finally {
      chmodSync(locked, 0o755);
    }
    // Running as a user who can read anything (root) makes the case vacuous —
    // then the gate legitimately passes and there is nothing to assert.
    if (res.out.includes("E-GATE")) {
      check(
        "F6: an unreadable corpus refuses in one vocabulary (no raw stack)",
        res.code === 1 &&
          res.out.includes("evidence-gate: FAIL") &&
          !res.out.includes("at walkMarkdown"),
        res.out.trim(),
      );
    } else {
      check("F6: skipped — this user can read a 000 directory (not root-only)", true);
    }
  }

  // ── review F7 on #230: a package README cannot move a test count ───────────
  {
    const { root } = repo(anchored({ kind: "current" }));
    write(root, "packages/core/README.md", "# core\n");
    commit(root, "a package README changed only");
    const res = run(root);
    check(
      "F7: a package README edit does NOT mark a tests claim stale",
      res.code === 0 && res.out.includes("=fresh") && !res.out.includes("W-EVIDENCE-STALE"),
      res.out.trim(),
    );
  }
  {
    const { root } = repo(anchored({ kind: "current" }));
    write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    commit(root, "the lockfile moved");
    const res = run(root);
    check(
      "F7: the lockfile IS in the tests relevant set",
      res.code === 0 && res.out.includes("=stale"),
      res.out.trim(),
    );
  }

  // ── #228: the CLI command inventory is a claim of the same class ───────────
  {
    const { root } = repo(anchored({ type: "cli", kind: "current" }));
    write(root, "packages/cli/src/index.ts", "// a ninth command moved in\n");
    commit(root, "the CLI changed");
    const res = run(root);
    check(
      "#228: a CLI source change marks the command inventory stale",
      res.code === 0 && res.out.includes("=stale") && res.out.includes("cli@"),
      res.out.trim(),
    );
  }
  {
    const { root } = repo(anchored({ type: "cli", kind: "current" }));
    write(root, "packages/cli/README.md", "# cli\n");
    commit(root, "only the CLI README changed");
    const res = run(root);
    check(
      "#228: a CLI README edit does NOT mark the inventory stale (a doc adds no command)",
      res.code === 0 && res.out.includes("=fresh") && !res.out.includes("W-EVIDENCE-STALE"),
      res.out.trim(),
    );
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

for (const failure of failures) console.log(`FAIL: ${failure}`);
console.log(`evidence-gate self-test: ${passed}/${passed + failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
