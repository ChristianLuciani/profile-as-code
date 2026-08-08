# `@profile-as-code/cli` — `pac`

The profile-as-code CLI (M1). Consumes `@profile-as-code/core` (`load`/`driftCheck`/
`geoCheck`/`compile`) — it never re-implements them. The contract source is
`schema/profile.schema.json` (D3); Zod is generated in core.

## Commands

| Command | Purpose | Status |
|---|---|---|
| `pac init [dir]` | Scaffold a user-brand-data workspace (`content/identity.yaml`, `README.md`, `.pacrc`) — `pac validate`-clean | ✅ |
| `pac validate [--json]` | Schema **fail** (exit 1) + drift/geo **warn** (exit 0) — D12 | ✅ |
| `pac build [platform] [--lang]` | Deterministic base texts per platform+lang (compile slices) | ✅ |
| `pac diff [--json]` | Changes since the last `release-*` tag (git-based → CHANGELOG hint) | ✅ |
| `pac refine <platform> [--lang] [--variants N] [--choose <id>]` | Agent-driven variant flow (D10/D11/D13) | 🚧 stub |
| `pac check [platform]` | User checks from `content/checks.yaml` (schema-validated catalog) | 🚧 stub |
| `pac skills:install <agent>` | Skills-studio projection command (AGOS) | 🚧 stub |

Stubs are explicit: they print a clear "not implemented" message plus the session
that owns them (SPEC §12 M3/M4) — see `src/commands/refine.ts`, `check.ts`,
`skills-install.ts`.

## Usage

```sh
pac --help                 # full help
pac validate               # workspace from .pacrc (or cwd)
pac validate --workspace ~/user-brand-data --json
pac build github-readme --lang en
pac diff
pac refine linkedin --variants 3            # emits the agent task template (stub)
pac refine linkedin --choose li-en-2        # records the chosen variant in content/active.yaml
pac check github-readme
pac skills:install pi
```

## Workspace resolution (D14)

`--workspace <path>` > `.pacrc` (`workspace` field, relative to the `.pacrc`
file) > current directory.

`.pacrc` (JSON, at the workspace root):

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
