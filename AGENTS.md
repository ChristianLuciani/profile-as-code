# AGENTS.md — profile-as-code

Instructions for AI agents working in this repository. Humans: see `CONTRIBUTING.md`.

## What this is

Spec-driven engine monorepo (pnpm). `docs/SPEC.md` is the contract — goals,
decisions D1–D18, data model, interfaces, roadmap. No code without SPEC alignment;
behavior changes update the SPEC first, then the code (dev-methodology).

**Multi-tenant model (SPEC §9):** this repo is the engine. User data lives in a
per-user private repo (`profile-data`), scaffolded from the template
(`profile-data-template`). Never put real user data here, and never modify a real
`profile-data` repo from this one.

## Map

| Where | What | Notes |
|---|---|---|
| `docs/SPEC.md` | The contract — read first | D1–D18, §7 interfaces, §12 roadmap |
| `schema/profile.schema.json` | Contract source (D3) | additive + reviewed; never hand-write Zod |
| `packages/core/` | Engine: load · drift · geo · compile | vitest; fixtures in `packages/core/tests/fixtures/` |
| `packages/cli/` | `pasco` CLI | consumes core; never re-implements it |
| `packages/markdown/` | CommonMark escaping (`mdHref` destinations · `mdText` labels) | shared by every markdown renderer — never re-implement in an adapter |
| `packages/paste/` | Shared paste-renderer core (`pasteSource`) + conformance body | one home for the paste invariant — every paste adapter delegates, never re-implements (#150/#157) |
| `packages/renderers/` | One adapter per platform | the contribution seam |
| `skills/<platform>/` | Living knowledge per platform (D5) | follows `skills/README.md` |
| `docs/research/` | Prior-art + SOTA, sourced + dated | |
| `scripts/schema-check/` | Contract self-test (CI) | |
| `scripts/dep-gate/` | D20 scope self-test (CI): server→core only, core never reaches server | issue #98 |

## Rules for agents (in addition to CONTRIBUTING.md)

1. **SPEC first.** Read the relevant SPEC section before touching code. Schema/core
   changes: open an issue first and get the direction blessed — the contract is
   deliberately designed (§7).
2. **Zod is generated (D3).** Change `schema/profile.schema.json`, run `pnpm gen:zod`,
   commit both. Never edit `packages/core/src/generated/schema.zod.ts` by hand.
   The renderer map is generated the same way (#165): change a renderer's `pasco`
   block, run `pnpm gen:renderers`, commit both — never hand-edit
   `packages/cli/src/generated/renderers.gen.ts`.
3. **Evidence rule.** Quantitative claims need source + date
   (`[OFICIAL]`/`[EXPERTO]`/`[BENCHMARK]`/`[?]`). Use epistemic notation
   `[MI]`/`[WEB]`/`[INF]`/`[?]` for inference vs. source.
4. **Docs in English (D8).** Code comments too.
5. **Tests with behavior.** New core behavior → vitest, fixtures committed.
6. **Never push to main.** Branch + PR; the human merges. Agent-harness branch
   names (`aionui/pi/…`) are the author's convention, not a project one.
7. **Scope.** The engine stays an engine: platform-specific behavior lives in
   skills/renderers, not core.

## Commands

```bash
pnpm install && pnpm test && pnpm build && pnpm typecheck && pnpm lint
pnpm gen:zod                      # after schema changes
pnpm gen:renderers                # after changing a renderer's pasco block
python3 -m venv /tmp/schema-venv && /tmp/schema-venv/bin/pip install jsonschema
/tmp/schema-venv/bin/python scripts/schema-check/check.py
```

## Context discipline

This repo exceeds ~1/3 of a typical agent context window. Don't read it whole:
start from SPEC (the map), then read only `packages/<pkg>/src` for the module you
touch. Targeted reads beat full scans.
