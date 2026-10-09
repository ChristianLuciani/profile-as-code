# 05-review.md — sota-review of issue #149 (link gate), PR #178

Reviewer: in-session adversarial pass (skill `sota-review`) + one fresh-context
round (`premerge-review`, published as a PR comment). Merged as `7516de3`.

**Model-routing gap declared:** session model = `deepseek-flash` (dsh) — the
session that authored the gate is also the model that reviewed it, so the
reviewer equals but cannot outrank the builder (skill step 2). The mitigation was
the step-10 terminal doubt pass: `premerge-review` in a fresh, clean session,
whose report is a PR comment and whose findings reconcile below.

**Preconditions — partially unmet, declared:** this change did **not** run
through `/sota-workflow`, so there is no `.sota/<slug>/03-spec.md` nor
`04-build.md`. Review inputs, substituted explicitly:

- Contract: issue #149 (repro · `## Esperado` · acceptance criteria · "Archivos
  sospechosos" · ADR-lite) + repo rules (AGENTS.md, dev-methodology, D8).
- Build: branch `dsh/issue-149/link-check`, commits `94b96c7` → `6778476`,
  base `main` @ `eb59c3f`; PR #178 (opened before this phase — see conflict).
- Fresh report: PR #178 comment `#issuecomment-6084053167`, head `22d5608`.

**Contract conflict declared (skill vs repo):** skill step 9 says "never push,
never open the PR yourself"; this repo's `session-discipline` §2 makes the open
PR the minimum delivered state — the PR was opened by the authoring session, as
in the PR #79 / #83 precedent. Flagged, not silently resolved.

## In-session pass — four passes, verdict PASS

- **Spec fidelity:** every acceptance criterion demonstrated by reproducible
  evidence (checker + self-test exist; the deliberately broken relative-link
  fixture fails; CI wires the gate; allowlist explicit with removal trigger;
  STANDARDS community item 5 ⚠️→✅ dated, item 3 untouched). No criterion
  claimed without evidence.
- **Correctness:** traversal escapes caught (`E-LINK-ESCAPES`), unparsed link
  shapes fail closed (`E-GATE`), fences/inline code masked; no network/exec in
  the gate.
- **Coherence:** single author, one rule vocabulary, `check()` shared by the
  self-test and the CLI; no shared module touched.
- **Anti-trim:** mechanical scan over the deleted lines of the diff, canonical
  `loss_pat` from `premerge-review` §Anti-trim — **0 normative-marker
  deletions**, so no `Trim:` declaration required. (The projection was verified
  current: the sibling carries `§Anti-trim pass`.)

## Fresh-context round 1 — verdict PASS-CON-RIESGOS

`head_sha: 22d5608` · findings `{blocker: 0, major: 2, nit: 4}` · anti-trim
clean. The report is **data**; each finding was re-read against the diff and
against the reference implementation before classifying.

| # | Finding | Class | Disposition (`6778476`) |
|---|---|---|---|
| F1 | `SCOPE` narrower than "todo Markdown trackeado"; `GOVERNANCE.md`/`CHANGELOG.md` unchecked | Valid + actionable (contract ambiguous) | Widened to every tracked, non-hidden doc area: root `*.md` + `schema/`. Hidden trees (`.github/`, `.sota/`) excluded **by decision and documented**. Verified: a broken link in `GOVERNANCE.md` now fails. |
| F2 | Slugger diverges from GitHub (kept `_`, collapsed ` / ` to one `-`) | Valid + actionable (core); **two sub-premises refuted** | Space rule ported from `github-slugger@2.0.0` (each space → `-`, no collapse, no trim). Oracle-verified **0 mismatches over 346 headings**; expected anchors committed as `slug-oracle.json` and asserted by the self-test. Refuted: `_` **is kept** by the reference (U+005F is not in its regex); the `content/<file>.yaml` example is a **fenced code line, not a heading** (the reviewer's extraction counted fences, inflating the count). |
| F3 | Unguarded `statSync` → stack trace instead of `E-GATE` | Valid + actionable | Guarded; failure is an explicit `E-GATE`. |
| F4 | Allowlist accepted any scheme as a "private target" | Valid + actionable | Requires `^https?://`; fixture `fail-allowlist-bad-scheme`. |
| F5 | "fixture self-test runs first" ambiguous | Valid + actionable | Reworded: "the link-gate fixture self-test runs first (within the step)". |
| F6 | Fragment on a directory silently ignored | Valid + actionable | Now an explicit `E-ANCHOR-MISSING`; fixture `fail-fragment-on-directory`. |

No finding was deferred or dismissed; no accepted risks. Doubt-theater guard not
tripped (findings were substantive and actionable).

## Post-merge reconciliation (real SHA)

- Merge commit `7516de3` (true merge, parents `0244cd0` + `6778476`) merged
  2026-10-09T16:01:13Z; #149 **CLOSED/COMPLETED**. All three commits are
  ancestors of `main` with `Session-Id: e99071cf-92ef-4fdd-b634-d8b84da5a1fc`
  intact (merge method preserved trailers); the PR body also carries the
  signature.
- **#176** was already CLOSED/COMPLETED (15:19Z, PR #177 `ab4e597`); the feared
  one-line conflict did not materialize — `main`'s gate list reads 1 schema self-test
  → 2 Documentation link gate → 3 TypeScript workspace (renderer-map entry inside),
  coherent and in order.
- **Second fresh pass skipped by the merge** — the terminal doubt gate for head
  `6778476` did not run; recorded, not green. Operator decision.
- **Drift, accepted:** `docs/STANDARDS.md` item 5 records **46 files, 86 links**
  (dated 2026-10-09, measured on the branch); `main` measures **47 files,
  82 links** because #179 added `packages/paste/README.md` and re-homed renderer
  links. Kept as an explicitly dated snapshot, per this file's convention
  (operator decision, 2026-10-09). Post-merge gate on `main`: **PASS**, self-test
  **15/15**.

---

Session-Id: e99071cf-92ef-4fdd-b634-d8b84da5a1fc
Session-Name: dsh-issue-149-link-check
Models: deepseek-flash
