#!/usr/bin/env node
/**
 * Release guard — the publish invariant for `@profile-as-code/cli`
 * (issues #42/#43, hardened in #81).
 *
 * Publishing is irreversible in practice: the version number is consumed and the
 * npm package becomes a public surface. This script is the only automated
 * protection between a human slip and a wrong artifact, so it answers three
 * questions, not one:
 *
 *   1. Does the tag name agree with this package's `package.json` version?
 *   2. Is that version tagged on origin?
 *   3. Is the PUBLISHED COMMIT the right one?
 *
 * (3) is what was missing, and the two entry points need different answers:
 *
 *   - **Tag push** → the tagged commit must be the CURRENT tip of the default
 *     branch. This is the case that caused #81: tagging from a stale local
 *     `main` (observed 2026-09-15: nine commits behind) points the tag at an
 *     ANCESTOR of the tip — on the branch, but missing every fix merged since.
 *     An ancestry check does NOT catch that; identity does.
 *   - **Manual dispatch** (the documented retry path) → ancestry is correct and
 *     identity is not. A retry legitimately republishes a tag that was pushed
 *     when the branch was at that commit; the branch has advanced since. Demanding
 *     identity there would block every retry.
 *
 * Strict identity is the default because the tag is normally pushed right after
 * pulling; a deliberate release of an older commit goes through dispatch, where
 * ancestry is verified. Each path states which check it ran, so a green run is
 * never ambiguous.
 *
 * It lives beside `verify-pack.mjs` — the other release-path assertion — and is
 * exercised by the package's test suite (tests/release-guard.test.ts), because a
 * guard is only worth what it does on the cases it exists to stop.
 *
 * Exit 0 = publish may proceed. Exit 1 = refuse, with the reason on stderr.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The manifest being published — resolved from this file, not the cwd, so the
 *  guard reads the version of the checkout it ships with. */
const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

function run(cmd, args, { allowFailure = false } = {}) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (err) {
    if (!allowFailure) throw err;
    return { ok: false, out: '', stderr: String(err.stderr ?? err.message).trim() };
  }
}

function fail(message) {
  console.error(`\n✖ RELEASE GUARD — refusing to publish.\n\n${message}\n`);
  process.exit(1);
}

function info(message) {
  console.log(`• ${message}`);
}

const short = (sha) => sha.slice(0, 8);

/** The current default-branch tip on origin, fetched fresh. */
function defaultBranchTip(branch) {
  const fetch = run('git', ['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], {
    allowFailure: true,
  });
  if (!fetch.ok) return { ok: false, reason: `could not fetch origin/${branch}: ${fetch.stderr}` };
  const tip = run('git', ['rev-parse', `refs/remotes/origin/${branch}`], { allowFailure: true });
  if (!tip.ok) return { ok: false, reason: `origin/${branch} did not resolve to a commit: ${tip.stderr}` };
  return { ok: true, tip: tip.out };
}

