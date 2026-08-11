# schema/ — the contract (D3)

`profile.schema.json` is the **single source of contract truth** for a profile-data
workspace (JSON Schema, draft 2020-12). Per D3, JSON Schema is the contract source and
**Zod schemas are generated from it** in `packages/core` — never hand-written in parallel.

> Status: **v1** · The schema implements §6 of `docs/SPEC.md` as an executable contract.

## How content files map to the profile

`pac load(workspace)` reads `content/*.yaml`, **merges** them into one Profile object and
validates the result against this schema. File → root property mapping:

| File (content/) | Root property(s) | Notes |
|---|---|---|
| `identity.yaml` | `identity` | Required at profile level (the GEO anchor) |
| `positioning.yaml` | `positioning` | Statement, audience angles, GEO intent |
| `bios.yaml` | `bios[]` | Generated + curated; variant chosen lives here |
| `headlines.yaml` | `headlines[]` | Per platform+lang |
| `skills.yaml` | `skills[]` | With `geoKeywords` + `platformWeights` |
| `experience.yaml` | `experience[]` | start/end as facts (dates are language-independent) |
| `projects.yaml` | `projects[]` | With `evidence[]` (verifiable claims) |
| `publications.yaml` | `publications[]` | DOI/ORCID resolvable → GEO citability |
| `keywords.yaml` | `keywords` | SEO per platform + GEO associations/claims |
| `checks.yaml` | `checks[]` | User-level rules; unioned with skill `checks.yaml` |
| `active.yaml` | `active` | Which variant is LIVE per platform (D11) |

Files are optional (a fresh user may start with `identity.yaml` only); the schema only
requires `identity`. Unknown top-level properties **fail validation** (`additionalProperties:
false`) — that IS the "fail on schema" side of D12.

## Validation semantics (`pac validate`)

1. **Schema** — merged profile must conform to `profile.schema.json`. Violations → **FAIL**
   (exit code 1) and a precise path + message per error.
2. **Drift (facts)** — cross-platform contradictions (same date/role/paper written differently
   on two surfaces), link duplication outside `identity.links`, `start > end`, unresolved
   DOI/ORCID. → **WARN** (exit 0) — D12: users may have different intents per platform.
3. **GEO** — `geoCheck`: fact consistency score, semantic-association coverage, structured-data
   readiness (schema.org `Person`/`sameAs` for the web renderer). → report, not a gate.

## Rules enforced by the schema

- **i18n (D8/§11):** every text block is a `langMap` with `en` **required**. `es`/`fr` optional.
- **URLs only from `identity.links`:** renderers/skills never invent URLs; a URL that appears
  elsewhere must exist in `identity.links` or it is a drift warning.
- **GEO anchors:** `positioning.geo.semanticAssociations` 3–5 items; `projects[].evidence[]`
  claims carry a resolvable `source` + `verified` date.
- **Checks catalog:** `rule` is an enum (`max-chars`, `min-chars`, `url-live`, `fact-present`,
  `geo-consistent`, `lang-present`, `link-in-identity`) — the same catalog used by
  `skills/<platform>/checks.yaml`, so `pac check` runs the **union** of user + skill checks.

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
