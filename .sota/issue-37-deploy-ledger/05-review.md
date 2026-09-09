# 05-review — D18 per-entry deploy ledger (PR #46, issue #37)

- **Reviewer session:** `01a082b8-274b-7890-aa7a-ba7ae7f4d66a` (`pac-issue37-deploy-ledger-adr-d17`)
- **Model tier note:** reviewer = builder tier (`glm-5.3:cloud`, same session). The skill
  requires reviewer ≥ strongest worker — *equal* is allowed. The stronger gate is the
  fresh-context `premerge-review` pass (step 9): run it on the strongest available model.
- **Inputs:** contract = issue #37 (operator ratified **Option A** in-session) + SPEC §19
  (delivered by this same branch, commit `ccd4494`/`47c973d`); build = `git diff
  main...feat/issue-37-deploy-ledger` (18 files, +1244/−15). This was a retrofit invocation
  (no `.sota/` spec/build artifacts) — inputs adapted accordingly.
- **Process deviation (declared, precedent: `postiz-platform-parity-d16/05-review.md`):**
  PR #46 was already opened per `session-discipline` (PR abierto = estado mínimo de trabajo
  entregado) before this phase was invoked. The skill's never-push rule governs the
  sota-swarm authoring flow; the session contract takes precedence here. Corrections from
  this review or from `premerge-review` land as new commits on the same PR.

## Pass 1 — Spec fidelity (every acceptance criterion, evidence re-run)

| # | Criterion (issue #37 / SPEC §19) | Evidence | Verdict |
|---|---|---|---|
| 1 | `pac status` per entry: id · surface · published? · sync state | cli.test 'fresh workspace' + human smoke output (18 units, per-surface states, summary line) | ✅ |
| 2 | Stale detection, zero false positives on fresh workspace | core ledger.test 'fresh workspace: never everywhere, stale nowhere'; CLI same-named test; **adversarial spot-check re-run in this phase**: reorder keys + comment + flow-style reformat of a deployed bio → still `in-sync` (hash is over parsed data, not bytes) | ✅ |
| 3 | Template-origin flagged automatically | `origin: template` field; trackableUnits origin tests; template repo adoption = follow-up issue `profile-data-template#7` (declared out of scope — separate repo, session scope rule) | ✅ |
| 4 | Ledger keyed by entry id + surface + deployedAt + contentHash (Option A) | schema `deploymentRecord` (all three required) + `deployments` root; core `deployStatus` | ✅ |
| 5 | `CHECKLIST.md` becomes a generated view | `--write-checklist` regenerates with AUTO-GENERATED header; cli.test asserts header + 'In sync' section | ✅ |
| 6 | Stable ids on experience/publications/projects | + education/press (same row class, declared in §19.2); schema `entryId` on all 5; duplicate-id core check | ✅ |
| 7 | Only `pac` mutates the ledger (D14) | grep: no command other than `status` touches `deployments`; `refine --choose` writes `active.yaml` only; upsert preserves other surfaces | ✅ |
| 8 | Manual pastes confirmed via `--mark <entry> <surface>` | flag parse (exactly 1 positional in mark mode), exit codes 0/1/2, `--at` override | ✅ |
| 9 | Option B rejected with rationale | SPEC §19.4 (choosing ≠ deploying; two lifecycles; entry-centric queries first-class) | ✅ |

§19.1 details re-verified in code + tests: `source: manual|git|api` enum; dangling ledger
key → `removed` (test); ledger key pattern (core + schema-check fixture); 64-hex contentHash
(Zod pattern + fixture rejection); `deployedAt` date-time; one record per (ledgerKey, surface).
§19.2 key space: all 9 block prefixes + 3 bare root names — schema pattern and core
`LEDGER_KEY_PATTERN` verified **character-identical** (parity check re-run in this review).
§19.3: `refine --choose` never writes the ledger (grep: refine.ts touches `active.yaml` only).

## Pass 2 — Correctness (defect hunt on the diff)

- Staleness semantics: pure hash compare (no `pasco diff` intersection) — matches the
  hardened §19.1 rationale; edit→stale→re-mark→in-sync cycle proven in CLI tests.
- `--mark` error paths: unknown/untracked key (exit 1), bad surface (exit 2), invalid
  `--at` (exit 1) — all tested.
- Ledger integrity at load: duplicate id always fails; ambiguous composite key fails
  **only when addressed** (legacy workspaces with duplicate natural keys still validate —
  additivity); surface enum; key pattern — all tested + schema-check fixtures.
