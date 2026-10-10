# Repository standards & public-readiness policy

> Refreshed **2026-09-28** from a single re-measured evidence run (#100): repo-gate items 1, 2, 3,
> 5 and community items 5, 6, 7, 9; items 4 and 10 stand per their 2026-09-21 refresh (#54); item 1
> refreshed again **2026-10-03** and **2026-10-05** (#112 — dogfood re-runs on HEAD, the second on
> the v1.8 chain; run history in the #129 PR); item 3 refreshed **2026-10-09** after the `v0.2.0`
> tag + npm publish (#113, #192); rows without a date stand as
> written until their next refresh. Every status cites its evidence — a
> claim without source + date does not belong here (evidence rule).

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
| 1 | First real test (dogfood: real data rendered + deployed) | ⚠️ | renderers `github-readme` + `github-org` built and tested (`packages/renderers/`, CI green — 2026-09-28); real workspace: `profile-data` (private repo). Deploy evidence is **not externally auditable** (private workspace). Dogfood re-run on HEAD **recorded + re-verified on the v1.8 chain** (#112, 2026-10-03 and 2026-10-05 — run history in the #129 PR): latest run HEAD `9498ed3` (= `origin/main` 2026-10-05; schema **v1.8**, 48 platforms — `kofi` v1.7 + `buymeacoffee`/`liberapay`/`gumroad`/`payhip` v1.8), `pasco 0.2.0` — `pnpm install --frozen-lockfile && pnpm build && pnpm test` in the session worktree (**353 tests**, 22 files, 0 fail), then `pasco validate` / `pasco build` against a **fresh copy** of the real `profile-data` workspace (the private repo was never mutated from the engine session — SPEC §9): `validate` green (87/100; fact consistency 92, structured-data 80, semantic associations 100, citability 73 — unchanged from the 2026-10-03 run), artifact `profiles/github-readme/README.md` re-rendered (163 lines, sha256 `3e7fd8a04e30d00eb96371f0333fef4adf2819aebeb60a524083d7037e659f8a`; render **deterministic** — rebuilding the same copy reproduces the identical sha256); the 5 new paste platforms render empty for this workspace and are skipped (no orphan `profiles/` dirs — e2e verification of the `7bf439c` skip fix). Drift vs the workspace's committed artifact (last build 2026-09-15, sha256 `9d36beabfc806f5c…`): additive JSON-LD `jobTitle` / `worksFor` (engine growth since that build — same diff class as the 2026-10-03 run, `[MI]` classification) **plus** the 2026-10-05 data refresh (`profile-data` PR #4 — bio rewording, doctoral-claim removal): data moved, the engine render is a pure function of the workspace, no engine nondeterminism observed. The live deployed README is still the pre-v1.5 paste — sha256 `c948eaba04670e764a5c…` re-verified 2026-10-05 (raw.githubusercontent.com, unchanged from 2026-10-03); ledger `deployments.yaml`: 58 units `never`, 0 `stale` (2026-10-05, +1 unit vs the 10-03 census — data refresh). The remaining loop is human-gated (#54 boundary): refresh the artifact in `profile-data` (`pasco build` + commit in that repo), paste / profile-repo PR, merge |
| 2 | CI green + meaningful | ✅ | CI green on `main` (last runs on main: 2026-10-05, 3× `success`) + suites verified by re-run: **353 tests**, 22 files, 0 fail (`pnpm test` → `build` + `pnpm -r test`, 2026-10-05, on the v1.8 chain: markdown 12 (1 file) · core 144 (10 files) · github-org 22 · github-readme 53 (2 files) · buymeacoffee/gumroad/kofi/liberapay/payhip 7 each · cli 87 (3 files)) |
| 3 | Tagged release + changelog | ✅ | tag `v0.2.0` → `c1ca30c` (`git ls-remote --tags origin`, re-verified 2026-10-09 at `main` `c1ca30c`); GitHub Release `v0.2.0` published **2026-10-09T23:24:37Z** (created 2026-10-09T20:34:32Z) from `CHANGELOG.md` via `release.yml` + `packages/cli/scripts/release-notes.mjs` (#58, 2026-09-18) — the operator-gated tag/publish landed (#113); `@profile-as-code/cli@0.2.0` **public** on npm, dist-tag `latest`, published **2026-10-09T23:25:23Z** ([OFICIAL: registry.npmjs.org], re-checked 2026-10-09); bin verified running (`npx @profile-as-code/cli@0.2.0 --version` → `pasco 0.2.0`, 2026-10-09); `## [0.2.0] - 2026-10-09` present and non-empty in `CHANGELOG.md` (the publish extractor gate). Reconciliation of the run: the tag-triggered publish failed **E403** (run `37990886285`, step `Publish` — `NPM_TOKEN` without bypass-2FA at the time) and v0.2.0 went out through the documented `workflow_dispatch` retry (`docs/ci-cd.md` §Release, release-guard point 3 — the retry path) — which is why the Release exists without a green tag run; this first version carries **no provenance attestation** and the OIDC migration is #80 (steps 2–4, operator) |
| 4 | Docs honest + quickstart verified | ✅ | 4 README/CONTRIBUTING/CHANGELOG drifts in #55 (closed). USER-GUIDE §1–§6 and §8–§9 executed from a fresh clone on 2026-09-21 by a non-author agent session (#54); §7 verified up to the deploy artifact (`profiles/github-readme/README.md`) + ledger (`status --mark`/`--write-checklist`) — the platform paste and the profile-repo PR + human merge were **not** executed (human boundary, by design). 7 doc bugs found and fixed in the same PR, corrected snippets re-validated against the schema; full log in the #54 comment. Caveat: both gate points need maintainer credentials — §2 Option B clones the still-private engine, and §3 Option A clones the private template; a third party without access fails at the first step (item 10). §2 Option A installs from the public npm registry and needs no repo access |
| 5 | No placeholders in critical paths | ✅ | no TODO/FIXME in `packages/*/src` (grep 2026-09-28); renderers + CLI built (8 commands: build, check, diff, init, refine, `skills:install`, status, validate); limitations tracked as issues |
| 6 | Security baseline | ✅ | `SECURITY.md` present; full-history secret scan **clean** — gitleaks 8.30.1, 133/133 commits of `git rev-list --all` (incl. merge diffs via `--diff-merges=first-parent`, remote-only dependabot ref via stdin scan) + working tree, **0 findings** (2026-09-14, #56); Dependabot esbuild security alert resolved — merged #65 (f630cab, 2026-09-14), alert #1 auto-resolved `fixed` |
| 7 | Governance in place | ✅ | LICENSE (MIT), CODE_OF_CONDUCT, CONTRIBUTING, GOVERNANCE — D-refs swept to **D1–D18** across all prose surfaces (CONTRIBUTING, GOVERNANCE, AGENTS.md ×2, PR template, build doc, USER-GUIDE, README ×2); the CHANGELOG's dated release note stays as history |
| 8 | Maintainer sign-off | ❌ | operator-only decision; requires item 1 done (item 3 resolved 2026-10-09 by `v0.2.0` — tag + npm publish; 4 and 6 are resolved) |

**To go public:** the tag/publish is **done** (item 3 — `v0.2.0` tagged + published 2026-10-09).
What remains: dogfood re-run on HEAD recorded and refreshed on the v1.8 chain (item 1, #112 —
2026-10-05; artifact refresh in `profile-data` + platform deploy remain the operator's human-gated
loop), maintainer sign-off (item 8), flip visibility, **then
immediately re-apply branch protection** (`docs/ci-cd.md` has the exact calls — protection exists
only once the repo is public on GitHub Free; items 6/10 may carry tracked issues only if they
don't contradict the flip).

**Order ratified 2026-10-03 (#123), with an accepted cost.** The sequence above is deliberate and
is not to be reordered. The first published version carries **no provenance attestation under any
order**: npm attests only when the OIDC exchange succeeded, the source repo is public *and* the
package is public (`docs/ci-cd.md` §npm publish auth — trusted publishing), and the first publish
necessarily runs on the token fallback, because a trusted publisher requires the package to
already exist (#80, #113). The cost is accepted deliberately — not overlooked — and it is
permanent for that version.

Two conditions are part of the sequence, not optional:

- **The licence and the contribution mechanism are decided before the flip** (issue #95 — MIT +
  DCO). Flipping opens the contribution window, and a licence choice closes at the first accepted
  external contribution; a published version's licence is frozen at publish.
- **The gap between publish and flip is kept short.** While the repo stays private, the published
  package's `repository.url` points at a repository nobody outside can read, with no attestation
  to vouch for it. That gap is a bounded step of the sequence — not hygiene to be deferred.

## Community-first checklist (operator contract v1.1.0)

The repo-gate checklist answers "is the product ready"; this one answers "is the repo ready for a
community" (source: prompt-studio `registry/specs/community-first.md`).

| # | Item | Status | Evidence (date) |
|---|---|---|---|
| 1 | README.md at root (landing, state, how to run) | ✅ | landing + Estado + Roadmap tables; drift fixes in #55 |
| 2 | LICENSE as file (not only metadata) | ✅ | MIT, 2026-08-07 |
| 3 | CONTRIBUTING: direction + hygiene + **escalation/latency** | ✅ | direction + hygiene present; `CONTRIBUTING.md` §Escalation and expected latency adds the measured-latency table (re-measured 2026-10-08, n=103 merged PRs: p90 83.0 h all / 21.3 h maintainer+agent / 109.3 h dependabot, `[MI]`), the regenerable `gh` + `python3` command (window pinned, reproduces every figure), the honest no-external-PRs caveat (tracked in #175), and the explicit escalation rule (stalled = no maintainer response after 7 d — a deliberate line, not measured: response latency is not measurable yet, so the threshold is revisited once the external stratum exists; the honest analog stratum for a third-party PR is Dependabot, p90 109.3 h; channel = one PR comment mentioning `@ChristianLuciani`; outcomes = review, `help wanted` + note, or close with a stated reason — never silence; community-first §7/#148, 2026-10-08) |
| 4 | CODE_OF_CONDUCT.md | ✅ | Contributor Covenant, 2026-08-08 |
| 5 | CI green (tests, lint, typecheck, docs/links gates) | ✅ | tests green (**304**, vitest — same `pnpm test` run as repo-gate item 2, 2026-09-28); lint/format gate configured (Biome 2.5.14: `pnpm lint` + `ci.yml` step, `biome.json`) — #59 (2026-09-17); typecheck gate added to CI (`pnpm build && pnpm typecheck` step) — #108/#109 (2026-09-25); **docs/links gate landed** — `scripts/link-check/` (`check.mjs` + fixture self-test `test.mjs`), offline and deterministic: relative links + in-page anchors over the tracked, non-hidden Markdown doc areas (**46 files, 86 links**; anchor slugs verified against `github-slugger@2.0.0` via the committed `slug-oracle.json`), external URLs never fetched (walled/anti-bot 403, #132), private family target declared in `allowlist.json` with its removal trigger (the `profile-data-template` flip); self-test **15/15** fixtures, including the deliberately broken relative link that must fail (`E-LINK-MISSING`); wired always-on in `ci.yml` after the pinned Node setup and before install — #149 (2026-10-09) |
| 6 | docs/STANDARDS.md (this file) | ✅ | this file — last refresh 2026-09-28 (#100) |
| 7 | Priorities visible (ROADMAP or pinned issue) | ⚠️ | README Roadmap table (M1–M5) serves; **no pinned issue** — pin #113 at flip |
| 8 | AGENTS.md (repo >1/3 agent context window) | ✅ | present, with map + context-discipline rule |
| 9 | Issue triage with intention (≤48h close-or-label) | ✅ | all open issues labeled at triage (9/9; 2 with a priority label, 2026-09-28 — snapshot, re-census before every flip decision); `good first issue` + `help wanted` labels exist |
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
