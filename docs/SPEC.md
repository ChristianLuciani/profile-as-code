# SPEC — profile-as-code engine

> Status: draft v0.3 (M2 detail) · Lang: EN (docs convention; data supports any language)
> Owner: Christian Luciani · Method: spec-driven · Related: `docs/research/01-prior-art.md`

## 1. Context

A professional identity lives across 8+ platforms (LinkedIn, Upwork, GitHub, X, ResearchGate, Substack, Patreon…)
with different rules, limits, audiences and languages. Profiles drift out of sync, facts contradict each
other across networks, and there is no way to *version* one's professional presence or to make it
consistent without copy-pasting.

Prior art shows the gap (see `01-prior-art.md`): JSON Resume/yamlresume cover CV→PDF/web, not social
profiles; `zhiweio/resume-as-code` proves the YAML + agent-skills pattern for job-application resumes;
nobody combines **SSOT versioning + multi-platform renderers + intent-driven AI optimization + per-platform
skills + deploy playbooks**.

**The product is presence, not the profile** (D23, §22). A profile is one kind of
surface among several: the repo's own metadata, the npm page, the project site and
the channels where a release is announced are presence surfaces too, and they have
no profile body to render. The unit that makes presence happen is the **release**:
an event with a changed set and a fan-out. Asking "which surfaces does this
publication still owe, and in what order?" is the question the engine answers —
not only "is my profile consistent?".

## 2. Goals / Non-goals

### Goals

1. **SSOT**: a versionable, diffable, validated source of professional facts (YAML, text-first).
2. **Consistency**: the same fact never contradicts itself across platforms (drift-check).
3. **Intent-driven texts**: per-platform *angles*, AI-generated as **N variants the user chooses** —
   never mechanical placeholder output. Facts stay identical; storytelling adapts.
4. **Per-platform skills**: SOTA knowledge (limits, ranking/SEO+GEO, audience angles, pitfalls,
   executable checks), projected to agent skill studios.
5. **GEO as first-class**: generative-engine optimization — profiles must be citable by LLMs
   (consistent cross-platform facts, structured data, semantic associations).
6. **i18n**: content per language (EN essential, ES native, FR desirable); docs in EN.
7. **CLI-first**, TypeScript, zero infra. Data always owned by the user (private repo / local).
8. **Presence over profile** (D23, §22): a release is a first-class event, every
   surface carries a `kind` (`profile` · `repo-meta` · `distribution`), and the
   engine can say which surfaces a publication still owes — deterministically and
   without a second state model.

### Non-goals (v1)

- No SaaS/multi-tenant backend (may become `identikit` microSaaS later, on top of the engine).
- **No hosted on-ramp in v1** (issue #122). None of §9.2's three on-ramps reaches a visitor who has
  **neither an account nor a terminal** — a profile hosted by us — and the SPEC has no milestone for
  the service it would need: that is a **multi-tenant service** (accounts, storage, secrets, privacy,
  cost) and it inverts the model the product is built on — the user *has* a folder where their data
  lives, which the engine reads by configured path (§9, D14). **M5 is a consumption renderer, not a
  hosted onboarding** (§12 M5). **Reopening trigger, on the *first* of either:** the **first hosted
  use case** (a real user who cannot take on-ramp A, B or C), or **M5 + web consumption live** (the
  web renderer exists and generated profiles are consumed on the web). Reopening means scoping a
  **milestone of its own** — auth, storage, secrets, privacy, cost — not extending M5.
- No CV/PDF renderer (delegate to yamlresume/JSON Resume as a renderer if ever needed).
- No scrapers — we never read platforms **to source data**; we write (or paste). The single
  read-back is the opt-in live-drift check of the engine's **own** deployed artifact (§19.5,
  v1.10) — never a platform's account data, and never by defeating anti-bot defences.
- No auto-publishing to LinkedIn/Upwork (no API exists); GitHub/web are git/API-driven.

## 3. Success criteria (v1)

- `pasco build` renders all platforms from one YAML workspace; `pasco validate` rejects schema violations,
  warns on drift/geo (facts); `pasco check` runs skill-declared checks (char limits, live links, fact presence).
