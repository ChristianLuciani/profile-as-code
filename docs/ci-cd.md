# Repo configuration — branch protection, CI/CD (free plan)

> How this repository is protected and automated. Status: active on `main`.
> All features below work on **GitHub Free** because the repository is **public**
> (public repos get branch protection, unlimited Actions minutes and Dependabot for free).

## Branch protection — `main`

Applied via the REST API (see "How to change" below). Current rule:

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | ✅ | No direct pushes to `main` — every change goes through a PR |
| Required approving reviews | 0 | Solo maintainer cannot self-approve; review is a **human process at merge time**, not a bot gate. Tighten to 1 + CODEOWNERS when real collaborators join |
| Require status checks | `ci` (strict) | The `ci` workflow must be green; **strict** = branch must be up to date with `main` (prevents stale-branch merges in parallel sessions) |
| Require conversation resolution | ✅ | All PR comments resolved before merge |
| Enforce for admins | ✅ | Even the owner/agents cannot bypass — this is the point of protection (agent-work safety). Emergency hotfix: temporarily disable the rule, then re-enable |
| Allow force pushes | ❌ | History on `main` is immutable |
| Allow deletions | ❌ | `main` cannot be deleted |
| Automatically delete head branches | ✅ | Merged PR branches are auto-deleted (this session's `aionui/pi/*` branches) |

## CI — `.github/workflows/ci.yml`

One job, **`ci`**, required on every PR and push to `main`:

1. **Schema contract self-test** (`scripts/schema-check/check.py`) — always runs:
   - `schema/profile.schema.json` must be a valid JSON Schema (2020-12, D3)
   - 6 fixtures in `scripts/schema-check/fixtures/` behave as named:
     `valid-*` accepted, `invalid-*` rejected (missing `en`, unknown property,
     bad DOI, unsupported platform)
   - This guards the contract even before the TypeScript workspace exists.
2. **TypeScript workspace** — steps activate automatically once `package.json` lands
   (M1 core): `pnpm install --frozen-lockfile` → `pnpm test` → `pnpm build`
   (recursive over `packages/*`). pnpm version comes from the `packageManager`
   field in the root `package.json`.

No paid features: public repo → unlimited Actions minutes.

## Dependabot — `.github/dependabot.yml`

- **npm** ecosystem (weekly): dependency PRs for the pnpm workspace (root + `packages/*`)
- **github-actions** ecosystem (weekly): updates to our own workflow actions
- Both open PRs with the `dependencies` / `ci` labels; they must pass the `ci` check.

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
