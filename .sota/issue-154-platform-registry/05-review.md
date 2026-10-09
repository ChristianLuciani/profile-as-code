# 05 — SOTA review: platform registry (#154)

- **Work:** PR #180, branch `dsh/issue-154/platform-registry`, base `origin/main` (`eb59c3f` at start; main has since advanced).
- **Contract:** GitHub issue #154 (`gh issue view 154`) + the operator's ratified route (issue comment, 2026-10-07). **No `.sota/issue-154-*/03-spec.md` or `04-build.md` exist** — this work was a direct agent session on the issue, not a `sota-swarm` build. The issue body IS the spec here; this substitution is declared, not improvised.
- **Model routing caveat:** worker and reviewer are both `deepseek-flash`, so this in-session pass does NOT outrank the builder. The genuinely-independent pass is `premerge-review` in a fresh session (handoff at the end).
- **Verdict: PASS** — after 1 in-session correction round and 1 reconcile round (fresh-context `PASS-CON-RIESGOS`). 0 BLOCKER; 2 MAJOR + 2 NIT found, all resolved or recorded as accepted risk.

## Round 1 — findings

### MAJOR — spec fidelity: the ratified `status: member|backlog` field was absent
`platforms/registry.yaml` had no `status` per entry (union of keys: deploy, family,
fixture, handle_hosts, hosts, issue, note, origin, renderer, since, sources,
subdomain_hosts). The operator's ratified route enumerates `status (member|backlog)` as
registry-owned, and #154's Expected shows `status: member`. The member/backlog distinction
existed only implicitly (presence in `platforms` vs. `families.<id>.backlog`). **Correction:**
all 49 enum members carry `status: member`; the 7 backlog slugs (gofundme, freelancer,
workana, fiverr, infojobs, computrabajo, indeed) are now registry entries with
`status: backlog` + `family` + `note` + `sources`; `families.*.backlog` removed. Generator,
`check.py` and the self-test branch on `status`.

### MAJOR — coherence: normative rationale deleted without a new home
The #154 change deleted 177 lines from `drift.ts`, including the normative comment block
explaining **why** four platforms have no `HANDLE_HOSTS` entry (lemmy federated; gmb surface
varies / login-only dashboard; ghost self-hosted; listmonk self-hosted) and the
**hotmart apex-only** provenance (`space.hotmart.com` resolves but apex-redirects). The
mechanical anti-trim scan did NOT flag these (no marker token), so this is a coherence
finding, not an anti-trim BLOCKER. **Correction:** the any-host rationale is re-homed in
`drift.ts` (where `hostMatchesPlatform` returns `true` for an absent key); the hotmart
apex-only note is re-homed as a comment on the registry entry (the data home).

### NIT / open risks (not blocking)
- **`deploy` is `manual` for the 41 platforms with no renderer** (documented D9 default) and
  `api` is never used — for non-renderer platforms `deploy` restates the default rather than
  carrying per-platform evidence. Remedy if the evidence rule should bind it: make `deploy`
  optional and require it only where a renderer exists (cross-checked vs `pasco.deploySpec`)
  or where verified.
- **README generates the status *counts* but not the renderer/skill lists** — faithful to the
  ratified "counts del status table", narrower than #154's surface table (which lists the
  lists as hand-edited).
- **`PASTE_PLATFORMS` is exported from core's public index** (test enumeration on the public
  API). Justified by #154's "test enumerations derive from the registry"; flagged for a
  future API review.

## Anti-trim pass (mechanical)
Deleted lines of `git diff origin/main...HEAD` scanned with the canon regex from
`premerge-review/SKILL.md` §Anti-trim (the sibling projection carries it — resolved via
trace (a)). Matches and traces:

