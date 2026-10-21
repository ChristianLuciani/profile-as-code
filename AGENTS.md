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
| `platforms/registry.yaml` | Platform METADATA — one home (#154) | family · deploy · hosts · status · sources; generates the derived surfaces |
| `packages/core/` | Engine: load · drift · geo · compile | vitest; fixtures in `packages/core/tests/fixtures/` |
| `packages/cli/` | `pasco` CLI | consumes core; never re-implements it |
| `packages/markdown/` | CommonMark escaping (`mdHref` destinations · `mdText` labels) | shared by every markdown renderer — never re-implement in an adapter |
| `packages/paste/` | Shared paste-renderer core (`pasteSource`) + conformance body | one home for the paste invariant — every paste adapter delegates, never re-implements (#150/#157) |
| `packages/artifact/` | Shared §19.5 artifact projection (`createArtifactExtractor`) + conformance body | one home for the bound + transport normalization — every verifying adapter delegates, never re-implements (#216) |
| `packages/github/` | Shared GitHub owner resolution (`createGithubOwnerResolver`) + conformance body | one home for the owner rule — every GitHub adapter delegates, never re-implements (#224) |
| `packages/renderers/` | One adapter per platform | the contribution seam |
| `skills/<platform>/` | Living knowledge per platform (D5) | follows `skills/README.md` |
| `docs/research/` | Prior-art + SOTA, sourced + dated | |
| `site/` | Static project page (#201) → GitHub Pages | no build step; keep the on-ramps synced with SPEC §9.2 |
| `scripts/schema-check/` | Contract self-test (CI) | |
| `scripts/site-check/` | Project-page gate (CI): ids, anchors, local paths, no scripts | issue #201 |
| `scripts/dep-gate/` | D20 scope self-test (CI): server→core only, core never reaches server | issue #98 |

## Rules for agents (in addition to CONTRIBUTING.md)

1. **SPEC first.** Read the relevant SPEC section before touching code. Schema/core
   changes: open an issue first and get the direction blessed — the contract is
   deliberately designed (§7).
2. **Zod is generated (D3).** Change `schema/profile.schema.json`, run `pnpm gen:zod`,
   commit both. Never edit `packages/core/src/generated/schema.zod.ts` by hand.
   The renderer map is generated the same way (#165): change a renderer's `pasco`
   block, run `pnpm gen:renderers`, commit both — never hand-edit
   `packages/cli/src/generated/renderers.gen.ts`. **Platform metadata** (#154): add
   or edit an entry in `platforms/registry.yaml`, then run `pnpm gen:platforms` —
   it projects the core host maps + slug list, the SPEC §6 family table/counts and
   the README status counts; never hand-edit those projections. The schema enum
   stays hand-authored (the reviewed contract).
3. **Evidence rule.** Quantitative claims need source + date
   (`[OFICIAL]`/`[EXPERTO]`/`[BENCHMARK]`/`[?]`). Use epistemic notation
   `[MI]`/`[WEB]`/`[INF]`/`[?]` for inference vs. source.
4. **Docs in English (D8).** Code comments too.
5. **Tests with behavior.** New core behavior → vitest, fixtures committed.
6. **Never push to main.** Branch + PR; the human merges. Agent-harness branch
   names (`aionui/pi/…`) are the author's convention, not a project one.
7. **Scope.** The engine stays an engine: platform-specific behavior lives in
   skills/renderers, not core. (Cited by rule number from beyond this file —
   `docs/SPEC.md` §15, every shared package README — so it stays 7.)
8. **Runtime figures are cited, never typed (#226).** The companion to rule 2, for
   the figures whose source is the **runtime** instead of a committed file. A number
   derived from the runtime (test counts, corpus size) moves with every commit, so it
   cannot be asserted as current state — it is a **reading of one run**: quote it as
   `command` at `<sha>` (`<date>`) → reading, or read it from its generated block.
   The documentation link census lives in the `<!-- gen:doc-links -->` block of
   `docs/ci-cd.md` (`pnpm gen:doc-links`; `node scripts/link-check/check.mjs --check`
   asserts it in CI) — cite that block instead of re-typing the number. The package
   inventory in the Map above is derived from the `pnpm-workspace.yaml` globs, and
   `pnpm gen:packages` (`node scripts/gen-packages/gen.mjs --check` in CI) fails
   when the Map omits a workspace package or lists one that does not exist — add the
   row, never let the inventory drift. A **dated citation of a past run is correct
   forever**: leave historical records alone. A run-citation a status row rests on
   carries its anchor inline — `<!-- evidence: <type> as_of=<sha> kind=record|current -->`
   — and `node scripts/evidence-gate/check.mjs` (CI, needs full history) makes its
   staleness computable: `stale` only WARNS (re-measure, or mark it `kind=record`
   if it is history), `unreachable` FAILS (a rebased-away sha is a claim without a
   source).
9. **A published surface may only reference what its reader can open (#254).**
   `--help`, command output, the package README/description and error messages are
   read by a stranger: they may not name a path, repo or tool that stranger cannot
   open. The CLI may only read artifacts it ships — `packages/cli/skills/` is a
   **generated** copy of `<repo>/skills/` (produced by `scripts/bundle-skills.mjs`
   on `build`/`prepack`, listed in the package's `files`); never edit the copy or
   resolve a skill from an engine checkout as the primary path. Dated records
   (CHANGELOG history, sourced research, issue/PR bodies) are exempt — rule 8.

## Commands

```bash
pnpm install && pnpm test && pnpm build && pnpm typecheck && pnpm lint
pnpm gen:zod                      # after schema changes
pnpm gen:renderers                # after changing a renderer's pasco block
pnpm gen:platforms                # after editing platforms/registry.yaml
pnpm gen:doc-links                # after the doc corpus changes (link census block)
pnpm gen:packages                 # list/verify the workspace package inventory
node scripts/gen-platforms/gen.mjs --check   # assert the projections are fresh
node scripts/gen-packages/gen.mjs --check    # assert the Map covers every package
node scripts/evidence-gate/check.mjs         # assert run-citations are anchored reachably
node scripts/site-check/check.mjs            # assert the project page's ids/anchors/local paths
python3 -m venv /tmp/schema-venv && /tmp/schema-venv/bin/pip install jsonschema pyyaml
/tmp/schema-venv/bin/python scripts/schema-check/check.py
```

## Context discipline

This repo exceeds ~1/3 of a typical agent context window. Don't read it whole:
start from SPEC (the map), then read only `packages/<pkg>/src` for the module you
touch. Targeted reads beat full scans.
