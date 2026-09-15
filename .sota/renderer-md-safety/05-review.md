# 05-review.md — sota-review of PR #79 (renderer-md-safety)

Reviewer: in-session adversarial pass (skill `sota-review`).

**Model-routing gap declared:** session model = `deepseek-flash` (deepseek) —
below the skill's "strongest available" requirement, **and it is the session that
authored the code**. The skill's step 2 says to switch up before continuing; the
mitigation used here is the step-9 terminal doubt pass: `premerge-review` in a
fresh, clean session, whose verdict reconciles in this file. Same shape as the
`cli-rename-pasco` precedent (`05-review.md`).

**Preconditions — partially unmet, declared:** this change did **not** run through
`/sota-workflow`, so there is no `.sota/<slug>/03-spec.md` nor `04-build.md`.
Review inputs are therefore the issues themselves plus the SPEC:

- Contract: issue #75 (`## Esperado`, ADR-lite) · issue #76 (`## Esperado`,
  ADR-lite) · `docs/SPEC.md` §15.2 · repo rules (AGENTS.md rule 7, D3, D8).
- Build: commits `8248855` (fix) + `5178042` (review corrections), branch
  `pi/profile-as-code/renderer-md-safety`.
- Base: `main` @ `a56a3a6`. Diff at the reconcile tip: **20 files, +713/−68**
  (`git diff --shortstat a56a3a6 <tip>`). Corrected twice: first from a plain
  `git diff --stat` that silently omits an untracked new package (17/+553), then
  again after round 3 moved the tip. The fresh-context pass caught the second
  staleness — recorded rather than quietly overwritten.

**Contract conflict declared (skill vs repo):** step 8 of this skill says "never
push, never open the PR yourself (CONTRIBUTING hard rule)". This repo's
CONTRIBUTING §1–3 says the opposite — branch → push → open PR, with only `main`
forbidden — and `session-discipline` §2 makes the open PR the minimum delivered
state. The more specific contract wins (AGOS precedence), so the branch was pushed
and PR #79 opened before this phase. Flagged, not silently resolved.

## Pass 1 — Spec fidelity → PASS

| Acceptance item (source) | Evidence |
|---|---|
| #75: "todos los destinos CommonMark que emite github-org pasan por mdHref()" | Exhaustive grep of `](${` in `packages/renderers/github-org/src/index.ts`: every one of the 6 emission sites is wrapped in `mdHref` (logo, badge ×2, newsletter, podcast ×2, press). Zero raw destinations left |
| #75 ADR-lite: "solo cambia output para workspaces con ( o espacio en URLs" | Byte-for-byte `EXPECTED` fixture test passes unmodified, plus an explicit test asserting the safe brand fixture emits zero `%20`/`%28`/`%29` |
| #76: "el texto del link se escapa antes de interpolar (backslash-escape de [ y ])" | 4 renderer tests (URL-derived label, DOI, SSOT label, asset target) + round-trip property `unescape(mdText(x)) === x` over 6 inputs and all 128 ASCII chars |
| #76: "CommonMark los desescapa al renderizar, así que el label visible no cambia" | Same round-trip property — the visible bytes are the input bytes |
| #76: "Helper propio (mdText()) separado de mdHref(): son superficies distintas" | Two exported functions with disjoint responsibilities; `mdText` is documented as NOT for destinations and vice versa |
| #76: "resolver junto con #75 (helper compartido) para no duplicar la regla" | `@profile-as-code/markdown`, consumed by both renderers; no copy remains in either adapter |
| #76 reachability claim: `new URL('https://example.com/a]b').pathname` = `/a]b` | **Re-run:** `"/a]b"` ✓ |
| #76 reachability claim: the DOI regex admits `]` | **Re-run:** `/^10\.\d{4,9}\/\S+$/.test('10.5559/a]b')` → `true` ✓ |

### Deviation from the issue's ADR-lite (justified)

#75's ADR-lite asserts the shields.io badge src "queda seguro sin tocarlo" because
`hostnamePath` "sin parens/espacios crudos posibles en el host". True of the
**host**, false of the **path**: `hostnamePath` concatenates `hostname + pathname`,
and a pathname keeps `(`/`)` while a raw space becomes `%20`. So the badge src was
breakable, and it is the *inner* destination of `[![alt](SRC)](HREF)` — a `(` in a
brand URL path broke the image. Applied `mdHref` to it too; covered by the new
badge test. The issue under-specified here; the code is stronger than asked.

## Pass 2 — Correctness → PASS (2 NITs)

