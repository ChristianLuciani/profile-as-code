# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tagged `vX.Y.Z`; until v1.0.0 the API is in active design (see SPEC §7) and
minor versions may contain breaking contract changes.

## [Unreleased]

### Added

- **Schema contract v1** — `schema/profile.schema.json` (JSON Schema 2020-12, D3): the single
  contract for a `user-brand-data` workspace. i18n `langMap` with EN required, GEO anchors,
  evidence claims, declarative checks, active variant selection.
- **Core engine (M1)** — `packages/core`: `load()` (YAML → validate → normalize), `driftCheck()`
  (factual contradictions, warn semantics D12), `geoCheck()` (consistency score + structured-data
  readiness), `compile()` (language-aware platform slices). Zod generated from the schema.
- **CI/CD** — required `ci` check on `main` (schema self-test + pnpm test/build), Dependabot
  (npm + actions), branch protection with auto-delete of merged branches.
- **Community scaffolding** — CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, SECURITY, PR/issue
  templates, GitHub Discussions.
- **Prior-art research** — `docs/research/01-prior-art.md`, SOTA research prompts + runner.

### Changed

- Spec consolidated (D1–D14 resolved): Substack as platform, user-brand-data as separate repo,
  model-agnostic `pac refine`.

### Planned (roadmap)

- Renderers: `github-readme` (dogfood), linkedin, upwork, x, researchgate, substack (M2/M4)
- CLI `pac`: build · validate · diff · check · refine · skills:install (M1/M3)
- Per-platform skills v1 from SOTA research (M3)
- `user-brand-data` template repo + web renderer (M5)
