# 05-review.md — sota-review of PR #88 (lint/biome gate, issue #59)

Reviewer: in-session adversarial pass (skill `sota-review`), round 1 → corrected → PASS.

**Model-routing gap declared:** session model = `deepseek-flash` — below the skill's
"strongest available" requirement, **and it is the session that authored the code**.
Same declared gap as `release-guard` and `renderer-md-safety`. Mitigation: step 9 hands
the terminal doubt pass to `premerge-review` in a fresh, clean session; its findings
reconcile in this file (see below).

**Preconditions — partially unmet, declared:** this change did **not** run through
`/sota-workflow`; there is no `.sota/<slug>/03-spec.md` nor `04-build.md`. Also, the
skill's step-7 loop "hand back to `sota-swarm`" degenerates here: there is no swarm,
so corrections were applied in-session and re-reviewed in-session. Review inputs:

- **Contract:** issue #59 (`## Repro`, `## Esperado`, `## Archivos sospechosos`, `## ADR-lite`),
  `docs/STANDARDS.md` (community-first checklist item 5 names this gap), `CONTRIBUTING.md`.
- **Build:** `33c78e8` (gate) + `d38f8a4` (correction round 1).
- **Base:** `main` @ `9305966`.

**Contract conflict declared (skill vs repo):** step 8 says "never push, never open the PR
yourself"; this repo's CONTRIBUTING §1 and `session-discipline` §2–3 require branch → push
→ open PR as the minimum delivered state, and `repo-governance` reserves only *merge* to the
human. More specific contract wins (AGOS precedence). Flagged, not silently resolved.

---

## Pass 1 — Spec fidelity (issue #59) → PASS

