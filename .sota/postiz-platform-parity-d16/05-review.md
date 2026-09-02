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