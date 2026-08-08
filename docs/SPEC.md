# SPEC — profile-as-code engine

> Status: draft v0.2 · Lang: EN (docs convention; data supports any language)
> Owner: Christian Luciani · Method: spec-driven · Related: `docs/research/01-prior-art.md`

## 1. Context

A professional identity lives across 8+ platforms (LinkedIn, Upwork, GitHub, X, ResearchGate, Substack…)
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
- No CV/PDF renderer (delegate to yamlresume/JSON Resume as a renderer if ever needed).
- No scrapers — we never read platforms; we write (or paste).
- No auto-publishing to LinkedIn/Upwork (no API exists); GitHub/web are git/API-driven.

## 3. Success criteria (v1)

- `pac build` renders all platforms from one YAML workspace; `pac validate` rejects schema violations,
  warns on drift/geo (facts); `pac check` runs skill-declared checks (char limits, live links, fact presence).
- `pac refine <platform> [--lang] [--variants N]` produces N text variants, **agent-driven and
  model-agnostic** (the executing agent's model — AionUi, OpenHands, Claude Code, Cursor…). The chosen
  variant is committed and marked as active. Sah/hub may become the default path once it matures (D13).
- GitHub profile README + web are fully git/API-driven (dogfood: Christian's real profile).
- Every quantitative claim in every skill has a dated source (claims-evidence enforced).
- A fresh user can start from the `user-brand-data` template (fork/clone) in under 10 minutes.

## 4. Architecture

```
        ┌──────────────────────────── REPO PUBLIC (product) ────────────────────────────┐
        │  schema/          packages/core       packages/renderers/<platform>           │
        │  (JSON Schema) →  validate ·          (adapters: github-readme, linkedin,     │
        │  the contract       normalize ·         upwork, x, researchgate, substack)    │
        │                     drift-check ·     packages/cli  (pac)                     │
        │                     geo-check         skills/<platform>/  (SKILL.md, research,│
        │  CI: validate · tests · links · drift  playbook, checks.yaml)                 │
        └───────────────▲───────────────────────────────────────────┬──────────────────┘
                        │ data (per user)                           │ outputs ready
        ┌───────────────┴───────────────┐        ┌──────────────────┴─────────────────┐
        │  user-brand-data (private)    │        │  deploy: paste (LinkedIn, Upwork…)  │
        │  content/*.yaml · profiles/   │        │  deploy: git/API (GitHub, web)      │
        │  CHANGELOG.md · CHECKLIST.md  │        │  verify: skill checks + checklist   │
        └───────────────────────────────┘        └─────────────────────────────────────┘
```

- **Public repo** = product: schema, core, renderers, CLI, skills, templates, docs, examples (fictional person).
- **user-brand-data** = per-user private workspace (or local-only). Never in the public repo.
  Provided as a **GitHub template repo / forkable skeleton** — see §9.

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
| D10 | `pac refine` is **model-agnostic** (executing agent's model); sah/hub as future opt-in | User decision; revisit when sah matures. |
| D11 | Refinement is **agnostic agent-driven** (AionUi, OpenHands, Claude Code, Cursor…) | Skills drive, `pac` executes; user picks variant. No closed CLI picker. |
| D12 | Drift-check: **warn on facts, fail on schema** | Users may have different intents per platform; integrity vs flexibility. |
| D13 | Model-agnostic default; sah as future default path | Revisit when sovereign hub matures (Q3→RESOLVED). |
| D14 | User data in **separate repo** `user-brand-data`, integrated by configured path, no symlink in normal flow | Symlink mount only as advanced CI option (Q4→RESOLVED). |

## 6. Data model (schema v1)

The executable contract lives in **`schema/profile.schema.json`** (JSON Schema, draft 2020-12 — D3;
Zod generated from it in core, never hand-written). See `schema/README.md` for file mapping and
validation semantics. The sketch below is the illustrative overview:

All textual fields support `{ lang: value }` maps (EN required; ES, FR optional per field).
Facts (dates, DOIs, URLs) are language-independent — **the GEO anchor**.

```yaml
identity:      { name, location, photo, links[] }            # canonical links: THE source of URLs
positioning:   { statement: {lang}, audiences: {lang: angle}, geo: { semanticAssociations[], citationsGoal } }
bios:          [ { platform, lang, length: short|medium|long, text } ]   # generated + curated
headlines:     [ { platform, lang, text } ]                   # per-platform, per-lang
skills:        [ { name, level, keywords[], geoKeywords[], platformWeights{} } ]
experience:    [ { role, org, start, end, highlights{lang} } ]
projects:      [ { name, status, description{lang}, links, keywords{}, evidence[] } ]
publications:  [ { title, venue, year, doi, orcidId } ]
keywords:      { seo: { platform: [] }, geo: { associations: [], claims: [] } }
checks:        [ { platform, rule, value } ]                  # declarative; executed by `pac check`
active:        { platform: { lang, variantId, chosenAt } }    # which variant is live
```

## 7. Core interfaces (deep module)

```ts
interface Profile { /* normalized model compiled from content/*.yaml */ }

interface Core {
  load(workspace): Profile          // parse + validate (Zod from schema) + normalize
  driftCheck(profile): Issue[]      // fact contradictions across platforms (also GEO blocklist)
  geoCheck(profile): GeoReport      // consistency score, structured-data readiness, semantic anchors
  compile(profile, platform): PlatformProfile   // language-aware slice for a renderer
}

interface Renderer {
  id: 'github-readme' | 'linkedin' | 'upwork' | 'x' | 'researchgate' | 'substack';
  render(p: PlatformProfile, opts): { text: string; assets?: string[] };
  deploySpec: 'git' | 'api' | 'manual';   // manual → playbook + checks
}

interface SkillChecks {  // from skills/<platform>/checks.yaml
  run(p: PlatformProfile): CheckResult[]; // limits, links, fact-presence, GEO consistency
}
```

`pac` (CLI) commands — v1:

| Command | Purpose |
|---|---|
| `pac init` | scaffold a user-brand-data workspace from the template |
| `pac validate` | schema (fail) + drift/geo checks (facts warn) |
| `pac build [platform] [--lang]` | render deterministic base texts |
| `pac refine [platform] [--lang] [--variants N]` | AI variants — **agent-driven, model-agnostic**; user picks; commit active |
| `pac check [platform]` | run skill-declared checks before deploy |
| `pac diff` | what changed since last release (→ CHANGELOG hint) |
| `pac skills:install <agent>` | project repo skills → agent skill studio (zhiweio pattern) |

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

## 9. user-brand-data template (fork/clone flow)

Delivered as a **GitHub template repository** (`ChristianLuciani/user-brand-data-template`), so a new
user can `Use this template` or fork. The folder `templates/user-brand-data/` in the engine repo is a
**pointer** to it (no duplication → no drift).

Name rationale: the *user-* prefix makes explicit the workspace is **per user** — individual profiles
today, **commercial/brand identities** later (multi-workspace: one workspace per identity, same engine).

```
user-brand-data/
├── README.md            # instructions: fork/clone, install pac, first build
├── content/             # identity.yaml, positioning.yaml, bios.yaml, skills.yaml,
│                        # experience.yaml, projects.yaml, publications.yaml, keywords.yaml
├── profiles/            # generated outputs (committed: they ARE the deploy artifacts)
├── CHANGELOG.md         # every change: date + which platforms need re-paste
├── CHECKLIST.md         # per-platform verification after pasting
└── .pacrc               # workspace path, defaults (D11–D14)
```

**Integration (Q4→D14):** the engine never copies or owns user data — it reads the workspace by
**configured path** (`.pacrc → workspace`). No symlink in the normal flow. A **symlink mount**
(`workspaces/<user>/` → external repo) is an advanced option so engine-CI can validate user data
without copying it. The engine only writes to the workspace when the user runs `pac refine`
and picks a variant.

Private by default (GitHub private repo or local git). Never part of the public product repo.

## 10. templates/ in the product repo — clarification

Two different "templates" (previous confusion):

- `templates/playbooks/` — per-platform **deploy playbooks** (copy-paste steps, verification) that the
  product ships; referenced by `manual` renderers.
- `templates/user-brand-data/` — **pointer** to the per-user workspace skeleton repo (§9). Fork/clone,
  not built-in.

## 11. i18n strategy

- **Repo docs/README/SPEC**: EN (open-source lingua franca). User-facing summaries may be ES/FR.
- **CLI output**: EN with `--lang` for generated texts.
- **Content**: every text field is `{ lang: value }`; EN required (recruiters), ES native, FR optional.
- **Per-platform language policy**: e.g. Upwork overview EN-first (international clients), LinkedIn
  per-target-market; the skill for each platform documents the language policy.
- **Validation**: a schema rule requires at least one `lang` per text block; `pac validate` enforces.

## 12. Roadmap

1. **M1 (now)**: spec + user-brand-data template (done) + schema v1 ✅ (`schema/profile.schema.json`) + core (validate/drift/geo) + CLI skeleton.
2. **M2**: renderer `github-readme` + CI + dogfood (Christian's real GitHub README).
3. **M3**: SOTA research per platform (GitHub→LinkedIn→Upwork→X→ResearchGate→Substack) → skills v1 + `pac refine`.
4. **M4**: renderers linkedin/upwork/x/researchgate/substack + playbooks + `pac check` + checks.yaml per skill.
5. **M5**: web renderer (cv-cluciani consumes generated profiles), template release, CONTRIBUTING.

## 13. Resolved decisions (former open questions)

- **Q1 → D11 (RESOLVED):** refinement is **agnostic agent-driven** — works with any agent
  (AionUi, OpenHands, Claude Code, Cursor…). No closed CLI picker; the agent (running `pac refine` or
  the platform skill) produces variants, the user picks, the chosen variant is committed.
- **Q2 → D12 (RESOLVED):** drift-check **warns on facts, fails on schema** — users may legitimately
  have different intents per platform; facts warn (visibility), schema violations fail (integrity).
- **Q3 → D13 (RESOLVED):** model-agnostic by default — uses the executing agent's model. When `sah`
  (sovereign-agentic-hub) matures, revisit as default path.
- **Q4 → D14 (RESOLVED):** **separate repo** `user-brand-data`; integration by **configured path**
  (`.pacrc → workspace`), no symlink in the normal flow; symlink mount only as engine-CI option.

## 14. Open questions (remaining)

- Q5: Substack adds a *content* surface (newsletter) beyond profile fields — v1 covers the profile
  page only, or also issue templates?
- Q6: CI-as-a-service for user workspaces (symlink mount) — worth it in v1 or later?
