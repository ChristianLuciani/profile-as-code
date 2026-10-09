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
| Require status checks | `ci`, `sign-off` (strict) | Both workflows must be green; **strict** = branch must be up to date with `main` (prevents stale-branch merges in parallel sessions). `sign-off` is the DCO gate (D21) — requiring it makes the signature a merge blocker, not advisory |
| Require conversation resolution | ✅ | All PR comments resolved before merge |
| Enforce for admins | ✅ | Even the owner/agents cannot bypass — this is the point of protection (agent-work safety). Emergency hotfix: temporarily disable the rule, then re-enable |
| Allow force pushes | ❌ | History on `main` is immutable |
| Allow deletions | ❌ | `main` cannot be deleted |
| Automatically delete head branches | ✅ | Merged PR branches are auto-deleted |

## CI — `.github/workflows/ci.yml`

One job, **`ci`**, required on every PR and push to `main`:

1. **Schema contract self-test** (`scripts/schema-check/check.py`) — always runs:
   - `schema/profile.schema.json` must be a valid JSON Schema (2020-12, D3)
   - the platform registry (`platforms/registry.yaml`) ↔ `$defs/platform.enum` ↔ the
     committed generated projections (`packages/core/src/generated/platforms.gen.ts`
     slug list, the SPEC §6 **family table body + count arithmetic**, the README
     status counts) must agree, and the hand-authored `<N> total` in the platform
     description must match the enum size (issue #154; `pyyaml` reads the registry).
     The node gate below byte-compares the same blocks, so the two are
     defense-in-depth, not duplicates.
   - 13 fixtures in `scripts/schema-check/fixtures/` behave as named:
     `valid-*` accepted, `invalid-*` rejected (missing `en`, unknown property,
     bad DOI, unsupported platform)
   - This guards the contract even before the TypeScript workspace exists.
2. **Documentation link gate** (`scripts/link-check`, issue #149) — always runs:
   every RELATIVE link/path in the tracked, non-hidden Markdown doc areas (root
   `*.md` — `README`, `CONTRIBUTING`, `AGENTS`, `GOVERNANCE`, `SECURITY`,
   `CODE_OF_CONDUCT`, `CHANGELOG` — plus `docs/`, `schema/`, `skills/`,
   `templates/` and the package READMEs) must resolve to a file or directory,
   and every in-page anchor (`#section`) must resolve against the headings of
   its destination using `github-slugger`'s rules (the reference
   implementation: each space becomes `-`, `_`/`-` kept). Hidden trees
   (`.github/`, `.sota/`) are excluded by decision — `.sota/` holds frozen
   historical artifacts, not live docs. Offline and deterministic: external URLs
   are never fetched — a required check cannot depend on third-party uptime or
   rate limits (`https://ko-fi.com/christianluciani` answered HTTP 403 to a bot,
   #132, 2026-10) — and the private family target `profile-data-template` is
   DECLARED in `scripts/link-check/allowlist.json` with its removal trigger (the
   visibility flip). Node-only, needs no install, so it runs before
   `pnpm install` to fail fast — after the pinned Node setup, like every other
   node gate, so the required check is reproducible; the step is unconditional
   (it uses no workspace code, so it must run even without `package.json`). The
   link-gate fixture self-test runs first (within the step) and proves the gate
   refuses a deliberately broken relative link.
3. **TypeScript workspace** — steps activate automatically once `package.json` lands
   (M1 core), in this order: **dependency gate** (`scripts/dep-gate`, issue #98 —
   node-only, before install to fail fast: `packages/server` must depend on
   `core` only among its runtime dependencies and nothing in `core`'s dependency
   graph may reach `server`, SPEC §5 D20; the gate passes vacuously until
   `packages/server` exists, and a fixture self-test runs first) →
   **renderer map in sync** (`scripts/renderer-map`, issue #165 — the `pasco` block of each renderer manifest is the sole data home, and the generated CLI map must match: self-test + `--check`, before install) →
   `pnpm install --frozen-lockfile` →
   **`pnpm lint`** (Biome: lint + format + import order, issue #59) →
   **D3 freshness** (`pnpm gen:zod` then `git diff --exit-code` on the committed Zod, so a
   schema edit without regeneration fails here) →
   **platform registry projections** (`scripts/gen-platforms/test.mjs` then
   `node scripts/gen-platforms/gen.mjs --check`, issue #154 — the registry ↔ enum ↔
   generated surfaces must be fresh; reads YAML through the root `yaml` dependency,
   so it runs after install) →
   **Typecheck** (`pnpm build && pnpm typecheck`, issue #108 — the CLI builds with
   tsup, which transpiles without type-checking, so the gate runs an explicit
   build first: workspace type resolution needs the built `dist/`) →
   `pnpm test` → `pnpm build`
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
type-aware**: `pnpm typecheck` (tsc strict) covers types — enforced in CI as a
gate since #108 — but not type-aware lint rules such as
`no-floating-promises` or `no-misused-promises`.

**Revisit triggers** — either one reopens this choice (recorded so it is decided on evidence, not
re-argued from taste):

1. an async correctness bug slips through that `tsc` cannot catch → add a narrow `typescript-eslint`
   layer for the type-aware rules only, or swap wholesale;
2. a custom rule is needed that Biome cannot express.

### Why a local link gate (and not `lycheeverse/lychee-action`)

The issue considered `lychee` and left the choice to the implementer, with the
trade-off recorded either way. The local gate won, on the same reasoning as
Biome over `eslint + prettier` (#149): one less external action/dependency
stream, and a check that is **resolvable offline**. The measured cost is small —
zero dependencies; `node scripts/link-check/check.mjs` runs in ~0.06 s over the
whole corpus (46 files, 86 links at #149, 2026-10-09) and the self-test step
completes in well under a second on CI (`ci` run 37863932326) — so the offline
gate is not more expensive than the action, it is cheaper to run and to trust.

**Honest trade-off.** The local gate deliberately does **not** fetch external
URLs, so it cannot catch a dead `https://` link, and it knows only the GitHub
heading-slug rules (not the HTML an unusual renderer might produce). `lychee`
would add external-URL liveness — at the price of a third-party action, network
flakiness and 403s from walled surfaces (the `ko-fi` case, #132) inside a
required check, which is exactly what the issue excludes. External liveness
belongs, if ever, in a scheduled non-required workflow with an explicit
allowlist — not here.

The slug rule is not taken on faith either: `scripts/link-check/slug-oracle.json`
commits the expected anchors for a representative heading set as produced by
`github-slugger@2.0.0` (the reference implementation), and `test.mjs` asserts the
gate reproduces every pair — so a slugger regression fails CI without adding a
dependency. The known limit is raw inline HTML in a heading, where the rendered
text is renderer-dependent; it does not occur in the current corpus.

**Revisit trigger**: if the corpus grows past what `node` can parse reliably
(a renderer/extension the gate cannot read), or a whole class of broken external
links actually bites, reopen the choice with the failing case.

## Dependabot — `.github/dependabot.yml`

- **npm** ecosystem (weekly): dependency PRs for the pnpm workspace (root + `packages/*`)
- **github-actions** ecosystem (weekly): updates to our own workflow actions
- **Fixture exclusion**: the fixtures are stored as undiscoverable data
  (`fixture.package.json` / `fixture.pnpm-workspace.yaml`) and materialized with real names only at
  test time by `scripts/dep-gate/test.mjs` (which runs the production `check.mjs` unchanged), so no
  advisory can open a security job over them — `dependency_file_not_parseable` (#191) is gone by
  construction (#166). `exclude-paths: scripts/dep-gate/fixtures/**` is kept for the version-update
  path only (belt-and-braces).
- Both open PRs with the `dependencies` / `ci` labels; they must pass the `ci` check.

## Supply-chain & action hardening (audit 2026-10-09)

Enforced in-repo (not a plan gate):

- **Actions pinned to a full commit SHA** — `actions/checkout`, `actions/setup-node`,
  `pnpm/action-setup`. A moved tag can no longer run new code in CI; Dependabot's
  `github-actions` updates keep the SHAs current.
- **`persist-credentials: false`** on every checkout whose later steps do not need git
  auth, so a compromised dependency cannot read the token from `.git/config`. Two keep
  the default on purpose because a later step runs `git fetch` / `git ls-remote`:
  `dco.yml` (the DCO gate fetches the PR head) and the release publish job's first
  checkout (`release-guard.mjs` fetches the default-branch tip and the tag).
- **pnpm supply-chain policies** (`pnpm-workspace.yaml`): `minimumReleaseAge: 4320`
  (3 days; pnpm's default is 1 day) delays freshly published versions — and because it
  is set explicitly, strict enforcement is on, so a younger entry fails the install
  instead of falling back. Dependabot's `cooldown: 7` keeps version-update PRs out of
  that window; security updates bypass cooldown and may leave `ci` red for up to 3 days
  by design. `trustPolicy: no-downgrade` rejects a package whose trust level dropped —
  `trustPolicyExclude` records the accepted `chokidar@4.0.3` exception (#184).
  `blockExoticSubdeps` is stated explicitly (already pnpm's default since 10.26).
- **Pinned tool installs**: `jsonschema==4.26.0`, `pyyaml==6.0.3` (CI) and `npm@11.6.1`
  (release) replace floating versions.
- **`engineStrict: true`** (`pnpm-workspace.yaml`) — a dependency whose declared engine
  range excludes the running Node fails the install. It is a pnpm setting; `.npmrc` is
  read only for registry/auth keys, so the same line there is a no-op.
- `runs-on: ubuntu-24.04` (not `-latest`), plus `timeout-minutes` and `concurrency` on CI.
- `.gitattributes` normalizes line endings to LF; `.github/CODEOWNERS` names the owner.

Still to enable at the visibility flip (needs public or GitHub Pro): the Actions
SHA-pinning policy and a restricted allowed-actions list, a **tag protection ruleset for
`v*`** (the release trigger), secret scanning + push protection, and an environment
approval gate on publish.

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

### The publish chain (issue #142)

Each stage validates what the next one makes irreversible:

1. **Guard** — the tag invariants (above);
2. **Build + test** — the commit the tag points at compiles and passes;
3. **`verify:pack`** — the packed tarball exposes and smoke-runs the `pasco`
   bin (issue #43);
4. **`prepublishOnly`** — `packages/cli` self-validates its published manifest:
   `publint` (root devDependency) runs inside `npm publish`, dry runs
   included, so the irreversible step checks itself. `build` is deliberately
   NOT part of it — release.yml already builds before publishing, and a
   double build buys nothing. `attw` is deliberately NOT in this hook either:
   its `--pack` mode shells out to `npm pack`, and npm's lifecycle env sets
   `npm_config_dry_run=true` on `npm publish --dry-run`, so the child pack
   produces no tarball and attw dies with ENOENT (measured 2026-10-06) —
   which would break the dry-run smoke path of release.yml. The CLI is
   bin-only (no `types` entry), so attw adds no signal there anyway; it runs
   in `ci.yml` over the typed packages, where it does;
5. **Publish** — `npm publish`, OIDC-first auth (below).

The same validators run in `ci.yml` on every PR — `publint` over every
workspace package, `attw --pack --profile esm-only` over the packages that ship
a `types` entry (the set is derived from the manifests, not a hand-maintained
list) — so a broken `exports` map or a packaging regression fails at PR time
instead of at release time. Two deliberate scopes: the CLI is **bin-only by
design** (tsup `dts: false`, no `types` field — attw reports "this package does
not contain types" and exits 0; no types entry is added just to please the
tool), and the typed packages are **ESM-only by design**, hence the `esm-only`
profile — the default strict profile counts CJS-resolves-to-ESM as a problem,
which is exactly the state the engine intends.

### npm publish auth — trusted publishing (OIDC, issue #80)

The publish step authenticates with **trusted publishing (OIDC)**: `id-token: write` is
granted to the `publish` job, and the npm CLI exchanges that short-lived OIDC token for a
publish token, so no long-lived write credential is required ([WEB]
docs.npmjs.com/trusted-publishers, checked 2026-09-19).

The mechanics below are each a real way this fails silently — they are written down so the
next person debugging a publish does not have to rediscover them:

- **npm CLI >= 11.5.1 and Node >= 22.14** ([WEB] docs.npmjs.com/trusted-publishers). Node 22
  ships npm 10.x, which has no trusted-publishing support at all (the OIDC exchange lives in
  `lib/utils/oidc.js`, absent before 11.5.1 — present in the npm 11.6.1 source). npm 10 therefore
  never attempts the exchange, and the publish fails on auth with an error that does not name the
  real cause (observed in #80, 2026-09-15: `E404`/`E403`). The workflow bumps npm and prints
  `npm --version` so this is the first thing a failed publish rules out.
- **OIDC takes precedence, and its failure is silent by design.** npm prefers the OIDC environment
  over a token, and `lib/utils/oidc.js` (npm 11.6.1) is written to *never throw*: a failed exchange
  (no trusted publisher, wrong workflow filename, …) returns `undefined` and leaves the token the
  config already had. That is what makes `NPM_TOKEN` a **true fallback** rather than a conflict — no
  sequencing of edits is required: configure the trusted publisher, and OIDC starts winning on its
  own.
- **No `--provenance` flag — npm decides.** npm attests only when all three hold: the OIDC
  exchange **succeeded**, the **source repo is public**, and the **package is public**
  ([WEB] docs.npmjs.com/trusted-publishers, "Automatic provenance generation"; the code reads
  `repository_visibility` from the OIDC token and re-queries the package's visibility via
  `libaccess.getVisibility`). **Consequence to keep in mind:** while publishing still uses the token
  fallback — step 1 below, before the trusted publisher exists — **no attestation is generated even
  if the repo is public**. That window closes at step 3; it is accepted here because the alternative
  (keep the conditional flag) re-encodes npm's own decision by hand, which is what #80 removes.
- **`repository.url` must match the GitHub repo.** npm validates
  `packages/cli/package.json` → `repository.url` against the repository the workflow runs in
  and fails the publish on a mismatch. The field is the canonical
  `git+https://github.com/ChristianLuciani/profile-as-code.git` (plus `directory: packages/cli`),
  which is correct for a monorepo package — re-check it if the repo is ever renamed or forked.

#### One-time setup (human — npmjs.com)

Trusted publishing is configured **per package**, so it requires the package to already exist:
v0.2.0 (the first publish) still goes out with the `NPM_TOKEN` fallback. From the next version
on, OIDC is used automatically. To complete the migration:

1. Publish v0.2.0 with the existing token (operator action: push the tag — the publish is what
   claims the `pasco` bin name; issue #44 is closed, its reservation task void by construction: a
   name cannot be reserved without publishing it, [WEB: docs.npmjs.com, 2026-09-07]).
2. On npmjs.com → the package's settings → **Trusted Publisher** → GitHub Actions, set:
   - **Organization or user:** `ChristianLuciani`
   - **Repository:** `profile-as-code`
   - **Workflow filename:** `release.yml` (the filename with its extension, not a path)
   - **Environment name:** leave empty (this workflow uses no GitHub environment)
   - **Allowed actions:** allow `npm publish` (staged publishing is always allowed)
3. Cut the next version and confirm the publish log shows the OIDC exchange (a
   `repository.url` mismatch would surface here).
4. **Then** delete the `NPM_TOKEN` repository secret *and* the `NODE_AUTH_TOKEN` env from the
   publish step — the long-lived credential is exactly what #80 removes.

npm does **not** validate the trusted-publisher fields when you save them: a typo surfaces only
as `ENEEDAUTH` at publish time, and every field is case-sensitive.

Scheduled deprecation this removes: the granular access token with 2FA bypass used for publish
loses direct publishing ~January 2027 ([WEB] github.blog changelog 2026-07-08).

After a successful publish, the `release` job creates the matching **GitHub
Release** (issue #58): it checks out the same verified commit, extracts that
version's section from `CHANGELOG.md` with
`packages/cli/scripts/release-notes.mjs` (exercised by
`packages/cli/tests/release-notes.test.ts`), and runs `gh release create
"v<version>" --notes-file … --verify-tag`. Because `npm publish` is irreversible,
the `publish` job runs the same extractor **before** the publish step, so a
missing/empty section blocks the publish instead of leaving a consumed version
with an empty tag page. The job is deliberately **separate and ordered after**
`publish` (a release page for a version that never reached npm would be worse than
a late one) and **idempotent** (a `workflow_dispatch` retry leaves an existing page
untouched). `contents: write` is granted to that job only, not to the publish job.
Attaching the packed tarball is intentionally out of scope: the issue marks it
optional and `verify:pack` already asserts the tarball's bin before any publish.

### Preparing a release (do this before tagging)

The Release page's notes are the `## [<version>]` section of `CHANGELOG.md`. The
pre-publish step validates that the section **exists and is non-empty** — it cannot
know whether it is *complete*, so this preparation is a human step:

1. Bump `packages/cli/package.json` `version` (the tag must equal it — enforced by
   the release guard).
2. Move the release-worthy `[Unreleased]` entries under a new
   `## [<version>] - <date>` heading; keep forward-looking `### Planned` items under
   `[Unreleased]`.
3. Commit that preparation to `main`, then `git tag v<version> && git push --tags`.

Tagging with a stale `[Unreleased]` still produces a page — just one that omits what
shipped. A mechanical "fail if `[Unreleased]` is non-empty" gate was considered and
**rejected**: the repo keeps a `### Planned (roadmap)` block under `[Unreleased]` by
design, so such a gate would fail correctly prepared releases. The residual risk is
recorded in `.sota/release-github-58/05-review.md`.

### Post-publish verification (issue #142)

The publish is irreversible — npm cannot un-publish a version — so the first
thing after it is checking that what reached the registry is what we think
shipped (runbook for the first publish, #113, and every later one):

```bash
npm view @profile-as-code/cli             # version + bin + dist.tarball — must match the tag
npm pack @profile-as-code/cli             # downloads the published tarball
publint ./profile-as-code-cli-<version>.tgz
attw ./profile-as-code-cli-<version>.tgz --profile esm-only
```

`attw` on the CLI tarball is informational by design (bin-only, no `types`
entry — see the publish chain above); `publint` is the check that matters
there. A failure at this point is a **post-mortem, not a rollback**: record it
in the CHANGELOG and fix forward in the next version.

## Other

- **PR template** (`.github/pull_request_template.md`): reminds branch convention,
  CI green, tests, docs, claims-evidence rule.
- **`SECURITY.md`**: private reporting via GitHub Security Advisories (free on public repos).
- **Actions permissions**: read-only (`permissions: contents: read`) for `ci` and the
  `publish` job; the release job elevates to `contents: write` only to create the
  GitHub Release (issue #58).

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
