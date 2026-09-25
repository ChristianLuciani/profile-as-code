# 05-review.md — sota-review of PR #109 (ci-typecheck-gate / issue #108)

Reviewer: in-session adversarial pass (skill `sota-review`).

**Model-routing gap declared:** session model = `glm-5.3-flash:cloud` (ollama) —
it is **the same model that authored the code**, below the skill's "strongest
available" requirement. Skill step 2 says to switch up before continuing; the
mitigation used here is the step-9 terminal doubt pass (`premerge-review` in a
fresh, clean session, refuting independently), which is where a stronger or
merely *different* context actually applies. Same shape as the
`renderer-md-safety` precedent (`05-review.md`).

**Preconditions — partially unmet, declared:** this change did **not** run
through `/sota-workflow`; it is a direct issue session on #108. There is no
`03-spec.md` / `04-build.md`. Review inputs:

- Contract: issue #108 (`## Expected`, boundary, ADR-lite) · `docs/ci-cd.md`
  (documents `pnpm typecheck` as the type gate) · repo rules (AGENTS.md,
  session-discipline, repo-governance).
- Build: commits `6dd5c0e` (CI gate) + `5bdd231` (docs sync from the in-branch
  review pass) + `6c13cb0` (this artifact), branch `pi/pi/ci-typecheck-gate`.
- Base: `main` @ `fed676f`. Diff size **deliberately not pinned** (precedent:
  `renderer-md-safety` F3/F4 — a stat written into the artifact rots on the
  next push); exact value at review time: `git diff --shortstat main...HEAD`.

**Contract conflict declared (skill vs repo):** step 8 says "never push, never
open the PR yourself". `session-discipline` §2–3 makes the open, CI-green PR the
minimum delivered state, and the more specific contract wins (AGOS precedence).
PR #109 was open before this phase. Flagged, not silently resolved.

## Pass 1 — Spec fidelity → PASS (1 deviation accepted-with-evidence, 1 declared)

| #108 item | Evidence |
|---|---|
| "ci.yml gains a step that runs the type gate, failing the job on a type error" | Step present (`ci.yml:61-64`); CI run `36186160948` green on the clean tree; **red test executed with the step's exact command**: injected `const n: number = "x"` into `packages/cli/src/index.ts` → `pnpm build` passes (tsup transpile-only), `pnpm typecheck` fails `TS2322`+`TS6133` → step exits 1 → job fails. Reverted after. Declared honestly: demonstrated by *equivalent* evidence (same command, `bash -e` semantics), not by an actual red CI run — that would need a mutated remote branch |
| "Root `pnpm typecheck` already fans out … so one step covers the workspace" | CI log shows 5 packages type-checked in topological order (core → markdown → readme → org → cli) |
| "ordering should follow the existing fail-fast rationale" | Gate at `gen:zod < Typecheck < Test` — before Test (verified in the run timeline: 02:47:11–22 vs Test 02:47:22) |
| Boundary: "1 file to change" | **Breached, declared:** 4 files. The breach is the two-pass review's Required finding (docs that *enumerate* CI steps went stale). Justified by evidence, declared in the PR body under Impact — not a silent expansion |
| Boundary: "`src/` only", "not chosen: `dts: true`" | CLI `tsconfig.json` and `tsup.config.ts` untouched (diff confirms) |

## Pass 2 — Correctness → PASS (residuals below)

Adversarial probes, hunting for the failure:

- **Race class** (the `renderer-md-safety` precedent's CI-caught parallel-write
  bug): inserting `pnpm build` before typecheck must not create concurrent
  writers for one dist. Verified: every package's `build` writes only itself;
  the CLI is the sole package with a sibling chain and it is sequential by
  design. Single-writer property holds for the whole pipeline → no race. ✓
- **Working-tree residue:** `dist/` is gitignored; after the full
  CI-equivalent run the tree is clean, so no later diff-based step can see
  build residue. ✓
- **Ordering hazards:** the D3 freshness `git diff --exit-code` completes
  before the gate; the gate's build cannot regenerate zod (separate script). ✓
- **Coverage (corrected by the fresh pass — the original claim here was
  wrong):** the gate covers all package **`src/`** (what #108 asked — union of
  the 5 per-package `include` scopes); it does **not** cover workspace TS
  outside every include (`tsup.config.ts`, 5× `vitest.config.ts`,
  `core/scripts/gen-zod.ts`). Config/build scripts are out of #108's scope;
  extending coverage is folded into the structural item below (hermetic
  typecheck + coverage scope, one decision). `skipLibCheck` only skips
  `.d.ts` internals.
- **Guard semantics:** `hashFiles('package.json') != ''` identical to the four
  sibling TS steps; `&&` under GitHub's default `bash -e` fails the step on
  either command. ✓
- **Residual (NIT, declared):** `pnpm -r typecheck` silently skips a package
  that lacks a `typecheck` script — a future package without one would be
  uncovered. Pre-existing root-script behavior, unchanged here.
- **Residual (Consider, structural — not fixed in scope):** the gate is
  order-dependent on build artifacts (`dist/`-based type resolution; verified
  `TS2307` on a fresh checkout). Pattern spans ≥3 packages (both renderers +
  cli) and pairs with the test-coverage gap #108 already excluded. Per
  `issue-lifecycle` §structural patterns: named, escalated — an
  implementation-ready issue (hermetic typecheck: `paths` → source or project
  references) is proposed, not filed without the operator's OK.

