# 05-review.md — sota-review of PR #186 (issue #181 / test-typecheck)

Reviewer: in-session adversarial pass (skill `sota-review`).

**Model-routing gap declared:** session model = `deepseek-flash` — **the same
model that authored the code**, below the skill's "strongest available"
requirement. Skill step 2 says to switch up before continuing; the mitigation
used here is the step-10 terminal doubt pass (`premerge-review` in a fresh,
clean session, refuting independently), which is where a *different* context
actually applies. Same shape as the `ci-typecheck-gate` and
`renderer-md-safety` precedents.

**Preconditions — partially unmet, declared:** this change did **not** run
through `/sota-workflow`; it is a direct issue session on #181. There is no
`03-spec.md` / `04-build.md`. Review inputs:

- Contract: issue #181 (`## Repro`, `## Esperado`, `## Criterio`,
  `## Archivos sospechosos`, ADR-lite) · the session task brief (PASO 0,
  scope, two-direction proof, gates, commit/PR mandate) · repo rules
  (AGENTS.md, `session-discipline`, `docs/ci-cd.md`).
- Build: branch `dsh/issue-181-test-typecheck`; head at review time `9c4cef9`,
  corrected to the reviewed fix below (hash not pinned — precedent
  `renderer-md-safety` F3/F4). Base: `origin/main` @ `8ff9c86`. Diff size
  regenerable via `git diff --shortstat origin/main...HEAD`.

**Contract conflict declared (skill vs repo):** step 9 says "never push, never
open the PR yourself". `session-discipline` §2–3 makes the open, CI-green PR
the minimum delivered state, and the more specific contract wins (AGOS
precedence). PR #186 was open before this phase. Flagged, not silently resolved.

