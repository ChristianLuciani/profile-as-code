# 05-review.md — sota-review of PR #82 (release-guard)

Reviewer: in-session adversarial pass (skill `sota-review`).

**Model-routing gap declared:** session model = `deepseek-flash` (deepseek) — below
the skill's "strongest available" requirement, **and it is the session that authored
the code**. Mitigation, as in the `renderer-md-safety` round: the step-9 terminal
doubt pass runs as `premerge-review` in a fresh, clean session, and its verdict
reconciles in this file.

**Preconditions — partially unmet, declared:** this change did **not** run through
`/sota-workflow`, so there is no `.sota/<slug>/03-spec.md` nor `04-build.md`. Review
inputs are the issue and the repo's release contract:

- Contract: issue #81 (`## Esperado`, `## ADR-lite`), `docs/ci-cd.md`, the release
  rules in `repo-governance`/`session-discipline`.
- Build: commits `d7a27ed` (guard), `24b8e4b` (test identity), `b3de011` (commit
  pinning) + this reconcile commit.
- Base: `main` @ `efc74c7`.

**Contract conflict declared (skill vs repo):** step 8 says "never push, never open
the PR yourself"; this repo's CONTRIBUTING §1–3 requires branch → push → PR, and
`session-discipline` §2 makes the open PR the minimum delivered state. More specific
contract wins (AGOS precedence). Flagged, not silently resolved.

## Pass 1 — Spec fidelity (issue #81) → PASS

| Acceptance item | Evidence |
|---|---|
| "El guard debe además verificar que el commit taggeado es el que se quiso publicar" | Identity check on a tag push, ancestry on `workflow_dispatch`; 13 suite cases + 4 against this repo's real history |
| "Candidato mínimo: `git merge-base --is-ancestor $GITHUB_SHA origin/main`" | **Deviation, deliberately stronger — and the issue's literal suggestion is wrong twice.** (a) Ancestry alone was my first implementation and it **PASSED the #81 repro**, because a stale `main` leaves the tag on an *ancestor*; (b) `$GITHUB_SHA` is the *dispatch ref*, not the tag, on the retry path. The guard resolves the **tagged** commit and applies identity (tag push) or ancestry (dispatch). Recorded because a faithful implementation of the suggestion would have shipped the bug and blocked every retry |
| "Ojo con el fetch … Sin eso, el chequeo pasa en vacío — el mismo tipo de falso OK" | `fetch-depth: 0` + explicit ref fetches, and the shallow case is now **tested**, not just reasoned about (Pass 2, F2) |
| "Mensaje de error explícito con el commit taggeado y el HEAD esperado" | Asserted in the suite (tag sha, branch tip, exact fix, and the dispatch escape hatch) |
| `docs/ci-cd.md` documents the invariant | Updated, including why the build is pinned to the verified commit |
| (Scope added beyond the issue) verifying a commit is not publishing it | The guard emits the verified commit and the workflow checks it out before build/test/publish — see F1 |

## Pass 2 — Correctness → PASS (3 findings, all fixed)

