# 05-review — Postiz platform parity (D16, PR #31)

- **Reviewer session:** `01a06049-514f-7864-bb3d-082cd8878687` (`postiz-platform-parity-d16`)
- **Model tier note:** reviewer = builder tier (`glm-5.3-flash:cloud`, same session). The
  skill requires reviewer ≥ strongest worker — *equal* is allowed. The stronger gate is
  the fresh-context `premerge-review` pass (step 9): run it on the strongest available model.
- **Inputs:** contract = issue #30 (ratified 2026-09-01) + SPEC §6/D16; build = `git diff
  origin/aionui/pi/brand-flavor...HEAD` (9 files, +306/−31). This was a retrofit invocation
  (no `.sota/` spec/build artifacts) — inputs adapted accordingly.
- **Process deviation (declared):** PR #31 was already opened per `session-discipline`
  (PR abierto = estado mínimo de trabajo entregado) with the operator's explicit approval of
  the plan including commit/push/PR. The skill's never-push rule governs the sota-swarm
  authoring flow; operator contracts take precedence here.

## Pass 1 — Spec fidelity (all acceptance criteria, evidence re-run)

| # | Criterion (issue #30) | Evidence | Verdict |
|---|---|---|---|
| 1 | Unión = Postiz 32 + extras, 41 plataformas | `python3` check: `enum size: 41`, `union exact match: True`, no missing/surplus | ✅ |
| 2 | Slugs Postiz verbatim; existing 7 untouched | `plat[:7] == v1` → True (order preserved); new slugs match Postiz `__type` list | ✅ |
| 3 | One shared enum, person + brand | No per-flavor restriction in schema; `linkedin-page`/`github-org` present | ✅ |
| 4 | Sequencing A (base = brand-flavor) | `git merge-base --is-ancestor origin/aionui/pi/brand-flavor HEAD` → OK | ✅ |
| 5 | moltbook stays | in enum | ✅ |
| 6 | check.platform == ['all', ...platform] | schema-check: `PASS (42 entries)` + vitest contract test | ✅ |
| 7 | `pnpm gen:zod` deterministic | re-ran → `git diff` empty (`ZOD-DETERMINISTIC=YES`) | ✅ |
| 8 | PLATFORMS mirror + drift guard test | `tests/contract.test.ts` (8 tests) green | ✅ |
| 9 | drift hosts + patreon.com fix | diff verified; regression test `warns on platform-host URLs (patreon)` green | ✅ |
| 10 | SPEC §6 + D16 documented | SPEC.md lines 93, 110; table well-formed (3 cols) | ✅ |
| 11 | CI green | `gh pr checks 31` → `ci pass 52s` | ✅ |

**Cheap re-runs performed during review:** schema-check ✅ · gen:zod determinism ✅ · full
`pnpm test` fresh (58 core + 5 renderer + 32 CLI) ✅ · typecheck ✅ (earlier in session).

## Pass 2 — Correctness (hunt for defects, then what survived)

- `hostMatchesPlatform` / `isPlatformSurface` subdomain logic verified hunk-by-hunk; apex +
  subdomain both covered (`substack.com` + `*.substack.com`, `ghost.io` + `*.ghost.io`).
- Curated-instance stance probed: `fosstodon.org` (mastodon) correctly NOT flagged —
  open-ended networks stay unflagged, documented in code comment. Advisory severity (D12).
- `listmonk` self-hosted (no canonical host) intentionally absent from HANDLE_HOSTS —
  documented inline. No silent gap.
- No unhandled failure paths, no credential/input handling introduced, no security surface.
- **Trade-off accepted:** lemmy/mastodon/nostr instances beyond the curated host lists are
  unflagged by drift (would false-positive otherwise). Recorded, not silently ignored.

## Pass 3 — Coherence (seams)

- N-1 (**NIT**) `packages/core/tests/contract.test.ts:22` — `makeWorkspace` helper duplicated
  from `tests/brand.test.ts`. Test-local isolation accepted; extract to shared helper only if
  a third copy appears. Evidence: same 8-line helper in both files.
- N-2 (**NIT**) `scripts/schema-check/check.py` — the dedup failure message lists missing
  platforms but not surplus ones (surplus still fails the comparison, message is less helpful
  than it could be). Cosmetic.

## Fresh-context reconcile (premerge-review report, classified 2026-09-02)

Fresh report verdict: PASS-CON-RIESGOS (informativo). 10 findings — each re-read against
the diff before classifying (doubt-driven step 4). All 10 confirmed real on inspection.

| # | Finding | Class | Action |
|---|---|---|---|
| F1 | wordpress/slack subdomain profiles → false handle-host-mismatch + under-warning | **Valid + actionable** (MAJOR) | Fixed: `PLATFORM_SUBDOMAIN_HOSTS += wordpress, slack` |
| F2 | lemmy federated → curated list actively rejects legit instances | **Valid + actionable** (MAJOR) | Fixed: removed from HANDLE_HOSTS (any host, module philosophy) |
| F3 | gmb expected login dashboard, not public surface | **Valid + actionable** (MAJOR) | Fixed: removed from HANDLE_HOSTS (live check = skill's job) |
| F4 | schema identity stale at v1.1 + CHANGELOG no entry | **Valid + actionable** (MAJOR) | Fixed: `$id`/`title`/description → v1.2, CHANGELOG Added entry, regen zod |
| F5 | PR body stacking says #25 (issue) instead of #27 (base PR) | **Valid + actionable** (MAJOR) | Fixed: `gh pr edit 31` |
| F6 | ghost self-hosted (canonical §17 case) → mismatch | **Valid + actionable** (NIT, operator-canonical) | Fixed: any-host, parity with listmonk; ghost.io Pro stays a surface |
| F7 | dedup message lists missing but not surplus | **Valid + actionable** (NIT) | Fixed: prints both |
| F8 | stale "6 platform ids" count | **Valid + actionable** (NIT) | Fixed: count dropped |
| F9 | EOF newline contract.test.ts | **Valid + actionable** (NIT) | Fixed |
| F10 | HANDLE_HOSTS leftovers: mastodon curated, unreachable `github` key, linkedin unrestricted vs linkedin-page | **Valid trade-off** | NOT fixed here — pre-existing from base PR #27; flagged for the base PR's review. Recorded, not silently dropped |

Buckets: 9 actionable (fixed, commit `8160a6f`) · 1 trade-off (F10, documented above) ·
0 contract misreads · 0 noise. The fresh pass also re-verified independently: exact 41-union
against a live Postiz fetch, dedup double-enforcement, additivity, the weibo fixture change,
the patreon regression fix, and the CLI test determinism — all survived refutation.

**Loop bound (step 11):** one fresh round, one correction round, all gates green after.
Per the skill, consecutive-NITs-only or a second fresh pass is the operator's call —
recommended once more before merge (clean session), not mandatory: F1–F4 were MAJOR,
so a confirmation pass is proportionate.

**Process note:** the review file is now versioned on the branch (correction commit included
it via `git add -A`). Accepted — sota-review treats 05-review.md as a persistent pipeline
artifact; the earlier "untracked" statement is superseded by this note.

## Corrections round 1 (applied)

See commit `8160a6f` message for the per-finding fix list. Gates after: schema-check OK
(v1.2 identity), gen:zod deterministic, typecheck + build clean, tests 58 core + 5 + 4 +
32 CLI green.

## Fresh-context reconcile — round 2 (headless clean-context pass, 2026-09-02)

Second fresh pass, orchestrated per protocol: headless `pi -p` session on a **fresh clone**
with `.sota/` physically stripped (the reviewer physically cannot read the author's claims),
prompt = contract only (PR #31 + issue #30 + SPEC D16). Findings re-verified by this session
against live sources before classifying (doubt-driven step 4).

| # | Finding | Class | Action |
|---|---|---|---|
| F1 | Postiz parity incomplete — MeWe + Tumblr missing; cited page's "32" header undercounts its own tables | **Valid + actionable** (MAJOR) | **Verified live** (llms.txt: "34 social platforms", providers/mewe.md + tumblr.md, fetched 2026-09-02) → added `mewe` + `tumblr`; enum 43 = 34 Postiz + 9 extras |
| F2 | SPEC §6 arithmetic: "32 + 3 extras" = 35, set was 41 — six v1 non-Postiz surfaces uncounted | **Valid + actionable** (MAJOR) | SPEC + CHANGELOG rewritten with real composition: 34 + 9 = 43 |
| F3 | iris.to in HANDLE_HOSTS.nostr but not PLATFORM_HOSTS (guard asymmetry) | **Valid + actionable** (NIT) | Added to PLATFORM_HOSTS |
| F4 | threads.net only; profiles migrated to threads.com [INF] | **Valid + actionable** (NIT) | Added threads.com to both host maps (cheap, advisory) |
| F5 | linkedin/upwork/researchgate any-host vs linkedin-page guarded | **Valid trade-off** (NIT) | Pre-existing from base PR #27 — same bucket as round-1 F10; flagged for the base PR's review |
| F6 | check.py KeyError traceback on structural drift | **Valid + actionable** (NIT) | try/except → clean FAIL message |
| F7 | CHANGELOG entry in ES vs D8 "docs EN" | **Noise** | Pre-existing repo convention (adjacent v1.1 entry is also ES) — tension declared, not introduced here |

Buckets: 5 actionable (fixed, commit `b6a028a`) · 1 trade-off (F5, documented) · 0 contract
misreads · 1 noise (F7, convention noted). The fresh pass also refuted and failed to break:
the 41/42 invariants, additivity, the patreon regression fix, moltbook-as-Postiz-verbatim,
`pac build` on renderer-less platforms, the weibo fixture promise, and subdomain matching
(no trivial bypass) — all survived.

**Loop bound (step 11):** two fresh rounds, both reconciled, zero BLOCKERs. Round-2 MAJORs
were completeness/accuracy fixes (all applied and gate-verified). A third fresh pass is the
operator's call; per the skill, the gate is met once corrections land green. The reviewer
tier note stands: `glm-5.3-flash:cloud` (equal to builder — permitted; a stronger-tier pass
would add confidence, not coverage).

## Verdict

**PASS** — 0 BLOCKER, 0 MAJOR, 2 NIT. Rounds: 1 (no corrections needed).

Remaining risks: schema parity ≠ skill coverage (per-platform skills are follow-ups, per
issue #30 scope) — accepted by the operator.

## Fresh-context gate (step 9)

Copy-paste block printed to the operator in-session. `premerge-review` verdict is
INFORMATIVE; this session reconciles and decides (classification precedence: contract
misread → actionable → trade-off → noise).

## Post-testing feedback path

Small findings → correction blocks appended to this review + new commit on the branch;
large findings → fresh `/sota-workflow` round against a new spec revision. Recorded per
skill step 8.