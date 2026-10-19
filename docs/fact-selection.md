# Fact selection per rendered profile — SPEC proposal (Q11)

**Status: PROPOSED — deferred by the operator.** Nothing here is contract until the
six gates in §10 are answered explicitly (dev-methodology §1: SPEC first, then
code). The open question is recorded as **Q11** in `docs/SPEC.md` §14; on blessing it
becomes **D22** and §4–§6 fold into a SPEC detail section.

**Decision trace (2026-10-19).** The operator deferred all six gates in
[#235](https://github.com/ChristianLuciani/profile-as-code/issues/235#issuecomment-6270727058)
(comment 15:19:25Z): *"las seis gates (G1–G6) no están confirmadas todavía"*. An
earlier ratification of D22 on this branch was **reverted** for exactly that reason:
the tree must not record as resolved what the recorded decision defers. §10 lists
**recommendations**, not decisions.

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
    "default": { "mode": "all" },            // rule for any view not named below
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

A **view rule** has these fields:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `"all"` \| `"tags"` | `"all"` | the *basis*: every entry, or only entries carrying one of `tags` |
| `tags` | `string[]` | `[]` | allowlist, only meaningful with `mode: "tags"` |
| `excludeTags` | `string[]` | `[]` | deny list by tag, applies in **every** mode |
| `excludeKeys` | `string[]` | `[]` | deny list by §19.2 key (`experience:<id>`, `projects:<id>`, …) |
| `platform`, `lang` | `string` | — | optional target, so `--view <name>` alone is enough |

`selection.default` is a **sibling of `views`**, not a field: it is the rule applied
to any view that `views` does not name (including the implicit view of a positional
`pasco build <platform>`). Absent ⇒ `{}` ⇒ no filtering.

### 4.3 Resolution rules

1. **View resolution order**: `views[<name>]` → `selection.default` → `{}`.
2. **An unknown view is an error**, not a fall-through: if `--view <name>` names
   neither a `views` entry nor is covered by `default`, the build fails
   (`selection/unknown-view`). A misspelled view that silently built everything
   would be the same class of bug as an unresolvable `excludeKeys` entry.
3. **Precedence, stated once**: a view may carry `platform`/`lang`.
   - positional `[platform]` vs the view's `platform`: equal → fine; different →
     **error** (ambiguous target, never a silent winner);
   - a view with no `platform` and no positional platform → **error** (there is
     nothing to build);
   - `--lang` on the command line **wins** over the view's `lang`, which wins over
     `.pascorc.defaults.lang`, which wins over `en`.
4. **Exclusion always wins** over inclusion (fail-safe direction: a deny is never
   silently overridden by a tag match).
5. **No policy ⇒ no filtering ⇒ byte-identical output.** The compatibility
   guarantee; asserted by a golden test, not by inspection (D19/§15.1).
6. **Participating blocks are exactly these eight entry arrays**: `experience`,
   `projects`, `publications`, `education`, `press`, `credentials`, `artifacts`,
   `skills`. Singleton blocks (`identity`, `positioning`, `keywords`) and the
   text-bearing `bios`/`headlines`/`socialHandles` are **never** selectable in v1
   (§6) — text adapts through `lang`/`refine`, not through selection.
7. **Tags apply only to tag-capable blocks.** `tags` exists on `artifacts` today
   (schema:913) and Phase 2 adds it to `experience`, `projects`, `publications`,
   `education`, `press`, `credentials` — **not** to `skills`. A skill is addressed
   by its natural key (`skills:<name>`), never by tag. Consequence, stated because
   it is the surprising part: **in Phase 1 `mode: "tags"` filters `artifacts` only**;
   the other seven blocks pass through untouched and are addressed by `excludeKeys`.
8. **`mode: "tags"` is an explicit allowlist for tag-capable blocks**: an untagged
   artifact is *not* selected. This is the case the report in §4.6 must name.

### 4.4 Engine seam

New module `packages/core/src/selection.ts`, pure / deterministic / offline, beside
`completeness()` and `geoCheck()` (§7):

```ts
interface ViewRule { mode?: "all" | "tags"; tags?: string[]; excludeTags?: string[];
                     excludeKeys?: string[]; platform?: Platform; lang?: Lang }
interface SelectionPolicy { default?: ViewRule; views?: Record<string, ViewRule> }

selectFacts(profile, view, platform, lang, policy?): { profile: Profile; report: SelectionReport }
//   SelectionReport = { view, platform, lang, mode,
//                       selected: Record<Block, number>,
//                       omitted:  { block, key, label, reason }[],
//                       findings: SelectionFinding[] }
```

`compile()` currently takes `policy?: CompletenessPolicy` (`compile.ts:34`). Phase 1
changes that parameter to a **new alias** — `CompilePolicy = CompletenessPolicy &
{ selection?: SelectionPolicy; view?: string }` — which is additive at the type
level (every existing caller still type-checks, since all new fields are optional)
but **is** a signature change worth calling out: the old symbol is not renamed, and
`packages/paste` keeps calling it with a completeness policy.

**The split that must be explicit**, because it decides whether the feature is
honest:

- `structuredData` is assembled from the **filtered** profile — the JSON-LD
  `hasCredential` set must match the credentials actually rendered, or the output
  would claim entities it does not show.
- `completeness` stays computed from the **unfiltered** profile — §20 scores the
  *workspace*, not a view. A view that hides half the SSOT must not report a lower
  completeness; that would make the number depend on the build target.

### 4.5 Checks

Codes follow the repo's `<ns>/<slug>` convention (`drift/date-range-inverted`,
`geo/entity-id`, `check/private-in-public-output`).

