# 05-review.md — sota-review of PR #107 (prep v0.2.0, CHANGELOG + version bump)

Reviewer: in-session adversarial pass (skill `sota-review`). **Fresh-context reconcile: pending.**

**Model-routing gap declared (blocker for the skill's letter, not for the change):** the
in-session pass ran on `deepseek-flash` (deepseek) — below the skill's "strongest available"
requirement (adversarial review routes UP; per `model-routing` the frontier tier owns it) — **and
this is the session that authored the change.** Same gap declared in the `release-github-58` and
`release-guard` rounds. Mitigation: the step-9 terminal doubt pass is requested as
`premerge-review` in a fresh, clean session; its findings get classified below under `## Fresh-context
reconcile`.

**Preconditions — partially unmet, declared:** this change did **not** run through
`/sota-workflow`, so there is no `.sota/<slug>/03-spec.md` nor `04-build.md`. Review inputs are the
repo's release contract and the operator's decisions:

- Contract: `docs/ci-cd.md` §"Preparing a release (do this before tagging)" (the 3 numbered steps) +
  `docs/STANDARDS.md` item 3 + `repo-governance` / `session-discipline`.
- Operator decisions (this session, explicit): `#104` merges first; version is `0.2.0`.
- Build commit: `5245bd6`. Base: `main` @ `e794e0f` (post-#104).

**Contract conflict declared (skill vs repo):** step 8 says "never push, never open the PR
yourself"; this repo's CONTRIBUTING §1–3 requires branch → push → PR and `session-discipline` §2
makes the open PR the minimum delivered state. More specific contract wins (AGOS precedence).
Flagged, not silently resolved — as in the two previous rounds.

> Anchors relative to `5245bd6`.

## Pass 1 — Spec fidelity (release runbook) → PASS, one deviation declared

| Runbook step / decision | Evidence |
|---|---|
| (1) "Bump `packages/cli/package.json` version (the tag must equal it)" | `packages/cli/package.json:3` → `0.2.0`. Guard enforces the equality: `release-guard.mjs:220` (tag push), `:156–163` (tagged tree vs expected) |
| (2) "Move the release-worthy `[Unreleased]` entries under a new `## [<version>] - <date>`; keep forward-looking `### Planned` items under `[Unreleased]`" | section split verified by heading map: `10 ## [Unreleased]` → `12 ### Planned (roadmap)` → `19 ## [0.2.0] - 2026-09-24` → `163 ## [0.1.0]`. Extractores: `--version 0.2.0` → 141 líneas no vacías; `--version 0.1.0` → su propia sección; `--version 9.9.9` → exit 1 (falla cerrado) |
| (3) "Commit that preparation to `main`, then `git tag`" | **Deviation declared:** commit va a branch + PR (`pi/release-v0.2.0-prep`), no a `main` — `repo-governance` §4 prohíbe trabajar en main y el contrato más específico gana. El tag queda explícitamente fuera: es acción del operador (tag push = publish). `git tag` en `origin` sigue vacío (`git ls-remote --tags` → ∅) |
| Operator decision: `#104` first | base `e794e0f` = merge de #104 |
| Operator decision: `0.2.0` | justified by evidence, not by preference: 56 commits since the 0.1.0 prep (`a56a3a6`) and the set carries contract changes (`schema v1.6 links[].role`, empty-semantics family, a rendered-output change) — the CHANGELOG header allows breaking contract changes in pre-1.0 minors |
| Every entry moved into `0.2.0` is actually merged | 7 entries ↔ 7 merged PRs: #103→#104, #58→#93, #59→#88, #80→#94, #86→#87, #84→#85, #78→#83 |

No acceptance item is claimed without reproducible evidence. **Explicit non-goals** (declared, not
dropped): the other four manifests stay at `0.1.0` (unpublished, inlined by tsup → inert); the
`pnpm typecheck`-not-in-CI gap and the stale test counts in `docs/STANDARDS.md` belong to #100.

## Pass 2 — Correctness → 2 findings (both Required, both fixed) + 1 verification gap closed

| Finding | Sev | Evidence / disposition |
|---|---|---|
| **F1 — the PR/commit description claimed "304 tests / 16 files"; the real count is 17 files.** I carried the file count over from the pre-#104 audit run and did not recompute after #104 added `packages/renderers/github-readme/tests/role.test.ts`. Real: `1+10+1+2+3 = 17`. The test count (304) was correct | **MAJOR** (in the artifact that survives the merge: the PR body) | Measured per package. **Fixed:** commit amended (`0da32a9` → `5245bd6`) + PR body edited. In this repo a wrong number in the delivered surface is not cosmetic — #100 exists for exactly this class |
| **F2 — "ninguna aserción cambió" was literally false.** One literal changed: `toContain("tag=v0.1.0")` → ``toContain(`tag=${TAG}`)`` | **NIT** (claim precision) | The invariant is identical, but the claim as written said *none*, and a reader finds one. **Fixed:** reworded to "no assertion was weakened", naming the literal, and backed by mutation instead of by reading |
| **Verification gap (closed):** "the suite still bites" was an assertion, not evidence | — | **Mutation-tested** `release-guard.mjs`: (a) kill `pushed !== version` (`:220` → `if (false)`) → fails `REFUSES a tag whose name disagrees with the manifest`; (b) identity → ancestry (`:234`) = the #81 regression → fails `behind the tip — the #81 repro` and `never landed on the branch`. Guard restored, `git diff` clean on that file. The version-derivation change did **not** weaken protection |
| Date convention | — | Verified, not assumed: the 0.1.0 prep commit is `2026-09-15T14:05:35-05:00` and the CHANGELOG says `2026-09-15` → **local date of the prep commit**; `5245bd6` is `2026-09-24T19:17:06-05:00` → `2026-09-24` is consistent. No change |

## Pass 3 — Coherence (the seam hunt) → 2 NITs, no seam

The class of defect this change exists to fix (a test coupled to live repo state) was hunted across
the workspace, not assumed absent:

| Surface | Verdict |
|---|---|
| `packages/cli/tests/release-notes.test.ts` | ✅ Self-contained fixture `CHANGELOG` (`:23`) — does **not** read the real CHANGELOG. `0.2.0` already among its cases (`:86`). Release-proof |
| `packages/cli/scripts/verify-pack.mjs:71` | ✅ Reads the manifest **inside the packed tarball**, not the repo — correct, release-proof |
| Docs surfaces naming the first-publish version | ✅ 4 reconciled in this PR: `docs/ci-cd.md` §One-time setup (the runbook followed at the irreversible step), `release.yml` ×3 comments, `docs/STANDARDS.md` "to go public". No fifth surface found |
| `release-guard.mjs` `--help` (`:173`, `:180`) | NIT — still shows `v0.1.0` as the illustrative example. It is an example, not a claim; left on purpose |
| `.github/ISSUE_TEMPLATE/bug_report.yml:14` | NIT — placeholder still `"v0.1.0 / 3ceaeb8"`. Now traces a version that will never exist. One-line fix or make it generic (`<version> / <sha>`); deliberately out of this PR's scope |
| `docs/USER-GUIDE.md` §2 npm-status note | NIT — asserts "installing from source is the only path today"; false the moment the operator runs the documented publish. Covered in spirit by #105's acceptance criterion 1 ("a user with no repo clone can install… following only `docs/USER-GUIDE.md`"), though not by its named blocks |

No cross-block inconsistency (this change was not a parallel swarm build): one author, one logical
change, single commit.

## MAJOR — decision required before the tag push (not a defect of the diff)

**D1 — v0.2.0 is the FIRST published version, and its release notes omit everything recorded under
`## [0.1.0]` — including user-facing work that ships for the first time in 0.2.0.**

Evidence:
- `v0.1.0` was prepped on 2026-09-15T19:05:35Z but never tagged (`git ls-remote --tags origin` → ∅),
  and after this change it is **no longer publishable**: `release-guard.mjs:220` refuses
  `v0.1.0` against a `0.2.0` manifest — reproduced, `exit=1`, message *"the pushed tag is v0.1.0 but
  this package is 0.2.0"*. So `## [0.1.0]` describes a version that will never exist on npm.
- That section is not stale history: it carries the CommonMark-safety work for the renderers
  (`CHANGELOG.md:338`, `:391`, `:397`, issues #75/#76 — PR #79 merged 2026-09-15T22:11Z, i.e.
  **after** the 0.1.0 prep). That code ships for the first time in v0.2.0.
- The release page is built from the `## [0.2.0]` section alone (`release.yml`,
  `release-notes.mjs` — exact-match extraction). Therefore the first release page of this product
  will not mention the CommonMark fixes that the first published artifact contains.

Options (operator's call — it changes what the product's first release page says):

1. **One-line note at the top of `## [0.2.0]`** — "First published version. v0.1.0 was prepared but
   never tagged; this version contains everything in the `[0.1.0]` section plus the changes below."
   Preserves history, removes the false impression, no restructuring. **Recommended.**
2. Fold `## [0.1.0]`'s content into `## [0.2.0]` (rename/merge) — the first release page becomes the
   complete description; loses the internal milestone. Since 0.1.0 never existed publicly, nothing
   external is lost.
3. Accept as-is and record the accepted risk here — the first release page is a delta from a
   never-shipped version.

Not applied unilaterally: it is release content that gets published irreversibly, and the operator
decides the artifact's public story. Ready to apply (1 line) on request before merge.

**Risk (owned by #105, restated so it is not lost):** `release.yml:139` documents that npm omits the
provenance attestation when the source repo is private. Publishing while `profile-as-code` is
private permanently loses that trust signal for the first version, and #105 makes the ordering
decision (public-first vs publish-private) an explicit acceptance criterion **before** the first tag
push. This PR does not change any doc that contradicts it, but the tag push must not happen before
that decision is recorded. (Evidence inherited from the repo's own documented fact, dated in
`release.yml`; not re-fetched online in this pass.)

## Verdict

**PASS (in-session), with 1 open decision (D1) for the operator's tag step. 0 BLOCKERs.**
2 Required findings raised by this review — both in this change's own description, not in its code —
were fixed before hand-off.

The change does what the runbook asks, the version bump is evidence-justified, the guard suite is
proven still-adversarial by mutation, and the class of coupling it fixed does not recur elsewhere in
the workspace (scanned, not assumed).

**Doubt guard:** not always-green — the in-session pass produced 2 Required + 1 MAJOR. The always-
green failure mode does not apply at this stage.

**Pending:** fresh-context reconcile (`premerge-review`, step 9). Findings will be classified here
under `## Fresh-context reconcile` when the report arrives.

**Path for the operator's post-testing feedback:** small findings → correction blocks (this file +
a fix commit on `pi/release-v0.2.0-prep`); large ones → a fresh `/sota-workflow` round.

## Fresh-context reconcile

Fresh pass: `premerge-review` in a clean session, report published on the PR as a comment
(`#issuecomment-5825296455`), reviewed head `5245bd6`. Verdict **PASS-CON-RIESGOS**, 0 blocker /
2 major / 4 nit. The reviewer did **not** receive this file's findings (doubt rule respected) — it
was written but deliberately kept uncommitted until this round.

Every finding was re-read against the diff before classifying. Nothing was rubber-stamped, and
nothing was waved off.

### Bucket 1 — Contract misread
None.

### Bucket 2 — Valid + actionable (6/6 applied)

| Fresh finding | Sev | My verification | Fix |
|---|---|---|---|
| **F1 — a fifth surface still named `v0.1.0` as the first publish**, and *this* one ships: `CHANGELOG.md:97`, inside `## [0.2.0]`, which the extractor turns into the v0.2.0 GitHub Release body | **MAJOR** | Confirmed independently: the line sits in the 0.2.0 range (19–162) and `release-notes.mjs --version 0.2.0 \| grep -c v0.1.0` returned **1**. My "four surfaces" sweep missed the only one that gets published — the PR's own claim ("una versión nombrada en cuatro superficies no puede driftear") was falsified by the PR itself | Reworded to name no version at all ("el que corre antes de que el paquete exista…") — the sentence describes a *position in the sequence*, so any version there drifts at every prep. Re-verified: `grep -c` → **0** |
| **F2 — `docs/ci-cd.md:135` claimed issue #44 "reserved the `pasco` bin name"** | **MAJOR** | Confirmed by reading #44's own body: *"La reserva en npm es **first-come-first-served** — no existe mecanismo de reservar sin publicar"*. #44 is `COMPLETED` (2026-09-15) with its acceptance unmet by construction. I asserted another issue's semantics without reading it | Rewritten: the publish *is* what claims the bin; #44 closed with its reservation task void, with the source cited |
| **N1 — `bug_report.yml:14` placeholder `v0.1.0 / 3ceaeb8`** | NIT | A stale example that now traces a version that will never exist | Changed to `v<version> / <commit-sha>` — **policy change on my part:** I had deliberately left it ("example, not a claim"); a second independent flag + a one-line cost beats defending the drift |
| **N2 — `release-guard.mjs` `--help` examples said `v0.1.0`** | NIT | Same reasoning | `v1.2.3` (obviously generic, drift-proof). `--help` re-run, suite 16/16 |
| **N3 — `STANDARDS.md:32` dropped the date from the no-tag/unpublished assertion** | NIT | Confirmed a self-inflicted regression: I moved the date onto the new "prep landed" clause and left "no tag / unpublished" undated, while the file's own header demands *"a claim without source + date does not belong here"* | Both clauses dated (`2026-09-24`) |
| **N4 — two PR-body numbers did not reproduce** | NIT | Both confirmed, and **the "56 commits" is a third instance of the same defect class**: computed before #104 merged, never recomputed — it is **58** today (`git rev-list --count a56a3a6..origin/main`, 43 non-merge). "141 non-empty lines" was 141 *total* / **130** non-empty | PR body now states each number with the command that regenerates it |

**Pattern named (this is the actual lesson):** three of the defects in this change — `16 files`,
`56 commits`, and the "141 non-empty" adjective — are the *same* failure: a number computed once and
reused after the tree moved. The fix is procedural, not typographic: **recompute at the moment of
writing, and ship the command with the number.** The F1 miss is the same class one level up: I swept
the surfaces *I* had touched by hand instead of sweeping the artifact for the claim.

### Bucket 3 — Valid trade-off (2, recorded not dropped)

1. **`268 tests green` inside the 0.2.0 section is left as-is.** It is not a claim about this
   release: it is the verification story of the one-time formatter baseline PR #88 applied ("byte-stable
   behavior verified: 268 tests green" at that change's time), sitting inside that change's entry.
   Editing another change's evidence inside a version prep would weaken the historical record, and
   the repo-wide stale-count refresh is #100's. **Accepted risk:** a reader of the release body may
   read `268` as the current suite size. Cost of the alternative (rewriting another entry's
   verification) exceeds the cost of the confusion.
2. **The guard's residual coupling stays out of this PR** (my own in-session finding, unchanged by
   the fresh pass): the tag-push path still compares the tag against the **checkout's** manifest, which
   is why the suite had to be made version-dependent at all. Removing it means touching a
   safety-critical guard inside a release prep. Deferred to a follow-up issue, not silently kept.

### Bucket 4 — Noise
None substantive. The reviewer's alternative counts (60 / 44 / 17) are different ranges than mine
(`PREP^..`, merge-base variants); the *complaint* was valid anyway, because my number reproduced
under no range I can reconstruct from the PR body. That is precisely why the fix is to ship the command.

### Still open (authoring session's duty, operator's decision)
- **D1 — the first published version's notes omit everything under `## [0.1.0]`** (which never shipped
  and is now unpublishable; it carries the CommonMark work of #75/#76). The fresh session could not
  see this — correctly, it had no access to my findings. Still awaiting the operator's choice;
  recommendation unchanged (one-line "first published version" note at the top of `## [0.2.0]`).

### Loop bound and doubt guard
0 BLOCKERs → no correction round against a spec, no second fresh invocation mandated. Every fresh
finding mapped to an action or a recorded acceptance: nothing was classified as noise to make the
pipeline look green. The gate is met.

**Remaining decision for the operator:** whether to spend one more fresh pass on the corrected head.
The findings were all claim/doc defects (memory: this is the class a fresh sweep owns), so a second
pass has real, if modest, marginal value — recommended only if the operator wants the sweep itself
re-verified rather than the fixes.
