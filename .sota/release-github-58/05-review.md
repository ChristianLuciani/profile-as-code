# 05-review.md — sota-review of PR #93 (release.yml → GitHub Release, issue #58)

Reviewer: in-session adversarial pass (skill `sota-review`) + fresh-context reconcile.

**Model-routing gap declared:** the in-session pass ran on `deepseek-flash` (deepseek) —
below the skill's "strongest available" requirement (adversarial review routes UP; per
`model-routing` the frontier tier owns it), **and it is the session that authored the
code**. Same gap the `release-guard` round declared. Mitigation: the step-9 terminal
doubt pass ran as `premerge-review` in a fresh, clean session; its findings are
classified below.

**Preconditions — partially unmet, declared:** this change did **not** run through
`/sota-workflow`, so there is no `.sota/<slug>/03-spec.md` nor `04-build.md`. Review
inputs are the issue and the repo's release contract:

- Contract: issue #58 (`## Esperado`, `## ADR-lite`), `docs/ci-cd.md`, the release
  rules in `repo-governance` / `session-discipline`.
- Build commits: `3cec63b` (feature), `35af037` (newline nit), `2b7672b` (in-session
  correction round 1), the reconcile commit (fresh-context round: parser hardening + this artifact). Base: `main` @ `515767d`.

**Contract conflict declared (skill vs repo):** step 8 says "never push, never open the
PR yourself"; this repo's CONTRIBUTING §1–3 requires branch → push → PR, and
`session-discipline` §2 makes the open PR the minimum delivered state. More specific
contract wins (AGOS precedence). Flagged, not silently resolved — as in the
`release-guard` round.

> Line anchors below are relative to the **reconcile tip** (the reconcile commit), not the
> earlier commits; F6 of the fresh pass flagged stale anchors.

## Pass 1 — Spec fidelity (issue #58) → PASS

| Acceptance item (issue) | Evidence |
|---|---|
| "(1) cree el GitHub Release `v<version>` con la sección correspondiente de `CHANGELOG.md` como notes" | `release` job (`release.yml:139`) checks out the verified commit, extracts with `release-notes.mjs`, `gh release create "v…" --notes-file … --verify-tag` (`release.yml:160`, `:172`). Extractor against the real `CHANGELOG.md`: `--version 0.1.0` → exit 0, 19 365 bytes of the `## [0.1.0]` section |
| "(2) opcionalmente adjunte el tarball `dist/`" | **Deliberately out of scope**, declared — the issue marks it optional ("artifact opcional, no requisito") and `verify:pack` already asserts the bin pre-publish. Recorded, not silently dropped |
| ADR-lite: "usar `gh release create` … elevar `contents: write` solo para el job de release" | Done: `contents: write` at job level on `release` only (`release.yml:148`); the publish job keeps `contents: read` + `id-token: write` |
| ADR-lite: "No mejorar el guard todavía" | Untouched (`release-guard.mjs` unchanged); #81's guard still runs first |
| Notes match the **shipped artifact**, not the runner's tree | Extracted from the same `needs.publish.outputs.commit` the publish job built |

Deviations recorded, deliberately **stronger** than the issue: (a) a **pre-publish**
validation of the notes (issue asked only for post-publish); (b) fail-loud over silent
no-op in the extractor's main-guard.

## Pass 2 — Correctness → 2 findings (1 MAJOR, 1 NIT), both fixed in round 1

| Finding | Sev | Evidence / disposition |
|---|---|---|
| **F1 — the notes check ran only AFTER the irreversible publish.** `release.yml` runs the extractor at line 160 (in `release`, `needs: publish`); `npm publish` is line 130. A tag whose `CHANGELOG.md` lacks the version's section would consume the npm version and *then* fail, leaving the tag page empty — the exact symptom #58 exists to remove — and the `workflow_dispatch` retry cannot heal it (the section is still absent) | **MAJOR** | Reproduced the ordering from the file. **Fixed** (`2b7672b`): `Verify release notes exist for this version` (`release.yml:112`, run at `:115`) runs the extractor before the `Publish` step. Verified: `TAG=v0.1.0` → exit 0; `TAG=v9.9.9` → exit 1 |
| **F2 — the CLI main-guard compared path *spellings*, so a symlinked invocation silently exited 0.** `import.meta.url === pathToFileURL(process.argv[1]).href` is false when argv[1] is a symlink (or any non-identical spelling); `main()` never runs and the process exits **0** — a check that did not run reading as a check that passed, the #81 class | **NIT** (real but unreachable **as wired**) | Measured: `ln -s … /tmp/rn-link.mjs; node /tmp/rn-link.mjs --version 9.9.9` → **exit 0**, 0 bytes. **Fixed** (`2b7672b`, further tightened in the reconcile round): `isMainModule()` compares `realpathSync(entry)` to `fileURLToPath(import.meta.url)` (`release-notes.mjs:141–143`); re-measured → exit **1**. Test `release-notes.test.ts:212` |
| NIT — `release.yml` ended without a POSIX newline (`\ No newline at end of file`) | NIT | Fixed (`35af037`), pre-existing but touched by this change |