| Check | Class | Why |
|---|---|---|
| `selection/unknown-key` | **error** | an addressed key that resolves to nothing is an unsatisfied instruction (§19.2: addressed ⇒ resolvable). |
| `selection/unknown-tag` | warn | a tag matching no entry — likely a typo, not an instruction. |
| `selection/empty-facts` | warn | a view selected zero entries while the SSOT has some. |
| `selection/anchor-omitted` | warn | a `positioning.geo.semanticAssociations` anchor is reinforced only by omitted entries — the coverage cost from §2, named. |
| `selection/omits-facts` | **warn** | **any** view that omits one or more entries, naming each omission and its reason — the operator's G1 amendment: the default direction of a profile is *publish*, so anything that removes a fact owes the user a statement. |

`selection/unknown-view` is the fifth code but **not** a profile finding: it fires
before the profile is read, as a config error (exit 1) — the view name cannot be
resolved, so there is nothing to select from (§4.3 rule 2).

### 4.6 CLI

One arity for both commands, no positional collision:

- `pasco build [platform] [--view <name>] [--lang]` — `--view` is additive; the
  positional platform stays and is the implicit view of the same name.
- `pasco status [platform] --selection [--view <name>]` — `--selection` is a
  **boolean**; the view is named with `--view` so it can never be confused with the
  `[platform]` positional. It prints what each surface emits, every omission and
  its reason. Without this, `mode: "tags"` is a footgun; with it, the surprise is
  caught before deploy (§20/`--completeness` is the precedent).
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

| # | Question | Recommendation |
|---|---|---|
| G1 | Is subset-only admissible under Goal 2/3 and §15.4? | **Yes** — see §2: the invariant constrains content, not coverage; `geo.ts:21` already scores absence as neutral. |
| G2 | Policy home: `.pascorc` (config) vs the SSOT (per-entry)? | **`.pascorc`** — the §20 pattern ("store only the policy"), and it keeps the data platform-free. |
| G3 | Vocabulary: `views`, `faces`, `profiles`, `selections`? | **`views`** — `profile` is already overloaded here. |
| G4 | Phase 2 tags on which blocks? | `experience`, `projects`, `publications`, `education`, `press`, `credentials`. |
| G5 | Is Phase 3 (two views on one platform, new output dir) in scope now? | **Defer** — Phase 1 already answers the request; Phase 3 needs a D19 amendment. |
| G6 | Unknown key (and unknown view): error or warn? | **Error** — matches §19.2's "an addressed key must resolve". |

None of the six is answered yet; the table is a recommendation set, not a record.

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

## Appendix — the SPEC entry this proposal adds (Q11, `docs/SPEC.md` §14)

> - Q11 (**proposal, not a decision**): **fact selection per rendered profile** — the
>   engine can only adapt *text* per platform today (`lang`, `refine` variants); the
>   SSOT's facts pass through untouched (`compile.ts:90-95`) and §18.9's declared
>   "renderers select by platform + lang + tags" is unimplemented (no renderer reads
>   `tags`). Proposal: a workspace policy in `.pascorc` (`selection.views`) plus
>   optional `tags[]` on the fact blocks — subset-only, exclusion wins, no policy ⇒
>   byte-identical output. Design, options, plan and the six decision gates:
>   `docs/fact-selection.md`.
