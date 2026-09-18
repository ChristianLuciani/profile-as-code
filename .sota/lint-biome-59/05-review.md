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

_Pending — step 9 hands this to `premerge-review` in a new, clean session. The fresh session
receives only the PR and the issue (never these findings). Findings will be classified here as
contract misread / valid+actionable / valid trade-off / noise, with actions and accepted risks._

## Step 9 — hand to a fresh session (operator action)

```text
Pre-merge fresh-context review requested.
Open a new, clean session and paste:
  "Run premerge-review on https://github.com/ChristianLuciani/profile-as-code/pull/88. The PR is not yet merged.
   Review READ-ONLY — no worktree/branch/commit, text output only."
Then bring the formatted report back here; I (the authoring session) will reconcile its findings
and apply the fixes to the branch.
```

**Re-entry path for post-testing feedback** (recorded per step 8): small findings →
correction task blocks appended here and applied on this branch; large ones → a fresh
`/sota-workflow` round for the next lint/quality increment (e.g. type-aware linting or a Python
linter, both deliberately out of scope for #59).
