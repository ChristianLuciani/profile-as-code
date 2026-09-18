# 05-review.md — sota-review of PR #93 (release.yml → GitHub Release, issue #58)

Reviewer: in-session adversarial pass (skill `sota-review`).

**Model-routing gap declared:** session model = `deepseek-flash` (deepseek) — below the
skill's "strongest available" requirement (adversarial review routes UP; per
`model-routing` the frontier tier owns it), **and it is the session that authored the
code**. Same gap the `release-guard` round declared. Mitigation: the step-9 terminal
doubt pass runs as `premerge-review` in a fresh, clean session and reconciles here.

**Preconditions — partially unmet, declared:** this change did **not** run through
`/sota-workflow`, so there is no `.sota/<slug>/03-spec.md` nor `04-build.md`. Review
inputs are the issue and the repo's release contract:

- Contract: issue #58 (`## Esperado`, `## ADR-lite`), `docs/ci-cd.md`, the release
  rules in `repo-governance` / `session-discipline`.
- Build: commits `3cec63b` (feature), `35af037` (newline nit), `2b7672b` (correction
  round 1) + this artifact.
- Base: `main` @ `515767d`.

**Contract conflict declared (skill vs repo):** step 8 says "never push, never open the
PR yourself"; this repo's CONTRIBUTING §1–3 requires branch → push → PR, and
`session-discipline` §2 makes the open PR the minimum delivered state. More specific
contract wins (AGOS precedence). Flagged, not silently resolved — as in the
`release-guard` round.

## Pass 1 — Spec fidelity (issue #58) → PASS

| Acceptance item (issue) | Evidence |
|---|---|
| "(1) cree el GitHub Release `v<version>` con la sección correspondiente de `CHANGELOG.md` como notes" | `release` job (`release.yml:139`) checks out the verified commit, extracts with `release-notes.mjs`, `gh release create "v…" --notes-file … --verify-tag` (`release.yml:158`). Extractor run against the real `CHANGELOG.md`: `--version 0.1.0` → exit 0, 19 365 bytes of the `## [0.1.0]` section |
| "(2) opcionalmente adjunte el tarball `dist/`" | **Deliberately out of scope**, declared — the issue marks it optional ("artifact opcional, no requisito") and `verify:pack` already asserts the bin pre-publish. Recorded, not silently dropped |
| ADR-lite: "usar `gh release create` … elevar `contents: write` solo para el job de release" | Done: `contents: write` at job level on `release` only (`release.yml:146`); the publish job keeps `contents: read` + `id-token: write` |
| ADR-lite: "No mejorar el guard todavía" | Untouched (`release-guard.mjs` unchanged); #81's guard still runs first |
| Notes match the **shipped artifact**, not the runner's tree | Extracted from the same `needs.publish.outputs.commit` the publish job built |

Deviation recorded, deliberately **stronger** than the issue: the issue only asked for
the Release *after* publish; the review added a **pre-publish** validation (see F1).

## Pass 2 — Correctness → 2 findings (1 MAJOR fixed, 1 NIT fixed)

| Finding | Sev | Evidence / disposition |
|---|---|---|
| **F1 — the notes check ran only AFTER the irreversible publish.** `release.yml` runs the extractor at line 158 (in `release`, `needs: publish`); `npm publish` is line 130. A tag whose `CHANGELOG.md` lacks the version's section would consume the npm version and *then* fail, leaving the tag page empty — the exact symptom #58 exists to remove — and the `workflow_dispatch` retry cannot heal it (the section is still absent) | **MAJOR** | Reproduced the ordering from the file (`grep -n "npm publish\|release-notes.mjs"` → 130 before 158; no pre-publish invocation). **Fixed** (`2b7672b`): `Verify release notes exist for this version` (`release.yml:112`) runs the extractor before the `Publish` step, so a missing/empty section blocks the publish. Verified: `TAG=v0.1.0` → exit 0; `TAG=v9.9.9` → exit 1 |
| **F2 — the CLI main-guard compared path *spellings*, so a symlinked invocation silently exited 0.** `import.meta.url === pathToFileURL(process.argv[1]).href` is false when argv[1] is a symlink (or any non-identical spelling); `main()` never runs and the process exits **0** — a check that did not run reading as a check that passed, the #81 failure class | **NIT** (real but unreachable **as wired** — the workflow invokes by path) | Measured: `ln -s … /tmp/rn-link.mjs; node /tmp/rn-link.mjs --version 9.9.9` → **exit 0**, 0 bytes. **Fixed** (`2b7672b`): `isMainModule()` compares `realpathSync(process.argv[1])` to `fileURLToPath(import.meta.url)` (`release-notes.mjs:116–125`); re-measured → exit **1**. A test invokes through a symlink and asserts exit 1 (`release-notes.test.ts:157`) |
| NIT — `release.yml` ended without a POSIX newline (`\ No newline at end of file`) | NIT | Fixed (`35af037`), pre-existing but touched by this change |