**One invalid measurement produced and discarded before F2's fix stood** (recorded
because the pattern matters more than the result, per the `release-guard` precedent):
the first pre-publish simulation ran `TAG=v9.9.9 node … --version "${TAG#v}"` as a
single command — the `VAR=… cmd` prefix is not visible to the shell's own expansion,
so `${TAG#v}` was empty and **both** versions exited 2. That looked like a broken
step. Redone with `export TAG=…` first: `v0.1.0` → 0, `v9.9.9` → 1, the real workflow
behavior (the step sets `TAG` via `env:` and expands inside the `run:` shell).

Checked and clean: `### ` headings cannot terminate a section (the end rule is
`^## ` with a trailing space); a prefix version cannot match (`headingPattern` is
anchored and escaped); `--version` flows from the guard through `env:` and is quoted,
never interpolated into `run:` (no injection surface); `contents: write` is job-scoped.

## Pass 3 — Coherence → PASS

- The one seam introduced — the extractor is invoked **twice** (validate in `publish`,
  produce in `release`) — is named in the comment and both call sites use the identical
  `--version "${TAG#v}"`. Accepted NIT: the alternative (upload the notes as an
  artifact) removes the duplicate read but adds two Actions steps; for a ~0.1 s file
  read the duplication is the cheaper trade-off. Recorded, not silently left.
- File placement and failure style match `release-guard.mjs`, its sibling on the
  release path; exit codes 0/1/2 mirror the CLI contract in USER-GUIDE.
- No orphaned code; naming/error style consistent across the two scripts.

## Verdict (in-session)

**PASS — after 1 in-session correction round** (`2b7672b`: F1 + F2 + the newline nit).

## Fresh-context reconcile

The `premerge-review` report came back as **PASS-CON-RIESGOS** (informative), produced
READ-ONLY by a fresh session that received only the diff + issue #58 — not this file or
the authoring reasoning. Its declared limits: it did not run the full suite, `actionlint`,
or the workflow event; it read only the PR's files. Each finding was **re-read against
the diff before classification** (rubber-stamping the reviewer is the same failure mode
as ignoring it).

