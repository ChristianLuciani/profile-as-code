# 05-review.md — sota-review of PR #83 (links-label-fallback, issue #78)

Reviewer: in-session adversarial pass (skill `sota-review`).

**Model-routing gap declared:** session model = `glm-5.3-flash:cloud` (ollama) —
the session that authored the code is also the strongest worker available here,
so the reviewer equals but cannot outrank the builder. The skill's step 2 asks
to switch up before continuing; the mitigation is the step-9 terminal doubt
pass: `premerge-review` in a fresh, clean session, whose findings reconcile in
this file. Same shape as the `renderer-md-safety` precedent (`05-review.md` of
PR #79).

**Preconditions — partially unmet, declared:** this change did **not** run
through `/sota-workflow`, so there is no `.sota/<slug>/03-spec.md` nor
`04-build.md`. Review inputs:

- Contract: issue #78 (repro, `## Esperado` options (a)/(b), "Archivos
  sospechosos", ADR-lite) · `docs/SPEC.md` §15.2 (does not pin the label
  fallback — verified) · repo rules (AGENTS.md, D3, D8).
- Build: commit `7fd3333` on branch `pi/profile-as-code/links-label-fallback`
  (includes the review-round fix R1 below), 3 files +87/−8, base `main` @
  `0845c27` (PR #82 merge).
- PR: #83 (opened before this phase — see contract conflict).

**Contract conflict declared (skill vs repo):** step 8 of this skill says
"never push, never open the PR yourself". This repo's session-discipline §2
makes the open PR the minimum delivered state, and the same conflict was
resolved the same way in the PR #79 precedent (flagged, not silently
resolved). PR #83 was opened by the authoring session per repo contract.

## Pass 1 — Spec fidelity → PASS

Issue #78 leaves one decision to fix time ("decidida al arreglar") and one
mandatory sweep. Both resolved with evidence:

| Item (source) | Evidence |
|---|---|
| #78: a label-less `identity.links[]` must not emit `[undefined]` | **Re-run** of the 3 new tests (`vitest -t "issue #78"` → 3 passed). The red run reproduced the exact broken bytes (`- [undefined](…)`) before the fix |
| Option (b) chosen: fallback = `hostnamePath(l.url)` | `mdText(l.label \|\| hostnamePath(l.url))` — same label the `projects[]` links already emit (test at line ~406 asserts that convention); no contract change (D3-safe, schema untouched) |
| Empty-string label is schema-valid (`z.string().optional()`, no minLength) → `- [](...)` | **R1 (REQUIRED, fixed this round)** — first implementation used `??`; review found `label: ""` reachable and emitting `- [](...)`. Fixed with `\|\|` + fixture row `label: ""` + assertion `not.toContain('- [](')` |
| #78 sweep instruction: "verify whether the same pattern exists in other blocks" | Systematic: schema `$defs` required-fields cross-checked against every `${…}` interpolation in `github-readme`. Exactly 2 more instances found and fixed in the same PR: `skill.level` (parenthetical omitted), `project.status` (segment omitted). `github-org` verified clean — every optional interpolation guarded (tagline, mission, email, cadence, status). `evidenceItem.claim/source` verified **required**; `evidence.claim` guarded by `pickText` |
| Byte-parity for populated inputs | Byte-for-byte `EXPECTED` test (MINIMAL fixture: label + status + level all present) passes unmodified |
| #78 ADR-lite context (why `String()` existed) | Stale comment replaced: it documented the byte-for-byte preservation as "a separate finding (#78)" — this PR IS that finding |

## Pass 2 — Correctness → PASS (1 REQUIRED found and fixed)

Adversarial hunt over the final diff:

- **R1 — empty-string label (REQUIRED, fixed):** as above. `||` (not `??`) so
  only `""` and absent count as label-less; schema types label as `string`,
  so no other falsy value is reachable.
- **NIT — whitespace-only label (`" "`):** truthy under `||`, renders
  `- [ ](url)`. Pre-existing behavior, not a regression; trimming would
  change output for a theoretically valid input — accepted as-is, not worth
  the code.