## Pass 3 — Coherence → PASS

- Two commits, one session, one logical change + its doc sync — no parallel-worker seams.
- Cross-artifact truth: every doc claim added in `5bdd231` matches the workflow's
  reality (pipeline order, gate command, "CI-enforced" status — the docs land
  together with the gate they describe; the STANDARDS evidence carries its own
  date + issue/PR pointer per the claims discipline).
- PR body verified against reality after the scope grew (no stale "one file"
  claim left standing).

## Verdict

**PASS — this phase found no new actionable defect; rounds: 1 pre-phase
correction round (docs sync, commit `5bdd231`) from the in-branch review passes.**
Remaining: 1 Consider (structural, escalated — awaiting operator call on the
issue), 2 NITs (silent `-r` skip; commit subject ~75 chars), 1 acceptance item
demonstrated by equivalent rather than in-CI evidence (declared above).
**Doubt-theater guard:** the doubt pipeline is not always-green — the two
pre-phase passes produced 1 Required fix and 2 opportunistic fixes; this pass
adds refutation evidence (race class, residue, coverage union) that the earlier
passes did not run.

Post-testing feedback re-enters as: **correction blocks (small findings)**; a
large finding would warrant a fresh `/sota-workflow` round. Recorded path:
correction blocks.

## Final gate — handed to a fresh session

`premerge-review` projection verified current: the projected SKILL.md describes
publishing the report as a PR comment (no "text only" drift → no re-projection
needed). The step-9 block was printed to the operator (fresh, clean session,
READ-ONLY on code, PR link only — this file's findings are deliberately NOT
passed to it). Result reconciled below.

## Fresh-context reconcile

Fresh verdict: **PASS-CON-RIESGOS** (informativo), head `6c13cb0`, published as
[PR comment](https://github.com/ChristianLuciani/profile-as-code/pull/109#issuecomment-5839392465).
The fresh session re-verified the build-before-typecheck premise from config
(not my claim), the step order against the run log, the guard semantics and the
no-shared-dist-race property — all held. Each finding re-verified here against
the repo before classification:

| Finding | Class | Re-verified? | Action |
|---|---|---|---|
| **F1** (MAJOR) — `CONTRIBUTING.md` ground rule 1 and `pull_request_template.md` DoD enumerate CI steps without the typecheck gate — the doc class `5bdd231` claimed to sync | **Valid + actionable** | Yes — both lists verbatim, both pointing at `docs/ci-cd.md` (whose full list WAS synced) | **Fixed:** both enumerations now include the gate (#108) |
| **F2** (MAJOR) — `CONTRIBUTING.md` said `pnpm build # type-checked build` — the identical misleading claim this PR fixed in README | **Valid + actionable** | Yes — line verbatim | **Fixed:** corrected to the same wording as README (transpile-only CLI; gate is `pnpm typecheck`) |
| **F3** (MAJOR) — "union of the 5 `include: src/**` scopes covers all workspace TS source" is false: `tsup.config.ts`, 5× `vitest.config.ts`, `gen-zod.ts` sit outside every include | **Valid + actionable** | Yes — files exist, none matched by any package tsconfig | **Claim corrected** in this artifact and the PR body. The gate still covers what #108 asked (packages' `src/`); extending to config/build TS is folded into the structural item (one decision, not silently scoped) |
| **F4** (NIT) — `pnpm build` ≥3× per CI run | **Valid trade-off** | Yes — measured ≈11s on a ~1m20s job | Already declared above; cost accepted, reordering would weaken fail-fast or add hidden coupling |
| **F5** (NIT) — PR body + artifact pinned `+21/−7`, actual `+21/−5` (and the stat rots on every push) | **Valid + actionable** | Yes — wrong in both surfaces | **Fixed by de-pinning** (precedent `renderer-md-safety` F3/F4): both surfaces now reference the regenerable command instead of a number |
| **F6** (NIT) — this artifact forward-referenced a `## Fresh-context reconcile` that did not exist, and lacked a trailing newline | **Valid + actionable** | Yes — last byte was `.` | **Fixed:** this section is the reconcile; newline added |

- **Noise:** 0 · **Contract misreads:** 0 · **Accepted trade-offs:** 1 (F4).
- **What survived refutation:** build-before-typecheck necessity (config-verified,
  not just claimed), step order vs `docs/ci-cd.md` vs the real run, `hashFiles`
  semantics, D3 ordering, single-writer-per-dist.
- **Loop bound:** 1 fresh round; all 3 MAJORs doc-sync/claim-drift, fixed; gate
  met (further reports returning only NITs would close the loop).
- **Doubt-theater guard:** healthy — the fresh pass found 3 MAJORs (2 doc
  enumerations + 1 false author claim) that both in-session passes missed. The
  author's own PASS in the PR body was correctly treated as a claim to refute.

## Final verdict

**PASS — rounds: 2 (pre-phase docs-sync correction `5bdd231` + fresh-context
reconcile, all findings actionable and fixed or explicitly accepted).** Ready
for operator merge. Post-testing feedback re-enters as correction blocks (small)
or a fresh `/sota-workflow` round (large); recorded path: correction blocks.
