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
| D20 | **`pasco serve` is a minimal reference adapter over `Core`** (§7), exposed as a **local HTTP contract**. It is minimal **by construction**: no access control, no multi-tenancy, no billing, no persistent storage, no hosting orchestration. Dependency rule: `server` depends on `core`, and only the CLI's `serve` subcommand depends on `server` | Keeps the published surface **small, auditable and dependency-light** — the engine's job is the contract, not the deployment. The **contract is the integration point**, so any consumer (a UI, an editor, a script, a service) may implement its own adapter against it instead of adopting ours. Alternatives: a **feature-rich bundled server** (rejected — bloats the published package and couples the engine to deployment concerns it does not own); **no server at all** (rejected — leaves the engine drivable only from the CLI, so every consumer re-invents the boundary, and there is no reference implementation to test the contract against) |
| D21 | **Contributions are accepted under the Developer's Certificate of Origin 1.1 — no CLA** (issue #95, 2026-10-03): every non-bot, non-merge commit in a PR must carry a `Signed-off-by:` trailer whose email matches the commit author; the canonical text is the root `DCO` file, and the gate is `scripts/dco-check/` (self-test first, `dep-gate` shape) wired as the `dco` workflow | The licence stays **MIT** (`packages/*/package.json`), and with a permissive licence there is nothing left to relicense — so a CLA's only real value (an express sublicense/relicensing grant) would buy permanent contributor friction, a third-party signature-collection app and a legal document to maintain, in exchange for optionality the project has decided not to exercise. The DCO certifies *provenance* of the contribution at zero infrastructure and zero data beyond the git trailer. Alternatives: **CLA** (rejected — friction and upkeep for optionality we don't want); **DCO + relicensing grant** (deferred — cheaper than a CLA and keeps the option open, but a sign-off is weaker evidence of assent than a signature; revisit only if the licence question reopens, and never retroactively for an already-published version). Bot authors are exempt by design: Dependabot cannot sign off, and blocking it would block every dependency PR |

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
identity:      { name, email?, location, photo, links[] }      # canonical links: THE source of URLs; email = contact fact (v1.5, #71)
positioning:   { statement: {lang}, audiences: {lang: angle}, geo: { semanticAssociations[], citationsGoal } }
bios:          [ { platform, lang, length: short|medium|long, text } ]   # generated + curated
headlines:     [ { platform, lang, text } ]                   # per-platform, per-lang
skills:        [ { name, level, keywords[], geoKeywords[], platformWeights{} } ]
experience:    [ { id?, origin?, role, org, start, end, highlights{lang} } ]   # id/origin — D18 §19
projects:      [ { id?, origin?, name, status, description{lang}, links, keywords{}, evidence[] } ]
publications:  [ { id?, origin?, title, venue, year, doi, orcidId } ]
credentials:   [ { id, kind, title, issuer, credentialId?, verifyUrl, issued, expires?, visibility } ]
artifacts:     [ { id, kind, title, description{lang}?, locator, checksum?, license?, tags[], visibility } ]
keywords:      { seo: { platform: [] }, geo: { associations: [], claims: [] } }
checks:        [ { platform, rule, value } ]                  # declarative; executed by `pasco check`
active:        { platform: { lang, variantId, chosenAt } }    # which variant is live
deployments:   { <ledgerKey>: { <surface>: { deployedAt, contentHash, source } } }   # per-entry deploy ledger (D18, §19)
```

**Evidence registry (D17, §18 — additive, v1.4):** `credentials[]` and `artifacts[]` are
the proof layer — pointer-first, visibility-scoped. `projects[].evidence[]` keeps its
claim semantics and may reference registry ids (`credentialId`/`artifactId`); canonical
blocks (`publications[]`, `press[]`) keep their domains and gain `artifactRefs` instead of
becoming registry kinds. Naming discipline: the word "evidence" stays claims-only (§18.1).

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
  geoCheck(profile): GeoReport      // consistency score, structured-data readiness, semantic anchors
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
| `pasco validate` | schema (fail) + drift/geo checks (facts warn) |
| `pasco build [platform] [--lang]` | render deterministic base texts |
| `pasco refine [platform] [--lang] [--variants N]` | AI variants — **agent-driven, model-agnostic**; user picks; commit active |
| `pasco check [platform]` | run skill-declared checks before deploy |
| `pasco diff` | what changed since last release (→ CHANGELOG hint) |
| `pasco status [platform] [--mark <ledgerKey> <surface>] [--verify] [--write-checklist] [--completeness]` | per-entry deploy report — origin · published surfaces · in-sync/stale/never (D18, §19); `--mark` confirms a manual paste and records the artifact anchor; `--verify` runs the opt-in C1 live check (§19.5, v1.10 — the only network-touching path, and `pasco`'s second ledger write trigger); `--completeness` reports the profile-completeness checklist + `%` (§20, issue #102); `--write-checklist` folds both dimensions into the generated `CHECKLIST.md` |
| `pasco skills:install <agent>` | project repo skills → agent skill studio (zhiweio pattern) |
| `pasco serve` | run the **minimal reference adapter** (D20) — exposes `Core` over a **local HTTP contract** so any consumer (UI, editor, script, service) drives the engine without re-implementing it. Minimal **by construction**; a deployment that needs more ships its own server against the same contract |

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
- **Discoverability today:** A's surface (the satellite repo) is private until the family
  flip (`docs/STANDARDS.md`, community item 10), so today it reaches insiders only; B and C
  are reachable now from the public npm package, with no repo access at all.
- **`pasco init` behavior does not change with this section** — what it scaffolds today *is*
  the local on-ramp.

```
profile-data/
├── README.md            # instructions: pick your on-ramp, install pasco, first build
├── content/             # identity.yaml, positioning.yaml, bios.yaml, skills.yaml,
│                        # experience.yaml, projects.yaml, publications.yaml, keywords.yaml
├── profiles/            # generated outputs (committed: they ARE the deploy artifacts)
├── CHANGELOG.md         # every change: date + which platforms need re-paste
├── CHECKLIST.md         # per-platform verification after pasting
└── .pascorc             # workspace path, defaults (D11–D14)
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
4. **M4**: renderers linkedin/upwork/x/researchgate/substack + playbooks + `pasco check` + checks.yaml per skill + per-entry deploy ledger (D18 — `deployments` + `pasco status`: deploy state becomes data, CHECKLIST becomes a generated view) + profile-completeness checklist and `%` (§20, issue #102 — `completeness()` in core, `pasco status --completeness`, the `github-readme` progress line).
5. **M5**: web renderer (cv-cluciani consumes generated profiles), template release, CONTRIBUTING. **Scope boundary:** M5 is a **consumption** renderer — it renders profiles that already live in a workspace (§9); it is **not** a hosted onboarding. The hosted on-ramp stays a **v1 non-goal** with an explicit reopening trigger (§2, issue #122).
6. **M6 (brand flavor)**: schema v1.1 brand additions (§17) + `pasco init --flavor brand` + renderer `github-org` + handle-matrix checks + `skills/github-org/` + dogfood `profile-data-topia` (private).
7. **M7 (evidence core)**: schema v1.4 — `credentials[]`/`artifacts[]` + cross-refs (§18) · `pasco check`: `credential-expiry`, registry live-links, `no-private-in-public-output` · JSON-LD `hasCredential` · compact registry section in `github-readme` · template: `media/` scaffold + `docs/evidence-packs.md` + power-user symlink/stow doc (issue #48).
8. **M8 (media pipeline)**: full `assets/` renderer-output definition (byte-stable, checksummed bundling — Q9 resolved as D19: one `assets/` dir per platform output) · deploy playbooks publish media to the public surface · git-lfs guidance · portfolio-site consumption lands **with M5** (the web renderer does not exist yet — engine-side contract ships first).
9. **M9 (training-time corpus presence — deferred, Q10)**: outputs are designed not only for inference-time citation (GEO, layer 2) but — for owners who explicitly consent — for entry into future model training corpora (layer 3). Inputs + documented levers: `docs/research/03-training-time-visibility.md` (sourced + dated). Floor regardless of the Q10 resolution — **private-first default**: `robots.txt` on published surfaces **blocks** AI-training crawlers (CCBot / vendor AI crawlers) and user data ships **without** an open license; entering corpora or open-licensing data requires the profile owner's explicit opt-in (consent field — schema work deferred with Q10). The operator's own profiles may opt in: that consent is theirs to give. Decision (Q10): a `huggingface-dataset` renderer/exporter vs contributing to existing open datasets vs both — decided when the M3 platform SOTA research closes.

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
  (`profiles/<platform>/assets/`), not a shared content-addressed store. Deploy surfaces are
  separate repos (D9/D14) — a shared store has no home; each renderer output is self-contained
  (README + its assets travel and verify together); targets are human-reviewable in deploy diffs
  (`assets/<id>/<basename>`); `assets/manifest.json` records the compile-time sha256 per asset.

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
3. **Featured projects** (top 3–6 by `skills[].platformWeights[github-readme]` ordering, or all if
   fewer): name, status, description (lang), links, evidence (verified claims).
4. **Publications** (citable): title, venue, year, DOI link. DOI-only entries (the GEO anchor).
5. **Skills** (ordered by weight): `name` + keywords, from the SSOT. No invented prose.
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
  `jobTitle`/`worksFor`, which the renderer never emitted although `geoCheck` computed them;
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
- Entity assembly lives in **one** place: `core/src/structured-data.ts` — the single source for
  `@id`, `sameAs` and the entity fields, consumed by `geoCheck` and every renderer. Renderers
  never re-derive structured-data identity (the §18.9 `credentialLdEntries` precedent, applied).
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
   LLM and never wires the hub (D13).
2. The executing agent (AionUi, OpenHands, Claude Code, Cursor, pi…) reads the skill
   and produces N variants in prose — the human picks one.
3. `pasco refine <platform> --choose <variantId>` records the choice in `content/active.yaml`
   (the LIVE variant per platform, D11).

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

Canonical blocks keep their domains — **no duplication**: `publications[]` (papers, DOI)
and `press[]` (D15) are NOT registry kinds; they reference registry ids (`artifactRefs`).
The registry is the home of what had none.

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
`publications[]` and `press[]` gain `artifactRefs: [id]`.

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
`pasco check` rule `no-private-in-public-output` fails the build on a leak. Rationale:
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
  artifacts; renderers select by platform + lang + tags. One workspace, many areas;
  separate identities remain separate workspaces (D15).

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
  **Schema status — target, not shipped.** This shape is the v1.10 target and is **not in
  `schema/profile.schema.json` yet**: `$defs.deploymentRecord` still declares
  `additionalProperties: false` with only `deployedAt`/`contentHash`/`source`, so a record
  carrying `certification` **fails `pasco validate`** today (D12 fail class). The additive
  schema change (a new optional `certification` property) lands in the implementation PR on
  this branch; until then, no workspace should write the field. The contract is stated first
  on purpose (SPEC-first, D3) — the schema is the source, and it follows this section.
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
| `pasco status [platform]` | per-unit report: ledger key · origin (template/user) · surfaces published · sync state per surface: `in-sync` \| `stale` (hash mismatch) \| `never` · **certification per surface** (§19.5: `verified` \| `attested` \| `unverifiable` \| `out-of-band-drift`, with the reason). Offline and deterministic — the report never fetches |
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
