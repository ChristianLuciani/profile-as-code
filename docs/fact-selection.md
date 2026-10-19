# Fact selection per rendered profile — the decision record (Q11 → D22)

**Status: RATIFIED as D22 on 2026-10-19** (issue #235). The contract now lives in
`docs/SPEC.md` §5 (D22) and §21 (detail); **that is the source of truth**. This
document is the *why* behind it — the gap it closes, the options discarded and the
reasoning behind the invariant ruling — and is not restated as contract.

**Operator decision (G1, as amended):** subset-only is admissible, **but every
omission must warn the user** — carried into §21.4 and enforced by
`selection-anchor-omitted` / `selection-empty-facts` and the omission finding itself.
G2–G6 were taken at their recommended values (policy in `.pascorc`, `views`, Phase-2
tags on the six entry blocks, Phase 3 deferred, unknown key = error); the operator's
"dale" blessed the direction, so any of them can be reopened without touching the
invariant ruling.

Cubre: la brecha entre §18.9 (selección declarada) y el código (sin selección), el
diseño de una política de selección por vista, y el plan por fases con sus gates ·
No cubre: la implementación (vive en §21 y en su fase 1), renderers nuevos, cambio de
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

## 4. Proposed contract (draft D22)

### 4.1 Vocabulary — "view"

A **view** is a named projection of the workspace: a target platform, a language,
and a selection. `pasco build linkedin` is the implicit view named `linkedin`; a
declared view may override platform/lang and add selection. The noun is proposed as
`view` because `profile` is already overloaded in this codebase (`PlatformProfile`,
`.pascorc profile-data`); alternatives are a decision gate (§10, G3).

### 4.2 Policy grammar (`.pascorc`, workspace config)

```jsonc
{
  "selection": {
    "default": { "mode": "all" },            // absent ⇒ this ⇒ today's behavior
    "views": {
      "linkedin": {
        "mode": "all",
        "excludeKeys": ["projects:acme-internal"],
        "excludeTags": ["nda"]
      },
      "film": {
        "platform": "github-readme",         // optional; enables `--view film`
        "lang": "en",
        "mode": "tags",                       // allowlist
        "tags": ["film"]
      }
    }
  }
}
```

Grammar, deliberately small:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `"all"` \| `"tags"` | `"all"` | the *basis*: everything, or only entries carrying one of `tags` |
| `tags` | `string[]` | `[]` | allowlist, only meaningful with `mode: "tags"` |
| `excludeTags` | `string[]` | `[]` | deny list by tag, applies in **every** mode |
| `excludeKeys` | `string[]` | `[]` | deny list by §19.2 key (`experience:<id>`, `projects:<id>`, …) |
| `platform`, `lang` | `string` | — | optional target, so `--view <name>` alone is enough |

### 4.3 Resolution rules

1. **Exclusion always wins** over inclusion (fail-safe direction: a deny is never
   silently overridden by a tag match).
2. **No policy ⇒ no filtering ⇒ byte-identical output.** The compatibility
   guarantee; asserted by a golden test, not by inspection (D19/§15.1).
3. **Only entry arrays participate**: `experience`, `projects`, `publications`,
   `education`, `press`, `credentials`, `artifacts`, `skills`. Singleton blocks
   (`identity`, `positioning`, `keywords`) are never selectable in v1 (§6).
4. **Addressing reuses §19.2.** Keys are the ledger keys already validated for
   uniqueness; an entry without an `id` is not key-addressable (the same rule
   `pasco status` already applies — "rows without an id are untracked"). Tags are
   the fallback label for unaddressed entries, which is why §5 phases them.
5. **`mode: "tags"` is an explicit allowlist**: an untagged entry is *not* selected.
   This is the surprising case, so the report in §4.6 must name what it dropped.

### 4.4 Engine seam

New module `packages/core/src/selection.ts`, pure / deterministic / offline, beside
`completeness()` and `geoCheck()` (§7):

```ts
interface ViewRule { mode?: "all" | "tags"; tags?: string[]; excludeTags?: string[];
                     excludeKeys?: string[]; platform?: Platform; lang?: Lang }
interface SelectionPolicy { default?: ViewRule; views?: Record<string, ViewRule> }

selectFacts(profile, view, policy): { profile: Profile; report: SelectionReport }
//   SelectionReport = { view, platform, lang,
//                       selected: Record<Block, string[]>,
//                       omitted:  Record<Block, { key: string; reason: string }[]>,
//                       findings: Issue[] }
```

`compile(profile, platform, lang, policy?)` gains `policy.selection` — **additive**
(`CompilePolicy = CompletenessPolicy & { selection?: SelectionPolicy }`), so every
existing caller and `packages/paste` keep compiling unchanged.

**The split that must be explicit**, because it decides whether the feature is
honest:

- `structuredData` is assembled from the **filtered** profile — the JSON-LD
  `hasCredential` set must match the credentials actually rendered, or the output
  would claim entities it does not show.
- `completeness` stays computed from the **unfiltered** profile — §20 scores the
  *workspace*, not a view. A view that hides half the SSOT must not report a lower
  completeness; that would make the number depend on the build target.

### 4.5 Checks

| Check | Class | Why |
|---|---|---|
| `selection-unknown-key` | **error** | an addressed key that resolves to nothing is an unsatisfied instruction. Matches §19.2's rule that an addressed key must resolve; a typo must fail loudly rather than silently omit a fact. |
| `selection-unknown-tag` | warn | a tag matching no entry — likely a typo, not an instruction. |
| `selection-empty-facts` | warn | a view selected zero entries while the SSOT has some. |
| `selection-anchor-omitted` | warn | a `positioning.geo.semanticAssociations` anchor is reinforced only by omitted entries — the coverage cost from §2, named. |
| `selection-omits-facts` | **warn** | **any** view that omits one or more entries, naming each omission and its reason — the operator's G1 amendment: the default direction of a profile is *publish*, so anything that removes a fact owes the user a statement. |

### 4.6 CLI

- `pasco build [platform] [--view <name>] [--lang]` — `--view` is additive; the
  positional platform keeps working and is the implicit view of the same name.
- `pasco status --selection [view]` — the resolved report: what was selected, what
  was omitted, and the reason for each. Without this, `mode: "tags"` is a footgun;
  with it, the surprise is caught before deploy. (Precedent: `--completeness` and
  `--write-checklist` already extend `status`, §20/D18.)
- `pasco check` runs §4.5.

### 4.7 Byte-stability

`profiles/` stays a pure function of the workspace (D19/§15.1): same workspace +
same policy ⇒ identical bytes. No policy ⇒ identical to `main` today. Deterministic
iteration order (declaration order of the SSOT, never a hash map's order).

## 5. Schema delta — phased, additive

**Phase 1 — zero schema change.** Selection by §19.2 key for every addressed block,
plus **implementing `artifacts[].tags`**, which the schema already carries
(`schema/profile.schema.json:913`) and no renderer reads. This phase alone answers
the operator's request and closes the declared-vs-implemented breach.

**Phase 2 — optional `tags[]` on the fact blocks** (`experienceItem`, `project`,
`publication`, `educationItem`, `pressItem`, `credential`), shaped like the artifact
field, plus a shared `$defs/tag` (slug pattern). Additive, optional ⇒ semver minor,
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
| 1 | `selection.ts` + `CompilePolicy` + `.pascorc` parsing + `status --selection` + §4.5 checks; tests first: default byte-parity golden, exclude-wins, unknown-key error, determinism, subset property (output facts ⊆ SSOT facts), JSON-LD↔rendered-credentials consistency | `pnpm test && pnpm build && pnpm typecheck && pnpm lint` |
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
| G1 | Is subset-only admissible under Goal 2/3 and §15.4? | **YES, with a mandatory warning on omission** (operator amendment — §21.4). The invariant ruling stands: it constrains content, not coverage. |
| G2 | Policy home: `.pascorc` (config) vs the SSOT (per-entry)? | `.pascorc` (recommended value taken). |
| G3 | Vocabulary: `views`, `faces`, `profiles`, `selections`? | `views` (recommended value taken). |
| G4 | Phase 2 tags on which blocks? | `experience`, `projects`, `publications`, `education`, `press`, `credentials` (recommended value taken). |
| G5 | Is Phase 3 (two views on one platform, new output dir) in scope now? | Deferred; needs a D19 amendment (recommended value taken). |
| G6 | Unknown key: error or warn? | Error (recommended value taken). |

## 11. Evidence

| Claim | Anchor |
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
- **§21** — `docs/SPEC.md`: the contract (view + rule grammar, resolution rules, the
  filter/unfiltered split, the four checks, the CLI surface, the phase boundary).
- **§18.9** — now points at §21 rather than restating the rule (single source).
- **M10** — `docs/SPEC.md` §12: the milestone, Phase 1 schema-free first.
- **Implementation** — Phase 1 in `packages/core/src/selection.ts` + `.pascorc`
  parsing + `build --view` / `status --selection`, tests first (TDD).
