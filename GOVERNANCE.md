# Governance

Lightweight governance for an early-stage, spec-driven open source project.

## Current model (v0.1 — single maintainer)

- **Maintainer:** Christian Luciani (sole maintainer until co-maintainers earn trust).
- **Decision record:** all architectural decisions are recorded as ADR-lite entries in
  [`docs/SPEC.md`](docs/SPEC.md) — currently D1–D18. New decisions follow the same pattern:
  rationale first, trade-off explicit, numbered.
- **Spec-driven:** non-trivial changes require a spec/design discussion first (issue → spec →
  implementation). The contract (`schema/`) and core interfaces (SPEC §7) are deliberately
  designed; they change additively, never by breaking the contract silently.

## Contribution acceptance

1. PRs must pass the `ci` check (schema self-test + workspace tests + build).
2. Schema/contract changes: additive only (v1 contract — `additionalProperties: false` is the
   guardrail); breaking changes bump the schema directory (`schema/v2/…`) after discussion.
3. Skills PRs must satisfy the evidence rule (`skills/README.md`): dated sources, GEO section,
   machine-readable checks.
4. Every quantitative claim in docs/skills carries a source + verification date
   (claims-evidence policy). Unbacked numbers are rejected.

## Roadmap ownership

Priorities come from [`docs/SPEC.md` §12](docs/SPEC.md#12-roadmap) (M1–M5). Community input
(via [Discussions](https://github.com/ChristianLuciani/profile-as-code/discussions) and issues)
shapes what lands inside each milestone, not the milestone order.

## Path to co-maintainership

Active, reliable contributors who demonstrate judgment aligned with the spec can be invited as
collaborators. When the first co-maintainer joins, the protection rule tightens to
`required_approving_review_count: 1` + CODEOWNERS (see `docs/ci-cd.md`).

## Conflict resolution

Disagreements are resolved by discussion first, then by the maintainer's decision, documented
in the issue or an ADR. Scope creep and "engagement hacking" are rejected by design (see the
"no empty engagement" rule in `skills/README.md`).