| Finding | Sev | Evidence / disposition |
|---|---|---|
| **F1 — the guard verified a commit it did not publish.** On the retry path the workflow checked out the *dispatch ref*, so `workflow_dispatch` would have built that branch's tree while the guard printed "commit verified" | **MAJOR** | Demonstrated on a throwaway origin: tag → `da33628`, checkout at `efc74c7`, guard exit 0. My own dispatch test had encoded the hole. **Fixed** (`b3de011`): emit the verified commit, check it out before build. Two tests, the second asserting `not.toContain(commit=<tip>)` |
| **F2 — a shallow clone made the guard refuse with the wrong reason.** It reported "must have landed on `main`. Retag once it is merged" when in fact ancestry could not be decided at all | **MAJOR** | Measured on a genuinely shallow clone (`--depth 1` via `file://`): exit **1** (so no false-OK) but the verdict was wrong — the exact conflation #81 names ("que el chequeo no pudo correr no se lea como que el chequeo dijo no"). **Fixed**: `--is-shallow-repository` gates the ancestry path with an actionable message (`fetch-depth: 0`); on the identity path the "BEHIND" hint is suppressed rather than asserted. Two tests, one of which self-verifies (if the clone were not shallow, the guard would pass and the test would fail) |
| **F3 — the suite's fixture commits had no identity**, so CI failed with `git commit` status 128 while my machine passed (global `user.name`) | **MAJOR** | Caught by the first CI run of the PR. **Fixed** (`24b8e4b`) by routing commits through the helper that sets `-c user.name/user.email`; verified locally under `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` |
| NIT — the two modes duplicate ~10 lines (resolve tag → resolve tip → check) | NIT | A per-mode dispatcher was considered and rejected: the failure messages are mode-specific and a table would add indirection for two cases. Recorded as a design preference, not a defect |

**Two invalid tests were produced and discarded before F2 stood** — recorded because
the pattern matters more than the result:

1. The first shallow-clone experiment used `git clone --depth 1 <local path>`; git
   **silently ignores `--depth` for local clones** (`166` commits reachable → full
   history, so it tested nothing). Redone with `file://`.
2. The first measurement of the guard's exit code used `${PIPESTATUS[0]}` *outside*
   the subshell that contained the pipeline, so it measured `tail`'s status (`0`),
   not the guard's. Redone capturing the exit directly (real: `1`).

Both would have produced a confident, wrong conclusion. The suite is now a real
regression test for each finding: reverting the identity check to ancestry makes the
#81 case fail (verified: `1 failed | 8 passed`).

Checked and clean: no shell anywhere (argv arrays only, which is strictly better than
the inline YAML this replaced); `$GITHUB_OUTPUT` injection not reachable because git
refuses control characters in ref names (FYI, no code added); fail-closed paths
distinguish "could not run" from "ran and said no"; the dry-run path states which
invariants it did **not** enforce.

## Pass 3 — Coherence → PASS

- The one seam that matters — the guard's `commit` output ↔ the workflow's second
  checkout — is named once in each file and covered by a test; a silent empty ref is
  impossible because a successful guard always emits it (and the checkout is skipped
  on dry runs, where nothing is published).
- The guard runs **before** `pnpm/action-setup` on purpose (fail fast without
  installing); that is why the workflow calls it by path rather than through the
  `guard:release` npm script, which exists for humans. Intentional, documented.
- No orphaned code: the inline guard and the separate "Dry-run info" step are gone,
  not shadowed. No dead helpers.
- Naming and failure style are consistent with `verify-pack.mjs`, its sibling on the
  release path.

## Verdict

**PASS — after 3 correction rounds** (1: the identity design; 2: the CI test identity;
3: the commit pinning + the shallow diagnostic).

- Full gates at the reconcile tip: **247 tests**, typecheck 5/5, build,
  `verify:pack` PASS; the guard re-run against this repo's **real history** 4/4 and
  against synthetic origins 13/13.
- Remaining: 1 NIT (mode duplication, accepted with the reasoning above). No accepted
  risks carried into the tag.
- **Doubt-theater guard:** satisfied — three MAJOR findings, two of them mine found by
  adversarial testing, one by CI, plus two invalid tests caught and discarded.
- Post-testing feedback re-enters as **correction blocks** (small findings); large
  findings would warrant a fresh `/sota-workflow` round.

## Final gate — handed to a fresh session

`premerge-review` is available in this environment; the step-9 block was printed to
the operator (fresh, clean session, READ-ONLY, PR link only — this file's findings and
the authoring session's reasoning are deliberately NOT passed, so it refutes
independently). Result to be reconciled below.

## Fresh-context reconcile

_Pending — awaiting the `premerge-review` report pasted by the operator._