| deleted line (marker) | token | trace |
|---|---|---|
| `const PLATFORM_HOSTS: readonly string[] = [` | `PLATFORM_HOSTS` | survives in `packages/core/src/generated/platforms.gen.ts` |
| `const PLATFORM_SUBDOMAIN_HOSTS: … = [` | `PLATFORM_SUBDOMAIN_HOSTS` | survives (same file) |
| `const HANDLE_HOSTS: … = [` | `HANDLE_HOSTS` | survives (same file) |
| `import { PLATFORM_VALUES, … }` / `PLATFORMS = PLATFORM_VALUES` | `PLATFORM_VALUES` | survives in `schema.zod.ts` |
| 6 comment lines naming the same tokens | same | survive (same files) |

**Trace-1 surface note:** the canon lists trace-1 surfaces for skills-studio and
prompt-studio; this repo (profile-as-code) is neither. The clear structural analog is the
registry (`platforms/registry.yaml`) and its projection (`platforms.gen.ts`) — every matched
token survives there. **No undeclared trim ⇒ no anti-trim BLOCKER.**

## Round 2 — re-review
- Spec fidelity: `status` present and load-bearing; member set == enum (49), backlog ∉ enum
  (7); `check.py` asserts it. **PASS.**
- Coherence: deleted rationale re-homed. **PASS.**
- Correctness: generator/self-test/check.py re-run; no defect found.
- Anti-trim: unchanged (no new normative deletions).

Evidence (round 2):
```
node scripts/gen-platforms/gen.mjs --check   → in sync (49 platforms, 8 renderer(s), 4 skill(s))
node scripts/gen-platforms/test.mjs          → 25/25
python3 scripts/schema-check/check.py        → schema contract OK
   PASS: registry covers $defs/platform.enum (49 members, 7 backlog)
pnpm lint · build · typecheck · test         → green
renderer-map --check                          → in sync
```
The regenerated SPEC family table is **byte-identical** to the hand-authored one it replaces
(members + backlog cells), confirming the registry→docs projection preserves the curated order.

## Fresh-context reconcile

The fresh pass was executed by a session with no prior context on this repo/PR (operator
clarification: they *were* the fresh session — a separate harness was not spawned; the
fresh-context requirement was functionally satisfied). Report: PR #180 comment #6084073447,
verdict `PASS-CON-RIESGOS` (informative). Classified per sota-review §11:

| # | Fresh finding | Class | Action |
|---|---|---|---|
| F1 | MAJOR — `check.py` asserted only the SPEC arithmetic, never the family-table body; a mutated/reordered row passed the Python gate (the node gate caught it). PR body / `docs/ci-cd.md` implied the Python gate covered registry↔generated for that table. | **Valid + actionable** | Strengthened `check.py`: new `check_spec_table()` parses every family row and asserts the members/backlog slug sequences equal the registry (in order) plus family-set coverage; the README assertion now checks the full registry-derived counts (`**N**` and `(P Postiz + E extras)`), not just `**N**`. Reproduced before (mutated row → `schema contract OK`) and after (mutated row → precise FAIL). `docs/ci-cd.md` wording made exact. |
| F2 | NIT — `registry.yaml` comment claimed a "curated slice order (membership → tip → donation → storefront)" that the actual row order does not follow. | **Valid + actionable** | Comment corrected: the order IS the SPEC family-table order; the slice grouping is §6 prose, not the row order. |
| F3 | NIT — `PASTE_PLATFORMS` + `PastePlatformCase` (test scaffolding) on core's public entrypoint. | **Valid trade-off** (partial fix) | Dropped the unused `PastePlatformCase` type export. The `PASTE_PLATFORMS` const stays: it is the #154-mandated registry-derived test enumeration, consumed by the CLI suite across the package boundary; a dedicated test entrypoint is more machinery than the benefit justifies. Accepted risk, recorded here. |

**Contract misread:** none. **Noise:** none.
**Second fresh round:** not run — the fixes are gate/comment-level and the generated
projections are byte-identical (regeneration is a no-op). If a second independent pass on
the corrected diff is wanted, the handoff block applies again.

## Handoff

Push/PR already exist for this branch (PR #180, open, CI green, `MERGEABLE`; opened per the
original task, before the sota pipeline — a declared deviation from the skill's clean
handoff). Post-testing feedback re-enters as: small findings → correction blocks on this
branch; large ones → a fresh `/sota-workflow` round.

