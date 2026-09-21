# 05-review.md — sota-review of PR #99 (quickstart-verify-54, issue #54)

Reviewer: in-session adversarial pass (skill `sota-review`).

**Model-routing gap declared:** session model = `deepseek-flash` (deepseek) —
the session that produced the change is also the strongest worker available
here, so the reviewer equals but cannot outrank the builder. The skill's step 2
asks to switch up before continuing; mitigation is the step-9 terminal doubt
pass: `premerge-review` in a fresh, clean session, whose findings reconcile in
this file. Same shape as the `links-label-fallback` (PR #83) and
`renderer-md-safety` (PR #79) precedents.

**Preconditions — partially unmet, declared:** this change did **not** run
through `/sota-workflow`, so there is no `.sota/<slug>/03-spec.md` nor
`04-build.md`. Review inputs:

- Contract: issue #54 (`## Repro`, `## Esperado`, `## Gate`, "Archivos
  sospechosos", ADR-lite) · `docs/STANDARDS.md` repo-gate item 4 ·
  `schema/profile.schema.json` v1.5 (the authority for the corrected examples) ·
  repo rules (AGENTS.md, D3, D8).
- Build: branch `pi/verify-user-guide-quickstart`, base `main` @ `2924609`,
  commits `ce4d3a3` + `6a82049`, 2 files +54/−41 (`docs/USER-GUIDE.md`,
  `docs/STANDARDS.md`). Docs-only — no engine, schema or test change.
- PR: #99 (opened before this phase — see contract conflict).

**Contract conflict declared (skill vs repo):** step 8 of this skill says
"never push, never open the PR yourself". This repo's session-discipline §2
makes the open PR the minimum delivered state, and the same conflict was
resolved the same way in the PR #83 precedent (flagged, not silently
resolved). PR #99 was opened by the authoring session per repo contract.

## Pass 1 — Spec fidelity → PASS after a REQUIRED fix

Issue #54 asks for a §1–§8 end-to-end run by a non-author session from a fresh
clone, "sin improvisar comandos", with deviations = doc bugs, and explicitly
warns that partial verification does not count.

| Item (source) | Evidence |
|---|---|
| Fresh clone, no prior context | `/tmp` clone of `2924609`; Node v24.11.0 / pnpm 11.20.0; §2 install + CLI build + `pasco` on PATH |
| §3 workspace from template | `gh repo create profile-data-verify54 --template … --private` → clone → `.pascorc` root resolution; Option B `pasco init` (person + brand) also exercised |
| §4–§6, §8, §9 | validate (schema/drift/geo), build, diff, refine + `--choose`, §8.1 routine + tag/diff, §8.2 engine update, §8.3 brand, every §9 troubleshooting row |
| Deviations captured as doc bugs | 7 found, all fixed in `ce4d3a3`, corrected §6 snippets re-validated against `schema/profile.schema.json` |
| Result recorded on the issue + STANDARDS updated | #54 comment (issuecomment-5765409087) + item 4 |
| **"de punta a punta o no cuenta"** | **R1 (REQUIRED, fixed this round)** — §7's *deploy* step was verified only up to the artifact + ledger; the actual platform paste and the profile-repo PR + human merge were never executed, yet the evidence said "§1–§8 executed". Fixed: scope stated explicitly in STANDARDS item 4 |

**R1 — §7 deploy scope (REQUIRED, fixed this round).** The issue's gate is
binary ("no sirve verificación parcial"), and §7 lists *deploy* as one of the
steps §1–§8. The run covered the mechanical half a machine can do (the
renderer wrote `profiles/github-readme/README.md`; `pasco status --mark
experience:exp-example-labs github-readme` and `--write-checklist` behaved as
documented) but not the paste into a real platform or the PR into a profile
repo. The terminal action of the git/API class is, by the guide's own text,
*"the human merges"* — so it is not agent-executable, but the claim still had
to be scoped rather than left as a blanket "§1–§8 executed". Fixed in
`docs/STANDARDS.md` (explicit boundary) and re-stated in the PR body.

## Pass 2 — Correctness → PASS after 2 fixes

Adversarial read of the final diff, one claim at a time against the contract:

- **R2 — §1 new sentence was factually wrong (REQUIRED, fixed this round):**
  "the workspace steps (§3) use `gh` to create the repo from the template and
  to clone it" — `gh` creates from the template; the clone is `git clone`.
  Corrected to "…, and `git` to clone it".
- **R3 — §5 parenthetical overclaimed a routine step (REQUIRED, fixed this
  round):** "(the §8.1 routine commits before diffing)" — the §8.1 routine
  never invokes `pasco diff`; diff only appears in the surrounding prose.
  Rewritten as the general rule: diff compares commits, so commit first.
- Corrected examples verified against the schema source, not the template
  prose: `experienceItem.start` → `$defs/date` (YYYY-MM-DD; the def's note
  "YYYY-MM via YYYY-MM-01" means expand, not accept `2024-03` — the run
  confirmed `2024-03` → *Invalid ISO date*); `end` → `anyOf[date, const
  "present"]` and **optional** (so the old `end: null` was doubly wrong);
  `publication.authors` → `type: string`; `project.keywords` → `array`;
  `skill.platformWeights.additionalProperties` → number 0..1.
- Ledger key format reproduced with the emitted `<block>:<id>`
  (`experience:exp-example-labs`); `--choose` id matches the convention the
  CLI prints in the refine task (`linkedin-en-<n>`).
- Indentation note verified per file: `experience.yaml` items are column-0,
  `publications/projects/skills/bios/headlines/identity` are 2-space — the
  mismatched-dash parse failure was reproduced (`A block sequence may not be
  used as an implicit map key`) before writing the note.
- `pasco diff` committed-only behavior reproduced (`hasChanges:false` with a
  dirty tree; the file appears after commit).
- Stale cross-references checked before editing: `#44`, `#45`, `#55`, `#56`
  are all CLOSED; `git ls-remote --tags origin` is empty and
  `@profile-as-code/cli` is unpublished (npm 404, 2026-09-21) — the "To go
  public" line now states the real gate instead of pointing at closed issues.
- No trust surface, no executable path, no secrets (markdown only).

## Pass 3 — Coherence → PASS after 1 fix

Single worker (no parallel seams). Cross-surface consistency of the same
facts:

- **R4 — section-range drift (fixed this round):** STANDARDS said "§1–§8",
  the #54 comment table covered "§1 prerequisite … §9 troubleshooting", the
  PR body said "§1–§8". Unified to "§1–§6 and §8–§9 executed; §7 scoped" in
  STANDARDS and in the PR body.
- Terminology consistent with the contract: `platformWeights`, `langMap`,
  `<block>:<id>`, `release-*`, `profiles/<platform>/README.md` are used as the
  CLI/schema use them.
- Inline comments sit where the reader hits the constraint (the date/`present`
  and array-vs-langMap notes), consistent with the file's existing style.
- Out-of-scope drift in the same file was **not** silently folded in (see
  below) — it is flagged, not normalised.

## Out of scope — flagged, deliberately not fixed

Same-file drift surfaced while reviewing the table; kept out to avoid turning
#54 into a full standards sweep (issue-lifecycle: structural finding → issue):

- item 2 / community item 5 cite different test counts (250 vs 268); current
  is **283 tests, 16 files** (`pnpm test`, 2026-09-21);
- community item 9 says "all 10 open issues labeled" — there are now **4 open
  and only 1 labeled**; the ✅ no longer holds and needs an operator action;
- item 1 points at closed #45 for the owed dogfood re-run; item 3's cell still
  cites closed #44.

Recommended follow-up issue: *"STANDARDS: refresh items 1/2/3/9 + community
5/9 with dated evidence"*.

## Verification story

- Docs-only change; `pnpm lint` clean, `pnpm test` green (283 tests, 16 files
  across markdown/core/github-readme/github-org/cli) in the worktree.
- CI: **pass** on `ce4d3a3` and on the fixup head `6a82049`
  (runs 35637982288 / 35638514553).
- Evidence for the doc facts is the end-to-end run itself, logged on #54.

## Verdict

**PASS — round 1.** 4 REQUIRED findings (R1–R4), all found by this in-session
adversarial pass and fixed in the same round; no BLOCKERs. No swarm re-entry
(single worker, docs-only). Handoff to the human is PR #99 as-is; the merge is
the human's call (repo-governance §3).

## Fresh-context reconcile

Pending — to be filled when the `premerge-review` report is pasted back. The
fresh reviewer receives only the PR link and the contract; none of the
findings above are passed to it (doubt-driven-development: never pass the
CLAIM to the reviewer).

What this in-session pass could **not** refute (recorded as survived):

- the corrected §6 examples are schema-valid (checked against `$defs`, then
  re-run through `pasco validate` on a workspace reset to the template's
  initial commit — all four accepted, with the expected
  `url-not-in-identity` warning for the placeholder link);
- the "7 doc bugs" count is consistent between the #54 comment, the PR body
  and STANDARDS (dates+`end` counted as one item);
- the §7 ledger mechanics (`--mark`, `--write-checklist`, in-sync/stale/never)
  work as written;
- the "To go public" rewrite matches verified repo state (no tags, npm
  unclaimed, #44/#55/#56 closed).

Reviewer limits declared: no independent re-run of the quickstart by a second
party (that is exactly what the step-9 `premerge-review` is for); the §7
human-boundary interpretation is the authoring session's reading of the
guide's own "the human merges" line and is open to the fresh pass.
