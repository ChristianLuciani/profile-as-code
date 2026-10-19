# Fact selection per rendered profile — decision record (Q11 → D22)

**Status: RATIFIED as D22 (2026-10-19).** The contract lives in `docs/SPEC.md` §5
(D22) and §21 (detail); **that is the single source**. This document is the record
of the *why* — the gap it closes, the invariant ruling, the options discarded — and
deliberately does not re-enunciate the grammar, the checks or the CLI.

**Decision trace.** The operator ratified the six gates on 2026-10-19 and the
confirmation is recorded in
[#235](https://github.com/ChristianLuciani/profile-as-code/issues/235#issuecomment-6271227936).
One correction worth keeping: a *deferral* comment appeared earlier on that issue
(15:19:25Z) and was **not** the operator's decision — another session wrote it
interpreting a different question. A ratification recorded before that was reverted;
with the confirmation on the record, it is re-applied here. The lesson is structural:
a decision exists only when it is written where the repository can see it, which is
why the confirmation now precedes the commit.

Cubre: la brecha entre §18.9 (selección declarada) y el código (sin selección), el
diseño de una política de selección por vista, y el plan por fases con sus gates ·
No cubre: implementación (no hay código en este PR), renderers nuevos, cambio de
identidad por workspace (sigue siendo un workspace separado, §18.9/D15), ni el
scoring GEO por vista · as_of: 2026-10-19

## 1. The gap

Two distinct holes, one cause: the SSOT is platform-agnostic and the seam that
should adapt it per surface does not exist.

| Declared | Implemented | Evidence |
|---|---|---|
| "renderers select by platform + lang + tags" (§18.9) | no renderer reads `tags` | `docs/SPEC.md:916-918`; `grep '\.tags' packages/renderers/` → 0 hits |
| `artifacts[].tags[]` exists as a multi-area field | the field is validated and then ignored | `schema/profile.schema.json:913` |
| `compile()` produces the per-platform slice | facts pass through **untouched**, artifacts included | `packages/core/src/compile.ts:90-95`, `:114` |
| Renderers emit `visibility: public` only (§18.5) | that is the *only* per-platform filter that exists | `packages/core/src/registry.ts:34`; `packages/renderers/github-readme/src/index.ts:265` |

So today the only way to change *which* facts appear on a surface is `visibility`
(a privacy control, not an editorial one) or building a second workspace (which
duplicates the facts and recreates the drift the engine exists to prevent).

The operator's request — *"choose which facts render a particular profile"* — is
not covered by either.

## 2. Is selection legal? The invariant question

This is the decision that governs the whole design, so it is argued before it is
assumed.

The contract states three things that look like they forbid selection:

- Goal 2: "the same fact never contradicts itself across platforms" (`docs/SPEC.md:23`).
- Goal 3: "Facts stay identical; storytelling adapts." (`docs/SPEC.md:25`).
- §15.4: "Facts (dates, DOIs, roles, counts) appear byte-identical to the SSOT —
  that is citability" (`docs/SPEC.md:638`).

**Reading.** All three constrain what a fact may *say* when it appears; none
requires a fact to *appear everywhere*. "Byte-identical to the SSOT" is a statement
about fidelity, not about coverage. A fact that is absent from a surface cannot
contradict the same fact on another surface — contradiction needs two statements,
and omission produces one.

**The engine already holds this position.** `geo.ts:21` — "Missing data is neutral
(score 1...)" — governs the whole GEO scorer: a sparse profile is not penalised for
what it does not claim. Selection manufactures exactly that kind of absence, so it
is consistent with the scoring philosophy already ratified, not an exception to it.

**Proposition.** Selection is admissible **iff it is subset-only**: the operation
removes entries and never edits, renames, reorders-by-value or re-derives one.
Formally, a rendered profile is a sub-conjunction of the SSOT's facts; removing a
conjunct cannot introduce a contradiction between the remaining ones.

**What it does cost** (stated plainly, §8): coverage. An LLM triangulating LinkedIn
against GitHub will see a thinner LinkedIn. The `geoAnchors` reinforcement signal
(§20) can drop when an anchor lives only in omitted entries. That is a deliberate
editorial trade the owner makes, not a defect — but it must be **visible**, which is
why §4.5 makes omission reportable.

**Consequence for the contract.** The invariant is unchanged. What changes is that
the engine gains a second, explicit dimension of per-surface adaptation alongside
`lang` and `refine` variants: `lang` adapts *text*, `refine` adapts *storytelling*,
selection adapts *which facts*. All three leave a fact's content untouched.

## 3. Options

| # | Option | Where the decision lives | Verdict |
|---|---|---|---|
| A | Per-entry `platforms: []` / `excludeFrom: []` on every fact block | in the SSOT data | **Rejected.** Couples the platform-agnostic SSOT to a platform enum (D14/§9), turns the data into an N×M matrix, and forces every new platform to edit every entry. It also moves the decision into the *facts*, which is precisely what Goal 3 protects. |
| B | **Tags on entries + a selection policy in `.pascorc`** | policy in workspace config, labels in data | **Recommended.** Matches the §20 pattern verbatim ("compute in the engine, store only the policy"), keeps the SSOT platform-free, and reuses the §19.2 address scheme already validated for uniqueness. |
| C | One workspace per audience | separate workspaces | **Rejected for this use case**, correct for a different one. §18.9 already assigns *separate identities* to separate workspaces (D15) — that stays true. Duplicating one identity's facts across workspaces to obtain subsets recreates cross-repo drift, the failure mode the engine exists to kill. |
| D | Renderer-side filtering | in each adapter | **Rejected.** Violates the "one home" precedent this repo enforces for markdown, paste and artifact projection (`packages/markdown`, `packages/paste`, `packages/artifact`): every adapter would re-implement it, and `check`/`status` would see a different slice than `build`. |
| E | A per-platform overlay YAML (SSOT + delta files) | second data source | **Rejected.** A delta file is a second source of truth for the same fact — the drift question becomes "which overlay won?", and every fact exists in two places. |

## 4. The shape, and why

**The contract is SPEC §21 (D22).** This section does not restate it — the grammar,
the resolution rules, the check table and the CLI surface live there, in one place,
and a reviewer who reads only one document must read that one. What follows is the
*reasoning* behind each shape decision, which is what a contract should not carry.

- **Policy in `.pascorc`, never in the SSOT.** The data stays platform-agnostic
  (§9/D14): a new platform must never force an edit to every entry. This is §20's
  pattern — compute in the engine, store only the policy — applied to a second axis.
- **Exclusion wins over inclusion, in every mode.** Anything that decides what gets
  published fails in the safe direction: a deny is never overridden by a tag match.
- **No policy ⇒ byte-identical output.** The compatibility guarantee, asserted by a
  golden test rather than by inspection (D19/§15.1).
- **Eight entry arrays participate; `bios`/`headlines`/`socialHandles` do not.**
  Text adapts through `lang` and `refine`; selection is for facts. Mixing them would
  turn one mechanism into two.
- **`skills` is addressable by key, never by tag.** Phase 2 adds `tags[]` to six
  entry blocks and `skill` does not need one — its `name` is already the natural key
  (§19.2).
- **Tags apply only where the schema has them.** Phase 1 is schema-free, so
  `mode: "tags"` filters `artifacts` alone and the other seven blocks pass through.
  The alternative — excluding every block without a tag field — would have made the
  first phase silently drop `experience` from a tags view. That is the kind of
  surprise the report exists to prevent, so the boundary is documented instead.
- **An unknown view is an error, not a fall-through.** Same rule as an addressed
  key: if the operator named it, it must resolve. A typo that silently builds a
  different surface is worse than a failed build.
- **`--selection` is a boolean; the name goes in `--view`.** One arity for
  `build` and `status`, so the view name can never be confused with the
  `[platform]` positional.
- **`structuredData` follows the view; `completeness` does not.** The JSON-LD must
  not claim credentials the render does not show. And §20 scores the *workspace*: a
  view that hides half the SSOT must not lower the number, or the figure would
  depend on the build target.
- **SSOT declaration order, never a map's order.** Byte-stability (§15.1) is a
  property of the output, not of the runtime.

## 5. Schema delta — phased, additive

**Phase 1 — zero schema change.** Selection by §19.2 key for every addressed block,
plus **implementing `artifacts[].tags`**, which the schema already carries
(`schema/profile.schema.json:913`) and no renderer reads. This phase alone answers
the operator's request and closes the declared-vs-implemented breach.

**Phase 2 — optional `tags[]` on the fact blocks** (`experienceItem`, `project`,
`publication`, `educationItem`, `pressItem`, `credential` — **not** `skill`, which
keeps its natural key), shaped like the artifact field, plus a shared `$defs/tag`
(slug pattern). Additive, optional ⇒ semver minor,
no workspace breaks; `pnpm gen:zod` + a schema-check fixture each way. The artifact
`tags` field then adopts the same `$defs/tag` — a tightening to declare explicitly,
since the field is free-form today and unread by any renderer (so no output can
change; this is the one case where a tightening is safe and should be said out loud).

**Phase 3 — multiple views per platform** (a second `github-readme` output, e.g. a
film face and a tech face). This needs an output-path decision
(`profiles/<view>/` vs `profiles/<platform>/`) and therefore an **amendment to
D19**, not a silent extension. Gated by §10, G5.

## 6. Non-goals (v1)

- **No per-view mutation.** Selection removes; it never rewrites a fact. Enforced
  structurally (the function filters), and this is what keeps §2's proof true.
- **No `platforms[]` in the SSOT** (option A) — the data stays platform-free.
- **No renderer-side filtering** (option D).
- **No singleton-block selection** (`identity`, `positioning`, `keywords`).
- **No view-aware `geoCheck`/`driftCheck` scoring.** Both keep reading the SSOT;
  the view-aware view is the report in §4.6, not a new score.
- **No change to §20 weights.** Completeness stays a workspace property.

## 7. Plan (TDD, staged)

| Phase | Work | Gate |
|---|---|---|
| 0 | Bless §10 → Q11 becomes D22; §4–§6 fold into a SPEC detail section | operator decision |
| 1 | `selection.ts` + the `CompilePolicy` alias + `.pascorc` parsing + `build --view` + `status --selection` + the six §4.5 checks; tests first: default byte-parity golden, exclude-wins, unknown-key error, determinism, subset property (output facts ⊆ SSOT facts), JSON-LD↔rendered-credentials consistency | `pnpm test && pnpm build && pnpm typecheck && pnpm lint` |
| 2 | `tags[]` on the fact blocks + `$defs/tag` + `pnpm gen:zod` + schema-check fixtures (valid/invalid tag) | `gen:zod` freshness + `scripts/schema-check` |
| 3 | Views with their own output dir (if G5 says yes) | D19 amendment + `renderer-map`/deploy-spec parity |

Tests live beside the module (`packages/core/tests/selection.test.ts`) with a
committed fixture workspace (tagged entries + a policy), per AGENTS.md rule 5. Phase
1 ships **no schema change**, so it needs no `gen:*` projection.

## 8. The cost, stated plainly

1. **Coverage, not consistency.** A thinner surface is not a contradiction, but an
   LLM citing a platform will cite what it sees. Anchors that live only in omitted
   entries stop reinforcing (§20 `geoAnchors`), so the owner trades reach for
   focus — deliberately.
2. **`mode: "tags"` hides untagged entries by construction.** Second-order effect:
   adding a new project *without* a tag silently keeps it off every tag-scoped view.
   The mitigation is the `status --selection` report; a future opt-in could invert the
   default, but inverting it now would violate rule 2 of §4.3.
3. **Two sources of intent.** The SSOT says what is true; the policy says what each
   surface shows. That is one more thing to keep coherent — accepted because the
   alternative (option A) puts the same information in the data and couples it
   harder.

## 9. Back-compatibility

- No policy ⇒ no behavior change, byte-identical (`main` today).
- `compile()`'s signature is extended additively; `packages/paste`, `status`,
  `refine` and the renderers keep compiling.
- Phase 1 touches no schema. Phase 2 is additive-optional. Phase 3 is the only
  genuinely breaking piece and is gated.
- `profile-data` workspaces and the template need no migration.

## 10. Decision gates for the operator

| # | Question | Decision (2026-10-19) |
|---|---|---|
| G1 | Is subset-only admissible under Goal 2/3 and §15.4? | **Yes** — see §2: the invariant constrains content, not coverage; `geo.ts:21` already scores absence as neutral. |
| G2 | Policy home: `.pascorc` (config) vs the SSOT (per-entry)? | **`.pascorc`** — the §20 pattern ("store only the policy"), and it keeps the data platform-free. |
| G3 | Vocabulary: `views`, `faces`, `profiles`, `selections`? | **`views`** — `profile` is already overloaded here. |
| G4 | Phase 2 tags on which blocks? | `experience`, `projects`, `publications`, `education`, `press`, `credentials`. |
| G5 | Is Phase 3 (two views on one platform, new output dir) in scope now? | **Defer** — Phase 1 already answers the request; Phase 3 needs a D19 amendment. |
| G6 | Unknown key (and unknown view): error or warn? | **Error** — matches §19.2's "an addressed key must resolve". |

All six are answered; the confirmation is
[here](https://github.com/ChristianLuciani/profile-as-code/issues/235#issuecomment-6271227936).

## 11. Evidence

Anchors below are `file:line` **at `30555c1`**, the base of this branch; they move
when a section above them is inserted, so cite the sha with the line.

| Claim | Anchor at `30555c1` |
|---|---|
| §18.9 declares tag-based selection | `docs/SPEC.md:916-918` |
| `artifact.tags` exists, shape `string[]` | `schema/profile.schema.json:913`, `$defs.artifact` |
| No renderer reads `tags` | `grep -rn '\.tags' packages/renderers/ --include=*.ts` → 0 matches (2026-10-19, `30555c1`) |
| Facts pass through untouched | `packages/core/src/compile.ts:90-95` |
| Artifacts are not filtered by tag | `packages/core/src/compile.ts:114` |
| Only `visibility` filters per surface | `packages/core/src/registry.ts:34`; `packages/renderers/github-readme/src/index.ts:265` |
| Absence is already scored as neutral | `packages/core/src/geo.ts:21` |
| Byte-identical facts are the citability rule | `docs/SPEC.md:638` |
| Ledger keys are the address scheme | `docs/SPEC.md:1011-1040` (§19.2) |
| Policy-in-config is the established pattern | `docs/SPEC.md:1275-1306` (§20) |

---

## Appendix — where this landed

- **D22** — `docs/SPEC.md` §5: subset-only, policy in `.pascorc`, omission warns.
- **§21** — the contract: view/rule grammar, resolution order and precedence, the
  filtered/unfiltered split, the five finding codes (plus `selection/unknown-view`
  as a config error), the CLI surface and the phase boundary.
- **§13** — Q11 → D22 resolved; **§14** no longer lists it.
- **§18.9** — points at §21 rather than restating the rule (single source).
- **§12** — M10: Phase 1 schema-free first.
- **#237** — Phase 1 implementation, stacked on #236.
