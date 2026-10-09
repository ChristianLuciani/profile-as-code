# SOTA Review — #189 (`dsh/chore/private-internal-packages`)

- Date: 2026-10-09 (America/Guayaquil)
- Base: `origin/main` @ `8bf1c1b` (merge of #188); branch head `6fca79a`; merge-base `57d8b66`
- Diff: 11 files, +11/−0 (`CHANGELOG.md` not touched by this branch)
- Reviewer: authoring session (same model that built the diff) — weak evidence, see limitation

## Limitation declared (precondition 1 unmet)

There is **no `.sota/<slug>/03-spec.md` / `04-build.md`** for this work: #189 was not
produced by `sota-swarm`. `.sota/release-v0.2.0/` only holds a `05-review.md` (no
spec/build). Contract used instead: the **D3 3c decision** (recorded in #188's body
and this change), **issue #113**, and repo conventions (`release.yml` publishes only
`packages/cli`; `AGENTS.md`; `docs/STANDARDS.md` item 3).

Also: the reviewer is the same model that wrote the diff, so an in-session PASS is
weak evidence by construction. The terminal gate is the fresh-context `premerge-review`.

## Pass 1 — Spec fidelity (adversarial)

Acceptance (D3 3c): (a) exactly the bundled-only packages become `private`;
(b) `packages/cli` stays publishable; (c) gates/CI keep passing.

- (a) ✅ 11/11 marked: `core`, `markdown`, `paste` + 8 renderers = the 12 workspace
  packages minus `cli` (root is already private). Verified by manifest sweep.
- (b) ✅ `cli` untouched; sweep over all manifests → exactly **1** non-private
  publishable (`@profile-as-code/cli` 0.2.0).
- (c) ✅ gates + CI green (evidence in PR body; re-run below).

No completion check rests on a claim without evidence.

## Pass 2 — Correctness (adversarial)

- `private` does not affect workspace resolution: `pnpm install --frozen-lockfile`
  and the recursive build/typecheck/test pass.
- The CLI tarball is self-contained (deps bundled into `dist`), so a private dep
  cannot break `npm publish` of the CLI; `verify:pack` smoke passed (`pasco 0.2.0`).
- `attw --pack` / `verify:pack` pack `private: true` packages fine with a clean npm
  cache; the earlier `EPERM` was a local root-owned `~/.npm/_cacache` (environmental),
  not the flag.
- Consequence: publishing a private package later requires removing the flag —
  intended explicitness, one-line reversal.

No BLOCKER, no MAJOR.

## Pass 3 — Coherence

- 11 edits uniform: `"private": true,` immediately after `name`, boolean `true`.
- The alphabetically-sorted manifests (v1.8/v1.9 renderers) keep order
  (`main`, `name`, `private`, `scripts`).
- No other file changed; no duplicated helper; parallel edits have no seam.

## Pass 4 — Anti-trim (mechanical, canonical `premerge-review` §Anti-trim)

- Deleted non-header lines in `git diff origin/main...HEAD`: **0**.
- Normative-marker matches among deleted lines: **0**.
- → no undeclared trim; no BLOCKER.

## Findings

- **NIT** — the `attw` CI loop still packs the 11 private packages (~11 extra packs).
  Harmless; skipping private would clarify intent. No action required.
- **NIT** — private packages retain publish metadata (`repository`/`bugs`/`homepage`/
  `keywords`/`files`); internally inconsistent but harmless and preserves future
  publishability. No action required.

## Verdict

**PASS** — in-session: 0 BLOCKER, 0 MAJOR, 2 NIT.

Handoff after human testing: small findings → correction block; large → fresh
`/sota-workflow` round.

## Fresh-context gate

Done: operator ran `premerge-review` in a NEW, clean session; report published as a
comment on PR #189 (line 1 `Verdicto: PASS`, YAML block present, head `6fca79a`).
The PR body was sanitized of author findings/verdict before that pass
(corollary #163). This `05-review.md` stayed **untracked** — not in the branch/diff.

## Fresh-context reconcile (skill step 11)

Fresh report: `PASS` · 0 blocker · 0 major · 1 nit. Verdict is INFORMATIVE; the
authoring session reconciles (re-read the diff against each finding before
classifying).

- **F1 — no CI enforcement of the "only `packages/cli` is publishable" invariant.**
  Classified **valid + actionable (deferred)**, not a defect of #189: the reviewer
  agrees the diff is correct and calls it durability. The remedy is a cheap
  `--check` gate in the repo's existing shape (`dep-gate`/`schema-check`/`gen:*`).
  Deferred rather than added here because #189 already PASSed and the loop bound
  stops on NIT-only; captured as **follow-up issue #190** so it is not lost. Accepted
  risk until it lands: a future workspace package added without `private` rejoins the
  accidental-publish surface with CI green.
- No contract misreads, no noise, no other actionable findings.
- Verified nuance accepted and recorded: `npm publish --dry-run` does not exercise
  the `EPRIVATE` guard (real publish path only), so a dry-run smoke is not evidence
  of the guard.
