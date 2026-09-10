# 05-review.md — sota-review gate · PR #52 (evidence registry M7, issue #48)

**Inputs (adapted — this work did NOT go through sota-grill/spec/build; no 03-spec.md
or 04-build.md exists for this slug):**
- Contract: issue #48 + SPEC §18 (D17, ratified 2026-09-08) + SPEC §12 M7.
- Build: PR #52 diff (5f42eea..HEAD), 3 commits + 2 correction commits.
- Reviewer model: ollama/glm-5.3-flash:cloud — SAME tier and SAME session as the
  author. Equal-tier requirement met; independence NOT met (correlated blind
  spots). The fresh-session `premerge-review` pass is the real independent gate.

## Pass 1 — Spec fidelity

| Issue #48 / §18.11 item | Evidence | Verdict |
|---|---|---|
| Schema v1.4 additive + `pnpm gen:zod` | schema/profile.schema.json + generated committed; CI now asserts freshness (fbd6d4b) | OK |
| `credential-expiry` | registry.ts `check/credential-expired` (warn) + test + E2E | OK |
| registry live-links | NOT executed in core — §18.8: "join the existing live-link checks (§3)"; §3 makes live links skill-declared, executed at M3/M4. Interpretation documented in PR body | OK (documented ruling) |
| `no-private-in-public-output` | ERROR severity, exit FAIL; tested + E2E (exit 1) | OK |
| JSON-LD `hasCredential` | Person + Organization (brand test added this gate), public-only | OK |
| compact registry section github-readme | public-only; path locator never emits URL (§18.3) | OK |
| template media/ + evidence-packs + symlink doc | cross-repo: profile-data-template#8 (issue comment) | OK (tracked) |
| SPEC label v1.3→v1.4 (D18 took v1.3) | SPEC §6/§12/§18.2/§17.1/§18.11 corrected | OK |

## Pass 2 — Correctness

- Re-read full diff post-review-round-1 (isPublicEntry/credentialLdEntries single-source).
- Date compare `expires < today` lexicographic ISO — safe; `expires == today` not
  expired (end-of-day reading) — NIT, acceptable.
- Markdown interpolation of titles/issuers — pre-existing pattern (project names),
  consistent; scheme allowlist for URLs escalated as issue #53 (repo-wide, pre-existing).
- Re-run: 166 tests pass, typecheck clean, build clean, schema self-test OK, CI pass.

## Pass 3 — Coherence

- Module namespaces consistent (`check/` vs `drift/` vs `geo/`); two severity
  channels (integrity=D12 fail at load vs registryCheck findings) documented.
- SEAM FOUND: `EducationalOccupationalCredentialLd` type import sat mid-file in
  registry.ts (patching seam from the parallel-edit round). → corrected (438dcc3).
- SEAM FOUND: CI had no gen:zod freshness assertion (D3 drift class unprotected
  repo-wide). → CI step added (438dcc3), fixed ordering after pnpm setup (fbd6d4b).

## Findings

| Severity | Finding | Evidence | Action |
|---|---|---|---|
| MAJOR | CI does not assert generated-Zod freshness (D3 gap, repo-wide) | ci.yml had no gen:zod step | Fixed in PR (correction round 1) |
| NIT | Mid-file type import in registry.ts | registry.ts:80 | Fixed in PR (correction round 1) |
| NIT | CI step ran before pnpm setup (pnpm not on PATH) | run 34415299862 | Fixed (fbd6d4b) |
| NIT | `expires == today` renders as not-expired | registry.ts todayIso compare | Accepted (end-of-day reading; warn-level) |
| NIT | check.ts header "for <platform>" with global registry findings | check.ts section line | Accepted (documented) |

## Corrections round 1

Two correction commits pushed to the PR branch (438dcc3, fbd6d4b); CI pass
(run 34415454383). No further correction rounds required.

## Verdict

**PASS** — rounds: 1 correction round (2 commits). All acceptance-relevant checks
demonstrated by evidence or cheap re-runs; remaining findings are NITs accepted
with rationale.

## Fresh-context reconcile

(pending — premerge-review not yet run; placeholder per skill step 9.)

## Feedback re-entry

Operator post-testing feedback re-enters as: small findings → correction blocks
appended to this file + fix commits on `pi/pasco/evidence-registry`; large findings
→ fresh `/sota-workflow` round. (Recorded per skill step 8.)
