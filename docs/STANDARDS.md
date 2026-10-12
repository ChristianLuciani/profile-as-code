# Repository standards & public-readiness policy

> Refreshed **2026-09-28** from a single re-measured evidence run (#100): repo-gate items 1, 2, 3,
> 5 and community items 5, 6, 7, 9; items 4 and 10 stand per their 2026-09-21 refresh (#54); item 1
> refreshed again **2026-10-03** and **2026-10-05** (#112 — dogfood re-runs on HEAD, the second on
> the v1.8 chain; run history in the #129 PR); item 3 refreshed **2026-10-09** after the `v0.2.0`
> tag + npm publish (#113, #192) and again **2026-10-11** after `v0.3.0` (#207); item 2's suite
> figure re-measured **2026-10-12** (#207); rows without a date stand as
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
| 2 | CI green + meaningful | ✅ | CI green on `main` (last runs on main: 2026-10-05, 3× `success`; `main` @ `4caf6fe` 2026-10-12). **Current suite: 447 tests, 27 files, 0 fail** (`pnpm install --frozen-lockfile && pnpm build && pnpm test` at `main` `4caf6fe`, **2026-10-12**, `[MI]` regenerable) — markdown 12 (1 file) · core 190 (11) · paste 5 (1) · github-org 22 (1) · github-readme 56 (2) · buymeacoffee/gumroad/hotmart/kofi/liberapay/payhip 6 each (1 each) · cli 126 (5). Supersedes the 353/22 figure measured on the v1.8 chain (`9498ed3`, 2026-10-05, below in item 1): core grew 165→190 and cli 103→126 with the ledger work (#210/#213); the previous count is kept as that run's record, not as a current claim. |
| 3 | Tagged release + changelog | ✅ | tag `v0.3.0` → `21e4cde` (`git rev-parse v0.3.0`, 2026-10-12); GitHub Release `v0.3.0` published **2026-10-11T03:42:42Z** (created 03:02:43Z) and `@profile-as-code/cli@0.3.0` **public** on npm, dist-tag `latest`, published **2026-10-11T03:43:27Z** ([OFICIAL] [WEB: registry.npmjs.org] `time` field, re-checked 2026-10-12; verify with `npm view @profile-as-code/cli`); bin verified running (`node packages/cli/dist/index.js --version` → `pasco 0.3.0` on `main`, 2026-10-12); `## [0.3.0] - 2026-10-11` present and non-empty in `CHANGELOG.md` (the publish extractor gate). **Reconciliation of the run:** the tag-triggered publish failed `ENEEDAUTH` (run `38108069946`) and v0.3.0 went out through **`workflow_dispatch` from `main`** (run `38109158435`, success) — which is the **primary path**, not a retry (#208, decision 5 of the #113 handover; `docs/ci-cd.md` §Releasing — the primary path). A repeat dispatch (run `38109376245`) failed benignly (`cannot publish over the previously published versions: 0.3.0`). **Both** GitHub Releases (`v0.2.0`, `v0.3.0`) were created by the dispatch run, never by the tag: the `release` job gates on `needs.publish.outputs.tag != ''` (`release.yml:167`) and a job whose `needs` failed never runs, so **a tag push today creates no Release** — option (c) of the open mechanism question. **No provenance attestation** for 0.3.0 despite OIDC succeeding: `dist.attestations` is absent because the source repo is private (npm attests only with a public source repo) — a documented limitation, not a pending task |
| 4 | Docs honest + quickstart verified | ✅ | 4 README/CONTRIBUTING/CHANGELOG drifts in #55 (closed). USER-GUIDE §1–§6 and §8–§9 executed from a fresh clone on 2026-09-21 by a non-author agent session (#54); §7 verified up to the deploy artifact (`profiles/github-readme/README.md`) + ledger (`status --mark`/`--write-checklist`) — the platform paste and the profile-repo PR + human merge were **not** executed (human boundary, by design). 7 doc bugs found and fixed in the same PR, corrected snippets re-validated against the schema; full log in the #54 comment. Caveat: repo access gates the source and template paths, not the npm install — §2 Option B clones the still-private engine, and §3 Option A clones the private template, so a third party without access fails there (item 10); §2 Option A installs from the public npm registry and needs no repo access, and §3 Options B/C turn that install into a workspace with no account and no repo (#200) |
| 5 | No placeholders in critical paths | ✅ | no TODO/FIXME in `packages/*/src` (grep 2026-09-28); renderers + CLI built (8 commands: build, check, diff, init, refine, `skills:install`, status, validate); limitations tracked as issues |
| 6 | Security baseline | ✅ | `SECURITY.md` present; full-history secret scan **clean** — gitleaks 8.30.1, 133/133 commits of `git rev-list --all` (incl. merge diffs via `--diff-merges=first-parent`, remote-only dependabot ref via stdin scan) + working tree, **0 findings** (2026-09-14, #56); Dependabot esbuild security alert resolved — merged #65 (f630cab, 2026-09-14), alert #1 auto-resolved `fixed` |
| 7 | Governance in place | ✅ | LICENSE (MIT), CODE_OF_CONDUCT, CONTRIBUTING, GOVERNANCE — D-refs swept to **D1–D18** across all prose surfaces (CONTRIBUTING, GOVERNANCE, AGENTS.md ×2, PR template, build doc, USER-GUIDE, README ×2); the CHANGELOG's dated release note stays as history |
| 8 | Maintainer sign-off | ❌ | operator-only decision; requires item 1 done (item 3 resolved 2026-10-11 by `v0.3.0` — tag + npm publish; 4 and 6 are resolved) |

**To go public:** the tag/publish is **done** (item 3 — `v0.3.0` tagged + published 2026-10-11;
the OIDC migration is **complete and validated**, `docs/ci-cd.md` §npm publish auth).
What remains: dogfood re-run on HEAD recorded and refreshed on the v1.8 chain (item 1, #112 —
2026-10-05; artifact refresh in `profile-data` + platform deploy remain the operator's human-gated
loop), maintainer sign-off (item 8), flip visibility, **then
immediately re-apply branch protection** (`docs/ci-cd.md` has the exact calls — protection exists
only once the repo is public on GitHub Free; items 6/10 may carry tracked issues only if they
don't contradict the flip).

**Order ratified 2026-10-03 (#123), with an accepted cost.** The sequence above is deliberate and
is not to be reordered. The published versions carry **no provenance attestation**, and the reason
is now purely the private source repo: npm attests only when the OIDC exchange succeeded, the
source repo is public *and* the package is public (`docs/ci-cd.md` §npm publish auth — trusted
publishing). The first publish (`v0.2.0`) additionally ran before a trusted publisher could exist,
because npm requires the package to already exist to configure one (#80, #113) — that window is
**closed**, and `v0.3.0` published over OIDC with the token deleted in npm and GitHub. The
attestation arrives by itself at the visibility flip; it is not a task of this migration. The cost
was accepted deliberately — not overlooked — and it is permanent for the versions already
published.

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
| 5 | CI green (tests, lint, typecheck, docs/links gates) | ✅ | tests green (**447** tests / 27 files, 0 fail, vitest — the same `pnpm test` run as repo-gate item 2, `main` `4caf6fe`, 2026-10-12; the 304 previously cited was the 2026-09-28 figure); lint/format gate configured (Biome 2.5.14: `pnpm lint` + `ci.yml` step, `biome.json`) — #59 (2026-09-17); typecheck gate added to CI (`pnpm build && pnpm typecheck` step) — #108/#109 (2026-09-25); **docs/links gate landed** — `scripts/link-check/` (`check.mjs` + fixture self-test `test.mjs`), offline and deterministic: relative links + in-page anchors over the tracked, non-hidden Markdown doc areas (**47 files, 94 links** re-measured 2026-10-12; **46 files, 86 links** at the 2026-10-09 landing — refreshed here because this PR adds links; anchor slugs verified against `github-slugger@2.0.0` via the committed `slug-oracle.json`), external URLs never fetched (walled/anti-bot 403, #132), private family target declared in `allowlist.json` with its removal trigger (the `profile-data-template` flip); self-test **15/15** fixtures, including the deliberately broken relative link that must fail (`E-LINK-MISSING`); wired always-on in `ci.yml` after the pinned Node setup and before install — #149 (2026-10-09) |
| 6 | docs/STANDARDS.md (this file) | ✅ | this file — last refresh 2026-09-28 (#100) |
| 7 | Priorities visible (ROADMAP or pinned issue) | ⚠️ | README Roadmap table (M1–M5) serves; **no pinned issue** — pin the then-current roadmap/priority issue at flip (the #113 target closed 2026-10-10; #192) |
| 8 | AGENTS.md (repo >1/3 agent context window) | ✅ | present, with map + context-discipline rule |
| 9 | Issue triage with intention (≤48h close-or-label) | ✅ | all open issues labeled at triage (9/9; 2 with a priority label, 2026-09-28 — snapshot, re-census before every flip decision); `good first issue` + `help wanted` labels exist |
| 10 | Family mapped + cross-links + "try it" path e2e | ⚠️ | family: `profile-as-code` (hub) + `profile-data-template` (satellite, private) + `profile-data` (operator data, private — dogfood only, never linked publicly); template also lives in-repo (`templates/profile-data*`). Cross-links verified + USER-GUIDE "try it" path executed end-to-end up to the deploy boundary (#54, 2026-09-21; scoping in item 4). **Reframed by #200 (2026-10-10):** the workspace is a folder, not a required repo, and there are three on-ramps (SPEC §9.2). A newcomer now **can** create and validate a workspace from the public npm package with no repo access and no account (`npm i -g @profile-as-code/cli` → `pasco init` → `pasco validate`; USER-GUIDE §1/§3 Options B/C) — so the satellite is required for the **recommended** on-ramp A (full example + automation + history), not for the ability to start. Remaining: with the satellite private, on-ramp A reaches insiders only, and its `pasco` build workflow is still owed (`profile-data-template#11`) — publish the satellite with the hub (community-first §9), or keep directing outsiders to on-ramps B/C |

## Publication by families (community-first §9)

The publication unit is the **family**, not the single repo:

- **Hub:** `profile-as-code` — the engine. The in-repo `templates/` dirs are **pointers only**
  (their READMEs link the satellite); the documented quickstart (`docs/USER-GUIDE.md` §3) offers
  three on-ramps — A creates a workspace with
  `--template https://github.com/ChristianLuciani/profile-data-template`, B (`pasco init`) and C
  (bring your own storage) need no repo and install from the public npm package.
- **Satellite:** `profile-data-template` (private) — **the recommended on-ramp (A)**: with the
  satellite private, that on-ramp reaches insiders only. A newcomer without access **can still
  create and validate a workspace** through on-ramps B/C (public npm, no account), so the
  satellite is no longer the only way to start. Publish it together with the hub, or keep
  directing outsiders to B/C while it stays private.
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
