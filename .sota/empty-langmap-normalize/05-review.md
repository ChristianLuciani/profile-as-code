# 05-review.md — sota-review of PR #85 (empty-langmap-normalize, issue #84)

Reviewer: in-session adversarial pass (skill `sota-review`).

**Model-routing gap declared:** session model = `glm-5.3-flash:cloud` (ollama) —
authoring session and reviewer share the tier; mitigation = the step-9
`premerge-review` fresh pass (same mitigation as PR #83, which the fresh pass
validated as productive: it found F1 there). Preconditions unmet, declared:
no `/sota-workflow` — contract = issue #84 + the operator's option-(a)
ratification (2026-09-17, recorded in the claim comment) + PR #85 body.
Build: commit `e88e5b3` on `pi/profile-as-code/empty-langmap-normalize`
(7 files +127/−6), base `main` @ `5e9be35` (PR #83 merge).

**Contract conflict (skill vs repo):** same as PR #83 — step 8 says never
push/open the PR; repo contract (session-discipline §2) makes the open PR the
minimum delivered state. Flagged per precedent, not silently resolved.

## Pass 1 — Spec fidelity → PASS

| Item (contract) | Evidence |
|---|---|
| Option (a): "normalize at the text accessor (pickText/langText), `""` = absent" | Exactly 3 accessors changed: `compile.ts` `langText` (L34, engine-wide: statement/audiences/citationsGoal; geo inherits from compile), `github-readme` `pickText` (L91), `github-org` `pickText` (L55). No other emission path touched |
| "absence at BOTH lookup levels" (es: `""` → falls to en) | Core test 3 (`es: ""` → `en: real statement` + fallback recorded) — **re-run red→green** |
| "no ghost fallbacks" | Core test: `fallbacks` must NOT contain the empty-audience path — the `fallbacks.push` moved inside the successful-en branch |
| "sin trim" (whitespace-only stays data) | No trim in any accessor ✓ — **but the boundary is NOT pinned by a test** (finding N-1 below) |
| "byte-parity for populated inputs" | All byte-for-byte EXPECTED tests untouched and green (suite 258/258) |
| The degenerate rows from the issue's table are gone | readme test (exact `- **hub**` row + no `Evidence:` + no trailing dash), org test (no `> ` ghost, no `** **`, newsletter hostnamePath fallback) — all red-confirmed before the fix |

## Pass 2 — Correctness → PASS (no regressions found)

Adversarial hunt over the final diff — the fear case was a consumer of
`pickText`/`langText` interpolating without a guard, which would flip
`- ** **` (cosmetic) into `- **undefined**` (the #78 class):

- **Enumerated all 10 emission sites** over both renderers: tagline/mission
  guarded (`!== undefined`), newsletter name (`?? hostnamePath`), podcast
  title (**`?? '(untitled)'` — pre-existing guard**, verified in source
  L112), podcast desc guarded, press outlet/title (`?? '?'`), readme
  artifact/project desc + evidence claim guarded. Zero unguarded
  interpolations reachable with the new `undefined` returns.
- **geo's `langValues`** (geo.ts:63) is a third text accessor NOT normalized —
  verified **behaviorally inert**: the empty entries in the anchor-reinforcement
  haystack can never contain an anchor, so they are equivalent to absent.
  Recorded as Consider (uniformity), not a defect.
- `compiled.citationsGoal` has no raw-interpolating consumer (compile + geo-raw
  only).
- bios/headlines texts come from the variants store (`min(1)` in schema) —
  unreachable by this fix.
- `||`-chain falsy analysis: the only falsy strings reachable through Zod are
  `""`; `"0"`/whitespace are truthy and preserved. Correct per the ratified
  rule (no trim).

## Pass 3 — Coherence → PASS

Single worker. The three accessor comments are deliberately identical (the
signal that it is ONE rule); test describe/it names follow the repo's
issue-referencing convention; CHANGELOG entry matches the house style. No
parallel seams.

## Findings

- **N-1 (NIT):** the no-trim boundary is asserted in comments/CHANGELOG but
  not pinned by a test — a future `.trim()` would pass silently. One-line
  assertion (`pickText({en: " "})` returns `" "`) would pin it. Non-blocking.
- **Consider — geo uniformity:** `langValues` (geo.ts:63) keeps `""` entries
  in the reinforcement haystack (inert, no observable defect). One-liner
  (`filter(Boolean)`) for accessor consistency — deferred with rationale: no
  motivating defect/test, geo reads the raw profile (not the compile slice),
  and this PR's contract is the degenerate rendering. Noted on issue #84.

## Verification story

- Suite 258/258 + typecheck clean on `e88e5b3`; CI pass (run 35241097138).
- TDD: 5 red (core 3 / readme 1 / org 1) reproducing the exact degenerate
  outputs + the two-level fallback, then green.
- Byte-parity: every byte-for-byte test untouched and green.

## Verdict

**PASS — round 1** (no BLOCKER, no REQUIRED; 1 NIT + 1 Consider, both
non-blocking). Handoff to the human: PR #85 as-is, awaiting the fresh
`premerge-review` pass before merge.

## Fresh-context reconcile

Fresh `premerge-review` executed 2026-09-17 by an ephemeral, clean pi session
(`--no-session`, spawned by the authoring session from the main checkout —
zero findings passed to it). Verdict: **PASS-CON-RIESGOS** (informativo).
All findings re-verified against the code before classification:

- **F1 (MAJOR) → split: claim fixed (actionable) + geo divergence (trade-off
  → issue #86).** The claim "geo inherits from compile" in the PR body was
  the author's overclaim — `geoCheck(profile)` reads the **raw profile**
  (validate.ts:35); PR body corrected. The geo-internal divergence the
  reviewer proved (structuredData treats `""` as absent via falsy checks;
  readiness `Boolean(identity.mission)` on the OBJECT counts `""` as present
  — same mission, two answers) is pre-existing geo code, now live against the
  ratified rule. **Acepto este riesgo porque** fixing geo is its own semantics
  pass over three accessors with its own tests — no observable defect in
  #85's contract. → follow-up issue **#86** (together with F2/F3).
- **F2 (NIT — newsletter.cadence `""` trailing separator) → valid trade-off →
  issue #86:** plain-string subclass of the same symptom, outside #84's
  langMap contract.
- **F3 (NIT — langMap values untyped in schema) → trade-off → issue #86:**
  `{en: 0}`/`{en: []}` schema-valid while consumers assume
  `Record<string, string>` — latent, issue-first per D3.
- **F4 (NIT — coverage) → partially actionable, fixed:** a dedicated
  `citationsGoal: {en: ""}` test added (suite 259/259); the remaining
  mechanical-coverage sites (podcast desc, artifact desc) noted — the single
  accessor rule makes them redundant.
- **F5 (NIT — CHANGELOG typo "el acces de texto") → actionable, fixed.**

What the fresh review could NOT refute (recorded as survived): the accessor
semantics (`|| undefined` maps only falsy→absent at both levels;
`fallbacks.push` exactly when en truthy is returned — no ghost entries);
byte-parity (`||` ≡ `??` on truthy strings; the CLI fallbacks print changes
only for empty-string workspaces — consistent with "only the degenerate
improves"); all 10 emission guards enumerated; the #78 class not reopened;
`{es: ""}` without `en` impossible (schema requires `en`); plain
`name`/`title`/`venue` fields carry `min(1)` — the empty-name hazard is
schema-impossible. Reviewer limits declared: no local test execution
(read-only contract) — suite/CI corroborated statically.

**Doubt-pipeline health check (step 12):** findings WERE classified
actionable (F1-claim, F4, F5 fixed; geo/cadence/schema accepted with
rationale) — the gate is not always-green theater.