**One invalid measurement produced and discarded before F2's fix stood** (recorded
because the pattern matters more than the result, per the `release-guard` precedent):
the first pre-publish simulation ran `TAG=v9.9.9 node … --version "${TAG#v}"` as a
single command — the `VAR=… cmd` prefix is not visible to the shell's own expansion,
so `${TAG#v}` was empty and **both** versions exited 2. That looked like a broken
step. Redone with `export TAG=…` first: `v0.1.0` → 0, `v9.9.9` → 1, which is the real
workflow behavior (the step sets `TAG` via `env:` and expands inside the `run:` shell).
A confident, wrong conclusion avoided by re-measuring.

Checked and clean: `### ` headings cannot terminate a section (the end rule is
`^## ` with a trailing space — `###` has `#` at index 2); a prefix version cannot match
(`headingPattern` is anchored and escaped); the repo's `CHANGELOG.md` has **no**
reference-style `[x]: url` link definitions at the bottom (verified: `grep '^\[.*\]:'`
→ none), so the last section cannot absorb them — noted as a robustness gap only if a
future changelog adds them; `--version` flows from the guard through `env:` and is
quoted, never interpolated into `run:` (no injection surface); `contents: write` is
job-scoped.

## Pass 3 — Coherence → PASS

- The one seam introduced — the extractor is now invoked **twice** (validate in
  `publish`, produce in `release`) — is named in the comment and both call sites use
  the identical `--version "${TAG#v}"`. Accepted NIT: the alternative (upload the
  notes as an artifact, download in `release`) removes the duplicate computation but
  adds two Actions steps; for a ~0.1 s file read the duplication is the cheaper
  trade-off. Not silently left: recorded here.
- File placement and failure style match `release-guard.mjs`, its sibling on the
  release path; exit codes 0/1/2 mirror the CLI contract documented in USER-GUIDE.
- No orphaned code: no leftover main-guard variant, no dead helper; the pre-publish
  step does not shadow the release job's extraction.
- `release` job `if: inputs.dry_run != true` mirrors the existing publish-job usage;
  on a dry run nothing is published and no tag/commit output exists.

## Verdict

**PASS — after 1 in-session correction round** (`2b7672b`: F1 + F2 + the newline nit).

- Gates at the correction tip: **280 tests** (CLI 77 incl. the 12 new, core 132,
  readme 40, org 19, markdown 12), `pnpm lint` clean, `pnpm typecheck` 5/5, build +
  `verify:pack` (via `pnpm test`). CI re-run pending on the new tip.
- Remaining: 0 open findings; 1 declared coverage gap (the pre-publish step is
  workflow YAML — reachable only on a real tag, not covered by a deterministic test;
  the underlying extractor *is* tested and was run for both the accept and reject
  versions by hand).
- **Doubt-theater guard:** satisfied — 1 MAJOR + 1 NIT, both reproduced with a
  measurement, one of them mine-by-design (I authored the hole), plus one invalid
  measurement caught and discarded. Not an always-green pass.
- Post-testing feedback re-enters as **correction blocks** (small findings); a large
  finding would warrant a fresh `/sota-workflow` round.

## Final gate — hand to a fresh session

`premerge-review` is available in this environment (skill present). Step-9 block
printed to the operator: a fresh, clean session, READ-ONLY, PR link only — this file's
findings and the authoring session's reasoning are deliberately **not** passed, so it
refutes independently. Result to be reconciled below.

## Fresh-context reconcile

_Pending — paste the `premerge-review` report here and the authoring session will
classify each finding (contract misread / valid+actionable / valid trade-off / noise)
and act._
