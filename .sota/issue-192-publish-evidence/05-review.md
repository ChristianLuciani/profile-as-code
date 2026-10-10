# 05 — SOTA review · issue #192 (publish-evidence reconciliation)

- **Head reviewed:** `10e9d16` (base: `origin/main` `c1ca30c`), branch `dsh/issue-192/publish-evidence`
- **PR:** #194 (already OPEN before this review — see Deviations)
- **Reviewer:** same session/model as the author (`deepseek-flash`) — declared limitation, not a fresh pass
- **Rounds:** 1 in-session, then 1 fresh-context `premerge-review` (PR #194 comment
  `6098380398`, head `10e9d16`, verdict PASS-CON-RIESGOS: 0 blocker · 2 major · 4 nit);
  corrections applied — see `## Fresh-context reconcile`

## Preconditions — declared deviations

This artifact was **not** produced by `sota-swarm`, so the standard inputs do not
exist and were substituted:

| Expected | Actual | Substituted with |
|---|---|---|
| `.sota/<slug>/03-spec.md` (`## Task blocks`, `## Acceptance`) | absent | the issue **#192** body (`Esperado` 1–4 + `Criterio`) |
| `.sota/<slug>/04-build.md` | absent | the branch diff + PR #194 body (verification record) |
| Un-opened PR; review before `gh pr create` | PR #194 already open | post-hoc review of the pushed head |

Precedent: PR #191 did the same for #189 ("there is no `.sota/<slug>/03-spec.md`
because #189 was not produced by `sota-swarm`; the contract used was …").

`premerge-review/SKILL.md` **resolves with `## Anti-trim pass`** (projected
sibling `/Users/eva/.dsh/skills/premerge-review/SKILL.md:68`; canonical
`skills-studio/registry/authored/premerge-review/SKILL.md` also carries it) — the
pass ran with its mechanical criterion, not from memory.

## Pass 1 — Spec fidelity (contract = issue #192)

| Contract check | Demonstrated? | Evidence (re-run this session) |
|---|---|---|
| 1 · row 3 `❌ blocker → ✅` with dated evidence | yes | tag `v0.2.0`→`c1ca30c` (`git ls-remote`); Release `2026-10-09T23:24:37Z` (`gh release view`); npm `latest` 0.2.0 `2026-10-09T23:25:23Z`; `npx … --version` → `pasco 0.2.0` |
| 2 · "no tag … unpublished" prose → real state | yes | sweep finds no remaining such claim; the only `npm view @profile-as-code/cli` is a runbook *command* (`docs/ci-cd.md:353`) |
| 3 · USER-GUIDE tag text + honest `tagPattern` verdict | yes | documented; pattern miss reproduced with the built CLI (`tag: null`, base = root commit; with `release-*` → `tag: release-1`) |
| 4 · `npm pkg fix` committed + dry-run clean | yes | 1-field diff; before-warn `"bin[pasco]" script name was cleaned` gone; after-dry-run 0 auto-corrections, `publint … All good!` |
| Criterio · no doc asserts no-tag/publish | yes | grep sweep + link gate PASS (47 files, 80 links) |

Every check is reproducible from the diff or was re-run cheaply. No
claimed-without-evidence item.

## Pass 2 — Correctness

Adversarial read of the diff. Assertions re-proved rather than trusted:

- **"no provenance attestation"** → `GET /-/npm/v1/attestations/…@0.2.0` = **404**;
  packument `dist.attestations: None`. TRUE.
- **E403 tag run + `workflow_dispatch` retry** → run `37990886285` (event `push`)
  failed at step `Publish` with the 2FA/`E403` message; run `38004121038`
  (`workflow_dispatch`, success, `2026-10-09T23:22:47Z`) matches Release/npm
  times. TRUE.
- **Manifest change does not break the bin** → CI `verify:pack` packs, installs
  the tarball and smoke-runs the linked `pasco` (`ci.yml:176-178`), green on
  `bed1411`/`10e9d16`. TRUE.
- `## [0.2.0] - 2026-10-09` present and non-empty (388 lines). TRUE.

Defects found and their state at the reviewed head are in **Findings**.

## Pass 3 — Coherence

Single worker; no parallel seams. Cross-document consistency checked:
version `0.2.0`, tag `v0.2.0`, dates `2026-10-09`, dist-tag `latest` agree across
`STANDARDS.md`, `USER-GUIDE.md`, `packages/cli/README.md`. Only drift is the
citation *form* (`[OFICIAL: …]` hybrid vs bare `[OFICIAL]` — F6, NIT).

## Pass 4 — Anti-trim (mechanical, canonical surface)

