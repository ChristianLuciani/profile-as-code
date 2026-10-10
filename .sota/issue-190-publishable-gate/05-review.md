# SOTA Review — issue #190 (`dsh/issue-190/publishable-gate`, PR #195)

- Date: 2026-10-10 (America/Guayaquil)
- Base: `origin/main` @ `c1ca30c`; branch head `51c3bc4`; merge-base `c1ca30c`
- Diff: 38 files, +485/−4 (36 of the files are one-line fixtures; ~390 lines are `check.mjs` + `test.mjs` + wiring)
- Reviewer: authoring session (same model that built the diff) — weak evidence, see limitation

## Limitation declared (preconditions unmet)

**Precondition 1 (spec/build) unmet.** There is no `.sota/<slug>/03-spec.md` / `04-build.md`
for this work: #190 was not produced by `sota-swarm`. Contract used instead: **issue #190
(four canonical fields)** plus the operator's task brief (the 4-part contract: gate shape,
`expandGlob` reuse, before-install wiring, two-direction proof). Same situation the #189
review declared.

**Precondition 2 (model rank) structural.** The reviewer is the same model
(`deepseek-flash`) that wrote the diff, satisfying "outrank or equal" only at equality —
an in-session PASS is weak evidence by construction. The terminal gate is the
fresh-context `premerge-review`.

**Deviation — the PR already exists.** `sota-review` normally precedes the PR and step 9
forbids opening it. At the operator's explicit instruction the branch was pushed and
PR #195 opened in the prior turn. This review therefore runs **post-hoc** on the open PR;
no push and no PR creation is performed here. Per the step-10 corollary this
`05-review.md` stays **untracked** — it is not in the branch/diff while the fresh pass runs.

## Pass 1 — Spec fidelity (adversarial)