| Finding | Sev | Evidence / disposition |
|---|---|---|
| `mdText(hostname(...))` / `mdText(hostnamePath(...))` are **no-ops** for every reachable input | NIT | `hostname()`'s catch (returns the raw string) is unreachable: verified empirically that every value the boundary accepts does not throw in `new URL()` — `z.string().url().regex(/^https?:\/\//).min(7)` **rejects** `https://` and `https:// `, accepts `https://a` / `.../a (1)` / `.../a]b`, and `new URL()` throws on exactly the rejected pair. Kept deliberately: the invariant "every label expression goes through `mdText`" is cheaper to hold than a per-site safety argument, and it survives a future `hostname()` change. **This corrects a claim I made in the PR review comment** ("no es no-op… `https://` es alcanzable"): that claim was wrong |
| A label containing BOTH a code span and a bracket shows a stray backslash | NIT | The span already protects the bracket (the link parses); CommonMark does not process escapes inside a code span, so `\]` renders literally. Escaping the backtick would fix the cosmetic case by destroying the user's intended code span — worse trade. Documented in the helper |
| `identity.links[].label` is optional; a label-less link renders `[undefined]` | **MAJOR — pre-existing, accepted, escalated** | Not introduced here and not covered by #76's acceptance, so not a FAIL trigger. `String(l.label)` preserves the prior emission byte-for-byte instead of making an unrequested decision about public output. Fix options (require the field vs fall back to `hostnamePath`) are a contract call: filed as **#78**, implementation-ready |

Checked and clean: `mdHref` stays idempotent (percent-escapes stabilize after one
pass, tested on a representative set); the mailto row is destination-encoded while
the local part may contain `]`; JSON-LD keeps facts verbatim (§18.4); the asset
target keeps the raw path for the deploy surface while the href is encoded; no
other markdown emitter exists in the repo (exhaustive grep over `packages/`); the
new package's `workspace:*` dependency never reaches npm because only the CLI is
published and tsup inlines `@profile-as-code/*` (`verify:pack` PASS).

## Pass 3 — Coherence → PASS

- Naming and error handling are symmetric across the two adapters (same helper
  names, same order label-then-href, both import from one package).
- No seam risk from parallel workers: single session, single logical change.
- Docs coherence verified end to end: `SPEC.md` §15.2 states the rule,
  `AGENTS.md` map lists the package, `CONTRIBUTING.md` points contributors at it
  instead of re-implementing, `CHANGELOG.md` records both issues.
- Clean-build path verified by CI on a fresh checkout. NOTE, corrected in the
  reconcile: this bullet originally claimed "each package's `test` script builds
  its deps first" — after round 2 that was false (each package builds only
  itself; the ordering comes from the root script and `pnpm -r` topological
  execution). The fresh pass caught the stale sentence, and F1 below is the same
  correction applied to the code.

## Correction round 2 — a defect the in-session pass MISSED (found by CI)

The in-session review passed locally and CI failed on `12158ed`:

```
packages/renderers/github-readme build: src/index.ts(18,32): error TS2306:
  File '.../packages/markdown/dist/index.d.ts' is not a module.
```

**Root cause (real, and mine).** I had both renderers' `build` scripts invoke
`pnpm --filter @profile-as-code/markdown build`. `pnpm -r build` runs sibling
packages **in parallel**, so two `tsc` processes wrote the same
`packages/markdown/dist/index.d.ts` concurrently and one reader caught it
half-written. The pre-existing scripts had the same latent race on `core/dist`
(both renderers built it in parallel) — it had simply never lost the timing
lottery.

This is precisely the seam Pass 3 exists to find (each adapter assuming it owned
a shared build step) and it was **missed in-session**: my verification story was
local and sequential, which cannot exhibit a parallel race. Recorded as such — the
doubt pipeline is not always-green; CI was the pass that doubted successfully.

**Fix (structural, not a retry).** Ordering is a workspace concern, not something
each adapter re-establishes:

- each package's `build` now builds **only itself** (`tsc -p tsconfig.json`); no
  package invokes another package's build;
- the CLI keeps an explicit sequential chain (`core → markdown → readme → org →
  tsup`) because it is the packaging entry point and `verify:pack` needs a
  complete build;
- root `test` becomes `pnpm -r build && pnpm -r test` — one ordered build pass
  supplies every dist, so `test` no longer depends on a sibling's build script
  (`packages/core`'s `test` is `vitest run` with no build, which is what the
  renderer chains had been silently supplying).

**Verified from a clean tree** (`rm -rf` every `dist`), i.e. the exact CI path:

```
pnpm -r build  → markdown · core · readme · org · cli (ESM 147.58 KB)  all Done, no duplicates
pnpm test      → 234 passed (10+1+1+1+1 files)   [root = build + test]
pnpm typecheck → 5/5 Done
verify:pack    → PASS (bin pasco, smoke "pasco 0.1.0")
```

The tarball size is unchanged at 147.58 KB, so the CHANGELOG claim still holds.

## Verdict

**PASS — after correction rounds 3 (in-session: 2 + fresh reconcile: 1).**

- Round 1 (in-session): 1 MAJOR-natured **claim drift** corrected —
  `docs/STANDARDS.md` stated suite size as current state and the change moved it
  (155→234 tests, 12→14 files; renderers 12→50). Fixed with the regenerable value
  and date (`5178042`).
