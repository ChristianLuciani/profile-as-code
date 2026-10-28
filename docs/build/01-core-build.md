# Build session — M1 core (`packages/core`)

> Paste this prompt into a NEW agent session (one deliverable per session). Docs convention: EN (D8).
> Session rules: NEVER touch main/master. Create YOUR OWN worktree + branch per your session/harness
> convention (this is a harness artifact, not a project convention — the project only requires
> "never push to main, descriptive branch, maintainer merges").

## Context

Repo: `/Users/eva/PROJECTOS/GitHub/ChristianLuciani/profile-as-code` — worktrees live in `../.worktrees/`.

- **SPEC**: `docs/SPEC.md` (decisions in §5 — the register; §6 data model; §7 core interfaces; §8 GEO layer)
- **Contract**: `schema/profile.schema.json` — JSON Schema 2020-12, the single contract source (D3)
- **Contract doc**: `schema/README.md` (content file → property mapping, validation semantics)

Milestone M1 status: spec ✅ · profile-data template ✅ · schema v1 ✅ → **core + repo bootstrap** is next.

In parallel, the SOTA research per platform (GitHub → LinkedIn → Upwork → X → ResearchGate → Substack) runs in
another AionUi session. The core does NOT depend on it: interfaces are platform-agnostic (the 6-platform enum is
already defined in the schema).

## Task

1. **Repo bootstrap** (pnpm workspaces — `.gitignore` already covers `.pnpm-store/`):
   - root `package.json` (workspaces: `packages/*`), strict base `tsconfig`, vitest as test runner
   - `packages/core`: TypeScript ESM library with clean exports (`index.ts`)
2. **Zod generated from the schema (D3 — do NOT hand-write Zod)**: a versioned script
   `scripts/gen-zod.ts` that reads `schema/profile.schema.json` and emits `src/generated/schema.zod.ts`
   (use `json-schema-to-zod` or equivalent). The generated file is committed.
3. **`packages/core/src`**:
   - `types.ts` — exported types (`Profile` via `z.infer`, plus `Issue`, `GeoReport`, `PlatformProfile`)
   - `load.ts` — `load(workspace)`: parse `content/*.yaml`, merge into one Profile, validate against
     generated Zod (**fail on schema**, D12), normalize → `Profile`
   - `drift.ts` — `driftCheck(profile): Issue[]`: factual contradictions (same date/role/paper written
     differently across surfaces), URLs not present in `identity.links`, `start > end`, malformed
     DOI/ORCID. **WARN semantics (D12)** — returns issues, never throws.
   - `geo.ts` — `geoCheck(profile): GeoReport`: cross-platform fact-consistency score, structured-data
     readiness (schema.org `Person`/`sameAs` fields for the web renderer), semantic-association
     coverage (the 3–5 anchors of `positioning.geo.semanticAssociations`)
   - `compile.ts` — `compile(profile, platform, lang): PlatformProfile`: language-aware slice for a
     renderer (bios/headlines filtered by platform+lang, facts passed through untouched)
4. **Tests** (vitest) with fixtures in `tests/fixtures/`: a minimal valid profile + a drifting profile.
   Cover: schema fail, drift warn, geo report, compile slices.

## Definition of Done

- `pnpm install && pnpm test` green in `packages/core` (real assertions, not smoke)
- `pnpm build` compiles with strict TS, no errors
- The fixture profile from `schema/README.md` validates end-to-end through `load()`
- Zod is script-generated, the generator is versioned; types match the contract
  (`langMap.en` required, platform enum, `active` entry shape)
- Short `packages/core/README.md` (what it does, how to test)
- Commit + open a PR to `main` on a descriptive feature branch (never main)

## Rules

- NEVER touch main/master; own worktree (`../.worktrees/<name>`) + a branch per your
  session/harness convention (harness artifact — not a project convention)
- Minimal dependencies: Zod, `yaml`, vitest (+ `json-schema-to-zod` for the generator). Ask before adding more.
- This session delivers CORE ONLY — no renderers, no CLI, no skills (`pasco` is the next session).
- Do not edit `docs/SPEC.md` except for factual errors; open questions → note them in the PR.
- If a schema rule is ambiguous (e.g. date precision, checks catalog), pick the least-surprising reading
  and document it in the PR body.
