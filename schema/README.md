# schema/ — the contract (D3)

`profile.schema.json` is the **single source of contract truth** for a profile-data
workspace (JSON Schema, draft 2020-12). Per D3, JSON Schema is the contract source and
**Zod schemas are generated from it** in `packages/core` — never hand-written in parallel.

> Status: **v1.10** · The schema implements §6 of `docs/SPEC.md` as an executable contract.
> v1.x is **additive** (semver minor): every earlier workspace still validates unchanged. New
> in v1.10 (issue #288): the answer-engine surface — `identity.definition` (the canonical
> per-language definition, ≤ 160 chars per value, must contain the entity name — the name
> check is a geoCheck rule, #289) and root `faq[]` (3–20 citable Q&A pairs, `q` ≤ 90 and
> unique per workspace, `a` ≤ 320, optional `$defs/url` `source`). The same minor completes
> the version label of the §19.5 certification additions (issue #132 — they shipped under
> the v1.9 URI). Earlier minors: see the `$id`'s description and the CHANGELOG.

## URL scheme rule (issue #53)

Every URL field validates through the single `$defs/url` node, which carries
`pattern: ^https?://` **on top of** `format: uri` and `minLength: 7`:

- **http(s) only.** `format: uri` alone admits non-http schemes (`javascript:`,
  `data:`, `vbscript:`). Renderers emit SSOT URLs verbatim (§15.4/§18.4: markdown
  links, JSON-LD `sameAs`/`hasCredential.url`, badges), so the scheme is validated
  once at the boundary — renderers need zero per-emit filtering.
- **Single-source discipline.** All URL fields (`identity.links[]`, `photo`, `logo`,
  `socialHandles[].url`, `newsletter.url`, `podcast.url/rss`, `press[].url`,
  `publication.url`, `evidence[].source`, `projects[].links[]`,
  `credential.verifyUrl`, `artifacts[].locator.url`) inherit the rule via `$ref` —
  no per-field copies, no per-renderer allowlist.
- **Case-sensitive.** JSON Schema `pattern` is ECMA-262 regex without flags; an
  uppercase scheme (`HTTPS://…`) fails validation loudly (D12 fail class).
- **Negative fixture:** `scripts/schema-check/fixtures/invalid-bad-url-scheme.json`
  (a `javascript:` link must be rejected); load-side behavior is asserted in
  `packages/core/tests/load.test.ts` (URL scheme boundary describe).
