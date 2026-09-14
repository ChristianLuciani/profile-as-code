# Repository standards & public-readiness policy

> Status table refreshed **2026-09-11** (audit for issue #45). Every status cites its evidence —
> a claim without source + date does not belong here (evidence rule).

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
| 1 | First real test (dogfood: real data rendered + deployed) | ⚠️ | renderers `github-readme` + `github-org` built and tested (`packages/renderers/`, 12 tests, CI green); real workspace: `profile-data` (private repo). Deploy evidence is **not externally auditable** (private workspace) — entry gate: re-run dogfood on current HEAD and record a deploy artifact before flip (issue #45) |
| 2 | CI green + meaningful | ✅ | `ci` check SUCCESS on PR head (Actions run 34862402503, 2026-09-14) + suites verified: **155 tests**, 12 files (`pnpm test`, 2026-09-11) |
| 3 | Tagged release + changelog | ❌ **blocker** | no tag yet; `release.yml` ready but does not create a GitHub Release/artifacts (#58); publish is operator-gated (#44) |
| 4 | Docs honest + quickstart verified | ⚠️ | 4 README/CONTRIBUTING/CHANGELOG drifts tracked in #55; USER-GUIDE exists (2026-09-09) but third-party quickstart verification pending (#54) |
| 5 | No placeholders in critical paths | ✅ | no TODO/FIXME in `packages/*/src` (grep 2026-09-11); renderers + CLI built (8 commands: build, check, diff, init, refine, skills-install, status, validate); limitations tracked as issues |
| 6 | Security baseline | ⚠️ | `SECURITY.md` present; full-history secret scan pending (#56, priority high); Dependabot recurring failures (#57) |
| 7 | Governance in place | ✅ | LICENSE (MIT), CODE_OF_CONDUCT, CONTRIBUTING, GOVERNANCE — D-refs swept to **D1–D18** across all prose surfaces (CONTRIBUTING, GOVERNANCE, AGENTS.md ×2, PR template, build doc, USER-GUIDE, README ×2); the CHANGELOG's dated release note stays as history |
| 8 | Maintainer sign-off | ❌ | operator-only decision; requires items 1/3 done and 4/6 resolved |

**To go public:** resolve item 3 (tag v0.1.0 via #44) + close #55/#56, re-verify dogfood on HEAD
(item 1), flip visibility with the maintainer's sign-off, **then immediately re-apply branch
protection** (`docs/ci-cd.md` has the exact calls — protection exists only once the repo is public
on GitHub Free; items 4/6 may carry tracked issues only if they don't contradict the flip).

## Community-first checklist (operator contract v1.1.0)

The repo-gate checklist answers "is the product ready"; this one answers "is the repo ready for a
community" (source: prompt-studio `registry/specs/community-first.md`).

| # | Item | Status | Evidence (date) |
|---|---|---|---|
| 1 | README.md at root (landing, state, how to run) | ✅ | landing + Estado + Roadmap tables; drift fixes in #55 |
| 2 | LICENSE as file (not only metadata) | ✅ | MIT, 2026-08-07 |
| 3 | CONTRIBUTING: direction + hygiene + **escalation/latency** | ⚠️ | direction + hygiene present; **no escalation/latency section** (community-first §7) — gap, add before accepting external contributors |
| 4 | CODE_OF_CONDUCT.md | ✅ | Contributor Covenant, 2026-08-08 |
| 5 | CI green (tests, lint, docs/links gates) | ⚠️ | tests green (155); **lint/formatter not configured** (#59) — required before external contributions |
| 6 | docs/STANDARDS.md (this file) | ✅ | this PR |
| 7 | Priorities visible (ROADMAP or pinned issue) | ⚠️ | README Roadmap table (M1–M5) serves; **no pinned issue** — pin #44 at flip |
| 8 | AGENTS.md (repo >1/3 agent context window) | ✅ | present, with map + context-discipline rule |
| 9 | Issue triage with intention (≤48h close-or-label) | ✅ | all 10 open issues labeled (6 of 10 with a priority label, 2026-09-10); `good first issue` + `help wanted` labels exist |
| 10 | Family mapped + cross-links + "try it" path e2e | ⚠️ | family: `profile-as-code` (hub) + `profile-data-template` (satellite, private) + `profile-data` (operator data, private — dogfood only, never linked publicly); template also lives in-repo (`templates/profile-data*`). Cross-links verified + USER-GUIDE "try it" e2e pending (#54) |

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
