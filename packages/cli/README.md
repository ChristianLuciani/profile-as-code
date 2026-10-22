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

> **Published** [OFICIAL] [WEB: registry.npmjs.org, checked 2026-10-12]:
> `@profile-as-code/cli` is public on npm — the registry is the source of truth
> (`npm view @profile-as-code/cli version`). The current release is `0.3.0`
> (published 2026-10-11T03:43:27Z, dist-tag `latest`; tag `v0.3.0` → `21e4cde`)
> and the bin was verified running (`node packages/cli/dist/index.js --version`
> → `pasco 0.3.0` on `main`, 2026-10-12) — a **local-build** check, not a run of the
> published tarball. No published version carries a
> provenance attestation while the source repo is private — documented, not pending.
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
| `pasco diff [--json]` | Changes since the last `release-*` tag (git-based → CHANGELOG hint) | ✅ |
| `pasco status [platform] [--mark <ledgerKey> <surface>] [--verify] [--write-checklist] [--completeness]` | Per-entry deploy report — origin · surfaces · in-sync/stale/never · **certification** (verified/attested/unverifiable/out-of-band-drift, §19.5) + the derived **publication truth** per surface (§20.1, #242) + ledger write paths (D18, §19) | ✅ |
| `pasco refine <platform> [--lang] [--variants N] [--choose <id>]` | Agent-driven variant flow (D10/D11/D13); the chosen body is `profiles/<platform>/variants/<id>.md` (a complete platform artifact), rendered by `pasco build` (#238) | 🚧 template + `--choose` (full flow M3) |
| `pasco check [platform]` | User checks from `content/checks.yaml` (schema-validated catalog) + registry rules (M7/§18.8) + media-transport rules (M8/§18.6) + offline `max-chars`/`min-chars` over headlines/bios (#240) | 🚧 offline rules today (limits + registry + media; remaining catalog M3/M4) |
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
  the media-transport rules (M8/§18.6), and the `max-chars` / `min-chars` rows
  declared in `content/checks.yaml` over the headline/bio rows that exist
  (offline, warn-class, #240). The remaining per-platform rules in the catalog
  ship with the skills `checks.yaml` union (M3) and the full `pasco check` (M4).
  It prints its `owner` line (`src/commands/check.ts`).
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
pasco post seed demo --text seed.md           # week-1 experiment: posts/<seed>/seed.md
pasco post task demo --channel linkedin,x   # task bundles (no LLM call)
pasco post choose demo --channel linkedin --variant linkedin-1
pasco post check demo                        # limits + URLs + {{fact:...}} refs
pasco post export demo --target postiz       # POST /posts draft payload
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
| `1` | Schema failure or operational failure (workspace not found, bad YAML, not a git repo for `diff`). |
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