/** The commit a tag points at, resolved through annotated tags (`^{commit}`). */
function tagCommit(tag) {
  // Fetched explicitly: on workflow_dispatch the tag is not the ref being built,
  // so it is not in the checkout.
  const fetch = run('git', ['fetch', '--no-tags', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`], { allowFailure: true });
  if (!fetch.ok) return { ok: false, reason: `could not fetch ${tag} from origin: ${fetch.stderr}` };
  const rev = run('git', ['rev-parse', `refs/tags/${tag}^{commit}`], { allowFailure: true });
  if (!rev.ok) return { ok: false, reason: `could not resolve ${tag} to a commit: ${rev.stderr}` };
  return { ok: true, sha: rev.out };
}

function isAncestor(sha, tip) {
  // exit 0 also covers "sha IS the tip" — ancestry is inclusive.
  return run('git', ['merge-base', '--is-ancestor', sha, tip], { allowFailure: true }).ok;
}

function help() {
  console.log(`usage: node scripts/release-guard.mjs

Reads the workflow context from the environment, as GitHub Actions provides it:

  GITHUB_REF_TYPE   "tag" on a tag push, "branch" on workflow_dispatch
  GITHUB_REF_NAME   the tag (v0.1.0) or the branch name
  DEFAULT_BRANCH    the repository default branch
  DRY_RUN           "true" to skip the guard (nothing is published)

Exercise it against a tag that must NOT be publishable (run inside a clone whose
origin has the tag):

  GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v0.1.0 DEFAULT_BRANCH=main \\
    node scripts/release-guard.mjs`);
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return help();

  const refType = process.env.GITHUB_REF_TYPE ?? '';
  const refName = process.env.GITHUB_REF_NAME ?? '';
  const branch = process.env.DEFAULT_BRANCH ?? 'main';
  const dryRun = process.env.DRY_RUN === 'true';

  const pkg = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;

  if (dryRun) {
    // A dry run publishes nothing, so the invariant does not apply — but say out
    // loud which invariants are NOT enforced, so a green dry run is never
    // mistaken for a validated release.
    info(`dry run: would publish ${pkg.name}@${version}`);
    info('dry run: the tag=publish and commit-identity invariants are NOT enforced');
    return;
  }

  if (refType === 'tag') {
    const pushed = refName.replace(/^v/, '');
    if (pushed !== version) {
      fail(`the pushed tag is v${pushed} but this package is ${version}.\nThe tag and the manifest must agree — otherwise the run would publish a version nobody tagged.`);
    }
    info(`tag ${tag} matches ${pkg.name}@${version}`);

    const resolved = tagCommit(tag);
    if (!resolved.ok) fail(`cannot verify what ${tag} points at.\n${resolved.reason}`);

    // IDENTITY: on a tag push the tag must BE the default-branch tip.
    const base = defaultBranchTip(branch);
    if (!base.ok) fail(`cannot verify the tagged commit.\n${base.reason}`);
    if (resolved.sha !== base.tip) {
      const behind = isAncestor(resolved.sha, base.tip)
        ? ' It is BEHIND the tip — a stale branch was tagged.'
        : ' It is not on the branch at all.';
      fail(
        `${tag} points at ${short(resolved.sha)}, but ${branch} is at ${short(base.tip)}.${behind}\n\nPublishing would ship the older tree and consume the version number.\nFix: \`git pull --ff-only\`, delete the tag (\`git tag -d ${tag}\`), tag the tip again.\nIf publishing an older commit is deliberate, retag it and use the workflow_dispatch path, which validates ancestry instead of identity.`,
      );
    }
    info(`${tag} → ${short(resolved.sha)} = the current ${branch} tip`);
  } else {
    const exists = run('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], { allowFailure: true });
    if (!exists.ok) {
      fail(`no ${tag} on origin and this is not a tag push.\nA manual dispatch may only publish a version that is already tagged — the tag|publish invariant has no exception.`);
    }
    info(`tag ${tag} exists on origin (manual dispatch)`);

    const resolved = tagCommit(tag);
    if (!resolved.ok) fail(`cannot verify what ${tag} points at.\n${resolved.reason}`);

    // ANCESTRY: a retry republishes a tag pushed when the branch was at that
    // commit, so identity would block every legitimate retry.
    const base = defaultBranchTip(branch);
    if (!base.ok) fail(`cannot verify the tagged commit.\n${base.reason}`);
    if (!isAncestor(resolved.sha, base.tip)) {
      fail(`${tag} points at ${short(resolved.sha)}, which is not on ${branch} (tip ${short(base.tip)}).\n\nA tagged release must have landed on ${branch}. Retag once it is merged.`);
    }
    info(`${tag} → ${short(resolved.sha)}, on ${branch} (tip ${short(base.tip)})`);
  }

  info('invariant satisfied: tagged version, tagged on origin, commit verified');
}

main();
