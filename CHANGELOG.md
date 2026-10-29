# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tagged `vX.Y.Z`; until v1.0.0 the API is in active design (see SPEC §7) and
minor versions may contain breaking contract changes.

## [Unreleased]

### Added

- **`pasco discover` — a provisional Profile from public surfaces (#329)** —
  `pasco audit` needs a `Profile`; a prospect has none. Discovery reads only what
  a surface itself declares (schema.org JSON-LD + its links), attaches per-fact
  provenance (`surface` · `url` · `retrieved` · `attested: false`), lists `absent`
  fields instead of defaulting them, and runs `driftCheck` over the result plus
  the two classes discovery owns: `dangling-ref` (a same-host link that did not
  resolve) and `unsourced-claim` (a numeric claim with no source on the surface).
  One row per surface is kept on purpose, so a cross-surface date disagreement
  surfaces as `drift/duplicate-experience` instead of being averaged away.
  Transport is §19.5's: closed host allowlist checked **before** any request
  (registry platform hosts + `--allow-host`), sequential, no retries, no
  credentials, redirects refused. It writes nothing, and the provisional shape is
  not a schema version (SPEC §7.10).
- **Answer-engine surface, consumer half — `structuredData()` projects
  `identity.definition` + `faq[]` (#316)** — the v1.10 contract shipped in v0.3.6
  without an emitter; `structuredData()` now reads the fields. Person:
  `fields.description` + `jsonLd.description` from `identity.definition`
  (`[lang]` falling to `en`), emitted **only** when declared — never invented — and
  `description` joins the Person `considered` list, whose denominator is now fixed
  at 8 (counted as populated only when declared, so a person declaring the seven
  pre-v1.10 fields and no definition moves to 7/8: the declared, honestly-accounted
  delta). Brand: `definition` wins over `mission` in the same description slot —
  a definition-less brand keeps the v1.9 mission output byte-identical. The
  `FAQPage` JSON-LD node (`StructuredDataReadiness.faqJsonLd`) exists **iff**
  root `faq[]` exists — never an empty one — and carries no `@id` (the engine never
  invents an anchor); a `faq[].source` travels as `Answer.citation`. No consumer
  embeds `faqJsonLd` yet (renderers embed `jsonLd` only): the emitted node is the
  readiness surface the M5 web renderer will consume.
- **`pasco preview` — see the data without publishing it (#282)** — a private
  workspace had no way to *look* at the rendered result; the only options were to
  publish it or to read the base texts one by one, and Pages is not the missing
  piece (on personal plans the published site is public, so a private fork with
  Pages on publishes the data). The new command renders **one self-contained HTML
  file** — inline CSS, no `<script>`, no external asset, no HTTP server — whose
  sections are the surfaces `pasco build` would write (`#github-readme`,
  `#linkedin`, …), each with the check state, plus every surface this language
  does not publish (named with its reason, never dropped). The default writes
  `<workspace>/.pasco/preview/index.html` and opens it; `--out <dir>` writes and
  opens nothing, which is the CI-artifact transport (the workflow itself lives in
  the workspace template, not in the engine). **One artifact, not a second
  implementation:** the text is `renderArtifact`'s decision tree (active variant →
  renderer → shared paste source, with `build`'s selection gate) and the checks are
  the report `pasco check` prints — that report is now a `buildCheckReport()`
  function instead of a private body inside `runCheck`, so the two commands cannot
  drift. A **privacy gate** refuses the write (exit 1, and no file is left behind)
  on an absolute machine path, a credential shape, an external asset, active
  content, or a source that resolves outside the workspace: evidence-root media is
  never inlined, a remote image becomes a text note instead of a fetch, and raw
  HTML in the data is escaped rather than executed. `--now <iso8601>` pins the
  `generated <date>` stamp, so the page is byte-identical across runs. Contract in
  SPEC §7.9 (command row in §7); `--help`, the package README and the User Guide
  document it, and the privacy gate has its own seeded tests.
- **`pasco export profile --json` — the normalized profile for programmatic
  consumers (#348)** — the engine exposed `build <platform>` (text slices) and
  `validate`, but
  no stable object a consumer could read without **re-implementing** `load()` +
  `normalize()`. Both real consumers paid for that copy and drifted: the CV syncer
  read 9 of 14 roots (`education`, `languages`, `credentials`, `artifacts`
  hardcoded to `[]`), dropped an explicit `publications[].url` in favour of a
  DOI-derived link, and treated the invariant `experience[].org` as a langMap.
  The new command emits
  `{ schemaVersion, engine, source: { commit, generatedAt }, profile }`, where
  `profile` is exactly the normalized `core.load()` object: **every root the
  workspace declares, plus every *list* root defaulted to `[]`** (`faq[]` joins
  `normalizeProfile`'s defaults, so the shape no longer depends on whether answers
  exist); an optional *object* root (`newsletter`, `podcast`, `audiences`,
  `active`) appears only when declared, because the contract has no valid empty
  value for it. `artifactRefs` stay ids that resolve in `profile.artifacts[]`,
  `publications[].url` as declared, `deployments` included — never a CLI-local
  builder and never `compile(profile, platform)`'s platform slice (§15.4).
  `schemaVersion` (`"1"`) is the frozen payload version a consumer refuses if it
  does not know (the §7.1/§7.2/§7.3 key and precedent). **Deterministic by
  construction:** no clock is read — `generatedAt` is `null` unless `--now
  <iso8601>` pins it verbatim after a real-calendar check — and `source.commit` is
  the workspace git `HEAD` (`null` outside a repository), so two runs over one
  workspace are byte-identical and a committed golden fixture asserts the exact
  bytes. Contract in SPEC §7.5 (command row in §7); the `--help` output and the
  package README document it. **Separately, criterion 3 — validator parity** is
  now pinned by a test: `validate` and `build` both load through `core.load()`, so
  they resolve the same schema and the same `additionalProperties` policy; the
  fixture carrying `projects[].artifactRefs` (the v1.12/#333 witness) is accepted
  by both, and an injected unknown row field is refused by both with identical
  violations (`export profile` shares that load path and is asserted with them).

- **The `.pascorc` engine gate and `pasco doctor` (#348)** — a workspace can now
  declare the **minimum engine** it requires, and the commands that do work refuse
  early instead of failing on a contract they do not know. `.pascorc` gains an
  optional `"engine": "MAJOR.MINOR.PATCH"` field (a **lower bound**, exactly three
  numeric components — no `v`, range operator or wildcard; the repo stays
  dependency-light, so there is no semver range engine). `validate`, `build` and
  `export profile` check it **before loading or rendering**: an older install exits
  `1` with the required version, the installed version and the upgrade command
  (`npm i -g @profile-as-code/cli@latest`); a malformed value exits `1` naming the
  field, the value and the accepted syntax. Absent means no requirement, so every
  existing workspace keeps working. Every `.pascorc` the resolution consulted is
  read — the cwd `.pascorc` that pointed at the workspace AND the workspace's own
  file — and the **stricter** declaration wins (a malformed one in either file is
  refused); an explicit `--workspace` uses only the workspace's file. **`pasco
  doctor [--json]`** is the reading surface — chosen over overloading `--version`,
  which describes the binary and must work with no workspace, while `doctor`
  describes the pair: one line with the installed engine, the profile-contract
  version this build validates (derived from the schema `$id` at `pnpm gen:zod`,
  never a literal), the resolved workspace and whether it loads, plus the
  effective requirement and its `.pascorc` (`met`/`NOT MET`/`INVALID`). Exit `0`
  healthy · `1` unhealthy · `2` usage; offline, no clock, no writes. It reports
  the same truth the gate enforces; it does not replace the gate. Contract in SPEC
  §7.6; the `.pascorc` field in USER-GUIDE and the package README.

- **The published schema contract for consumers without the engine (#348)** — a
  consumer that only validates a profile no longer has to install the CLI.
  `schema/consumer-contract.json` records the contract's **URL + sha256**: the
  immutable copy at a released tag
  (`https://raw.githubusercontent.com/ChristianLuciani/profile-as-code/v0.3.6/schema/profile.schema.json`,
  schema v1.13, sha256 `275340ff…`) and the committed `current` bytes (v1.14,
  sha256 `1745ac…`) with an explicit publication truth — **no published artifact
  yet** (`published: false`, `artifact: null`), because no tag carries v1.14. The
  released v1.13 artifact **rejects `publication.kind`** (`additionalProperties:
  false`), so a consumer that needs `kind` must use a v1.14 checkout and verify
  the sha256 until the next release; the manifest notes and the reading guide say
  so where they tell a consumer how to validate. `node
  scripts/schema-contract/check.mjs --check` runs in CI with **no network**: it
  recomputes the committed hash, reads the tag copy from local git, refuses a
  `current` publication claim it cannot join, a stale/moved artifact, a malformed
  tag/hash, or any URL that is not the exact public repo's tag-pinned raw file
  (never a floating ref or a private path, AGENTS.md rule 9). `--write [--tag]`
  enforces the same tag existence and reachability as `--check` and derives
  publication instead of inventing it. The self-test proves each refusal,
  including the CLI rows end-to-end; a pin that is no longer the newest tag only
  warns. The reading guide (`docs/SCHEMA-CONTRACT.md`, SPEC §7.7) states where to
  fetch it and what structural validation does **not** cover (the cross-file
  invariants core re-checks, engine behavior, `.pascorc`, the payload envelope).

- **`publication.kind` — the output classification moves into the contract (schema
  v1.14, #349)** — `publications[].kind` is an optional, closed enum
  `journal-article` | `preprint` | `conference-abstract`: the structured answer to
  *what kind of output is this*, which until now lived outside the contract as
  per-consumer `venue`-string heuristics ("Carbon Trends" → peer-reviewed, "SSRN
  Electronic Journal" → preprint, "… (abstract)" → abstract) — a new venue failed a
  consumer's checker and needed hand classification. **`peerReviewed` is derived, never
  stored:** exactly `kind == journal-article`, the same derive-never-store discipline as
  published-vs-in-development (§15.3/§20.1); an exception requires a SPEC decision
  before a boolean exists. Additive: a row without `kind` validates and renders
  byte-identically, every existing workspace stays valid, and no renderer output
  changes. Consumers that need counts must require the field explicitly. Contract in
  SPEC §6; `Zod` regenerated from the schema (D3). — *The consumer workspace's
  claim-sidecar heuristic becomes a schema fact (#349); `publications.counts` in the
  compiled profile remains #348's follow-up.*

- **The seam-cohort publish is rehearsed before it is irreversible (#313)** —
  `scripts/release-rehearsal/` packs the five seam packages with the same client the
  release uses (`pnpm`, whose `workspace:*` rewrite is the #301 mechanism) and
  asserts, offline and deterministic, the publish ORDER against the workspace
  dependency graph, the shipped manifests (public access, exact rewrite target,
  resolvable entrypoints, `repository.url`), and release.yml's own mechanism —
  every publish invocation outside the `--dry-run` branch is `pnpm publish`, the
  loop iterates `$ORDER`, the publish job's effective `permissions:` grants
  `id-token: write`, the rehearsal barrier exists before the loop, cohort before
  CLI, and every publishable workspace member except the CLI itself (which has its
  own publish step) is in the cohort. It publishes nothing
  and holds no token; it runs on manifest PRs (`release-rehearsal.yml`), by hand
  (`pnpm rehearse:release`), and as a pre-publish barrier inside `release.yml`, so a
  broken manifest fails before npm consumes a version. The facts a rehearsal cannot
  create — the OIDC exchange and the five `dist.attestations` — are declared as
  #313's open evidence in `docs/ci-cd.md` §"Rehearsing the cohort publish".

- **`pasco cite-check [<answers.ndjson>]` — the deterministic citation matcher
  (#291)** — every GEO offer is priced in "prompts monitored per month", and the
  half that decides whether the number is true is one question: **did this answer
  cite this entity?** The network half belongs to the runner; this command answers
  the matching question over the answers it already saved — NDJSON in (stdin by
  default), one row per answer out (`{ line, cited, confidence, spans, reasons }`),
  **never aggregated**. The ladder is fixed: `citation-url` (a saved citation on
  the entity's own page or its `sameAs` set — host plus the declared path, so
  `github.com/<you>` does not match `github.com/someone-else`) and `exact-name`
  (word-bounded, case- and accent-normalized through the new
  `core/src/normalize.ts`; `geoCheck` keeps its case-only comparison and its
  published score is unchanged) are **high**; `alias`
  (`identity.orgName`) and `handle` (declared handles; claimed `socialHandles`) are
  **medium**; `partial` (a multi-token prefix of the name) is **low**, and low is
  **never** a citation downstream. It refuses to guess: a one-word name whose
  sentence has no declared disambiguator (`ambiguous-term:…` + `no-qualifier`,
  with the longer capitalised phrase the text carries named as `competing:…`), a
  mention after a contrast marker (`contrast-context`), and a shorter declared term
  inside a longer one (`longer-name:…`) come back `cited: false` — a declared
  qualifier or an adjacent capital never disqualifies a hit by itself. Malformed
  NDJSON is exit `2`, naming the 1-based line
  and the field — never a silent skip, because a skipped line changes a rate —
  and a citation URL that does not parse (a missing scheme is the common case) is
  named `url-invalid:<url>` rather than dropped, for the same reason;
  while a non-citation is exit `0`: this is a measurement, not a gate. No network,
  no model, no clock (D19). Contract in SPEC §7.4. — *The engine half of
  answer-engine citation measurement.*
- **`pasco export ai-policy [--out <dir> | --check]` — the training stance as an
  artifact (#290)** — SPEC §12 M9 fixed the position (published surfaces block
  AI-training crawlers by default, retrieval must stay open) and no file said so.
  One command now generates all three from the workspace and the platform
  registry: `robots.txt` with **two named groups** (`ai-retrieval` → `Allow: /`,
  `ai-training` → `Disallow: /`) and a comment per `User-agent` naming its
  registry entry, operator, source and read date — never a wildcard, and the file
  **declares the limit** that comes with that: it restricts exactly the tokens it
  lists, so a crawler it does not name is not restricted by it (RFC 9309 §2.2.1);
  `llms.txt`, the workspace index (name · definition · canonical `role: identity`
  URL · `faq[]` · `publications[]`) in the shape the project site already uses,
  with a **coverage assertion** that fails when a document the builder claims to
  index is missing from the text; and `AI-POLICY.md`, the statement you send a
  client — allowed, blocked, who can change it, the date, the stance quoted
  verbatim, and each crawler's own source URL. The crawler list is **derived
  data**: it lives in the `ai:` block of `platforms/registry.yaml` and
  `pnpm gen:platforms` projects it into the engine (a hardcoded UA list would rot
  without a failing command); the generator refuses an entry with no `source`, an
  unknown family, a duplicate token or a stance the SPEC does not state.
  `--check` exits `1` on an incomplete or unsourced entry, a duplicate token
  (case-insensitive), an `as_of` that is malformed, future-dated or older than
  **180 days**, or a `policy.as_of` that is stale/future-dated or predates the
  newest row it seals — and `--out` runs the same check before writing, so rot is
  a failing command. The project site's own `robots.txt` is generated from the
  same `ai:` block, so the engine's published surface states the same policy.
  `--out` also refuses to truncate a file pasco did not generate without
  `--force`, and reads no clock (the stamp is the registry date, so outputs are
  byte-identical across runs). Offline; contract in SPEC §7.3. — *M9's artifact
  in SPEC §12.*
- **`pasco entity [--json | --jsonld]` — the entity projection for surfaces the
  engine does not render (#287)** — `audit` diagnoses, `entity` is the fix. The
  schema.org entity the renderers embed is exposed as an artifact: `--json` is a
  frozen, `schemaVersion`-stamped view `{ entity: { id, type, name, sameAs,
  email }, gaps, jsonld: null }` (gaps are the structured-data `geoCheck` codes
  that scored below 1, verbatim — no new vocabulary), and `--jsonld` is the
  **same assembler output** serialized as a paste-ready
  `<script type="application/ld+json">` block (`--bare` = bare object, `--out
  <file>` = write it atomically; an existing file is refused without `--force`).
  One assembler: `core/src/structured-data.ts` — the CLI never re-derives the
  entity (SPEC §7.2). Both modes resolve one `lang` (`--lang`, else `.pascorc
  defaults.lang`), so `geoCheck(profile, lang)` measures gaps in the language the
  block emits. `@id` is never invented: it is the URL of the `role: identity` link
  or `null`, and exit `1` when absent / `0` when present. Offline and
  deterministic. — *Answer-engine surface in SPEC §12.*
- **`pasco audit [--json]` — the offline diagnostic projection (#283)** — a
  per-identity aggregate over the checks that already exist, emitting **findings
  only** (no score, no prioritisation, no branding — SPEC §7.1). Three fixed
  classes with fixed severities: `dangling-ref` (a pointer that does not resolve)
  and `contradiction` (two surfaces disagreeing on one datum) are FAIL; an
  `unsourced-claim` (a quantitative claim with no evidence) is WARN. Exit `1` iff
  a FAIL exists; `--json` carries `{ schemaVersion: "1", scope: { catalog,
  declared, checked, notRun }, findings: [{ class, severity, path, detail }] }` where
  `scope` is the artifact side (so "measured nothing" is distinguishable from
  "clean") and `path` is a factRef (row id in place of the index) or the artifact
  path for a surface finding. Offline: no network, and no finding is derived from
  `content/deployments.yaml`. It is deliberately stricter than `validate`/`check`
  on the FAIL classes, and `drift/url-not-in-identity` (the URL resolves) plus
  `geoCheck`'s coverage codes are declared no-class rules, in SPEC §7.1. D23 is operator-ratified; its
  normative entry into the SPEC is pending in #262. — *M11 in SPEC §12.*
- **`fact-present` — the rule the ledger recorded as missing (`PROP-017 §Risks
  F2`)** — executed by `pasco check` for the surfaces whose catalog declares it
  (workspace `content/checks.yaml` ∪ the shipped `skills/<platform>/checks.yaml`):
  the artifact `pasco build` last wrote is compared against the SSOT render
  **symmetrically** — a URL, ISO date or number the surface adds or omits, and a
  text difference no fact token explains. All are WARN in `check` (D12: facts
  warn) and classified by `pasco audit` (a URL the surface adds is `dangling-ref`;
  every other disagreement is `contradiction`). No artifact = **not run**, and
  `declared: []` = no premise declared — never a silent OK.
- **`pasco post` — long-form seeds and the short family (#266)** — `post.yaml`
  gains `format: short | longform` (the format belongs to the seed) and
  `derivedFrom: <seed-id>`; a short child derived from an essay via
  `post task <child> --format short --from <essay>` has no `seed.md` and links
  back to the parent. New `skills/<channel>/longform.yaml` for `substack`,
  `ghost`, `medium`, `devto`, `hashnode`, `wordpress`, `listmonk` carries
  `fields` (required `title`/`dek`), an editorial word band, and
  `export: api | paste`. `post check` validates the long-form front matter,
  word count, SSOT URLs (canonical included), dangling fact refs and a dangling
  `derivedFrom`; `post export` writes the Postiz settings mapping for API
  channels and a `paste-checklist.md` for Substack/Ghost. Posts stay outside
  `profile.schema.json` (D17); images are not a v0 field.

### Planned (roadmap)

- Renderers: linkedin, upwork, x, researchgate, substack (M4)
- CLI `pasco`: the full `refine` flow (M3)
- Per-platform skills v1 from SOTA research (M3)
- Web renderer (M5)

## [0.3.6] - 2026-10-26

### Added

- **`identity.nationality` — a citable nationality fact (#334)** — the ISO 3166-1
  alpha-2 code, uppercase (`VE`), as a fact distinct from `identity.location`
  (residence). The schema pattern `^[A-Z]{2}$` rejects `ve`, `Venezuela` and `VEN` at
  the boundary. `structuredData()` emits schema.org `nationality` as
  `{ "@type": "Country", identifier: "<code>" }` on the Person entity JSON-LD —
  Person-only, since a brand has no nationality. Optional and outside the
  structured-data `ready` gate **and completeness ratio**: a workspace that omits it
  validates, emits, and scores exactly as before. Schema contract v1.13 (additive,
  pre-v1.13 workspaces validate unchanged); `@profile-as-code/core` 0.1.1.
- **Schema v1.12 — a project names its artifact (#333)** — `projects[].artifactRefs`
  references `artifacts[].id`, the third reference site after `publications[]` and
  `press[]`. It stores the edge only: published-vs-in-development is **derived** per
  artifact (`visibility: public` + `locator.url`), never a stored flag (§15.3/§20.1).
  `load()` fails on a dangling ref, and `pasco check` fails when the target is not
  public (§18.5 — the leak gate now covers every reference site).
- **`pasco edit` — a contract edit surface, S1–S5 (#248–#252; epic #247)** — address
  **one** contract field by contract path (never line/offset): read its current value
  (S1), `--set` writes it with a comment-preserving byte-range splice — validated and
  atomic, one-line diff (S2) — `--set --check` previews the published lines the
  edit changes (S3), and writing text pre-flights the platform's published cap at
  edit time (S4; `content/checks.yaml` when declared, else the shared limits table).
  S3 also reports the unit's per-surface staleness from the §19 ledger. S5 freezes
  the machine-readable contract and names the `#238` variant, so an agent consumes
  `pasco edit` without parsing prose. Writer concurrency is covered under Fixed
  below.
- **Answer-engine surface — `identity.definition` + `faq[]` (schema v1.10, #288)** —
  the two things an answer engine can quote: a canonical per-language definition
  (≤ 160 chars per value, must contain the entity name) and 3–20 citable Q&A pairs
  (`q` ≤ 90 and unique per workspace, `a` ≤ 320, optional http(s) `source`). This
  release ships the **contract**; the `structuredData()` projection of these fields
  (Person `description` + the `FAQPage` JSON-LD node) is tracked in #316 and is not
  emitted yet.
- **Funding rails — the project is now easy to fund** — `funding` field in the CLI
  manifest (GitHub Sponsors · Ko-fi · Patreon; `npm fund` and the npmjs.com package
  page surface it natively), a `--help` footer tip line, a Support section on the
  package README, the three badge rails in the root sponsor section, the vendored GitHub
  mark on the landing and docs chrome, and the `ko_fi:`/`patreon:` rails in
  `.github/FUNDING.yml`.
  Deliberately not: no post-install script, no donation nag on every command — the
  ask lives in `--help` and the READMEs only.

### Changed

- **GEO scores move: geoCheck v2 (#289)** — five citability codes join the report
  (`geo/canonical-definition`, `geo/faq-coverage`, `geo/freshness`,
  `geo/sameas-coverage`, `geo/name-collision`), funded by diluting the nine pre-v1.10
  checks ×0.8 (the weights still sum to 1, asserted). **Reported GEO scores move for
  most workspaces** — the five codes enter the weighted report; a workspace already at
  the ceiling on all 14 stays at 100. The new `GeoCheck.severity` tier is additive and
  `info` never changes the pass/fail story.
- **The release publishes the seam cohort in dependency order (#301)** — core →
  markdown → paste → artifact → github via `pnpm publish`, which rewrites the
  runtime `workspace:*` dependency, then the CLI via `npm publish` over OIDC; a
  package whose version is already live is skipped.
- **Deterministic ordering is ICU-free everywhere (#305)** — every text sort delegates
  to core's `byteOrder` (UTF-16 code units), so output is byte-stable across locales.

### Fixed

- **`pasco edit` writer hardening (#332)** — the preview refuses what the write
  refuses, anchored/aliased scalars are refused, the writer re-reads immediately
  before the atomic rename and refuses on drift, and an advisory lock closes the
  last-writer-wins window; concurrent edits on one workspace keep both values.

## [0.3.5] - 2026-10-24

### Added

- **`docs/START-HERE.md` — the map each reader was missing (#260)** — the dogfood run
  (2026-10-19/20) broke at five points the guide never covered: editing the wrong YAML file,
  editing without an editor, being cut by a platform cap a green `validate` never warned about,
  deploying by PR from the wrong directory, and `links[].role: identity` (the one line worth
  +20 structured-data points, documented nowhere). Three routes (person · contributor · agent),
  each with the mistake that route actually makes, plus the USER-GUIDE sections they read next:
  the seven-step cycle of one change (§0.5), the first edit without an editor, the `links[]`
  role rule, platform caps at edit time (§6), and deploy by PR with the `.pascorc` discovery
  trap (§7). The issue's proposed §4.1/§8.3 **were already taken** (golden rule, multi-workspace),
  so the new material sits at §4.4 and inside §7 — an addressed deviation, not a silent one.
  Published as a page (`site-config.mjs`), so the same Markdown is the only copy, and CONTRIBUTING
  ground rule 8 makes "the doc line" part of every dogfood finding.
- **Derived publication truth — `pasco status` now says whether the artifact is the one
  the SSOT produces (SPEC §20.1, #242)** — the 2026-10-19 dogfood found every gate green
  while the published profile was not verified in the terms a user cares about: a green
  score over an unpublished artifact, a green `check` over a field the platform truncates,
  and a declared-but-ignored variant. Each surface with a ledger record or an artifact on
  disk now gets three orthogonal axes — `sync` (§19, unchanged), `artifact`
  (`matches-SSOT` / `diverges` / `absent`, offline, against the SSOT's current render),
  and `limits` (`ok` / `over(cap)`, the #240 catalog). Derived on every read and stored
  nowhere (§20's own rule), folded into `--completeness` as **coverage of publication**
  (the weighted percentage never moves because a surface drifted) and into the generated
  `CHECKLIST.md`. Additive in `--json` (`publication`), and the one cap executor moved to
  `packages/cli/src/limits.ts` so `check` and `status` share it — and the planned
  `edit` slices (#248–#252) consume it instead of a second cap table.
- **The platform skills ship with `@profile-as-code/cli` (#253)** — `skills/` is copied
  into the package at build/pack time (`files: ["dist","skills"]`) and resolved from the
  package root, so `pasco refine` prints a real `SKILL.md` path on an npm install instead
  of the repo-dev layout a user does not have. The output now distinguishes *no skill for
  `<platform>`* from *skills not shipped with this package*; `post` reads the same tree.

### Changed

- **The workspace has three top-level grains, and the scaffold now says so (#267)** —
  `content/` is identity (the SSOT), `profiles/` is generated output, `posts/` is the stream
  (seeds + per-channel projections, #264) — never identity facts. `pasco init`'s README
  templates state the boundary for both flavors, SPEC §9's tree carries `posts/`, and
  `docs/post-mvp.md` names the rejected nestings (`content/posts`, `content/identities`,
  `content/profiles`). No rename, no schema change, no move of existing workspaces.
- **The recommended on-ramp now resolves for a stranger (#273)** — `profile-data-template`
  went public (verified 2026-10-23: `gh repo view ChristianLuciani/profile-data-template
  --json visibility` → `PUBLIC`, HTTP 200), so its removal trigger fired: the link-check
  declaration in `scripts/link-check/allowlist.json` is gone (the registry is empty, the
  `W-ALLOWLIST-UNUSED` warning keeps it honest). The surfaces reconciled here — `README.md`,
  `docs/USER-GUIDE.md`, `docs/SPEC.md` §9.2, `docs/STANDARDS.md` (community items 4, 5, 10
  and the publication section), `docs/ci-cd.md`, `site/index.html` — state the template as
  public and cite the verification where they make the claim; `check.mjs`'s header documents
  the mechanism. The wider class (surfaces still calling the *engine* repo private) is
  tracked in #293, not silently dropped. No duplication: `templates/profile-data/`
  stays a pointer; re-scoping to a second in-repo template would have created a second source
  of truth for zero reader benefit.
- **`pasco skills:install <agent>` → `pasco skills:export <dir> [--force] [--list]` (#254, C1)** —
  the CLI no longer prints a projection command for a private studio. It copies the
  skill channels it ships into a directory the user names (a non-empty destination needs
  `--force`, which overlays and never deletes), and no published surface references a
  path/repo/tooling the reader cannot open (rule now in AGENTS/CONTRIBUTING). The tarball
  is asserted by `verify:pack`.
- **The hosted on-ramp is a declared v1 non-goal (#221), and the surfaces that still called it
  a plan are reconciled (#222)** — §9.2's three on-ramps (A template repo · B `pasco init` ·
  C bring your own storage) all require a terminal, and A also an account, so a visitor with
  **neither** has no path; in particular **none** reaches a profile **hosted by us**.
  `docs/SPEC.md` §2 declares that path a **v1 non-goal**: the service it would need is
  multi-tenant (accounts, storage, secrets, privacy, cost) and inverts the folder-first model
  (D14), so it reopens only on its trigger — the first hosted use case, or M5 + web consumption
  live — and as a **milestone of its own**, not an extension of M5 (§12 keeps M5 a consumption
  renderer). `docs/USER-GUIDE.md`, `README.md` and `docs/ROADMAP.md` are reconciled to that
  state; the `#122` tracker is closed and is no longer a deliverable.

## [0.3.0] - 2026-10-11

### Added

- **Profile completeness — engine-computed checklist + percentage (SPEC §20, issue #102)** —
  the schema is deliberately permissive (`identity` is the only required block), so a
  workspace at 5% and one at 95% produced the same green `pasco validate`: a passing check
  with no direction. New pure, deterministic, offline `completeness(profile, policy)` in
  `packages/core/` (beside `geoCheck`, SPEC §7) scores five weighted items over signals
  already in the engine — `presence` (flavor-aware expected blocks), `langCoverage` (en/es/fr
  over every langMap), `geoAnchors` (associations reinforced elsewhere), `evidence` (sourced
  claims + registry) and `deployment` (share of trackable units with a ledger record) — with
  `COMPLETENESS_CATALOG` + `DEFAULT_COMPLETENESS_POLICY`. The percentage is **never stored**:
  only the policy is, read from `.pascorc` `"completeness"` (`target` / `langs` / `items`; a
  `weight` of 0 drops an item from the denominator), and `compile()` attaches the report to
  the slice so the renderer emits it verbatim rather than recomputing it. `pasco status
  --completeness [--json]` prints the checklist + percentage; `--write-checklist` folds the
  line into the generated `CHECKLIST.md` (D18 — the view is where the user looks);
  `github-readme` emits one deterministic line (`Profile completeness: <pct>% — <n>/<m>`)
  only when the slice carries a report — a hand-built slice renders byte-identical to
  before. No new required schema field: completeness is advisory (D12 preserved).

- **Publishable-surface gate — only `packages/cli` may omit `private: true` (#190; the
  surface set by #189)** — the 11 bundle-only workspace packages are marked `"private":
  true` (they ship inside the CLI bundle, not as standalone npm packages), leaving
  `@profile-as-code/cli` as the only publishable manifest — but after #189 that invariant was
  convention-only. `scripts/publishable-gate/` (the `scripts/dep-gate` /
  `scripts/typecheck-gate` shape: a fail-loud `--check` plus a fixture self-test that runs
  first) asserts every workspace manifest outside the explicit allowlist declares `"private":
  true`, so a new package (e.g. the planned `packages/server`) cannot silently rejoin the
  accidental-publish surface with every gate green. It reuses dep-gate's exported workspace
  walk instead of re-implementing it and runs in the pre-install block of `ci.yml` (fail
  fast). The gate verifies, never fixes, and its `E-GATE` vocabulary refuses the pathological
  shapes — non-object manifest, parser refusal — instead of crashing with a `TypeError`
  (#195, #199).

- **CLI — the documented `pasco diff` no-match `tagPattern` fallback is pinned by tests
  (#197)** — `docs/USER-GUIDE.md` §5 documented that a workspace whose `diff.tagPattern`
  matches no tag falls back to the root commit, but that was verified only by hand: a change
  to `packages/cli/src/commands/diff.ts` could silently invalidate the doc. Two vitest cases
  now lock it with a **non-default** `diff.tagPattern: "rel-*"` fixture (so the `.pascorc`
  read is load-bearing, not the engine default): no matching tag → `tag: null`, base = the
  root commit, the post-root commits and `hasChanges: true`; adding `rel-1` → `tag: "rel-1"`,
  base = the tagged commit, no commits, `hasChanges: false`. No behaviour change.

### Changed

- **SPEC §9 — the workspace is a folder; the three on-ramps are declared as peers (#200)** —
  the contract and the guides treated this repository as *the* shape of the workspace, and
  every surface assumed the reader was standing in it. But the local path already works
  (`pasco init`), some users want no repo at all, and a prospective user can arrive from the
  npm catalog, a search engine, an agent or a shared link. §9 is retitled *"the profile-data
  workspace (folder-first; a repo is recommended)"*: the only hard requirement is a folder
  `pasco` can read by configured path whose `content/*.yaml` satisfies the schema, and a repo
  (GitHub, another git host, or none at all) is the **recommended** home. New **§9.2**
  declares three on-ramps as peers with their capability differences up front: A template
  (automation + history; requires account/repo) · B local `pasco init` (no account, no repo;
  loses automation and history) · C the same `pasco init` scaffold written at a path you
  choose. **D14 is amended** ("separate repo" → "separate workspace; a repo is the
  recommended home, not a requirement") and §3/§4/§10/§13 are reconciled; `docs/USER-GUIDE.md`,
  `packages/cli/README.md` (the npm page), `README.md`, `templates/profile-data/README.md` and
  `docs/STANDARDS.md` carry the same framing. No engine behaviour changes.

- **Release docs reconciled against the real v0.2.0 publish (#192)** — the post-release
  surfaces still claimed the package was unpublished. Corrected against the actual sources
  (tag, GitHub Release, npm registry, a running bin): `docs/STANDARDS.md` item 3 (`Tagged
  release + changelog`) `❌ blocker → ✅`, `docs/USER-GUIDE.md`, `docs/ci-cd.md` and
  `packages/cli/README.md`; and `packages/cli/package.json`'s `bin.pasco` was normalized with
  `npm pkg fix` (`"./dist/index.js"` → `"dist/index.js"`), removing the single npm manifest
  auto-correction the v0.2.0 publish warned about.

### Fixed

- **`dep-gate` and `typecheck-gate` refuse a non-object manifest instead of crashing (#198)** —
  a `package.json` containing the JSON literal `null` parses without throwing, then crashed
  both gates on `manifest.name` with a raw `TypeError` instead of their declared `E-GATE`
  vocabulary (fail-loud, but the wrong failure shape — and the refusal class had no committed
  fixture). Both now guard the manifest shape right after the parse, pinned by a
  `null`-manifest fixture in each sibling self-test. The same pass closed two adjacent
  escapes found in review: `tsconfig.test.json` = `null`, and a `pnpm-workspace.yaml` whose
  quoted glob the reused parser refuses (whose `GateError` class did not match
  `typecheck-gate`'s own catch).

## [0.2.0] - 2026-10-09

**First public release.** This section covers what changed since the 2026-10-06
prep; the untagged `## [0.1.0]` section below (schema v1, the core engine, the
`pac` → `pasco` rename, brand flavor, the evidence registry) is the project's
pre-release history and was never tagged or published.

### Added

- **CI — offline, self-tested link gate for the Markdown corpus (#149)** —
  `scripts/link-check/` (checker + fixture self-test first, the `scripts/dep-gate`
  shape): every relative link/path in the tracked, non-hidden Markdown doc areas
  must resolve to a file or directory, every in-page anchor must match its
  destination's headings under GitHub's slug rules (the expected anchors are
  committed as `github-slugger@2.0.0` output and asserted by the self-test), and
  private targets go through an allowlist that requires a reason + removal
  trigger. Offline and deterministic — external URLs are never fetched — so the
  required check cannot depend on third-party uptime. Runs after the pinned Node
  setup and before `pnpm install` (fail fast).

- **CI — every package type-checks its tests, and the wiring is gated (#181)** —
  each package gains a `tsconfig.test.json` that extends its own tsconfig (single
  source for compiler options) and adds `tests/**`, the root `*.config.ts` and
  `scripts/**`; `pnpm -r typecheck` now covers the suites, so a mistyped shared
  contract (e.g. `@profile-as-code/paste/conformance`) fails the gate. A node-only
  `scripts/typecheck-gate` runs first and refuses a package whose `typecheck`
  script omits the test program — without it, `pnpm -r typecheck` silently skips
  the package and CI stays green.

- **Platform registry — per-platform metadata now has one machine-readable home (#154)**:
  `platforms/registry.yaml` carries the metadata that used to live hand-written across ≥7
  surfaces (family, deploy kind, hosts, subdomain hosts, handle hosts, status, since, issue,
  sources). `pnpm gen:platforms` (`scripts/gen-platforms/`, the D3 drift-check shape) projects
  every derived surface: `packages/core/src/generated/platforms.gen.ts` (the host maps + slug
  list consumed by `drift.ts`/`types.ts`, plus the derived test enumerations), the SPEC §6
  family table + count arithmetic and the README status counts between explicit
  `<!-- gen:… -->` … `<!-- /gen -->` markers. The reviewed contract is unchanged — the schema
  keeps `$defs.platform.enum` (D3) — and CI asserts registry ↔ enum ↔ generated agree
  (`scripts/schema-check/check.py` + `node scripts/gen-platforms/gen.mjs --check`), including
  the reverse assert: every enum member has a declared renderer or an explicit
  `renderer: false` ("not implemented yet"), and each renderer's `deploySpec` equals the
  registry `deploy` (D9).

- **CONTRIBUTING — escalation path and measured response latency (#148)** — the
  published latency is measured, not a promise: a table over the three strata
  (n=103 merged PRs, [MI], 2026-10-08), the regenerable `gh` + `python3`
  one-liner, and the honest caveat that no external PRs exist yet so the figure
  describes maintenance cadence. Stalled = no maintainer response after 7 days;
  the escalation channel and the possible outcomes are named, and silence is not
  one of them.

- **Package READMEs + complete publication metadata (#143)** — 9 new READMEs
  (D8, English: `packages/markdown` + the 8 renderers) with one uniform skeleton,
  since npm always packs `README.md` and publishing would otherwise show an empty
  package page; the 10 libraries + the CLI gain `repository` (+ `directory`),
  `bugs`, `homepage` and `keywords`, and the pure libraries gain
  `sideEffects: false`.

- **`hotmart` platform — schema additive v1.9, D16 operator extra #15 (49 total;
  issue #137)** — Hotmart: digital-products storefront + memberships (the Payment Policy's
  recurring billing) + affiliate program, serving the Spanish/Portuguese-speaking markets
  (offices in Belo Horizonte, Madrid, Bogotá, Ciudad de México — [OFICIAL] footer, fetched
  2026-10-05), in the `creator-monetization` family. Enum
  entries in `$defs.platform` and the derived `check.platform`, ledger surface, drift host
  `hotmart.com` (+ `HANDLE_HOSTS`; the Hotmart Space profile URL shape stays `[?]` — no
  PLATFORM_SUBDOMAIN_HOSTS entry without a verified shape), Zod regenerated (D3). Paste
  platform (D9 — no management API documented for the profile body; developers.hotmart.com
  covers sales/products [?]): `pasco build hotmart` → paste → `pasco status --mark`.
  Fees/eligibility sourced from the official legal texts, fetched 2026-10-05: no
  monthly/annual fees ([OFICIAL] pricing); fixed fee BRL 2.49 / USD 1.00 / EUR 1.00 +
  service fee 9.9% (20% micro-transactions) ([OFICIAL] Payment Policy §5); withdrawal
  minimum BRL 2.00 + BRL 1.99 fee, 30/15-day deadlines ([OFICIAL] root FAQ #08); worldwide
  eligibility, sanctions-based exclusions only, bank account in own name in the country of
  residence after the first sale ([OFICIAL] ToU §A/§H/§2.8). **EC payout rail remains
  `[?]`** — carried per the #133 precedent (`kofi`/`payhip` PayPal-EC), verification item
  in the venture instance. The market-leadership framing in issue #137 was NOT carried into
  this contract text (no independent source; Hotmart's own "world's largest / Latin
  America's leader" wording lives in the skill research as attributed vendor marketing).
- **Renderer `@profile-as-code/renderers-hotmart` (v1.9, #137)** — deterministic
  plain-text profile paste-source: exactly ONE bios row (long > medium > short), byte-stable,
  empty slice → empty artifact (skipped/unbuilt by `pasco build`, §15.1). Deploy spec is
  §7's `manual` (D9 paste platform).
- **Skill `skills/hotmart/` (#137)** — SKILL.md (storefront frame — "esto resuelve X", not
  tip-jar prose; no-results-promised rule per ToU §1.4) + playbook (paste flow with the
  first-paste surface-verification step) + checks.yaml (soft-cap curacional — no documented
  bio limit) + research/SOTA-2026.md (all sources fetched 2026-10-05; the fee table and
  eligibility from the official legal texts; the Space URL shape and EC payout carried
  `[?]` with sourcing leads).

- **M9 floor — private-first, consent-gated AI-crawler posture (SPEC §12/§14, issue #141)** —
  the training-time corpus floor inverts: `robots.txt` on published surfaces **blocks**
  AI-training crawlers (CCBot / vendor AI crawlers) and user data ships **without** an open
  license; entering corpora or open-licensing data requires the profile owner's explicit opt-in
  (consent field — schema work deferred with Q10). Rationale: the engine is multi-tenant
  (SPEC §9), so an allow-posture decides privacy + licensing on behalf of profile owners
  (identity data entering training corpora without consent — GDPR-adjacent exposure when
  productized); the operator's own profiles may opt in — that consent is theirs to give. Inputs
  + sourced levers: `docs/research/03-training-time-visibility.md` (PR #135, issue #134;
  fetched 2026-10-05). No schema/code change — the consent field lands with Q10 (SPEC-first).
  `docs/ROADMAP.md` M9 row realigned.

- **Platform families `freelance` + `job-boards` — SPEC docs-first declaration
  (issue #138)** — the platform families table in the SPEC (D16 block): `freelance`
  covers the pre-existing v1 `upwork` retroactively and names its backlog slice
  (`freelancer`, `workana`, `fiverr` — filed with the gig-storefront boundary note);
  `job-boards` is a backlog-only slice (`infojobs`, `computrabajo`, `indeed` —
  recruiter-facing CV surfaces; GEO hook = name-reputation in search results). No
  enum/schema/core/CLI changes (48 unchanged); each backlog member follows the #133
  member chain per slug when real operator demand lands, with an official eligibility
  page before any claim. Boundary notes: `linkedin` stays un-bucketed (hybrid),
  `github-readme`/`github-org`/`researchgate` stay un-declared (YAGNI), `toptal` is
  recorded as a reject candidate (invite-only network, `[MI]`).
- **Creator-monetization platform family — schema additive v1.8, D16 operator extras
  #11–#14 (48 total; issue #133)** — `buymeacoffee`, `liberapay`, `gumroad`, `payhip`: the
  platforms where creators receive money (memberships / tips / recurrent donations /
  storefronts) alongside `patreon` (v1) and `kofi` (v1.7). The family is declared docs-first
  as **`creator-monetization`** ("Creator monetization platforms" — canonical industry term)
  in SPEC (D16/§9) and the schema descriptions — no hard schema field (zero consumer
  breakage). Enum entries in `$defs.platform` and the derived `check.platform`, ledger
  surfaces, drift hosts (`buymeacoffee.com`, `liberapay.com`, `gumroad.com`, `payhip.com`,
  with Gumroad/Liberapay subdomain profile URLs), Zod regenerated (D3). Paste platforms
  (D9 — no management API for the profile body): `pasco build <platform>` → paste →
  `pasco status --mark`. Per-platform `gofundme` deferred (no EC payout as organizer,
  operator decision in #133); per-platform skills remain separate follow-ups (D16 parity
  caveat) and each carries its own sourced research when authored.
- **Renderers `@profile-as-code/renderers-*` for the family (v1.8, #133)** —
  `renderers-buymeacoffee`, `renderers-liberapay`, `renderers-gumroad`, `renderers-payhip`:
  deterministic plain-text paste-sources (exactly ONE bios row, long > medium > short),
  byte-stable, empty slice → empty artifact (skipped/unbuilt by `pasco build`, §15.1).
  Core fixture `minimal-creator-monetization` + `schema-check` fixture
  `valid-creator-monetization.json`.
- **`kofi` platform — schema additive v1.7, D16 operator extra #10 (44 total; issue #130)** —
  Ko-fi creator page (same family as `patreon`): enum entries in `$defs.platform` and the
  derived `check.platform`, ledger surface, drift host `ko-fi.com` (+ `HANDLE_HOSTS`), Zod
  regenerated (D3). Paste platform (D9 — no API deploy; Ko-fi ships payment webhooks only):
  `pasco build kofi` → paste → `pasco status --mark`.
- **Renderer `@profile-as-code/renderers-kofi` (v1.7, #130)** — deterministic plain-text
  About paste-source: exactly ONE bios row (long > medium > short), byte-stable, empty
  slice → empty artifact. Deploy spec is §7's `manual` (D9 paste platform).
- **Skill `skills/kofi/` (#130)** — SKILL.md (About: plain text, links only via Ko-fi's
  Social-links feature, ≤40-char status note) + playbook (paste checklist + rename-drift
  caveat) + checks.yaml (About soft-cap — Ko-fi documents no bio limit) + research/
  SOTA-2026.md (all sources fetched 2026-10-05).

- **schema v1.6: `identity.links[].role` — entity identity gets a single home (SPEC §15.4, issue #103)** —
  the engine's JSON-LD had **no owner**: `geo.ts` and both renderers each assembled the entity
  block in parallel, which is how SPEC §15.4's `@id` requirement was never implemented — it fell
  through the seam between three copies. (The repo already solved this for `hasCredential`, §18.9
  `credentialLdEntries`, *"Single source for every emitter"*; this applies it to the entity.)
  New field `links[].role` — `identity` | `realization` (default) | `aggregator`, a **translation
  layer** onto `schema.org:url` / `sameAs` / `mainEntityOfPage` (never presented as standard
  vocabulary). Absent role = `realization`, so no workspace needs editing for the field itself.
  New module **`core/src/structured-data.ts`** owns `@id`, `sameAs` and the entity fields;
  `geo.ts` and both renderers consume it. New check **`geo/entity-id`**; `geo/sameas-links` now
  counts only `role: realization` links (it previously credited a citability signal the JSON-LD
  never emits). Weights rebalanced: `entity-id` 0.05 + `structured-person` 0.05 = the 0.10 budget
  the field-check alone held (weights sum to 1 by contract; a test enforces it).

  **⚠️ Rendered output changes for existing workspaces.** Workspaces keep validating unchanged,
  but the rendered output does change — three deltas: (a) `github-readme` gains
  `jobTitle`/`worksFor`, which it never emitted although `geo.ts` computed them; (b) `sameAs`
  narrows to `role: realization` **and** now includes claimed `socialHandles[].url` — for a
  `github-org` workspace that is byte-identical (it already did both), but a **person** workspace
  with claimed handles gains them (the old `github-readme` did not); (c) `geoCheck` adds
  `geo/entity-id`, so a workspace declaring no `role: identity` loses up to 5 points.
  Re-render and review the diff.

  **Design decisions (operator, 2026-09-24):** an absent `@id` **never suppresses** the JSON-LD
  block — suppressing it would strip structured data from every workspace declaring no `role`,
  i.e. the feature would remove signal that already worked; `geoCheck` reports the gap instead
  (`geo/entity-id`), naming the actual situation (a declared-but-ineligible aggregator is reported
  as such, never as "nothing declared"). Several `role: identity` links → the **first wins**
  (declaration order): an earlier draft ranked "own domain > social network" via hostname patterns
  and was **deleted** — it meant a second, hand-maintained platform list beside `PLATFORMS` (D16)
  and a product judgement inside a regex. Classification + sources: `identeco-cifereca`.
  Tests: +11 (`packages/renderers/github-readme/tests/role.test.ts`, `packages/core/tests/geo.test.ts`).

- **release: `release.yml` crea el GitHub Release desde `CHANGELOG.md` (issue #58)** — el
  publish a npm no anunciaba la release: el tag quedaba sin página ni notes, y el item 3 del
  gate (`docs/STANDARDS.md`) no se podía firmar. Job `release` separado y **después** de
  `publish` (una página para una versión que no llegó a npm sería peor que una tardía):
  checkout del mismo commit verificado, la sección de la versión se extrae con
  `packages/cli/scripts/release-notes.mjs` (match exacto — `0.1` no satisface `0.1.0` — y el
  cuerpo termina en el próximo heading `## `, así `[Unreleased]` no se filtra) y
  `gh release create … --verify-tag`. Idempotente (un retry `workflow_dispatch` no toca una
  página existente); `contents: write` acotado a ese job. La sección se valida **antes** del
  publish (un `npm publish` no se deshace: descubrir las notes faltantes después dejaba la
  versión consumida con el tag vacío, el síntoma que #58 elimina). El extractor endurecido en la
  review fresh: ignora `## ` dentro de fences de código (antes truncaba las notes en silencio),
  no absorbe definiciones de link al final del archivo, acepta `--key=value`, y el main-guard
  compara realpaths y falla ruidoso en vez de no-opear (clase #81). La preparación del release
  (`[Unreleased]` → `## [<version>]`) queda documentada en `docs/ci-cd.md`. Tests: 15
  (`packages/cli/tests/release-notes.test.ts`); runbook en `docs/ci-cd.md`.

- **style gate: Biome (lint + format + import order) in CI and `pnpm lint` (issue #59)** — one tool,
  one config (`biome.json`), one command; CI runs it before tests (fail fast). Gate semantics:
  `pnpm lint` fails on Biome **errors**; `recommended` warn-level rules are reported without failing
  (Biome's default). One deliberate strictness bump: `noNonNullAssertion` is an **error** outside
  tests and off under `**/tests/**` (where `arr[0]!` is idiomatic) — both sides verified by
  flipping the rule red/green. The four intentional control-character regexes in the markdown
  escaping contract carry `biome-ignore` comments with reasons. Scope: Biome does not do type-aware
  linting — `pnpm typecheck` stays the type gate. Fix scripts are risk-split: `pnpm lint:fix` applies
  **safe** fixes only; Biome's *unsafe* fixes (semantics-adjacent, e.g. `useTemplate`,
  `useLiteralKeys`) are opt-in via `pnpm lint:fix:unsafe` and the resulting diff is reviewable.
  One-time formatter baseline applied
  (whitespace-only for `schema/` + fixtures; byte-stable behavior verified: 268 tests green, D3
  `gen:zod` diff exit 0, schema contract self-test OK). Rationale and revisit triggers:
  `docs/ci-cd.md` §Why Biome.

- **Published-surface validators — publint + `@arethetypeswrong/cli` (issue #142)**:
  `packages/cli` gains `prepublishOnly: publint` — npm runs it inside
  `npm publish` (dry runs included), so the irreversible step self-validates its
  manifest (`attw` stays out of that hook on purpose: its `--pack` mode inherits
  npm's `npm_config_dry_run=true` under `npm publish --dry-run` and dies on the
  missing tarball, and the bin-only CLI has no types for it to check);
  `ci.yml` runs both validators on every PR (`publint` over every
  workspace package, `attw --pack --profile esm-only` over the packages that ship
  a `types` entry — the set is derived from the manifests, not a hand-maintained
  list). The typed packages are ESM-only by design, hence the profile.
  `docs/ci-cd.md` documents the publish chain (guard → build → `verify:pack` →
  `prepublishOnly` → publish) and the post-publish verification runbook
  (`npm view` + publint/attw against the published tarball).

### Changed

- **Repo config & supply-chain hardening (2026-10-09 audit)** — actions
  (`checkout`, `setup-node`, `pnpm/action-setup`) pinned to full commit SHAs;
  `persist-credentials: false` on every checkout whose later steps need no git
  auth (`dco.yml` and the release guard keep it on purpose — they run `git
  fetch`); pnpm `minimumReleaseAge: 4320`, `blockExoticSubdeps: true` and
  `trustPolicy: no-downgrade`; pinned tool installs (`jsonschema==4.26.0`,
  `npm@11.6.1`); `runs-on: ubuntu-24.04` with `timeout-minutes` + `concurrency`;
  `.gitattributes` LF normalization and `.github/CODEOWNERS`. `docs/ci-cd.md`
  records what still waits on a public repo / GitHub Pro: the Actions SHA-pinning
  policy, a tag-protection ruleset for `v*`, secret scanning, and an environment
  approval gate on publish.

- **`chokidar` resolved to the attested 4.0.1, `trustPolicyExclude` dropped
  (#184)** — the transitive lockfile entry (tsup's file watcher) tripped
  `no-downgrade`; instead of excluding the untrusted version the graph resolves
  an attested one. 4.0.1 is same-major and behaviorally identical — the
  4.0.1→4.0.3 delta is TypeScript types only ([OFICIAL] upstream releases) — and
  5.0.0 (also attested) is a breaking, ESM-only major tsup's lazy `require` does
  not target.

- **One-home codegen and build wiring (#152, #164, #165)** — three
  hand-maintained mirrors removed: the `PLATFORMS` mirror is gone (#152; the list
  is now the `platforms/registry.yaml` projection — see the #154 entry);
  `packages/cli` builds from the workspace dependency graph
  (`pnpm --filter "@profile-as-code/cli^..." build`) instead of an eight-entry
  hand-written renderer chain (#164); the platform↔renderer mapping moves into
  each renderer's own `pasco` manifest block, projected into a generated CLI map
  that a parity test keeps in sync (#165).

- **dep-gate fixtures are undiscoverable data (#166)** — the fixture manifests
  are committed as `fixture.package.json` / `fixture.pnpm-workspace.yaml` and
  materialized under their real names in a temp dir by `scripts/dep-gate/test.mjs`
  before the production `check.mjs` runs over them, so Dependabot can no longer
  discover (and fail on) an intentionally invalid workspace manifest. The
  production checker is unchanged and stays the tested path; `exclude-paths`
  remains documented as belt-and-braces for the version-update path.

- **Paste-renderer core — the invariant gets one home (#150, PR #158)**: the six paste
  adapters (`kofi`…`hotmart`) carried a byte-identical render body (sha256[:16]
  `b00031017ee2bbc4` after comment strip). The shared body — length priority
  `long > medium > short`, EXACTLY ONE `bios` row's verbatim text + `\n`, `""` on an empty
  slice — now lives in a dedicated shared module (`pasteSource()`; re-homed to
  `packages/paste/` in #157 below): the
  `structured-data.ts` v1.6 / `packages/markdown` precedent — a contract shared by every
  adapter lives in one module, and adapters delegate rather than re-implement. `kofi`
  migrates first: its suite passes, with the overclaiming "emits plain text" fixture check
  tightened to exact-equality verbatim pass-through — identical input → identical output is
  the byte-preservation proof. `pasco build` output is unchanged (byte-stable; empty slice →
  unbuild, §15.1). The remaining five adapters and the six copied suites landed in #157.

- **Paste-renderer core — the seam gets its own support package; all six paste adapters
  delegate (#157)**: the shared body moved from `core/src/paste-source.ts` to
  **`packages/paste/`** (`@profile-as-code/paste`) — a renderer support package (the
  `packages/markdown` precedent), so the engine stays an engine and vitest never enters
  core's runtime. The conformance body ships as the test-only
  `@profile-as-code/paste/conformance` subpath; every adapter suite now invokes it
  (`describePasteConformance`) and keeps only its platform facts (`deploySpec: "manual"`,
  no assets). The six copied suites and the four overclaiming "emits plain text"
  assertions are gone, and the adapter docblocks now state the honest pass-through.
  `pasco build` output is unchanged (byte-stable; empty slice → unbuild, §15.1).

- **Family wording normalization — `creator-support` → `creator-monetization` (#133)** —
  the informal prose from #130 (SPEC D16/§9 and the `kofi` v1.7 description line in
  `schema/profile.schema.json`, this file included) now carries the canonical term;
  already-merged history keeps the old wording, and this note records the rename
  (operator decision, 2026-10-05, issue #133).
- **`pasco build` — empty renderer output is now a complete unbuild lifecycle (v1.7, #130)**
  An empty render is not a deploy artifact, and `profiles/` is a **pure function of the
  workspace (§15.1)**: the build skips BEFORE creating the directory (no litter on
  workspaces without the row) and REMOVES a previously written `profiles/<platform>/`
  output (`README.md` + `assets/`) when its bios row disappears — a stale file would be
  re-pasted otherwise, and `pasco status` never reads artifact files. The build report
  records the removals as `skipped: [{platform, reason}]`.

- **release auth: publish migrado a trusted publishing (OIDC), sin `--provenance` (issue #80)** —
  el camino actual usaba un granular access token con bypass 2FA, que npm retira del publish directo
  ~enero 2027 ([WEB] github.blog changelog 2026-07-08). `release.yml` ahora prepara el runner para
  OIDC (`npm >= 11.5.1` — con Node 22 llega npm 10.x, que ni intenta el intercambio OIDC y falla con
  un `E404`/`E403` engañoso — e imprime `npm --version` para descartar la causa de un vistazo) y
  elimina el flag condicional `--provenance`: bajo OIDC npm genera la atestación sola y la omite
  cuando el repo fuente es privado. `NPM_TOKEN` queda **solo** como fallback del primer publish
  (el que corre antes de que el paquete exista y se pueda configurar el trusted publisher); npm
  prefiere OIDC sobre el token, así que la migración no exige borrar nada en el mismo paso. Pasos
  humanos y pre-flight (workflow filename, `repository.url`) en `docs/ci-cd.md`.

### Fixed

- **permanent Dependabot `failure` runs on `main` (#160)** — the security job
  Dependabot opened over the dep-gate fixtures aborted on
  `dependency_file_not_parseable` because `exclude-paths` applies only to the
  version-update path ([OFICIAL] dependabot-options-reference), and the permanent
  failing run also poisoned `issue-select`'s "main CI green" gate. The
  placeholder-version alerts are ignored by exact version and the `source-map-js`
  override floor documented; the class is eliminated by construction in #166.

- **hardening de semántica de vacío: geo alineada con empty=absent + strings planos vacíos interpolados + typing de
  langMap (issue #86)** — tres follow-ups de la review fresh de #85, una familia (semántica vacío/typing alrededor de
  la regla del accesor de texto #84):

  1. **geo (F1, MAJOR)** — `geoCheck` lee el perfil crudo y divergía internamente: `structuredData` (lectura falsy de
     `.en`) trataba `mission: {en: ""}` como ausente, pero el check `geo/structured-person` creditaba
     `description(mission): yes` con `Boolean({en: ""})` sobre el objeto. El check ahora lee de `sd.fields`
     (structuredData como fuente única de presencia de campos de entidad) — parity byte-idéntica para todo valor
     schema-válido poblado (logo/established/photo son url/date no-vacíos, `location: ""` es falsy en ambas lecturas);
     solo el caso degenerado `""` deja de creditar readiness. `langValues` filtra `""` del haystack de refuerzo
     (inerte hoy — `"".includes(ancla)` nunca matchea — invariante explícito para predicates futuros, sin trim).
     Pins de regresión: `location: ""` y `role: {en: ""}` cuentan como ausentes (person) y `mission: {en: ""}` deja de
     creditar `description(mission)` (brand, score 2/3 con logo+established).
  2. **strings planos vacíos (F2, NIT)** — sweep de strings planos sin `minLength` que se interpolan:
     `newsletter.cadence: ""` (schema-válido) producía fila pública con ` · ` colgante en github-org → "" = ausente en
     el sitio de interpolación (check truthy, regla del string vacío exacto, sin trim). El sweep encontró un segundo
     sitio vivo del mismo síntoma: items vacíos de `skill.keywords[]` (sin `minLength`) joineados crudos producían
     seams `, , ` en github-readme → filtrados (item vacío = ausente; lista toda-vacía → sin colon, como #84).
     Sweep verificado seguro/inalcanzado: `podcast.status` (enum), `press.outlet`/`experience.org`/
     `publications.title/venue`/`artifact.license` (`minLength: 1`), `publication.doi/orcidId` (pattern),
     `identity.handle/timezone` (no renderizados raw hoy), `links[].label` (fallback hostnamePath de #78),
     `links[].platform` (miss de BADGE), arrays inertes para *render* (`project.keywords`,
     `skill.geoKeywords`, `brandVoice`, `artifact.tags` — pesos/selección/skill-facing), `semanticAssociations`
     (trim+filter previo). **Revisión (post-review de #87):** `project.keywords` NO era inerte para el
     *matching* de pesos — los Sets de `projectWeight` matcheaban items `""` entre sí y creditaban el peso de
     la skill a un proyecto sin keywords (orden/featured del README alterados; verificado). Los dos sitios de
     keywords ahora comparten un helper `nonEmpty` (render + matching): item vacío = ausente en ambos, la regla
     del accesor se expresa una vez por archivo. Bordes pinneados: `{en: "", es: "…"}` es ausente para
     structured-data (en-canónico) y whitespace-only sigue siendo dato (sin trim).
  3. **typing de langMap (F3, NIT — issue-first por D3)** — `$defs/langMap` no tipaba sus valores:
     `{en: 0}`, `{en: []}`, `{en: {}}` eran válidos en JSON Schema mientras todo consumidor asume
     `Record<string, string>` (contraste: `langMapList` sí los tipa). Fix solo en el contrato:
     `additionalProperties: {type: string}` + nota en description. `pnpm gen:zod` regenerado — el generador ya
     materializaba el shape langMap (catchall string), así que el Zod generado queda byte-idéntico: sin cambio de
     engine, la frontera Zod ya rechazaba y ahora está pineada en `load.test`. Fixture
     `invalid-langmap-nonstring.json` en el self-test de contrato (schema-check). Los strings vacíos siguen
     schema-válidos por diseño (regla #84: vacío = ausente en el accesor).

  Byte-parity: inputs poblados byte-idénticos (tests EXPECTED sin cambios). TDD: 4 rojos (brand/geo 1, github-org 1,
  github-readme 1, schema-check fixture 1) + 2 pins verdes (frontera Zod, parity person) → verde; suite 265/265;
  schema-check OK; typecheck limpio.
- **strings vacíos en langMaps = ausentes (issue #84, opción (a) ratificada)** — los valores `en: ""` eran
  schema-válidos (sin `minLength`) y los accesores los trataban como texto presente (`!== undefined`): filas
  degeneradas en outputs públicos (`- **hub** — ` con dash colgante, `Evidence:  ([source])` con doble espacio,
  `- ** **` vacío en github-org). Regla semántica única en el accesor de texto: `langText` (core, `compile.ts`) y los
  `pickText` de ambos renderers devuelven `undefined` para `""` — la vacuidad cuenta como ausente en AMBOS niveles del
  lookup (un `es: ""` cae al `en`; un `en: ""` no emite nada). Sin ghost-fallbacks en el registro de `fallbacks`
  (solo se anota cuando efectivamente se devolvió texto). Sin trim (el límite de la regla es el string vacío exacto —
  `" "` queda como dato, candidato para un check futuro). Byte-parity: workspaces poblados byte-idénticos (tests
  byte-for-byte sin cambios); solo outputs previamente degenerados mejoran. TDD: 5 tests rojos (core 3, readme 1,
  org 1) → verde; suite 258/258.
- **`github-readme`: campos opcionales nunca interpolan `"undefined"` (issue #78)** — `identity.links[].label` es
  opcional en el schema (solo `url` es requerido, y el string vacío es válido — sin minLength) y el renderer la
  interpolaba cruda: un workspace válido sin `label` (o con `label: ""`) publicaba `- [undefined](…)` o `- [](…)` en
  un README público. Fallback opción (b) del issue: `hostnamePath(l.url)` — exactamente el label que ya usan los
  links de `projects[]`, sin cambio de contrato. El sweep del patrón (misma clase, mismo archivo) encontró dos
  instancias más y las arregla en el mismo PR: `skill.level` (omisión del paréntesis) y `project.status` (omisión del
  segmento ` · \`status\``). Byte-parity: inputs con los tres campos poblados emiten byte-idéntico (test EXPECTED sin
  cambios); `github-org` verificado limpio (todas sus interpolaciones opcionales están guardadas).

- **`exports` condition order in the five newest paste renderers
  (`buymeacoffee`, `liberapay`, `gumroad`, `payhip` — v1.8; `hotmart` — v1.9,
  issue #142)**: `"types"` now precedes `"import"` in the `.` entry, matching
  every earlier package in the workspace. publint flags the old order as an
  error — exports conditions are order-sensitive for TypeScript resolution, so
  the `types` condition must come first. Caught before the first npm publish:
  none of these packages is on the registry yet.

## [0.1.0] - 2026-09-15

### Added

- **`identity.email` — el email de contacto como hecho de primera clase (v1.5, issue #71)** —
  el boundary de schemes http(s)-only (#53/PR #64) no dejaba hogar para un email de contacto:
  los workspaces lo modelaban como fila `mailto:` en `identity.links[]`, que el patrón
  `^https?://` rechaza — `profile-data-template` y el workspace real del operador fallaban
  `pasco validate` día uno (el output ya deployado llevaba el mailto: pre-#53, o sea que el
  dato era legítimo). Decisión ratificada por el operador (opción B): campo dedicado.
  - **Schema v1.5 (aditivo)** — `identity.email` (string, patrón RFC-5322-adyacente
    `^[^@\s]+@[^@\s]+\.[^@\s]+$`); `mailto:` sigue RECHAZADO en `links[]` (D12) — el boundary
    de #53 queda intacto en los 13 sitios de URL. Fixture positiva (`valid-full.json`) +
    negativa (`invalid-bad-email.json`); `gen:zod` regenerado (D3).
  - **GEO** — `geoCheck` emite `email` (schema.org `email` sobre `Person` **y** `Organization`,
    §17.1); `sameAs` queda solo con URLs de página (un `mailto:` no es una página de
    referencia — el wart semántico preexistente desaparece). `identity.email` entra al
    denominador del readiness (`completeness`): un perfil sin email baja de 6/6 a 6/7.
  - **Renderers** — `github-readme`: fila `- [Email](mailto:…)` PRIMERO en `## Links` (un
    hecho de contacto encabeza, los canales siguen) + `email` en su JSON-LD;
    `github-org`: fila `- mailto:…` + `email` en el JSON-LD (paridad §17.1). Output-only:
    `links[]` no cambia, `sameAs` nunca lleva mailto. Sin email → byte-idéntico al output
    pre-v1.5 (regresión cubierta por tests).
  - **SPEC** — §6 (párrafo del campo + sketch), §15.2 (regla de la fila Links), §15.4
    (mismoAs solo páginas), §17.1 (paridad brand); `schema/README.md` (regla de schemes +
    fila identity); tests: 195 (+9 vs base).
- **Release pipeline para `@profile-as-code/cli` (issues #42/#43)** — `.github/workflows/release.yml`:
  tag `v*` (o `workflow_dispatch`, con input `dry_run` para smoke del pipeline sin publicar) → guard
  tag↔versión → build → test → assert del tarball → `npm publish --access public`
  (`id-token: write` para provenance OIDC, secret `NPM_TOKEN`). El publish real lo dispara el
  operador (#44). **Provenance condicional (decisión a, #44):** npm la rechaza desde repos fuente
  privados, así que `--provenance` se agrega solo cuando el repo ya es público — v0.1.0 sale sin
  ella (pre-flip) y los tags siguientes la llevan automáticamente, sin edición de seguimiento.
  El tarball es self-contained: `@profile-as-code/core` + renderers se buclean en un
  `dist/index.js` único (tsup; 147.58 KB, build 2026-09-15) porque no están en npm; `yaml`/`zod` quedan como dependencias
  reales. Assert (`packages/cli/scripts/verify-pack.mjs`, corrido en `ci.yml` y pre-publish):
  el tarball expone el bin `pasco` (existe, ejecutable, shebang, sin `workspace:` en las ranges que
  resuelve el consumidor) + smoke de instalación aislada del bin linkeado (`pasco <versión>`).
- **Evidence registry — capa de prueba pointer-first (D17/§18 — issue #48)** — el SPEC gana
  la capa de evidencia del workspace: dos bloques tipados (`credentials[]` atestaciones de
  terceros; `artifacts[]` obras/media), matriz de capacidades por locator (protege
  byte-stability §15.1 y el URL SSOT §15.4), `media/` opcional en el workspace que llega a la
  superficie pública solo vía `assets/` del renderer (define el slot de §15.2),
  `PASCO_EVIDENCE_ROOT` per-machine (nunca commiteado), y symlink/stow relegado a
  conveniencia documentada de power-user. Enmiendas: §5 (D17), §6, §12 (M7/M8), §14 (Q9),
  §15.4 (URL SSOT extendido), §17.1 (paridad brand). **Solo contrato** — la implementación
  (schema v1.3 + `pnpm gen:zod` + checks + JSON-LD `hasCredential`) es M7, PRs separados
  (dev-methodology §1).
- **Evidence registry core — schema v1.4 + checks + JSON-LD (M7, D17/§18 — issue #48)** —
  la capa de prueba ratificada en la SPEC entra al motor:
  - **Schema v1.4 (aditivo, semver minor)** — raíces nuevas `credentials[]`
    (certificate/title/award/patent: issuer, credentialId, verifyUrl, issued/expires,
    visibility) y `artifacts[]` (portfolio/gallery/showreel/dataset/document/code:
    locator `{url|path}` con XOR, checksum sha256, license, tags, visibility);
    cross-refs: `evidenceItem` gana `credentialId`/`artifactId`, `publications[]`/`press[]`
    ganan `artifactRefs`. `visibility: public|unlisted|private` first-class (§18.5) —
    ausente = public (el perfil pre-registro era público por diseño). El XOR del locator
    vive en JSON Schema (`oneOf`) y se re-chequea post-Zod en core (el Zod generado no
    puede expresar required-without-property; mismo fail-class que el ledger, D12).
  - **Core** — `checkRegistryIntegrity` (load falla con clase D12: ids duplicados,
    cross-refs colgantes, locator XOR) y `registryCheck` (§18.8 offline/determinista:
    `credential-expiry` warn; `no-private-in-public-output` ERROR — el gate de leak §18.5:
    evidencia/publicaciones/press públicos que referencian entradas non-public fallan
    `pasco check`). JSON-LD (§18.9): `Person`/`Organization` ganan `hasCredential` →
    `EducationalOccupationalCredential` (solo public; término en área "new" de schema.org,
    fuente fechada en la SPEC). El registro viaja en el slice `compile()` (facts).
  - **CLI** — `pasco check` ejecuta las reglas del registro (warn + error, exit FAIL en
    leak). **Renderer** — `github-readme` emite sección compacta `## Credentials` /
    `## Artifacts` (solo `public`; locators `path` NUNCA emiten URL pública — D14) y
    `hasCredential` en su JSON-LD. Template-side (`media/` scaffold, evidence-packs,
    symlink doc) vive en profile-data-template#8; M8 (pipeline de media) es el siguiente.
- **Media pipeline — byte-stable asset transport (M8, D17/D19 — issue #48)** — los
  pointers se convierten en bytes deployables sin que el motor sea dueño de los binarios
  (D14). Q9 resuelto como **D19** (§13): un dir `assets/` por salida de plataforma, NO un
  store content-addressed compartido (las superficies de deploy son repos separados; cada
  salida es self-contained y reviewable).
  - **Core** — `collectMedia(profile, workspace)`: bundler único — solo artifacts
    `path`-locator **public** (§18.5), sha256 + bytes en orden determinista (sorted por id),
    verificación del `checksum` declarado (mismatch = error, asset NO bundleado); cadena de
    resolución: `media/…` = workspace-relative (SSOT; missing/unsafe = error), resto =
    external bajo `PASCO_EVIDENCE_ROOT` (env > gitignored `.pasco/local.toml`, per-machine,
    nunca commiteado; missing = warn, CI-degradable §18.3; roots relativos anclan al
    workspace, no al CWD de invocación); guard de contención
    (`media-path-unsafe`); symlink fuera del workspace sin checksum = warn (§18.7);
    oversize > 50 MB = warn (§18.6). Targets `assets/<id>/<basename>` (ids únicos
    core-checked → collision-free) — `artifactAssetTarget` es la derivación única que
    renderer y build comparten. `mediaManifest` = registro compile-time determinista.
  - **Renderer interface (§15.2)** — el slot `assets?: string[]` queda definido: el
    renderer DECLARA los targets deploy-relativos que su texto referencia (via
    `opts.assets`); sin bundle → path locators quedan sin link (output byte-idéntico al
    pre-M8). `github-readme` emite ` — [assets/<id>/<basename>](href)` para los bundleados —
    href percent-encoded (espacios/paréntesis rompen destinos CommonMark; el target del
    manifest queda raw) — y nunca un path interno del workspace.
  - **Build** — copia exactamente los targets referenciados a
    `profiles/<platform>/assets/` y escribe `assets/manifest.json` (version, platform,
    lang, sha256/bytes/origin por asset); rebuild limpio — el output dir queda como
    función pura del workspace (§15.1, sin drift stale). `pasco check` ejecuta las reglas
    de media (error: `media-missing-workspace`/`media-path-unsafe`/`media-checksum-mismatch`;
    warn: `media-external-missing`/`media-symlink-external`/`media-oversize`/
    `media-unbundled-no-id`).
  - **Docs** — `docs/media-pipeline.md` (contrato engine-side: pipeline, resolución,
    manifest, git-lfs, symlink tradeoffs, playbook de deploy con verificación).
  - **Fix §18.9 (gap M7)** — el JSON-LD de `github-org` ahora emite `hasCredential`
    (solo public), como la SPEC ya prescribía para Organization. Portfolio-site
    consumption queda **con M5** (el web renderer aún no existe; el contrato §15.2/§18.6
    es su seam de consumo).
- **Per-entry deploy-status ledger (v1.3 schema, D18 — issue #37)** — el deploy loop pasa de
  granularidad-plataforma y prosa mantenida a mano (`CHECKLIST.md`) a **estado por entrada como
  dato** que solo `pasco` muta. Responde la pregunta del operador por bloque: ¿mío o del
  template? ¿publicado? ¿en qué superficie y en sync — o desactualizado?
  - **Schema v1.3 (aditivo, semver minor)** — nueva raíz `deployments`
    (`content/deployments.yaml`: ledgerKey → surface → `{deployedAt, contentHash, source}`);
    `id` opcional estable en `experience`/`projects`/`publications`/`education`/`press`;
    flag de provenance `origin: template`. Restricciones de claves via `propertyNames`
    (JSON Schema) **y** re-chequeadas post-Zod en core (gen-zod las descarta): unicidad de
    `id` por bloque, claves compuestas ambiguas **solo cuando el ledger las direcciona**
    (aditivo: workspaces legacy con duplicados siguen validando), surface ∈ enum D16.
  - **Core** — `hashUnit`/`canonicalJson` (SHA-256 de la serialización canónica *sin*
    metadatos del ledger: agregar un `id` nunca marca `stale`), `trackableUnits` (espacio de
    claves §19.2: bloques raíz, bios/headlines/skills/handles compuestos, filas con id),
    `deployStatus` (`in-sync`/`stale`/`never` + untracked + removed — detección de staleness
    exacta por hash, independiente de release tags), `checkLedgerIntegrity` (post-Zod, D12).
  - **CLI** — `pasco status [platform] [--mark <ledgerKey> <surface>] [--at <iso>]
    [--write-checklist] [--json]`: reporte por entrada + camino de escritura del ledger
    (regla D14) + `CHECKLIST.md` regenerado como vista AUTO-GENERATED.
  - **Fixtures contract** — `valid-deployments` + `invalid-deployments-bad-surface` +
    `invalid-deployments-bad-key` en `scripts/schema-check`.
- **Platform set — Postiz parity + operator extras (v1.2 schema, D16 — issue #30)** — el
  enum compartido de plataformas (person + brand) pasa de 16 a **43**: la unión de las 34
  redes soportadas por Postiz ([OFICIAL] docs.postiz.com llms.txt, fetched 2026-09-02) + 9
  extras del operador (`ghost`, `spotify`, `soundcloud`, y las seis superficies v1 no-Postiz:
  `github-readme`, `upwork`, `researchgate`, `substack`, `patreon`, `github-org`). Slugs
  nuevos Postiz verbatim (`linkedin-page`, `instagram-standalone`, `devto`, `gmb`,
  `warpcast`, `moltbook`, `mewe`, `tumblr`).
  - **Schema v1.2 (aditivo)** — `$id`/`title` bump; `check.platform` == `['all', ...platform]`
    asertado por `scripts/schema-check` (dedup guard, no confianza manual).
  - **Core** — `PLATFORMS` espeja el enum (contract test vitest: schema ↔ types.ts); drift
    reconoce los hosts nuevos (incluye subdominios `*.ghost.io`, `*.hashnode.dev`,
    `*.medium.com`, `*.wordpress.com`, `*.slack.com`) y corrige el bug pre-existente de
    `patreon.com` ausente en PLATFORM_HOSTS.
  - **Fuera de scope** — skills por plataforma: follow-ups, un issue por plataforma.

- **Brand flavor (M6, D15/§17 — issue #25)** — el engine modela identidades de marca:
  - **Schema v1.1 (aditivo)** — `flavor: person|brand`, variante org de `identity`
    (`orgName`, `logo`, `brandVoice`, `mission`, `tagline`, `established`), bloques
    `socialHandles` (handle matrix con `status: claimed|pending`), `newsletter`,
    `podcast`, `press`, `audiences`; plataformas brand (`github-org`, `bluesky`,
    `instagram`, `tiktok`, `youtube`, `spotify`, `reddit`, `mastodon`, `soundcloud`);
    reglas de check `handle-claimed` / `handle-consistent`.
  - **Core** — `flavor` normalizado (default person), drift handle-matrix
    (`drift/duplicate-handle`, `drift/handle-claimed-not-linked`,
    `drift/handle-host-mismatch`), GEO `schema.org/Organization` (sameAs = links +
    claimed handle urls), compile con bloques brand.
  - **Renderer `github-org`** — README de org determinista (badges de handles
    claimed, newsletter, podcast, press, audiences, JSON-LD Organization).
  - **CLI** — `pac init --flavor brand`, `pac build github-org` (solo brand),
    `pac check` ejecuta las handle rules offline.
  - **Skill `github-org`** — voz de marca ≠ voz personal, checks de handle matrix,
    trademark/impersonación (firmar siempre como el nombre completo).
  - **Templates** — puntero `templates/profile-data-brand/` (multi-workspace §9.1).

- **Schema contract v1** — `schema/profile.schema.json` (JSON Schema 2020-12, D3): the single
  contract for a `profile-data` workspace. i18n `langMap` with EN required, GEO anchors,
  evidence claims, declarative checks, active variant selection.
- **Core engine (M1)** — `packages/core`: `load()` (YAML → validate → normalize), `driftCheck()`
  (factual contradictions, warn semantics D12), `geoCheck()` (consistency score + structured-data
  readiness), `compile()` (language-aware platform slices). Zod generated from the schema.
- **CI/CD** — `ci` check on every PR and on `main` (schema self-test + pnpm test/build),
  Dependabot (npm + actions), auto-delete of merged head branches. Branch protection
  (required status checks) is deferred while the repo is private on GitHub Free —
  `main` is protected by access + process (`docs/STANDARDS.md`); re-applied on flip
  (`docs/ci-cd.md`).
- **Community scaffolding** — CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, SECURITY, PR/issue
  templates, GitHub Discussions.
- **Prior-art research** — `docs/research/01-prior-art.md`, SOTA research prompts + runner.
- **`@profile-as-code/markdown` — la regla CommonMark compartida (issues #75/#76)** — el escaping
  de markdown vivía solo en `github-readme` (`mdHref`, issue #73) y faltaba en `github-org`: el
  renderer siguiente (M2/M4) habría copiado la regla por tercera vez, y una regla que viaja por
  copia es exactamente cómo el mismo bug llega al próximo adapter. El paquete separa las dos
  superficies — `mdHref()` (destinos) y `mdText()` (texto de link: backslash-escape de `\`/`[`/`]`).
  Sin dependencias; `core` sigue agnóstico de plataforma (AGENTS.md §7); 12 tests propios.

### Changed

- **GEO readiness denominator ahora cuenta `identity.email` (v1.5, issue #71)** — cambio
  de comportamiento para consumidores que comparaban `completeness`: un perfil sin email
  pasa de 6/6 a **6/7** (y con email llega a 7/7). Diseño intencional: el email es un
  hecho de primera clase del identity y entra al readiness como los demás campos.
- **BREAKING — CLI bin rename: `pac` → `pasco` (issue #38)** — the npm name `pac` is occupied since 2015
  and owns the `pac` bin (global-install collision risk); `paco` is occupied too. Verified
  free candidates on registry.npmjs.org, 2026-09-07. Operator decision: the binary is now
  **`pasco`** — never owned on npm, zero collision/dispute risk. Package stays
  `@profile-as-code/cli`; workspace config `.pacrc` → `.pascorc`; renderer artifact comments
  now read `generated by profile-as-code pasco build …`. Historical entries above keep
  their original names. A legacy `.pacrc` found where `.pascorc` is expected now fails
  with a migration hint instead of being silently ignored (sota-review round 2).

- Spec consolidated (D1–D14 resolved): Substack as platform, profile-data as separate repo,
  model-agnostic `pac refine`.

### Fixed

- **Renderer: every markdown link destination from a SSOT URL is CommonMark-safe
  (issue #73)** — URLs with `(`/`)`/space are contract-legitimate (`$defs/url`:
  `^https?://` + `format: uri` both tolerate them) but a raw CommonMark destination ends
  at the first `)` or space → broken link + stray text. The canonical helper `mdHref`
  (introduced by #72 for asset targets + the email row) now covers ALL destinations the
  `github-readme` renderer emits from a SSOT URL: badges, project links, project evidence
  sources, DOI hrefs, credential `verifyUrl`, artifact `locator.url` and the `Links` rows.
  - **`mdHref` = `encodeURI`'s ASCII set minus `%`, plus the parens** — verified
    exhaustively (all 128 ASCII chars): the output is byte-identical to the previous
    helper except where the old output was wrong or over-normalized — a VALID `%` escape
    is no longer double-encoded (`%20` → `%2520` addressed a different resource) and a
    non-ASCII URL stays verbatim (an IRI is a valid CommonMark destination). A lone `%`
    (malformed escape) becomes `%25`; the C0/C1 controls that survive the schema boundary
    are percent-encoded (TAB/LF/CR never arrive — the boundary's WHATWG preprocessing
    strips them; encoding them is defensive).
  - **Blast radius** — for the 7 newly-covered destinations the output changes only when
    one of those fields carries a URL with `(`/`)`/space, and no known workspace does:
    the deployed workspace is byte-identical (verified: `profile-data` main-build vs
    fix-build diff = empty) → no re-peg note. JSON-LD `sameAs`/`email` stay verbatim
    (§18.4); facts stay raw in labels (a DOI's text keeps its bytes — only the href is
    encoded).
  - **github-org NOT touched** (operator-scoped): its `## Links` rows are plain text
    (`- ${url}`), not CommonMark destinations — verified; the same destination class does
    exist in its badges/newsletter/podcast/press/logo emissions → escalated as #75, and
    the adjacent link-*text* class (a `]` in a URL breaks the label) as #76.

- **`github-org`: todos los destinos CommonMark son seguros (issue #75)** — badges (el `src` de
  shields.io **y** el href del handle: el path de la marca se interpola dentro del primer
  destino), newsletter, podcast (url + rss), press y `identity.logo` pasan por `mdHref()`. Un
  `(`/`)`/espacio legítimo del SSOT (`$defs/url`) terminaba el destino en el primer `)` y el
  resto quedaba como texto suelto. `## Links` sigue siendo texto plano (no hay destino que romper).

- **Los renderers escapan el TEXTO de los links (issue #76)** — un `]` en el path de una URL, en
  un DOI o en un `identity.links[].label` cerraba el label antes de tiempo: el link no existía y
  el resto quedaba como texto + autolink (repro contra un parser CommonMark real, en el issue).
  `mdText()` backslash-escapa `\`/`[`/`]`; CommonMark desescapa al renderizar, así que el label
  visible conserva sus bytes (el hecho se mantiene crudo, §18.4). Cubre `github-readme` (links de
  proyectos, DOI, artifact url, asset target, `Links`) y `github-org` (newsletter, podcast).
  Byte-parity: sólo cambia con `\`/`[`/`]` en un label — ningún workspace conocido los tiene
  (los tests byte-for-byte existentes pasan sin modificación).