Canon (byte-true, `premerge-review/SKILL.md:122`):

```
nunca|NUNCA|Nunca|jamás|Jamás|prohibid|Prohibid|obligator|Obligator|MUST|NEVER|OFICIAL|[a-z][a-z0-9_]*[[:space:]]*=|\[[a-z][a-z0-9_]*\]|[A-Z][A-Z0-9]*_[A-Z0-9_]+
```

Scan on the deleted lines of `git diff origin/main...HEAD`:

```sh
git diff origin/main...HEAD | grep -E '^-' | grep -v '^---' | grep -nE "$CANON"
# → no matches (exit 1); 36 real deleted lines
```

**No deleted line matches a normative marker ⇒ no undeclared trim; the pass does
not force FAIL.** Substantive deletions were additionally read by hand and each
has a surviving home or is a superseded stale claim:

| Deleted | Disposition |
|---|---|
| "re-check that section against the tip **before tagging**" (old row 3) | survives in its canonical home `docs/ci-cd.md` §Preparing a release (step 2 + the stale-`[Unreleased]` paragraph) |
| "re-verified 2026-10-06 at `main` `917e999`" | superseded by the new dated re-verification — it **was** the stale claim |
| "release prep folded … under `## [0.2.0]` (2026-10-06)" | historical; the fact lives in `CHANGELOG.md` `## [0.2.0] - 2026-10-09` |
| USER-GUIDE "no path today" row | replaced by the now-true npm path (intended) |
| `"pasco": "./dist/index.js"` | npm-normalized equivalent (`dist/index.js`) |

Trace 2 (provenance sidecar) is unavailable in this repo — there is no sidecar
for docs; trace 3 (`Trim:` in the PR body) was **not** needed because no marker
matched. Said explicitly rather than improvised.

## Findings

### F1 — `docs/STANDARDS.md:29` (row 3) · MAJOR → **RESOLVED in `10e9d16`**
- Cross-reference for the retry pointed at `docs/ci-cd.md` §Post-publish
  verification, which only covers the registry checks (`npm view` / `publint` /
  `attw`).