Contract (issue #190 "Expected" + task brief), each check re-run at head `51c3bc4`:

- (a) cheap `--check` gate in the repo's shape → `check.mjs` in the `dep-gate` /
  `typecheck-gate` idiom (same `GateError`/E-GATE vocabulary, `isMain` realpath guard,
  `PASS`/`FAIL` exit contract). ✅
- (b) every workspace manifest except `packages/cli` declares `"private": true` →
  real tree: `publishable gate: PASS`, 12 packages, allowlist `packages/cli`; broken
  fixture: `FAIL`, exit 1, message names the package. ✅
- (c) explicit allowlist for future publishers → `DEFAULT_PUBLISHABLE` (directory-keyed,
  `check.mjs:56`) + a fixture that exercises a second allowlisted dir. ✅
- (d) fixture self-test FIRST → CI step runs `test.mjs` then `check.mjs`. ✅
- (e) node-only, zero deps → imports are `node:*` + `../dep-gate/check.mjs`. ✅
- (f) runs before `pnpm install` → CI step 10, install is step 11. ✅
- (g) reuse the walk, don't re-implement → `parseWorkspaceGlobs` + `expandGlob` imported
  (`check.mjs:44`); no second walker. ✅
- (h) do not touch `pnpm-workspace.yaml` nor mark packages → exact-path diff check at head:
  root `pnpm-workspace.yaml` and every real `packages/**/package.json` are **untouched**. ✅

Cheap checks re-run: `node scripts/publishable-gate/test.mjs` → 9/9 fixtures + CLI exit +
symlink; `node scripts/publishable-gate/check.mjs` → PASS on the real tree. No completion
check rests on a claim without evidence.

## Pass 2 — Correctness (adversarial)

Hunted silent-pass channels; none found that lets a non-private manifest outside the
allowlist through:

- non-literal `private` is rejected (`!== true`, not truthiness) — stricter than npm's
  publish guard, so no divergence that permits an extra publish. Fixtures `fail-private-false`
  and `fail-private-string` pin it.
- duplicate keys (`{"private": true, "private": false}`): `JSON.parse` keeps the last →
  fails conservative. Fine.
- shape the walk cannot verify → E-GATE (no workspace, empty globs, unparseable manifest,
  missing name). Fixtures cover all five; the parser-error translation was probed by hand
  (clean `E-GATE: pnpm-workspace.yaml: …`).
- a moved/renamed publisher cannot dodge the rule: the allowlist is directory-keyed, and a
  new package anywhere under the globs without `private` fails.

**Unhandled failure path found (NIT).** A manifest whose content is the JSON literal
`null` crashes with a raw `TypeError` instead of the declared E-GATE, because
`check.mjs:132` reads `manifest.name` on `null`:

```
TypeError: Cannot read properties of null (reading 'name')  at check (check.mjs:132)
```

Fails loud (exit 1), never a silent pass, and such a repo is already broken (install would
reject it) — hence NIT, not MAJOR. It is **not introduced uniquely here**: `dep-gate:198`
and `typecheck-gate:92` crash identically (probed), so it is the copied idiom. Remedy:
guard non-object manifests before reading `.name`.

**One-directional invariant (NIT, accepted risk).** The issue *title* says "exactly one
non-private package"; the gate enforces only "nothing outside the allowlist is non-private".
Probed: with `packages/cli` set `"private": true`, the gate **PASSES**. The post-hoc
`release-guard.mjs` + `npm publish` (EPRIVATE) catch it at release time, so the failure is
deferred, not silent-forever. The issue's "Expected" text is explicitly one-directional and
the gate header states "one direction", so this matches the written contract — recorded as
an accepted risk, the fresh pass may disagree.

## Pass 3 — Coherence

Single authoring worker → no inter-worker seams. Cross-gate consistency checked:

- vocabulary matches siblings: `GateError`/E-GATE, `isMain` realpath guard (dep-gate
  premerge F2), `PASS`/`FAIL` final line.
- helper duplication (`exists`, `readManifest`, `isMain`, `GateError`) is the established
  per-gate pattern; the only thing that *must* be shared (the workspace walk) is shared.
- `_expect.json` uses `marker` (typecheck-gate's key) where dep-gate uses `rule` — a
  harmless naming divergence across sibling self-tests, not a seam.

**NIT** — the header (`check.mjs:21`) refers to `` `PUBLISHABLE` `` but the constant is
`DEFAULT_PUBLISHABLE` (`:56`); a future reader grep'ing `PUBLISHABLE` does not find the
declaration.

## Pass 4 — Anti-trim (mechanical, canonical `premerge-review` §Anti-trim)

Criterion resolved at path (a), the projected sibling
`/Users/eva/.dsh/skills/premerge-review/SKILL.md` §Anti-trim pass (present, not stale),
cross-checked identical against path (b) `skills-studio/registry/authored/premerge-review/SKILL.md`
lines 121–122. Canonical `loss_pat` used byte-true.

- Deleted lines in `git diff origin/main...HEAD` (excluding `---` headers): **4** — all in
  the `docs/ci-cd.md` Dependabot bullet.
- Normative-marker matches among those 4: **0**
  (`nunca|NUNCA|Nunca|jamás|Jamás|prohibid|Prohibid|obligator|Obligator|MUST|NEVER|OFICIAL|[a-z][a-z0-9_]*[[:space:]]*=|\[[a-z][a-z0-9_]*\]|[A-Z][A-Z0-9]*_[A-Z0-9_]+`).
- Semantics also survive: the deleted text ("fixtures undiscoverable, materialized at test
  time", "`dependency_file_not_parseable` gone by construction (#166)", "`exclude-paths`
  belt-and-braces") is present in the replacement lines, extended to name both gates.

→ no undeclared trim; no BLOCKER.

## Findings

- **NIT** — `check.mjs:132`: `null` manifest → raw `TypeError`, not E-GATE. Fail-loud;
  inherited idiom. No action required to pass.
- **NIT** — `check.mjs:21`: header says `PUBLISHABLE`, const is `DEFAULT_PUBLISHABLE`.
- **NIT (accepted risk)** — the reverse invariant (an allowlisted publisher accidentally
  `private: true` passes) is not enforced; backstopped at release by `release-guard.mjs`
  + EPRIVATE. Matches the issue's one-directional "Expected".
- **NIT** — `check.mjs:73-79`: the parser-error→E-GATE translation is not covered by a
  committed fixture (probed by hand, works).

0 BLOCKER, 0 MAJOR, 4 NIT.

## Verdict

**PASS** — in-session: 0 BLOCKER, 0 MAJOR, 0 MAJOR-touching-acceptance, 4 NIT.

Rounds: 1. No correction block required; the NITs are optional hardening.

Handoff after human testing: small findings → correction block; large → fresh
`/sota-workflow` round.

## Fresh-context gate

Done — the operator ran `premerge-review` in a clean session; the report landed as a comment on
PR #195 (`Verdicto: PASS-CON-RIESGOS`, 0 blocker · 1 major · 2 nit; head `51c3bc4`). The artifact
stayed untracked through that pass; the PR body carried scope/verification/impact only, so no
sanitization was needed (corollary #163). Reconcile below.

## Fresh-context reconcile (skill step 11)

Fresh report: PR #195 comment (2026-10-10), `PASS-CON-RIESGOS` · 0 blocker · 1 major (F1) ·
2 nit (F2, F3). Reviewer ran read-only from a `/tmp` tarball copy of head `51c3bc4`; anti-trim
clean. Verdict is INFORMATIVE; re-read the diff against each finding before classifying (done).

- **F1 — `test.mjs:67` · MAJOR → valid + actionable. APPLIED.**
  Confirmed empirically *before* touching anything: a gate honoring only `globs[0]` passes the
  current self-test 9/9 **and** the real-tree run, silently unguarding the 8 renderers under the
  nested `packages/renderers/*` glob — the exact silent-pass class #190 exists to close. Fix
  (test-only): fixture `fail-nested-glob-violation` (two globs, second nested, the only violation
  under the second). Proof: correct gate 10/10; mutated gate 9/10 with
  `FAIL fail-nested-glob-violation: expected fail, got pass`; mutated gate on the real tree still
  PASS — so the fixture, not the real run, is the discriminator.
- **F2 — `check.mjs:110-122` · NIT → valid trade-off. DECLARED.**
  A manifest outside the workspace globs is out of scope: not reachable by `pnpm -r publish`.
  dep-gate refuses a non-member `packages/server` because its rule ARMS on that fixed directory;
  this gate has no fixed subject. Closed by declaration (header `Scope:` paragraph), not code.
  Accepted risk recorded.
- **F3 — `docs/ci-cd.md:160` · NIT → valid + actionable. APPLIED.** The undiscoverable-name
  enumeration now lists `fixture.package.invalid-json`.
- No contract misreads, no noise. The reviewer's refutations (CHANGELOG not owed — sibling gate
  PR #186 also didn't touch it; no SPEC update owed) are accepted as-is; they remove work, not add.
- In-session NITs not raised fresh: header `PUBLISHABLE`→`DEFAULT_PUBLISHABLE` fixed in this round;
  the `null`-manifest crash and the untested parser-translation branch remain open (optional,
  fail-loud, inherited idiom).

## Post-reconcile re-review (in-session, step 8)

Re-ran the four passes on the corrected diff: spec fidelity unchanged (adds a fixture + a doc line
+ a comment); correctness unchanged (the F1 fix is test-only, no gate behavior moved); coherence
improved (the header now names the real constant and the scope boundary); anti-trim re-scanned —
this round only adds lines, its single deletion is the `docs/ci-cd.md` word-swap, 0 markers.

Verification of the corrected head: `pnpm lint`, `pnpm build`, `pnpm typecheck`, `pnpm test`,
publishable-gate self-test (10/10) + check, and all sibling gates (dep-gate, typecheck-gate,
renderer-map, link-check, gen-platforms) — all green.

Verdict after reconcile: **PASS** — 0 blocker, 0 major, 0 actionable nit.

## Post-merge closure (2026-10-10)

PR #195 merged to `main` as `30fbd01` (true merge — both commits, `51c3bc4` and `fab2f7b`,
preserved with their DCO/Session trailers); #190 closed by `Closes #190`; `main` CI green at the
merge commit; remote branch auto-deleted. Impact was declared `none`, so there is nothing to
reconcile post-merge. No second fresh pass was run: the only finding of consequence (F1) was a
test-only coverage gap, fixed and re-verified in-session.

This artifact is recorded in the follow-up PR (the #189 → #191 pattern).

## Post-merge follow-up (this PR)

The two remaining in-session NITs are closed here:

- a manifest that parses as JSON but is not an object (`null`) now yields `E-GATE` instead of a
  raw `TypeError` — `check.mjs`, fixture `fail-non-object-manifest`;
- the parser-error → E-GATE translation now has a fixture, `fail-workspace-shape`.

Self-test: 12/12. The same `null`-manifest crash still exists in `dep-gate/check.mjs` and
`typecheck-gate/check.mjs` — structural (≥2 artefacts), named and escalated as **#198**.

Round count: 1 in-session + 1 fresh + 1 reconcile + 1 post-merge follow-up.
