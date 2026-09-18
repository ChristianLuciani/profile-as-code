# Repo configuration — branch protection, CI/CD (free plan)

> How this repository is protected and automated. Status: **private** (per `docs/STANDARDS.md`).
> **Free-plan reality:** branch protection and rulesets are ONLY available on public repos (or
> GitHub Pro). While this repo is private, protection is enforced by **process**: access control +
> PR-only flow + maintainer-only merges. The API calls below are the **public-ready step** —
> re-apply them the moment the repo goes public.

## Branch protection — `main`

Applied via the REST API (see "How to change" below) when the repo is public. Current rule:

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | ✅ | No direct pushes to `main` — every change goes through a PR |
| Required approving reviews | 0 | Solo maintainer cannot self-approve; review is a **human process at merge time**, not a bot gate. Tighten to 1 + CODEOWNERS when real collaborators join |
| Require status checks | `ci` (strict) | The `ci` workflow must be green; **strict** = branch must be up to date with `main` (prevents stale-branch merges in parallel sessions) |
| Require conversation resolution | ✅ | All PR comments resolved before merge |
| Enforce for admins | ✅ | Even the owner/agents cannot bypass — this is the point of protection (agent-work safety). Emergency hotfix: temporarily disable the rule, then re-enable |
| Allow force pushes | ❌ | History on `main` is immutable |
| Allow deletions | ❌ | `main` cannot be deleted |
| Automatically delete head branches | ✅ | Merged PR branches are auto-deleted |

## CI — `.github/workflows/ci.yml`

One job, **`ci`**, required on every PR and push to `main`:

1. **Schema contract self-test** (`scripts/schema-check/check.py`) — always runs:
   - `schema/profile.schema.json` must be a valid JSON Schema (2020-12, D3)
   - 13 fixtures in `scripts/schema-check/fixtures/` behave as named:
     `valid-*` accepted, `invalid-*` rejected (missing `en`, unknown property,
     bad DOI, unsupported platform)
   - This guards the contract even before the TypeScript workspace exists.
2. **TypeScript workspace** — steps activate automatically once `package.json` lands
   (M1 core), in this order: `pnpm install --frozen-lockfile` →
   **`pnpm lint`** (Biome: lint + format + import order, issue #59) →
   **D3 freshness** (`pnpm gen:zod` then `git diff --exit-code` on the committed Zod, so a
   schema edit without regeneration fails here) → `pnpm test` → `pnpm build`
   (all recursive over `packages/*`) → tarball bin smoke check (issue #43).
   pnpm version comes from the `packageManager` field in the root `package.json`.

No paid features: public repo → unlimited Actions minutes.

### Why Biome (and when we would revisit)

Chosen for #59: one tool (lint + format + import order), one config, one command — against the
`eslint + prettier + plugins` chain, which needs several devDependencies, a plugin/parser config and
separate ignore files. Fewer dependencies also means fewer Dependabot streams and less supply-chain
surface, which matters for the public-readiness checklist (`docs/STANDARDS.md`, security baseline).

**Honest trade-off.** Biome is deliberately *less* configurable than ESLint (fixed rule set vs the
ESLint plugin API) — the win is **less config required**, not more knobs. And it is **not
type-aware**: `pnpm typecheck` (tsc strict) covers types, but not type-aware lint rules such as
`no-floating-promises` or `no-misused-promises`.

**Revisit triggers** — either one reopens this choice (recorded so it is decided on evidence, not
re-argued from taste):

1. an async correctness bug slips through that `tsc` cannot catch → add a narrow `typescript-eslint`
   layer for the type-aware rules only, or swap wholesale;
2. a custom rule is needed that Biome cannot express.

## Dependabot — `.github/dependabot.yml`

- **npm** ecosystem (weekly): dependency PRs for the pnpm workspace (root + `packages/*`)
- **github-actions** ecosystem (weekly): updates to our own workflow actions
- Both open PRs with the `dependencies` / `ci` labels; they must pass the `ci` check.

## Release — `.github/workflows/release.yml`

The publish path is guarded by `packages/cli/scripts/release-guard.mjs`, which runs
before the build and asserts three things (issue #81):

1. the tag name matches `packages/cli/package.json`;
2. that version is tagged on origin (so `workflow_dispatch` cannot publish an
   untagged version — the tag|publish invariant has no exception);
3. the **tagged commit** is the right one. On a **tag push** it must BE the
   current default-branch tip; on **`workflow_dispatch`** (the retry path) it must
   be an ancestor, because a retry legitimately republishes a tag pushed when the
   branch was at that commit.

The guard then emits that commit, and the workflow **checks it out before building**
(`${{ steps.guard.outputs.commit }}`). Verifying a commit is not the same as
publishing it: without that second checkout, a retry dispatched from a branch would
build the branch's tree while the guard reported "commit verified".

Why (3) exists: the guard used to compare the tag *name* only, so a tag pushed
from a stale local `main` passed and published whatever that commit contained. A
checkout with `fetch-depth: 0` is required — ancestry is not computable from a
shallow clone. The guard is exercised by `packages/cli/tests/release-guard.test.ts`
and can be run by hand: `pnpm --filter @profile-as-code/cli guard:release --help`.

`--provenance` is conditional on the repository being public (npm cannot attest a
private source repo); once publishing moves to OIDC trusted publishing, the flag
disappears entirely (see #80).

## Other

- **PR template** (`.github/pull_request_template.md`): reminds branch convention,
  CI green, tests, docs, claims-evidence rule.
- **`SECURITY.md`**: private reporting via GitHub Security Advisories (free on public repos).
- **Actions permissions**: read-only (`permissions: contents: read` in the workflow).

## How to change

Everything is plain GitHub REST API — scriptable and free:

```bash
# Read current protection
gh api repos/ChristianLuciani/profile-as-code/branches/main/protection

# Update protection (idempotent PUT)
gh api -X PUT repos/ChristianLuciani/profile-as-code/branches/main/protection \
  -F "required_status_checks[strict]=true" \
  -F "required_status_checks[contexts][]=ci" \
  -F "enforce_admins=true" \
  -F "required_pull_request_reviews[required_approving_review_count]=0" \
  -F "required_conversation_resolution=true" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false" \
  -F "delete_branch_on_merge=true"

# Repo-level auto-delete of head branches
gh api -X PATCH repos/ChristianLuciani/profile-as-code -F delete_branch_on_merge=true
```

> **When to tighten:** the moment a second human collaborator joins, add
> `CODEOWNERS` + `required_approving_review_count=1` so third-party PRs need
> an explicit approval.
