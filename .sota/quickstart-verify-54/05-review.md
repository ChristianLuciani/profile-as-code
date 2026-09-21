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

Fresh `premerge-review` executed 2026-09-21 in a new, clean session (operator-
run; the formatted report was pasted back). It received only the PR link and
the contract — none of R1–R4. Verdict returned: **PASS-CON-RIESGOS**
(informative). Every finding below was re-read against the diff/schema/CLI
before classifying (rubber-stamping the reviewer is the same failure mode as
ignoring it). Precedence: contract-misread → valid+actionable →
valid-trade-off → noise.

### Fixed this round

- **F1 (MAJOR) → valid + actionable.** Item 10 said the "try it" path was
  "executed end-to-end" while item 4 (same table) scopes §7. Corrected: item
  10 now reads "executed end-to-end up to the deploy boundary (scoping in item
  4)". The two rows no longer contradict.
- **F2 (MAJOR) → valid + actionable.** Item 4's caveat named only the private
  template; the engine clone (§2) is equally gated by maintainer credentials
  while the repo is private (the guide says so itself). Corrected: the caveat
  now names both gate points (§2 engine, §3 Option A template) — a third party
  without access fails at step 1.
- **F4 (NIT) → valid + actionable.** The §5 line introduced by R3 started at
  column 0 (lazy continuation) and repeated itself. Restored to the file's
  2-space continuation; parenthetical dropped.
- **F5 (NIT) → valid + actionable, two sites.** §0 and §6 claimed the engine
  writes only `active.yaml`; false (`build` → `profiles/`, `--mark` →
  `deployments.yaml`, `--write-checklist` → `CHECKLIST.md`). Both scoped: the
  engine never edits the `content/*.yaml` facts, and the generated outputs are
  named separately.
- **F6 (NIT) → valid in part, reviewer premise wrong.** Correct that the
  id-capable row blocks should show the `id` line — added to the experience,
  publication and project examples. **Wrong on `skills.yaml`**: `$defs/skill`
  has no `id` property and `additionalProperties: false`; `validate` rejects
  `skills.0: Unrecognized key: "id"` (reproduced). The reviewer inferred the
  id-blocks from the template files instead of the schema. The note states the
  limitation, so the guide does not teach an invalid key. No change to the
  skills example beyond F4's siblings.
- **F6b (from F6) → corrected.** `experience/projects/publications` take `id`;
  `skills` does not. Added a one-line rule next to the examples.
- **F7 (NIT) → valid + actionable.** §1 read as if all of §3 needs `gh`.
  Scoped: the `gh` row is §3 Option A only; Option B (`pasco init`) needs
  neither `gh` nor a GitHub account.
- **F10 (NIT) → valid + actionable.** Item 10's ambiguous `(§9)` →
  `(community-first §9)` (USER-GUIDE §9 also exists and is about
  troubleshooting).

### Contract clarity — acted on the issue, not in the diff

- **F3 (MAJOR) → valid + actionable (contract clarity).** The binary ADR-lite
  of #54 ("no sirve verificación parcial") vs the human deploy boundary: the
  ✅ on item 4 encodes an interpretation the authoring session declared (R1),
  but the interpretation must live where the auto-close happens. Acted: an
  explicit gate-interpretation comment on #54 records the reading and asks the
  operator to confirm (or override to ⚠️) **before** the merge closes the
  issue. Not a diff change — a decision made visible.

### Deferred to their own issue

- **F8 (NIT, pre-existing) → valid + actionable, deferred.** Test counts
  diverge (item 2: 250/15 @2026-09-15; community 5: 268; actual now 283/16
  @2026-09-21) and community item 9's "all 10 open issues labeled" no longer
  holds. STANDARDS' own policy refreshes the table before a flip decision, so
  dated stale rows are expected between flips — but item 9 needs an operator
  action (issue labeling), so it belongs in a refresh issue, not in a PR about
  #54. Fresh report said "5 abiertos"; actual **4 open, 1 labeled** (API,
  2026-09-21).
- **F9 (NIT, pre-existing) → valid + actionable, deferred.** Item 5 writes
  `skills-install`; the CLI command is `skills:install` (GLOBAL_HELP). Same
  refresh issue.

### Fresh pass declared limits (survived / unrefuted)

The fresh session independently confirmed, against source (not prose): the four
schema corrections (`$defs/date`, `end` `anyOf[date,"present"]` + optional,
`authors: string`, `keywords: array`, `platformWeights` 0..1); renderer
compatibility (`github-readme` consumes `keywords` via `nonEmpty(list)`,
`platformWeights` only orders (no thresholds), `authors` is not rendered); the
`--choose` id convention; the ledger `<block>:<id>` match; `diff` reading
`base..HEAD` only; the 8-command list and exit codes; the indentation split;
the §9 rows; npm 404 + `pac@1.0.0` + no tags + #44/#45/#55/#56 closed. It
could not reproduce the quickstart run itself (no commands executed) and
restricted its ``STANDARDS``/guide reading to the touched neighbourhoods —
those limits are why its F6 skills claim went unchecked against the schema.

Doubt-theater guard: this pass produced substantive findings (F1/F2/F3), so the
pipeline is not always-green.

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
