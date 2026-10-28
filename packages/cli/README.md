# `@profile-as-code/cli` — `pasco`

The `pasco` CLI — `@profile-as-code/cli`. Consumes `@profile-as-code/core`
(`load`/`driftCheck`/`geoCheck`/`compile`) — it never re-implements them. The
contract source is `schema/profile.schema.json` (D3); Zod is generated in core.

## Install

```sh
npm i -g @profile-as-code/cli   # the package
pasco --version                 # the bin — prints the installed version
```

`@profile-as-code/cli` is the **package**; `pasco` is the **bin** it installs.
The install adds one global bin and nothing else: no post-install script, no
server, no account.

> **Published** [OFICIAL] [WEB: registry.npmjs.org, checked 2026-10-26 at release prep]:
> `@profile-as-code/cli` is public on npm — the registry is the source of truth
> (`npm view @profile-as-code/cli version`). At prep time the last published release is
> `0.3.5` (published 2026-10-24T03:50:04.822Z; tag `v0.3.5` → `c69e6b7`), which carries
> npm-publish attestations + SLSA provenance v1; `0.3.6` is prepared in this release
> (CHANGELOG `[0.3.6]`). The `0.3.0` tarball carries none because it was published while
> the source repository was private.
> Source install: [User Guide §2](../../docs/USER-GUIDE.md#2-install-the-pasco-cli).

## Get a workspace

`pasco` reads a **workspace folder** (`content/*.yaml` + `.pascorc`) by configured
path. That folder does not have to be a git repository, and it does not have to live
on GitHub — a repo is the **recommended** place to keep it, not a requirement
([SPEC §9](../../docs/SPEC.md)). Three on-ramps, each with its capability difference
stated up front:

| On-ramp | What you get | Automation + history | Account + repo |
|---|---|---|---|
| **Template repo** *(recommended)* | the complete example workspace, operational docs, licence, repo automation | yes | **required** |
| **`pasco init`** (this package) | a minimal validating folder in seconds | **no** — nothing runs on a change and nothing versions it | **none** |
| **Bring your own storage** | the same `pasco init` scaffold, written at a path you choose (local disk, a synced folder, another git host) | same as `pasco init` | **none** |

```sh
pasco init ~/profile-data-me     # person flavor (default); brand: --flavor brand
pasco validate                   # run from the workspace root
```

The two no-account on-ramps keep the whole engine command set except `pasco diff`
(which needs a git history). What they lose is the template's automation and
history — `pasco init` is minimal on purpose, and the complete package lives in
the template. **Where each on-ramp is discovered:** the template repo's own README,
this package page, and — in the repository — the
[User Guide §3](../../docs/USER-GUIDE.md#3-create-your-workspace-profile-data-username)
(EN). Links into `docs/` resolve in the repository, not on this npm page: the two
commands above are the standalone path.

## Commands

| Command | Purpose | Status |
|---|---|---|
| `pasco init [dir]` | Scaffold a profile-data workspace (`content/identity.yaml`, `README.md`, `.pascorc`) — `pasco validate`-clean | ✅ |
| `pasco validate [--json]` | Schema **fail** (exit 1) + drift/geo **warn** (exit 0) — D12 | ✅ |
| `pasco build [platform] [--lang]` | Deterministic base texts per platform+lang; platforms with a renderer (the eight registered in the generated renderer map) write `profiles/<platform>/README.md` + bundled media; renderer-less manual surfaces with a bio row write `profiles/<platform>.md` (#239). Empty render = no-trace unbuild of the generated output, preserving `profiles/<platform>/variants/` (chosen-variant input, #238; pure profiles/, §15.1 — v1.7). Media in `profiles/<platform>/assets/` + `assets/manifest.json` (M8/§18.6 — see `docs/media-pipeline.md`) | ✅ |
| `pasco edit <contract-path> [--set <text> [--check]]` | Resolve **one** contract field by contract path; `--set` **writes it** (comment-preserving range splice, validated, atomic) and `--set --check` previews the **published lines the edit changes** (or says it changes nothing). Epic #247, S1–S5 landed | ✅ S1–S5 (read · preview · write · surface impact · cap pre-flight · machine contract) |
| `pasco diff [--json]` | Changes since the last `release-*` tag (git-based → CHANGELOG hint) | ✅ |
| `pasco status [platform] [--mark <ledgerKey> <surface>] [--verify] [--write-checklist] [--completeness]` | Per-entry deploy report — origin · surfaces · in-sync/stale/never · **certification** (verified/attested/unverifiable/out-of-band-drift, §19.5) + the derived **publication truth** per surface (§20.1, #242) + ledger write paths (D18, §19) | ✅ |
| `pasco refine <platform> [--lang] [--variants N] [--choose <id>]` | Agent-driven variant flow (D10/D11/D13); the chosen body is `profiles/<platform>/variants/<id>.md` (a complete platform artifact), rendered by `pasco build` (#238) | 🚧 template + `--choose` (full flow M3) |
| `pasco check [platform]` | User checks from `content/checks.yaml` (schema-validated catalog) + registry rules (M7/§18.8) + media-transport rules (M8/§18.6) + offline `max-chars`/`min-chars` over headlines/bios (#240) + `fact-present` (the built surface's fact tokens vs the SSOT render, #283) | 🚧 offline rules today (limits + registry + media + fact-present; remaining catalog M3/M4) |
| `pasco audit [--json]` | Offline **diagnostic projection**, findings only (no score/prioritisation/branding, #283): three fixed classes — `dangling-ref` FAIL · `contradiction` FAIL · `unsourced-claim` WARN — exit 1 iff any FAIL; `--json` carries `{ schemaVersion: "1", scope: { declared, checked, notRun }, findings }` | ✅ v1 |
| `pasco entity [--json \| --jsonld [--out <file>] [--bare]]` | The **entity projection** for surfaces the engine does not render (#287): `--json` is the frozen view — `entity { id, type, name, sameAs, email }`, the structured-data `gaps` (geoCheck codes verbatim) and `jsonld: null`; `--jsonld` is the **same assembler output** the renderers embed, as a paste-ready `<script type="application/ld+json">` block. Exit 1 when `@id` is absent (never invented) | ✅ v1 |
| `pasco export ai-policy [--out <dir> \| --check] [--lang <l>]` | The M9 stance as an artifact (#290): `--out` writes `robots.txt` (**two named groups, no wildcard** — the listed retrieval crawlers allowed, the listed training crawlers disallowed, each UA commented with its registry entry/operator/source/date; the file declares that a crawler it does not name is **not restricted**), `llms.txt` (the workspace index: name, definition, canonical identity, `faq[]`, `publications[]`, with a coverage assertion) and `AI-POLICY.md` (allowed · blocked · that same explicit-list limit · who can change it · the date, quoting the stance verbatim). `--check` exits 1 on an incomplete or unsourced entry, a duplicate token (case-insensitive), a malformed/future/`>180`-day `as_of`, or a `policy.as_of` that is stale or older than its newest row; `--out` refuses to write one. The UA list is projected from the platform registry — never hardcoded in the CLI | ✅ v1 |
| `pasco post <seed\|task\|choose\|check\|export\|import\|list>` | Week-1 post MVP (#264): a seed at `posts/<seed>/seed.md` → task bundle → chosen variant → check → optional Postiz draft payload; the CLI never calls an LLM | 🚧 experiment (not in the v1 contract; `docs/post-mvp.md`) |
| `pasco skills:export <dir> [--force] [--list]` | Copy the platform skills this package ships into a directory you name (`--list` shows them; no per-agent paths are invented — #254) | ✅ |

The partial commands are explicit, and each one says what still owns the rest:

- **`refine`** — without `--choose` it emits the **agent task template** the
  executing agent works from (the CLI never calls an LLM and never wires the hub);
  `--choose` records the pick in `content/active.yaml`. The platform skill ships
  **inside this package**, so the template prints its real path on an npm install
  (and says `no skill for <platform>` vs `skills not shipped` distinctly —
  #253). The full variant flow is M3 (`src/commands/refine.ts`).
- **`check`** — executes the offline rules that exist today: the brand handle
  matrix (brand flavor only, D15/§17), the evidence-registry checks (M7/§18.8),
  the media-transport rules (M8/§18.6), the `max-chars` / `min-chars` rows
  declared in `content/checks.yaml` over the headline/bio rows that exist
  (offline, warn-class, #240), and **`fact-present`** — for the surfaces whose
  catalog declares it (`content/checks.yaml` ∪ the shipped
  `skills/<platform>/checks.yaml`): the artifact `pasco build` last wrote is
  compared **symmetrically** against the SSOT render — a URL, ISO
  date or number one side carries and the other does not, or a text difference no
  fact token explains, is a finding — WARN in `check` (D12), because a published
  surface that disagrees with the SSOT is a fact problem, not a schema one. A
  targeted surface with no artifact reports the rule as **not run**, never as OK. The remaining
  per-platform rules in the catalog ship with the skills `checks.yaml` union (M3)
  and the full `pasco check` (M4). It prints its `owner` line
  (`src/commands/check.ts`).
- **`skills:export`** — copies the platform skills this package ships into the
  directory the user names (`--list` first; an existing non-empty directory needs
  `--force`). It replaces the earlier projection stub: the CLI never invents a
  per-agent destination and never points at tooling the reader cannot open
  (`src/commands/skills-export.ts`, #254).
- **`post`** — the week-1 experiment (#264/#265): a CLI subcommand family over
  the `posts/` store; it never calls an LLM, emits the agent task, records the
  choice, checks limits/URLs/refs and exports a Postiz draft. It reads the
  `skills/` bundled with the package (set `PASCO_SKILLS_DIR` only to point at a
  custom tree), and it is **not part of the v1 contract yet** (`docs/post-mvp.md`).

### The audit (`pasco audit --json`, #283)

`audit` is an **offline JSON projection over existing checks** — not a second
analysis engine and not a scoring surface. It aggregates per identity (where
`check` is per document) and reports **findings only**: no score, no
prioritisation, no branding. Those belong to the consumer (`PROP-017 §Module
boundary`), and putting them in the engine would recreate the monolith the
module split exists to prevent.

```sh
pasco audit                 # human list, one block per finding
pasco audit --json          # machine contract
```

```json
{
  "schemaVersion": "1",
  "scope": { "catalog": "shipped", "declared": ["github-readme"], "checked": ["github-readme"], "notRun": [] },
  "findings": [
    {
      "class": "dangling-ref",
      "severity": "FAIL",
      "path": "projects[hub].links[0]",
      "detail": "drift/url-not-in-identity — URL https://github.com/someoneelse lives on a platform host but is not in identity.links"
    }
  ]
}
```

`scope` is the artifact side (the SSOT-side rules always run): `catalog` is
`shipped` | `not-shipped` (a package without its skills tree cannot declare the
premise — a bundle state, not "nothing declared"); `declared` are the targeted
surfaces whose catalog declares the `fact-present` premise, `checked` the
declared ones whose built artifact was compared, `notRun` the declared ones with no
artifact on disk or no renderer for the flavor. **`declared: []` means the premise
is not declared anywhere; `checked: []` means it measured nothing** — either way the
audit says so instead of looking clean.

| Class | Fires when | Severity |
|---|---|---|
| `dangling-ref` | a pointer does not resolve in the current view | **FAIL** |
| `contradiction` | two surfaces assert incompatible values for one datum | **FAIL** |
| `unsourced-claim` | a quantitative claim carries no evidence | **WARN** |

`schemaVersion` is the contract version: a consumer refuses a version it does not
know rather than guessing at the shape. `path` is a `factRef` (the row `id`
replaces the array index when the row declares one); a finding about a built
surface addresses the artifact path (`profiles/<surface>/README.md`), because a
fact the SSOT does not carry has no `factRef` by definition.

Exit `1` iff a `FAIL` finding exists, `0` otherwise (WARN-only included); `2` is
a usage error, and a schema/load failure is the standard error envelope at exit
`1`. The audit never touches the network, and no finding is derived from
`content/deployments.yaml` (the ledger is not a fact source) — it works on a
workspace that has neither a ledger nor a built artifact.

What it composes (`docs/SPEC.md` §7.1): `load`/schema, `reconciledDrift` (drift
plus the #238 variant-store reconciliation `validate` applies), `geoCheck` (its
`faq-coverage` premise gates the claim rows; the codes themselves map to no class),
the completeness `evidence` premise, and `fact-present`.

It is **deliberately stricter than `validate`/`check`** on the two FAIL classes:
D12 governs validity (drift facts warn, `validate` exits 0), while the audit's
contract is publishability and the issue freezes the class severities. A drift fact
in a FAIL class therefore exits 1 here and 0 there — declared in SPEC §7.1 and
pinned by a test. Two inputs are deliberately NOT findings, declared in §7.1:
`drift/url-not-in-identity` (the URL resolves — a canonicalization rule `validate`
warns about) and `geoCheck`'s coverage codes.

### The entity projection (`pasco entity`, #287)

`audit` diagnoses; `entity` is the artifact for a surface this engine does not
render (WordPress, Webflow, Next, a landing page). It exposes the **same** entity
the renderers embed — `core/src/structured-data.ts` is the one assembler, so there
is no CLI-local builder and no second truth (SPEC §7.2).

```sh
pasco entity --json                      # the frozen view: facts, @id, sameAs, gaps
pasco entity --jsonld                    # paste-ready <script type="application/ld+json">
pasco entity --jsonld --bare             # the bare JSON object
pasco entity --jsonld --out entity.html  # write the block (refuses an existing file)
pasco entity --jsonld --out entity.html --force  # replace it (atomic write)
```

```json
{
  "schemaVersion": "1",
  "entity": { "id": null, "type": "Person", "name": "Elena Vasquez", "sameAs": ["https://github.com/elenavasquez"], "email": null },
  "gaps": [
    { "code": "geo/entity-id", "detail": "no role: identity link — all 5 link(s) are role: realization (they indicate the entity, not are it). Mark the one that represents you role: identity to make the entity citable." }
  ],
  "jsonld": null
}
```

`entity.id` is the URL of the `role: identity` link (the first one wins) or
`null`: the engine **never invents an `@id`**. `gaps` are the `geoCheck` checks of
its structured-data section that scored below 1, with the code and detail
**verbatim** — no new vocabulary. `jsonld` is always `null` in `--json`; the
artifact has its own mode. Parsing the `--jsonld` output yields exactly
`structuredData()`'s object — asserted by a test.

Both modes resolve **one** language (`--lang`, else `.pascorc` `defaults.lang`,
else `en`): the readiness gaps are measured in the same language the JSON-LD is
assembled, so a brand whose only populated `mission`/`tagline` is `es` cannot show
`description` as missing while the block emits it.

`--out` writes a temp file and renames it into place (atomic), and **refuses an
existing file** unless `--force` is passed — a mistyped path must not truncate the
SSOT. A write failure (existing file without `--force`, ENOENT, EACCES) is an error
envelope at exit `1`, never a stack.

Exit `0` when `@id` is present, `1` when it is absent (the entity has no declared
home; the JSON-LD is still emitted, without `@id`) or the `--out` write failed, `2`
for usage. It is offline and deterministic: no network, no clock, no AI.

### The AI policy artifacts (`pasco export ai-policy`, #290)

A profile publishes into a web where two kinds of machine reader arrive: the ones
whose output is a **citation** (search and answer indexing, a fetch a user asked
for) and the ones collecting material for **foundation-model training**. The
project's stance (SPEC §12 M9) is that the second kind does not get the content
unless the owner opts in — and until this command there was no file that said so.
One command now emits all three, from the workspace and the platform registry:

```sh
pasco export ai-policy --out ./public   # robots.txt + llms.txt + AI-POLICY.md
pasco export ai-policy --check          # exit 1 when the UA list is stale or unsourced
```

- **`robots.txt`** carries two *named* groups and never a wildcard: `ai-retrieval`
  is `Allow: /`, `ai-training` is `Disallow: /`. Every `User-agent` line is
  preceded by a comment naming its registry entry, operator, source URL and the
  date that source was read, so a reader can tell **why** a crawler is in a group.
  Because there is no `User-agent: *` group, the file restricts exactly the tokens
  it lists: a crawler it does not name is **not restricted by it** (RFC 9309
  §2.2.1). The artifacts **say that out loud** instead of claiming a default — the
  list covers the crawlers whose classification has been checked against the
  operator's own documentation, not the web.
- **`llms.txt`** is the workspace index in the shape the project site already
  uses: name, one-line definition, the canonical identity URL, the `faq[]`
  answers, the citable `publications[]`, and a dated stamp. The builder asserts
  that **every document it claims to index appears in the text** — a document
  missing from the index is a silent hole, not a cosmetic bug.
- **`AI-POLICY.md`** is the statement you send when a client asks "what is your AI
  policy": what is allowed, what is blocked, who can change it, the date, and the
  per-crawler table with each operator's own documentation URL.

The crawler list is **derived data**: it lives in the `ai:` block of the platform
registry, `pnpm gen:platforms` projects it into the engine, and the generator
refuses an entry with no `source` or no `as_of`. `--check` fails an unsourced
entry or a source older than **180 days**, and it gates the policy's own
`as_of` (real date, inside the window, not older than the newest row it seals) —
and `--out` runs the same check first, so a stale list becomes a failing command
instead of a file that rots. Tokens compare **case-insensitively** (RFC 9309
§2.2.1), so `GPTBot` and `gptbot` cannot slip in as two groups. No clock is
read when writing: the stamp is the registry's review date, so two runs on
different days produce byte-identical files.

`--out` never truncates a file it did not generate: an existing `robots.txt` that
is not ours needs `--force`. A refused write or a failed `--check` is exit `1`, a
usage error is exit `2`. The `--json` contract is frozen in SPEC §7.3.

### Contract paths (`pasco edit`, epic #247 — read · preview · write)

One command answers *"what will the published text be?"* and, when asked, **writes
exactly one scalar** without touching a byte of anything else: the dogfood that
opened the epic had to hash `content/*.yaml` before and after and read a
`pasco build` scrollback to answer the same question.

```sh
pasco edit positioning.statement.en                       # the current value
pasco edit positioning.statement.en --set "…" --check       # the published lines this edit changes
pasco edit positioning.statement.en --set "…"               # write it (one line, comments intact)
pasco edit headlines[platform=github-readme,lang=en].text --set "…" --check
pasco edit identity.links[platform=github].url              # read-only (the URL SSOT)
```

Addressable fields (by **contract path**, never by line/offset — the schema is the
authority on what a field is):

| Address | Resolves to |
|---|---|
| `positioning.statement.<lang>` | `positioning.statement[lang]` (`lang`: `en`/`es`/`fr`) |
| `headlines[platform=<p>,lang=<l>].text` | the matching `headlines[]` row |
| `bios[platform=<p>,lang=<l>,length=<len>].text` | the matching `bios[]` row |
| `identity.links[platform=<p>,label=<l>].url` | the row's URL — **read-only**; `label` disambiguates two links on one platform |

**The write (S2, #249).** A byte-range splice over the **original text**: the CST
locates the scalar and only those bytes are replaced, so comments, alignment and
layout survive *by construction* and the diff is **one line** (a document
re-serialization would normalize both — measured 2026-10-21). The new text goes to
a temp file in the same directory, is validated by `load()` + schema over a temp
copy of `content/`, and only then replaces the file atomically — **an invalid
edit never reaches disk**. CRLF and the final newline are preserved. Block scalars
(`|`, `>`) and multi-line scalars are **refused** in v1 (a replacement would change
the line count), and so are **anchored/aliased** scalars (rewriting one would
silently change every alias). The file's node must still hold the value the
command resolved — a row inserted or reordered since the address was resolved is
a **staleness** refusal (exit 1), not a silent write to the wrong row.
Concurrent `pasco edit` writers on one workspace serialize on
`content/.pasco-edit.lock` (a second waits 2 s, then refuses; a lock left by a
crash is broken after 30 s); an external editor is caught by the re-read
immediately before the atomic rename. A symlinked
content file keeps its link (the target is replaced) and the file mode is
preserved. Re-setting an identical value is a **noop** (exit 0, nothing written).
Rows the artifact does not emit can still be written — the command says *what* was
written and *whether it publishes*, separately.

**The preview (`--check`).** It renders the surface exactly the way `pasco build`
does — active variant (#238) → renderer → shared paste source — twice (current
profile, proposed profile) and prints the artifact lines that differ. That is why
it is honest where echoing the addressed row would not be: a paste surface
publishes exactly **one** bio (length priority `long > medium > short`), several
renderers never emit the statement, and a renderer-less surface carries no
headline. In those cases the artifact does not change and the preview says so —
with the reason, and exit `1`. It runs the writer's **eligibility and staleness
checks first**, so `--check` refuses the same ADDRESSED shapes `--set` refuses
(block/multi-line/anchored scalars, a stale row, a read-only **file**). A
read-only **directory**, a validation refusal or a concurrent change can still
fail at write time: the preview proves *what* would change, not that the
filesystem will accept it.

> v1 writes single-line scalars only — the recorded decision, not a bug. A
> workspace whose bios are wrapped by an editor must be reflowed to one line per
> value before `pasco edit` can write it; this repo's `minimal` fixture is already
> single-line for exactly that reason (it is the reference workspace the tests
> write through).

An address that resolves to **several** rows is refused with the rows printed: a
duplicate bio (`drift/duplicate-bio`), or two links on one platform (add
`label=<…>` — not drift: drift flags the same URL twice). An address that
resolves to **0 rows** is reported with the addresses the workspace does have;
`edit` never creates rows.

**What the edit invalidates (S3, #250).** Every run against a **resolved, writable
address** (a read, a preview, a write) reports the edited unit's **surface impact**: the §19 ledger is consulted by ledger key
(`bios:<platform>:<lang>:<length>`, `headlines:<platform>:<lang>`,
`positioning`), every **recorded** surface prints its state (`stale` when the
edit changes the unit's `contentHash`, `in-sync` when the record's hash still
matches), and a unit with no record reads `never` (the unit rollup). It is
**derived on every run and stored nowhere** (SPEC §20), from the same
`deployStatus` `pasco status` uses, so the two commands cannot disagree. The
block also carries the **drift count** — measured on every run, read included —
and the write's `validates:` line repeats it. The ledger tracks the SSOT **unit**,
the published block tracks the **artifact**: an edit can invalidate a recorded
surface while no artifact changes (a headline on a paste-only surface), and both
lines are true.

**The cap pre-flight (S4, #251).** Before a headline/bio value is accepted, the
edit measures it against the catalog's own `max-chars` cap — `content/checks.yaml`
when the workspace declares checks, the **sourced caps shipped with pasco**
otherwise — and prints the cap, its **cited source** and its provenance tier. Over-cap is a
**warning**, never a block (D12: facts warn, schema fails): `edit` says so, `check`
reports the same finding (same executor), and a platform with **no sourced cap**
says `cap: unknown` instead of guessing a number.

`--json` payload (inside the CLI's usual envelope, which also carries `command`,
`ok` and `exitCode`): `{ address, current, proposed, rendered, ok, noop, written,
warnings, stale, state, drift, limit, over, variant, reason }` — `stale` maps each **recorded** surface to
`in-sync|stale`, `state` is the §19 unit rollup (`never` when the unit has no
record; `null` for a read-only link or an address that is not one row), and
`drift` is the measured drift-check count (never a defaulted 0). `rendered` is the published text the edit produces (or `null`),
`noop` says the value was already there, `written` says the file changed, and
`warnings` carries the non-blocking findings a write proceeded through (a D22/§21
selection error that makes `pasco build` refuse the workspace — the SSOT write is
still valid, so it is reported, not blocked). Exit codes: **0** the write succeeded
(or the noop was a noop), or the preview changes the artifact · **1** the address
did not resolve to exactly one row, the target is read-only or changed under the
command (stale), the validation refused the result, or (preview only) the artifact
does not change or a D22/§21 selection error makes `build` refuse the workspace
(`kind: "selection"`) · **2** usage (malformed address, read-only field, block/multi-line
scalar, anchored/aliased scalar, a value with a line break, `--check` without
`--set`).

### The machine contract (`--json`, S5 / #252)

The payload is **frozen** (additive-only from here): `command`, `ok` and `exitCode`
are the envelope; the edit's own fields are

| Field | Type | Meaning |
|---|---|---|
| `address` | string | the canonical contract path |
| `current` | string \| null | the value before the change (the epic's `old`) |
| `proposed` | string \| null | the value the caller passed (the epic's `new`) |
| `rendered` | string \| null | the published lines the edit produces, or `null` |
| `ok` | boolean | the operation succeeded — for a preview, that the artifact changes (the epic's `valid`) |
| `noop` | boolean | the value was already there; nothing was written |
| `written` | boolean | the file changed |
| `warnings` | string[] | non-blocking findings the run proceeded through (over-cap, a selection error, a malformed catalog row) |
| `stale` | `Record<surface, "in-sync" \| "stale">` | each **recorded** surface of the edited unit |
| `state` | `"never" \| "in-sync" \| "stale" \| null` | the §19 unit rollup (`null` when the address is not one writable unit) |
| `drift` | number | the measured drift-check count |
| `limit` | `{cap, source, tier} \| null` | the applicable published cap; `null` when the catalog has none **or** the address type has no cap (a statement or a link) |
| `over` | boolean | the value exceeds that cap |
| `variant` | string \| null | the active #238 variant shadowing the **addressed platform** (a statement names its variants in `warnings` instead) |
| `reason` | string \| null | why the preview does not reach the artifact (the same sentence the human output prints as `why:`) |

The epic's sketch maps onto this contract as `old → current`, `new → proposed`,
`valid → ok`, `limits → limit`, `exit → exitCode`; a surface with no ledger record
is not a per-surface `never` in core's `SyncState` — it is the unit rollup in
`state`.

**Failure payload.** A code-1 failure carries `error: {kind, message}` and **no
`data`**; `kind` is `usage` (no JSON at all — the message goes to stderr) for
code 2, and `schema` · `load` · `stale` · `refused` · `selection` for code 1. A
`selection` error on a **preview** is exit 1, on a **write** exit 0 with the
finding in `warnings` (the SSOT write is valid even when `build` refuses).

**Non-goal (explicit):** `edit` never decides *which variant is live* — that is
`pasco refine --choose` (#238). What `edit` does is **name** the active variant so
nobody edits a field the renderer ignores.

Exit codes (one row per user-visible state; the CLI rows are pinned in
`packages/cli/tests/edit.test.ts`, the write-path rows — stale, read-only,
validation, lock contention — at the writer seam in
`packages/cli/tests/edit-write.test.ts`):

| Code | When |
|---|---|
| **0** | a read · a write · a noop · a preview that changes the artifact (over-cap included — D12: facts warn) |
| **1** | the address is not exactly one row · the target is read-only or stale · the validation refused the result · a preview that does **not** reach the artifact |
| **2** | usage: malformed address, unknown platform/lang, `--set` on a read-only link, `--check` without `--set`, an empty `--set`, a value with a line break, a block/multi-line/anchored scalar |

**The agent loop ("verify my edit"):**

```sh
# 1. preview — what will be published, and does it fit?
#    (use a field the artifact CARRIES: a headline on a paste-only platform exits 1
#     with rendered:null — see `reason`, which says why)
pasco edit 'headlines[platform=github-readme,lang=en].text' --set "$TEXT" --check --json
#    data.rendered = the published lines · data.reason = why not, when null ·
#    data.over = cap pre-flight · data.variant = #238 shadow

# 2. write only when the preview says what you meant (exit 0)
pasco edit 'headlines[platform=github-readme,lang=en].text' --set "$TEXT" --json
#    data.written = the file changed · data.stale = the surfaces this invalidated

# 3. read back (no --set) — the cheap confirmation the dogfood was missing
pasco edit 'headlines[platform=github-readme,lang=en].text' --json
```

### Publication truth (derived — SPEC §20.1, #242)

The `status` report ends with one line per surface that has a ledger record or an
artifact on disk (`--completeness` prints the coverage phrase only; `--selection`
is a different view, and `--mark`/`--verify` are the write paths):

```
github-readme: in-sync · artifact: matches-SSOT · limits: ok
```

- `sync` — the §19 ledger (`in-sync` / `stale` / `never`), unchanged.
- `artifact` — the artifact on disk vs what the SSOT renders **today**
  (`matches-SSOT` / `diverges` / `absent`). Offline: no fetch. `pasco build`
  repairs a divergence; §19.5's `out-of-band-drift` (a live page that no longer
  matches) forces `diverges` and is found by the opt-in `--verify`.
- `limits` — the offline `max-chars` catalog (§18.8/#240); the finding is printed
  under the line with its cited source.

It is **derived and never stored**: `--json` carries it as the additive
`publication` array, `--completeness` folds it in as *coverage of publication*
(the weighted percentage never moves because a surface drifted), and
`--write-checklist` writes the coverage phrase into the generated `CHECKLIST.md`.
The path is `src/publication.ts` (one home for artifact resolution and the three
axes) and `src/limits.ts` (the cap executor `check` and `status` share).

## Usage

```sh
pasco --help                 # full help
pasco validate               # workspace from .pascorc (or cwd)
pasco validate --workspace ~/profile-data --json
pasco build github-readme --lang en
pasco diff
pasco status                          # what's published where — per entry
pasco status linkedin                 # filter one surface
pasco status --mark identity linkedin # confirm a paste (records the current contentHash + attested)
pasco status --verify                 # §19.5 C1: does the live page still match? (the only network path)
                                      #   a surface with no extractor reports unverifiable: no-extractor
                                      #   (a DECLARED reason is stated, never written: only an attempt is recorded)
pasco status --write-checklist        # regenerate CHECKLIST.md from the ledger
pasco status                          # …also prints the derived publication-truth line:
                                      #   github-readme: in-sync · artifact: matches-SSOT · limits: ok
pasco refine linkedin --variants 3            # emits the agent task template (full flow M3)
pasco refine linkedin --choose li-en-2        # records the chosen variant in content/active.yaml
pasco check github-readme
pasco audit                                  # findings only: dangling-ref · contradiction · unsourced-claim
pasco audit --json                           # { schemaVersion, findings } — exit 1 iff any FAIL
pasco entity --json                          # entity facts + @id + sameAs + gaps (exit 1 without @id)
pasco entity --jsonld                        # paste-ready <script type="application/ld+json">
pasco post seed demo --text seed.md           # week-1 experiment: posts/<seed>/seed.md
pasco post task demo --channel linkedin,x   # task bundles (no LLM call)
pasco post choose demo --channel linkedin --variant linkedin-1
pasco post check demo                        # limits + URLs + {{fact:...}} refs
pasco post export demo --target postiz       # POST /posts draft payload
pasco export ai-policy --out ./public        # robots.txt + llms.txt + AI-POLICY.md (M9)
pasco export ai-policy --check               # exit 1 on an unsourced or >180-day UA list
pasco skills:export --list                   # skill channels shipped with this package
pasco skills:export ./pasco-skills           # copy them to a directory you choose
```

## Workspace resolution (D14)

`--workspace <path>` > `.pascorc` (`workspace` field, relative to the `.pascorc`
file) > current directory.

`.pascorc` (JSON, at the workspace root):

```json
{
  "workspace": ".",
  "defaults": { "lang": "en", "variants": 3 },
  "diff": { "tagPattern": "release-*" },
  "completeness": {
    "target": "github-milestone",
    "langs": ["en", "es"],
    "items": [
      { "id": "deployment", "weight": 0 },
      { "id": "geoAnchors", "weight": 0.4 }
    ]
  }
}
```

The `completeness` block is the policy for `pasco status --completeness` (issue
#102): `target` names the milestone; `langs` sets which languages text coverage is
measured in; `items` overrides the shipped weights per catalog id (a weight of `0`
drops the item from the percentage). Every field is optional — omitted fields use
`DEFAULT_COMPLETENESS_POLICY`. The percentage itself is **derived** and never
written to the workspace; only this policy is stored.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | OK — schema valid. Drift warnings still exit 0 (D12: facts warn, schema fails). |
| `1` | Schema or operational failure (workspace not found, bad YAML, not a git repo for `diff`), **or a data finding that blocks the command** (`edit`: the address is not exactly one row, or the edit does not change the published artifact; `audit`: at least one `FAIL` finding; `export ai-policy`: an unsourced or stale UA list, or a refused write). |
| `2` | Usage error (unknown command/platform/lang, bad flags). |

Human output is EN by default (D8/§11); `--json` prints a machine-readable
envelope on every command that reports data.

## Development

```sh
pnpm install
pnpm --filter @profile-as-code/cli test     # build + CLI-level vitest (executes dist/index.js)
pnpm -r build                                # strict TS, all packages
```

Tests execute the **built binary** against the core fixtures (reused, not
duplicated) plus a minimal invalid fixture — no mocks, real exit codes.

## Support

`pasco` is free (MIT). Consider a tip ;) — one line in `--help`, no post-install
script, no nag on every command:

- [Ko-fi](https://ko-fi.com/christianluciani)
- [Patreon](https://www.patreon.com/cluciani)
- [GitHub Sponsors](https://github.com/sponsors/ChristianLuciani)

A tip funds the engine (`packages/core`) and this CLI — the schema contract
(`docs/SPEC.md`), the renderers and the platform skills. It buys **no** SLA, no
priority handling, and no influence over the roadmap: a proposal is weighed on
its merits, in public. The code stays MIT — it is yours whether you tip or not.
