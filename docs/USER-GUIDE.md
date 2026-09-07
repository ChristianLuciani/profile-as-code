# profile-as-code — User Guide

From zero to a maintained, versioned professional profile: install the engine,
create your data workspace, load your facts for the first time, keep entries
updated, and stay in sync as the engine evolves.

> Audience: a **user** of the engine (not an engine contributor). Contributor
> docs live in [CONTRIBUTING.md](../CONTRIBUTING.md); the product contract is
> [SPEC.md](SPEC.md). This guide reflects the M1–M2 state of the CLI (`pac`).

---

## 0. Mental model (30 seconds)

Two repos, two roles. You never mix them.

| Repo | What it is | Who owns it | You touch it? |
|---|---|---|---|
| `profile-as-code` (this repo) | The **engine**: schema, core, CLI `pac`, renderers, platform skills | Product (public) | Install it, update it — never put your data here |
| `profile-data` | **Your** workspace: facts as YAML, generated outputs, changelog | You (private by default) | Yes — this is where you edit everything |

Core principles (SPEC D1–D15, abbreviated):

- **Facts vs storytelling.** Dates, roles, DOIs, projects are deterministic data
  (schema + drift-check). Prose (bios, headlines) is generated per platform, in
  variants **you** choose.
- **The schema is the contract.** `schema/profile.schema.json` — every
  `content/*.yaml` file must satisfy it. `pac validate` is the judge.
- **The engine never owns your data.** It reads your workspace by configured
  path (D14). The only thing it writes into your workspace is the variant you
  pick with `pac refine --choose` (→ `content/active.yaml`).
- **GEO is consistency.** An LLM that reads your LinkedIn and your GitHub must
  find identical facts — contradictions get you filtered out. That is why the
  engine checks drift across platforms.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | >= 20.19 | `node -v` |
| pnpm | >= 9 | `pnpm -v` |
| git | any recent | `git --version` |

`pac` is a Node CLI built from TypeScript — no database, no server, no accounts.

---

## 2. Install the engine and the `pac` CLI

Today `pac` installs from source (an npm global package is planned for a later
milestone — see the engine roadmap).

```sh
# 1. Clone the engine (public product repo)
git clone https://github.com/ChristianLuciani/profile-as-code.git
cd profile-as-code

# 2. Install workspace dependencies (pnpm monorepo)
pnpm install

# 3. Build the CLI (also builds core — the CLI consumes it, never re-implements it)
pnpm --filter @profile-as-code/cli build
# → packages/cli/dist/index.js
```

Make `pac` callable from anywhere (pick one):

```sh
# Option A — symlink into a PATH dir (recommended)
mkdir -p ~/.local/bin
ln -s "$(realpath packages/cli/dist/index.js)" ~/.local/bin/pac
# make sure ~/.local/bin is in your PATH (add to ~/.zshrc if needed)

# Option B — alias
alias pac='node /absolute/path/to/profile-as-code/packages/cli/dist/index.js'
```

Verify:

```sh
pac --help
```

You should see the command list (`init`, `validate`, `build`, `diff`, `refine`,
`check`, `skills:install`) and the exit-code contract: `0` ok · `1` schema or
workspace failure · `2` usage error.

