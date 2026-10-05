# 05-review — Ko-fi platform chain (D16 operator extra #10, PR #131)

- **Reviewer session:** `session-d393c7d8-9610-43b2-b7cc-7889e0c6725d` (`dsh/issue-130/kofi-platform`)
- **Model tier note:** reviewer = builder tier (`glm-5.3-flash:cloud`, same session). The
  skill requires reviewer ≥ strongest worker — *equal* is allowed. The stronger terminal
  gate is the fresh-context `premerge-review` pass (step 10): run it on the strongest
  available model in a clean session.
- **Inputs (adapted):** this was a direct-request invocation, not a `sota-swarm` build —
  **no `.sota/<slug>/03-spec.md` / `04-build.md` exist and none were fabricated.** Contract
  equivalents: issue #130 (scope + acceptance, created before any edit) + SPEC decisions
  (D3/D9/D12/D14/D16/D18, §7, §15) + `skills/README.md` rules. Build equivalents: the
  commit series (`1f5ea28` → `7bf439c` → `78b0313`) + CHANGELOG `[Unreleased]` +
  [PR #131](https://github.com/ChristianLuciani/profile-as-code/pull/131) body.
- **Process deviation (declared):** the PR was already open (`session-discipline`: PR
  abierto = estado mínimo de trabajo entregado) with the operator's explicit approval of
  the plan including commit/push/PR. The skill's never-push rule governs the sota-swarm
  authoring flow; the operator contract takes precedence here. Two in-session review
  rounds (code-review-and-quality, multi-pass with a fresh-context reviewer subagent)
  ran BEFORE this sota invocation; this artifact records the gate verdict on top.

## Pass 1 — Spec fidelity (issue #130 acceptance, evidence re-run)

| # | Criterion (issue #130) | Evidence | Verdict |
|---|---|---|---|
| 1 | `kofi` in `$defs/platform.enum` + derived `check.platform` | schema-check: `check.platform == ['all', ...platform] (45 entries)`; `valid-kofi.json` accepted; all 8 invalid fixtures still rejected | ✅ |
| 2 | Zod regenerated, committed together, no hand-editing (D3) | fresh reviewer re-ran gen-zod.ts in a throwaway clone at each review round → byte-identical to committed file (empty diff); 4 `"kofi"` Zod occurrences = `$ref` inlining in the single regenerated line | ✅ |
| 3 | Core `PLATFORMS` mirrors schema enum exactly (order-sensitive) | vitest contract test: `PLATFORMS mirrors the schema enum exactly` + no-duplicates + dedup tests green (10 test file) | ✅ |
| 4 | Ledger unchanged (block-scoped keys already valid for kofi) | no ledger code in the diff; `LEDGER_KEY_PATTERN` untouched; contract test validates `bios:kofi.long@en` end-to-end | ✅ |
| 5 | Renderers registered (map + build chain + devDependency) without touching `verify-pack`/`release-guard` | diff verified; those scripts carry no renderer lists (checked pre-PR) | ✅ |
| 6 | New renderer: plain-text paste source, exactly ONE bios row, byte-stable | 7-test suite: length priority, fallbacks, per-lang isolation, empty → "" (no trace), no merge, no markdown, `deploySpec` | ✅ |
| 7 | Empty render → no-trace unbuild; pure `profiles/` (§15.1) | cycle test (build with row → file exists; row removed → build → dir gone, `skipped[0].platform == "kofi"`); real-workspace smoke: `written=[]`, `profiles/` untouched | ✅ |
| 8 | New skill follows `skills/README.md` structure + evidence rule | `skills/kofi/` (SKILL.md + playbook + checks.yaml + research); every quantitative claim sourced + dated 2026-10-05 (About limit NOT invented — soft-cap `[?]`, status 40 `[OFICIAL S1]`, host `ko-fi.com`/NXDOMAIN `[WEB S17]`) | ✅ |
| 9 | SPEC + CHANGELOG documentation | D16 row (union, 44) + §9 prose 34+10=44; CHANGELOG `[Unreleased]` Added + Changed; README/CONTRIBUTING/cli-README inventories refreshed | ✅ |
| 10 | Gates green | `pnpm test` (core 139 · cli 82 · kofi 7 · org 22 · readme 53 · markdown 12), typecheck, lint, schema-check — re-run at HEAD `78b0313` this session; CI ✅ + sign-off ✅ (rounds 1 and 2) | ✅ |

## Pass 2 — Correctness (hunts, then what survived)

- **Empty-artifact lifecycle** (the change's only non-additive behavior): probe-verified
  end-to-end — (i) pre-#130 workspace all-build leaves ZERO fs traces (kofi rows
  schema-impossible); (ii) real-workspace copy smoke: `written == []`, no `profiles/kofi/`
  dir; (iii) row-removal cycle: previous artifact unbuilded, including stale `assets/`.
  Survivor: `rmSync` can only reach `profiles/<s.platform>/` inside the mutually exclusive
  empty branch (single-threaded deterministic loop) — no cross-platform or double-removal.
- **Renderer pick semantics**: `long > medium > short` is SOTA-sourced (SOTA-2026 §1/§7:
  About = the page's only free-form body; separate ≤40-char status field is NOT the bio);
  single-row emission is a D18 constraint (ledger hashes one row; a merge could never
  reconcile staleness).
- **`pasco status` untouched** — ledger compares ledger↔SSOT hashes; the unbuild is what
  closes the stale-file hole status could never flag.
- **Pre-existing (not introduced, out of delta):** CLI unhandled `EPIPE` when stdout
  closes early (`| head`); M8-era: `assets/` dir not cleaned when a non-empty render
  declares zero assets this run (unreachable for kofi). Recorded as follow-up material.

## Pass 3 — Coherence (integration seams)

- Single worker (no parallel build): no hidden seam. Cross-cutting vocabulary checked:
  `deploySpec` now matches SPEC §7's union exactly (`'manual'`; "paste" stays prose);
  `skipped[]` reason strings are single-source literals in build.ts; renderer tests,
  fixtures and skill docs quote the same deploy order; drift/HANDLE_HOSTS use ONE host
  token (`ko-fi.com`) matching the skill's identity rules.

## Pass 4 — Anti-trim (premerge-review §Anti-trim pass — mechanical scan, canonical criterion)

Criterion source: `/Users/eva/.dsh/skills/premerge-review/SKILL.md` §Anti-trim pass
(projected sibling resolved; carries the section — projection NOT drifted; canon =
prompt-studio `bin/lint.sh` check 12 loss_pat, skills-studio#162).

- **Scan:** `git diff main...HEAD` deleted lines ∩ loss_pat → **5 matches**.
- **Traces:** trace 2 (sidecar) — this repo ships no provenance sidecars: *unavailable*
  (declared, not skipped silently). Trace 3 — no `Trim:` lines in the PR body *because
  every match passed trace 1*.
- **Trace-1 resolution (each match):**
  1. Old D16 table row (union, 43 + `[OFICIAL] ...`) — superseded in place by the (union,
     44) row at the same file/line carrying the same `[OFICIAL]` source + dedup contract →
     SURVIVES at `docs/SPEC.md` D16.
  2. Old `packages/cli/README.md` build row — replaced by the refreshed row (same M8/§18.6
     assets contract + more content) → SURVIVES.
  3. `const result = renderer(s, bundle.assets)` — a CODE MOVE (intermediate-commit
     noise in the cumulative diff); present at HEAD → SURVIVES.
  4. Old generated Zod line (enum sans kofi) — D3 regeneration; every normative clause
     (`http(s) ONLY`/`#53` url discipline, ledger rules) carried in the regenerated line
     → SURVIVES.
  5. Old schema description line — additive supersede (v1.7 sentence appended; all v1.x
     history clauses verbatim) → SURVIVES.
- **Verdict: PASS (0 BLOCKER)** — no normative deletion without trace.

## Fresh-context reconcile

Fresh pass ran via in-session reviewer subagent (dsh `2384084e`) with clean context:
round-1 REQUEST CHANGES (4 Required + 1 Optional + 1 Nit), round-2 delta APPROVE. Buckets:

- **Valid + actionable → fixed:** SPEC D16 row (43→44, 78b0313) · schema $id/title v1.7 +
  gen:zod (78b0313) · deploySpec → `manual` (78b0313) · unbuild lifecycle + cycle test
  (7bf439c + 78b0313) · `skipped[]` report (78b0313) · cli README row (78b0313) ·
  self-found: skip-after-mkdir orphan dirs + README/CONTRIBUTING inventory drift (7bf439c).
- **Valid trade-off → accepted, recorded:** none in this review.
- **Noise:** none — all fresh findings re-read against the diff before classification
  (each reproduced and confirmed in the diff before fixing).
- **Contract misreads:** none. (Hunt question (c) explicitly resolved: the length
  priority is sourced, not arbitrary — SOTA-2026 §1/§7.)

## Verdict

**PASS** — in-session loop: 2 correction rounds (7bf439c, 78b0313); fresh-context round:
1 (delta APPROVE at HEAD `78b0313`). Doubt-theater guard: 0 findings were rubber-stamped —
9 actionable findings across two rounds, all fixed with evidence.

**Feedback path (for the operator):** post-merge testing feedback re-enters as (a) small
findings — comment on PR/issues; a correction commit lands on a fresh session or this
branch by explicit request; (b) large/route changes — a fresh `/sota-workflow` round with
a new issue. Feedback on the Ko-fi platform facts (limits/formatting) goes to
`skills/kofi/research/SOTA-2026.md` — update the research file first, checks follow.