- `hostnamePath` parse-failure fallback: unreachable post-Zod (every URL is
  `^https?://` validated at the boundary, #53) but the try/catch fallback
  remains as defense in depth.
- `not.toContain('undefined')` brittleness: fixture values cannot contain the
  word; JSON-LD/`sameAs` carry no interpolated optionals. OK.
- `mdText` escaping covers the fallback label (same path as provided labels —
  the #76 bracket property test covers the markdown-body invariant with the
  new rows in the same suite: 37/37).
- No new trust surface; no loops changed; O(1) per row.

## Pass 3 — Coherence → PASS

Single worker (no parallel seams). Consistency checks: the fallback label
matches the `projects[]` link convention verbatim (same `hostnamePath`); the
two new in-source comments follow the file's established shape (schema-
optionality + issue reference); CHANGELOG entry matches the repo's Spanish
Keep-a-Changelog style; `status` const does not shadow anything in scope.

## Verification story

- Suite 253/253 (markdown 12 · core 123 · github-readme 37 · github-org 16 ·
  cli 65) + `pnpm typecheck` clean, on commit `62fa764` (the final fix head;
  the branch tip is the review-artifact commit `a057ab3`).
- CI: pass on the branch head (run 35235961854, job re-run after the
  signature rewrite).
- Byte-parity: `EXPECTED` byte-for-byte test untouched and green.

## Verdict

**PASS — round 1** (1 REQUIRED found by the in-session pass, fixed in the
same round; no BLOCKERs). Handoff to the human is PR #83 as-is.

## Fresh-context reconcile

Fresh `premerge-review` executed 2026-09-17 by an ephemeral, clean pi session
(`--no-session`, spawned by the authoring session from the main checkout —
zero findings passed to it; only the PR link + contract). Verdict returned:
**PASS-CON-RIESGOS** (informativo). Findings classified (precedence:
contract-misread → valid+actionable → valid-trade-off → noise):

- **F1 (MAJOR) → valid trade-off, accepted + tracked.** The reviewer refuted
  the sweep's completeness claim under the broader definition R1 itself
  established (schema-valid value → degenerate public row): empty strings are
  schema-valid in every langMap (no `minLength`), and the emission guards use
  `!== undefined` — so `description: {en: ""}` emits a trailing-dash row,
  `claim: {en: ""}` a double-space row; same in `artifactLine` and in
  `github-org` (empty bold/bullets). Re-verified by the authoring session
  against the generated Zod + `compile.ts` `langText` semantics: **reachable,
  real**. Classification rationale: it is the *empty-string text subclass* —
  cosmetic degeneracy, never "undefined", never a broken link — outside issue
  #78's class (the reviewer's own framing), and fixing it requires a semantic
  decision (is `""` absent?) over `pickText`/`langText` in both renderers:
  contract-level, issue-first. **Acepto este riesgo porque** the reported
  class (#78) is complete and verified, the residual impact is cosmetic, and
  the fix belongs to its own decision. → follow-up issue **#84**
  (implementation-ready: repro, 3 fix options, byte-parity constraint).
  The Pass-1 completeness claim is hereby **scoped**: "exactly 2 more
  instances" is true of the *undefined/structural* class (independently
  re-verified by the fresh session); the empty-string text subclass was out
  of that enumeration and is tracked by #84.
- **F2 (NIT, whitespace-only label) → noise/accepted:** pre-existing, not a
  regression (reviewer confirmed); already recorded as an accepted edge in
  Pass 2.
- **F3 (NIT, stale artifact) → valid + actionable, fixed:** this reconcile
  section replaces the placeholder; the stale CI run reference corrected
  above.
- **F4 (NIT, coverage asymmetry) → folded into #84:** the
  `description: {en: ""}` / `claim: {en: ""}` fixture rows belong to that
  fix, not to this PR's contract.

What the fresh review could NOT refute (recorded as survived): the
"undefined" sweep completeness (all interpolations enumerated against the
generated Zod, both renderers, line by line); `hostnamePath` can never emit
an empty label (`url` min 7 + `.url()` ⇒ hostname ≥ 1, `"/"` stripped);
`||`/`??` semantics correct given Zod types; byte-parity; contract fidelity
(schema untouched, option (b) as the issue authorizes). Reviewer limits
declared: no local suite re-run (CI green as test evidence), SPEC §15.2 read
via the author's claim (mitigated: issue #78 authorizes option (b)
explicitly).