> Updating the engine later? See [§8.2](#82-update-the-engine).

---

## 3. Create your workspace (`profile-data`)

You need a place for your facts. Two ways:

### Option A — the template repo (recommended)

`ChristianLuciani/profile-data-template` is a GitHub template repository with a
complete, documented example (a fictional person) plus `CHANGELOG.md` and
`CHECKLIST.md` already wired for the workflow.

1. On GitHub: **Use this template** (or fork) `profile-data-template`.
2. Rename the result to **`profile-data`** and make it **private** — your data
   is yours (private by default).
3. Clone it locally:

   ```sh
   git clone git@github.com:<you>/profile-data.git
   cd profile-data
   ```

The template ships every content file as a commented example — replace the
fiction with your own facts (see §4).

### Option B — `pac init` (minimal local scaffold)

```sh
pac init ~/profile-data              # person flavor (default)
pac init ~/profile-data --flavor brand   # commercial/brand identity (D15)
```

`pac init` scaffolds a minimal, `pac validate`-clean skeleton and **refuses to
overwrite** anything that exists:

| Flavor | What it creates |
|---|---|
| `person` (default) | `content/identity.yaml` + `README.md` + `.pacrc` |
| `brand` | `content/{identity,socialHandles,newsletter,podcast,press,audiences,flavor}.yaml` + `README.md` + `.pacrc` |

Option B starts you nearly empty — you add the other blocks yourself as you
need them (they are optional; see §4). The template repo (Option A) gives you
the full example to learn from; most users should start there.

### Configure `.pacrc` (optional but useful)

`.pacrc` is JSON at the workspace root:

```json
{
  "workspace": ".",
  "defaults": { "lang": "en", "variants": 3 },
  "diff": { "tagPattern": "release-*" }
}
```

- `defaults.lang` — language used when `--lang` is not passed.
- `defaults.variants` — default for `pac refine --variants N`.
- `diff.tagPattern` — the git tag pattern that marks a release (used by `pac diff`).

Workspace resolution order (D14): `--workspace <path>` flag → `.pacrc` →
current directory. With `workspace: "."`, run `pac` from the workspace root and
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
pac validate    # run this after EVERY edit
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
pac validate [--json]              # schema (FAIL, exit 1) + drift/geo (WARN, exit 0)
pac build [platform] [--lang]      # deterministic base texts per platform+lang
pac diff [--json]                  # what changed since the last release tag
```

- `pac build` without an argument renders **all** platforms; with
  `--lang` you pick the language slice (defaults to `.pacrc → defaults.lang`).
- Platforms with a **renderer** write deploy artifacts into your workspace:
  `profiles/<platform>/README.md`. Today: `github-readme` (person) and
  `github-org` (brand only — skipped for person workspaces). Other platforms
  print their text slices in the terminal.
- **`profiles/` are committed** — they ARE the deploy artifacts — and are
  regenerated by `pac build`. Never edit them by hand; your edits get overwritten.
- `pac diff` compares your workspace against the latest `release-*` git tag
  (no tag yet → the first commit) and hints what belongs in `CHANGELOG.md`.

All commands accept `--json` for machine-readable output, and `--workspace <path>`
to target a workspace other than the one in `.pacrc`.

---

## 6. Add entries & update content

The routine never changes:

```sh
# 1. Edit content/<file>.yaml
# 2. Validate
pac validate
# 3. Build (regenerate outputs)
pac build            # or a single platform: pac build github-readme --lang en
# 4. Record the change
$EDITOR CHANGELOG.md # date + what changed + which platforms need re-paste
git add -A && git commit -m "feat: add <what>"
```

### Examples

**Add an experience entry** (`experience.yaml`):

```yaml
- role:
    en: Senior AI Engineer
    es: Ingeniero de IA Senior
  org: Example Corp                 # proper noun — plain string, never a langMap
  start: 2024-03
  end: null                         # null = present
  highlights:
    en:
      - Shipped the spec-driven engine used by X teams.
      - Led migration to schema-first contracts.
```

**Add a publication** (`publications.yaml`) — DOI is the GEO anchor when you
have one; otherwise use `url` + `authors`:

```yaml
- title: Agentic OSS Harness Readiness
  venue: arXiv
  year: 2026
  doi: 10.48550/arXiv.2608.xxxxx    # or: url: https://arxiv.org/abs/...
  authors: [Christian Luciani, ...]
```

**Add a project** (`projects.yaml`) — description per lang, links from
`identity.links` values, evidence for verifiable claims:

```yaml
- name: profile-as-code
  status: active
  description:
    en: Spec-driven engine that renders one versioned profile to every platform.
  links: [https://github.com/you/profile-as-code]
  keywords:
    en: [profile, ssot, schema, geo]
  evidence: []                      # claims that can be verified, with sources
```

**Add a skill** (`skills.yaml`) — `platformWeights` orders what each platform
shows first:

```yaml
- name: TypeScript
  level: expert
  keywords: [node, vitest, monorepo]
  geoKeywords: [type-safe tooling]
  platformWeights: { github-readme: 10, linkedin: 8, upwork: 9 }
```

**Brand only — claim a handle** (`socialHandles.yaml`): one row per platform,
`status: claimed|pending`; a claimed handle should carry its URL (or match
`identity.links`) so the handle-consistency rules hold.

### AI-refined texts (`pac refine`)

Bios and headlines exist in two layers: the deterministic `pac build` base
texts, and per-platform **variants** produced by an executing agent (AionUi,
Claude Code, Cursor, pi… — the CLI never calls an LLM itself, D10/D13):

```sh
pac refine linkedin --variants 3    # emits the agent task: facts + platform skill
pac refine linkedin --choose li-en-2   # records YOUR pick in content/active.yaml
```

The full variant generation flow lands with M3; `--choose` already works and is
the only thing the engine ever writes into your workspace.

### Keep `CHANGELOG.md` and tags honest

Every workspace change gets a CHANGELOG line (date + what changed + which
platforms need re-pasting). Tag meaningful points so `pac diff` has a baseline:

```sh
git tag release-2026-09 && git push --tags
```

`pac diff` then tells you exactly which files changed since that release —
your re-paste list.

---

## 7. Deploy

Two deploy classes (D9):

| Class | Platforms | How |
|---|---|---|
| **manual** | LinkedIn, Upwork, X, ResearchGate, Substack, Patreon… | copy the generated/curated text → paste into the platform → verify → mark the box in `CHECKLIST.md` |
| **git/API** | GitHub profile README, (web, M5) | the artifact is a file: `profiles/github-readme/README.md` → PR/commit it into your GitHub profile repo (e.g. `<you>/<you>`) — the human merges |

Non-negotiables:

- Never hand-edit a deployed surface. If it's wrong, fix `content/`, rebuild,
  redeploy — the SSOT is the only place edits happen.
- After pasting, verify facts against `CHECKLIST.md` — cross-platform factual
  consistency is the whole point (GEO).
- Each platform's `templates/playbooks/` (in the engine repo) documents the
  copy-paste steps and post-deploy verification for `manual` platforms.

---

## 8. Keep it updated

### 8.1 Update your data (the routine you will actually run)

Any life event — new role, new paper, new project, changed positioning — is the
same loop:

```sh
cd ~/profile-data
$EDITOR content/<file>.yaml
pac validate                       # fix schema; read drift warnings
pac build                          # regenerate outputs
$EDITOR CHANGELOG.md               # what changed → which platforms to re-paste
git add -A && git commit -m "feat: <what>"
git push
# deploy (paste / PR per §7) → check the box in CHECKLIST.md
git tag release-YYYY-MM && git push --tags   # baseline for the next pac diff
```

`pac diff` between releases is your **re-paste list**: it names the changed
facts so you know which platforms need attention and which bios became stale.

### 8.2 Update the engine

```sh
cd /path/to/profile-as-code
git pull
pnpm install
pnpm --filter @profile-as-code/cli build   # rebuild core + cli
```

Then re-run against your workspace:

```sh
pac validate && pac build
```

- Schema releases are **additive** (semver minor) — an existing workspace keeps
  validating; new fields are opt-in. See `schema/README.md` in the engine for
  what changed and the engine's `CHANGELOG.md`/README for milestone notes.
- If `pac build` output changes (byte-diff in `profiles/`), commit the
  regenerated files — `profiles/` are pure functions of your content, so any
  byte change is either your data or an engine release doing its job.
- If a *new* renderer/platform lands, nothing to migrate: `pac build` picks it
  up; add data only when you want that surface.

### 8.3 Multiple identities (person + brand, multi-workspace)

One workspace per identity, same engine (D14/D15):

- Naming family: the `profile-data` prefix wins — `profile-data` (you),
  `profile-data-topia` (a brand), never `topia-data`.
- Each identity lives in its own repo; scaffold a brand with
  `pac init --flavor brand`.
- Switch workspaces with `pac --workspace <path> <cmd>`, or keep one `.pacrc`
  per working directory (its `workspace` field points where you want).

---

## 9. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `pac: command not found` | Symlink/alias missing — redo §2 Option A/B, check `$PATH`. |
| Exit `2` on a command | Usage error: unknown command/platform/lang. Run `pac <cmd> --help`. |
| Exit `1` on `validate` | Schema violation — read the message (file + value). Most common: a langMap where a plain string is required (proper nouns!), a missing `en`, or a bad date format. |
| Exit `1` on `diff` | Not a git repo (or no git history) — `pac diff` needs your workspace to be a git repository. |
| Drift warnings but exit `0` | Expected (D12): facts warn, schema fails. Fix contradictions — they are citability leaks, not blockers. |
| `profiles/<platform>/` missing after `build` | That platform has no renderer yet (M4+) — its slice prints to the terminal instead. `github-org` requires flavor `brand`. |
| `refusing to scaffold` on `pac init` | A workspace already exists in the target dir — `init` never overwrites. |
| Workspace not found | Resolution is `--workspace` → `.pacrc` → cwd. Run from the workspace root or pass `--workspace`. |

---

## 10. Where everything lives

| Surface | Location | Role |
|---|---|---|
| Schema (the contract) | this repo, `schema/profile.schema.json` + `schema/README.md` | what data must look like |
| Core engine | this repo, `packages/core` | load · drift · geo · compile |
| CLI | this repo, `packages/cli` (`pac`) | everything above, as commands |
| Renderers | this repo, `packages/renderers` | deterministic per-platform artifacts |
| Platform skills (SOTA knowledge) | this repo, `skills/<platform>/` | applied by your agent during `pac refine` (M3) |
| Deploy playbooks | this repo, `templates/playbooks/` | copy-paste + verification steps |
| Your facts | `profile-data` (private), `content/*.yaml` | the SSOT — the only thing you edit |
| Generated outputs | your workspace, `profiles/` | committed deploy artifacts — never hand-edited |
| Chosen variants | your workspace, `content/active.yaml` | what is live per platform/lang |
| Re-paste ledger | your workspace, `CHANGELOG.md` + `CHECKLIST.md` | what changed and what was verified |

---

## Command cheat sheet

```sh
pac init [dir] [--flavor person|brand]   # scaffold a workspace (never overwrites)
pac validate [--json]                    # schema FAIL + drift/geo WARN (D12)
pac build [platform] [--lang] [--json]   # base texts; renderers write profiles/
pac diff [--json]                        # changes since last release-* tag
pac refine <platform> [--lang] [--variants N]   # emit agent task (stub → M3)
pac refine <platform> --choose <id>      # record chosen variant in content/active.yaml
pac check [platform]                     # declarative checks catalog (stub → M4)
pac skills:install <agent>               # project platform skills to your agent (stub)
pac --workspace <path> <cmd>             # target a workspace explicitly
pac --json <cmd>                         # machine-readable output
```

Exit codes: `0` ok (drift warnings still 0) · `1` schema/workspace failure · `2` usage error.