**Adjacent prior art consulted:** `.sota/ci-typecheck-gate/05-review.md`
(the #108/PR #109 review) — it explicitly left open the coverage hole this
change addresses (`tsup.config.ts`, `vitest.config.ts`, `gen-zod.ts` in no
include) and a structural item (hermetic `dist`-based type resolution).

## Pass 1 — Spec fidelity

| #181 item | Evidence |
|---|---|
| "Un type-check de tests" | 12 × `tsconfig.test.json` including `tests/**/*.ts`; wired to each package's `typecheck`; CI step `pnpm build && pnpm typecheck` covers it. ✓ |
| "los errores preexistentes … arreglados en el mismo cambio (medir primero)" | Measured before choosing: **4** (cli 1, core 3; rest 0). All 4 fixed, not suppressed. ✓ |
| "cableado al gate de tipos de CI para que no pueda regresar" | Two layers now: the existing Typecheck step covers tests, and `scripts/typecheck-gate` (self-tested, own CI step) makes a *new* package that omits the wiring fail CI — F1 below. ✓ |
| Criterio: "un `platform`/`render` mal tipado en cualquier suite de adapter falla CI" | Demonstrated red→green: `platform: "liberapay-pro"` → `TS2820`; `render` returning `{ body }` → `TS2741`; revert → exit 0. ✓ |
| PR: what/why · `Closes #181` · evidencia · firma · `Impact` | All present; body updated after the correction. ✓ |
| Commits: conventional + `-s` (DCO) + trailers | `Signed-off-by` == author; `Session-Id` (bare uuid) / `Session-Name` / `Models`. ✓ |

**Declared deviations (accepted with evidence):**

- **D1 — `extends` target.** ADR-lite's default hypothesis says `extends` the
  *base*; the build extends the package's **own** `tsconfig.json`. Justified:
  single source of compiler options (no build/typecheck drift); measured green;
  trade-off plus the two overrides documented in the PR body.
- **D2 — boundary breach, declared.** `## Archivos sospechosos` names test
  files, `tsconfig`s and the CI/doc surfaces. The diff also touches
  `packages/core/src/types.ts` / `structured-data.ts` (source) and adds
  `packages/cli/scripts/release-notes.d.mts` and `scripts/typecheck-gate/`.
  The type/declaration edits are the honest fixes for preexisting errors the
  gate destapes; the gate is the reviewer-confirmed non-regression half of
  `## Esperado` (F1). All declared in the PR body, not silent.
- **D3 — no change to the Typecheck step.** The issue's docs instruction is
  conditional on adding a step; the wiring needs none. A *new* gate step was
  added for the separate non-regression assertion.

## Pass 2 — Correctness

Adversarial probes, hunting the failure:

- **Coverage union (the predecessor's open hole).** Enumerated every package
  `.ts` outside `node_modules`/`dist` against `tsc --listFiles` per package.
  Found `packages/core/scripts/gen-zod.ts` **still in no include** while an
  earlier revision of the PR body claimed "no package `.ts` file unchecked" —
  a false claim. Fixed by adding `scripts/**/*.ts` (measured 0 new errors);
  re-verified: every package `.ts` now in its program. **Finding F1.**
- **Glob safety.** `"*.config.ts"` matches only the package-root configs;
  no `.ts` under `tests/fixtures/` is pulled in. ✓
- **`rootDir: "."` under `noEmit`.** No `TS6059`; `tsc` exit 0 on all 12. ✓
- **Declaration resolution.** `release-notes.d.mts` resolves the
  `../scripts/release-notes.mjs` import under NodeNext (green); not packaged
  (`files: ["dist"]`). ✓
- **`email` / `jsonLd` producer side.** The interface was declared but not
  enforced: `structured-data.ts` built the object unannotated and spread it
  into the return literal, bypassing excess-property checking. Annotating both
  `jsonLd` locals with `StructuredDataReadiness["jsonLd"]` is green on the real
  code and makes a bogus key fail (`TS2353`) — **Finding F3** (fresh pass),
  fixed.
- **`ledger.test.ts` fix.** `removed[0]?.surfaces` preserves assertion
  strength. ✓
- **Security.** No input, credential, path or network surface changed. The new
  gate reads only local manifests/configs. ✓
- **Gate self-test.** `scripts/typecheck-gate/test.mjs`: 11 fixtures + CLI
  exit-code mapping + symlinked-path invocation, all asserted; fixtures are
  synthesized in temp dirs (no committed placeholder manifest → no #166 class).
- **Residual (NIT, declared):** `release-notes.d.mts` is a hand-maintained
  parallel signature; `scripts/**/*.ts` does not glob `.mts`, so it enters only
  through one import. Bounded by the runtime test.
- **Residual (NIT, declared):** `tsconfig.test.json` now checks `src` +
  `tests` + configs + scripts; the name no longer describes its full reach.
- **Open structural risk (not in #181 scope):** the Typecheck step resolves
  workspace types from built `dist/` (needs `pnpm build` first). The
  `ci-typecheck-gate` review escalated a hermetic-typecheck issue; still open.

## Pass 3 — Coherence

- One logical change + its doc sync on one branch/session — no parallel-worker
  seams.
- The 12 `tsconfig.test.json` are byte-identical in shape; the new gate reuses
  the dep-gate's canonical workspace walker (`parseWorkspaceGlobs`,
  `expandGlob` imported, never re-implemented) so package discovery cannot skew
  between gates (the #165 F3 lesson).
- Cross-artifact truth: the CI comment, `docs/ci-cd.md` and the PR body
  describe the same include set and the same gate; the PR body's earlier false
  coverage claim was caught and corrected.

## Pass 4 — Anti-trim (normative deletions)

`premerge-review`'s §Anti-trim pass was resolved via the ladder:

- (a) projected sibling `/Users/eva/.dsh/skills/premerge-review/SKILL.md`
  exists and carries `## Anti-trim pass` (line 68) — projection current.

**Mechanical scan** on `git diff origin/main...HEAD` deleted lines with the
canonical marker regex
(`nunca|NUNCA|Nunca|jamás|Jamás|prohibid|Prohibid|obligator|Obligator|MUST|NEVER|OFICIAL|[a-z][a-z0-9_]*[[:space:]]*=|\[[a-z][a-z0-9_]*\]|[A-Z][A-Z0-9]*_[A-Z0-9_]+`):
**zero matches** — the only deleted lines are 12 old `"typecheck"` script
lines, 1 `docs/ci-cd.md` sentence (replaced by an expanded version that keeps
the clause and adds #181) and 1 test assertion (replaced by the null-safe
form). The scan is vacuous, not skipped. **No BLOCKER.**

## Findings

| # | Sev | Location | Finding | Status |
|---|---|---|---|---|
| F1 | **MAJOR** | `packages/core/tsconfig.test.json` + PR body | `gen-zod.ts` in no include while the body claimed full coverage | **Fixed**: `scripts/**/*.ts` added (0 errors), coverage re-verified; body corrected |
| F2 | NIT | `tsconfig.test.json` (×12) | name no longer describes reach | Accepted — name from the issue's hypothesis; `include` is the contract |
| F3 | NIT | `packages/cli/scripts/release-notes.d.mts` | hand-maintained signature can drift | Accepted (small surface; runtime tests exercise behavior) |
| F4 | NIT | all `package.json` | reverting the `typecheck` script silently drops coverage | Addressed for *new* packages by the gate; an in-place revert of an existing package is still unguarded — accepted |
| F5 | Open risk | type resolution | gate is order-dependent on built `dist/` (hermetic-typecheck item from #109) | Out of #181 scope — carried forward |

## Verdict (in-session)

**FAIL → corrected → PASS — rounds: 1 correction.** One MAJOR (F1) actionable
and fixed; 3 NITs and 1 open structural risk declared.

## Final gate — handed to a fresh session

`premerge-review` projection verified current (publishes the report as a PR
comment; no "text only" drift). Hand-off block printed to the operator: fresh,
clean session, READ-ONLY on code, PR link only — this file's findings were
deliberately NOT passed to it.

## Fresh-context reconcile

Fresh verdict: **PASS-CON-RIESGOS** (informative), head `9c4cef9`, published as
[PR comment](https://github.com/ChristianLuciani/profile-as-code/pull/186#issuecomment-6085728467)
(0 blocker / 1 major / 2 nit). Each finding re-verified here against the diff
before classification:

| Finding | Class | Re-verified? | Action |
|---|---|---|---|
| **F1** (MAJOR) — `pnpm -r typecheck` silently skips a package that does not declare the script; a new package (planned `packages/server`) leaves its tests unchecked and CI stays green; `git grep 'tsconfig.test'` outside the 12 packages returns only the CI comment | **Valid + actionable** | Yes — `pnpm -r` reports "Scope: 12 of 13" (root skipped silently); only the CI comment references the config; `packages/server` is planned (`docs/ci-cd.md:63`); every sibling invariant has a `--check` gate | **Fixed**: `scripts/typecheck-gate/{check,test}.mjs` (self-tested, reuses the dep-gate walker) + a new zero-dep CI step before install + `docs/ci-cd.md` enumeration entry. A new package without the wiring now fails CI. |
| **F2** (NIT) — `release-notes.d.mts` is hand-duplicated; `skipLibCheck` + no `allowJs`/`checkJs` never cross-check it; `scripts/**/*.ts` does not glob `.mts` | **Valid trade-off** | Yes — `*.ts` does not match `.d.mts`; the file enters only via one import | **Accepted risk**: bounded by the runtime test; a JSDoc+`allowJs` rewrite is more invasive than the value it adds. Recorded here. |
| **F3** (NIT latent) — `StructuredDataReadiness.jsonLd` is not actually enforced: `structured-data.ts` builds the object unannotated and spreads it into the return literal | **Valid + actionable** | Yes — empirically: unannotated, a bogus emitted key passes (`0 errors`); annotated, it fails `TS2353`; real code green either way | **Fixed**: both `jsonLd` locals annotated with `StructuredDataReadiness["jsonLd"]` — the declared interface is now enforced. |

- **Noise:** 0 · **Contract misreads:** 0 · **Accepted trade-offs:** 1 (F2).
- **What survived refutation:** the central contextual-typing claim
  (`PasteConformanceOptions` makes a mistyped `platform`/`render` fail),
  file coverage (all 76 package `.ts` reachable), the `exclude` override, no
  type suppressions, zero undeclared normative trims, and no SPEC drift
  (`email` is documented at SPEC §15.4).
- **Loop bound:** 1 fresh round; the single MAJOR was actionable and is fixed;
  the NIT turned out to be a real enforcement gap (F3) and is fixed; F2 is an
  accepted risk. Gate met.
- **Doubt-theater guard:** healthy — the fresh pass found a MAJOR (F1) that
  both the authoring build and the `code-review-and-quality` pass missed, plus a
  latent enforcement gap (F3). Not an always-green pipeline.

## Final verdict

**PASS — rounds: 2 (in-session correction + fresh-context reconcile; both
findings actionable were fixed, the remaining NIT accepted explicitly).**
Ready for operator merge. Post-testing feedback re-enters as correction blocks
(small) or a fresh `/sota-workflow` round (large); recorded path: correction
blocks.