| Acceptance item (issue) | Evidence |
|---|---|
| "un linter configurado y en CI antes de que contribuidores externos abran PRs" | `biome.json` + `Lint (Biome)` step in `.github/workflows/ci.yml`; step **executed** in run `35295001454` (job log, not skipped by its `hashFiles` guard) |
| "Cualquier elección vale si es una sola y está declarada" | One tool (Biome 2.5.14, single devDependency, single config). Declared in `biome.json`, CHANGELOG, CONTRIBUTING, AGENTS.md, STANDARDS.md, PR body. **Open decision for the maintainer** (issue's ADR-lite: "elección de herramienta es del mantenedor") — Biome was chosen unilaterally; swap to eslint+prettier is config-only |
| "Script `lint` + step en `ci.yml`" | `"lint": "biome check ."` (+ `lint:fix`, `format`) and the CI step |
| Suspect file `package.json` | `lint` script + devDependency added |
| Suspect file `tsconfig.base.json` | **Deliberately untouched** — it is a suspect only for type-aware linters (typescript-eslint `project` refs); Biome needs no TS project config. Not a gap |
| Suspect file `.github/workflows/ci.yml` | Step added before Test (fail fast) |
| "no es bloqueador del gate actual" | Nothing existing was made stricter except the one rule named below; all suites green |

**Own-artifact claims re-checked against evidence (not taken on trust):**

- "268 tests green" → reproduced: 12 + 132 + 19 + 40 + 65 = **268**.
- "D3 `gen:zod` diff exit 0" → re-run in the correction round: **byte-identical**.
- "whitespace-only for `schema/` + fixtures" → programmatic **parsed-equality** against `main`
  for every changed `*.json`: schema + 10 fixtures parsed-equal; `package.json` is the only
  JSON with a real change (scripts/devDep). Claim holds as written.
- "76 files checked" → **coverage exact**: 76 tracked lintable files (`ts|tsx|mts|cts|js|jsx|mjs|cjs|json|jsonc`,
  minus the declared exclusions) = 76 checked. No tracked source hides behind `.gitignore`.

## Pass 2 — Correctness → 1 MAJOR (fixed in round 1)

| Finding | Sev | Evidence / disposition |
|---|---|---|
| **F1 — the gate did not enforce the rule the docs claimed it enforced.** `recommended` reports `style/noNonNullAssertion` as a **warning**, and `biome check` exits **0** on warnings. So a non-null assertion in `src/` passed CI while the PR body/CHANGELOG said the rule applied "outside tests only" | **MAJOR** | Reproduced on a clean clone of the pushed tip: well-formatted `return a[0]!;` in `packages/markdown/src/index.ts` → diagnostic printed, `Found 1 warning`, **`pnpm lint` exit 0**. **Fixed** (`d38f8a4`): `style.noNonNullAssertion: "error"` globally, tests keep their declared `off` override. Re-verified both directions: src assertion → **exit 1**; test assertion → **exit 0** |
| F2 — "the `**/tests/**` override is ineffective" | — | **Not a defect — verified working**: with the override in place a test-file assertion yields **0** `noNonNullAssertion` diagnostics (and `exit 0`). Recorded because it was the hypothesis F1 initially suggested |
| F3 — gate cannot go red (a green-only pipeline is broken) | — | **Refuted by repro**, not by reasoning: format violation → exit 1; `let x;`-class rule violation → exit 1; violation placed in `generated/` or `dist/` → exit 0 (exclusions live and intentional); violation in `src/` → exit 1 |
| F4 — `organizeImports` (assist, on by default in `check`) reordering side-effect imports | — | **Refuted**: `git grep -E "^import [\"']"` over all tracked sources → **no side-effect imports exist**, so no ordering hazard is reachable |
| F5 — the JSON reformat invalidated a byte-dependent test expectation | — | **Refuted**: tests read files only via `readFileSync(...).toContain(...)` on *generated artifacts*; hashes (`hashUnit`, `createHash`) are computed over inline/derived values, never over committed fixture bytes. No raw-byte fixture comparison anywhere |

**Two invalid measurements were produced and discarded before F1 stood** — recorded because
the pattern matters more than the result:

1. First attempt appended an *unformatted* test line; the case failed on `format`, **not** on
   `noNonNullAssertion` — it proved nothing about the override. Redone with `biome check --write`
   first (the assertion is not auto-fixable, so only formatting normalized) to isolate the rule.
2. Two variants of the same snippet gave **contradictory exit codes** (0 vs 1) for the same rule.
   The cause was the same conflation: one variant was a formatter error. The rule result was only
   trustworthy after normalizing formatting — which is how F1 was finally established as real.

Checked and clean: the `biome-ignore` for the control-character regex sits immediately above its
target (byte-identical regex) and is *live* — removing it restores the 4 errors, so it is not a
dead suppression. No dead code, no leftover artifacts from the authoring session's edits
(`check.ts`/`validate.ts`/`build.ts` imports verified clean and sorted).

## Pass 3 — Coherence → PASS (1 NIT)

- One config, one tool, one command; the **only** per-path divergence is the declared test
  override. Coverage is uniform across all four packages (76/76).
- Exclusions (`dist`, `node_modules`, `generated`) are exactly the generator/build-owned
  surfaces — `packages/core/src/generated/schema.zod.ts` is the only tracked file under an
  excluded path.
- Doc surfaces agree with each other and with CI order: CONTRIBUTING ground rule, AGENTS.md
  commands, STANDARDS row 5, CHANGELOG, PR body.
- **NIT** — no Python lint: `scripts/schema-check/check.py` is unlinted. Out of the issue's
  declared scope (suspect files are TS/JSON/CI); the schema self-test is its functional gate.
- **NIT (for the maintainer)** — warn-level `recommended` rules are non-blocking by design.
  `pnpm lint --error-on-warnings` would make the tree's current 100%-warning-free state a strict
  gate; not adopted unilaterally (it changes contributor friction repo-wide).
- **NIT** — `@biomejs/biome` pinned `^2.5.14`. CI is deterministic via `--frozen-lockfile` and
  pnpm installs the locked version, so local/CI agree unless the lock is bumped; pin exact if a
  minor ever changes formatter output.
- **NIT** — STANDARDS row cites the local write date (2026-09-17); the CI-green evidence ran
  2026-09-18 UTC. Cosmetic.

## Verdict — PASS (1 correction round)

Round 1 FAILed on F1 (MAJOR: documented enforcement did not exist) → corrected in `d38f8a4`
→ re-reviewed: lint clean, typecheck, **268/268**, schema self-test, D3 byte-identical, and the
F1 repro flipped from exit 0 to exit 1 on the src case while the test case stayed at exit 0.

**Open risks handed to the human (not defects):**

1. **Tool choice is the maintainer's** per the issue's ADR-lite — Biome shipped as the default
   (single tool, lowest contributor friction). Reversible as config only.
2. Biome is **not type-aware** — no equivalent of typescript-eslint's type-checked rules
   (e.g. no-floating-promises). `pnpm typecheck` (tsc strict) remains the type gate; this is now
   stated in the CHANGELOG rather than left implicit.
3. The one-time formatter baseline is a large diff (60+ files) whose review surface is
   `git diff -w`; the whitespace-only portion is proven parsed-equal, not asserted.

## Fresh-context reconcile

Round 2. The fresh session received only the PR and the issue (never these findings) and returned
**PASS-CON-RIESGOS** (informative). Each finding was re-verified here against the diff before
classification — no rubber-stamping either way.

### 1. Valid + actionable — F1 (MAJOR): the gate was absent from three contributor surfaces

**Confirmed by re-reading the files** (not accepted on the reviewer's word): `README.md`
"Arranque (dev)" listed install/test/build/typecheck/gen:zod and no lint;
`.github/pull_request_template.md` DoD said "schema contract self-test + `pnpm test` / `pnpm build`";
`docs/ci-cd.md` §CI described `install → test → build` with no Lint step.

**My Pass 3 claim ("Doc surfaces agree with each other and with CI order") was false for them.**
Recorded as a self-inflicted review error: I audited the surfaces I had edited and never checked the
surfaces that describe the same pipeline. The seam was real and my own pass missed it — the fresh
pass earned its place.

**Fixed** (round-2 commit): lint added to README, PR template and `docs/ci-cd.md`; the §CI pipeline
now matches `ci.yml` step-for-step. While rewriting that sentence, two **pre-existing** omissions in
the same sentence were also corrected (D3 freshness step, tarball bin check) — declared, not
smuggled, because a description that omits two real steps is the same defect class as F1.

### 2. Valid + actionable — F2 (NIT): `lint:fix` applied unsafe fixes silently

**Confirmed**: `biome check --write .` (safe) does not produce the `useTemplate` / `useLiteralKeys`
transforms; only `--unsafe` does. A script named `lint:fix` doing that repo-wide is a footgun.
**Fixed**: `lint:fix` = `--write` (safe), `lint:fix:unsafe` = `--write --unsafe` (opt-in, review the
diff); CONTRIBUTING and CHANGELOG updated. Verified by repro: `lint:fix` leaves a `useTemplate`
candidate in place and exits 0; the unsafe script then applies it.

### 3. Pre-existing drift the reviewer flagged as a note, not a finding → corrected, declared

`docs/ci-cd.md` said "6 fixtures" where **13** exist (verified by `ls`; present on `main` too, so not
introduced here). `#55` — the closed doc-honesty sweep that would normally be the home for this —
has no open successor, so a one-word factual error in the very list this round rewrites was
corrected in passing and declared in the PR body. Escalation of a non-finding to a declared fix is
recorded here so the decision is visible, not silent.

### 4. Noise / contract context — none substantive

The reviewer explicitly did **not** pass judgment on the tool choice (Biome vs eslint) or on
`--error-on-warnings`, correctly treating both as maintainer decisions already declared. Their
stated limits (no Python review, `pnpm-lock.yaml` not read line-by-line) are consistent with the
NITs already recorded. Their self-declared method note — that they read the PR body and treated my
narrative as *claims to refute*, and only opened this file after forming F1/F2 — is the intended
doubt discipline working.

### Corroborations (the reviewer's own "could not refute" list)

Independently reproduced, not merely accepted: JSON is parsed-equal (not text-normalized);
**76 tracked lintable = 76 checked**; the gate really goes red (format, rule, and — newly tested
here — **import-order**: inverted imports → exit 1 with 2 `organizeImports` diagnostics, which
closes a hole in our Pass 2, since Pass 2 only proved the sorter could not reorder side-effect
imports, never that it gated); `preset: "recommended"` is a valid 2.5.14 key; all 4 `biome-ignore`
suppressions are live; no imports lost base→head; functional end-to-end green (268 tests,
typecheck, `gen:zod` byte-identical, schema self-test OK).

Their strongest corroboration is one this file could not self-produce: reconstructing
`base + biome check --write --unsafe` and diffing byte-for-byte against this head, leaving
**exactly** the 3 `LoadedProfile` annotations, the 4 `biome-ignore` comments and the config/doc
files as the only non-formatter edits. That is the independent check that no semantic edit hid
inside the baseline — now on record as evidence, not assumption.

### Loop bound

Two in-session rounds (round 1 MAJOR, round 2 MAJOR+NIT) plus one fresh pass; zero unresolved
BLOCKERs; the fresh report's residual items are one NIT fixed and one pre-existing note fixed. Per
step 11 the gate is met — no third cycle warranted.

**Doubt-theater check (step 12):** the pipeline produced actionable findings in both directions —
F1 round 1 (documented enforcement that did not exist) and F1 round 2 (contributor surfaces the
authoring pass claimed were coherent). Not an always-green pipeline.

## Final gate — fresh pass 1 reconciled; pass 2 requested on the corrected head

**Fresh pass 1** (fresh session, read-only, PR-only context) reviewed head `6756395` and returned
PASS-CON-RIESGOS with 1 MAJOR + 1 NIT — both classified **valid + actionable** and fixed above.

**The corrected head has NOT been fresh-reviewed.** That delta is: three doc surfaces, one
`package.json` script split, the fixture count, and this file. No gate semantics changed except
`lint:fix` becoming safe-by-default — which *is* the finding the fresh pass requested, so a second
pass would largely re-review its own recommendation. Asked anyway, because the gate should validate
the artifact that actually merges, and the delta is cheap to read.

**Operator action — one final fresh pass on the corrected head:**

```text
Pre-merge fresh-context review requested (pass 2, final).
Open a new, clean session and paste:
  "Run premerge-review on https://github.com/ChristianLuciani/profile-as-code/pull/88 at its current head.
   Review READ-ONLY — no worktree/branch/commit, text output only.
   The delta since pass 1 covers only docs (README, PR template, docs/ci-cd.md), a package.json
   script split (lint:fix safe / lint:fix:unsafe opt-in) and .sota review notes; the gate semantics
   themselves are unchanged except that split."
Then bring the report back here; I will reconcile it in this file and apply any valid fix.
```

**Loop bound (step 11):** pass 2 is the last cycle this phase will run. If it returns a substantive
BLOCKER, it escalates to the operator rather than starting a third round — two unresolved fresh
rounds are information about the artifact, not a reason to keep looping. If it returns only NITs,
the gate is met and the PR is merge-ready for the maintainer.

**Re-entry path for post-merge/testing feedback** (recorded per step 8): small findings → correction
blocks applied on this branch (or a follow-up PR if already merged); large ones → a fresh
`/sota-workflow` round for the next lint/quality increment — type-aware linting, a Python linter, or
`--error-on-warnings` — all deliberately out of scope for #59 and left as open decisions for the
maintainer.
