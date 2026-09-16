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

Fresh verdict: **PASS-CON-RIESGOS** (informativo). The fresh session ran read-only, did
not mutate the checkout (no test/build), refuted against the diff + `release.yml` +
`ci.yml` + issue #81, and explicitly treated this file and the PR body as **unverified
author narrative, not evidence**. Classified per precedence, each re-verified here
before disposition:

| Finding | Class | Re-verified? | Action |
|---|---|---|---|
| **F1 (MAJOR)** — on `workflow_dispatch` the guard read the version from the *dispatch checkout's* manifest, while the published artifact comes from the *tagged commit*: a tag whose tree declares another version would be published anyway | **Valid + actionable** | **Yes — reproduced.** Built a tag `v0.1.0` at a commit on `main` whose `packages/cli/package.json` declares `9.9.9`, main's tip declaring `0.1.0`: the guard exited **0** with "invariant satisfied". My `b3de011` fix (pin the build to the verified commit) had sharpened it: it now builds exactly that tree | **Fixed.** The guard reads the manifest **inside** the tagged commit (`git show <sha>:packages/cli/package.json`) and requires it to equal the version whose tag was validated — in both modes, which also closes the dirty-worktree variant on a tag push. Re-run: mismatch → exit 1 with the exact versions; consistent control → exit 0. Test added (**this is the third iteration of the same invariant**: name → commit → the published tree's own manifest) |
| **F2 (NIT)** — the PR body's evidence block was stale (243 tests / 9 cases) against its own committed numbers (247 / 13) | **Valid + actionable** | Yes, by arithmetic against the diff | **Fixed:** PR body updated to the current figures |
| **F3 (NIT)** — the shallow gate fired on the dispatch path even when the tagged commit **is** the branch tip, where ancestry is trivially true and needs no history | **Valid + actionable** | Yes — same class as F2 of the in-session pass (refusing what can be decided) | **Fixed:** the at-tip case is decided before the gate; test added in a genuinely shallow clone |
| **F4 (NIT)** — `ancestry` conflated exit **1** (verdict: no) with any other failure (the check could not run) | **Valid + actionable** | Yes — the in-session shallow fix closed this class only for shallow clones | **Fixed:** tri-state (`0`/`1`/other) with a distinct message and the exit status plumbed through `run()` |
| **F5 (NIT)** — dropping the "Dry-run info" step lost its tag-existence smoke signal while the workflow comment claims the script owns that report | **Valid + actionable** | Yes — the dry-run branch printed only "NOT enforced" | **Fixed:** the dry run performs the `ls-remote` and reports whether the tag exists; test added |
| **F6 (NIT)** — this file was committed with a "Pending" placeholder that goes stale the moment the report lands | **Valid + actionable** | Yes | **Fixed** — this section |

- **Noise:** 0 · **Contract misreads:** 0 · **Accepted trade-offs:** 0.
- **The fresh pass found the one hole the in-session pass did not reach**: it reasoned from
  the *source of the version* rather than from the guard's outputs, and that is what broke
  the third iteration. Two of my three MAJORs in this PR were found by adversarial
  experiment; this one was found by reasoning about provenance — a different method
  catching a different class, which is the argument for the fresh pass existing at all.
- **Not covered by a deterministic test, declared:** F4's third state (a git failure that is
  neither 0 nor 1) is implemented but not exercised — a partial/`--filter` clone repro was
  judged not worth the fixture weight. The `undecidable` message is therefore reasoned, not
  demonstrated.
- **Loop bound:** 1 fresh round; 1 MAJOR + 5 NITs, all actionable and fixed → gate met.
- **Doubt-theater guard:** the fresh pass produced a MAJOR the in-session review missed, and
  four NITs that were all real. Not an always-green pipeline.

## Final verdict

**PASS — rounds: 4** (3 in-session corrections + 1 fresh-context reconcile, all findings
actionable and fixed).

- Gates at the reconcile tip: **250 tests**, typecheck 5/5, build, `verify:pack` PASS.
- Remaining: 0 open findings; 1 declared coverage gap (F4's third state).
- Post-testing feedback re-enters as correction blocks (small findings) or a fresh
  `/sota-workflow` round (large); recorded path: **correction blocks**.
