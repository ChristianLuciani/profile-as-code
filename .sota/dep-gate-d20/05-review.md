# 05-review.md — sota-review of PR #115 (dep-gate / issue #98, D20 scope rule)

Reviewer: in-session adversarial pass (skill `sota-review`), following the
`renderer-md-safety` / `ci-typecheck-gate` precedent for direct-issue sessions.

**Model-routing gap declared:** session model = `glm-5.3-flash:cloud` (ollama) —
it is the same model that authored the code. Mitigation chain: (1) an
independent fresh-context adversarial reviewer ran on the same diff mid-session
(multi-model pattern) and returned REQUEST CHANGES whose Required finding was
real and is fixed; (2) the terminal doubt pass (`premerge-review` in a new,
clean session, refuting independently) is still owed — see §Final gate below.

**Preconditions — partially unmet, declared:** this change did not run through
`/sota-workflow`; no `01`–`04` artifacts exist. Review inputs:

- Contract: issue #98 (three acceptance bullets + trigger note) · SPEC §5 D20
  (the binding scope rule + its now-restated enforcement wording) · repo rules
  (AGENTS.md, session-discipline, repo-governance).
- Build: commits `e680338` (gate + self-test + CI + SPEC/docs sync),
  `1bf7228` (five-axis hardening), `dea8997` (fresh-reviewer findings),
  `d203f74` (this phase's MAJOR fix), branch `dsh/ci/dep-gate-d20`.
- Base: `main` @ `c69b4ea`. Diff size deliberately not pinned (precedent:
  `renderer-md-safety` F3/F4 — a stat in the artifact rots on the next push).

**Contract conflict declared (skill vs repo):** step 9 says "never push, never
open the PR yourself". `session-discipline` §1–3 makes the open, CI-green PR
the minimum delivered state and the more specific contract wins (AGOS
precedence) — same declaration as the #109 precedent. PR #115 was open before
this phase; CI green at every reviewed head (`run 36581561179` @ `dea8997`,
`run 36790410462` @ `d203f74`).

## Pass 1 — Spec fidelity → PASS

| #98 item | Evidence |
|---|---|
| "CI step that fails when `packages/server` (once it exists) declares any runtime dependency other than `core`" | Step present (`.github/workflows/ci.yml`, after setup-node, before install); Rule A checks all four runtime classes (`dependencies`/`peerDependencies`/`optionalDependencies`/`bundledDependencies`); fixtures `fail-server-{workspace,third-party,peer,optional,dir-name-mismatch}-*` + alias refusal `fail-server-alias-core` all **fail with a pinned `Rule A` marker** (self-test asserts the WHY, not just a fail). Red evidence: `spawnSync` of the exact CLI command on `fail-server-third-party-dep` → exit 1 with a `Rule A:` line — same "equivalent evidence" standard as the #109 precedent (a red CI run would need a mutated remote branch) |
| "fails if anything in `core`'s dependency graph reaches `server`" | Rule B BFS from `core` across all classes transitively; fixtures direct (`fail-core-depends-server`), transitive (`fail-core-transitive-server`), dev-class (`fail-core-devdep-reaches-server`) — all pinned `Rule B` |
| "can land with `packages/server` rather than before it; until then review-enforced" | Landed **before** the package: live check PASS-vacuous on the real workspace and *says so*; SPEC §5 wording restated to "enforcement lives in CI … vacuous until … rests on review" — honesty verified against the implementation (no overclaim found post-`R1`: "exists" is decided by the directory + on-disk guard, exactly what the rule arms on) |
| Trigger/related: D20 in SPEC §5; engine review PR #96/#97 | SPEC D20 section (line ~105–115) updated in the same commit that adds the gate; #96/#97 were context for the issue, nothing owed here |

## Pass 2 — Correctness → PASS (1 MAJOR fixed this phase)

Inherited from the two prior review rounds (recorded on the PR as the review
record comment): R1 false-pass (name-vs-directory arming) → fixed
`dea8997` — rule arms on `relDir === "packages/server"`; relocated-name E-GATE
kept; **on-disk-but-outside-globs E-GATE** closes glob drift; O1 `npm:` alias
escape → refused outright (`E-GATE`), fixture pinned; O2 malformed
`package.json` → GateError (no raw stack); O3 discovery `stat`-follows
symlinked dirs; N1 quote guard on comment-stripped line; N2
`bundledDependencies` added to runtime classes (SPEC parenthetical updated in
the same commit); N3 fixtures pin their rule + CLI exit probe before summary.

**This phase's own finding:**

- **MAJOR (fixed `d203f74`)** — `scripts/dep-gate/check.mjs` `parseWorkspaceGlobs`:
  an *indented key line* inside the `packages` section (e.g. a nested map)
  was matched by the top-level-key regex after `.trim()` and **silently
  switched the parse section off `packages`**, dropping later globs from
  discovery. That is a false-pass channel for Rule B (a dropped intermediate
  package hides a `core → md → server` path) and a direct breach of the
  module header ("a shape the gate cannot verify is an explicit failure,
  never a silent pass"). The shape is invalid for pnpm anyway; the gate now
  **E-GATEs** it; fixture `fail-workspace-nested-key` pins the refusal (17/17).

Remaining exposures (named, accepted at NIT level): (a) server *simultaneously*
renamed and relocated is outside the gate's vocabulary — by design, D20 makes
it a reviewable, SPEC-gated decision (declared in the module header); (b) yaml
shapes beyond block lists are pinned only by the fail-loud E-GATE, not by
positive fixtures; (c) core rename anywhere E-GATEs CI loudly (deliberate
fail-loud policy, message names the cause).

## Pass 3 — Coherence → PASS

Single worker + review rounds; seams checked: no orphaned helpers/exports
(`check()` is the only consumed function), docs enumeration (ci-cd.md) matches
`ci.yml` order exactly, AGENTS.md map row matches the script's actual behavior,
SPEC parenthetical matches `RUNTIME_CLASSES` one-for-one, error style uniform
(`E-GATE` prefix on every unverifiable shape).

## Pass 4 — Anti-trim (mechanical) → clean

Byte-true `loss_pat` over the deleted lines of `git diff origin/main...HEAD`:
**6 deleted lines, 0 normative-marker hits** (re-scanned at `d203f74`). The
deletions are the old SPEC §5 enforcement paragraph and the old ci-cd.md
enumeration line — both **superseded by replacements in the same diff**, so no
trace is even needed; recorded as evidence in this artifact.

## Verdict

**PASS** — 1 correction round in-phase (the nested-key MAJOR). Gate: armed,
fixture-pinned on both arrows and the identification seam (17 fixtures + CLI
exit contract + live vacuous check), docs/SPEC in sync, anti-trim clean.

## Final gate — terminal doubt pass still owed

Pre-merge fresh-context review requested. Open a new, clean session and paste:

```text
Run premerge-review on https://github.com/ChristianLuciani/profile-as-code/pull/115.
The PR is not yet merged.
Review READ-ONLY on the code — no worktree/branch/commit;
publish your report as a comment on the PR.
Ignore prior PR comments for independence; review the diff against
issue #98 and SPEC §5 (D20) only.
```

**Vehicles check (#163 corollary), declared:**
- This artifact (`05-review.md`) is **untracked** in the worktree on purpose —
  not in the branch/diff while the fresh pass runs. Commit it **after** the
  fresh pass + reconcile (repo convention: `.sota/<slug>/05-review.md` is
  tracked), together with the `## Fresh-context reconcile` section below.
- Declared contamination vehicles the fresh reviewer may already see on the
  PR: the review-record comment (author verdicts) and the fix-commit messages
  (`1bf7228`/`dea8997`/`d203f74` name the findings). History is not being
  rewritten to hide them; the fresh review instruction above tells the session
  to ignore prior PR comments and judge the diff against the contract.
- PR body declared scope/verification/impact only (no defect hypotheses) ✓.

## Fresh-context reconcile

In-session fresh reviewer (`subagent 6bc97afd`) findings classified — the
terminal `premerge-review` pass has NOT yet run, so this section records one
fresh round, not the terminal one:

- R1 (name-vs-directory false pass) → valid + actionable → fixed `dea8997`.
- O1 alias escape → valid + actionable → refused, fixture `fail-server-alias-core`.
- O2 crash rendering → valid + actionable → GateError wrap.
- O3 symlink discovery skew → valid + actionable → stat-follow.
- N1 quote guard on raw line → valid + actionable → fixed (and this phase
  corrects the record: the `1bf7228` message claimed too much, full-line only).
- N2 bundledDependencies → valid + actionable → added to runtime classes +
  SPEC parenthetical.
- N3 status-only assertions + summary order → valid + actionable → rule
  markers + reorder.
- F1–F4 (core-rename fail-loud, parser shape coverage, CI placement, ruleB
  internals) → noise/informational, no action.

Doubt-theater guard: 3 fresh findings were actionable (R1/O1/O3 family) across
two rounds — not an always-green pipeline.

## Post-testing feedback path (step 9)

Post-testing feedback from the human re-enters as **correction blocks** for
small findings (append to the branch with a fix commit + re-review) or a
**fresh `/sota-workflow` round** for large ones — for this branch the
correction-block path applies unless the operator says otherwise.

## Fresh-context reconcile — terminal pass

The terminal `premerge-review` (new clean session, read-only, published as a
[PR comment](https://github.com/ChristianLuciani/profile-as-code/pull/115#issuecomment-5921526640))
returned **PASS-CON-RIESGOS** (4 MAJOR + 2 NIT, each reproduced). The author
re-verified the two gate-green-light claims independently in `/tmp` before
classifying (no rubber-stamping): F1's evasion probe and F2's silent no-op
both reproduced. All six classified **valid + actionable** and were fixed in
`031a255`:

- F1 (MAJOR): range masquerade evades the name-keyed Rule B — `core deps
  {sneaky: file:../server}` → PASS. Fixed: workspace-named keys must use
  `workspace:`; local-path (`file:`/`link:`/`portal:`) ranges resolving
  inside a workspace package's directory → `E-GATE`. Probe re-run: exit 1
  with the masquerade message. Fixture `fail-core-file-alias-evade`.
- F2 (MAJOR): symlinked invocation = silent no-op (no output, exit 0).
  Fixed: realpath the entrypoint; `test.mjs` pins it through a temp-dir
  symlink.
- F3 (MAJOR): `fail-server-undiscovered` died at missing-core before the
  drift guard it claimed to pin. Fixed: discoverable core added; the on-disk
  guard itself now fires.
- F4 (MAJOR, narrowed): input guards over-broad — quoting now refused only
  on glob values; third-party `npm:` aliases on foreign keys legal again
  (`pass-third-party-alias-allowed`); workspace masquerade still refused via
  the protocol invariant (`fail-server-nonworkspace-core` = F6's pin).
- F5 (NIT): PR body verification numbers refreshed.
- F6 (NIT): workspace-copy resolution — covered by the protocol invariant.

Accepted risks: none. SPEC §5 gained the masquerade clause in the same run so
the contract names the full invariant. Re-verification: self-test 20/20 ·
lint/build/typecheck green · 304 workspace tests · CI green
(run 36791730664 @ `031a255`).

Loop bound (step 12): all actionable findings fixed and re-verified — the
gate is met; a confirmatory second fresh pass is optional and the operator
decides. Doubt-theater guard: 4 actionable MAJORs across the fresh report —
not an always-green pipeline.

**Artifact plan (declared):** this file was kept untracked while the fresh
pass ran (vehicle rule, #163 corollary) and is committed AFTER it, together
with this reconcile section — repo convention (tracked `.sota/<slug>/05-review.md`)
resumes from this commit.