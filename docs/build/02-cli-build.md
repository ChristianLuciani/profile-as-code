# Build session — M1 CLI (`packages/cli`, binary `pasco`)

> **Historical record (2026-09 build prompt).** The `skills:install` stub described
> below was replaced by `skills:export <dir> [--list]` in #254, and the platform skills
> it pointed at now ship inside the package (#253). Read the commands below as history,
> not as a current instruction.

> Paste this prompt into a NEW agent session (one deliverable per session). Docs convention: EN (D8).
> Session rules: NEVER touch main/master. Own worktree + branch per your session/harness convention
> (harness artifact, NOT a project convention — the project only requires: never main, descriptive
> branch, maintainer merges).

## Context

Repo: `/Users/eva/PROJECTOS/GitHub/ChristianLuciani/profile-as-code` — worktrees live in `../.worktrees/`.

- **SPEC**: `docs/SPEC.md` — §7 core interfaces + the `pasco` command table is the CONTRACT for this session.
- **Core**: `packages/core` (`load`/`driftCheck`/`geoCheck`/`compile`) — DONE, 37 tests, CI green.
- **Schema**: `schema/profile.schema.json` (contract source, D3; Zod generated in core — consume it, don't duplicate).
- **Decisions shaping the CLI**: D10/D11/D13 — `refine` is **model-agnostic + agent-driven**, the CLI does NOT call an LLM; D12 — **fail on schema, warn on drift**; D9 — no-API platforms deploy via checklist/playbook.

M1 status: spec ✅ · schema ✅ · core ✅ → **the CLI `pasco` is the last M1 piece.**

In parallel, other sessions run the SOTA research (M3) and prompt-studio projections. This session does NOT depend on them: `refine`, `check` and `skills:install` are **explicit stubs**.

## Task

1. **Bootstrap `packages/cli`** (pnpm workspace, package `@profile-as-code/cli`, binary `pasco`). Root workspaces already configured.
2. **Command surface v1** (SPEC §7 table):
   - `pasco init` — scaffold a profile-data workspace skeleton (layout per SPEC §9: `content/` yaml files, `README.md`, `.pascorc`; minimal but `pasco validate`-clean)
   - `pasco validate [--json]` — load + **schema (FAIL, exit 1)** + **drift (WARN, exit 0)** + geo report (D12)
   - `pasco build [platform] [--lang] [--json]` — `compile()` slices → deterministic base texts per platform+lang
   - `pasco diff` — what changed since the last release marker (git-based → CHANGELOG hint)
   - `pasco refine [platform] [--lang] [--variants N]` — **STUB**: agent-driven (D11/D13); emit the task template + record the chosen variant in `active`; NO LLM call, no hub
   - `pasco check [platform]` — **STUB**: run user `checks` from content (schema-validated catalog); skill `checks.yaml` wired later (M3)
   - `pasco skills:install <agent>` — **STUB**: print the skills-studio projection command; do NOT implement
3. **CLI discipline**: exit codes (0 ok · 1 schema fail · 2 usage), human output EN by default + `--json` machine-readable, `--help` on every command.
4. **Tests** (vitest, CLI-level — execute the built binary against fixtures, reuse `packages/core/tests/fixtures/`): validate fail vs warn, build slices, diff, init scaffold.

## Definition of Done

- `pnpm --filter @profile-as-code/cli test` green (real assertions on the binary, not smoke)
- Root `pnpm test` and `pnpm -r build` green (strict TS)
- `pasco validate` exits 1 on schema violation; exits 0 + prints warnings on drift (D12)
- `pasco init` output is accepted by `pasco validate`
- Stubs are explicit: clear "not implemented" output + pointer to the session that owns them
- CI `ci` green on the PR
- `packages/cli/README.md` (usage, exit codes, stub status)
- PR to `main` — **the maintainer merges; never merge yourself**

## Rules

- NEVER touch main/master; own worktree + branch; the maintainer merges.
- TDD: red → green → refactor; every behavior lands with its test.
- Consume `@profile-as-code/core` — never re-implement load/drift/geo/compile.
- Minimal dependencies (commander or `node:parseArgs`; ask before adding more).
- Do NOT implement AI refinement (D10/D11/D13), do NOT wire the hub, do NOT build skills:install.
- Do not edit `docs/SPEC.md` except factual errors; open questions → note them in the PR body.
- Ambiguous command semantics → pick the least-surprising reading and document it in the PR.