- Load with empty/comment-only `deployments.yaml` (the template stub): contributes nothing
  at load → validates clean (issue #7 stub design holds).
- No exec/eval/secrets; YAML parse bounded (`maxAliasCount`); writes confined to the
  workspace (`content/deployments.yaml`, `CHECKLIST.md`).

## Pass 3 — Coherence (single-writer seams)

- Ledger write pattern mirrors `refine.ts` (parse → mutate plain object → stringify) —
  consistent house style; no duplicated ledger helpers across commands.
- Naming/exit codes/help text consistent with the other 6 commands; `--json` envelope
  shape matches the house convention.
- Docs cross-checked: SPEC §19 ↔ schema/README ↔ USER-GUIDE §7/§8.1 ↔ cli/README all
  reference the same flags and key space.

## Findings

| # | Severity | Finding |
|---|---|---|
| 1 | NIT | `--mark` and `--write-checklist` cannot combine in one invocation (two sequential calls). Documented usage; no correctness impact. |
| 2 | NIT | `education`/`press` row enumeration shares the `ROW_CONFIG` loop with the tested blocks but has no direct key assertion in `ledger.test.ts`. Uniform code path; risk low. |
| 3 | NIT | `--mark` on a *removed* key reports "unknown or untracked ledger key" — could say "removed (unit no longer in content)". Message quality only. |
| 4 | NIT | Un-addressed duplicate composite rows (e.g. two identical-name skills) print duplicate unit lines in the report — accepted §19.2 design consequence (ambiguity fails only when addressed). |

No BLOCKER · no MAJOR. All four findings are cosmetic/coverage NITs; none touches
acceptance.

## Verdict

**PASS** (round 1). Spec fidelity: 9/9 acceptance criteria demonstrated with re-run
evidence; correctness: no defects found in the adversarial read; coherence: no seams.
The four NITs are recorded above as open risks, not correction blocks.

**Fresh-context gate (step 9):** the `premerge-review` handoff block is printed to the
operator — it runs READ-ONLY in a NEW session, receives only the diff + contract
(spec/issue/PRD, NOT this review), and its verdict is INFORMATIVE: this session
reconciles findings (contract-misread / actionable / accepted-trade-off / noise) and
owns any fixes.

**Feedback re-entry:** post-testing feedback from the operator re-enters as correction
commits on this branch (small findings, reconciled here) or a fresh `/sota-workflow`
round (large ones). Recorded per skill step 8.

## Fresh-context reconcile (premerge-review round 1)

The fresh session's report arrived after PASS; per step 10 it is DATA, not verdict —
each finding re-read against the diff before classifying. Four buckets:

| Finding | Class | Action |
|---|---|---|
| **F1 (BLOCKER)** — PR `CONFLICTING`/`DIRTY`: main advanced (PR #49 evidence registry, docs-only) touching CHANGELOG + SPEC | Valid + actionable (mechanic) | **Fixed**: rebased on `origin/main`. Deeper than reported: PR #49 added a *second* D17 (evidence registry) AND a second §18 — numbering collision on two axes. Merged side keeps the numbers; this branch renumbered the deploy-ledger decision **D17→D18** and its detail section **§18→§19** across SPEC, schema descriptions (+`gen:zod`), core/CLI comments, help, READMEs, USER-GUIDE, CHANGELOG. Conflicts resolved in `docs/SPEC.md` (§5 rows, §6 sketch+paragraphs, §18 sections) and `CHANGELOG.md` (both Added entries kept). |
| **F2 (MAJOR)** — `--mark` could persist an ambiguous composite key that the next `load()` rejects (tool writes a state it refuses to read). Reproduced in-session before fixing: exit 0 → written → validate FAILS | Valid + actionable | **Fixed**: `markDeployed` now refuses ambiguous keys (count of units sharing the key > 1 → exit 1, nothing persisted) — the write path upholds the same §19.2 invariant the read path enforces. Test: mark on duplicate bios → exit 1, no `deployments.yaml`, workspace still validates. **Self-review miss acknowledged:** the in-session pass had classified this as NIT-4 ("accepted design consequence") — the fresh pass correctly saw the write path makes it a real defect. |
| **F3 (NIT)** — `--mark` + `--write-checklist` silently ignored | Valid + actionable | **Fixed**: combination now rejected explicitly (exit 2, "mutually exclusive — run them sequentially"). Test added. |
| **F4 (NIT)** — `markDeployed` re-reads ledger without `maxAliasCount` | Valid + actionable | **Fixed**: `doc.toJS({ maxAliasCount: 100 })` — explicit, matches `readContentFiles`. |
| **F5 (NIT)** — removed-key message said "unknown or untracked" | Valid + actionable | **Fixed**: distinguishes removed (key in ledger, unit gone) from unknown/untracked; message names the audit trail. Test added. |

Buckets: **0 contract-misread · 5 valid+actionable (all fixed) · 0 accepted-trade-offs · 0 noise.**
The reviewer's surviving list (canonical hash, file mapping, pattern parity, state rollup,
`--at` handling) matches this session's own evidence. Suite after reconcile: **132 green**
(+3 premerge tests), typecheck clean, schema contract OK.

Loop-bound note (step 11): this was fresh round 1 with findings — fixes applied; a second
fresh invocation is optional for the operator (not required by the gate: no substantive
BLOCKER survived the fixes, and the loop escalates only on a second substantive round).