| Fresh finding | Class | Re-verified? | Action |
|---|---|---|---|
| **F1 (MAJOR)** — the `v0.1.0` page is built from `## [0.1.0]`, which omits everything under `[Unreleased]`; the release-preparation step is undocumented, and the pre-publish check cannot detect staleness | **Valid + actionable** (as process/docs) | **Yes.** `release-notes.mjs --version 0.1.0 \| grep -c "issue #58"` → **0**; `[Unreleased]` is non-empty at HEAD; no release checklist in `docs/ci-cd.md` or `CONTRIBUTING.md`. The extractor faithfully implements the issue's letter — the gap is the surrounding process | **Documented** a "Preparing a release" runbook in `docs/ci-cd.md` (bump `package.json`, move `[Unreleased]` → `## [<version>] - <date>`, keep `### Planned` under `[Unreleased]`). A **mechanical freshness gate** ("fail if `[Unreleased]` non-empty") was **rejected** — the repo keeps a `### Planned (roadmap)` block under `[Unreleased]` by design, so it would fail correctly prepared releases. Recorded as an accepted trade-off (below) |
| **F2 (NIT)** — the section terminator is fence-unaware; a `## ` line inside ``` ``` ``` truncates the notes silently, exit 0 | **Valid + actionable** | **Yes** — reproduced with the reviewer's synthetic CHANGELOG: output ended at the fence, `- real note two` lost | **Fixed**: fence tracking in `extractReleaseNotes` (`release-notes.mjs:92–101`); test `:112`. Re-run: fence content **and** post-fence content retained |
| **F3 (NIT)** — trailing Keep-a-Changelog reference definitions (`[x]: url`) are absorbed into the last section | **Valid + actionable** (latent) | **Yes** — reproduced with a synthetic CHANGELOG; confirmed the real repo has none today (`grep '^\[.*\]:'` → none) | **Fixed**: stop at `^\[…\]:( )` outside fences (`release-notes.mjs:107`); test `:139`. Re-run: 0 definitions in output |
| **F4 (NIT)** — `isMainModule()`'s `catch → return false` turns an unresolvable entry into a silent exit 0 | **Valid + actionable** (unreachable, wrong fail-direction) | **Yes** — read the code; the reviewer also found no reachable path, which is why it stayed a NIT | **Fixed**: removed the `catch` — a resolution failure now throws (loud, non-zero) instead of reading as "ran and passed" (`release-notes.mjs:141–143`) |
| **F5 (NIT)** — `--version=1.0.0` is rejected as an unknown argument | **Valid + actionable** | **Yes** — reproduced: exit 2 | **Fixed**: `--key=value` support (`release-notes.mjs:56–65`); test `:202`. Re-run: exit 0 |
| **F6 (NIT)** — the committed artifact had an unresolved "Pending" section and stale line anchors | **Valid + actionable** | **Yes** | **Fixed**: this section fills the placeholder; anchors updated to the reconcile tip |
| **Assumption** — `if: inputs.dry_run != true` on a `push` was never exercised (no `v*` tag ever pushed) | **Valid + actionable** (robustness) | **Yes** — the push branch is unproven; I had mirrored the pre-existing `publish` pattern | **Removed the dependency from my additions**: the pre-publish step gates on `steps.guard.outputs.tag != ''` and the release job on `needs.publish.outputs.tag != ''` — self-evidently correct without the `inputs` context. The pre-existing `publish` usages are out of scope |

**Buckets:** contract misreads **0** · valid + actionable **7** · valid trade-offs **1** ·
noise **0**.

- **Accepted trade-off (visible, not silent):** no mechanical gate rejects a non-empty
  `[Unreleased]` at tag time. Cost of the gate (false failures on the intentional
  `### Planned (roadmap)` block) exceeds the cost of the residual risk (a release page
  that omits fresh entries if the operator skips the runbook). Mitigated by the new
  `docs/ci-cd.md` preparation checklist.
- **Not covered by a deterministic test, declared:** the pre-publish validation step and
  the release job are workflow YAML — reachable only on a real tag push, so they are not
  covered by a unit test. The underlying extractor is tested (15 cases) and both step
  conditions were verified by hand.
- **Inherited, declared:** the pre-existing `publish` job still uses `inputs.dry_run`;
  that is #42/#43's code, not this change's.
- **Loop bound:** 1 fresh round; all findings actionable and addressed or explicitly
  traded off → gate met.
- **Doubt-theater guard:** the fresh pass produced a MAJOR (F1) + five NITs + one
  assumption the in-session pass did not reach, all real — not an always-green pipeline.

## Final verdict

**PASS — rounds: 2** (1 in-session correction + 1 fresh-context reconcile, all findings
actionable and fixed or explicitly traded off).

- Gates at the reconcile tip: **283 tests** (CLI 80 incl. the 15 new; core 132;
  markdown 12; github-readme 40; github-org 19), `pnpm lint` clean, `pnpm typecheck` 5/5,
  build + `verify:pack` (via `pnpm test`), workflow YAML parses.
- Remaining: **0 open findings**; 1 accepted trade-off (no `[Unreleased]` freshness gate);
  1 declared coverage gap (workflow YAML not unit-tested); 1 inherited assumption
  (pre-existing `publish` uses `inputs.dry_run`).
- Post-testing feedback re-enters as **correction blocks** (small findings); a large
  finding would warrant a fresh `/sota-workflow` round. Recorded path: **correction
  blocks**.

## Final gate — handed to a fresh session

`premerge-review` is available in this environment; the step-9 block was printed to the
operator (fresh, clean session, READ-ONLY, PR link only — this file's findings and the
authoring reasoning were deliberately NOT passed). The fresh report is reconciled
above.