- Evidence: the retry path is documented at `docs/ci-cd.md:203` ("on
  `workflow_dispatch` (the retry path)"), under §Release. A reader following the
  pointer lands on the wrong section. Fixed to `§Release, release-guard point 3`.

### F2 — `docs/ci-cd.md:240` · NIT → **RESOLVED in `10e9d16`**
- "`npm publish` silently fixes … and only warns" is self-contradictory (npm
  warns about the auto-correction it applies). Reworded.

### F3 — `docs/USER-GUIDE.md:341` · NIT (durability)
- The documented `tagPattern` no-match fallback (`tag: null` → base = first
  commit) has no automated test; `packages/cli/tests/cli.test.ts:310-346` covers
  only the matching-tag path and the non-git path.
- Evidence: manual reproduction only (recorded in the PR body). Behaviour is
  pre-existing and unchanged, and the default pattern is explicitly out of scope
  for #192 — follow-up candidate, not a merge blocker.

### F4 — `docs/USER-GUIDE.md:22` · NIT
- The new "no GitHub account → **npm only**" row asserts a workable path whose
  paste boundary `STANDARDS.md` item 4 says was never executed end-to-end.
- Evidence: item 4 caveat ("the platform paste and the profile-repo PR + human
  merge were **not** executed"). The install/init/build legs are trivially
  available; only the manual paste is unverified. Consider tying the row to that
  caveat.

### F5 — `docs/STANDARDS.md:29` · NIT (zone)
- Mixed time bases: UTC timestamps beside "re-verified 2026-10-09", which is the
  local session date (America/Guayaquil, UTC−5 ⇒ `2026-10-10T00:26Z`).
- Evidence: this session's verification ran at local `2026-10-09T19:26-05:00`.

### F6 — `docs/USER-GUIDE.md:94` / `packages/cli/README.md:18` / `docs/STANDARDS.md:29` · NIT
- Citation form `[OFICIAL: registry.npmjs.org, checked 2026-10-09]` is a hybrid;
  the repo uses bare `[OFICIAL]` and `[WEB: <source>]`. It satisfies the evidence
  rule (tier + source + date); flagged for form only.

## No pude refutar (lo que sobrevivió)

- Row 3's four fabricated-looking claims (tag, Release, npm `latest`, running
  bin) — all reproduced from primary sources.
- "No provenance attestation" — reproduced (404 / `attestations: None`).
- "Published via the `workflow_dispatch` retry" — reproduced from the runs list.
- Manifest normalization not breaking the published bin — reproduced by CI
  `verify:pack`.
- Anti-trim — mechanical scan clean; substantive deletions all traced.
- Gates: `install` · `lint` · `build` · `typecheck` · `test` (369 tests, 25
  files) · link-check PASS; CI `ci` + `sign-off` green on `10e9d16`.

## Asunciones que declaro

- The substituted contract (issue #192) is complete; no hidden acceptance
  beyond `Esperado` 1–4 + `Criterio`.
- The registry/GitHub state observed at review time is the state the docs
  describe.

## Límites de este review

- **Same session and same model as the author** — this pass is not a fresh
  context and not a higher tier; it cannot substitute for `premerge-review`.
- Deliberately did **not** review the rest of the repo's docs for other stale
  claims beyond the sweep pattern; only #192's surface + a publish/no-tag sweep.
- No runtime code beyond one manifest field, so security/performance axes are
  not applicable.

## Verdict

**PASS-CON-RIESGOS** — 0 BLOCKER, 0 open MAJOR at head `10e9d16`; 2 findings
corrected in the reviewed head; 4 NITs carried (F3–F6) with the risks declared
above. Mandatory next step: the fresh-context `premerge-review` on PR #194.

### Path for post-testing feedback
- Small findings → correction task blocks appended here as `## Corrections round N`.
- Large findings → a fresh `/sota-workflow` round.

## Fresh-context reconcile

Fresh report: PR #194 comment `6098380398`, head `10e9d16`, verdict
PASS-CON-RIESGOS (0 BLOCKER · 2 MAJOR · 4 NIT). The report is data; each finding
was re-read against the file before classifying (no rubber-stamping).

| Fresh | Class (ladder) | Re-read verdict | Action |
|---|---|---|---|
| F1 `STANDARDS.md` item 4 | **2 · valid + actionable (MAJOR)** | Confirmed: the appended "§2 Option A … needs no repo access" refutes the cell's surviving conclusion "a third party without access fails at the first step". Half-fix — first half edited, conclusion left standing. | Correction round 1: caveat reworded to "repo access gates the source and template paths, not the npm install … fails **there**". |
| F2 `STANDARDS.md:74` community item 7 | **2 · valid + actionable (MAJOR)** | Confirmed: "pin #113 at flip" still targets a **closed** issue. Pre-existing line, but it is the same post-release reconciliation class and the only surviving action aimed at #113. | Correction round 1: re-targeted generically ("pin the then-current roadmap/priority issue at flip"; #113 closed 2026-10-10). |
| F3 `USER-GUIDE.md:102` | **2 · valid + actionable (NIT)** | Confirmed: "same 2026-09-30 check" referred to the block above, which this diff re-dated to 2026-10-09. The dangling reference is real. | Correction round 1: "(the names were checked 2026-09-30)". |
| F4 `[OFICIAL: …]` ×3 | **2 · valid + actionable (NIT)** | Confirmed — duplicates in-session F6. The repo uses bare `[OFICIAL]` (tier) and `[WEB: …]` (source) as distinct axes; the hybrid drops `[WEB]`. | Correction round 1: all three → `[OFICIAL] [WEB: registry.npmjs.org, checked 2026-10-09]`. |
| F5 `slug-oracle.json:25` | **2 · valid + actionable (NIT)** | Confirmed: the oracle is hand-maintained data (no committed generator; only `test.mjs` reads it), and my heading rename left a stale pair. Harmless to the self-test, but drift. | Correction round 1: pair updated to the new heading/slug; `$comment` notes the 2026-10-10 update. `test.mjs` still 12/12. |
| F6 `CHANGELOG.md:409` | **4 · noise** | Re-read the referent: "these packages" = the five `private: true` paste renderers (`buymeacoffee`, `liberapay`, `gumroad`, `payhip`, `hotmart`), **never** published; the sentence stays true and the bullet is untouched pre-existing text. It does not claim the released CLI is unpublished. | No action. Contract note: #192's `Criterio` ("ningún doc … no hay tag/publish") could state that private/unpublished satellite packages are out of its scope — improvement for the next round. |

**Corrections round 1** — applied on top of `10e9d16` (commit `10eea1c`); the change is
docs + one data file, so the in-session re-review re-ran `link-check` (test + check)
and `lint`, and the full gate chain. The fresh report judged `10e9d16`; the
corrections are not disputed, they are the reconcile.

**Loop bound (step 12):** no BLOCKER in the fresh report; the two MAJORs are
resolved in round 1. A second fresh invocation is optional, not mandated — if the
operator wants it, it must receive only the new diff + contract, never this file
(the #163 corollary; this file is committed only *after* the fresh pass).