- `pasco refine <platform> [--lang] [--variants N]` produces N text variants, **agent-driven and
  model-agnostic** (the executing agent's model — AionUi, OpenHands, Claude Code, Cursor…). The chosen
  variant is committed and marked as active. Sah/hub may become the default path once it matures (D13).
- GitHub profile README + web are fully git/API-driven (dogfood: Christian's real profile).
- Every quantitative claim in every skill has a dated source (claims-evidence enforced).
- A fresh user can reach a validating workspace in under 10 minutes through **any** on-ramp:
  on-ramp A (template repo), on-ramp B (`pasco init`, seconds), or on-ramp C (their own
  storage) — see §9.2.

## 4. Architecture

```
        ┌──────────────────────────── REPO PUBLIC (product) ────────────────────────────┐
        │  schema/          packages/core       packages/renderers/<platform>           │
        │  (JSON Schema) →  validate ·          (adapters: github-readme, linkedin,     │
        │  the contract       normalize ·         upwork, x, researchgate, substack)    │
        │                     drift-check ·     packages/cli  (pasco)                   │
        │                     geo-check         skills/<platform>/  (SKILL.md, research,│
        │  CI: validate · tests · links · drift  playbook, checks.yaml)                 │
        └───────────────▲───────────────────────────────────────────┬──────────────────┘
                        │ data (per user)                           │ outputs ready
        ┌───────────────┴───────────────┐        ┌──────────────────┴─────────────────┐
        │  profile-data (private)    │        │  deploy: paste (LinkedIn, Upwork…)  │
        │  content/*.yaml · profiles/   │        │  deploy: git/API (GitHub, web)      │
        │  CHANGELOG.md · CHECKLIST.md  │        │  verify: skill checks + checklist   │
        └───────────────────────────────┘        └─────────────────────────────────────┘
```

- **Public repo** = product: schema, core, renderers, CLI, skills, templates, docs, examples (fictional person).
- **profile-data** = per-user private workspace (a folder; or local-only, no repo at all). Never
  in the public repo. Provided as a **GitHub template repo / forkable skeleton** (on-ramp A) and
  scaffoldable locally with `pasco init` (on-ramp B) — see §9.

## 5. Decisions (ADR-lite)

| # | Decision | Rationale |
|---|---|---|
| D1 | TypeScript only (no Rust in v1) | User decision; schema shared via JSON Schema, Zod generated. |
| D2 | Text-first YAML, not DB/Sheets | Diffable, contributable, $0 infra. UCVE's mistake was infra-first. |
| D3 | JSON Schema as the contract source (not Zod) | Language-agnostic; Zod generated from it. |
| D4 | Facts vs storytelling separated | Facts deterministic (schema+checks); texts are AI variants the user picks. |
| D5 | Renderer = deterministic code; Skill = living knowledge | Testable consistency + current judgment; both PR-contributable. |
| D6 | Skills are **per platform** (not per task) | Each platform has own rules/angles; differs from zhiweio (per-task). |
| D7 | GEO is a cross-cutting layer | LLMs read/cite profiles today; consistency IS citability. Enforced in core, skills, renderers. |
| D8 | Docs in EN, content multilingual (EN/ES/FR) | Open-source convention + international recruiters; user's native ES. |
| D9 | Deploy via checklist for no-API platforms; git/API for GitHub/web | Reality of platform APIs (verified in prior art). |
| D10 | `pasco refine` is **model-agnostic** (executing agent's model); sah/hub as future opt-in | User decision; revisit when sah matures. |
| D11 | Refinement is **agnostic agent-driven** (AionUi, OpenHands, Claude Code, Cursor…) | Skills drive, `pasco` executes; user picks variant. No closed CLI picker. |
| D12 | Drift-check: **warn on facts, fail on schema** | Users may have different intents per platform; integrity vs flexibility. |
| D13 | Model-agnostic default; sah as future default path | Revisit when sovereign hub matures (Q3→RESOLVED). |
| D14 | User data in a **separate workspace** `profile-data` (a folder; a repo is the recommended home, not a requirement — §9; wording amended by #200, originally "separate repo"), integrated by configured path, no symlink in normal flow | Symlink mount only as advanced CI option (Q4→RESOLVED). |
| D15 | **Brand flavor** (`flavor: brand`): the same engine models commercial/brand identities — org schema, `socialHandles` matrix, brand surfaces. Workspace flavor is a **contract field**, not a separate product | The Topia brand needs the same SSOT→validate→refine→check→deploy machinery; one engine, one schema, one CLI — flavor only changes which blocks/checks apply (Q8→RESOLVED). |
| D16 | **Platform set = Postiz parity + operator extras** (union, 49 — v1.9 adds `hotmart` (operator extra #15, issue #137 — storefront + memberships for the Spanish/Portuguese-speaking markets, EC payout `[?]` carried per the #133 precedent) to the `creator-monetization` family; v1.8 added `buymeacoffee`, `liberapay`, `gumroad`, `payhip` as operator extras #11–#14, issue #133; v1.7 added `kofi` as #10, issue #130; issue #138 declares the remaining families docs-first — `freelance` covers the pre-existing v1 `upwork`, `job-boards` stays backlog-only — no enum change): ONE shared enum for person + brand flavors; new slugs Postiz verbatim (`linkedin-page`, `instagram-standalone`, `devto`, `gmb`, `warpcast`, `moltbook`, `mewe`, `tumblr`); single-source discipline enforced by contract self-tests (schema-check asserts `check.platform == ['all', ...platform]`; vitest asserts core `PLATFORMS` == schema enum) | The operator's surfaces must cover every network a cross-posting tool can reach (Postiz's 34 — [OFICIAL] docs.postiz.com llms.txt, fetched 2026-09-02; the API intro page's own "32" header undercounts its tables); `ghost` is an operator extra Postiz lacks; the family completes the creator monetization platforms slice (canonical industry term — see the issue #133 naming note): memberships, tips, donations, storefronts; the v1.8 members and `hotmart` are paste platforms (D9) and the family is declared docs-first, not as a hard schema field; issue #138 adds the families `freelance` (covers the v1 `upwork`, retroactive) and backlog-only `job-boards` under the same docs-first discipline. Schema parity ≠ skill coverage — per-platform skills are separate follow-ups (issue #30). |
| D17 | **Evidence registry is pointer-first** (§18): two typed root blocks — `credentials[]` (third-party attestations) and `artifacts[]` (works/media) — with a **locator-capability matrix**; in-workspace `media/` reaches public surfaces only via renderer `assets/` output; external paths resolve via per-machine `PASCO_EVIDENCE_ROOT` (env/gitignored override, never committed); symlink/stow = documented power-user convenience only | A claim is not an artifact, and neither duplicates `publications[]`/`press[]` (naming discipline §9.1/§18.1); a private workspace is not a public media host (D14) — the capability matrix protects byte-stability (§15.1) and the URL SSOT (§15.4/§18.4). Direction ratified by the operator (issue #48) |
| D18 | **Per-entry deploy ledger as data** (schema-additive v1.3): `deployments` map (`content/deployments.yaml`) + optional stable entry `id`s + `origin: template` provenance flag + `pasco status`; deploy state is `pasco`-owned data and `CHECKLIST.md` becomes a generated view (issue #37, §19) | The per-entry question — *mine vs template? published where? in-sync or stale?* — is unanswerable from platform-granularity state (`active`, D11, answers *which variant is live* only); staleness = `contentHash` compare, exact and release-tag-independent (`pasco diff` stays the CHANGELOG hint); only `pasco` mutates the ledger — same write rule as `refine --choose` (D14). **v1.10 (issue #132) adds a second, orthogonal dimension — certification strength (`verified` \| `attested` \| `unverifiable`) over the live artifact, with `out-of-band-drift` as its negative outcome (§19.5); staleness and the `contentHash` basis are untouched** |
| D19 | **The deploy bundle is one `assets/` dir per platform output** (M8; Q9 resolved): `profiles/<platform>/assets/`, not a shared content-addressed store. `profiles/<platform>/variants/` is the exception — the chosen-variant INPUT (#238), preserved by build, never generated; targets are deploy-relative and human-reviewable (`assets/<id>/<basename>` — `artifactAssetTarget`, the single derivation); `assets/manifest.json` records the compile-time sha256 per asset | Deploy surfaces are separate repos (D9/D14), so a shared store has no home; each renderer output is self-contained — README + its assets travel and verify together; byte-parity (§15.1) is a function of deterministic per-output bundling, and the checksummed manifest is what makes a deployed asset verifiable (§18.3 verify column, §18.6). This row is the register entry of the Q9 answer (see the Q-answers section below), not a new decision |
| D20 | **`pasco serve` is a minimal reference adapter over `Core`** (§7), exposed as a **local HTTP contract**. It is minimal **by construction**: no access control, no multi-tenancy, no billing, no persistent storage, no hosting orchestration. Dependency rule: `server` depends on `core`, and only the CLI's `serve` subcommand depends on `server` | Keeps the published surface **small, auditable and dependency-light** — the engine's job is the contract, not the deployment. The **contract is the integration point**, so any consumer (a UI, an editor, a script, a service) may implement its own adapter against it instead of adopting ours. Alternatives: a **feature-rich bundled server** (rejected — bloats the published package and couples the engine to deployment concerns it does not own); **no server at all** (rejected — leaves the engine drivable only from the CLI, so every consumer re-invents the boundary, and there is no reference implementation to test the contract against) |
| D21 | **Contributions are accepted under the Developer's Certificate of Origin 1.1 — no CLA** (issue #95, 2026-10-03): every non-bot, non-merge commit in a PR must carry a `Signed-off-by:` trailer whose email matches the commit author; the canonical text is the root `DCO` file, and the gate is `scripts/dco-check/` (self-test first, `dep-gate` shape) wired as the `dco` workflow | The licence stays **MIT** (`packages/*/package.json`), and with a permissive licence there is nothing left to relicense — so a CLA's only real value (an express sublicense/relicensing grant) would buy permanent contributor friction, a third-party signature-collection app and a legal document to maintain, in exchange for optionality the project has decided not to exercise. The DCO certifies *provenance* of the contribution at zero infrastructure and zero data beyond the git trailer. Alternatives: **CLA** (rejected — friction and upkeep for optionality we don't want); **DCO + relicensing grant** (deferred — cheaper than a CLA and keeps the option open, but a sign-off is weaker evidence of assent than a signature; revisit only if the licence question reopens, and never retroactively for an already-published version). Bot authors are exempt by design: Dependabot cannot sign off, and blocking it would block every dependency PR |
| D22 | **Fact selection is a workspace policy, and it is subset-only** (issue #235, 2026-10-19): a named **view** selects which SSOT entries a rendered profile emits — `.pascorc` → `selection.views` (`mode: all\|tags`, `tags`, `excludeTags`, `excludeKeys`); **exclusion always wins**; **no policy ⇒ byte-identical output**. A view **removes entries and never edits one**, so the GEO invariant (Goal 2/3, §15.4) is untouched: it constrains what a fact *says* when it appears, not that it appear everywhere, and `geo.ts:21` already scores absence as neutral. **Every view that omits entries WARNS** (operator's G1 amendment, §21.4) and `pasco status --selection` names each omission and its reason | Selection is the one per-surface adaptation the engine was missing beside `lang` (text) and `refine` (storytelling); §18.9 had already *declared* tag selection with no implementation. One identity, several faces — without duplicating facts. Alternatives: **per-entry `platforms[]` in the SSOT** (rejected — couples the platform-agnostic data to the platform enum, turns it into an N×M matrix, and forces every new platform to edit every entry); **renderer-side filtering** (rejected — every adapter re-implements it, and `check`/`status` would see a different slice than `build`, against the `markdown`/`paste`/`artifact` one-home rule); **overlay files** (rejected — a second source of truth for the same fact, so drift becomes "which overlay won?"); **a workspace per audience** (correct for *separate identities* — §18.9/D15 keeps that — wrong for subsets of one identity, where it recreates cross-repo drift) |
| D23 | **The unit of first class is the presence surface, not the profile** (issue #262, 2026-10-23; restated 2026-10-28 as option B): `surface.kind: profile \| repo-meta \| distribution` is an **additive** dimension on `platforms/registry.yaml` (absent = `profile`; the 49-slug profile enum is untouched), and `releases[]` is the **event** — `{id, version, date, summary, changedUnits[], surfaces[]}` — whose fan-out **reuses** the §19 ledger vocabulary (`in-sync`/`stale`/`never`), derived at read time and stored nowhere. `pasco presence` is the daily board; `pasco release plan` is the launch view (`--json`), ordering surfaces `repo-meta → profile → distribution` and emitting a per-kind factual spine; the announcement copy per channel lives in `skills/` (rule 7 + D9) | A published artifact could appear on **none** of its own operator's surfaces with no representation: no event, no distribution surfaces, no way to ask "which surfaces still owe this publication?". Alternatives: **keep the profile as the unit** (rejected — that question stays unanswerable and every non-rendered surface is unmodeled); **a second state model for releases** (rejected — staleness is already exact and release-tag-independent in §19); **`release` as a top-level command** (rejected by the operator on 2026-10-28: `presence` is the daily board, the plan hangs off it as a view) |

> **Decision note — the release path (2026-10-24, issue #307).** The release path is the **tag
> run** (guard → build/tests → cohort + CLI over OIDC → GitHub Release → pages deploy);
> `workflow_dispatch` stays the documented override/retry (a `409` duplicate after a published
> tag). Ratified as **camino (c)** in
> [#307](https://github.com/ChristianLuciani/profile-as-code/issues/307#issuecomment-6386416707);
> option (b) — dropping `push: tags` — discarded. **The precondition landed on 2026-10-26:**
> `github-pages` carries `tag v*` beside `branch main`/`gh-pages` (measured), so the deploy leg is
> expected to work from the next tag; the exit criterion — a measured cycle that does not confirm
> it returns to option (b) — and that first measurement live in #327. No new `D` row; #262 owns
> the next.

### D20 — the `serve` scope rule (binding)

`serve` exists so the engine is **drivable from outside the CLI**. That is its whole job.
Anything a **deployment** needs — authentication, authorization, multi-tenancy, quotas,
persistence, billing, scheduling, orchestration — is **out of scope for this repository**
and belongs to whichever consumer or deployment needs it.

Enforcement lives in CI (`scripts/dep-gate/check.mjs`, issue #98), following the
existing **`D3` drift-check precedent** — assert a structural property of the
workspace and fail on drift. The gate runs on every CI invocation: it fails if
`packages/server` (once it exists) declares any runtime dependency other than
`core` — `dependencies`, `peerDependencies`, `optionalDependencies`,
`bundledDependencies` (dev dependencies are not runtime) — and it fails if
anything in `core`'s dependency graph, transitively across all dependency
classes, reaches `server`. Ranges are checked for masquerade (the name-keyed
rules cannot see through them): a dependency key naming a workspace package
must use the `workspace:` protocol, and a `file:`/`link:`/`portal:` range
resolving inside a workspace package's directory is refused. Until
`packages/server` exists, both checks are vacuous (the gate passes and says
so) and the rule rests on review; the checks arm themselves the moment the
package appears.

- `packages/server` may depend on `core` **only**; a new runtime dependency there is a
  reviewable decision, not a routine commit.
- Nothing in `core` may depend on `server` (the arrow is one-directional, which is also
  what keeps the adapter movable).
- The contract is versioned, and a shared conformance corpus **is owed** so that the
  reference adapter and any independent implementation are tested against the same
  cases. It does not exist yet: there are no golden files and no snapshots in this
  repository today, so this is a commitment, not a present property.

If a deployment needs a richer server, it ships **its own** — importing `core`, targeting
the same contract. This repository will not grow one.


## 6. Data model (schema v1)

The executable contract lives in **`schema/profile.schema.json`** (JSON Schema, draft 2020-12 — D3;
Zod generated from it in core, never hand-written). See `schema/README.md` for file mapping and
validation semantics. The sketch below is the illustrative overview:

All textual fields support `{ lang: value }` maps (EN required; ES, FR optional per field).
Facts (dates, DOIs, URLs) are language-independent — **the GEO anchor**.

**Brand flavor (D15, §17 — additive, v1.1):** `flavor: person | brand` at root; brand
workspaces add `socialHandles[]` (handle matrix, `status: claimed|pending`), `newsletter`,
`podcast`, `press[]`, `audiences`, and the org identity variant (`orgName`, `logo`,
`brandVoice`, `mission`, `tagline`, `established`). Person-only root blocks (`experience`,
`publications`) stay optional and keep their meaning (essays/issues for a brand).

**URL scheme boundary (issue #53):** every URL field validates `^https?://` at the single
source (`$defs/url`, additive constraint on top of `format: uri`) — `format: uri` alone
admits non-http schemes (`javascript:`, `data:`) that renderers would emit verbatim
(§15.4/§18.4). The SSOT validates the scheme; renderers need zero per-emit filtering.
Negative fixture in `scripts/schema-check/fixtures/` (invalid-bad-url-scheme).

**Contact email (issue #71 — additive, v1.5):** `identity.email` is the contact email as a
**fact** (like name/location), validated by pattern (`^[^@\s]+@[^@\s]+\.[^@\s]+$`), NOT a
link. v1.4's scheme boundary had no home for an email: workspaces modeled it as a
`mailto:` row in `identity.links[]`, which `^https?://` rejects — breaking
`profile-data-template` (every new workspace failed `pasco validate` on day one) and the
operator's workspace. Decision (blessed by the operator, 2026-09-14): a dedicated fact
field — `mailto:` stays rejected in `links[]` (the #53 boundary holds on every URL field),
renderers emit the email as a **mailto: href** in the Links section (output-only) and as
the schema.org `email` property on `Person`/`Organization` JSON-LD; `sameAs` stays
page-URLs-only (a `mailto:` URI is not a reference page).

**Answer-engine surface (issue #288 — additive, v1.10):** `identity.definition` and root
`faq[]` are the two things an answer engine can quote — the half the data model lacked.
`definition` is one sentence of the form "X is a …" per language (EN required), ≤ 160
chars per value and it must contain the entity name — the length cap is schema-enforced;
the name check is a `geoCheck` rule (geoCheck v2, #289). `faq[]` carries the questions
THIS entity answers, as **facts with langMaps, never invented copy** (same curation rule
as `bios[]`, D11/D14 — an answer `refine` invents is a claim with no source and gets
dropped by cite-aware systems, §8): `q` ≤ 90 chars per value and unique per workspace
(JSON Schema cannot express it — duplicates collapse into one answer surface), `a` ≤ 320
chars (beyond that it is prose, not an answer), optional `source` = the `$defs/url`
scheme boundary (an answer with no pointer is a claim), 3–20 entries (below 3 there is no
surface; above 20 it is a page, not a profile). Consumers: `structuredData()` exposes
`description` from `definition` on the Person branch (emitted **only** when declared,
never invented; EN fallback, §11) and as the canonical description on the brand branch,
where it **wins over `mission`** — a brand without a definition keeps the v1.9 mission
fallback byte-identical (same slot, same key order). The answer surface is a separate
`FAQPage` JSON-LD node (`StructuredDataReadiness.faqJsonLd`), emitted only when `faq[]`
exists — never an empty one; it is its own field, never folded into `jsonLd` (a different
schema.org `@type`), and it carries no `@id` (the engine never invents an anchor, §15.4).
`description` joins the Person `considered` list, whose denominator is now **fixed at 8**;
it counts as *populated* only when declared, so a person declaring the seven pre-v1.10
fields and no definition moves from 1.0 to 7/8 — the declared, honestly-accounted delta
(same class as the v1.6 entity-id move), not a shrink of what the workspace declares.
The node has **no consumer yet**: renderers embed `jsonLd` only and `pasco entity` projects
the entity node, so `faqJsonLd` is the readiness surface the M5 web renderer consumes; the
consumer follow-up is declared, not opened here (emitting an issue needs the operator's OK,
ADR-025).
The competitive split measured
2026-10-23 (`[WEB]`, #288 evidence: a GEO competitor ships 12 question-shaped H2s and
zero structured answers) is engine-ownable: the SSOT, not the renderers, is the surface.

**Nationality (issue #334 — additive, v1.13):** `identity.nationality` is the ISO 3166-1
alpha-2 **code** (uppercase, e.g. `VE`) — a citable fact distinct from `identity.location`
(residence). The JSON Schema pattern `^[A-Z]{2}$` asserts the code's FORM, so `ve`,
`Venezuela` and `VEN` fail at the boundary (D12 fail class); membership in the published
code list is not enforced — an `enum` would go stale and reject valid or newly assigned
codes. Consumers: `structuredData()` emits the schema.org `nationality` property as
`{ "@type": "Country", identifier: "<code>" }` on the **Person** entity JSON-LD — a Person
property; the Organization (brand) branch never emits it (a brand has no nationality; its
origin fact is `established`, and an origin location would be `foundingLocation`, not
modeled). Optional and outside the `ready` gate **and the completeness ratio**: a workspace
that omits it validates, emits, and scores exactly as before (no behavior change, §15.4).
**Decision (operator, 2026-10-26):** Person-only is the contract — a `flavor: brand`
workspace may declare `nationality` (identity is shared and JSON Schema has no
flavor-conditional), the value validates, and the Organization branch emits no node.
Surfacing that drop as a runtime finding is **not** part of v1.13; it would be new
drift/geoCheck behavior, reopened only with a concrete consumer.

**Publication classification (issue #349 — additive, v1.14):** `publications[].kind` is
the **structured** answer to *what kind of output is this* — a closed enum
`journal-article` | `preprint` | `conference-abstract` (the minimum set that covers the
real workspace; extensible in a future minor). It exists because classification was
living outside the contract as per-consumer `venue`-string heuristics ("Carbon Trends" →
peer-reviewed, "SSRN Electronic Journal" → preprint, "… (abstract)" → abstract), the
exact drift the engine exists to prevent: a new venue must never fail a consumer's check
nor be classified by prose. **`peerReviewed` is derived, never stored:** it is exactly
`kind == journal-article`, the same derive-never-store discipline as
published-vs-in-development (§15.3/§20.1); a real exception is documented here *before*
a boolean is added. **Additive:** `kind` is optional — a row without it validates and
renders byte-identically to a pre-v1.14 workspace, and the existing row fields keep
their meaning. Consumers that need counts (arbitrated / preprints / abstracts, a year
window, co-authorship) MUST require the field explicitly instead of inferring it; the
engine does not guess. `publications.counts` on the compiled profile is deliberately
**not** part of this minor — it is #348's follow-up.

**Platform set (D16 — additive, v1.2):** ONE shared enum for both flavors — the union of
Postiz's 34 supported networks ([OFICIAL] docs.postiz.com llms.txt, fetched 2026-09-02) plus
**15 operator extras**: the six v1 non-Postiz surfaces (`github-readme`, `upwork`,
`researchgate`, `substack`, `patreon`, `github-org`) + `ghost`, `spotify`, `soundcloud`
(v1.1, brand §17) + `kofi` (v1.7, issue #130) + — v1.8 (issue #133) — the creator
monetization platforms' new members `buymeacoffee`, `liberapay`, `gumroad`, `payhip` +
`hotmart` (v1.9, issue #137 — storefront + memberships for the Spanish/Portuguese-speaking
markets, EC payout carried `[?]` per the #133 precedent).
The count arithmetic is generated from `platforms/registry.yaml` below.
New slugs are Postiz verbatim (`linkedin-page`, `instagram-standalone`, `devto`, `gmb`,
`warpcast`, `moltbook`, `mewe`, `tumblr`); v1 person surfaces keep their names. The enum is
also the `socialHandles` key space.

**Family declaration — `creator-monetization` (v1.8, issue #133, docs-first):** the repo-internal
family label for the **creator monetization platforms** (the canonical industry term; renamed
from the provisional `creator-support` wording of #130/#133 — the rename is recorded in the
CHANGELOG). Its slices: **membership/subscription** — `patreon`, `substack`; **tip jar /
one-off support** — `kofi`, `buymeacoffee`; **recurrent donations** — `liberapay`; **creator
storefronts** — `whop` (Postiz parity, v1.2), `gumroad`, `payhip`, `hotmart` (v1.9,
issue #137). `twitch`/`youtube` keep
their native monetization programs inside their own slugs — no new entries. The family is
declared in this paragraph and in each platform's schema description line only — never as a
hard schema `family` field (zero consumer breakage; a hard field would be a separate SPEC
proposal). Paste deploy per D9 for the v1.8 members and `hotmart` (no management API for
the profile body — developers.hotmart.com covers sales/products [?], issue #137).

**Platform families (post-v1.8, issue #138, docs-first):** the D16 platform set is grouped
into declared families — prose labels + purpose + members + backlog only, never a hard
schema `family` field (same reserve clause as `creator-monetization` above). Backlog
members are NOT enum entries: each lands through the #133 member chain per slug
(schema → core → CLI → renderer → SPEC slice → skill with its own sourced research) only
on real operator demand, and every backlog surface must verify its **official eligibility
page before any claim** is made about it (evidence rule). Descriptors below are operator
research notes ([MI] issue #138, 2026-10-05).

<!-- gen:platform-families -->
<!-- GENERATED by scripts/gen-platforms/gen.mjs from platforms/registry.yaml — do not edit by hand. -->
6 + 3 + 1 + 4 + 1 = 15 extras; 34 + 15 = **49**.

| Family (label) | Display | Purpose | Members (enum) | Backlog (not enum — eligibility page before any claim) |
|---|---|---|---|---|
| `creator-monetization` | Creator monetization platforms | audience pays for content, memberships or works (declared v1.8, #133) | `patreon`, `kofi`, `buymeacoffee`, `liberapay`, `gumroad`, `payhip`, `hotmart` (v1.9, #137 — EC payout `[?]` carried per the #133 precedent), `substack`, `whop` (Postiz parity) | `gofundme` (deferred — no EC organizer payout, #133) |
| `freelance` | Freelance marketplaces | client-facing surfaces — the product is the operator's professional time | `upwork` (v1, retroactive) | `freelancer` (freelancer.com, global), `workana` (Brazil-founded, LatAm-wide ES/PT — EC-priority candidate), `fiverr` (boundary: gig **storefronts** of services — filed here with that note) |
| `presence-repo` | Repository presence surfaces | the metadata of the code artifact itself — repo description/topics/social preview, release notes, the npm package page and the project site (D23) | — (no enum entries) | `github-repo-meta` (repo description, topics and social preview — the GitHub artifact's own metadata), `release-notes` (the GitHub Release body for a tag — the canonical record of what shipped), `npm` (the published package page (README + package.json derived) — not a profile body), `site` (the project page under site/ (generated at deploy, #277) — HTML, never an enum slug) |
| `presence-distribution` | Presence distribution channels | where a release is announced, not where an identity body lives (D23) — the copy per channel lives in skills/, never in the engine | — (no enum entries) | `hacker-news` (Show HN / launch thread — one announcement per release, judged by the community), `reddit-post` (subreddit post (r/opensource, niche subs) — distinct from the reddit PROFILE slug), `x-post` (launch thread/post — distinct from the x PROFILE slug), `linkedin-post` (feed post — distinct from the linkedin PROFILE slug), `devto-post` (cross-posted article — distinct from the devto PROFILE slug), `awesome-lists` (curated-list inclusion (awesome-*) — a distribution surface with its own contribution rules) |
| `job-boards` | Recruiting surfaces | recruiter-facing CV surfaces — the buyer is a recruiter and the native content is the structured CV the SSOT already models (`experience[]` / `education[]` / `skills[]`); GEO hook = name-reputation in search results only | — (no enum entries) | `infojobs` (Spain + LatAm), `computrabajo` (Ecuador-founded + LatAm-wide — `[MI] — verify` the whole descriptor; in-session corroboration inconclusive, PR #140 review F1), `indeed` (aggregator) |
<!-- /gen -->

Boundary notes (issue #138):

- `linkedin` stays **un-bucketed** — hybrid social + recruiting network and a v1 enum
  member; noted here as hybrid for clarity, a member of neither family.
- The `fiverr` boundary (gig storefronts of services) is a docs note, not a family of its
  own.
- Explicit reject candidate: `toptal` — invite-only talent network, not a self-serve
  surface for a one-person brand (`[MI]`; verify at any future consideration).
- Un-declared stays un-declared (YAGNI — a concrete consumer first): `github-readme` /
  `github-org` (portfolio/README surfaces) and `researchgate` (partially academic /
  publishing) belong to no family; `substack` keeps its v1.8 `creator-monetization`
  membership while its publishing aspect remains un-declared.

Single-source discipline is enforced, not trusted:
`check.platform` MUST equal `["all", ...platform]` (schema-check self-test) and core
`PLATFORMS` MUST mirror the schema enum (vitest contract test). Schema parity ≠ skill
coverage — per-platform skills are separate follow-ups.

```yaml
identity:      { name, email?, definition?, nationality?, location, photo, links[] }   # definition = the canonical "X is a …" sentence (v1.10, #288); nationality = ISO 3166-1 alpha-2 code (v1.13, #334)
positioning:   { statement: {lang}, audiences: {lang: angle}, geo: { semanticAssociations[], citationsGoal } }
bios:          [ { platform, lang, length: short|medium|long, text } ]   # generated + curated
headlines:     [ { platform, lang, text } ]                   # per-platform, per-lang
skills:        [ { name, level, keywords[], geoKeywords[], platformWeights{} } ]
experience:    [ { id?, origin?, role, org, start, end, highlights{lang} } ]   # id/origin — D18 §19
projects:      [ { id?, origin?, name, status, description{lang}, links, keywords{}, evidence[], artifactRefs[]? } ]   # artifactRefs — v1.12, #333
publications:  [ { id?, origin?, title, venue, year, kind?, doi, orcidId, artifactRefs[]? } ]   # kind — v1.14, #349
credentials:   [ { id, kind, title, issuer, credentialId?, verifyUrl, issued, expires?, visibility } ]
artifacts:     [ { id, kind, title, description{lang}?, locator, checksum?, license?, tags[], visibility } ]
keywords:      { seo: { platform: [] }, geo: { associations: [], claims: [] } }
checks:        [ { platform, rule, value, surface? } ]         # declarative; surface = headline|bio|both (#240)
active:        { platform: { lang, variantId, chosenAt } }    # which variant is live
deployments:   { <ledgerKey>: { <surface>: { deployedAt, contentHash, source } } }   # per-entry deploy ledger (D18, §19)
faq:           [ { id, q{lang ≤90, unique}, a{lang ≤320}, source? } ]   # the citable answer surface, 3–20 entries (v1.10, #288)
releases:      [ { id, version, date, summary{lang}?, changedUnits[], surfaces[] } ]   # the release event and its fan-out (v1.15, D23 §22)
```

**Evidence registry (D17, §18 — additive, v1.4):** `credentials[]` and `artifacts[]` are
the proof layer — pointer-first, visibility-scoped. `projects[].evidence[]` keeps its
claim semantics and may reference registry ids (`credentialId`/`artifactId`); canonical
blocks (`publications[]`, `press[]`, and `projects[]` since v1.12/#333) keep their domains and
gain `artifactRefs` instead of becoming registry kinds. Naming discipline: the word
"evidence" stays claims-only (§18.1).

**Deploy ledger (D18 — additive, v1.3):** `deployments` records, per *trackable unit*
(row entries with a stable `id`, composite `bios`/`headlines` keys, root fact blocks),
which **surface** the unit was confirmed deployed to, when (`deployedAt`), and its
`contentHash` at deploy time. `pasco status` derives the sync state (`in-sync` / `stale` /
`never`) from that hash, and `origin: template` (shipped by the template's fictional
examples) marks template-provenance entries — absent means user-authored. Detail: §19.

## 7. Core interfaces (deep module)

```ts
interface Profile { /* normalized model compiled from content/*.yaml */ }

interface Core {
  load(workspace): Profile          // parse + validate (Zod from schema) + normalize
  driftCheck(profile): Issue[]      // fact contradictions across platforms (also GEO blocklist)
  geoCheck(profile, lang?): GeoReport // consistency score, structured-data readiness, semantic anchors
                                    // lang (default 'en') is the language the assembler reads;
                                    // `pasco entity` passes its resolved --lang so gaps and JSON-LD agree
  completeness(profile, policy?): CompletenessReport   // weighted checklist + % (§20, issue #102)
  compile(profile, platform): PlatformProfile   // language-aware slice for a renderer
}

interface Renderer {
  id: 'github-readme' | 'linkedin' | 'upwork' | 'x' | 'researchgate' | 'substack';
  render(p: PlatformProfile, opts): { text: string; assets?: string[] };
  deploySpec: 'git' | 'api' | 'manual';   // manual → playbook + checks
                                          // must equal pasco.deploySpec (CI-asserted, #165)
}

interface SkillChecks {  // from skills/<platform>/checks.yaml
  run(p: PlatformProfile): CheckResult[]; // limits, links, fact-presence, GEO consistency
}
```

**One declared home for `id` + `deploySpec` + asset consumption (issue #165).** The
manifest is the source: `"pasco": { "platform": "<id>", "deploySpec": "<spec>" }`, plus
`"assets": true` on the renderer that consumes the media bundle (§18.6). The module keeps a
typed copy of the two capabilities (`export const deploySpec`, `export const consumesAssets`)
because the render seam is code, not data — so the pair has one *declared* home and one
*gate-checked* projection, not two hand-kept lists: `renderer-map.test.ts` asserts each module
copy agrees with the manifest. `pnpm gen:renderers` projects the manifest into the CLI's
`RENDERERS` map (`packages/cli/src/generated/renderers.gen.ts`, committed, never hand-edited);
CI asserts the projection is fresh, that every declared platform is in `$defs.platform.enum`
(the contract), that the association is one-to-one, and that the module copies agree — a
renderer without a resolvable platform fails the gate loudly, it is never skipped. The
machine-readable registry (#154) adds the reverse assertion (every platform in the enum has a
declared renderer or an explicit "not implemented yet").

`pasco` (CLI) commands — v1:

| Command | Purpose |
|---|---|
| `pasco init` | scaffold a profile-data workspace from the template |
| `pasco validate` | schema (fail) + drift/geo checks (facts warn). Text mode renders one line per GEO code that scored 0, prefixed by its severity tier — `warn: [code] …` is a warning, `info: [geo/freshness]`-style lines are NOTES, never warnings (v1.10 tiers, #322); a code that scored above 0 renders no finding line, and `absent` tier = `warn`. `--json` carries every check (with its `severity` and `detail`) — a check whose detail holds an anomaly note (future-dated freshness) is always fully visible there |
| `pasco doctor [--json]` | the **engine · schema · workspace** reading on ONE line (issue #348): the installed CLI version, the profile-contract version this build validates (derived from the schema `$id` by `pnpm gen:zod`, never a literal), the resolved workspace path and whether it loads, plus the `.pascorc` engine requirement (`no engine requirement` · `met` · `NOT MET` with the upgrade command · `INVALID` with the syntax problem). Chosen over overloading `--version` because `--version` describes the binary and must work with no workspace, while `doctor` describes the pair. `--json` emits `{ engine: { name, version }, schema: { version }, workspace: { path, valid, error? }, requirement: { declared, met, problem?, source? } }` in the standard envelope. Exit `0` healthy · `1` unhealthy (workspace fails to load, requirement unmet or malformed) · `2` usage. Offline, no clock, no writes. Contract: §7.6 |
| `pasco build [platform] [--view <name>] [--lang]` | render deterministic base texts; `--view` resolves a declared view's platform/lang + fact selection (D22, §21); a manual-paste surface without a renderer writes `profiles/<platform>.md` via the shared paste core (#239); an active variant body is written verbatim as the platform artifact (#238) |
| `pasco preview [--out <dir>] [--no-open] [--lang <l>] [--now <iso8601>] [--json]` | the **local view** of the data without publishing it (issue #282): **one** self-contained HTML file — inline CSS, no `<script>`, no external asset, no HTTP server — whose sections are the surfaces `pasco build` would write (`#github-readme`, `#linkedin`, …), each with the check state, plus every surface this language does **not** publish (named with its reason, never dropped). Default `<workspace>/.pasco/preview/index.html`, then opened in the browser; `--out <dir>` writes `<dir>/index.html` and opens **nothing** (the CI-artifact transport, uploaded by the workspace template's opt-in workflow). The text is `renderArtifact`'s — the same active-variant → renderer → paste-source tree `build` writes, selection gate included — and the check state is the same report `pasco check` prints: no second renderer, no second rule engine. A **privacy gate** refuses the write (exit 1) on an absolute machine path, a credential shape, an external asset, active content, or a source outside the workspace (evidence-root media is never inlined; a remote image becomes a note, not a fetch). `--now` pins the freshness stamp — the document is the one declared clock read, and pinning it makes two runs byte-identical. Contract: §7.9 |
| `pasco refine [platform] [--lang] [--variants N]` | AI variants — **agent-driven, model-agnostic**; user picks; commit active |
| `pasco edit <contract-path> [--set <text> [--check]]` | read **or write** **one contract field** by contract path — `positioning.statement.<lang>`, `headlines[platform=<p>,lang=<l>].text`, `bios[platform=<p>,lang=<l>,length=<len>].text`, `identity.links[platform=<p>,label=<l>].url` (read-only, `label` optional). `--set` writes it: **byte-range splice over the original text** (the CST locates; it never re-serializes, so comments/layout survive and the diff is one line), block, multi-line and anchored/aliased scalars **refused** in v1, the file's node must still match the resolved value (staleness → exit 1, never a silent wrong-row write), no-op = 0 + `noop`, temp file + `load()`/schema over a temp copy + **atomic rename** (an invalid edit never reaches disk), concurrent writers serialized by an advisory `content/.pasco-edit.lock` plus a re-read immediately before the rename (an external editor is the residual window). `--set --check` previews instead: it renders the surface the way `pasco build` does (active variant → renderer → shared paste source, current vs proposed) and prints **the published lines the edit changes**, reporting an edit that does not reach the artifact with its reason instead of asserting it. It also reports the edited unit's **surface impact** from the §19 ledger — every recorded surface prints `stale` after an edit that changes the unit hash (or `in-sync` when the record still matches), and a unit with no record rolls up to `never` — derived on every run and stored nowhere (§20). A headline/bio value is pre-flighted against the catalog's own `max-chars` cap — the workspace's `content/checks.yaml` when it declares checks, else the caps shipped with pasco (#240) with its cited source and tier — over-cap is a WARN, never a block (D12), and a platform with no sourced cap reads `cap: unknown`; `--json` carries `{ address, current, proposed, rendered, ok, noop, written, warnings, stale, state, drift, limit, over, variant, reason }` inside the standard envelope (a D22/§21 selection error the write proceeds through is a warning, not a block: the SSOT write is valid even when `build` refuses); a read-only target or a file that changes under the command is exit 1 (`refused` / `stale`, nothing written); its machine contract is frozen for agents (S5, #252): the `--json` field set and the 0/1/2 exit matrix are documented in the CLI README, one test per exit row; `edit` never chooses the live variant (#238 non-goal); epic #247, S1–S5 |
| `pasco check [platform]` | run skill-declared checks before deploy; char limits accept an optional `surface` (`headline`/`bio`/`both`) so a title cap does not flag the bio (#240). **`fact-present`** is executed here (issue #283), **for the surfaces whose catalog declares the premise** (the workspace's `content/checks.yaml` ∪ the shipped `skills/<platform>/checks.yaml`; `link-in-identity` stays a separate premise): the artifact `pasco build` last wrote is compared **symmetrically** against the SSOT render — a URL the surface adds (dangling pointer) or omits (`contradiction`), a date or number either side carries and the other does not (`contradiction`), and a text difference no fact token explains (`contradiction`) are all findings. All are WARN (D12: facts warn), and a targeted surface with no artifact on disk reports the rule as **not run**, never as OK |
| `pasco audit [--json]` | the **offline diagnostic projection** over the identity: findings only — no score, no prioritisation, no branding (issue #283). `--json` emits `{ schemaVersion: "1", scope: { declared, checked, notRun }, findings: [{ class, severity, path, detail }] }` — `scope` makes "measured nothing" distinguishable from "clean" — with three fixed classes (`dangling-ref` FAIL · `contradiction` FAIL · `unsourced-claim` WARN); exit 1 iff any FAIL. Composes `load` (schema), `reconciledDrift` (drift + the #238 variant reconciliation), `geoCheck` (its `faq-coverage` premise gates the claim rows), the completeness `evidence` premise, and `fact-present`; it is **deliberately stricter** than `validate`/`check` on the FAIL classes (declared in §7.1) |
| `pasco discover <url>... [--json] [--allow-host <hosts>]` | the **provisional Profile** from public surfaces, for a prospect who has no workspace yet (issue #329, §7.10): reads only what a surface itself declares (schema.org JSON-LD + its links), attaches per-fact provenance (`surface` · `url` · `retrieved` · `attested: false`) and lists the fields it did not find as `absent` (never defaulted); runs `driftCheck` over the result plus the two classes discovery owns (`dangling-ref` on a same-host link the pass could not resolve, `unsourced-claim` on surface text). Closed host allowlist checked **before** any request; sequential, no retries, no credentials, redirects refused. Writes NOTHING — no `content/`, no ledger — and the provisional shape is not the persisted contract |
| `pasco entity [--json \| --jsonld [--out <file> [--force]] [--bare]] [--lang <l>]` | the **entity projection** for surfaces this engine does not render (issue #287): the schema.org entity assembled by `structuredData()` — `@id`, `sameAs`, type and fields — plus the readiness `gaps` (geoCheck codes, verbatim). `--json` emits `{ schemaVersion: "1", entity: { id, type, name, sameAs, email }, gaps: [{ code, detail }], jsonld: null }`; `--jsonld` emits the **same assembler output** the renderers embed, as a paste-ready `<script type="application/ld+json">` block (`--bare` = the bare object, `--out <file>` writes it atomically and refuses an existing file without `--force`). **Both modes resolve one `lang`** (`--lang`, else `.pascorc defaults.lang`) so a gap and the emitted field cannot disagree. **One assembler, no CLI-local builder**: the projection never invents `@id` and never re-derives the entity (§15.4). Exit `1` when `@id` is absent (the entity has no declared home) or the `--out` write fails; `0` otherwise; `2` is usage. Offline and deterministic (D19). Contract: §7.2 |
| `pasco export ai-policy [--out <dir> \| --check] [--json] [--lang <l>]` | the §12 M9 stance as an artifact (issue #290): `--out` writes `robots.txt` (**two named groups, no wildcard** — the listed `ai-retrieval` crawlers allowed, the listed `ai-training` crawlers disallowed; the file declares that an unlisted crawler is not restricted, each UA commented with its registry entry/operator/source/date), `llms.txt` (the workspace index, with a coverage assertion over every document it claims) and `AI-POLICY.md` (allowed · blocked · the explicit-list limit · who can change it · the date, quoting the M9 floor verbatim); `--check` exits `1` on an incomplete or unsourced entry, a duplicate token, an `as_of` that is malformed/future/older than 180 days, or a `policy.as_of` that is stale or predates its rows; `--out` refuses to write one. The crawler list is projected from `platforms/registry.yaml` (`ai:`) by `pnpm gen:platforms` — never a hardcoded UA list in the CLI. Offline; `--check` is the declared clock-reading path. Contract: §7.3 |
| `pasco cite-check [<answers.ndjson>] [--json]` | the **citation matcher** over saved answers (issue #291): reads the runner's NDJSON (stdin when no path), matches the workspace's declared entity against each answer and emits, per answer and **never aggregated**, `{ cited, confidence, spans, reasons }`. Fixed ladder — `citation-url` (a citation on the entity's own page or its `sameAs`/claimed-handle set — host, and the declared path or a descendant) and `exact-name` (word-bounded, case- and accent-normalized) are **high**; `alias` (`identity.orgName`) and `handle` (a declared handle) are **medium**; `partial` (any contiguous multi-token prefix of the name, ≥ 2 tokens) is **low**, and `low` is never a citation downstream. The matcher **refuses to guess**: a one-word name hit whose sentence carries no declared disambiguator is ambiguous (`cited: false`, with the longer capitalised reading quoted as `competing:<phrase>`), a mention inside a contrast clause is not a citation, and a declared qualifier or an adjacent capital never disqualifies a hit by itself. Offline, no model, no clock (D19). Exit `0` on a successful read (a non-citation is data, not a failure) · `1` the workspace cannot load, or the input path cannot be read · `2` usage or **malformed NDJSON** (never a silent skip). Contract: §7.4 |
| `pasco export profile [--json] [--now <iso8601>]` | the **normalized profile** for programmatic consumers (issue #348): `{ schemaVersion, engine, source: { commit, generatedAt }, profile }`, where `profile` is exactly what `core.load()` returns — **every root the workspace declares, plus every *list* root defaulted to `[]`; an optional *object* root (`newsletter`, `podcast`, `audiences`, `active`) appears only when declared** (no valid empty value exists — §7.5). `artifactRefs` stay ids a consumer joins to `profile.artifacts[]` (`load()` already refuses a dangling ref), `publications[].url` as declared, `deployments` included — never a CLI-local rebuild and never `compile(profile, platform)`'s platform slice (§15.4). `schemaVersion` (`"1"`) is the frozen payload version a consumer refuses if it does not know (§7.5); `source.commit` is the workspace git `HEAD` (`null` outside a git repository); **no clock is read** — `generatedAt` is `null` unless `--now` pins it verbatim after a real-calendar check, so two runs over one workspace are byte-identical. Exit `1` on a load/schema failure (D12) or a malformed `--now` · `2` usage. Contract: §7.5 |
| `pasco diff` | what changed since last release (→ CHANGELOG hint) |
| `pasco status [platform] [--mark <ledgerKey> <surface>] [--verify] [--write-checklist] [--completeness] [--selection]` | per-entry deploy report — origin · published surfaces · in-sync/stale/never (D18, §19); `--mark` confirms a manual paste and records the artifact anchor; `--verify` runs the opt-in C1 live check (§19.5, v1.10 — the only network-touching path, and `pasco`'s second ledger write trigger); `--completeness` reports the profile-completeness checklist + `%` (§20, issue #102); `--write-checklist` folds both dimensions into the generated `CHECKLIST.md`; `--selection` (boolean; name it with `--view`) prints the resolved view — every entry emitted, every omission with its reason (§21, D22). **The read report also ends with the derived publication truth per surface (§20.1, #242): ledger · artifact-vs-SSOT · declared cap — computed on every read, stored nowhere** |
| `pasco skills:export <dir> [--force] [--list]` | copy the skill channels **this package ships** into a directory the user names; `--force` overlays an existing non-empty directory (nothing is deleted), `--list` shows the channels. No per-agent destination is invented. Skill lookup reads only the package's own `skills/`, an explicit `PASCO_SKILLS_DIR`, or the marked workspace checkout (developers) — #253/#254 |
| `pasco serve` | run the **minimal reference adapter** (D20) — exposes `Core` over a **local HTTP contract** so any consumer (UI, editor, script, service) drives the engine without re-implementing it. Minimal **by construction**; a deployment that needs more ships its own server against the same contract |

### 7.1 `pasco audit` — the fixed diagnostic contract (issue #283)

`audit` is an **offline JSON projection over existing checks**, not a new analysis
engine and not a service endpoint (the ledger's `PROP-017 §Scope` P1 asks for the
engine-side contract; scoring, prioritisation and branding belong to the consuming
layer). It is a *per-identity aggregate*; `check` stays per-document and exits on
content validity — different unit of work, different exit semantics, so folding one
into the other was rejected.

**Output (v1, frozen).** `pasco audit --json` emits the usual CLI envelope whose
`data` is `{ "schemaVersion": "1", "scope": { "catalog": "shipped" | "not-shipped",
"declared": [...], "checked": [...], "notRun": [...] }, "findings": [...] }` —
findings only, plus the scope they were measured over. The
string `"1"` is the contract version: a consumer refuses a version it does not know
rather than guessing.

`scope` is the artifact side (the SSOT-side rules always run): `catalog` carries the
package-level state — `not-shipped` means this install has no skills tree, so the
catalog CANNOT declare the premise (a broken bundle, distinct from "declares
nothing"); `declared` are the
targeted surfaces whose catalog declares the `fact-present` premise, `checked` the
declared surfaces whose built artifact was compared, `notRun` the declared ones with
no artifact on disk or no renderer for the flavor. `declared: []` means the premise
is not declared anywhere (nothing to measure by contract); `checked: []` means a
declared premise measured nothing. Either way **nothing was measured** — it is the
field that makes an empty audit distinguishable from a clean one, and the human
output says so (`an empty scope is not a clean audit`).
Each finding is `{ class, severity, path, detail }`:

| Class | Fires when | Severity |
|---|---|---|
| `dangling-ref` | a pointer does not resolve in the current view | **FAIL** |
| `contradiction` | two surfaces assert incompatible values for one datum | **FAIL** |
| `unsourced-claim` | a quantitative claim carries no evidence | **WARN** |

Exit `1` if any `FAIL` finding exists, `0` otherwise (WARN-only included); `2` is a
usage error and a schema/load failure is the standard error envelope at exit `1`.
No score, no percentage, no ordering-by-importance is emitted: an `[INF]` score in
the engine would breach the module boundary.

**Stricter than `validate`/`check` on these classes — by contract, not by accident.**
D12 governs *validity*: drift facts warn, so a workspace may legitimately carry two
intents on two platforms and `validate` exits `0`. The audit's unit is
*publishability*, and the issue freezes the class severities (`dangling-ref` and
`contradiction` FAIL). A drift fact that falls in a FAIL class therefore exits `1`
here and `0` there. The difference is pinned by a test so it cannot drift into an
accident of composition, and `--help` states it. It applies to the codes that have a
class; the rules the next block excludes never reach it.

**Declared no-class rules (not forced into a class they do not fit).** Two inputs are
deliberately NOT audit findings:

- **`drift/url-not-in-identity`** — the URL *resolves*; the rule asks that a
  platform-host link be mirrored in `identity.links`, a canonicalization rule that
  `validate` warns about (D12). It is not "a pointer that does not resolve", so it
  has no class here and the audit does not report it. (This is the same reasoning
  that keeps `geoCheck`'s coverage codes out of the classes.)
- **`geoCheck`** — its codes are citability coverage signals; only its
  `faq-coverage` premise gates the claim rows (see the table).

**`path` grammar.** Findings address facts with the `factRef` grammar declared in
the ledger (`PROP-017 §Scope`: `identity.links[n].url`, `projects[id].…`,
`experience[id].…`, `publications[id].doi|title|year`,
`credentials[id].verifyUrl|expires`, `artifacts[id].locator.url`) — block index
becomes the row `id` when the row declares one. The grammar is **cited, never
re-invented**: a block outside it (`socialHandles`, `active`) keeps its own address,
and a finding about a *surface* artifact addresses the artifact path
(`profiles/<surface>/README.md`), because a fact the SSOT does not carry has no
`factRef` by definition.

**What it composes** (one home each; `audit` re-implements none):

| Source | Class mapping |
|---|---|
| `load()` / schema | a workspace that fails the schema is the error envelope at exit 1 — never a fabricated finding |
| `reconciledDrift` (one home, `drift-reconcile.ts`) | `driftCheck` **plus the #238 variant-store reconciliation `validate` applies** — an `active-variant-missing` already backed by a chosen body is not a finding. Pointer codes (`handle-claimed-not-linked`, `active-platform-unknown`, `active-variant-missing`) → `dangling-ref`; **`url-not-in-identity` gets NO class and is not reported** (declared above); the contradiction/duplicate families (`publication-conflict`, `orcid-conflict`, `date-range-inverted`, `duplicate-*`, `skill-conflict`, `handle-host-mismatch`) → `contradiction` |
| `geoCheck` | **no class of its own; one premise gate.** Its codes are citability coverage signals (a missing/short `definition` is not a pointer; a claimed handle outside `sameAs` is the legitimate `@id` exclusion). The one class-mappable premise is the answer surface: `geo/faq-coverage` (score 0) owns the ≥3-row / duplicate-`q` / unsourced-row rules, and the audit reports only the deficient ROWS that assert a number with no `source` (`unsourced-claim`). No threshold is re-derived |
| completeness `evidence` premise | a project whose claim-bearing text is quantitative and has no evidence row with a `source` → `unsourced-claim` (the item's weight `0` in the workspace policy opts the rule out) |
| `fact-present` (§7 `check`) | runs only for the surfaces whose catalog declares the premise (workspace `content/checks.yaml` ∪ the shipped `skills/<platform>/checks.yaml` — the catalog note and the code say the same thing, #283/F6). **Symmetric**: a URL the surface adds → `dangling-ref`; a URL it omits, a date or number either side carries and the other does not, or a projected text difference with no token to attribute → `contradiction`. `unsourced-claim` is never emitted here — a number is a fact, and "no evidence" is a question about `evidence[]`/`source` |

**Declared v1 limits.** Artifacts are read from disk (what `pasco build` last wrote);
no network is touched (D19), so a live page that differs is §19.5's
`out-of-band-drift`, not an audit finding. The audit is **view-blind**: it judges the
implicit per-platform view, so an artifact written by `pasco build --view <name>` is
compared against that implicit view and reads as a contradiction — the same declared
consequence §20.1's artifact axis carries, because neither command may guess which
view produced the bytes. A workspace with no `content/deployments.yaml` and no
`profiles/` still audits: the SSOT-internal classes run and `fact-present` reports
the declared surfaces in `scope.notRun` (never silently green); a workspace whose
catalog declares no `fact-present` premise at all carries `scope.declared: []`, which
the contract reads as "nothing measured", not as clean — and a package that ships no
skills tree says so (`scope.catalog: "not-shipped"`), never "nothing declared".
`faq` is outside the `factRef` grammar, so a claim finding addresses the row and the
FIELD that carries the claim with the index (`faq[1].a`), never a row id.

**D23 is ratified and normative (§5, §22).** `surface.kind`, `releases[]`,
`pasco presence` and `pasco release plan` ship against it (issue #262). `audit`
stays the workspace-identity diagnostic: the presence layer does not add audit
classes, it composes the same §19 state and prints a plan.

### 7.2 `pasco entity` — the entity projection (issue #287)

`audit` is the diagnostic surface and `entity` is the fix surface: the same
schema.org entity the renderers embed, exposed as an artifact for a surface this
engine does not render (WordPress, Webflow, a landing page). The projection is a
**view** (D22), never a stored artifact, and it has exactly **one assembler** —
`core/src/structured-data.ts` (§15.4). The CLI composes it; a CLI-local builder
would recreate the two-emitters drift class the module exists to prevent.

**`--json` (v1, frozen).** The usual CLI envelope carries this `data`:

```json
{
  "schemaVersion": "1",
  "entity": { "id": "https://…", "type": "Person", "name": "…", "sameAs": ["…"], "email": "…" },
  "gaps": [ { "code": "geo/entity-id", "detail": "…" } ],
  "jsonld": null
}
```

- `entity.id` is the `@id` — the URL of the `role: identity` link — or `null` when
  none exists. It is **never invented** (#103): the field and `gaps` say the same
  thing. `type` is the `structuredData()` `entityType` (`Person` / `Organization`);
  `name` and `sameAs` are the assembler's own values; `email` is `null` when the
  workspace declares none.
- `gaps` are the `geoCheck` checks of its **structured-data section** that scored
  below 1, with `code` and `detail` **verbatim** — no new vocabulary, no threshold
  re-derived. The section is the entity's readiness contract (`geo/entity-id`,
  `geo/sameas-links`, `geo/structured-person`); other GEO codes belong to their own
  surfaces.
- `jsonld` is always `null` in `--json`: the artifact has its own mode, so a
  consumer that wants the view does not also parse an embedded copy. The string
  `"1"` is the contract version, as in §7.1.
- **One language resolution for both modes.** `lang` is `--lang`, else `.pascorc`
  `defaults.lang`, else `en`. `--json` passes it to `geoCheck(profile, lang)`, so
  the readiness `gaps` are measured in the same language `--jsonld` assembles: a
  brand whose only populated `mission`/`tagline` value is `es` cannot report
  `description`/`slogan` as missing while the block emits it.

**`--jsonld`.** Emits `structuredData(profile, lang).jsonLd` — the exact object the
renderers embed — serialized as the paste-ready block

```html
<script type="application/ld+json">
{ … }
</script>
```

(`--bare` emits the bare object instead; `--out <file>` writes the same bytes to a
file). `lang` resolves exactly as in `--json` above; only the brand branch's
`slogan`/`description` are lang-aware, but the shared default keeps the projection
consistent with `pasco build`. `--out` writes a temp file and renames it into place
(atomic), **refuses to overwrite an existing file unless `--force` is passed**
(a mistyped path must not truncate the SSOT), and a write failure is the standard
error envelope at exit `1`, never an uncaught stack. The round-trip is the
acceptance: parsing the emitted JSON yields exactly `structuredData()`'s object,
asserted by a test. The block is a pure serialization — no HTML escaping beyond
`<` → `\u003c`, which JSON parsers decode identically and which prevents a URL from
terminating the `<script>` early.

**Exit matrix.** `0` when `@id` is present · `1` when it is absent (the entity has
no declared home — the same class as the `check` matrix, #252 §S5) · `2` usage. A
schema/load failure is the standard error envelope at exit `1` (D12), and so is a
failed `--out` write (existing file without `--force`, ENOENT, EACCES). The exit
code is the same under `--json`, `--jsonld` and human output; a missing `jsonLd`
cannot occur for a schema-valid workspace (`identity.name` is required).

**Non-goals in v1.** No CMS plugin, no hosted page, no web renderer (M5), no
scoring, no HTML page. `Person` and `Organization` only (whichever the flavor
assembles), together with the §18.9 `hasCredential` / `CreativeWork` entries
`structured-data.ts` already builds. `FAQPage` / `Service` / `BreadcrumbList`
arrive with the schema issue, not here. Offline, no clock, no AI (D19).

### 7.3 `pasco export ai-policy` — retrieval allowed, training blocked (issue #290)

The §12 M9 floor (private-first: published surfaces block AI-training crawlers)
had no artifact, and the opposite half — allowing the retrieval/answer crawlers,
which is what makes a profile citable — had no expression either. This command
ships both as three generated files plus the stated position.

```bash
pasco export ai-policy --out ./public   # robots.txt + llms.txt + AI-POLICY.md
pasco export ai-policy --check          # exit 1 when the UA list is stale or unsourced
```

**Derived data, never a committed workspace artifact** (the ADR-lite of #290). A
committed `robots.txt` rots silently; a generator with a staleness gate turns rot
into a failing command — the same reason `CHECKLIST.md` is a view (§19.3) and the
site root is generated (#279). The command writes into a directory the caller
names; it never touches the workspace itself.

**The registry is the one home.** `platforms/registry.yaml` gains an `ai:` block —
`policy` (version · as_of · stance) and `crawlers` (slug → `ua` · `family` ·
`operator` · `source` · `as_of`). `pnpm gen:platforms` projects it into
`packages/core/src/generated/ai-policy.gen.ts` and the table below; the CLI reads
the projection and never keeps its own UA list. `gen.mjs` refuses an entry with no
`source`, no `operator`, an unknown `family`, a duplicate `ua` (compared
**case-insensitively** — RFC 9309 §2.2.1 matches a product token without regard to
case, so `GPTBot` and `gptbot` are one crawler), an `as_of` that is not a **real**
date, a `policy.as_of` older than the newest row it seals, a policy with only one
family, or a `policy.stance` that is not present verbatim in this SPEC — so the
position the artifact states cannot drift from the M9 floor it claims.

<!-- gen:ai-policy -->
<!-- GENERATED by scripts/gen-platforms/gen.mjs from platforms/registry.yaml — do not edit by hand. -->
ai-policy v1 · as of 2026-10-27 · 7 retrieval (allowed) + 4 training (blocked) = **11** crawler(s).

| Registry entry | User-agent | Family | Operator | Source | As of |
|---|---|---|---|---|---|
| `googlebot` | `Googlebot` | retrieval | Google | [source](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | 2026-10-27 |
| `oai-searchbot` | `OAI-SearchBot` | retrieval | OpenAI | [source](https://developers.openai.com/api/docs/bots) | 2026-10-27 |
| `chatgpt-user` | `ChatGPT-User` | retrieval | OpenAI | [source](https://developers.openai.com/api/docs/bots) | 2026-10-27 |
| `perplexitybot` | `PerplexityBot` | retrieval | Perplexity | [source](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) | 2026-10-27 |
| `perplexity-user` | `Perplexity-User` | retrieval | Perplexity | [source](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) | 2026-10-27 |
| `claude-searchbot` | `Claude-SearchBot` | retrieval | Anthropic | [source](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) | 2026-10-27 |
| `claude-user` | `Claude-User` | retrieval | Anthropic | [source](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) | 2026-10-27 |
| `gptbot` | `GPTBot` | training | OpenAI | [source](https://developers.openai.com/api/docs/bots) | 2026-10-27 |
| `claudebot` | `ClaudeBot` | training | Anthropic | [source](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) | 2026-10-27 |
| `google-extended` | `Google-Extended` | training | Google | [source](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | 2026-10-27 |
| `ccbot` | `CCBot` | training | Common Crawl | [source](https://commoncrawl.org/ccbot) | 2026-10-27 |
<!-- /gen -->

**`robots.txt` — two named groups, never one wildcard.** `ai-retrieval` is
`Allow: /` (search/answer indexing and user-initiated fetches); `ai-training` is
`Disallow: /` (the foundation-model corpus crawlers this policy names). Each
`User-agent` line is preceded by a comment naming its registry entry, operator,
source and `as_of`, so a reader can tell why a crawler is in a group.

**The file is an EXPLICIT LIST and says so.** No `User-agent: *` group is emitted,
and under RFC 9309 §2.2.1 a crawler whose token matches no group is **not
restricted by this file** — so the artifact declares exactly that, in `robots.txt`
and in `AI-POLICY.md`, instead of claiming a default it does not implement. The
choice is deliberate: a wildcard `Disallow` would also block every search engine
the list does not name, and a wildcard `Allow` would contradict the training
entries. The engine states a policy over the crawlers whose classification it has
verified against the operator's own documentation; it makes no claim about the
rest of the web.

**The project page derives the same policy.** `scripts/site-docs/gen.mjs` builds
`site/robots.txt` from this same `ai:` block (it reads the registry; there is no
second list), so the engine's own published surface cannot state the opposite
policy from the one it ships.

**`llms.txt` — the workspace index, with a coverage assertion.** Built in the
shape `scripts/site-docs/gen.mjs` already uses for the project page (title,
one-line definition, link list), from the **workspace**: the entity name, the
canonical `role: identity` URL, the citable `faq[]`, the `publications[]` and a
dated stamp. The builder assembles the document list first and then **asserts that
every document it claims to index appears in the emitted text** — a document
missing from `llms.txt` is a silent hole, not a cosmetic bug, and the assertion is
exported so a test can prove it fails when a section is dropped. The stamp is the
`ai.policy.as_of` registry date, never the wall clock (D19); the identity line is
omitted, with a WARNING, when no link declares `role: identity` — the engine never
invents a canonical URL (§7.2).

**`AI-POLICY.md` — the human-readable statement.** What is allowed, what is
blocked, who can change it, and the date. It quotes `ai.policy.stance` verbatim —
the registry's copy of the §12 M9 floor, gate-checked against this SPEC — and
carries the per-crawler table with each operator's own source URL, so the document
that answers "what is your AI policy?" is auditable line by line.

**`--check`.** Fails (exit `1`) when any entry has no `source` (or a source that is
not `http(s)`), no `family`/`operator`, an `as_of` that is not a real calendar
date, is **future-dated** or is **older than 180 days**, when a `ua` is duplicated
(case-insensitively), or when either group would be empty (a robots.txt with no
training entry blocks nothing). It also gates **`ai.policy.as_of` itself** — the
date the artifacts print as their effective date: it must be a real date, inside
the same 180-day window, not in the future, and **not older than the newest
crawler row it seals** (a stamp that predates its own data is a leftover, not a
review date). It loads no workspace: the list is registry data, which is what
makes the gate runnable in CI. `--out` runs the same check first and **refuses to write** a stale
or unsourced list; the write path is therefore deterministic (registry dates only)
while `--check` is the engine's declared clock-reading path, alongside
`status --verify` (§19.5).

**`--json` contract (v1, frozen).** `data` is `{ "schemaVersion": "1", "policy":
{ "version", "asOf", "stance", "maxAgeDays" }, "groups": { "retrieval": [...],
"training": [...] }, "problems": [...], "files": [...] }` where each crawler row is
`{ slug, ua, operator, source, asOf, ageDays }`, a problem is `{ kind, entry,
detail }` (`incomplete` · `unsourced` · `stale` · `future-dated` · `policy-date` ·
`unknown-family` · `duplicate-ua` · `empty-group`), and `files` (`{ name, path, bytes }`) is present only under
`--out`. The string `"1"` is the contract version, as in §7.1/§7.2.

**Exit matrix.** `0` ok (a clean `--check`, a successful write) · `1` a `--check`
problem, a schema/load failure (D12) or a write failure · `2` usage (no
`ai-policy` subcommand, `--out` and `--check` together, `--force` without `--out`).
`--out` validates all three targets before writing any, writes each atomically
(temp file + rename), and **refuses to replace a file it did not generate** unless `--force` is passed: an
existing foreign `robots.txt` is the user's, and a typo in `--out` must not eat it.

**Non-goals in v1.** No hosting, no deploy, no DNS, no CMS plugin, and no claim
about how any engine actually behaves — that belongs to the measurement module.
The command states a position and ships it; it does not audit the world.

### 7.4 `pasco cite-check` — the citation matcher over saved answers (issue #291)

The measurement module records what an answer engine said; this module answers the
one question about that record the engine can own: **did this saved answer cite
this entity?** The question is a pure function over the SSOT, so it belongs here
and not in the runner (PROP-017's module boundary). It reads **no network, no
model and no clock** (D19): the input is a file the runner produced, and the same
input bytes must produce the same output bytes.

```bash
pasco cite-check answers.ndjson        # a path, or stdin when omitted (or "-")
pasco cite-check answers.ndjson --json
```

**Input — the runner's contract, never produced here.** One JSON object per line:

```json
{ "engine": "chatgpt", "askedAt": "2026-10-23T15:00:00Z",
  "question": "¿qué agencia GEO hay en Ecuador?",
  "answer": "…",
  "citations": [ { "url": "https://…", "title": "…" } ] }
```

`answer` (string) and `citations[]` (objects with a string `url`) are required;
`engine`, `askedAt` and `question` are carried through verbatim. Blank lines are
ignored. **Anything else is malformed**: the command names the 1-based line and
the field, writes no results, and exits `2` — a skipped line would silently change
a rate, which is the failure class this command exists to prevent.

**The match ladder is fixed before the code — one rung per `kind`.** The vocabulary
is the workspace's **declared** data only: the canonical `identity.name`; the one
declared alternate name the schema has, `identity.orgName`, as an **alias**;
declared **handles** (`identity.handle` — its final token, `@` stripped — plus every
`socialHandles[]` row with `status: claimed`); and the **hosts** of the entity's own
URL (`role: identity`) and of its `sameAs` set (`role: realization` links +
claimed-handle URLs, the `structuredData()` set, never a second derivation).

| Rung | Fires when | `kind` | Confidence |
|---|---|---|---|
| `citation-url` | a citation's host is a declared host (equal, or a subdomain of it, with a leading `www.` stripped) **and** — when the declared URL carries a path — the cited path is that path or a descendant (`github.com/elenavasquez` does not match `github.com/someone-else`) | `citation-url` | **high** |
| `exact-name` | the full name occurs word-bounded | `name` | **high** |
| `alias` | `identity.orgName` occurs word-bounded | `alias` | **medium** |
| `handle` | a declared handle occurs word-bounded | `handle` | **medium** |
| `partial` | **any** contiguous multi-token **prefix** of the name (≥ 2 tokens, shorter than the name) occurs word-bounded — `DA SEO` and `DA SEO Digital` for `DA SEO Digital Studio` (a term already claimed by a higher rung is not repeated) | `partial` | **low** |

Matching goes through the matcher's normalizer (`core/src/normalize.ts`; `geoCheck`
keeps its own case-only comparison — see §8): case- and accent-insensitive
(`Domínguez` = `Dominguez`) and
**word-bounded** — `pasco` does not match inside `pascoño`. A citation has no
character span in the answer, so its span is `{ start: 0, end: 0, kind:
"citation-url", url }`; every text span is an offset pair into the **original**
answer (`start` inclusive, `end` exclusive), mapped back from the normalized text.

**Containment.** A shorter declared term inside a longer one is not a second hit:
the longer occurrence wins and the shorter is reported as `longer-name:<term>`
(`DA SEO` inside `DA SEO Digital`).

**The matcher refuses to guess.** Three guards make a text hit **not a citation**
(`cited: false`, the span and its rung still reported, the reason named):

1. `longer-name` — the occurrence is a declared term contained in another declared
   term that also matched there.
2. `ambiguous-term:<term>` + `no-qualifier` — the hit's term is a **single word**
   (the same one-word collision risk `geoCheck`'s `geo/name-collision` reports) and
   its sentence carries none of the declared disambiguators: `identity.location`,
   an `experience[].role` title (the list `geoCheck` already reads, matched as a
   declared phrase) or another declared vocabulary term. A one-word name in a
   sentence that names no other declared fact is ambiguous by construction —
   `Pasco` the CLI is not `Pasco`, Washington, and no engine tells them apart
   offline. `competing:<phrase>` is **not** a guard of its own: only once this rule
   fires, the longer capitalised phrase the text carries (`Pasco County School
   District`) — if it is not a declared term — is quoted as the competing reading,
   so the refusal is explicit instead of unexplained. The expansion stops at
   punctuation, so `Pasco, WA` does not expand. **An adjacent capital never
   disqualifies a hit by itself**, and a declared qualifier in the sentence
   (`In Ecuador Pasco is a CLI`, `DA SEO Digital Studio Founder Ana ships
   profiles`) must leave the hit cited.
3. `contrast-context` — the hit's sentence carries a contrast marker **before** it:
   a closed EN/ES/PT list (`unlike` · `contrary to` · `as opposed to` · `rather
   than` · `instead of` · `versus`/`vs` · `compared to` · `a diferencia de` · `en
   contraste con` · `en lugar de` · `em vez de` · `ao contrário de`). A mention in
   a comparison is not an assertion about the entity.

`cited` is true iff at least one surviving hit or citation exists; `confidence` is
the best surviving rung, and **`low` alone** (a `partial` hit) is never a citation
downstream. `cited` may still be true with `confidence: "low"` — the consumer MUST
treat it as not-cited, and the field exists so that refusal is explicit rather
than a substring accident. A report consisting only of guarded hits is
`confidence: "low"`, `cited: false`. `reasons[]` is a **set in a fixed order**
(the rung reasons, then the guard reasons): `citation-url` · `identity-domain` ·
`sameAs-domain` · `url-invalid:<url>` · `exact-name` · `alias` · `handle` · `partial` · `longer-name:<t>`
· `competing:<phrase>` · `ambiguous-term:<t>` · `no-qualifier` ·
`contrast-context`. **Two axes, never one**: a citation span answers "was there a
link?", a name span answers "was the entity named?" — `named without citing` is
`exact-name` with no `citation-url` span, and `cited without naming` is the
opposite. A consumer that needs the strict reading counts the `citation-url` spans.

**`--json` (v1, frozen).** The usual envelope's `data` is:

```json
{ "schemaVersion": "1",
  "entity": { "name": "…", "aliases": ["…"], "handles": ["…"],
              "partials": ["…"], "hosts": ["…"] },
  "answers": [ { "line": 1, "engine": "chatgpt", "askedAt": "…", "question": "…",
                 "cited": true, "confidence": "high",
                 "spans": [ { "start": 0, "end": 0, "kind": "citation-url", "url": "https://…" },
                            { "start": 412, "end": 430, "kind": "name" } ],
                 "reasons": ["citation-url", "sameAs-domain", "exact-name"] } ] }
```

`entity` is the vocabulary the matcher resolved, so a report can say **what** it
matched without re-reading the workspace. `answers` has one row per input line, in
input order and **never aggregated** — no rate, no score, no total. `line` is the
1-based source line; `engine`/`askedAt`/`question` are `null` when omitted by the
input. `spans` are ordered: citations first (in citation order), then text spans by
`start`. The string `"1"` is the contract version, as in §7.1–§7.3.

**Exit matrix.** `0` a successful read, whatever the matches — a measurement, not
a gate, so a `cited: false` answer is data, never a failure · `1` the workspace
cannot load (schema/load, D12), or the **input path cannot be read** · `2` usage,
or **malformed NDJSON** (the input is not the declared contract; never a silent
skip). Text mode prints one block per answer plus the number of answers read; it
prints no citation rate.

**Declared limits.** The engine knows only declared facts. (a) A world homonym the
text does not disambiguate is reported, never resolved: `Pasco, WA` is a qualified
mention only when a declared qualifier appears in its sentence — the matcher
carries no gazetteer. (b) Host comparison is by **host** (a leading `www.`
stripped; a subdomain belongs to its parent), not eTLD+1: the engine ships no
public-suffix list, so `a.example.co.uk` and `b.example.co.uk` are different hosts
and that is all the contract claims. A declared URL's **path** narrows the match
to that path and its descendants, because a shared host alone (`github.com`, `x.com`)
would overreport exactly the way substring matching does; a declared root URL
claims the whole host. Paths compare **case-sensitively** (RFC 3986 puts that on
the server); `www.`/trailing slashes are normalized, query strings ignored. (c) The contrast guard is a closed lexicon,
not comprehension. (d) The alias rung reads the one alternate name the schema
declares; a general per-language alias list would be an **additive schema change**,
not a v1 feature. (e) `partial` reads **every** contiguous multi-token prefix of
the name, but never a single-token one — a single-token prefix of a multi-token
name is a common word and would overreport, which is the exact failure this
command exists to prevent. (f) A `citations[].url` the URL parser rejects — a
missing scheme (`github.com/pascocli`) is the common case — is **never repaired
or guessed**: the row is reported with `url-invalid:<url>` in `reasons[]`, so a
dropped citation cannot read as a clean `cited: false`. A URL that parses but is
not a declared target is a legitimate "cited elsewhere" and adds no reason.

**Non-goals in v1.** No engine calls, no browser automation, no scheduling, no
leaderboard, no score, no storage, no report and no aggregation (the runner's and
the report module's). "Am I visible?" is not this command: it answers "was I
cited?" over bytes already saved.

### 7.5 `pasco export profile` — the normalized profile (issue #348)

The engine exposed `build <platform>` (deterministic text slices per surface) and
`validate`, but no object a consumer could read without re-implementing `load()` +
`normalize()`. Two real consumers paid for that: each kept a private copy of the
pipeline and drifted from the contract — one read 9 of 14 roots (`education`,
`languages`, `credentials` and `artifacts` hardcoded to `[]`), dropped an explicit
`publications[].url` in favour of a derived DOI link, and treated the invariant
`experience[].org` as a langMap. This command is the contract that removes the
copy:

```bash
pasco export profile --json          # the payload, inside the standard envelope
```

**`--json` (v1, frozen).** The usual CLI envelope carries this `data`:

```json
{
  "schemaVersion": "1",
  "engine": { "name": "@profile-as-code/cli", "version": "<cli version>" },
  "source": { "commit": "…40-hex sha or null…", "generatedAt": null },
  "profile": { "identity": {}, "…": "the normalized profile (see the promise below)" }
}
```

- **`schemaVersion`** is the frozen contract version of THIS payload — literally
  the same key and the same precedent as §7.1/§7.2/§7.3: a consumer **refuses a
  version it does not know rather than guessing**. It is bumped when the payload's
  shape changes; the `profile` object's own shape is the contract schema
  (`schema/profile.schema.json`), so a major schema change bumps `schemaVersion`
  with it.
- **`engine`** names what produced the bytes (`name` + `version` of the CLI), so a
  consumer can explain a difference instead of re-deriving it.
- **`source.commit`** is the workspace's git `HEAD` (`git -C <workspace> rev-parse
  HEAD`), i.e. the commit a consumer pins for freshness; **`null`** when the
  workspace is not inside a git repository (or git is unavailable) — the payload
  never invents a source it does not have. The command does not inspect the
  working tree: a dirty workspace is the caller's state, and re-reading the
  workspace is what tells a consumer the bytes moved.
- **`source.generatedAt`** is the caller-pinned timestamp, emitted **verbatim**:
  `--now <iso8601>`, else `null`. There is no other clock path — the command reads
  no clock, touches no network, and two runs over one workspace produce
  **byte-identical output** (§15.1 byte-parity). A malformed `--now` is refused
  (exit `1`) instead of silently becoming `null` or "now" — and the check is
  **calendar-strict**, because `Date.parse` normalizes an impossible date
  (`2026-02-31T00:00:00Z`, `T24:00:00Z`): those are refused, not blessed.

**One assembler, never a CLI-local builder (§15.4).** `profile` is exactly the
normalized object `core.load()` returns — schema-validated (D12), not filtered,
re-derived or re-ordered by the CLI. **The precise promise** (this is the single
statement; every other surface repeats it): the object carries **every root the
workspace declares, plus every *list* root defaulted to `[]`**; an optional
**object** root (`newsletter`, `podcast`, `audiences`, `active`) appears **only
when the workspace declares it**, because the contract has no valid empty value
for it (`$defs` require `platform`+`url`, `title`, `lang`+`variantId`+`chosenAt`),
and inventing `{}` would fail D12. `compile(profile, platform)` is deliberately
NOT reused: it is the per-platform `PlatformProfile` slice, a different object for
a different job — the reason this command is described as the *normalized* profile,
never the "compiled" one.

**What the object guarantees, and what it does not.**

- **Declared roots.** Every root the workspace declares is present
  (`education`, `languages`, `credentials`, `artifacts`, `faq`, `press`,
  `socialHandles`, `checks`, …).
- **List roots are arrays even when undeclared** — `normalizeProfile` defaults
  every list root (this PR adds `faq[]`), so the shape does not depend on whether
  a workspace declares answers.
- **Optional object roots are absent when undeclared** (`newsletter`, `podcast`,
  `audiences`, `active`). A consumer that needs one applies its own default; the
  payload does not invent a half-valid block.
- **`artifactRefs` stay ids**, which is what the contract declares: the referenced
  object is present in `profile.artifacts[]`, so a consumer joins by `id` and
  never re-derives. A dangling ref is already a load failure (D17 §18), so every
  emitted id resolves.
- **`publications[].url` is emitted as declared** — never replaced by a DOI-derived
  link; both fields travel and the consumer chooses.
- **`deployments` is included** (not declared out of scope): it is a schema root,
  `load()` normalizes it, and a consumer that does not need the ledger ignores it.
- **Visibility is not filtered.** The normalized profile is the SSOT, not a
  rendered surface: `visibility` (§18.5) is a renderer-owned rule, and a consumer
  that emits publicly applies it. This is the reason the command is not `build`.

**Validator parity — `validate` and `build` resolve one schema (issue #348).**
Both commands load through `core.load()`, so they resolve the same generated Zod
(hence the same `schema/profile.schema.json`, including its
`additionalProperties: false` policy) and cannot diverge on a field a newer schema
added. The witness is `projects[].artifactRefs` (#333/v1.12): a workspace carrying
it must be accepted by both, and a workspace carrying an unknown row field must be
refused by both **with identical violations**. A CLI test pins both directions —
the artifactRefs fixture plus an injected unknown key, asserting equal error
payloads across `validate`, `build`, `export profile` and `preview` — so a second schema or a
different policy cannot be introduced on one command without failing CI. The new
command's own schema-failure row (`kind: "schema"` + `violations`, e.g. a dangling
`artifactRefs` target) is tested separately, because it shares the same load path
and therefore the same promise.

**Exit matrix.** `0` ok · `1` the workspace fails to load (schema/ledger/registry —
D12) or `--now` is malformed · `2` usage (unknown `export` subcommand, or the
`ai-policy`-only `--out`/`--check`/`--force`/`--lang` flags). Human mode prints a
summary of the same object; `--json` is the contract.

**Not here.** The `.pascorc` engine-version gate and `pasco doctor` are §7.6; the
publishable schema URL+hash for consumers without the engine is §7.7 — the
`schemaVersion` string above gates THIS payload, and those two are separate
contracts. No renderer, no visibility filtering, no platform slice, no writes.

### 7.6 The engine gate and `pasco doctor` — a declared minimum engine (issue #348)

A workspace written for a newer contract must fail with the facts a user needs,
not with a confusing parse/load error. `.pascorc` declares the **minimum engine**
the workspace requires; `validate`, `build`, `export profile` and `preview` check it
**before doing any work**:

```json
{ "workspace": ".", "engine": "0.4.0" }
```

- **The field is optional and additive.** Absent = no requirement, so every
  pre-#348 workspace keeps working. A present value is a **minimum**, never an
  exact pin: the question a workspace asks is "does this engine know my
  contract?", and a patch/minor upgrade within the same major must not refuse.
- **Accepted syntax: exactly `MAJOR.MINOR.PATCH`** — three dot-separated ASCII
  decimal components, no `v` prefix, no range operator (`^`, `~`, `>=`), no
  `*`, no pre-release/build suffix. This is the whole grammar, deliberately: the
  repo is dependency-light and a full semver range implementation buys nothing
  for a lower bound. A future upper bound is an additive field, not a
  reinterpretation of this one.
- **The comparison is numeric on the three components** (`0.4.0 > 0.3.6`,
  `0.4.0 == 0.4.0`). The installed engine is the CLI package's own version; a
  pre-release suffix on the installed version is ignored (the engine has no
  pre-release channel), while the **required** value must match the grammar
  exactly.
- **Failure modes.** An installed engine older than the requirement exits `1`
  with the three facts, no guessing: the **required** version, the **installed**
  version, and the exact upgrade command `npm i -g @profile-as-code/cli@latest`
  (the documented update path, USER-GUIDE §8.2). A malformed value exits `1` as
  a configuration error that names the field, the offending value and the
  accepted syntax — it is never coerced, dropped, or read as "no requirement".
  The JSON envelope carries the same refusal as `error: { kind: "engine" | "config",
  message }`; `2` remains usage.
- **Scope of the gate is exact:** `validate`, `build`, `export profile` and `preview`.
  Other commands keep their own semantics; `.pascorc` is not re-read as a global
  policy engine.
- **Every consulted `.pascorc` counts (fresh-review F1).** With no `--workspace`
  flag, `resolveWorkspace` reads the cwd `.pascorc` to resolve a
  `"workspace": "sub"` pointer, and the commands read the resolved workspace's
  own `.pascorc` for defaults. The gate reads BOTH, deduped by path: a
  declaration in the pointer file the user invoked cannot disappear. When both
  declare one, the **stricter (higher minimum) wins**; a malformed declaration in
  either file is refused. An explicit `--workspace` bypasses the cwd config (D14),
  exactly as resolution does, so only that workspace's file applies.
- **Offline and deterministic** (D19): the check reads two versions (the package
  manifest and the `.pascorc` chain), no clock, no network.

**`pasco doctor`** is the reading surface, chosen over overloading `--version`
because `--version` describes the **binary** and is expected to work with no
workspace at all; `doctor` describes the **pair** (engine + workspace) and must
therefore resolve one. It prints **one line**:

```
engine 0.3.6 · schema v1.15 · workspace /path/to/workspace (valid) · requires engine >= 0.4.0 (NOT MET — upgrade: npm i -g @profile-as-code/cli@latest)
```

- **engine** — the installed CLI version; **schema** — the profile-contract
  version the CLI was built against, derived at generation time from the
  schema's own `$id` (`PROFILE_SCHEMA_VERSION`, `pnpm gen:zod`), never a
  hand-kept literal and never the plugin/export payload's `schemaVersion`;
  **workspace** — the resolved path and whether `load()` succeeds.
- It also reports the declared requirement (`no engine requirement`, `met`,
  `NOT MET` with the upgrade command, or `INVALID` with the syntax problem).
- **`--json`** emits the same facts inside the standard envelope as
  `{ engine: { name, version }, schema: { version }, workspace: { path, valid,
  error? }, requirement: { declared, met, problem?, source? } }`; `source` names
  the `.pascorc` that produced the effective (strictest) declaration, and
  `error` is present only when the workspace cannot load.
- **Exit matrix:** `0` healthy (workspace loads and any declared requirement is
  met) · `1` unhealthy (workspace fails to load, requirement unmet or malformed)
  · `2` usage. `doctor` **reports** the three facts but does not replace the
  gate: it fails the same run with exit `1` because the workspace is unhealthy,
  while the three commands refuse before doing work.
- Offline, no clock, no writes.

### 7.7 The published schema contract for consumers without the engine (issue #348)

A consumer that only needs to **validate a profile** must not install the CLI or
clone this repository to use the *released* contract. The contract is published as
an immutable artifact identified by **URL + sha256**, recorded in
[`schema/consumer-contract.json`](../schema/consumer-contract.json):

| | Artifact | Identity |
|---|---|---|
| **Released** | `schema/profile.schema.json` at a published release tag | tag-pinned raw URL + sha256 + `$id` version (today `v0.3.6`, schema v1.13) |
| **Current** | the committed `schema/profile.schema.json` on this branch | `$id` version + sha256, **no published artifact** (today v1.15; `published: false`, `artifact: null`) |

- **Tag-pinned, public repo only.** The released URL is exactly
  `https://raw.githubusercontent.com/ChristianLuciani/profile-as-code/<tag>/schema/profile.schema.json`.
  A tag is immutable, so the bytes a consumer downloads never change under them;
  a floating ref (`main`) or a private repo/path is refused by the gate and may
  never appear on this published surface (AGENTS.md rule 9).
- **The current block declares its own publication truth (fresh-review F2).**
  The manifest's `current` object carries `published` plus `artifact`: when
  `published` is `false`, `artifact` MUST be `null` and the `note` MUST say where
  the bytes can be obtained (a repository checkout, not a URL). The manifest
  cannot claim a joinable artifact it does not have, and every shipped surface
  repeats that exact state. **The released v0.3.6 artifact is schema v1.13 and
  rejects `publication.kind`** (`$defs.publication` has `additionalProperties:
  false`); a consumer that needs `kind` (or `releases[]`) must use a
  v1.15 checkout (verify its sha256) until the next release tags it. The reading guide says so where it
  tells a consumer how to validate.
- **No network in the gate (D19).** `node scripts/schema-contract/check.mjs
  --check` recomputes the sha256 of the committed file, reads the immutable copy
  at the released tag from **local git**, and refuses: a `current` hash/version
  that disagrees with the committed schema (a schema edit that forgot to
  regenerate the manifest), a `current` publication claim it cannot join, a moved
  tag copy, a malformed tag or hash, or a URL that is not the exact public
  tag-pinned raw URL. The generator side is the same script with `--write [--tag
  <tag>]`: it recomputes both hashes locally, enforces the SAME tag existence and
  reachability as `--check`, and derives publication rather than inventing it (a
  tag carrying the current bytes yields `published: true` + the tag URL;
  otherwise the block stays unpublished with a note). The self-test
  (`scripts/schema-contract/test.mjs`) proves each refusal, including the CLI
  rows end-to-end against a synthesized git repository; both run in CI. A release
  pin that is no longer the newest reachable tag only **warns** — the release prep
  moves it, and a dated published artifact stays correct forever (#226 rule 8).
- **What it does NOT cover.** This is **structural** validation only. It is not
  `load()`: the cross-file invariants core re-checks after Zod (unique entry
  ids, the `locator` XOR, dangling `artifactRefs`, ledger key/surface rules,
  duplicate composite keys) and the engine's behavior (`driftCheck`, `geoCheck`,
  `audit`, `completeness`, renderers) are outside the JSON Schema. It does not
  describe `.pascorc`/the engine gate (§7.6), the `export profile` envelope or
  its `schemaVersion` (§7.5), or any visibility filtering. Consumers that need
  those need the engine.
- The reading page for consumers is [`docs/SCHEMA-CONTRACT.md`](SCHEMA-CONTRACT.md);
  the manifest is the machine-readable copy of the same facts.

### 7.8 `pasco presence` and `pasco release plan` — the presence contract (D23, issue #262)

`presence` is the daily board and `release plan` is the launch view (operator
decision 2026-10-28, option B). Both are **derived reads** over `releases[]` and
the §19 ledger; neither writes, fetches or reads a clock.

```jsonc
// pasco release plan <id> --json  (envelope data; schemaVersion "1")
{
  "release": { "id": "v0-3-0", "version": "0.3.0", "date": "2026-10-28",
               "summary": "…", "changedUnits": ["identity"] },
  "surfaces": [ { "surface": "github-repo-meta", "kind": "repo-meta",
                  "state": "never", "missingUnits": [] } ],
  "baseText": [ { "kind": "repo-meta", "text": "What shipped: v0.3.0 (…)" } ]
}
```

- **State is the ledger's**: for each changed unit on the surface, a missing
  record → `never`; any record whose `contentHash` differs from the unit's
  current hash → `stale`; otherwise `in-sync` (the §19.3 rollup, reused).
- **Order** is kind rank `repo-meta` → `profile` → `distribution`, then slug. The
  artifact's metadata precedes the identity bodies, which precede the
  announcements.
- **`baseText`** is the per-kind FACTUAL SPINE (`version · date · summary`) — not
  announcement copy. The copy per channel lives in `skills/` (rule 7 + D9).
- **Refusals (`release plan`)**: a workspace with no `releases[]`, an unknown
  release id, a duplicate release id, a duplicate surface or a surface absent
  from `platforms/registry.yaml` is exit 1 with the exact reason (a typo never
  silently builds a plan). A subcommand other than `plan` is exit 2.
- **`presence` with no `releases[]`** renders an EMPTY board and exits 0
  (`latest: null`, no rows, zero counts): absence of releases is not an error on
  the daily board. It still refuses the same malformed/unknown-surface cases.

`presence` lists one row per surface at the NEWEST release that declares it, with
`{ kind, state, releaseId, version }` and the `in-sync`/`stale`/`never` counts.

### 7.9 `pasco preview` — one file, two transports (issue #282)

**The contract is the artifact, not the hosting.** A `profile-data` fork is
private because its data is personal; the missing capability was never hosting
but a **view**. Pages cannot supply it: on personal Free/Pro plans the published
site is public (there is no access control), so a private fork with Pages on
publishes the data by default. `pasco preview` renders the same surfaces
`pasco build` writes into a single file the operator opens locally — or uploads
as a CI artifact — and nothing is published.

**Why one file.** A single self-contained document has no base URL to resolve,
so the class of bug #279 hit (a page served at an arbitrary depth breaking every
relative URL) cannot occur, and there is nothing to compress before moving it.
The consequence is deliberate: **no separate pages** per platform or language —
one page with sections and anchors. The rejected alternative (a folder with one
page per surface) is more "browsable" and reintroduces the base problem.

**Contract.**

| | |
|---|---|
| input | the workspace `build` reads (`.pascorc` + `content/`), same `load()` |
| output | one file, stable name `index.html`, no external dependency (no font, no CDN) |
| default | `<workspace>/.pasco/preview/index.html`, then opened with the platform opener — outside the versioned tree when the workspace ignores `.pasco/`, and a warning when the destination sits in a git work tree that does not |
| `--out <dir>` | writes `<dir>/index.html` and opens nothing (transport B: CI artifact) |
| `--no-open` | writes the default location, opens nothing |
| `--lang <l>` | the language rendered (default `.pascorc → defaults.lang`, else `en`) |
| `--now <iso8601>` | pins the `generated <date>` stamp instead of reading the clock |
| header | `generated <date> from <N> facts` — freshness, not a version (`N` = the non-empty scalar leaves of the normalized profile, derived on every run) |
| no server | `file://` is enough for one file and leaves no port listening |
| no JS | raw HTML in the data is **escaped** by the renderer, not emitted; the gate proves it |

**The privacy gate is the preview's own, and the site does not need it.** The
public site publishes public entries the ledger already vetted; the preview
carries the operator's own working data, so it refuses rather than filters — a
refused preview writes **no file** (there is nothing left on disk to clean up):

| rule | what it refuses |
|---|---|
| `absolute-path` | a machine path (`/Users/…`, `C:\…`, `file:///…`) printed in the document — the trigger is real: `check`'s media/registry findings embed absolute source paths, so the assembler relativizes them |
| `credential` | a pasted token/private key (token shapes + `secret: <16+ non-space>` assignments; narrow on purpose — see below) |
| `external-asset` | a `<link>`, a remote `src`, a remote `url(…)`, a stylesheet import: the "no network" invariant as a check |
| `active-content` | a `<script>`, an `on*=` handler, an `<iframe>`, a `javascript:` URL |
| `source-outside-declared-roots` | a file the preview read that resolves outside the workspace (a symlink escape) |
| `source-missing` · `credential-file` | a declared source that is gone; a dotfile/credential-shaped asset (`.env`, `.netrc`, `id_rsa`, `*.pem`) |

Media policy: workspace media inside the workspace is inlined as `data:` URIs
(per-file and total budgets); **evidence-root** media (`origin: "external"`) is
left out of the page and listed in it, so it never reaches the gate at all (D14:
a per-machine path never reaches a render); a remote image (a shields.io badge)
becomes a text note — a preview that fetched it would stop being offline and
would tell a third party the operator opened their own data.

**Exit matrix:** `0` written (warnings do not block) · `1` the workspace fails to
load, the `.pascorc` engine requirement is unmet (§7.6 — `preview` is in the
gate's scope), a selection error makes `build` refuse the surface, the privacy
gate refused, or the write failed · `2` usage. Offline; the only clock read is the
document's own stamp, and `--now` removes it.

**What it does not do.** Transport B's workflow lives in the workspace template
(`profile-data-template`), not in the engine (multi-tenant rule §9); it is
`workflow_dispatch` only, uploads the artifact, uses no Pages, and states that
the artifact is readable by anyone with repository access. The preview does not
edit (it is a read), does not encrypt (that breaks the no-JS invariant and the
passphrase is the weak link), and does not judge: the check state is reported,
not enforced — `pasco check` remains the gate.

### 7.10 `pasco discover` — the provisional profile (issue #329)

`pasco audit` scores a `Profile`; a prospect has none. Discovery produces a
**provisional** one from the surfaces the prospect already publishes, so the
existing checks run unchanged — and says, per fact, where it came from.

**Input / transport.** `<url>...` plus an optional `--allow-host` list. The
host allowlist is the platform hosts projected from `platforms/registry.yaml`
(one metadata home, #154) plus what the operator declares; it is checked
**before any request**, and a URL outside it is `host-not-allowed` with no
request made (the same rule and the same reason as §19.5: an unvalidated fetch
of untrusted input is an SSRF primitive). Requests are sequential and never
retried, credential-free, cookieless, browser-automation-free; redirects are
refused so the final hop cannot leave the allowlist. The driver is
`httpFetchText`, the engine's one HTTP discipline — discovery does not grow a
second one. Its request budget is DECLARED, not implied: **one page request per
surface, plus at most five same-host link probes** on that surface (only to
grade a pointer, never to crawl). §19.5's no-amplification rule governs the
verification pass; discovery states the bound it needs instead of borrowing a
budget it does not have.

**What is read.** Only facts a surface itself declares: schema.org JSON-LD
(`Person`/`Organization`: `name`, `jobTitle`, `worksFor`/`startDate`/`endDate`,
`sameAs`) and the page's `<a href>` links. No prose mining — free-text year
extraction is the same fragility drift refuses, so a
surface without JSON-LD yields links and claims, not invented identity — a page
`<title>` is not a declared name, and when no surface declares `name` the
command refuses (exit 1) rather than guessing. A
surface that cannot be read (`http-<code>`, `network-error`, `host-not-allowed`,
`invalid-url`) is REPORTED in `unchecked`; it is not an empty profile.

**Output.** A profile-shaped object that validates against the contract schema
(`normalizeProfile(validateProfile(...))`) so `driftCheck` runs unchanged, plus
`provenance: { <factRef>: { surface, url, retrieved, attested: false } }` and
`absent[]`. One experience row per (surface, org) is kept on purpose: a prospect
who wrote 2020 on one surface and 2019 on another must surface as
`drift/duplicate-experience` (`contradiction`, FAIL), and deduplicating across
surfaces would erase the only evidence of the disagreement. Discovery's own
classes are `dangling-ref` (a same-host link, at most five per surface, that did
not resolve) and `unsourced-claim` (a sentence that passes
`isQuantitativeClaim` with no `source:`/`evidence:`/URL on it). Names and
severities are §7.1's (`dangling-ref` FAIL · `contradiction` FAIL ·
`unsourced-claim` WARN) and the ordering is §7.1's, but the PREDICATES are
discovery's own, stated here rather than implied: `dangling-ref` is a live
pointer answered 404/410 (not the audit's offline referential check — a
`network-error` or a `429` is a probe that did not complete and is never
graded), and `unsourced-claim` is a sentence on a surface with no source on it
(not the audit's SSOT row without an evidence pointer). Those two classes address
the SURFACE corpus, not the factRef space: `links[<surface>][<n>]` is the n-th
same-host probe and `surface[<surface>].text[<n>]` the n-th sentence, so two dead
links (or two claims) on one surface are two distinguishable addresses. A
factRef-shaped path is always a provenance key; a surface-corpus path never is,
and both are declared here so a consumer can join without guessing. A consumer
that needs one meaning must not read the two reports as interchangeable.

**Write rule.** Nothing is written: no `content/`, no ledger, no artifact; the
report carries `wrote: false` and a test snapshots a working tree's directory
listing before/after a run and asserts it is unchanged (the flag alone would be
a claim, not a check).
The provisional shape is **not** the persisted contract: it borrows the Profile
geometry to reuse the checks, and it never enters a workspace or a schema
version (§6/D3 untouched by design — promoting it would be its own decision).

**Exit matrix:** `0` report produced with no FAIL finding · `1` a FAIL finding
(`dangling-ref`/`contradiction`), no surface readable, or no surface declared a
name (never invented) · `2` usage. `--json` is the envelope of §7.1 with
`schemaVersion: "1"`, `surfaces`, `unchecked`, `provisional`, `findings`.

## 8. GEO as a cross-cutting layer

GEO is not a renderer — it is enforced in four places:

1. **Schema**: `positioning.geo`, `keywords.geo`, `geoKeywords`, `evidence[]` (verifiable claims).
2. **Core**: `geoCheck` — cross-platform fact consistency (an LLM triangulating LinkedIn vs GitHub
   must find the same dates/roles/papers), structured-data readiness (schema.org `Person` JSON-LD
   for the web renderer), semantic association anchors (what an LLM should associate the person with).
3. **Skills**: each platform's research includes a GEO section (how that platform is read/cited by LLMs,
   e.g. LinkedIn/`loop` agent, X via tweet citations, GitHub README as agent context, Substack via RSS).
4. **Renderers**: web/github outputs may embed machine-readable metadata (JSON-LD, clean headers).

Anti-patterns to forbid: keyword stuffing (LLMs discount it), contradictions (auto-filtered),
unverifiable claims (no source → dropped by cite-aware systems).

**v1.10 inputs (#288), landed as geoCheck v2 (#289):** the answer-engine facts
`identity.definition` and `faq[]` feed the five citability codes below — the
CONTRACT, with their weights; the nine pre-v1.10 checks dilute ×0.8 to free the
0.20 of weight they now carry (documented, never silent). Severity is the
reporting tier only: `info` NEVER changes the pass story — a dormant profile is
not a bad profile.

| Code | Fails when | Severity | Weight |
|---|---|---|---|
| `geo/canonical-definition` | `identity.definition` absent, a value > 160 chars, or a value not containing the entity name | WARN | 0.06 |
| `geo/faq-coverage` | `faq[]` absent, < 3 rows, a duplicate `q` (collapses into one answer surface), or a row without `source` | WARN | 0.06 |
| `geo/freshness` | no `dateModified`-bearing fact in the last 12 months — calendar window; future-dated facts cannot evidence freshness and are reported as an anomaly (newest `deployments[].deployedAt`, `press[].date`, `credentials[].issued`, newest `publications[].year`) | INFO | 0.03 |
| `geo/sameas-coverage` | a `claimed` handle resolving to a URL that is NOT in the emitted `sameAs` set (e.g. its URL is the `@id`, excluded by the assembler), or fewer than 3 `role: realization` links | WARN | 0.04 |
| `geo/name-collision` | a one-word entity name whose `definition` carries no disambiguating qualifier (`location` or an `experience[].role` title — matched case-insensitively, like the name containment above) — homonyms cannot be detected offline: the code reports the risk it can observe, marks the unobservable as `[?]`, and never claims a collision it did not see | INFO | 0.01 |

**cite-check's fold is its own (#291).** `core/src/normalize.ts` is the case- and
accent-folding used by `pasco cite-check` (§7.4), which matches the declared
vocabularies offline. `geoCheck` keeps its own case-only comparisons **by
decision**: its published score and findings (`geo/canonical-definition`,
`geo/name-collision`, the semantic anchors) are a separate contract, and this PR
does not move them — the regression test pins `Sofía Domínguez` + an unaccented
definition at the pre-PR reading, so an accent-insensitive GEO check would be its
own SPEC change. The two sides may therefore disagree about a folded name, and
that is declared rather than hidden. `cite-check` scores nothing: it reads the
answers the runner saved and reports, per answer, whether the entity was cited —
the GEO codes above stay the profile-side readiness signals.

## 9. the profile-data workspace (folder-first; a repo is recommended)

The workspace is **a folder** on disk. The engine consumes `content/*.yaml` plus the policy
file `.pascorc` by configured path, and `pasco build` writes the generated `profiles/` into
the same folder. Every on-ramp also ships a workspace `README.md`; only on-ramp A (the
template) ships `CHANGELOG.md` and `CHECKLIST.md` — `pasco init` creates the minimal set and
stops there (§9.2).
It does **not** have to be a git repository, and it does **not** have to live on GitHub.
The folder can live on GitHub, on another git host, on plain disk, or in synced storage;
storing it in a **repo** is the **recommended** option, because it buys history and lets
automation run over the data. The engine does
not see the difference — it reads the workspace by **configured path**
(`.pascorc → workspace`, D14).

**Hard requirement (the only one):** a folder `pasco` can read by configured path whose
`content/*.yaml` satisfies `schema/profile.schema.json`. Where that folder lives and how
it is versioned are recommendations, not conditions of use.

### 9.1 Terminology — the profile-* family (single source of naming)

"profile" is always the FIRST word — alphabetical grouping and one mental model.
This table is the canonical terminology; docs and code reference it, never invent names:

| Surface | Name | Visibility | Role |
|---|---|---|---|
| Engine | `profile-as-code` | public (product) | schema, core, CLI `pasco`, renderers |
| Template | `profile-data-template` | public | on-ramp **A** skeleton (example workspace + instructions) |
| Workspace (per user) | `profile-data-<username>` | private by default | the user's facts (SSOT) — what they edit; a folder first, stored in a repo by recommendation |
| Deploy surfaces | e.g. `ChristianLuciani/ChristianLuciani`, CV site | public | rendered output (never edited by hand) |

Future workspaces follow the same family: individual identities today, **commercial/brand
identities** now (multi-workspace: one workspace per identity, same engine) — the naming
stays `profile-data`-first regardless of the identity's nature, so a brand workspace is
`profile-data-topia`, not `topia-data` (the family prefix wins; D15).

**Per-user naming (2026-09-07):** every workspace repo carries its owner —
`profile-data-<username>` (e.g. `profile-data-christianluciani`). The operator's first
workspace (`profile-data`, no suffix) predates the convention and keeps its name.

**Workspace flavor (D15):** every workspace declares its flavor in `content/flavor.yaml`
(`flavor: person | brand`, default `person`). The flavor is a contract field, not a separate
product: it only changes which blocks/checks apply (brand adds `socialHandles`, `newsletter`,
`podcast`, `press`, `audiences` and org identity fields; GEO emits `schema.org/Organization`
instead of `Person`). See §17.

### 9.2 On-ramps — three peers, capability differences said up front

The **recommended** on-ramp is delivered as a **GitHub template repository**
(`ChristianLuciani/profile-data-template`): a new user clicks `Use this template` (or forks),
renames the result to `profile-data-<username>` and makes it private. The folder
`templates/profile-data/` in the engine repo is a **pointer** to it (no duplication → no
drift). That is on-ramp **A**; the two on-ramps that need no account and no repo are **B**
(local, `pasco init`) and **C** (bring your own storage). They are **peers**: the same folder
contract, the same engine, the same `pasco` commands. Each one states its own difference of
capabilities up front, and each is discovered on a surface that does not assume the reader is
standing in this repository.

| On-ramp | Discovered at | What it sets up | Automation | History | Account + repo |
|---|---|---|---|---|---|
| **A — template repo** *(recommended)* | the template repo's own `README`; this repo's README + quickstart; GitHub **Use this template** | the full commented example, operational docs, licence, a ready `.pascorc` | yes, in your repo — GitHub Actions on push/PR (offline YAML + link checks; the `pasco` build workflow landed in the satellite, `profile-data-template#11`, closed 2026-10-12) | yes — hosted git history from the first commit | **required** (account + repo) |
| **B — local, `pasco init`** | the npm package page (`@profile-as-code/cli`); `pasco --help`; [`USER-GUIDE.md`](USER-GUIDE.md) §3 | a minimal, `pasco validate`-clean folder in seconds | **no** — nothing runs on a change and no workflow is created | **no** — no repo is created; `git init` is yours to run | **none** |
| **C — bring your own storage** | the npm package page (`@profile-as-code/cli`); this section; [`USER-GUIDE.md`](USER-GUIDE.md) §3 | the same `pasco init` scaffold, written at a path you choose (local disk, a synced folder, another git host) | same as B | same as B, plus whatever your storage provides | **none** |

Capability differences, said plainly:

- **Common to all three** (the engine's capabilities, not the on-ramp's): the whole `pasco`
  command set except `pasco diff`, which needs a git history — plus deploy by pasting the
  generated texts.
- **B loses automation and history.** There is no repo and no workflow, so nothing runs on a
  change and nothing versions the folder for you. It keeps every other capability.
- **C has the same capabilities as B.** The only difference is where the folder lives: the same
  `pasco init` scaffold is written at the path you give it, so the workspace sits in storage
  you already use. No account, no repo, no host.
- **A adds content and plumbing, not capability:** the full example, `CHANGELOG.md` /
  `CHECKLIST.md` wired for the workflow, the licence, and repo automation. `pasco init` stays
  **minimal by design** — the complete package lives in the template, and content parity
  between the on-ramps is explicitly not a goal (issue #200).
- **Discoverability today:** all three surfaces resolve for a stranger. A's (the satellite
  repo) is **public** (verified 2026-10-23: `gh repo view ChristianLuciani/profile-data-template
  --json visibility` → `PUBLIC`, HTTP 200), so `Use this template` is reachable — A still
  requires an account and a repo, as the table above says; B and C are reachable from the
  public npm package, with no repo access at all.
- **`pasco init` behavior does not change with this section** — what it scaffolds today *is*
  the local on-ramp.

```
profile-data/
├── README.md            # instructions: pick your on-ramp, install pasco, first build
├── content/             # identity.yaml, positioning.yaml, bios.yaml, skills.yaml,
│                        # experience.yaml, projects.yaml, publications.yaml, keywords.yaml
├── profiles/            # generated outputs (committed: they ARE the deploy artifacts) +
│                        # <platform>/variants/ — chosen variant bodies (INPUT, #238)
├── posts/               # the STREAM: seeds + per-channel projections (#264, #267) — never
│                        # read as identity facts; not part of profile.schema.json; created by
│                        # `pasco post`, not by `pasco init`
├── CHANGELOG.md         # every change: date + which platforms need re-paste
├── CHECKLIST.md         # per-platform verification after pasting
└── .pascorc             # workspace path, defaults (D11, D12, D13, D14)
```

**Integration (Q4→D14):** the engine never copies or owns user data — it reads the workspace by
**configured path** (`.pascorc → workspace`). No symlink in the normal flow. A **symlink mount**
(`workspaces/<user>/` → external repo) is an advanced option so engine-CI can validate user data
without copying it. The engine only writes to the workspace when the user runs `pasco refine`
and picks a variant.

Private by default (GitHub private repo or local git). Never part of the public product repo.

## 10. templates/ in the product repo — clarification

Two different "templates" (previous confusion):

- `templates/playbooks/` — per-platform **deploy playbooks** (copy-paste steps, verification) that the
  product ships; referenced by `manual` renderers.
- `templates/profile-data/` — **pointer** to the per-user workspace skeleton repo (§9). It is
  on-ramp A (template), not built-in; the local on-ramp B is `pasco init`.

## 11. i18n strategy

- **Repo docs/README/SPEC**: EN (open-source lingua franca). User-facing summaries may be ES/FR.
- **CLI output**: EN with `--lang` for generated texts.
- **Project page**: the landing is EN with a Spanish mirror at `/es/` (decision #280-B, issue #308) —
  reciprocal `hreflang` (`en` · `es` · `x-default`) and the same alternates in `sitemap.xml`. The
  mirror carries **no version claim**: the release claim lives on the EN landing and in the projected
  docs, and repeating it on a second page is a second place to forget every release
  (`scripts/site-check/version-check.mjs` enforces the claim-free surface for the two canonical claim
  forms — the `@<pkg>@<version>` string and JSON-LD `softwareVersion` — not for free prose). Docs stay
  EN except `docs/ROADMAP.md`, the declared Spanish document (`lang: "es"` in
  `scripts/site-docs/site-config.mjs`); a full ES corpus would need its own parity gate and is not shipped.
- **Content**: every text field is `{ lang: value }`; EN required (recruiters), ES native, FR optional.
- **Proper nouns are invariant**: organization/institution names (`org`, `institution`), venue names
  and people names are **never a langMap** — they are plain strings, identical in every language.
  Only descriptive text (role, degree, field, statement, bios, highlights) is localizable.
  Rationale: a name is a fact (D4) — translating it changes the fact and breaks GEO consistency (D7).
- **Per-platform language policy**: e.g. Upwork overview EN-first (international clients), LinkedIn
  per-target-market; the skill for each platform documents the language policy.
- **Validation**: a schema rule requires at least one `lang` per text block; `pasco validate` enforces.

## 12. Roadmap

1. **M1 (now)**: spec + profile-data template (done) + schema v1 ✅ (`schema/profile.schema.json`) + core (validate/drift/geo) + CLI skeleton ✅.
2. **M2**: renderer `github-readme` + CI + dogfood (Christian's real GitHub README) — detailed in §15.
3. **M3**: SOTA research per platform (GitHub→LinkedIn→Upwork→X→ResearchGate→Substack) → skills v1 + `pasco refine`.
4. **M4 (presence surfaces — profile bodies)**: renderers linkedin/upwork/x/researchgate/substack + playbooks + `pasco check` + checks.yaml per skill + per-entry deploy ledger (D18 — `deployments` + `pasco status`: deploy state becomes data, CHECKLIST becomes a generated view) + profile-completeness checklist and `%` (§20, issue #102 — `completeness()` in core, `pasco status --completeness`, the `github-readme` progress line).
5. **M5 (presence consumption — web renderer)**: web renderer (cv-cluciani consumes generated profiles), template release, CONTRIBUTING. **Scope boundary:** M5 is a **consumption** renderer — it renders profiles that already live in a workspace (§9); it is **not** a hosted onboarding. The hosted on-ramp stays a **v1 non-goal** with an explicit reopening trigger (§2, issue #122).
6. **M6 (brand flavor)**: schema v1.1 brand additions (§17) + `pasco init --flavor brand` + renderer `github-org` + handle-matrix checks + `skills/github-org/` + dogfood `profile-data-topia` (private).
7. **M7 (evidence core)**: schema v1.4 — `credentials[]`/`artifacts[]` + cross-refs (§18) · `pasco check`: `credential-expiry`, registry live-links, `no-private-in-public-output` · JSON-LD `hasCredential` · compact registry section in `github-readme` · template: `media/` scaffold + `docs/evidence-packs.md` + power-user symlink/stow doc (issue #48).
8. **M8 (media pipeline)**: full `assets/` renderer-output definition (byte-stable, checksummed bundling — Q9 resolved as D19: one `assets/` dir per platform output) · deploy playbooks publish media to the public surface · git-lfs guidance · portfolio-site consumption lands **with M5** (the web renderer does not exist yet — engine-side contract ships first).
9. **M9 (training-time corpus presence — deferred, Q10)**: outputs are designed not only for inference-time citation (GEO, layer 2) but — for owners who explicitly consent — for entry into future model training corpora (layer 3). Inputs + documented levers: `docs/research/03-training-time-visibility.md` (sourced + dated). Floor regardless of the Q10 resolution — **private-first default**: `robots.txt` on published surfaces **blocks** AI-training crawlers (CCBot / vendor AI crawlers) and user data ships **without** an open license; entering corpora or open-licensing data requires the profile owner's explicit opt-in (consent field — schema work deferred with Q10). The operator's own profiles may opt in: that consent is theirs to give. The floor has an artifact as of
2026-10-27: `pasco export ai-policy` (§7.3, issue #290) generates `robots.txt` + `llms.txt` +
`AI-POLICY.md` from the `ai:` block of the platform registry, and refuses a UA list that is unsourced or
older than 180 days. Decision (Q10): a `huggingface-dataset` renderer/exporter vs contributing to existing open datasets vs both — decided when the M3 platform SOTA research closes.
10. **M10 (fact selection, D22/§21 — issue #235)**: `.pascorc` → `selection.views` + `selectFacts()` in core + `build --view` + `status --selection` + the five selection findings; Phase 1 is **schema-free** (selection by §19.2 key, and `artifacts[].tags` finally read as §18.9 declared). Phase 2 adds optional `tags[]` to six entry blocks (not `skills`); **Phase 3** (several views per platform, `profiles/<view>/`) needs a D19 amendment and stays out of scope until asked for.
11. **Answer-engine surface (schema v1.10 — issues #288 → #289 → #287)**: `identity.definition` + `faq[]` (the citable facts, #288) · the `structuredData()` projection **of `definition`/`faq[]`** ✅ shipped (#316: `description` from `definition` + a separate `FAQPage` JSON-LD node, only when the fields exist) · geoCheck v2 citability codes (#289 — ✅ shipped, freshness INFO, honest name-collision) · `pasco entity --json/--jsonld` (#287 — ✅ shipped, §7.2), the entity projection for surfaces the engine does not render: it emits `structuredData()`'s own output, never a second assembler.
12. **M11 (presence audit — issue #283)**: `pasco audit --json` (§7.1) — the offline findings projection (three fixed classes, exit 1 on FAIL) over `load`/schema, `reconciledDrift`, `geoCheck`'s `faq-coverage` premise, the completeness `evidence` premise and the `fact-present` rule; `fact-present` executes in `pasco check` and compares the artifact `pasco build` last wrote against the SSOT render symmetrically. Scoring/prioritisation/branding stay in the consuming layer; the presence unit itself is **D23 (§5, §22, #262)** — every surface carries a `kind`, `releases[]` is the event, and `pasco presence` / `pasco release plan` derive the fan-out from the §19 ledger.

## 13. Resolved decisions (former open questions)

- **Q1 → D11 (RESOLVED):** refinement is **agnostic agent-driven** — works with any agent
  (AionUi, OpenHands, Claude Code, Cursor…). No closed CLI picker; the agent (running `pasco refine` or
  the platform skill) produces variants, the user picks, the chosen variant is committed.
- **Q2 → D12 (RESOLVED):** drift-check **warns on facts, fails on schema** — users may legitimately
  have different intents per platform; facts warn (visibility), schema violations fail (integrity).
- **Q3 → D13 (RESOLVED):** model-agnostic by default — uses the executing agent's model. When `sah`
  (sovereign-agentic-hub) matures, revisit as default path.
- **Q4 → D14 (RESOLVED):** **separate workspace** `profile-data` (a folder; a repo is the
  recommended home, not a requirement — §9, amended by #200); integration by **configured path**
  (`.pascorc → workspace`), no symlink in the normal flow; symlink mount only as engine-CI option.
- **Q9 → D19 (RESOLVED, M8):** the deploy bundle is **one `assets/` dir per platform output**
  (`profiles/<platform>/assets/`), not a shared content-addressed store. The
  `profiles/<platform>/variants/` subtree is the exception: it is the chosen-variant
  INPUT (#238), preserved by build, never generated. Deploy surfaces are
  separate repos (D9/D14) — a shared store has no home; each renderer output is self-contained
  (README + its assets travel and verify together); targets are human-reviewable in deploy diffs
  (`assets/<id>/<basename>`); `assets/manifest.json` records the compile-time sha256 per asset.
- **Q11 → D22 (RESOLVED, 2026-10-19, issue #235):** **fact selection per rendered profile** — the
  operator ratified **subset-only** with a mandatory **warn on every omission** (G1, as amended);
  G2–G6 at their recommended values: policy in `.pascorc`, vocabulary `views`, Phase-2 tags on six
  entry blocks, Phase 3 deferred, unknown key/view = error. Contract: §21. Trace: the issue comment.

## 14. Open questions (remaining)

- Q5: Substack adds a *content* surface (newsletter) beyond profile fields — the brand flavor
  ships `newsletter` as a block (§17); the person-flavor newsletter *issue* surface stays open.
- Q6: CI-as-a-service for user workspaces (symlink mount) — worth it in v1 or later?
- Q7 (**idea, not a decision**): `profile-me` — a command/skill/experience layer that APPLIES the
  engine to the user's `profile-data` to produce results (today: `pasco build`/`pasco refine`);
  productized as a single user-facing flow. Name reserved in the profile-* family.
- Q10 (**idea, decision deferred**): training-time corpus presence — publish compiled profiles as an
  open Hugging Face dataset (renderer/exporter) vs contribute to existing open datasets vs both.
  Levers + evidence: `docs/research/03-training-time-visibility.md`; decide when the M3 platform
  SOTA research closes. **Consent-first**: any corpus publication or open-license grant is an
  explicit owner opt-in (private-first default — M9 floor).

(Q10 — training-time corpus presence — OPEN, deferred post-M3; the §12 M9 private-first floor
applies regardless of the resolution.)


(Q9 — deploy-bundle format — RESOLVED as D19, §13: one `assets/` dir per platform output.)

## 15. M2 — `github-readme` renderer (detail)

M2 delivers the **first deterministic, deployable artifact** of the engine: the GitHub profile
README, rendered from the SSOT and deployable via git (D9 — `deploySpec: 'git'`). It is also the
dogfood: Christian's real profile README (`ChristianLuciani/ChristianLuciani`) becomes generated
output, not hand-maintained prose.

### 15.1 Goals

1. A deterministic renderer `github-readme` — `compile()` slice → `README.md` (plus optional
   `assets/`), pure function of the workspace (same input → same bytes, byte-stable).
2. Deploy via git: renderer writes `profiles/github-readme/README.md`; a script/CI copies it to the
   profile repo and commits (deploy = git push; human merges, per repo-governance).
3. GEO by construction: `schema.org/Person` JSON-LD embedded (LD+JSON), canonical links as
   `sameAs` (SPEC §8/geoCheck structured-data readiness), facts verbatim from the SSOT.
4. Dogfood acceptance: Christian's real workspace (private `profile-data`) renders a README
   that contains every fact from the CV SSOT with zero drift warnings.

### 15.2 Interface (deep module)

```ts
interface Renderer {
  id: 'github-readme';
  render(p: PlatformProfile, opts?: { lang?: Lang; assets?: readonly MediaAsset[] }): { text: string; assets?: string[] };
  deploySpec: 'git';               // D9: output lands in a git-tracked file
}
```

`render()` is a **pure function**: no network, no AI, no randomness. It consumes the
`PlatformProfile` slice produced by `compile()` (SPEC §7) — facts pass through untouched, texts
are the platform+lang slice.

**The `assets?: string[]` slot (M8/D19).** The renderer declares the deploy-relative asset
targets its text references (`assets/<id>/<basename>` — `artifactAssetTarget`, the single
derivation). The build owns the I/O: it collects the media bundle (`collectMedia` — public
`path` locators only, sha256 + bytes recorded at compile), copies exactly the referenced
targets into `profiles/<platform>/assets/`, and writes `assets/manifest.json`. The renderer
receives the bundle via `opts.assets` and links ONLY bundled targets — absent → path locators
stay link-free (byte-identical to the pre-M8 output). Renderers never touch the filesystem
and never emit a workspace-internal path (D14). Markdown hrefs are percent-encoded
(spaces/parens break CommonMark destinations) and link text backslash-escapes `\`, `[`
and `]` — the backslash first, because it is the escape character and must survive the
round-trip (a raw bracket closes the label early); the manifest and the declared target
keep the raw filesystem-relative path.

### 15.3 Output spec (`README.md`)

Ordered, deterministic sections (all text from the SSOT; nothing invented by the renderer):

1. **Header**: name (H1) + platform headline (`headlines[]`, github-readme, lang) + canonical link
   badges (`identity.links` — ORCID, Zenodo, SSRN, scholar, … as shield.io badges).
2. **Statement**: `positioning.statement` (lang) — the one-line root.
3. **Featured projects** (top 6 — issue #257 reconciled the slice: the renderer cuts at 6, all if fewer;
   status-led — decision recorded 2026-10-21, `main@647c510`; measured on the dogfood corpus
   `profile-data@d9d2278` (2026-10-24): 10/10 carry `status`, none `archived` — the rank's tail is
   contract-declared and test-covered): the `status` RANK leads (`active` > `maintained` > `experimental` >
   `planning` > `archived`; absent ranks last — an un-graded project cannot outrank a graded one), the
   `skills[].platformWeights[github-readme]` weight is the tiebreak, the name closes in UTF-16 code-UNIT
   order (JS `a < b` — deterministic, ICU-free; not codepoint order on the astral edge; a localeCompare would
   be ICU-dependent — D19; since #305 the name-tied comparisons live in ONE home, core's `byteOrder`
   (every sort the engine writes with a comparator delegates there; the remaining sorts are JS's default,
   already UTF-16 code-unit order by the language): name, status, description (lang), links, evidence (verified claims).
4. **Publications** (citable): title, venue, year, DOI link. DOI-only entries (the GEO anchor).
5. **Skills** (ordered by weight; the name tie closes in core's `byteOrder` UTF-16 code-unit order, #305):
   `name` + keywords, from the SSOT. No invented prose.
6. **Links**: `identity.email` first (a contact fact leads, channels follow — `- [Email](mailto:…)`),
   then **every** `identity.links` entry as the visible link list (humans want all channels), then
   the JSON-LD `Person` assembled by core (v1.6/§15.4: `@id` from the `role: identity` link,
   `sameAs` = the `role: realization` links + claimed handles — page-URLs-only, never the email;
   the email surfaces as the JSON-LD `email` property, v1.5/#71).
7. **Completeness** (issue #102): one deterministic line
   `Profile completeness: <pct>% — <satisfied>/<total>` from the report `compile()`
   attached to the slice — the renderer emits it verbatim and never recomputes it
   (§20; absent report → no line, byte-identical to the pre-#102 output).
8. **Footer**: generated marker `<!-- generated by profile-as-code pasco build github-readme -->` +
   fact-count (deterministic, for diff/CI assertions).

**Project publication truth is derived, never stored** (v1.12, issue #333). A project row may
name the work behind it (`projects[].artifactRefs` → `artifacts[].id`), and publication is then
computed from the registry: *a project is published ⟺ it has a ref to an artifact with
`visibility: public` AND `locator.url`*. There is no `published: true`, no `stage` enum and no
new `status` value — `status` is lifecycle activity (D11) while publication is a property of the
referenced artifact (§18.1/§18.5), and a stored flag would drift the moment the artifact moves
(§20.1's derived-never-stored rule). The engine stores the edge; the consumer derives the badge.

The `visibility: public` conjunct is **enforced, not merely observed**: §18.5 makes a ref to an
`unlisted`/`private` artifact fail `check`, so a row that is in development carries no ref (its
work is not yet publishable). The gate and the derivation agree, and the predicate stays total
for a consumer. **"Published" has two owners on purpose:** §19/§20.1 answer the *deploy* question
(is the published artifact the one the SSOT produces today?), this rule answers the *registry*
question (is there a public artifact behind this project?). Different axes, different owners —
neither is a score.

### 15.4 Drift/GEO contract

- The renderer NEVER outputs a URL outside the **URL SSOT**: `identity.links` plus the proof
  layer's pointer fields — `credentials[].verifyUrl`, `artifacts[].locator.url`,
  `publications[].doi`, `press[].url` (the drift rule; extended by D17/§18.4) — plus the
  contact email's **output-only** `mailto:` href (v1.5/#71: a derived fact href emitted
  from `identity.email`, §15.2 — not a URL SSOT source; `sameAs` never carries it).
- **Link roles (v1.6 / #103).** `identity.links[]` items carry an optional `role`,
  because `schema.org` distinguishes what a link *is* from what it merely *indicates*:

  | `role` | maps to | authority | eligible for `@id` |
  |---|---|---|---|
  | `identity` | `schema.org:url` — "the page is in some sense 'his'" | strong | **yes** |
  | `realization` (**default**) | `schema.org:sameAs` — "indirectly indicates" | weak | no |
  | `aggregator` | `schema.org:mainEntityOfPage` — aggregates references | medium | no |

  `role` is a **translation layer** of this engine (see `identeco-cifereca`, `glossary/naming.md`)
  — never presented as standard vocabulary. **Scope note:** the `aggregator` →
  `mainEntityOfPage` mapping is *declarative only* in v1.6 — the role makes such a link
  ineligible for `@id` and excludes it from `sameAs`, but no renderer emits a
  `mainEntityOfPage` property yet (the web renderer, M5, is its consumer). Do not read the
  table as "this ships in the JSON-LD today".

  Absent `role` = `realization`, so **no workspace needs
  editing** to keep validating (dev-methodology §3: additive). **It is NOT output-neutral**, and
  the honest accounting is three declared changes: (a) the `github-readme` JSON-LD gains
  `jobTitle`/`worksFor`, which the renderer never emitted although `geoCheck` computed them
  (the most-recent role: `start` descending in core's `byteOrder` order — dates are digits, so
  it is also locale-stable; #305);
  (b) both renderers' `sameAs` now excludes `role: identity`/`role: aggregator` links, and the
  shared `sameAs` builder adds claimed `socialHandles[].url` (a growth for person workspaces that
  declare handles); (c) `geoCheck` adds `geo/entity-id`, so a workspace declaring no
  `role: identity` loses up to 5 points — a *reported gap*, not a regression: it names an anchor
  that was never emitted.

- The JSON-LD `sameAs` set = the `role: realization` links (+ claimed handles) — **never** the
  `role: identity` or `role: aggregator` ones, whose membership in `sameAs` would blur the
  hierarchy the standard defines. The contact email (v1.5/#71) is **not** in `sameAs` — it maps
  to the `email` property (a `mailto:` URI is not a reference page); its only rendered form is
  the Links row.
- **Nationality (v1.13 / #334).** When `identity.nationality` is declared, the Person entity
  JSON-LD gains `nationality: { "@type": "Country", identifier: "<code>" }` — the alpha-2
  **code** is the fact, not a country name. Person-only by schema.org's model: the
  Organization (brand) branch never emits it. It is optional and sits outside both the
  `ready` gate and the completeness ratio, so a workspace without it emits and scores
  exactly as before.
- `@id` = the URL of the `role: identity` link. When several carry it, the **first one wins**
  (declaration order): the user marks which link is their entity, and the engine does not
  second-guess that with a hostname heuristic (an earlier draft ranked "own domain over social
  network" and was deleted — it meant carrying a second, hand-maintained platform list beside
  `PLATFORMS`, and making a product judgement inside a regex). When none does, `@id` is
  **omitted — but the JSON-LD is still emitted** for an entity with a name. Suppressing the
  block would strip structured data from every pre-v1.6 workspace (which declares no `role`),
  i.e. the feature would remove signal that already worked: the `@id` is the improvement, not
  a precondition for emitting the entity. `geoCheck` reports the missing anchor as
  `geo/entity-id`, naming the actual situation — a declared-but-ineligible aggregator/
  realization is reported as such, never as "nothing declared". **Note the two rules are not
  in tension:** "missing data is neutral" (§8) governs *fact* checks (a sparse profile is not
  penalized for what it does not claim); `geo/entity-id` is a *readiness* check, so it does
  score 0 when the anchor is absent — which is why upgrading costs up to 5 points (delta (c)).
- **Answer-engine surface (v1.10 / #288, consumer half #316).** `structuredData()` emits
  `description` from `identity.definition` — Person: only when declared (never invented),
  brand: `definition` wins over `mission` in the same emission slot (a definition-less brand
  keeps the v1.9 mission output byte-identical). It also assembles the separate
  `FAQPage` node (`StructuredDataReadiness.faqJsonLd`) iff root `faq[]` exists — never an
  empty FAQPage, and **no `@id`** (the engine never invents an anchor, the same rule the
  entity node follows; a fragment convention is not a declared decision). The node is a
  different schema.org `@type`, so it is never folded into `jsonLd`; a row's declared
  `faq[].source` travels as `Answer.citation` (the pointer stays with the answer it
  backs). Person `description` joins the `considered` list — **fixed denominator 8** —
  and is populated only when declared (the honest 7→8 delta, same class as the v1.6
  entity-id move: upgrading CAN move the number). **No consumer emits `faqJsonLd` yet**:
  both renderers embed `jsonLd` and `pasco entity` projects the entity node, so the
  emitted node is the readiness surface the M5 web renderer will consume — the
  consumer/renderer follow-up is declared, not opened here (ADR-025: issuing it needs
  the operator's OK).
- Entity assembly lives in **one** place: `core/src/structured-data.ts` — the single source for
  `@id`, `sameAs` and the entity fields, consumed by `geoCheck`, every renderer and
  `pasco entity` (§7.2). Renderers and the CLI never re-derive structured-data identity (the
  §18.9 `credentialLdEntries` precedent, applied).
- Facts (dates, DOIs, roles, counts) appear byte-identical to the SSOT — that is citability (§8).

### 15.5 CI + dogfood acceptance

- Engine CI: renderer unit tests (fixtures, byte-stable output) + a CI check that builds the README
  from the minimal fixture and diffs it.
- Dogfood: `profile-data` (private) → `pasco build github-readme` → PR to
  `ChristianLuciani/ChristianLuciani` (human merges). Drift check on the real workspace must
  report 0 fact-contradiction warnings.
- First-render acceptance: Christian reviews the generated README vs the CV site — every fact
  present in both surfaces, byte-consistent where overlapping.

### 15.6 v1.1 schema notes (RESOLVED — schema v1.1, 2026-08-16)

The v1 gaps are closed additively in `schema/profile.schema.json` v1.1 (semver minor —
every v1 workspace still validates):

- `publication.authors` + `publication.url` (preprints/abstracts without DOI are representable).
- `identity.handle` + `identity.timezone`.
- `experience.role` as langMap (bilingual titles) — v1 strings remain valid (`anyOf`);
  `experience.org` stays a plain string: **proper nouns (org, institution, venue) are
  invariant across languages** — never a langMap (names are not translated, §11).
- `experience.highlights` as string[] per lang (langMapList) — v1 separator-delimited
  strings remain valid (`anyOf`).
- Root `education[]` (formal education, `education.yaml`) and `languages[]`
  (`languages.yaml`) — v1 workspaces keep education inside `experience[]`.
  `education.institution` is a plain string (proper noun); `degree`/`field` are
  localizable descriptors (`anyOf` string|langMap).
- `patreon` added to the checks platform enum (consistency with the platform set).

Regenerate the Zod contract with `pnpm gen:zod` (packages/core — generated, never hand-written).

## 16. M3 — platform skills + `pasco refine` (detail)

M3 delivers the **communicative layer** (D4/D5): skills per platform that an executing
agent applies to the SSOT data to produce prose variants the user chooses. The deterministic
renderer (M2) stays as the ground-truth layer; the skill is the judgment layer.

### 16.1 Skill structure (per platform)

```
skills/<platform>/
├── SKILL.md            # frontmatter (model needed, projection) + communicative strategy
├── research/           # SOTA-<year>.md — dated, evidence-tagged sources
├── playbook.md         # deploy steps + post-deploy verification
└── checks.yaml         # machine-readable criteria for `pasco check` (rule catalog)
```

First platform: **`github-readme`** — the only 100% git/API-deployable surface.

### 16.2 Refine flow (D10/D11/D13 — agnostic agent-driven)

1. `pasco refine <platform> [--lang] [--variants N]` emits the agent task: the facts
   (compile slice) + a pointer to `skills/<platform>/SKILL.md`. The CLI never calls an
   LLM and never wires the hub (D13). The skills **ship inside the npm package**
   (`files: ["dist","skills"]`) and resolve from the package root; a repo checkout is
   only the second probe, so an install never depends on the engine repo (#253).
2. The executing agent (AionUi, OpenHands, Claude Code, Cursor, pi…) reads the skill
   and produces N variants in prose — the human picks one.
3. `pasco refine <platform> --choose <variantId>` records the choice in `content/active.yaml`
   (the LIVE variant per platform, D11). The chosen body lives at
   `profiles/<platform>/variants/<variantId>.md` as a **complete platform artifact**
   (for github-readme, a full README). `pasco build` writes it verbatim as the
   platform artifact for that lang, records the variant in the build report, and
   falls back to the deterministic render with a warning when the file is missing,
   empty or for another lang (#238).

### 16.3 github-readme skill — strategy (summary)

- **Pattern**: OSS Maintainer / minimalist-senior (stewardship signal, not CV dump).
- **Structure**: header (name + one-liner + canonical badges) → hook (who + why, prose)
  → what I'm building NOW (2–3 projects with evidence) → stewardship evidence
  (upstream PRs, papers) → stack as signal (4–6 techs) → ONE CTA → visual footer.
- **Aesthetic**: dark-first, restraint (one stats widget max, no typing animations),
  `<details>` accordions for secondary material, centered header, no decorative emoji.
- **Integrity**: facts byte-identical to the SSOT; URLs only from `identity.links`;
  GEO anchors woven naturally (no stuffing).
- **Sources**: `skills/github-readme/research/SOTA-2026.md` (dated, evidence-tagged).

### 16.4 Dogfood acceptance (M3)

Christian's profile README becomes a **curated prose variant** (chosen by him) recorded
as active — the deterministic build stays as the verification snapshot. The generated
README no longer ships as the final page; the skill-produced variant does.

## 17. Brand flavor (`flavor: brand`) — M6 detail

D15 resolves Q8: `profile-brand` is not a separate product — it is the **brand flavor** of
this engine. First brand workspace: **Topia** (`profile-data-topia`, private; editorial
newsletter/press "de la distopía a la utopía", `@topiapress` on X/Bluesky, `topia.press`).
The brand tracks its handle matrix today by hand in docs — the exact drift problem the
engine solves (issue #25).

### 17.1 What changes vs the person flavor

1. **Schema (v1.1, additive — every v1 workspace still validates):**
   - `flavor: person | brand` at root (default `person`).
   - `identity` org variant: `orgName`, `logo`, `brandVoice` (tone matrix), `mission`,
     `tagline`, `established` — all optional; person-only fields (`experience`,
     `publications`…) stay optional and map naturally (essays/issues, not CV items).
   - Brand blocks: `socialHandles` (platform → handle + `status: claimed|pending`),
     `newsletter` (Substack/Ghost), `podcast` (Spotify/RSS), `press` (media mentions),
     `audiences` (reader profile, not recruiter).
   - Proof layer (v1.4, D17/§18) applies to brands verbatim: `credentials[]` (ISO
     certifications, awards, patents) and `artifacts[]` (logo kits, product galleries) —
     `schema.org/hasCredential` is defined for `Organization` as well as `Person`.
   - Checks catalog gains `handle-claimed` and `handle-consistent`.
2. **GEO:** brand workspaces emit `schema.org/Organization` JSON-LD with
   `sameAs` = the `role: realization` links + claimed `socialHandles[].url` (v1.6/§15.4; before
   v1.6 this was every `identity.links` entry); `logo`/`foundingDate`/
   `slogan`/`description` map to `identity.logo`/`established`/`tagline`/`mission`; the
   contact email (v1.5/#71) maps to `identity.email` → Organization `email` (same as
   Person — parity).
3. **CLI:** `pasco init --flavor brand` scaffolds the brand skeleton; `pasco check` runs the
   handle-matrix rules (offline, deterministic); `pasco build github-org` renders the org
   README (deploySpec `git`).
4. **Skills:** `skills/github-org/` — brand voice ≠ personal voice, handle-consistency
   checks, trademark/impersonation considerations (e.g. `topia.com` is an unrelated live
   company; the brand always signs as "Topia Press").

### 17.2 Multi-workspace by design

`.pascorc → workspace` (D14) already gives each identity its own repo: a brand workspace
lives in its own private repo (`profile-data-topia`), scaffolded with
`pasco init --flavor brand`, and is never mixed with the personal workspace. The engine
is agnostic — flavor is just data.

### 17.3 Dogfood acceptance (Topia)

First brand workspace = Topia (private), seeded from the operator's brand-handles matrix
(availability sweep verified 2026-08-18). Acceptance: `pasco validate` reports **zero drift
warnings** on the handle matrix, `pasco build github-org` renders the org README with every
claimed surface, and `pasco check` confirms `handle-claimed`/`handle-consistent` across the
matrix.

## 18. Evidence registry — credentials & artifacts (M7/M8 detail)

Profiles are believed when they are proven. D17 adds the **proof layer** (issue #48): a
pointer-first registry of typed entries living in the workspace (SSOT), consumed by
renderers under a fixed capability matrix. Design rule: **the workspace declares pointers;
the engine never owns the binaries** — D14 applied to media.

### 18.1 Concept: claim ≠ credential ≠ artifact (naming discipline)

The word **evidence stays claims-only** (§9.1 single-source naming):
`projects[].evidence[]` is a textual assertion + source URL (unchanged). The new blocks
are never called "evidence":

| Concept | Block | What it is | Example |
|---|---|---|---|
| Claim | `projects[].evidence[]` (existing) | textual assertion + source | "raised $2M seed" → TechCrunch link |
| Credential | `credentials[]` (new) | third-party attestation | AWS certificate, university degree, award, patent |
| Artifact | `artifacts[]` (new) | a work or media item | portfolio, photo gallery, showreel, dataset |

Canonical blocks keep their domains — **no duplication**: `publications[]` (papers, DOI),
`press[]` (D15) and `projects[]` are NOT registry kinds; they reference registry ids
(`artifactRefs`). The registry is the home of what had none. The third site is `projects[]`
(v1.12, issue #333): a project row names the work behind it, which is what lets a consumer
derive published-vs-in-development from `artifacts[]` (§15.3) instead of storing a flag.

### 18.2 Schema (additive, v1.4)

Root additions — both optional, `additionalProperties: false` preserved, Zod regenerated
(D3). Illustrative sketch:

```yaml
credentials:
  - id: cert-aws-ml                    # referenced by evidence items / renderers
    kind: certificate                  # certificate | title | award | patent
    title: "AWS Certified ML - Specialty"   # proper noun → plain string, invariant (§11)
    issuer: "Amazon Web Services"      # invariant (§11)
    credentialId: "ML-S-1234"          # optional
    verifyUrl: "https://aws.amazon.com/verification?..."   # THE verification pointer
    issued: 2024-05-01                 # YYYY-MM-DD; month precision allowed (§6 date)
    expires: 2027-05-01                # optional → `credential-expiry` check warns when past
    visibility: public                 # public | unlisted | private (§18.5)

artifacts:
  - id: reel-2025
    kind: showreel                    # portfolio | gallery | showreel | dataset | document | code
    title: "Reel 2025"                 # proper noun → invariant
    description: { en: "…", es: "…" }  # langMap, EN required (§11)
    locator: { url: "https://vimeo.com/…" }   # §18.3
    checksum: "sha256:…"              # immutable artifacts only (§18.6)
    license: "CC-BY-4.0"              # optional — third-party media usage rights
    tags: [film]                       # multi-area selection (§18.9)
    visibility: public
```

Cross-refs (additive, all optional): `evidenceItem` gains `credentialId`/`artifactId`;
`publications[]` and `press[]` gain `artifactRefs: [id]` (v1.4); `projects[]` gains
`artifactRefs: [id]` (v1.12, issue #333). Every site resolves against the same registry:
a dangling id fails `load()` and a non-public target fails `check` (§18.5).

### 18.3 Locators — the capability matrix

`locator` is `{ url }` or `{ path }`. Engine actions are **fixed per locator type** — this
is what protects byte-stability (§15.1) and the URL SSOT (§15.4/§18.4):

| Locator | Emit in render | Copy to renderer `assets/` | Verify |
|---|---|---|---|
| `url` (remote) | yes — URL verbatim if in the URL SSOT | n/a | live-link check (`pasco check`, M3/M4) |
| `path` in-workspace | never an absolute/raw URL; a **bundled** path locator links its deploy-relative target `assets/<id>/<basename>` (resolves on the public deploy surface, M8/D19); unbundled → no link (§15.2) | yes — sha256 recorded at compile, byte-stable | `media-missing-workspace` (error), declared-checksum verify |
| `path` external (`PASCO_EVIDENCE_ROOT`) | never an absolute URL | local-only — bundles when the file is on the machine; CI-degradable without a checksummed mirror (§18.3 note below) | existence + checksum (local, warn-class) |

Media in a public render travels through the renderer `assets/` output to the deploy
surface (§18.6) — never a private raw URL. A deploy-relative `assets/…` link is NOT a
private-repo URL: it resolves only after the deploy playbook commits the platform output
to the public surface.

### 18.4 URL SSOT (extends the drift rule, §15.4)

**Emitted URLs ⊆ `identity.links` ∪ `credentials[].verifyUrl` ∪ `artifacts[].locator.url`
∪ `publications[].doi` ∪ `press[].url`.** Registry URLs are SSOT members: they feed
badges and structured data verbatim; the renderer never invents or reformats them.

### 18.5 Visibility & privacy

`visibility: public | unlisted | private` on both blocks. Renderers emit only `public`;
`unlisted` is shared on request (client DMs), `private` never leaves the workspace.
`pasco check` rule `no-private-in-public-output` fails the build on a leak — it covers
every reference site (evidence claims, `publications[].artifactRefs`, `press[].artifactRefs`,
and `projects[].artifactRefs` since v1.12), so adding a site cannot silently bypass it. Rationale:
credentials carry PII (full legal name, IDs) — not every proof is for the open web.

### 18.6 Media transport (M8)

- **Optional `media/` folder** in the workspace (template scaffolds it empty + rules):
  per-domain subfolders (`certificates/`, `photos/`, `press/`). For the small and
  versionable; size guidance: warn > 50 MB, GitHub hard limit 100 MB → git-lfs or
  external hosting + `url` locator.
- **Private workspace ⇒ no hot-linking**: the pipeline is workspace `media/` → renderer
  `assets/` output (checksummed at compile — this defines the `assets?: string[]` slot
  of the renderer interface, §15.2) → deploy playbook copies to the public surface.
  Same pattern as `profiles/`: generated outputs, committed to the deploy repo.
- **Bundle contract (D19, Q9 resolved)**: one `assets/` dir per platform output. Targets
  are `assets/<id>/<basename>` (per-artifact dirs — ids are core-checked unique, so
  targets are collision-free and reviewable). `collectMedia(profile, workspace)` is the
  single bundler: public `path`-locator artifacts only, sha256 + bytes computed and
  verified against a declared `checksum` (mismatch = error), deterministic order (sorted
  by id). The build rebuilds `assets/` clean each run — the output dir stays a pure
  function of the workspace (§15.1). `assets/manifest.json` records what was bundled
  (version, platform, lang, per-asset id/target/sha256/bytes/origin) — the compile-time
  checksum record, byte-stable.
- **Locator resolution**: a `media/…` path is workspace-relative (the SSOT; missing or
  unsafe file = error — `pasco check` fails); any other path resolves under
  `PASCO_EVIDENCE_ROOT` (env) or the **gitignored** `.pasco/local.toml` override —
  per-machine state, never committed (the D14 lesson applied to config). Resolved paths
  must stay inside their base (containment guard — error). External missing root/file =
  warn (local-only, CI-degradable). Engine-side detail: `docs/media-pipeline.md`.
- **Deploy playbook (media)**: `pasco build github-readme` writes `README.md` + `assets/`
  under `profiles/github-readme/`; the deploy repo commit includes BOTH — post-deploy
  verification confirms the assets resolve on the public surface (same playbook as
  profiles/, one extra step: `git lfs` files are pointer-checked, see git-lfs guidance).

### 18.7 Symlink / stow — power-user convenience, not the mechanism

Git stores a symlink as its target text: absolute external targets break on CI and fresh
clones. Stowing an external media dir into `media/` is allowed as a local convenience,
documented with this tradeoff. It is never the canonical mechanism (D14 demoted symlink
mounts for the workspace; the same stance holds for media). `pasco check` WARNs when
a locator resolves through a symlink outside the workspace without a checksum
(`media-symlink-external` — the media rules live with the §18.8 check execution,
not `pasco validate`).

### 18.8 Checks (M7)

`pasco check` additions — offline, deterministic given the machine date (credential-expiry is a time-keyed warn — reproducible per-day, not across days), skill-declared (`checks[]` rule
strings; no schema change):
- `credential-expiry` — `expires` in the past → warn.
- `live-link` — registry URLs join the existing live-link checks (§3, M3/M4).
- `no-private-in-public-output` — §18.5.
- **Media transport (M8/§18.6, executed by `collectMedia`)**: `media-missing-workspace`
  (error — in-workspace file absent) · `media-path-unsafe` (error — resolved path escapes
  workspace/evidence root) · `media-checksum-mismatch` (error — declared sha256 ≠ bytes) ·
  `media-external-missing` (warn — no evidence root or file on this machine) ·
  `media-symlink-external` (warn — workspace symlink escaping the workspace without a
  declared checksum, §18.7) · `media-oversize` (warn — > 50 MB, §18.6) ·
  `media-unbundled-no-id` (warn — path-locator artifact without id cannot get a stable
  target).

### 18.9 GEO & multi-area

- JSON-LD: `Person.hasCredential` → `EducationalOccupationalCredential` (`issuer`,
  `validFrom`/`validThrough` from `issued`/`expires`). Term status: schema.org "new"
  area, adoption-feedback stage — dated source in the platform skill research ([WEB]
  schema.org V30.0, fetched 2026-09-08). Brand flavor: `hasCredential` applies to
  `Organization` too (§17.1) — ISO certifications, awards.
- Artifacts surface as structured links per platform (`CreativeWork`, `ImageGallery`,
  `VideoObject`, `Dataset`) — emitted by the renderer from SSOT fields, curated by the
  platform skill (D5).
- **Multi-area** (one person, several fields — the operator's case): `tags[]` on
  artifacts; a **view** selects by platform + lang + tags — contract in §21 (D22).
  One workspace, many areas; separate identities remain separate workspaces (D15).

### 18.10 Domain packs — knowledge, not engine code

The template ships `docs/evidence-packs.md`: per-domain checklists of what proof looks
like — designer (portfolio cases, shots), filmmaker (showreel, filmography, festival
laurels, press), scientist (DOI, ORCID, datasets, talks), engineer (repos, demos,
certs) — each mapped to registry kinds and their expected metadata. Per-platform
rendering guidance lives in `skills/<platform>/` (D5). **The engine learns no domains**
(AGENTS.md rule 7).

### 18.11 Milestones

- **M7 (evidence core)**: schema v1.4 (§18.2) + cross-refs · `pasco validate/check`
  (§18.8) · JSON-LD `hasCredential` · compact registry section in `github-readme` ·
  template `media/` scaffold + `docs/evidence-packs.md` + symlink/stow doc · dogfood:
  a workspace renders one credential + one artifact with zero drift warnings.
- **M8 (media pipeline)**: full `assets/` renderer-output definition (byte-stable,
  checksummed bundling — Q9 resolved as D19, §13: one `assets/` dir per platform output,
  `assets/<id>/<basename>` targets + `assets/manifest.json`) · deploy playbooks publish
  media · git-lfs guidance · portfolio-site consumption **with M5** (deferred — the web
  renderer does not exist yet; the §15.2/§18.6 contract above is its consumption seam).
## 19. D18 — per-entry deploy-status ledger (detail)

Raised by issue #37 while writing the user guide (`docs/USER-GUIDE.md`): the deploy loop
tracks status at **platform granularity** only — `active` (D11) records the chosen
*variant*, `pasco diff` reports changed *files* since the last release, and
`CHANGELOG.md` + `CHECKLIST.md` are hand-maintained prose. Nothing answers the operator's
actual question (2026-09-07):

> For **each piece of data**: is this mine (vs template)? Is it published or not yet?
> In which profile is it published and in sync — and which ones are out of date?

D18 makes deploy state **data** (schema-additive, v1.3) with a single owner — `pasco` —
instead of hand-maintained prose the operator must remember to update.

### 19.1 The ledger (`deployments`)

New optional root property in `content/deployments.yaml` (file name = root property, §6):

```yaml
deployments:
  <ledgerKey>:
    <surface>:
      deployedAt: 2026-09-08T10:00:00Z   # ISO 8601 — when the deploy was confirmed
      contentHash: <sha256-hex>          # hash of the trackable unit AT deploy time
      source: manual | git | api        # how it landed (paste confirm vs deploy script)
      certification:                     # v1.10 ADDITIVE (§19.5) — absent = attested
        state: verified | attested | unverifiable | out-of-band-drift
        reason: <string>                 # required for unverifiable / out-of-band-drift
        artifactHash: <sha256-hex>       # v1.10 — THE ANCHOR: artifact digest at confirm time
        method: fetch                    # only when a live check ran (v1: fetch)
        fetchedAt: 2026-10-12T10:00:00Z  # only when a live check ran
        liveHash: <sha256-hex>           # only when a live check produced a digest
        evidenceUrl: <url>               # only when a live check ran — what was fetched
```

- **ledgerKey** — stable, prefixed identity of a *trackable unit* (§19.2).
- **surface** — a platform slug from the ONE enum (D16); schema-validated via
  `propertyNames`.
- **contentHash** — SHA-256 over a canonical serialization (sorted keys) of the **parsed**
  unit — YAML formatting and comments don't affect it, so cosmetic edits never go stale.
  Ledger metadata (`id`, `origin`) is **stripped before hashing**: it is provenance/identity,
  not content — adding an `id` to an already-deployed entry must not flip it `stale`.
  Staleness is therefore **exact and release-tag-independent**: `stale` iff current hash ≠
  recorded hash, with no intersection with `pasco diff` (the diff delta is file- and
  release-tag-scoped; gating staleness on it would hide true staleness whenever release
  tags lag behind real deploys — the common solo case). `pasco diff` stays what it is —
  the release/CHANGELOG view.
- **certification** — the second, ADDITIVE dimension (v1.10, §19.5, issue #132): *how the
  deploy was confirmed* — a deterministic live check (`verified`), the human `--mark`
  (`attested`), or an honest `unverifiable` / `out-of-band-drift`. It is optional so every
  pre-v1.10 workspace keeps validating; a record without it reads as `attested`, which is
  exactly what every record written before v1.10 was (the only ledger writer today is
  `--mark`). When the block is present, `state` is required; the other fields are required by
  state. `artifactHash` is the **anchor** the C1 check compares against, recorded by the write
  that confirms the deploy (v1: `--mark`); without it a fetch can observe but not judge
  (§19.5). Semantics, evidence fields and the rollup live in §19.5 — this block fixes the shape.
  **Schema status — shipped.** The property landed at `d172dffc` under the **v1.9**
  URI (v1.10 completed its version label). `$defs.deploymentRecord` carries the optional
  `certification` property; the `valid-certification*.json` fixtures pass, and a record
  without it reads as `attested`. The contract was stated first on purpose (SPEC-first, D3).
- The ledger is **append/update-only state**: removing a row from `content/` does not
  remove its ledger key (audit trail); `pasco status` reports the dangling key as
  `removed`.
- Exactly **one record per `(ledgerKey, surface)` pair** — the ledger holds *current
  deploy state*. Deploy **history** is not a growing in-file event log: it is the
  workspace's own git history (`--mark` writes the ledger file; the operator commits it in
  the workspace's repo, D2 text-first) — no duplicated event store to drift.

### 19.2 Entry identity (`id`) and provenance (`origin`)

Trackable units and their ledger keys:

| Unit | Ledger key | Identity |
|---|---|---|
| `experience[]` / `projects[]` / `publications[]` / `education[]` / `press[]` rows | `<block>:<id>` | new **optional** `id` (slug pattern, unique per block — uniqueness is core-checked and fails validation; JSON Schema cannot express it) |
| `bios[]` | `bios:<platform>:<lang>:<length>` | natural composite key |
| `headlines[]` | `headlines:<platform>:<lang>` | natural composite key |
| `skills[]` | `skills:<name>` | `name` is the natural key |
| `socialHandles[]` (brand, D15) | `socialHandles:<platform>` | the platform key (D16 enum) |
| `identity` / `positioning` / `keywords` | the block name | the block itself |

Rows **without** an `id` are listed by `pasco status` as *untracked* (add an `id` to track
them). `id` stays optional so every existing workspace validates (additive, semver minor).

Keys are unique **by validation, not by hope** — the ledger must never be ambiguously
addressable (JSON Schema cannot express either check; core runs them post-Zod):
- duplicate **`id` within a block** → always a validation failure (the field is new — no
  pre-v1.3 workspace can carry one, so this can never break a legacy workspace);
- duplicate **composite key** (`bios:*`, `headlines:*`, `skills:*`, `socialHandles:*`) →
  fails **only when the key is addressed by `deployments`** — a legacy workspace may
  legitimately carry two rows with the same natural key today; ambiguity is only a defect
  when something tries to address it (additivity preserved: old workspaces still validate).

**origin**: optional `origin: template` flag on content items. The `profile-data-template`
ships its fictional examples **with** the flag; user-authored entries simply don't have it
(absent = user). `pasco status` flags template-origin entries automatically; editing a
copied template example keeps the provenance (still true — it *is* template-derived).

### 19.3 `pasco status [platform]`

| Invocation | Behavior |
|---|---|
| `pasco status [platform]` | per-unit report: ledger key · origin (template/user) · surfaces published · sync state per surface: `in-sync` \| `stale` (hash mismatch) \| `never` · **certification per surface** (§19.5: `verified` \| `attested` \| `unverifiable` \| `out-of-band-drift`, with the reason), plus the **derived publication truth per surface** (§20.1). Offline and deterministic — the report never fetches |
| `pasco status --mark <ledgerKey> <surface> [--at <iso8601>]` | confirm a (manual) paste — records `deployedAt` + the **current** `contentHash`, `source: manual`, `certification.state: attested`, and — where the surface has a canonical extractor — the **anchor** `certification.artifactHash` (the extractor's digest of the locally rendered artifact at this moment, i.e. what is being attested), so a later `--verify` can judge rather than only observe (v1.10, §19.5); **`pasco` is the one writer** (same rule as `refine --choose`, D14) with **two triggers**: `--mark` and `--verify` |
| `pasco status --verify [platform]` | v1.10 (§19.5): the C1 live check — resolves each fetchable surface's artifact URL, **validates its host against the surface's declared fetch allowlist**, fetches sequentially and without retries, records the evidence, and updates `certification` in place by comparing the live digest against the stored `artifactHash`. **The one network-touching path in the engine, opt-in by construction** (never implicit in `status`/`build`, §15.1) |
| `pasco status --write-checklist` | regenerates `CHECKLIST.md` from the ledger (AUTO-GENERATED header) — the checklist becomes a *view*, not a second source of truth; each surface carries its **certification token**, so an `attested` surface is never rendered as a bare `in-sync` (§19.5) |
| `--json` | machine-readable report, consistent with the other commands; `units[].surfaces` (staleness) is unchanged, and `units[].certification` (per-surface + rollup) is ADDITIVE (§19.5 — existing consumers keep working) |

Fresh-workspace guarantee: an empty ledger reports `never` everywhere and `stale`
nowhere — zero false positives (acceptance, issue #37).

Variant selection (`refine --choose`) **never** writes the ledger: choosing a variant is
not deploying it — the surface keeps the old text until the paste is confirmed with
`--mark` (or a future deploy command writes it on real deploy).

### 19.4 Alternatives considered (why not extend `active`, D11)

**Option B — fold per-entry status maps into `active`** was rejected. `active` answers
*which variant is live* — the contract of `refine --choose`, keyed by platform, with its own
lifecycle (re-refinement). Deploy state answers *where facts/texts landed and when* —
keyed by entry, spanning surfaces, with its own lifecycle (paste/verify/confirm). Mixing
them entangles two write paths and two concepts under one platform-keyed map, and makes the
operator's entry-centric question ("where is this experience row published and stale?")
second-class. A separate additive ledger keeps D11 untouched, and lets CHECKLIST/CHANGELOG
remain *views* of state `pasco` owns.

CHANGELOG.md stays hand-written (the dated *narrative* of what changed); CHECKLIST.md
becomes generated (the *state* of what is deployed) — one less thing to maintain by hand,
one less chance of prose drifting from truth.

### 19.5 Dual certification — deterministic verify + human attestation (v1.10, issue #132)

§19.1's `contentHash` compares the SSOT **to itself**: it answers "did the source move after
the deploy", never "does the live surface still carry what was deployed". `--mark` records a
human assertion — `in-sync` has always meant *the operator said so*, never *the machine
checked* — so an out-of-band edit on a live account is invisible today. §19.5 adds that
dimension without touching the existing one, and the ko-fi measurement below proves
fetchability is not uniform across platforms.

**Two dimensions, orthogonal by construction.**

| Dimension | Question | Values | Basis |
|---|---|---|---|
| **staleness** (§19.1, UNCHANGED) | did the SSOT move after the deploy was confirmed? | `in-sync` \| `stale` \| `never` | `contentHash` vs the current unit hash — offline, deterministic |
| **certification** (new) | how was the deploy confirmed, and does the live surface still match? | `verified` \| `attested` \| `unverifiable` \| `out-of-band-drift` | a C1 fetch pass, the C2 `--mark`, or the surface's declared fetch capability |

`stale` + `verified` is a legal, meaningful pair — the deployed artifact was confirmed live
*and* the SSOT has since moved. The dimensions compose; neither overrides the other.

**Certification states — three confirmation strengths, plus the one negative outcome.**
The ratified decision names three *strengths of confirmation*. The SPEC adds a fourth value
because a completed check that finds a contradiction is not a strength: it is positive
contrary evidence, and folding it into any of the three would make the report lie.

- **`verified`** (C1) — a deterministic pass fetched the live artifact, applied the surface's
  canonical extractor, and the comparison succeeded (the two-hash conjunction below).
- **`attested`** (C2) — the human `--mark`. Certified, but explicitly by assertion: the text
  report and CHECKLIST always print the token `attested`, never a bare `in-sync`.
- **`unverifiable`** — no deterministic check is possible, or one was attempted and did not
  complete. Always carries a `reason`: `walled` · `walled-con-api` · `http-403` ·
  `http-<code>` · `network-error` · `no-artifact-url` · `no-extractor`.
- **`out-of-band-drift`** — a C1 check COMPLETED and contradicts the ledger: the live artifact
  differs from what the engine deployed or last verified (`reason: live-mismatch`). Never
  rendered as `in-sync`, never counted as certified.

**Rollup.** *Fully certified* ⇔ every recorded surface of the unit is `verified` or
`attested`. Per unit: `verified` when every surface is `verified`; otherwise `attested` when
all surfaces are in {`verified`, `attested`} with at least one `attested`; otherwise the most
severe non-confirmed state present, ordered `out-of-band-drift` before `unverifiable`. A unit
with no ledger record has no certification (`null`) — absence is not `never`, which belongs
to staleness.

**Relevant machine surface (`pasco status --json`), additive.** Staleness keeps its exact
shape and keys, so existing consumers are untouched; certification is a new sibling:

```jsonc
units: [{
  // …key, kind, block, label, origin, hash — unchanged…
  "surfaces":   { "<surface>": "in-sync" | "stale" },          // UNCHANGED (staleness)
  "state":      "never" | "in-sync" | "stale",                 // UNCHANGED (rollup)
  "certification": null | {                                    // NEW — null ⇔ no ledger record
    "state":    "verified" | "attested" | "unverifiable" | "out-of-band-drift",
    "surfaces": { "<surface>": { "state": "…", "reason": "…", "artifactHash": "…",
                                 "method": "fetch", "fetchedAt": "…", "liveHash": "…",
                                 "evidenceUrl": "…" } }
  }
}]
```

**Recorded vs derived `unverifiable`.** An `unverifiable` produced by an *attempt* (the pass
fetched and got a non-2xx, the transport failed, or the record carries no anchor) is
**recorded** with `fetchedAt`, `evidenceUrl` and `reason` — the honest degradation is durable
evidence, not a transient print. An `unverifiable` produced by a *declaration* (`walled`,
`walled-con-api`, `no-extractor`, `no-artifact-url`) is **derived at read time from the
surface's declared capability**, so a workspace never needs a ledger row per walled platform,
and the verdict cannot be lost by a stale write.

**Three digests, one comparison.** Three SHA-256 values, each with exactly one meaning, so the
two dimensions never borrow each other's evidence:

- `contentHash` (STORED) — the SSOT revision of the unit at confirmation. Drives **staleness**
  only (§19.1).
- `artifactHash` (STORED, **the anchor**) — the canonical extractor's digest of the surface's
  artifact **as confirmed at deploy time**. It is written by the confirming write (§19.3
  `--mark`; a future deploy command writes it too), because that is the only moment the engine
  can render the artifact it is attesting to. Drives **certification** only.
- `liveHash` (STORED, fetch evidence) — the same extractor's digest of the **LIVE** artifact,
  observed at `fetchedAt` and recorded with `evidenceUrl` and `method: fetch`.

The C1 comparison is `liveHash` ↔ `artifactHash` — **never against a freshly re-rendered
artifact**. That is deliberate: re-rendering the *current* SSOT mixes two questions into one
number ("did the live page change?" and "did the source move?"), which is precisely the
conflation §19.5 exists to remove. Anchoring at confirmation also **removes** the earlier
draft's `expectedHash` entirely — there is no derived value to recompute and no per-record
attribution problem: every record on a surface compares the same live artifact against the
same anchor, and a difference can only mean the live page no longer carries what was deployed.

The extractor is **artifact-scoped, canonical and offline-testable**: it maps published text
to the artifact projection the engine owns, with platform chrome stripped. v1 deliberately
does NOT build a per-unit reverse renderer — that would be a second renderer beside
`github-readme`, and the one-home rule (D5, AGENTS.md rule 7) forbids two renderers for one
artifact. The declared consequence: C1 certifies the **artifact the surface publishes**. The
extractor ships with the surface's renderer adapter — the artifact's producer owns both
directions of it. **The record semantics, the anchor and the staleness hash live in `core`,
offline and platform-agnostic; the fetch and the verdict are CLI orchestration** over those
primitives plus the renderer's extractor, and the fetch is **not** part of `Core` — so
`pasco serve` (D20) does not acquire a network capability.

**The verdict — a total function of (fetch outcome, anchor presence, comparison), per
`(ledgerKey, surface)` record.** Every combination lands somewhere explicit; nothing is
silently inherited:

| Fetch | `record.artifactHash` | `liveHash` vs `artifactHash` | Verdict |
|---|---|---|---|
| fails / non-2xx | — | not computed | **`unverifiable`** + reason (`http-403` · `http-429` · `http-<code>` · `network-error`), **recorded** with `fetchedAt` + `evidenceUrl` |
| not fetchable (declared) | — | — | **`unverifiable`** with the declared reason (`walled` · `walled-con-api` · `no-artifact-url` · `no-extractor`), derived at read time |
| ok | present | equal | **`verified`** — refresh `fetchedAt` / `evidenceUrl`; the anchor is left unchanged (it is the deploy's digest, not a moving cache) |
| ok | present | different | **`out-of-band-drift`** (`reason: live-mismatch`) — independent of staleness |
| ok | absent | not judged | **`unverifiable`** (`reason: unattributed`), recorded with the fetch evidence — an anchor-less record (pre-v1.10, or a confirmation that could not render the artifact); re-confirm with `--mark` to record the anchor, after which `--verify` judges |

Row 4 is the point of the anchor: it fires whether or not the SSOT also moved, so `stale` +
`verified` **and** `stale` + `out-of-band-drift` are both expressible, and neither dimension is
read off the other's comparison. Row 5 is the honest alternative to guessing: an anchor-less
record is *observable but not judgeable*, and the contract says so instead of inferring a
verdict from a render it cannot trust.

**Declared v1 limit — anchors are forward-only.** A record confirmed **before** v1.10 (or on a
surface whose artifact the engine cannot render) carries no `artifactHash`, so row 5 applies:
the pass observes the live digest and **cannot judge** it, and the record reads `unverifiable`
— never `attested`-and-quietly-green. Closing the gap for an existing ledger is one `--mark`
per record, which records the anchor. So the failure mode this dimension exists to close (an
out-of-band edit that staleness cannot see) is covered for **every record confirmed with an
anchor**, and for an anchor-less one it is *reported as unknown* rather than assumed clean —
which is the honest reading, not a silent pass.

Promotion `attested → verified` **updates the same `(ledgerKey, surface)` record in place**,
leaving `deployedAt`, `contentHash`, `source` and `artifactHash` untouched — the staleness
basis **and** the deploy anchor are preserved byte-for-byte, which is what "a mechanical pass
lifts the same key from attested to verified without touching staleness" means concretely.

**Fetch policy and the honest ladder (v1).** The engine never reads a platform to *source*
data — §2's "no scrapers" non-goal is about that direction. C1 reads back the engine's **own
deployed artifact** to verify it landed, which is why it can be honest and bounded:

1. **fetchable (C1 runs) — GitHub raw only.** The artifact URL is *derived* from the
   workspace's **URL SSOT** (§15.4/§18.4 — `identity.links` / declared handles, plus the
   surface), never a new hand-maintained field, and the exact URL fetched is recorded as
   `evidenceUrl` so the claim is auditable. `github-readme` is the first surface;
   `github-org` is the same class.
   **The derived URL is validated against the surface's declared fetch host(s)** (v1:
   `raw.githubusercontent.com`) **before any request**; a URL outside them is refused with
   `unverifiable` + reason `host-not-allowed`, with no request made. This is not ceremony: the
   workspace is untrusted input (templates are cloned from strangers), so without the allowlist
   a crafted `identity.links` entry could aim an opt-in `--verify` at an arbitrary or internal
   host. The allowlist is a declared capability of the surface, beside its extractor — one
   home, not a second platform list.
2. **walled-con-API** — a platform whose raw page is not fetchable but that exposes a
   management API. v1 declares the rung and reports `unverifiable` with reason
   `walled-con-api`; a future pass that uses an API records `method: api`. Not implemented.
3. **unverifiable (walled)** — no honest machine check: reason `walled`. The engine must not
   pretend; `unverifiable` is a first-class, reportable outcome, not an error.

**Rate limits and request discipline.** One request per surface per pass, sequential, with no
retries and no backoff games: `--verify` is a verification, not a crawler, and the pass must
never amplify into traffic a platform can read as abuse. A rate-limited or transient failure
is recorded as the honest reason (`http-429`, `network-error`) and the pass moves on;
re-running `--verify` is the retry, and it is the operator's decision.

Fetchability is **not uniform, and that is measured rather than assumed**: the live fetch of
`https://ko-fi.com/christianluciani` returned **HTTP 403** (Cloudflare challenge) from outside
— `[MI]` measurement in the operator session, 2026-10, carried by issue #130, `[BENCHMARK]`
tier (a measured datum: one observation, one surface). Re-measured from the engine session on
**2026-10-12** in one run, so both rungs are dated against the same instant:
`curl -o /dev/null -w '%{http_code}' https://ko-fi.com/christianluciani` → **403**, while
`curl -o /dev/null -w '%{http_code}' https://raw.githubusercontent.com/ChristianLuciani/ChristianLuciani/main/README.md`
→ **200**. Non-goals enforced by this ladder: no
Cloudflare/TOS circumvention, no browser automation, no credentials or cookies, no
user-agent games, no retry through a bypass. A non-2xx is recorded as the honest reason and
the pass moves on.

**Determinism.** The pass is opt-in (`pasco status --verify [platform]`) and never runs
inside `pasco build`, `pasco validate`, `pasco check` or a plain `pasco status`: byte-parity
(§15.1) and offline determinism (§20's `completeness()`) must not acquire a network
dependency. The **view** is deterministic — reading the ledger never fetches. Tests never
touch the network: fetch is injected/mocked, and a committed `403` fixture pins the honest
degradation (issue #132's acceptance criterion). Network failures are data (`unverifiable` +
reason), never exceptions that break the report. A report of the surface is not a
reachability check: `pasco check`'s planned `url-live` rule asks "does the link resolve",
C1 asks "does the live artifact match the ledger" — different questions, different owners.

**What does NOT change.** Staleness (`in-sync`/`stale`/`never`) and its `contentHash` basis;
the `pasco`-only write rule (the C1 pass IS `pasco`); exactly one record per
`(ledgerKey, surface)`; `deployments.yaml` stays *current state*, with history in the
workspace's own git (the pass writes the ledger file; **committing it is the operator's**, the
same division of labour as `--mark` — D2). §20's completeness is untouched
— its `deployment` item stays **coverage-only**, so certification must never move the `%`
(letting a walled platform lower a score would penalize a fact outside the user's control).
No new required schema field: the addition is optional and semver-minor.

**Alternatives considered.** (a) A **ledger sidecar** — rejected in the issue's ADR-lite: two
homes for one deploy's state guarantees drift. (b) **Overloading `contentHash`** to mean the
live hash — rejected: it would destroy staleness's exactness by conflating two orthogonal
facts on one field. (c) A **separate top-level `pasco verify` command** — rejected in favour
of `status --verify`: it would duplicate the reporting surface and split the one write path
across two commands (the §19.4 one-owner rationale). (d) **Comparing against a freshly
re-rendered artifact** (an earlier draft's `expectedHash`) — rejected: it conflates "the live
page changed" with "the source moved", and it lets an unrelated unit's staleness decide this
record's verdict (an in-sync record on a surface where a *different* unit is stale would be
reported as `out-of-band-drift` — a false accusation). Recording the anchor at confirmation
deletes that branch instead of guarding it. (e) **Per-unit reverse renderers** — rejected
above: two renderers for one artifact.

## 20. Profile completeness — checklist + percentage (issue #102)

Completing a profile is intensive and open-ended, and the schema is deliberately
permissive: `identity` is the ONLY required block (§6). A workspace at 5% and one at
95% therefore produce the same green `pasco validate` — a passing check with no
direction. This section assigns the surface the gap was missing.

The rule is **compute in the engine, store only the policy, render the number as a
generated view** — four layers, each with one owner:

```
policy (config, workspace)   →  completeness(profile, policy) in core  →  artefact (CHECKLIST.md)  →  renderer (github-readme)
        .pascorc "completeness"        pure, deterministic, offline            AUTO-GENERATED, never edited        byte-stable line
```

1. **Computation → `packages/core`.** `completeness(profile, policy)` sits beside
   `geoCheck` (§7) with the same contract: deterministic, offline, no network. It
   returns one result per catalog item (score 0..1, weight, detail) plus a weighted
   `%`. It needs schema/core knowledge (which blocks exist, langMap coverage,
   GEO/drift signals, ledger state) — exactly why it lives in core, not the template.
2. **The template carries no logic.** `profile-data-template` is *data*: it ships the
   policy and the generated view, never the computation. Logic in the template would
   duplicate the engine and drift from it (AGENTS.md rule 7; D3).
3. **Render → a generated artifact in the workspace.** `pasco status --completeness`
   prints the checklist + `%`; `--write-checklist` folds the number into the existing
   `CHECKLIST.md` generated view (D18/§19). The user never edits it — the engine writes it.
4. **Publish → the renderer.** `github-readme` emits one deterministic line,
   `Profile completeness: <pct>% — <satisfied>/<total>`, from the report `compile()`
   attached to the slice. **No external badge service** — that would make the output
   non-deterministic/network-dependent and break byte-parity (D19/§15.1).

**Never store the percentage** — it is derived and would drift; only the policy
(target, weights, langs) is stored. The policy is parameterized (dev-methodology §3):
a user says "my target is the GitHub milestone set, not everything" by dropping an
item (weight 0), never through a code path.

**The item catalog (v1, ratified 2026-10-07).** Each item draws on a signal already in
the engine; the shipped default weights are the ones `COMPLETENESS_CATALOG` declares:

| Item | Weight | Source already in the engine |
|---|---|---|
| `presence` | 0.30 | `flavor` + the expected top-level blocks (brand expects `socialHandles`, person expects `education`); a block counts only when it **carries content** — `positioning: {}` / `keywords: {}` are valid but not "present" |
| `langCoverage` | 0.15 | `en`/`es`/`fr` coverage of every langMap (`load`/schema) |

**The one declared `langCoverage` exception is `releases[].summary` (v1.15, D23):** it is
langMap-SHAPED but it belongs to a release EVENT, not to the workspace's text, and
completeness measures the workspace — so the walk does not score it. The drift guard in
`packages/core/tests/completeness.test.ts` counts it separately and asserts the exclusion,
so a future langMap still cannot escape the walk unnoticed.
| `geoAnchors` | 0.15 | `positioning.geo.semanticAssociations` reinforced in `keywords`/skills/projects; the score is the reinforced **share squared** — an association anchored in only some surfaces is worth less than proportionally, since the point is convergence on the same 3–5 anchors |
| `evidence` | 0.15 | `projects[].evidence[]` claims carrying a `source` + registry entries (`evidenceItem`); no projects and an empty registry score 0 |
| `deployment` | 0.25 | share of trackable units with a ledger record (`ledger`, §19) — **coverage only**; freshness (`stale`) is §19's report, not this item's |

Weights are configuration, not constants: `.pascorc` `"completeness": { target, langs,
items: [{ id, weight }] }` overrides them per workspace and weight 0 removes an item
from the denominator. Without a policy the documented `DEFAULT_COMPLETENESS_POLICY`
applies; `pasco build` compiles with the workspace policy, so the rendered artifact and
`pasco status --completeness` report the same number.

**Non-goals (v1).** No gamification or streaks; no remote scoring; **no new required
schema fields** — completeness is advisory and must never turn optional blocks into
validation failures (D12: schema = structure, product signals = advisory). Relations:
D18 (the generated-view pattern) · D19 (byte-parity) · §12 M4/M5.

### 20.1 Publication truth — the invariant "optimized" was missing (#242)

Coverage (`§20`'s five items) scores **whether the profile has content**, never **whether
the thing the user publishes is the thing the SSOT produces**. The 2026-10-19 dogfood found
every gate green over a profile a user had not verified: a green score over an unpublished
artifact, a green `check` over a field the platform truncates, and a declared-but-ignored
variant. Completeness therefore gained its missing companion as a **derived line per
surface**, three orthogonal axes, each with one owner:

```
<surface>: <in-sync|stale|never> · artifact: <matches-SSOT|diverges|absent> · limits: <ok|over(cap)> · units: <n> recorded
```

Unit rows read in staleness order — `stale` · `never` · `in-sync` — and the key tie closes in
core's `byteOrder` UTF-16 code-unit order (issue #305): the home the engine's name-tied sorts delegate to,
with every other sort staying at JS default — code-unit order by the language itself (D19).

The trailing `units` count is the coverage behind `sync` — the human line must not overstate
it either, so it says how many units are recorded on that surface rather than letting one
confirmation speak for the whole surface.

| Axis | Question | Owner / source |
|---|---|---|
| `sync` | did any unit **confirmed on this surface** move after its deploy? | §19 staleness — the ledger, unchanged. A rollup over the units **recorded** on that surface (any stale → `stale`); a surface with no record at all is `never`. Units with no record are NOT `in-sync`: the unit table above lists them `never`, the completeness `deployment` item counts them, and the `--json` payload carries `units.recorded` so coverage is read, never inferred. |
| `artifact` | is the artifact on disk the one the SSOT produces **today**? | the bytes `pasco build` wrote vs a render of the current SSOT (variant body → renderer/paste source), at the workspace lang first then the rest of the §11 language enum; `absent` when nothing is on disk; a §19.5 `out-of-band-drift` record forces `diverges` **and wins over `absent`** (live contrary evidence is the stronger fact). `artifactReason` names which source produced a non-match — `local-mismatch` · `live-drift` · `no-artifact` — so one token never conflates the two comparisons. |
| `limits` | does any text on this surface **exceed** a declared maximum? | §18.8/#240 offline `max-chars` over headlines/bios, one executor (`packages/cli/src/limits.ts`). The token is literal: `min-chars` is a **floor**, not a cap, so it stays `pasco check`'s finding and does not feed this axis. A `max-chars` row whose declared value is not a number (the schema admits a string) produces a **catalog warning in `findings`** — the axis reads `ok` about the TEXT, but the un-evaluable cap is never silent. |

**Derived, never stored** (§20's own rule): the line is recomputed on every read and writes
nothing. It is **coverage of publication, not a score**: `percent` stays exactly what §20
defines — a function of the profile and the policy, whose `deployment` item is ledger
coverage. This derivation never moves it, and §19.5's invariant (certification never moves
the `%`) is preserved. The non-goal of #242 ("the number must be able to go down when the
surface drifts") is therefore met by the **axis**, not by the percentage: `artifact` goes from
`matches-SSOT` to `diverges` the moment the published artifact stops being the SSOT's output.
Surfaces "in play" are the ones with a ledger record or an artifact on disk; a workspace with
neither says so instead of printing twenty empty platforms.

**Machine surface (`pasco status --json`, additive).** The unit-level keys (`units`,
`units[].surfaces`, `units[].state`, `units[].certification`) are untouched; publication truth
is a new top-level sibling:

```jsonc
"publication": [{
  "surface": "github-readme",
  "sync": "in-sync" | "stale" | "never",
  "artifact": "matches-SSOT" | "diverges" | "absent",
  "artifactReason": "local-mismatch" | "live-drift" | "no-artifact",  // present iff not matches-SSOT
  "limits": "ok" | "over(cap)",
  "units": { "recorded": 1, "stale": 0 },   // the rollup behind `sync`
  "findings": [{ "severity": "warn", "code": "max-chars", "message": "…", "path": "…" }]
}]
```

`pasco status --completeness` carries the same array and prints
`publication coverage — <matching>/<total> surfaces match the SSOT · <n> over cap`;
`--write-checklist` folds that phrase into the generated `CHECKLIST.md` (D18) — from the
**unfiltered** derivation, because the checklist is a whole-workspace view even when the
command was called with a platform argument.

**Declared v1 limits** (each an honest absence, not a silent pass):

- the comparison is **offline**: live drift is only known when §19.5's `--verify` has
  recorded it, and the opt-in pass is the only fetch (D20). A live mismatch nobody checked
  reads `matches-SSOT` if the local bytes match — the axis compares what is on disk against
  the SSOT, never against the internet;
- the artifact is compared at the workspace lang first, then every lang the contract allows
  (§11: `en`/`es`/`fr`) — `--lang` is validated against the same enum, so an artifact built
  for another legal lang still matches. **Equality with ANY legal render is accepted on
  purpose**: byte-identical bytes cannot carry a stale fact, and `status` was never told which
  lang was intended; the axis answers "is this an artifact the SSOT produces today?", not
  "did the operator build the lang they meant". A build made with `--view <name>` reads
  `diverges` (the comparison resolves the implicit per-platform view);
- the comparison ignores the one generated token whose input is the ledger itself —
  `Profile completeness: <pct> — <n>/<m>` (§20: a derived view). Otherwise recording a
  confirmation would change the embedded number and every confirmed surface would read
  `diverges` forever: noise about a label, not drift of a fact. Consequence: a stale
  displayed percentage alone is not reported as divergence;
- **the media bundle is out of scope**: the comparison covers the primary artifact file
  (`profiles/<s>/README.md`, or the paste source `profiles/<s>.md` for a manual surface),
  not `profiles/<s>/assets/`. Media transport is `pasco check`'s M8 surface (§18.6), and
  reconstructing the expected bundle would need the render's own asset references —
  deferred, declared, and never silently green in `check`.

**Non-goals (v1).** No new schema field, no new required block (`pasco validate` is
unchanged), no gamification, no remote score, and no promise that a higher number is a
better profile. Relations: §19/§19.5 (the ledger and certification this reads) · §20 (the
pattern) · D12 (advisory, never a validation failure) · D18 (generated view).

## 21. Fact selection per rendered profile (D22 detail, issue #235)

The engine adapts three things per surface, and they are orthogonal: `lang` adapts
**text**, `refine` adapts **storytelling**, and a **view** selects **which facts**.
The first two never change what a fact says; selection must not either. That single
constraint is the whole contract.

**Why selection is admissible.** Goal 2/3 and §15.4 constrain what a fact *says* when
it appears, not that it must appear on every surface. A rendered profile is a
**sub-conjunction** of the SSOT's facts, and removing a conjunct cannot introduce a
contradiction between the ones that remain. The engine already scores absence as
neutral (`geo.ts:21`), so selection is the policy expression of a stance the GEO
scorer holds. What it costs is **coverage**, never consistency — and that cost is
reported, not hidden (§21.4).

### 21.1 Why a policy and not a field

The decision lives in **workspace config** (`.pascorc`), never in the SSOT data. The
SSOT stays platform-agnostic (§9/D14) and a new platform never forces an edit to every
entry. This is §20's pattern applied to a second axis: *compute in the engine, store
only the policy*.

### 21.2 A view and its rule

A **view** is a named projection: a target platform, a language, and a selection.
`pasco build linkedin` is the implicit view named `linkedin`; a declared view may
override platform/lang so `--view <name>` alone is enough.

```jsonc
{
  "selection": {
    "default": { "mode": "all" },              // rule for any view not named below
    "views": {
      "linkedin": { "excludeKeys": ["projects:acme-internal"], "excludeTags": ["nda"] },
      "film": { "platform": "github-readme", "lang": "en", "mode": "tags", "tags": ["film"] }
    }
  }
}
```

A **view rule** has these fields:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `"all"` \| `"tags"` | `"all"` | the *basis*: every entry, or only those carrying one of `tags` |
| `tags` | `string[]` | `[]` | allowlist; meaningful with `mode: "tags"` |
| `excludeTags` | `string[]` | `[]` | deny by tag, applied in **every** mode |
| `excludeKeys` | `string[]` | `[]` | deny by §19.2 key (`experience:<id>`, `projects:<id>`, …) |
| `platform` / `lang` | `string` | — | optional target, so `--view` alone resolves |

`selection.default` is a **sibling of `views`**, not a field: it is the rule applied to
any view that `views` does not name (including the implicit view of a positional
`pasco build <platform>`). Absent ⇒ `{}` ⇒ no filtering.

### 21.3 Resolution rules

1. **View resolution order**: `views[<name>]` → `selection.default` → `{}`.
2. **An unknown view is an error**: if `--view <name>` names neither a `views` entry
   nor is covered by `default`, the build fails (`selection/unknown-view`, exit 1). A
   typo must not silently build a different surface.
3. **Precedence, stated once**: a positional `[platform]` that conflicts with the
   view's `platform` is an **error** (never a silent winner); a view with no
   `platform` and no positional platform is an **error**; `--lang` (CLI) wins over the
   view's `lang`, which wins over `.pascorc.defaults.lang`, which wins over `en`.
4. **Exclusion wins** over inclusion, in every mode.
5. **No policy ⇒ no filtering ⇒ byte-identical output**, asserted by a golden test
   (§15.1/D19).
6. **Only these eight entry arrays participate**: `experience`, `projects`,
   `publications`, `education`, `press`, `credentials`, `artifacts`, `skills`.
   Singleton blocks (`identity`, `positioning`, `keywords`) and the text-bearing
   `bios`/`headlines`/`socialHandles` are **never** selectable — text adapts through
   `lang`/`refine`, not through selection.
7. **Tags apply only to tag-capable blocks.** `tags` exists on `artifacts` today
   (schema:913) and Phase 2 adds it to `experience`, `projects`, `publications`,
   `education`, `press`, `credentials` — **not** to `skills`, which is addressed by its
   natural key. Consequence: in Phase 1 `mode: "tags"` filters `artifacts` only; the
   other seven blocks pass through and are addressed by `excludeKeys`.
8. **`mode: "tags"` is an explicit allowlist for tag-capable blocks**: an untagged
   artifact is not selected.
9. **Iteration order is SSOT declaration order**, never a map's order.

### 21.4 Every omission WARNS (operator's G1 amendment)

A view that omits one or more entries emits `selection/omits-facts` — a **warn**
naming each omission and its reason — and `pasco status --selection` prints the full
resolved report. Silent omission is the one failure mode this feature must not have:
the default direction of a profile is *publish*, so anything that removes a fact owes
the user a statement.

### 21.5 Engine seam and checks

`selectFacts(profile, view, platform, lang, policy?)` lives in
`packages/core/src/selection.ts` beside `completeness()` and `geoCheck()` — pure,
deterministic, offline. `compile()`'s parameter becomes a **new alias**,
`CompilePolicy = CompletenessPolicy & { selection?: SelectionPolicy; view?: string }`;
every field it adds is optional, so existing callers (including `packages/paste`) keep
compiling unchanged.

The split that keeps the feature honest:

- **`structuredData` is built from the filtered profile** — the JSON-LD cannot claim
  entities the render never shows.
- **`completeness` is built from the unfiltered profile** — §20 scores the *workspace*,
  not a view. Hiding half the SSOT must not lower the number.

Codes follow the `<ns>/<slug>` convention of `drift/*`, `geo/*`, `check/*`:

| Check | Class | Why |
|---|---|---|
| `selection/unknown-key` | **error** | an addressed key that resolves to nothing is an unsatisfied instruction (§19.2: addressed ⇒ resolvable) |
| `selection/unknown-tag` | warn | a tag matching no entry — likely a typo |
| `selection/empty-facts` | warn | a view selected nothing while the SSOT had candidates |
| `selection/anchor-omitted` | warn | a `positioning.geo.semanticAssociations` anchor is reinforced only by omitted entries |
| `selection/omits-facts` | **warn** | **any** omission, named with its reason (§21.4) |

`selection/unknown-view` is the sixth code but **not** a finding: it fires before the
profile is read, as a config error (exit 1).

### 21.6 CLI

`pasco build [platform] [--view <name>] [--lang]` ·
`pasco status [platform] --selection [--view <name>]`. `--selection` is a
**boolean** and the view is named with `--view`, so it can never be confused with the
`[platform]` positional. The positional platform remains the implicit view of the same
name, so a workspace with no policy behaves exactly as before.

### 21.7 Scope boundary

Phase 1 is **schema-free**: selection covers the eight entry arrays by §19.2 key, and
`artifacts[].tags` — declared in §18.9 and unimplemented until now — is finally read.
Phase 2 adds optional `tags[]` to six entry blocks (additive; `pnpm gen:zod`).
**Phase 3** (several views on one platform, `profiles/<view>/`) needs a D19 amendment
and is **not** implied by this section. View-aware `geoCheck`/`driftCheck` scoring is
out of scope: both keep reading the SSOT.


## 22. Presence surfaces and the release event (D23 detail, issue #262)

D23 answers a question the profile unit could not: *"which surfaces does this
publication still owe, and in what order?"* It does so without a second state
model and without touching the 49-slug profile enum.

### 22.1 A surface carries a kind

`platforms/registry.yaml` gains an additive `kind` dimension (`profile` ·
`repo-meta` · `distribution`; absent = `profile`). Every enum member is
`profile` — the enum IS the identity bodies. `repo-meta` is metadata of the code
artifact (repo description/topics/social preview, release notes, the npm package
page, the project site) and `distribution` is where a release is announced
(HN, Reddit post, X post, LinkedIn post, dev.to post, awesome lists). Those
surfaces are declared `status: backlog`, so they never enter the profile enum;
they are the first non-profile surfaces the model can name.

`pnpm gen:platforms` projects the dimension into `PLATFORM_KINDS` (all registry
entries, members and backlog) and refuses two disagreements in CI:

- a `status: member` whose `kind` is not `profile` (a profile renderer must not
  claim to emit repo metadata);
- a renderer manifest's `pasco.surface` that differs from the registry `kind` —
  the "renderer emits repo metadata with `kind: profile`" failure the issue asks
  CI to close.

### 22.2 A release is the event

Schema v1.15 adds `releases[]` (additive; a pre-v1.15 workspace validates
unchanged):

```yaml
- id: v0-3-0
  version: 0.3.0
  date: 2026-10-28
  summary: { en: "…", es: "…" }
  changedUnits: [identity, projects:pasco]   # §19.2 ledger keys
  surfaces: [github-repo-meta, github-readme, hacker-news]
```

A release stores **what changed and where it must go** — never the state of that
fan-out. The state is derived per surface from `deployments` (the §19 ledger):

| condition | state |
|---|---|
| ANY changed unit has no record on the surface (or resolves to no SSOT unit) | `never` — and `missingUnits` lists it |
| every changed unit has a record, and some record's `contentHash` differs from the unit's current hash | `stale` |
| every changed unit has a record and every hash matches | `in-sync` |

Partial coverage is **never** `in-sync`: a release that changed two units and a
surface that confirmed only one still owes the other, and the plan says so.

A surface the ledger cannot address (a `repo-meta`/`distribution` slug outside
the platform enum) therefore reads `never` — the honest v1 answer: the plan names
what must be touched, and extending the ledger's surface key to non-profile
surfaces is a separate contract change, never a state invented here.

### 22.3 The commands

`pasco presence [--json]` — the daily board (option B): one row per surface at
the newest release that declares it, with kind, derived state, release id and
version, plus the state counts. `pasco release plan [<id>] [--json]` — the launch
view: the ordered fan-out (`repo-meta` → `profile` → `distribution`, then slug),
each surface's state, and the per-kind factual spine. Both are offline,
deterministic and read-only (contract: §7.8).

### 22.4 Where the copy lives

The engine emits the factual spine and the order; the **judgment** per channel —
angles, character budgets, membership/announcement norms — lives in `skills/`
(rule 7 + D9). The first non-profile presence skill is `skills/github-repo-meta/`
(`playbook.md` + `checks.yaml`), covering the repo's own metadata surface.

### 22.5 Scope boundary (v1)

- No publishing, no network, no scheduler: the plan is a read, `--mark` remains
  the only fan-out closer (and only for profile-platform surfaces).
- `releases[]` composes the ledger; it does not replace `deployments`.
- Milestone naming follows the decision: M4 is the **presence surfaces (profile
  bodies)** milestone and M5 the **presence consumption** milestone (§12) — no
  new loose milestone.
