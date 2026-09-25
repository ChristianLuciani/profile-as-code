# Repository standards & public-readiness policy

> Items 4 and 10 refreshed **2026-09-21** (quickstart verification, #54); the other rows stand per
> their cited dates. Every status cites its evidence — a claim without source + date does not
> belong here (evidence rule).

## Private by default

This repository starts and stays **private** until it passes the Public-Readiness Checklists below,
with the maintainer's explicit sign-off. Policy ratified in the operator's global contract
(`repo-governance` §5, prompt-studio). The visibility flip and PR merges are **human-only** actions;
agents prepare, verify and leave everything ready, but never publish or merge on their own.

Rationale: a public repo is a commitment — anyone can fork, file issues and judge it. It must not
expose unfinished, unverified or untested work. This product must prove itself on **real user data**
before it is presented publicly — the first real end-to-end test is a hard requirement, not an option.

## Public-readiness checklist (repo gate)

| # | Item | Status | Evidence (date) |
|---|---|---|---|
| — | Visibility | 🔒 **private** | per policy |
| 1 | First real test (dogfood: real data rendered + deployed) | ⚠️ | renderers `github-readme` + `github-org` built and tested (`packages/renderers/`, 50 tests, CI green); real workspace: `profile-data` (private repo). Deploy evidence is **not externally auditable** (private workspace) — entry gate: re-run dogfood on current HEAD and record a deploy artifact before flip (issue #45) |
| 2 | CI green + meaningful | ✅ | `ci` check SUCCESS on the #79 PR head (2026-09-15) + suites verified: **250 tests**, 15 files (`pnpm test` → `build` + `pnpm -r test`, 2026-09-15) |
| 3 | Tagged release + changelog | ❌ **blocker** | no tag yet; `release.yml` publishes to npm **and** creates the matching GitHub Release from `CHANGELOG.md` with `packages/cli/scripts/release-notes.mjs` (#58, 2026-09-18) — the remaining blocker is the operator-gated tag/publish (#44) |
| 4 | Docs honest + quickstart verified | ✅ | 4 README/CONTRIBUTING/CHANGELOG drifts in #55 (closed). USER-GUIDE §1–§6 and §8–§9 executed from a fresh clone on 2026-09-21 by a non-author agent session (#54); §7 verified up to the deploy artifact (`profiles/github-readme/README.md`) + ledger (`status --mark`/`--write-checklist`) — the platform paste and the profile-repo PR + human merge were **not** executed (human boundary, by design). 7 doc bugs found and fixed in the same PR, corrected snippets re-validated against the schema; full log in the #54 comment. Caveat: both gate points need maintainer credentials — §2 clones the still-private engine, and §3 Option A clones the private template; a third party without access fails at the first step (item 10) |
| 5 | No placeholders in critical paths | ✅ | no TODO/FIXME in `packages/*/src` (grep 2026-09-11); renderers + CLI built (8 commands: build, check, diff, init, refine, skills-install, status, validate); limitations tracked as issues |
| 6 | Security baseline | ✅ | `SECURITY.md` present; full-history secret scan **clean** — gitleaks 8.30.1, 133/133 commits of `git rev-list --all` (incl. merge diffs via `--diff-merges=first-parent`, remote-only dependabot ref via stdin scan) + working tree, **0 findings** (2026-09-14, #56); Dependabot esbuild security alert resolved — merged #65 (f630cab, 2026-09-14), alert #1 auto-resolved `fixed` |
| 7 | Governance in place | ✅ | LICENSE (MIT), CODE_OF_CONDUCT, CONTRIBUTING, GOVERNANCE — D-refs swept to **D1–D18** across all prose surfaces (CONTRIBUTING, GOVERNANCE, AGENTS.md ×2, PR template, build doc, USER-GUIDE, README ×2); the CHANGELOG's dated release note stays as history |
| 8 | Maintainer sign-off | ❌ | operator-only decision; requires items 1 and 3 done (4 and 6 are resolved) |

**To go public:** resolve item 3 (tag v0.2.0 + npm publish — the version prep landed 2026-09-24; as of
that date there is still no git tag on `origin` and `@profile-as-code/cli` is unpublished), re-verify
dogfood on HEAD (item 1), flip visibility with the maintainer's sign-off, **then immediately
re-apply branch protection** (`docs/ci-cd.md` has the exact calls — protection exists only once
the repo is public on GitHub Free; items 6/10 may carry tracked issues only if they don't
contradict the flip).

## Community-first checklist (operator contract v1.1.0)

The repo-gate checklist answers "is the product ready"; this one answers "is the repo ready for a
community" (source: prompt-studio `registry/specs/community-first.md`).

| # | Item | Status | Evidence (date) |
|---|---|---|---|
| 1 | README.md at root (landing, state, how to run) | ✅ | landing + Estado + Roadmap tables; drift fixes in #55 |
| 2 | LICENSE as file (not only metadata) | ✅ | MIT, 2026-08-07 |
| 3 | CONTRIBUTING: direction + hygiene + **escalation/latency** | ⚠️ | direction + hygiene present; **no escalation/latency section** (community-first §7) — gap, add before accepting external contributors |
| 4 | CODE_OF_CONDUCT.md | ✅ | Contributor Covenant, 2026-08-08 |
| 5 | CI green (tests, lint, typecheck, docs/links gates) | ⚠️ | tests green (268, vitest); lint/format gate configured (Biome 2.5.14: `pnpm lint` + `ci.yml` step, `biome.json`) — #59 (2026-09-17); typecheck gate added to CI (`pnpm build && pnpm typecheck` step) — #108/#109 (2026-09-25); docs/links gate still open |
| 6 | docs/STANDARDS.md (this file) | ✅ | this PR |
| 7 | Priorities visible (ROADMAP or pinned issue) | ⚠️ | README Roadmap table (M1–M5) serves; **no pinned issue** — pin #44 at flip |
| 8 | AGENTS.md (repo >1/3 agent context window) | ✅ | present, with map + context-discipline rule |
| 9 | Issue triage with intention (≤48h close-or-label) | ✅ | all 10 open issues labeled (6 of 10 with a priority label, 2026-09-10); `good first issue` + `help wanted` labels exist |
| 10 | Family mapped + cross-links + "try it" path e2e | ⚠️ | family: `profile-as-code` (hub) + `profile-data-template` (satellite, private) + `profile-data` (operator data, private — dogfood only, never linked publicly); template also lives in-repo (`templates/profile-data*`). Cross-links verified + USER-GUIDE "try it" path executed end-to-end up to the deploy boundary (#54, 2026-09-21; scoping in item 4). Remaining: with the satellite private, a newcomer without access cannot create a workspace (community-first §9) — publish the satellite with the hub, or repurpose the quickstart links |

## Publication by families (community-first §9)

The publication unit is the **family**, not the single repo:

- **Hub:** `profile-as-code` — the engine. The in-repo `templates/` dirs are **pointers only**
  (their READMEs link the satellite); the documented quickstart (`docs/USER-GUIDE.md`) creates a
  workspace with `--template https://github.com/ChristianLuciani/profile-data-template`.
- **Satellite:** `profile-data-template` (private) — **required for the "try it" path**: with the
  satellite private, a newcomer cannot create a workspace. Either publish it together with the
  hub, or disable/repurpose the quickstart links while it stays private.
- **Operator data:** `profile-data` (private) — stays private permanently: dogfood evidence only.
  Never expose its URL in public artifacts; name-only references as dogfood context are allowed
  (community-first §9).

Before flipping the first repo, apply both checklists to the whole family and verify every
cross-link resolves to a public target.

## Free-plan constraints (GitHub Free)

Branch protection and rulesets are **not available on private repositories** with GitHub Free
(the API returns 403 — they require GitHub Pro or a public repo). Verified empirically.

Workarounds while private:

- **Protection by access + process:** the repo is private (access is limited to the maintainer and
  their agents) and every change goes through a PR that **only the maintainer merges**.
- **The moment the repo goes public**, re-apply branch protection — `docs/ci-cd.md` has the exact
  API calls. Re-applying protection is part of the public-ready step, not a precondition for it.
- **Dependabot:** alerts and version updates for private repos are limited on Free (version updates
  effectively require public or Pro). While private, treat dependency bumps as a manual weekly review.
- **Actions:** 2,000 minutes/month on private free repos — ample for this CI (~1 min/run).

## Applying this policy to new projects

When creating a new repository: `gh repo create <name> --private --source .` (or private in the
UI). Record both checklist statuses in the new repo's `docs/STANDARDS.md` copy (reference:
prompt-studio's own STANDARDS.md). Do not flip to public until all items are ✅ (or carry tracked,
non-blocking issues) and the maintainer signs off. Refresh this table with dated evidence before
every flip decision — a stale table is not a sign-off basis.