- **The contact email is NOT a URL field (v1.5, issue #71).** `mailto:` stays rejected in
  `identity.links[]` (D12) — the email lives in `identity.email` as a fact (pattern
  `^[^@\s]+@[^@\s]+\.[^@\s]+$`, negative fixture `invalid-bad-email.json`). Renderers emit
  it as a mailto: href in the Links section (output-only) and as the JSON-LD `email`
  property; `sameAs` stays page-URLs-only (SPEC §6/§15.4).

## How content files map to the profile

`pasco load(workspace)` reads `content/*.yaml`, **merges** them into one Profile object and
validates the result against this schema. File → root property mapping:

| File (content/) | Root property(s) | Notes |
|---|---|---|
| `identity.yaml` | `identity` | Required at profile level (the GEO anchor). v1.5 (issue #71): `email` — the contact email as a fact (NOT in `links[]`; renderers emit a mailto: href + JSON-LD `email`). v1.6 (#103): `links[].role` — `identity` | `realization` | `aggregator` (see §15.4) |
| `flavor.yaml` | `flavor` | v1.1 (D15): `person` \| `brand`. **The file value IS the root value** — a bare scalar (`brand`), not a key:value map |
| `socialHandles.yaml` | `socialHandles[]` | v1.1 (brand): handle matrix (platform → handle + `status: claimed\|pending`) |
| `newsletter.yaml` | `newsletter` | v1.1 (brand): Substack/Ghost |
| `podcast.yaml` | `podcast` | v1.1 (brand): Spotify/RSS |
| `press.yaml` | `press[]` | v1.1 (brand): media mentions |
| `audiences.yaml` | `audiences` | v1.1 (brand): reader profiles |
| `positioning.yaml` | `positioning` | Statement, audience angles, GEO intent |
| `bios.yaml` | `bios[]` | Generated + curated; variant chosen lives here |
| `headlines.yaml` | `headlines[]` | Per platform+lang |
| `skills.yaml` | `skills[]` | With `geoKeywords` + `platformWeights` |
| `experience.yaml` | `experience[]` | start/end as facts (dates are language-independent); v1.1: role langMap, highlights string[] — org stays invariant string (proper noun) |
| `education.yaml` | `education[]` | v1.1: formal education (degree/institution/start/end/note) |
| `languages.yaml` | `languages[]` | v1.1: spoken languages (code + level) |
| `projects.yaml` | `projects[]` | With `evidence[]` (verifiable claims) |
| `publications.yaml` | `publications[]` | DOI/ORCID resolvable → GEO citability |
| `keywords.yaml` | `keywords` | SEO per platform + GEO associations/claims |
| `checks.yaml` | `checks[]` | User-level rules; unioned with skill `checks.yaml` |
| `active.yaml` | `active` | Which variant is LIVE per platform (D11) |
| `deployments.yaml` | `deployments` | v1.3 (D18): per-entry deploy ledger — ledgerKey → surface → `{deployedAt, contentHash, source}`. Key space: root block names (`identity`/`positioning`/`keywords`) or `block:key` composites (`bios:…`, `headlines:…`, `skills:…`, `socialHandles:…`, `experience:<id>`…). Only `pasco` mutates it (`--mark` / deploy commands, D14) |
| `credentials.yaml` | `credentials[]` | v1.4 (D17): third-party attestations (certificate/title/award/patent) — issuer, verifyUrl, issued/expires, visibility (§18). Naming discipline: never called evidence (§18.1) |
| `artifacts.yaml` | `artifacts[]` | v1.4 (D17): works/media (portfolio/gallery/showreel/dataset/document/code) — `locator: {url \| path}` (capability matrix §18.3), checksum, license, tags, visibility |
| `faq.yaml` | `faq[]` | v1.10 (issue #288): the citable answer surface — 3–20 fact pairs (`id` §19.2 shape; `q` ≤ 90 per value + unique per workspace, core-check in geoCheck v2 #289; `a` ≤ 320; optional http(s) `source` = an answer with no pointer is a claim). Projected as `FAQPage` JSON-LD ONLY when present |

Files are optional (a fresh user may start with `identity.yaml` only); the schema only
requires `identity`. Unknown top-level properties **fail validation** (`additionalProperties:
false`) — that IS the "fail on schema" side of D12.

## Validation semantics (`pasco validate`)

1. **Schema** — merged profile must conform to `profile.schema.json`. Violations → **FAIL**
   (exit code 1) and a precise path + message per error.
2. **Drift (facts)** — cross-platform contradictions (same date/role/paper written differently
   on two surfaces), link duplication outside `identity.links`, `start > end`, unresolved
   DOI/ORCID. → **WARN** (exit 0) — D12: users may have different intents per platform.
   v1.1 (brand): the handle-matrix rules run here too (`drift/duplicate-handle`,
   `drift/handle-claimed-not-linked`, `drift/handle-host-mismatch`) — offline and
   deterministic; live reachability ships in `skills/github-org/checks.yaml` (`url-live`).
3. **GEO** — `geoCheck`: fact consistency score, semantic-association coverage, structured-data
   readiness. Brand workspaces emit `schema.org/Organization`; person workspaces keep `schema.org/Person`.
   v1.6/§15.4: `sameAs` = the `role: realization` links + claimed handle urls (before v1.6 it was
   every `identity.links` entry), `@id` from the `role: identity` link. → report, not a gate.
4. **Ledger integrity (v1.3, D17 §18.2 — post-Zod, same FAIL class as schema)** — checks the
   generated Zod cannot express: duplicate `id` per row block; ambiguous composite key
   (`bios:*`, `headlines:*`, `skills:*`, `socialHandles:*`) **when the ledger addresses it**;
   ledger keys outside the §18.2 key space; surfaces outside the D16 enum. The JSON Schema
   declares the key constraints via `propertyNames`, but gen-zod drops `propertyNames` —
   core re-checks, so `pasco validate` and `scripts/schema-check` enforce one behavior.

## Rules enforced by the schema

- **i18n (D8/§11):** every text block is a `langMap` with `en` **required**. `es`/`fr` optional.
- **URLs only from `identity.links`:** renderers/skills never invent URLs; a URL that appears
  elsewhere must exist in `identity.links` or it is a drift warning.
- **GEO anchors:** `positioning.geo.semanticAssociations` 3–5 items; `projects[].evidence[]`
  claims carry a resolvable `source` + `verified` date.
- **Checks catalog:** `rule` is an enum (`max-chars`, `min-chars`, `url-live`, `fact-present`,
  `geo-consistent`, `lang-present`, `link-in-identity`) — the same catalog used by
  `skills/<platform>/checks.yaml`, so `pasco check` runs the **union** of user + skill checks.
  v1.1 (brand): `handle-claimed` and `handle-consistent` join the catalog.

## Non-goals of the schema

- No cross-field relational rules (start ≤ end, DOI format vs ORCID match) — JSON Schema
  can't express them; they live in `core.driftCheck`/`geoCheck` (documented in SPEC §7).
- No per-platform text requirements (limits, min lengths) — those come from each platform's
  **skill** (limits change; the contract doesn't hardcode them).
- No variant bodies — variants live in the workspace variants store; `active` only records
  the chosen id (D11).

## Versioning

- The schema is versioned by directory: `schema/v1/…` when v2 arrives (breaking changes only).
- Additive changes (new optional fields) can land in v1; `additionalProperties: false`
  guarantees unknown fields never silently pass.
- **v1.1** (in this file, additive): brand flavor (D15/§17) — `flavor`, org identity
  variant, `socialHandles`/`newsletter`/`podcast`/`press`/`audiences`, brand platforms,
  `handle-claimed`/`handle-consistent` rules. Every v1 workspace still validates.
