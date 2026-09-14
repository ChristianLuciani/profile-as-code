# `@profile-as-code/cli` — `pasco`

The profile-as-code CLI (M1). Consumes `@profile-as-code/core` (`load`/`driftCheck`/
`geoCheck`/`compile`) — it never re-implements them. The contract source is
`schema/profile.schema.json` (D3); Zod is generated in core.

## Commands

| Command | Purpose | Status |
|---|---|---|
| `pasco init [dir]` | Scaffold a profile-data workspace (`content/identity.yaml`, `README.md`, `.pascorc`) — `pasco validate`-clean | ✅ |
| `pasco validate [--json]` | Schema **fail** (exit 1) + drift/geo **warn** (exit 0) — D12 | ✅ |
| `pasco build [platform] [--lang]` | Deterministic base texts per platform+lang; platforms with a renderer (github-readme, M2) also write `profiles/<platform>/README.md` + bundled media in `profiles/<platform>/assets/` with `assets/manifest.json` (M8/§18.6 — public path-locator artifacts, sha256 at compile; see `docs/media-pipeline.md`) | ✅ |
| `pasco diff [--json]` | Changes since the last `release-*` tag (git-based → CHANGELOG hint) | ✅ |
| `pasco status [platform] [--mark <ledgerKey> <surface>] [--write-checklist]` | Per-entry deploy report — origin · surfaces · in-sync/stale/never + ledger write path (D18, §19) | ✅ |
| `pasco refine <platform> [--lang] [--variants N] [--choose <id>]` | Agent-driven variant flow (D10/D11/D13) | 🚧 stub |
| `pasco check [platform]` | User checks from `content/checks.yaml` (schema-validated catalog) + registry rules (M7/§18.8) + media-transport rules (M8/§18.6) | 🚧 remaining catalog stub (M3/M4) |
| `pasco skills:install <agent>` | Skills-studio projection command (AGOS) | 🚧 stub |

Stubs are explicit: they print a clear "not implemented" message plus the session
that owns them (SPEC §12 M3/M4) — see `src/commands/refine.ts`, `check.ts`,
`skills-install.ts`.

## Usage

```sh
pasco --help                 # full help
pasco validate               # workspace from .pascorc (or cwd)
pasco validate --workspace ~/profile-data --json
pasco build github-readme --lang en
pasco diff
pasco status                          # what's published where — per entry
pasco status linkedin                 # filter one surface
pasco status --mark identity linkedin # confirm a paste (records the current contentHash)
pasco status --write-checklist        # regenerate CHECKLIST.md from the ledger
pasco refine linkedin --variants 3            # emits the agent task template (stub)
pasco refine linkedin --choose li-en-2        # records the chosen variant in content/active.yaml
pasco check github-readme
pasco skills:install pi
```

## Workspace resolution (D14)

`--workspace <path>` > `.pascorc` (`workspace` field, relative to the `.pascorc`
file) > current directory.

`.pascorc` (JSON, at the workspace root):

```json
{
  "workspace": ".",
  "defaults": { "lang": "en", "variants": 3 },
  "diff": { "tagPattern": "release-*" }
}
```

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
