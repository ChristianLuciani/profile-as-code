# @profile-as-code/core

The core engine of **profile-as-code** (M1): load a profile-data workspace,
validate it against the contract, and run the drift / GEO / compile layers.

The contract source is `schema/profile.schema.json` (D3) — Zod schemas are
**generated** from it, never hand-written (see `scripts/gen-zod.ts`).

## API

```ts
import { load, driftCheck, geoCheck, compile } from '@profile-as-code/core';

const profile = load('/path/to/profile-data');        // parse content/*.yaml + validate (FAIL on schema, D12)
const issues  = driftCheck(profile);                     // Issue[] — WARN only, never throws (D12)
const geo     = geoCheck(profile);                       // GeoReport — 0..100 score, not a gate (§8)
const slice   = compile(profile, 'linkedin', 'es');      // PlatformProfile — language-aware renderer slice
```

- **`load(workspace)`** — reads `content/*.yaml` (file name = root property:
  `bios.yaml` → `bios[]`, `identity.yaml` → `identity`, …), merges, validates
  against the generated Zod, normalizes (collections default to `[]`).
  Throws `LoadError` (workspace problems) / `SchemaValidationError` (contract
  violations with one precise `path` + `message` per error — the fail-on-schema
  side of D12). Unknown files fail validation via `additionalProperties: false`.
- **`driftCheck(profile)`** — factual contradictions across surfaces, all WARN
  (users may have different intents per platform, but they must SEE them):
  uncanonicalized platform URLs, `start > end`, duplicated bios/headlines,
  same role/org with different dates, same title with different year/venue,
  ORCID conflicts/mismatches vs `identity.links`, active entries without a
  curated base, unknown active platform keys, skill level conflicts.
  *Out of scope (v1):* free-text mining of bio prose, DOI resolvability
  (network), the variants store (only the platform+lang base is validated).
- **`geoCheck(profile)`** — weighted report (14 checks since v1.10, 0..100):
  **fact consistency** (conflicts + per-platform bio/headline coverage),
  **structured-data readiness** (`schema.org` Person JSON-LD with `sameAs`,
  ready for the web renderer), **semantic associations** (the 3–5
  `positioning.geo.semanticAssociations` anchors and how well each is
  reinforced across statement/skills/keywords/projects), **citability**
  (DOI/ORCID on publications, `evidence[]` on projects). Missing data is
  neutral, never penalized.
- **`compile(profile, platform, lang)`** — facts pass through untouched
  (identical on every platform = GEO-citable); text (bios, headlines, statement,
  audiences, citationsGoal) is filtered by platform+lang and falls back to `en`
  (always required by the schema), recording each fallback in `fallbacks`.

## Contract fidelity (generator)

`scripts/gen-zod.ts` regenerates `src/generated/schema.zod.ts` from
`schema/profile.schema.json`. Because `json-schema-to-zod@2.8.1` does not resolve
`$defs`, ignore `propertyNames`, and bloats `oneOf`, the generator:

1. inlines `#/$defs/*` references (fails on unknown/circular defs),
2. rewrites the lone `oneOf` (`check.value`) to `anyOf` (clean `z.union`),
3. materializes `langMap.en` as a real property (keeps `required: ['en']`), and
4. wraps every langMap with a `langMapKeys` superRefine enforcing the
   `en/es/fr` key enum (`propertyNames`).

Safety nets fail CI loudly if the output ever contains `z.any()` or loses the
langMap guard.

## Test

```sh
pnpm install
pnpm test        # vitest (load, drift, geo, compile)
pnpm build       # strict tsc → dist/
pnpm gen:zod     # regenerate src/generated/schema.zod.ts (must produce no diff)
```

Fixtures live in `tests/fixtures/`: `minimal/` (drift-free, GEO-rich — the
reference fixture) and `drifting/` (schema-valid but contradicts itself on
every drift rule).

Requires Node ≥ 22 (the `engines` field of this manifest). Full source and docs
live in the [public repository](https://github.com/ChristianLuciani/profile-as-code) —
`scripts/gen-zod.ts` and `tests/fixtures/` above are package-relative paths there
(`packages/core/…`); the contract source is the repository's `schema/profile.schema.json`.
