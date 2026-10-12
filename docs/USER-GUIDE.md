# profile-as-code — User Guide

From zero to a maintained, versioned professional profile: install the engine,
create your data workspace, load your facts for the first time, keep entries
updated, and stay in sync as the engine evolves.

> Audience: a **user** of the engine (not an engine contributor). Contributor
> docs live in [CONTRIBUTING.md](../CONTRIBUTING.md); the product contract is
> [SPEC.md](SPEC.md). This guide tracks `pasco` at `@profile-as-code/cli`
> version **0.3.0** — tagged `v0.3.0` and published to npm (`latest`) on
> 2026-10-11 (#113, #207).
> The [CLI's command/status table](../packages/cli/README.md) is authoritative
> on which commands are still partial; SPEC §12 holds the milestone roadmap.

> **Before you start — what you actually need.** Only two things are non-negotiable:
> a terminal and **Node.js ≥ 22**. Everything else depends on the on-ramp you take.
> Your workspace is **a folder** — a repo is the **recommended** place to keep it, not a
> requirement ([SPEC §9](SPEC.md)). Pick the on-ramp that fits what you have:
>
> | On-ramp | What it sets up | Automation + history | Account + repo |
> |---|---|---|---|
> | **A — template repo** *(recommended)* | the complete example workspace (§3 Option A) | yes — GitHub Actions + hosted history | **required** |
> | **B — local, `pasco init`** | a minimal, validating folder in seconds (§3 Option B) | **no** — nothing runs on a change and nothing versions it for you | **none** |
> | **C — bring your own storage** | the same `pasco init` scaffold, at a path you choose — disk, a synced folder, another git host (§3 Option C) | same as B | **none** |
>
> B and C are **peers** and keep the whole `pasco` command set except `diff`
> (which needs a git history); what they lose is the template's automation and its
> history. The npm package `@profile-as-code/cli` is **public**, so B and C need
> **no repo access at all** — that is the path this guide documents for a reader
> who has, or wants, no GitHub repo. The template repo is private today, so on-ramp
> A reaches insiders only until the family flip ([STANDARDS](STANDARDS.md),
> community item 10). The guided, no-terminal path is M5 (SPEC §12), tracked in
> [#122](https://github.com/ChristianLuciani/profile-as-code/issues/122).

---

## 0. Mental model (30 seconds)

One product, one workspace folder. You never put your data in the product.

| Thing | What it is | Who owns it | You touch it? |
|---|---|---|---|
| `profile-as-code` (this repo) | The **engine**: schema, core, CLI `pasco`, renderers, platform skills | Product (public) | Install it, update it — never put your data here |
| `profile-data-<username>` | **Your** workspace: facts as YAML, generated outputs, changelog — a **folder**; a repo is the recommended place to keep it, not a requirement | You (private by default) | Yes — this is where you edit everything |

Core principles (SPEC D1–D18, abbreviated):

- **Facts vs storytelling.** Dates, roles, DOIs, projects are deterministic data
  (schema + drift-check). Prose (bios, headlines) is generated per platform, in
  variants **you** choose.
- **The schema is the contract.** `schema/profile.schema.json` — every
  `content/*.yaml` file must satisfy it. `pasco validate` is the judge.
- **The engine never owns your data.** It reads your workspace by configured
  path (D14) and never edits your `content/*.yaml` facts — the only file it
  writes there is the variant you pick with `pasco refine --choose`
  (→ `content/active.yaml`). Generated outputs are separate: `profiles/` (§5),
  the `content/deployments.yaml` ledger and `CHECKLIST.md` (§7).
- **GEO is consistency.** An LLM that reads your LinkedIn and your GitHub must
  find identical facts — contradictions get you filtered out. That is why the
  engine checks drift across platforms.

---

## 1. Prerequisites

Scope the tools to the on-ramp you are taking — only the first row is needed by
**every** on-ramp:

| Tool | Version | Check | Needed for |
|---|---|---|---|
| Node.js | >= 22 | `node -v` | **every on-ramp** |
| git | any recent | `git --version` | §2 Option B (source install) · §3 Option A (clone your workspace) · `pasco diff` · §7 git/API deploys |
| pnpm | >= 9 | `pnpm -v` | §2 Option B (source install) only |
| GitHub CLI (`gh`) | any recent, authenticated | `gh auth status` | §3 Option A only — creating the workspace from the template |

`pasco` is a Node CLI built from TypeScript — no database, no server, no
accounts. §3 Option A uses `gh` to create the workspace from the template and
`git` to clone it, with SSH or HTTPS credentials configured for your account.
§3 Option B (`pasco init`) needs neither `gh` nor a GitHub account, and **§3
Option C needs nothing beyond Node ≥ 22** — it is the same `pasco init`
scaffold, written into the storage you already use.

Repo access is a prerequisite of the source and template paths, not of npm: §2
Option B clones a **private** engine repo and §3 Option A clones a **private**
template — a third party without access fails there (STANDARDS item 10; see the
table under "Before you start"). §2 Option A installs from the public npm
registry, and **§3 Options B/C work end-to-end from it**: no repo, no account,
nothing to clone.

---

## 2. Install the `pasco` CLI

Two paths. **Option A is the intended path for users** (published on npm);
**Option B builds from source** (contributors, or pinning an unreleased commit).

### Option A — npm (the user path)

```sh
npm i -g @profile-as-code/cli    # the package
pasco --version                  # the bin — expect 0.3.0
```

One global install: no clone, no build, nothing written outside the npm prefix.
`@profile-as-code/cli` is the **package**; `pasco` is the **bin** it provides.

> **Status** [OFICIAL] [WEB: registry.npmjs.org, checked 2026-10-12]: `@profile-as-code/cli@0.3.0`
> is **public** and tagged `latest` (published 2026-10-11T03:43:27Z; tag `v0.3.0` → `21e4cde`),
> and the bin was verified running (`node packages/cli/dist/index.js --version` → `pasco 0.3.0`
> on `main`, 2026-10-12).
> Caveat: while the engine repo stays private the package's `repository.url` points at a repo
> outsiders cannot read, and **no published version carries a provenance attestation** — npm
> emits it only with a public source repo, and the 0.3.0 publish ran on a successful OIDC
> exchange with the source still private (STANDARDS §Order ratified 2026-10-03;
> `dist.attestations` absent, re-checked 2026-10-12). The key migration itself is **done**
> ([#80](https://github.com/ChristianLuciani/profile-as-code/issues/80) closed; token deleted
> in npm and GitHub).
>
> Why the names (the names were checked 2026-09-30): the bin was renamed `pac` → `pasco`
> (issue #38) because an unrelated npm package named `pac` already ships a `pac`
> binary (`pac@1.0.0`, published 2015-04-26, still latest), while `pasco` itself
> was unclaimed (`404` at the time) — so there is no global-install bin conflict.
> `pasco` is now claimed by the real `v0.3.0` publish (2026-10-11), so no
> placeholder reservation is needed.

### Option B — from source

```sh
# 1. Clone the engine (the product repo — private until the public flip;
#    the clone needs GitHub access)
git clone https://github.com/ChristianLuciani/profile-as-code.git
cd profile-as-code

# 2. Install workspace dependencies (pnpm monorepo)
pnpm install

# 3. Build the CLI (also builds core — the CLI consumes it, never re-implements it)
pnpm --filter @profile-as-code/cli build
# → packages/cli/dist/index.js
```

Make `pasco` callable from anywhere (pick one):

```sh
# symlink into a PATH dir (recommended)
mkdir -p ~/.local/bin
ln -s "$(realpath packages/cli/dist/index.js)" ~/.local/bin/pasco
# make sure ~/.local/bin is in your PATH (add to ~/.zshrc if needed)

# alias
alias pasco='node /absolute/path/to/profile-as-code/packages/cli/dist/index.js'
```

### Verify

```sh
pasco --version   # what you installed — 0.3.0 today
pasco --help      # command list + exit-code contract
```

`--help` prints `init`, `validate`, `build`, `diff`, `refine`, `check`, `status`
and `skills:install`, plus the exit-code contract: `0` ok · `1` schema or
workspace failure · `2` usage error. `pasco status --help` covers the deploy
ledger and its opt-in live check (`--mark`, `--verify`, `--write-checklist`,
`--completeness`). Which of those commands are still partial is stated in the
[CLI's command table](../packages/cli/README.md).

> Updating the engine later? See [§8.2](#82-update-the-engine).

---

## 3. Create your workspace (`profile-data-<username>`)

You need a place for your facts. It is **a folder** — a repo is the recommended
place to keep it, not a requirement (SPEC §9). Three on-ramps, three capability
profiles:

| On-ramp | Sets up | Automation + history | Account + repo |
|---|---|---|---|
| **A — template repo** *(recommended)* | the full example workspace | yes — GitHub Actions + hosted history | **required** |
| **B — `pasco init`** | a minimal validating folder in seconds | **no** — nothing runs on a change; nothing versions it | **none** |
| **C — bring your own storage** | nothing — the folder lives where you already work | same as B | **none** |

### Option A — the template repo (recommended)

This is the on-ramp with the complete package: full commented example, operational
docs, licence, and repo automation. It requires a GitHub account and a repo — if you
have neither and do not want one, skip to Option B or C.

[`ChristianLuciani/profile-data-template`](https://github.com/ChristianLuciani/profile-data-template)
is a GitHub template repository with a complete, documented example (a fictional
person) plus `CHANGELOG.md` and `CHECKLIST.md` already wired for the workflow.

1. Create your workspace from the template — CLI (recommended):

   ```sh
   gh repo create profile-data-<username> \
     --template https://github.com/ChristianLuciani/profile-data-template \
     --private
   ```

   Or on GitHub: **Use this template**, then rename the result to
   **`profile-data-<username>`** and make it **private**:

   ```sh
   gh repo edit <you>/profile-data-<username> --visibility private \
     --accept-visibility-change-consequences
   # (or Settings → General → Danger Zone → Change visibility)
   ```

   Your data is yours — private by default.
2. Clone it locally (SSH needs a configured key; if port 22 is blocked, use
   the HTTPS URL — `git clone https://github.com/<you>/profile-data-<username>.git`):

   ```sh
   git clone git@github.com:<you>/profile-data-<username>.git
   cd profile-data-<username>
   ```

The template ships every content file as a commented example — replace the
fiction with your own facts (see §4).

### Option B — `pasco init` (minimal local scaffold, no account)

```sh
pasco init ~/profile-data-<username>              # person flavor (default)
pasco init ~/profile-data-<username> --flavor brand   # commercial/brand identity (D15)
```

`pasco init` scaffolds a minimal, `pasco validate`-clean skeleton and **refuses to
overwrite** anything that exists:

| Flavor | What it creates |
|---|---|
| `person` (default) | `content/identity.yaml` + `README.md` + `.pascorc` |
| `brand` | `content/{identity,socialHandles,newsletter,podcast,press,audiences,flavor}.yaml` + `README.md` + `.pascorc` |

Option B starts you nearly empty — you add the other blocks yourself as you
need them (they are optional; see §4). It is **minimal on purpose** (SPEC §9.2):
the complete package — licence, operational docs, automation — lives in the
template repo (Option A). The trade-off is explicit: **no automation and no
history** come with this on-ramp; everything else works the same. If you want
history, `git init` in the folder yourself; nothing sets it up for you.

### Option C — bring your own storage

The workspace is just files, so it can live wherever you already work: a local
folder, a synced cloud folder, or a git host other than GitHub. There is no
separate mechanism — you run the same scaffold at your own path:

```sh
pasco init /path/to/where-you-already-work/profile-data
```

Point `pasco init` at the folder you want (it refuses to overwrite an existing
`content/`), or move a folder you already have to its new home. **Same
capabilities as Option B by construction** (validate / build / refine / check),
same absence of automation and history unless your storage provides them.

> **Which later sections assume a repo?** §7 (git/API deploys) and §8 (update loop)
> assume on-ramp A: they commit, tag and push. On on-ramps B/C the same loop works
> with the git steps replaced by your storage's own versioning — or dropped.
> The whole `pasco` command set is unaffected except `diff`, the one command that
> needs a git history of its own.

### Configure `.pascorc` (optional but useful)

`.pascorc` is JSON at the workspace root:

```json
{
  "workspace": ".",
  "defaults": { "lang": "en", "variants": 3 },
  "diff": { "tagPattern": "release-*" }
}
```

- `defaults.lang` — language used when `--lang` is not passed.
- `defaults.variants` — default for `pasco refine --variants N`.
- `diff.tagPattern` — the git tag pattern that marks a release (used by `pasco diff`).

Workspace resolution order (D14): `--workspace <path>` flag → `.pascorc` →
current directory. With `workspace: "."`, run `pasco` from the workspace root and
you never need flags.

---

## 4. First data load

### 4.1 The golden rule: one file = one root property

Every file in `content/` maps to one root property of the schema — the file
holds the value **directly**, with no wrapper key. `bios.yaml` contains the
`bios[]` array itself; `identity.yaml` contains the `identity` object itself.

| File | Root property | What goes in |
|---|---|---|
| `identity.yaml` | `identity` | name, location, photo, **`links[]`** — the canonical URL list |
| `positioning.yaml` | `positioning` | statement, audiences, `geo` (semantic anchors, citations goal) |
| `bios.yaml` | `bios` | one entry per platform+lang+length: short/medium/long text |
| `headlines.yaml` | `headlines` | per platform + lang headline |
| `skills.yaml` | `skills` | name, level, keywords, `geoKeywords`, `platformWeights{}` |
| `experience.yaml` | `experience` | role, org, start/end, highlights (per lang) |
| `projects.yaml` | `projects` | name, status, description, links, keywords, `evidence[]` |
| `publications.yaml` | `publications` | title, venue, year, doi / url / authors |
| `keywords.yaml` | `keywords` | `seo{platform:[]}` and `geo{associations, claims}` |
| `education.yaml` *(v1.1)* | `education` | formal education (degree, field, institution) |
| `languages.yaml` *(v1.1)* | `languages` | spoken languages + level |

Brand flavor (D15) adds: `socialHandles` (handle matrix with claim status),
`newsletter`, `podcast`, `press`, `audiences`, and org-identity fields in
`identity.yaml` (`orgName`, `logo`, `mission`, `tagline`, `brandVoice`,
`established`). Every workspace declares its flavor in `content/flavor.yaml`
(default `person`).

### 4.2 Rules that save you pain

1. **Every text field is a language map.** EN is required; ES/FR optional.

   ```yaml
   statement:
     en: I build spec-driven AI systems that ship.
     es: Construyo sistemas de IA spec-driven que se entregan.
   ```

2. **Proper nouns are never translated.** Organizations, institutions, venues
   and people names are plain strings — identical in every language. Translating
   a name changes the fact (SPEC §11) and breaks GEO consistency.

   ```yaml
   # correct
   org: Universidad de Buenos Aires
   # wrong — schema rejects a langMap here
   # org: { en: University of Buenos Aires }
   ```

3. **`identity.links` is the single source of URLs.** Renderers never emit a
   URL that is not listed there (the drift rule). Add every platform once:

   ```yaml
   links:
     - platform: github
       label: GitHub
       url: https://github.com/you
     - platform: linkedin
       label: LinkedIn
       url: https://linkedin.com/in/you
   ```

4. **Facts are byte-exact.** Dates, DOIs, years, counts must be identical
   everywhere — that consistency *is* your citability by LLMs (GEO, SPEC §8).
5. **Verifiable claims carry evidence.** Projects may include `evidence[]`
   (sources/links backing a claim). Unverifiable claims get dropped by
   cite-aware systems.

### 4.3 The loop: edit → validate → repeat

Start minimal (identity + positioning is enough to begin), then add blocks:

```sh
pasco validate    # run this after EVERY edit
```

Two kinds of results (D12):

- **Schema violations → FAIL (exit 1).** Fix the YAML: the message names the
  file and the offending value. The contract is non-negotiable — this is what
  makes everything downstream deterministic.
- **Drift / GEO findings → WARN (exit 0).** Facts that contradict across
  platforms or GEO gaps. These do not block you, but fix them: contradictions
  are exactly what gets a profile discounted by LLMs reading it.

---

## 5. Validate & build

```sh
pasco validate [--json]              # schema (FAIL, exit 1) + drift/geo (WARN, exit 0)
pasco build [platform] [--lang]      # deterministic base texts per platform+lang
pasco diff [--json]                  # what changed since the last release tag
```

- `pasco build` without an argument renders **all** platforms; with
  `--lang` you pick the language slice (defaults to `.pascorc → defaults.lang`).
- Platforms with a **renderer** write deploy artifacts into your workspace:
  `profiles/<platform>/README.md`. Today: `github-readme` (person) and
  `github-org` (brand only — skipped for person workspaces). Other platforms
  print their text slices in the terminal.
- **`profiles/` are committed** — they ARE the deploy artifacts — and are
  regenerated by `pasco build`. Never edit them by hand; your edits get overwritten.
- `pasco diff` compares the **committed** history of your workspace against the
  latest git tag matching `.pascorc → diff.tagPattern` (default `release-*`) and
  hints what belongs in `CHANGELOG.md`; when no tag matches the pattern it falls
  back to the first commit. Uncommitted edits do not appear — commit first.
  **Verified 2026-10-12:** the engine repo's release tag is `v0.3.0`, which does
  **not** match the default `release-*` pattern (`git tag -l 'release-*'` →
  empty; `packages/cli/src/commands/diff.ts`), so with the default config
  `pasco diff` still diffs against the first commit there — set
  `diff.tagPattern` to the tag convention your workspace uses.

All commands accept `--json` for machine-readable output, and `--workspace <path>`
to target a workspace other than the one in `.pascorc`.

---

## 6. Add entries & update content

The routine never changes:

```sh
# 1. Edit content/<file>.yaml
# 2. Validate
pasco validate
# 3. Build (regenerate outputs)
pasco build            # or a single platform: pasco build github-readme --lang en
# 4. Record the change
$EDITOR CHANGELOG.md # date + what changed + which platforms need re-paste
git add -A && git commit -m "feat: add <what>"
```

### Examples

> Match the file's existing list indentation when appending: the template
> indents list items by two spaces (`publications.yaml`, `projects.yaml`,
> `skills.yaml`, …) — `experience.yaml` is the exception (top-level items).
> The ledger row blocks (experience/projects/publications, plus education/press)
> take an optional `id` — the template's rows carry one, and a row without it
> shows as *untracked* in `pasco status` (§7). `skills.yaml` rows take no `id`.

**Add an experience entry** (`experience.yaml`):

```yaml
- id: exp-acme                     # optional: the ledger address in `pasco status` (§7)
  role:
    en: Senior AI Engineer
    es: Ingeniero de IA Senior
  org: Example Corp                 # proper noun — plain string, never a langMap
  start: "2024-03-01"               # ISO date, YYYY-MM-DD (not YYYY-MM)
  end: "present"                    # a date, or the string "present"
  highlights:
    en:
      - Shipped the spec-driven engine used by X teams.
      - Led migration to schema-first contracts.
```

**Add a publication** (`publications.yaml`) — DOI is the GEO anchor when you
have one; otherwise use `url` (with `authors`, a single string):

```yaml
  - id: pub-harness-readiness
    title: Agentic OSS Harness Readiness
    venue: arXiv
    year: 2026
    doi: 10.48550/arXiv.2608.xxxxx  # or: url: https://arxiv.org/abs/...
    authors: "Luciani, C."           # single string, not an array
```

**Add a project** (`projects.yaml`) — description per lang, links from
`identity.links` values, evidence for verifiable claims:

```yaml
  - id: proj-profile-as-code
    name: profile-as-code
    status: active
    description:
      en: Spec-driven engine that renders one versioned profile to every platform.
    links: [https://github.com/you/profile-as-code]   # must also be in identity.links
    keywords: [profile, ssot, schema, geo]            # plain array, not a langMap
    evidence: []                    # claims that can be verified, with sources
```

**Add a skill** (`skills.yaml`) — `platformWeights` orders what each platform
shows first; each weight is **0..1** (a fraction, not a 0–10 score):

```yaml
  - name: TypeScript
    level: expert
    keywords: [node, vitest, monorepo]
    geoKeywords: [type-safe tooling]
    platformWeights: { github-readme: 1.0, linkedin: 0.8, upwork: 0.9 }
```

**Brand only — claim a handle** (`socialHandles.yaml`): one row per platform,
`status: claimed|pending`; a claimed handle should carry its URL (or match
`identity.links`) so the handle-consistency rules hold.

### AI-refined texts (`pasco refine`)

Bios and headlines exist in two layers: the deterministic `pasco build` base
texts, and per-platform **variants** produced by an executing agent (AionUi,
Claude Code, Cursor, pi… — the CLI never calls an LLM itself, D10/D13):

```sh
pasco refine linkedin --variants 3    # emits the agent task: facts + platform skill
pasco refine linkedin --choose linkedin-en-2   # id convention: <platform>-<lang>-<n>
```

The full variant generation flow lands with M3; `--choose` already works and
writes only `content/active.yaml` — the §5/§7 outputs are generated separately.

### Keep `CHANGELOG.md` and tags honest

Every workspace change gets a CHANGELOG line (date + what changed + which
platforms need re-pasting). Tag meaningful points so `pasco diff` has a baseline:

```sh
git tag release-2026-09 && git push --tags
```

`pasco diff` then tells you exactly which files changed since that release —
your re-paste list.

---

## 7. Deploy

Two deploy classes (D9):

| Class | Platforms | How |
|---|---|---|
| **manual** | LinkedIn, Upwork, X, ResearchGate, Substack, Patreon… | copy the generated/curated text → paste into the platform → verify → `pasco status --mark <block>:<id> <platform>` |
| **git/API** | GitHub profile README, (web, M5) | the artifact is a file: `profiles/github-readme/README.md` → PR/commit it into your GitHub profile repo (e.g. `<you>/<you>`) — the human merges |

Non-negotiables:

- Never hand-edit a deployed surface. If it's wrong, fix `content/`, rebuild,
  redeploy — the SSOT is the only place edits happen.
- After pasting, verify facts — cross-platform factual consistency is the whole
  point (GEO). Then confirm the deploy in the ledger:
  `pasco status --mark <block>:<id> <platform>` records `deployedAt` + the current
  `contentHash` — only `pasco` writes `content/deployments.yaml` (D14). It also
  records the **certification** of the deploy (`attested`: *you* said so).
- `pasco status` is the per-entry answer to "what is published where, and what's
  out of date": every unit shows `in-sync` / `stale` / `never` per surface, plus
  template-origin flags and untracked rows (add an `id` to track them).
- **Certification is a second, independent dimension** (§19.5, v1.10). Staleness
  answers *"did my source change after the deploy?"*; certification answers *"how
  was the deploy confirmed, and does the live page still carry it?"* — a
  `stale` + `verified` pair is normal and meaningful:

  | Certification | Means |
  |---|---|
  | `verified` | a live check fetched the page and it still matches the anchor |
  | `attested` | the human `--mark` said so; never actually fetched |
  | `unverifiable` | no check was possible or it did not complete (`no-extractor`, `no-artifact-url`, `http-403`, `network-error`, `host-not-allowed`, `unattributed`…) |
  | `out-of-band-drift` | a live check ran and the page no longer matches — never green |

  Only `verified` and `attested` are *confirmation strengths* — a surface is
  "fully certified" only when every one of its surfaces is one of those two.
- **`pasco status --verify`** (opt-in) runs that live check: it derives each
  recorded surface's artifact URL from your `identity.links` URL SSOT, refuses
  any host outside the surface's declared allowlist **before** making a request,
  then fetches once per surface, sequentially, with no retries — the engine's only
  network path, and never implicit in `status`, `build`, `validate` or `check`.
  A non-2xx or a network failure is reported honestly (`unverifiable` + the
  reason) and never breaks the report; `--verify` records that evidence in the
  ledger, and committing that file is yours (D2).
- **Declared vs. recorded.** A reason that comes from a *declaration* — the
  platform has no extractor (`no-extractor`), no derivable URL
  (`no-artifact-url`), or is walled (`walled`, `walled-con-api`) — is *stated* by
  the `--verify` run and never written: a declaration is not an event, so a walled
  platform needs no ledger row. A reason that comes from an *attempt*
  (`http-403`, `network-error`) **is** recorded with its evidence and read back
  as-is — that evidence is the audit trail, and a later `status` shows it. A
  record with no certification block at all reads `attested`: never machine-checked,
  only confirmed by you.
- **v1 limit — anchors are forward-only.** A record with no anchor cannot be
  judged: a live check *observes* the page and records
  `unverifiable: unattributed` — never a quietly-green `in-sync`. (With no
  extractor available yet, that check cannot run at all and the surface is
  reported `no-extractor` instead.) Re-run `pasco status --mark …` once an anchor
  can be recorded to close the gap.
- `CHECKLIST.md` is a **generated view** of the ledger:
  `pasco status --write-checklist` regenerates it — do not edit it by hand. Each
  surface carries its certification token (e.g. `linkedin (in-sync/attested)`), so
  a surface that is not machine-checked is never presented as a bare `in-sync`.
- Deploy steps and post-deploy verification for `manual` platforms live in each platform
  skill's `playbook.md` (`skills/<platform>/`); a shared `templates/playbooks/` directory is
  planned for M4/M5 (SPEC §12).

---

## 8. Keep it updated

### 8.1 Update your data (the routine you will actually run)

Any life event — new role, new paper, new project, changed positioning — is the
same loop:

```sh
cd ~/profile-data-<username>
$EDITOR content/<file>.yaml
pasco validate                       # fix schema; read drift warnings
pasco build                          # regenerate outputs
$EDITOR CHANGELOG.md               # what changed → which platforms to re-paste
git add -A && git commit -m "feat: <what>"
git push
# deploy (paste / PR per §7) → pasco status --mark <block>:<id> <platform>
pasco status                         # what's stale per surface (D18 deploy ledger)
pasco status --verify                # optional: does the live page still match? (§19.5)
pasco status --write-checklist       # regenerate CHECKLIST.md from the ledger
git add -A && git commit -m "chore: deploy ledger + checklist view"
git tag release-YYYY-MM && git push --tags   # baseline for the next pasco diff
```

`pasco diff` between releases is your **re-paste list**: it names the changed
facts so you know which platforms need attention. `pasco status` is the
**per-entry follow-through**: it tells you which of those re-pastes are done
(`in-sync`) and which are still owed (`stale` / `never`) — see §7.

### 8.2 Update the engine

Match the line to how you installed it in [§2](#2-install-the-pasco-cli):

```sh
# Option A — npm
npm i -g @profile-as-code/cli@latest

# Option B — from source
cd /path/to/profile-as-code
git pull
pnpm install
pnpm --filter @profile-as-code/cli build   # rebuild core + cli
```

Then re-run against your workspace:

```sh
pasco --version && pasco validate && pasco build
```

- Schema releases are **additive** (semver minor) — an existing workspace keeps
  validating; new fields are opt-in. See `schema/README.md` in the engine for
  what changed and the engine's `CHANGELOG.md`/README for milestone notes.
- If `pasco build` output changes (byte-diff in `profiles/`), commit the
  regenerated files — `profiles/` are pure functions of your content, so any
  byte change is either your data or an engine release doing its job.
- If a *new* renderer/platform lands, nothing to migrate: `pasco build` picks it
  up; add data only when you want that surface.

### 8.3 Multiple identities (person + brand, multi-workspace)

One workspace per identity, same engine (D14/D15):

- Naming family: the `profile-data-` prefix wins and every workspace repo names
  its owner — `profile-data-<username>` (you, e.g. `profile-data-maria`),
  `profile-data-topia` (a brand), never `topia-data`.
- Each identity lives in its own repo; scaffold a brand with
  `pasco init --flavor brand`.
- Switch workspaces with `pasco --workspace <path> <cmd>`, or keep one `.pascorc`
  per working directory (its `workspace` field points where you want).

---

## 9. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `pasco: command not found` | Not on `$PATH`. Source install: redo the symlink/alias step in §2 Option B. npm install: the global bin dir must be on `$PATH` (`npm prefix -g`, then its `bin/`). |
| Exit `2` on a command | Usage error: unknown command/platform/lang. Run `pasco <cmd> --help`. |
| Exit `1` on `validate` | Schema violation — read the message (file + value). Most common: a langMap where a plain string is required (proper nouns!), a missing `en`, or a bad date format. |
| Exit `1` on `diff` | Not a git repo (or no git history) — `pasco diff` needs your workspace to be a git repository. |
| Drift warnings but exit `0` | Expected (D12): facts warn, schema fails. Fix contradictions — they are citability leaks, not blockers. |
| `profiles/<platform>/` missing after `build` | That platform has no renderer yet (M4+) — its slice prints to the terminal instead. `github-org` requires flavor `brand`. |
| `refusing to scaffold` on `pasco init` | A workspace already exists in the target dir — `init` never overwrites. |
| Workspace not found | Resolution is `--workspace` → `.pascorc` → cwd. Run from the workspace root or pass `--workspace`. |

---

## 10. Where everything lives

| Surface | Location | Role |
|---|---|---|
| Schema (the contract) | this repo, `schema/profile.schema.json` + `schema/README.md` | what data must look like |
| Core engine | this repo, `packages/core` | load · drift · geo · compile |
| CLI | this repo, `packages/cli` (`pasco`) | everything above, as commands |
| Renderers | this repo, `packages/renderers` | deterministic per-platform artifacts |
| Platform skills (SOTA knowledge) | this repo, `skills/<platform>/` | applied by your agent during `pasco refine` (M3) |
| Deploy playbooks | per-platform skills, `skills/<platform>/playbook.md` (shared `templates/playbooks/` planned, M4/M5) | copy-paste + verification steps |
| Your facts | `profile-data-<username>` (private), `content/*.yaml` | the SSOT — the only thing you edit |
| Generated outputs | your workspace, `profiles/` | committed deploy artifacts — never hand-edited |
| Chosen variants | your workspace, `content/active.yaml` | what is live per platform/lang |
| Re-paste ledger | your workspace, `CHANGELOG.md` + `CHECKLIST.md` | what changed and what was verified |

---

## Command cheat sheet

```sh
pasco init [dir] [--flavor person|brand]   # scaffold a workspace (never overwrites)
pasco validate [--json]                    # schema FAIL + drift/geo WARN (D12)
pasco build [platform] [--lang] [--json]   # base texts; renderers write profiles/
pasco diff [--json]                        # changes since last release-* tag
pasco refine <platform> [--lang] [--variants N]   # emit the agent task template (full flow M3)
pasco refine <platform> --choose <id>      # record chosen variant in content/active.yaml
pasco check [platform]                     # offline rules + checks catalog (rest of catalog M4)
pasco skills:install <agent>               # print the skills-studio projection command
pasco --workspace <path> <cmd>             # target a workspace explicitly
pasco --json <cmd>                         # machine-readable output
```

Exit codes: `0` ok (drift warnings still 0) · `1` schema/workspace failure · `2` usage error.