# Repository standards & public-readiness policy

## Private by default

Every repository in this project starts **private**. A repository becomes **public** only after it
passes the Public-Readiness Checklist below, with the maintainer's explicit sign-off.

Rationale: a public repo is a commitment — anyone can fork, file issues and judge it. It must not
expose unfinished, unverified or untested work. This product must prove itself on **real user data**
before it is presented publicly — the first real end-to-end test is a hard requirement, not an option.

## Public-readiness checklist

1. **First real test passed** — the system ran end-to-end on real user data (dogfood: the
   maintainer's own profile rendered + deployed), not only on fixtures. This is the minimum the
   repo must have before going public.
2. **CI is green and meaningful** — automated checks cover the contract and the core test suite;
   `ci` required on `main`.
3. **Versioned** — at least one tagged release (v0.1.0+) with a `CHANGELOG.md` entry describing it.
4. **Docs honest** — README reflects actual state (no "⏳" for work that is actually done, no claims
   about features that don't exist); quickstart verified by someone other than the author.
5. **No placeholders in critical paths** — no TODOs/FIXMEs in shipped code paths; known limitations
   tracked as issues, not hidden in code.
6. **Security baseline** — `SECURITY.md` present, no secrets in history (scan), dependencies audited.
7. **Governance in place** — LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, GOVERNANCE.
8. **Maintainer sign-off** — explicit decision recorded (this file's "Status" section below).

## Free-plan constraints (GitHub Free)

Branch protection and rulesets are **not available on private repositories** with GitHub Free
(the API returns 403 — they require GitHub Pro or a public repo). Verified empirically.

Workarounds while private:

- **Protection by access + process:** the repo is private (access is limited to the maintainer and
  their agents) and every change goes through a PR that **only the maintainer merges**.
- **The moment the repo goes public**, re-apply branch protection — `docs/ci-cd.md` has the exact
  API calls. Re-applying protection is part of the public-ready step, not a precondition for it.
- **Dependabot:** alerts and version updates for private repos are limited on Free (version updates
  effectively require public or Pro). While private, treat dependency bumps as a manual weekly review.
- **Actions:** 2,000 minutes/month on private free repos — ample for this CI (~1 min/run).

## Status of this repository

| # | Checklist item | Status |
|---|---|---|
| — | Visibility | 🔒 **private** (per policy) |
| 1 | First real test (dogfood: own profile rendered + deployed) | ❌ **blocker** — needs renderer `github-readme` + real data (roadmap M2) |
| 2 | CI green + meaningful | ✅ `ci` (schema self-test + core suite, 37 tests) |
| 3 | Tagged release + changelog | ❌ no tag yet |
| 4 | Docs honest + quickstart verified | ⚠️ README current; quickstart not yet verified by a third party |
| 5 | No placeholders in critical paths | ⚠️ renderers/CLI not built (tracked in roadmap, not TODOs) |
| 6 | Security baseline | ✅ SECURITY.md; secret scan pending |
| 7 | Governance | ✅ LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, GOVERNANCE |
| 8 | Maintainer sign-off | ❌ pending |

**To go public:** complete item 1 (dogfood) as the entry gate, tag v0.1.0, re-apply branch
protection, then flip visibility with the maintainer's sign-off.

## Applying this policy to new projects

When creating a new repository: `gh repo create <name> --private --source .` (or private in the
UI). Record the checklist status in the new repo's `docs/STANDARDS.md` copy. Do not flip to public
until all checklist items are ✅ and the maintainer signs off.