- Round 2 (CI-caught): 1 MAJOR **build-ordering race** corrected — see the section
  above; the in-session pass missed it.
- Remaining: 1 accepted MAJOR risk (#78), 2 NITs, 1 self-correction of a false
  claim in the PR comment.
- Full gates green from a clean tree after round 2: 234 tests, typecheck 5/5,
  build, `verify:pack` PASS.
- **Doubt-theater guard:** satisfied, and validated the hard way — the in-session
  pass produced actionable findings AND still missed a real defect that CI found.
  Local sequential verification cannot refute a parallel-build race; the fix moves
  ordering into the workspace contract so no adapter can reintroduce it.
- Post-testing feedback re-enters as: **correction blocks (small findings)**; large
  findings would warrant a fresh `/sota-workflow` round.

## Final gate — handed to a fresh session

`premerge-review` is available in this environment; the step-9 block was printed to
the operator (fresh, clean session, READ-ONLY, PR link only — the authoring
session's findings and this file are deliberately NOT passed to it, so it refutes
independently). Result to be reconciled below.

## Fresh-context reconcile

Fresh verdict: **PASS-CON-RIESGOS** (informativo). The fresh session ran a clean
clone of the head, its own greps, `markdown-it@14` as an independent CommonMark
oracle, and re-ran build/test/typecheck/verify:pack. It did NOT receive this
file's findings. Classified per precedence (contract misread / valid+actionable /
valid trade-off / noise), each re-verified here before disposition:

| Finding | Class | Re-verified? | Action |
|---|---|---|---|
| **F1** (MAJOR) — the round-2 refactor broke the standalone `pnpm -r test` path: renderers no longer build their deps and `core.test` had no build, so nothing supplied `core/dist` | **Valid + actionable** | **Yes**, reproduced: `rm -rf dists && pnpm -r test` → `TS2307: Cannot find module '@profile-as-code/core'` in both renderers | **Fixed (round 3).** Root cause is an inconsistency, not the refactor: `core` was the only one of 5 packages whose `test` did not build itself, and the deleted chains had been silently supplying it. Normalized `packages/core` `test` → `pnpm build && vitest run`. Re-verified from a clean tree: **`pnpm -r test` standalone passes all 5 suites (234 tests)** |
| **F2** (NIT) — SPEC §15.2 declares the link-text escape set as `[`/`]`, omitting `\` | **Valid + actionable** | Yes — the omission is not cosmetic: a SPEC-faithful reimplementation escaping only brackets breaks byte-parity on a label containing a backslash | **Fixed:** §15.2 now names `\` first and says why (it is the escape character and must survive the round-trip) |
| **F3** (NIT) — this artifact was stale at the tip: wrong diff stat, and a Pass-3 sentence falsified by round 2 | **Valid + actionable** | Yes — both strings verbatim in the committed file | **Fixed:** stat corrected and the falsified sentence annotated (above), not silently rewritten |
| **F4** (NIT) — mixed provenance: `STANDARDS.md` cited a run id older than its own regenerated counts | **Valid + actionable** | Yes | **Fixed by removing the rot, not by re-pinning:** a run id goes stale on every push — that is *how* the row got mixed. The row now cites the reviewed PR head + date with the regenerable command, so the counts and their provenance share one date |

- **Noise:** 0 · **Contract misreads:** 0 · **Accepted trade-offs:** 0.
- **Residual not fixed, declared:** `pnpm -F <renderer> test` on a *completely
  clean* tree still needs its deps built (`pnpm -r build` first, or the root
  `pnpm test`). Making it self-sufficient is exactly what caused the parallel-write
  race, so it is intentionally not restored; every documented entry point
  (`README`, `CONTRIBUTING`, `AGENTS.md`, `docs/ci-cd.md`) is root-level and works.
- **What survived refutation:** escaping coverage re-grepped independently (all
  dynamic labels/destinations in both renderers pass through `mdText`/`mdHref`;
  the readme badge src uses host-only `hostname()` → safe by the same WHATWG
  argument as #75's ADR-lite); all quantitative claims re-verified from a clean
  clone (234 tests / 14 files, exact per-package breakdown, 147.58 KB, typecheck,
  `verify:pack`); `mdText` semantics corroborated against a real CommonMark parser;
  `labels[].label` optional confirmed in the schema, so #78 is genuinely
  pre-existing; no TODO/FIXME in `packages/*/src`.
- **Loop bound:** 1 fresh round; 1 MAJOR + 3 NITs, all actionable and fixed → gate met.
- **Doubt-theater guard:** the fresh pass found a MAJOR that the in-session pass
  missed twice (Pass 3 should have caught the build-wiring seam), and it also
  caught staleness in this artifact. Not an always-green doubt pipeline.

## Final verdict

**PASS — rounds: 3 (2 in-session corrections + 1 fresh-context reconcile, all
findings actionable and fixed).** Ready for operator merge. Post-testing feedback
re-enters as correction blocks (small findings) or a fresh `/sota-workflow` round
(large); recorded path: correction blocks.
