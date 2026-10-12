# 05-review — release-runbook truth (#207, #208)

**Durable record, committed after the fact.** While the fresh-context pass ran, this
file was deliberately kept **outside** the branch: it holds the author's verdicts and
remedies, and `premerge-review` reads the diff by construction, so shipping it would
have handed the reviewer the claim (corollary, #163). The fresh pass has now run
(PR #217 comment `6133794380`) and the PR is merged, so the file lands here as the
durable record — in a **separate** admin PR, and **not** in PR #217's diff.

- Base: `main` @ `4caf6fe` · Head reviewed: `60deafb`, reconciled at `2e97cb4`
- PR: #217 · **merged** as `12f9c6e` (2026-10-12T22:42:56Z)
- Reviewed: 2026-10-12

## Preconditions — two do not hold

1. **No `03-spec.md` / `04-build.md` anywhere in this repo.** `.sota/` carries 21 files
   and every one is a `05-review.md`; there is no spec/build artifact for any slug, and
   none for this work. This was **not** a `/sota-workflow` build: it is a direct operator
   task with two tracked issues (#207, #208) and a handover decision. So "walk `## Task
   blocks`" has no source. Substituted with the two issues' `Esperado` sections as the
   acceptance criteria — recorded below so the substitution is visible, not silent.
2. **Model tier.** This phase "belongs to the strongest available model"; the session runs
   `deepseek-flash`. This review is therefore **not** a qualifying sota-review pass by the
   skill's own rule — it is an in-session adversarial pass whose eventual
   `premerge-review` in a fresh session is the real gate. Stated rather than glossed.

A third precondition does hold: the sibling `premerge-review/SKILL.md` is projected next
to this skill at `/Users/eva/.dsh/skills/`, and it **does** carry `§Anti-trim pass`
(line 68) — the projection is current, not the stale text-only copy.

## Pass 1 — Spec fidelity

| Criterion (from the issues) | Demonstrated? | Evidence |
|---|---|---|
| #207: three surfaces stop declaring 0.2.0 as latest | ✅ | `grep -E "0\.2\.0" \| grep -v v0\.2\.0` on `60deafb`'s `docs/USER-GUIDE.md`, `README.md`, `packages/cli/README.md` → no non-`v0.2.0` hits |
| #207: numbers contested against real sources | ✅ | registry `dist-tags.latest=0.3.0`, `time` `03:43:27Z`; tag → `21e4cde`; Release `03:42:42Z` — all reproduced |
| #207: `STANDARDS.md` header, item 3, "To go public" | ✅ | diff `docs/STANDARDS.md` |
| #207: test figure with date + command | ✅ | 447/27; raw suite lines sum to 447; 27 `*.test.ts` on disk |
| #207: `## [0.3.0] - <date>` matches the tag | — | not this branch's business; `CHANGELOG.md` untouched (`git diff --name-only … -- CHANGELOG.md` → 0) |
| #208: a primary path that really publishes | ✅ (dispatch) | 5-run table reproduced via `gh run list`; dispatch run `38109158435` `success` |
| #208: runbook says the same as the workflow | ❌ | the runbook's *current* state refuses the tag push, but the workflow's own header comments still assert the opposite — see F2 |

**Claimed without evidence = FAIL.** One claim in the authoring session's own report is
**overstated**: the PR body and commit message assert the #208 runbook half is "done". It
is done for the *publish* half; it is not done for the file that a maintainer actually
opens (`release.yml`). Recorded as F2, not as a NIT — #208's closing criterion is a literal
statement about the workflow.

## Pass 2 — Correctness

No defect that breaks a documented procedure. One omission in the new primary-path
section, recorded as F1. Security: nothing touches input or credentials; the PR removes a
credential narrative rather than adding one. Doc-only, so no runtime surface.

## Pass 3 — Coherence

The two surfaces that #208 requires to agree now disagree in the opposite direction from
before. Before: runbook described the tag as publishing. After: runbook says the dispatch
publishes, workflow header says the tag publishes. This is a seam of the same kind the PR
was written to close (F2). Everywhere else the surfaces are consistent: `.sota/` is
referenced only in a CI context that is unchanged, and `0.2.0` vs `v0.2.0` usage is
uniform (bare version for npm versions, `v`-prefixed for tags).

## Pass 4 — Anti-trim (canonical criterion, `premerge-review` §Anti-trim pass)

Mechanical scan — canon `loss_pat`, taken verbatim from the sibling:

```bash
git diff 4caf6fe...60deafb | grep '^-' | grep -v '^---' \
  | grep -nE 'nunca|NUNCA|Nunca|jamás|Jamás|prohibid|Prohibid|obligator|Obligator|MUST|NEVER|OFICIAL|[a-z][a-z0-9_]*[[:space:]]*=|\[[a-z][a-z0-9_]*\]|[A-Z][A-Z0-9]*_[A-Z0-9_]+'
```

Six deleted lines matched. Marker `[OFICIAL]` on five; `NODE_AUTH_TOKEN` / `NPM_TOKEN`
(UPPER_SNAKE) on three; a table row `… | \`NPM_TOKEN\` |` (payload-key) on one.

For each, the three traces:

1. **Survives?** In this repo, differently from the canon's letter. The registry paths
   trace 1 names (`skills-studio/registry/authored/`, `prompt-studio/registry/specs/`) are
   surfaces of the **skills/prompt studios**, and `registry/`, `skills-studio/`,
   `prompt-studio/` **do not exist** in `profile-as-code` — checked with `ls -d`. So trace 1
   is **unavailable in its literal form**, and I say so rather than claim it. The stronger
   property holds instead: every deleted normative token **is present in the head commit of
   the artifact it was deleted from** — `git show 60deafb:docs/STANDARDS.md` → `[OFICIAL]`
   ×1, `git show 60deafb:docs/ci-cd.md` → `[OFICIAL]` ×3, `NPM_TOKEN` ×4,
   `NODE_AUTH_TOKEN` ×2. A clause cannot be lost to a reader of the file while its token is
   still in the file. The deletions are a **version/evidence rotation** (`[OFICIAL]` block
   re-dated 2026-10-09 → 2026-10-12; 0.2.0 evidence superseded by 0.3.0), not a retirement
   of a rule. In particular the deleted instruction `4. **Then** delete the \`NPM_TOKEN\`
   repository secret *and* the \`NODE_AUTH_TOKEN\` env…` is subsumed by head's migration
   history, step 4, which reads `Do not re-add it`.
2. **Sidecar? Unavailable** — this repo has no `*.provenance.md` (`find . -maxdepth 3 -name
   '*.provenance.md'` → empty). Said explicitly, per the criterion.
3. **PR body `Trim:`?** Absent (`gh pr view 217 --json body --jq .body | grep -n 'Trim:'` →
   no match). Not required, because no trim is undeclared.

**Result: no undeclared normative trim. No BLOCKER from this pass.** The one substantive
deletion — the `NPM_TOKEN` deletion *instruction* — survives as the same rule in
present-tense history, so the eventual PR body does not owe a `Trim:` line.

## Findings

### F1 — MAJOR — the new primary path never mentions the smoke input that skips the guard

`docs/ci-cd.md:410–421` (`### Releasing — the primary path (issue #208)`).
The section makes `workflow_dispatch` the official path and tells the operator
`gh workflow run release.yml --ref main`, but never mentions the workflow's `dry_run`
input (`release.yml:23–27`, described there as *"Smoke the pipeline without publishing
(skips the tag guard…)"*). Under `dry_run`, `release-guard.mjs:196` returns early and
prints *"the tag=publish, commit-identity and tagged-manifest invariants are NOT
enforced"* — so a smoke run validates **none** of the release invariants. The guard is
honest about this in its own log; the runbook, in the section that now defines the primary
path, is silent. An operator who smokes with `-f dry_run=true` and then publishes has no
prompt from the runbook that the smoke proved nothing about the invariants.
**Remedy:** one sentence in step 3 or a `> Note` naming `-f dry_run=true` as the harmless
smoke and stating the guard is skipped under it, so the real publish is dispatched with no
input.

### F2 — BLOCKER — `release.yml` still tells the maintainer the opposite of the new runbook

`.github/workflows/release.yml:3–16` and the `Publish` step comment (`:139–147`).

> `# …The FIRST tag push (v0.2.0) is the operator's publish action — pushing the tag IS publishing…; workflow_dispatch is for retries.`
> `# …so NPM_TOKEN is kept only as the fallback for the first publish…`
> `# Delete the secret only after the trusted publisher is configured and a publish through it is verified`

All three are now false, and #208's closing criterion is *"el runbook diciendo lo mismo
que el workflow"*. The runbook was rewritten; the workflow's prose was not, and the
workflow is the file a future maintainer or agent reads first — it will conclude that
pushing a tag publishes. The PR body compounds this by asserting the runbook half is
"done".
**Trace status for the `NPM_TOKEN` clause here:** it is deleted from *ci-cd.md* but still
asserted as live in *release.yml*, i.e. the rule was not retired, merely relocated to a
surface that now contradicts the runbook. That is the failure the criterion exists to
catch, in the direction the criterion does not enumerate.
**Remedy (needs the operator):** rewrite `:3–16` and the `Publish` comment to the new model
— dispatch publishes, the tag marks the version, the secret is deleted, no token fallback.
Comments carry no executable behaviour, so this is **not** a change to the mechanism that
#113 decision 5 froze; but the line is the operator's to draw, so the authoring session did
not cross it unilaterally.

### F3 — MAJOR — the file is pushed well past the size boundary with no decomposition

`docs/ci-cd.md` 416 → **535** lines (+29%). One file now carries CI, Dependabot/hardening,
release mechanics, npm auth, OIDC migration history, the primary-path runbook, and the
open mechanism question. The presumptive-blocker rule applies: the change materially grows
an already-large file. The cleanest extraction is the `#### Migration history (complete —
do not re-run)` block (~30 lines explicitly "not instructions"), which belongs in the
repo's existing frozen-history home: `.sota/` is already excluded from the link gate *by
decision* ("frozen historical artifacts, not live docs"), and `ci-cd.md` already points at
`.sota/release-github-58/05-review.md` for a residual risk.
**Remedy:** move that block to `.sota/release-oidc-migration/` and leave a one-line pointer.

### F4 — NIT — a hardcoded line reference that will rot

`docs/ci-cd.md:430` cites `release.yml:167`. The condition `if: needs.publish.outputs.tag
!= ''` is the durable identifier and is already quoted in the same sentence; prefer it
alone.

### F5 — NIT — the changed evidence command is weaker than the one it replaced

`docs/USER-GUIDE.md:111–113` and `docs/STANDARDS.md` item 3 swap
`npx @profile-as-code/cli@0.3.0 --version` for `node packages/cli/dist/index.js --version`.
Those are different operations — the first installs the published tarball, the second runs
a local build — so the replacement does not evidence the *published* artifact. Disclosed
in the PR body (the sandbox cannot write `~/.npm/_logs`), so the honesty is intact; a
`npm view @profile-as-code/cli bin` reference would back it directly.

### F6 — NIT — one inference stated as observation

The `[OFICIAL]` state table row asserts `NPM_TOKEN` is "deleted in npm **and** in GitHub".
Observed: the *variable* was empty in the tag run. The npm-side deletion is corroborated
only by the absence of a fallback. Sound, but it is inference; one clause distinguishing
observed from inferred would be exact.

## Doubt-theater guard

Findings exist and three are actionable (F1, F2, F3). This is not an always-green pass.

## Verdict: FAIL

One BLOCKER (F2) plus two MAJORs (F1, F3) touching the acceptance criteria of #208.
Anti-trim: clean, no BLOCKER. Preconditions 1 and 2 do not hold (no spec artifact; model
below the phase's tier), recorded above rather than glossed.

## Correction blocks

The skill's FAIL path appends these to `03-spec.md` and hands back to `sota-swarm`. **That
path does not apply here**: there is no `03-spec.md` and no swarm — the work is a direct
task. The blocks are therefore stated for the operator, who decides.

| # | Change | File | Owner |
|---|---|---|---|
| C1 | Add the `dry_run` note to the primary-path section | `docs/ci-cd.md` step 3 | authoring session — safe |
| C2 | Extract the migration history, leave a pointer | `docs/ci-cd.md` → `.sota/release-oidc-migration/` | authoring session — safe |
| C3 | Rewrite the workflow header + `Publish` comments to the new model | `.github/workflows/release.yml:3–16`, `:139–147` | **operator decision** — crosses decision 5's line for a comments-only edit |
| C4 | Correct the PR-body claim that the #208 runbook half is "done" | PR #217 body | authoring session — safe |

C1, C2, C4 are inside the frozen-docs boundary and reversible. C3 is the one blocking
closure of #208 and is the operator's call.

## Final gate — fresh-context pass (not yet run)

Must run in a NEW, clean session against the unmerged PR, and must **not** receive this
file or any of the findings above.

```text
Pre-merge fresh-context review requested.
Open a new, clean session and paste:
  "Run premerge-review on https://github.com/ChristianLuciani/profile-as-code/pull/217.
   The PR is not yet merged.
   Review READ-ONLY on the code — no worktree/branch/commit;
   publish your report as a comment on the PR."
```

Verified before handing over: the loaded `premerge-review/SKILL.md` **does** describe
publishing (`§Anti-trim pass` present at line 68), so the projection has not drifted to the
old text-only contract.

---

## Fresh-context reconcile (round 1)

Fresh report: PR #217 comment `6133794380`, **PASS-CON-RIESGOS**, 0 blocker /
4 major / 3 nit. Verdict is INFORMATIVE; classification below is the author's,
each finding re-read against the diff before classifying (not rubber-stamped).

### 1. Contract misread
None. The fresh reviewer had the issues and the diff, and every finding is about
the artifact, not about an unclear contract. No `03-spec.md` wording to fix (the
precondition section above already records that no spec artifact exists).

### 2. Valid + actionable
- **F1 — `docs/ci-cd.md` claimed the `NODE_AUTH_TOKEN` env was removed.** Correct
  and worse than I had framed it in my own pass: the env was never removed,
  `release.yml:155` still declares it, it merely resolves empty. **Fixed** in
  `2e97cb4`.
- **F3 — `STANDARDS.md` item 2 cited "last runs on main: 2026-10-05"** beside a
  2026-10-12 measurement. Re-verified against the Actions API: `ci` runs on
  10-10, 10-11, 10-12 all `success`. **Fixed**.
- **F4 — a local-build check cited under `[OFICIAL] [WEB: registry.npmjs.org]`.**
  Correct: `node packages/cli/dist/index.js --version` exercises a local build,
  not the published tarball, so it cannot sit under a registry citation.
  **Fixed** by separating the registry facts from the local check in all three
  surfaces and labelling the latter.
- **F2 — `release.yml:3–6` still says the tag publishes.** Correct, and it
  **refutes my own account**: I had called the #208 gap "Release-creation only".
  It is not — the criterion is unmet on the publish half too. Workflow file left
  **untouched** (operator decision, `4caf6fe...2e97cb4` touches 5 docs only);
  `docs/ci-cd.md` gained an explicit "Known divergence" note naming the stale
  lines, and the PR body's false "done" claim was withdrawn and its Impact
  bullet corrected.

### 3. Valid trade-off
None raised.

### 4. Noise
None. Every one of the four majors reproduced against the record — an unusually
clean fresh pass, and the two findings it holds that my own pass missed (F1's
severity, F2's framing) are exactly the blind spots a same-session review has.

### My own F5/F6 (nits, not raised by the fresh pass)
- F5 (the `npx` → `node dist` evidence swap): the fresh pass's **F4** is the same
  observation with a sharper consequence; resolved by the F4 fix.
- F6 (inference stated as observation, the npm-side deletion): not raised;
  remains a recorded nit, and F1's fix now makes the surrounding text exact about
  what was and was not touched.

### Anti-trim, rescan
Re-ran the canon scan on the **new** diff (condensation rounds are not exempt):
6 deleted lines still match; `OFICIAL` ×4, `NPM_TOKEN` ×4, `NODE_AUTH_TOKEN` ×2
all survive in the head. Independently matches the reviewer's pass. No undeclared
trim, no PR-body `Trim:` line owed.

### Round status
BLOCKER **F2 remains open by design** — it is an operator decision (C3), not a
worker correction. F1/F3/F4 corrected in-session. Loop bound not reached (1
fresh round). A second fresh invocation is unnecessary: the remaining item is not
a defect shape a rebuild can resolve, it is a decision.

---

## Post-merge closure (2026-10-12)

- PR #217 **MERGED** by the operator 2026-10-12T22:42:56Z; merge sha **`12f9c6e`**
  (parents `ff99e72` + `2e97cb4`). `ci` + `sign-off` green on the merge sha
  (run `38318225120`, success). Remote branch auto-deleted.
- The head reviewed above (`2e97cb4`) **is** a parent of the merge, so the artifact
  the verdict applies to is byte-identical to what landed. No post-merge drift.
- **#207 CLOSED** (2026-10-12T22:44:30Z) with the verify-close evidence comment:
  GitHub did **not** fire the `Closes #207` keyword (present in the body, so it is
  a GitHub mechanic, not a missing declaration) — closed manually per
  `issue-lifecycle` §Cierre, which requires verifying the merge before closing.
- **#208 kept OPEN** and re-scoped: the runbook half is done; the residual is the
  stale prose in `release.yml:3–16` and the `Publish` step comment, plus the still
  unratified mechanism choice (a/b/c). See comment `6134055972`.
- **Review artifact placement.** The skill's FAIL path wants `05-review.md` on the
  branch; the #163 corollary forbids it while the fresh pass runs. Since the fresh
  pass is complete and the PR merged, it now lives at
  `.sota/release-runbook-truth/05-review.md` as the durable record. It is **not**
  part of PR #217's diff and was **not** committed — `main` is clean.

### Round count
1 in-session adversarial pass + 1 fresh-context pass (`premerge-review`,
comment `6133794380`). Findings: 4 majors, all reproduced; 3 fixed in-session, 1
(`release.yml` prose) declared open and re-scoped to #208. Anti-trim clean, and
the fresh pass reached the same conclusion independently.
