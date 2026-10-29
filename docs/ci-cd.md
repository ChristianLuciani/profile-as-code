# Repo configuration — branch protection, CI/CD (free plan)

> How this repository is protected and automated. Status: **public** (measured 2026-10-24:
> `gh repo view … --json visibility` → `PUBLIC`; #293). **Free-plan reality:** branch protection
> and rulesets are ONLY available on public repos (or GitHub Pro). While the repo was private,
> protection was enforced by **process**. Measured 2026-10-24: `main` protection active (required
> checks `ci` + `sign-off`, strict, enforce-admins, conversation resolution) and ruleset
> `main-basic` registered (2026-08-18) with enforcement **disabled**.

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
   #132, 2026-10). A private family target therefore needs a declaration, not a
   fetch: `scripts/link-check/allowlist.json` holds them, each with its removal
   trigger, and an entry nothing references is a warning. The registry is empty
   since #273 — `profile-data-template` went public (verified 2026-10-23) and its
   trigger fired. Node-only, needs no install, so it runs before
   `pnpm install` to fail fast — after the pinned Node setup, like every other
   node gate, so the required check is reproducible; the step is unconditional
   (it uses no workspace code, so it must run even without `package.json`). The
   link-gate fixture self-test runs first (within the step) and proves the gate
   refuses a deliberately broken relative link. Since **#226** the step runs
   `check.mjs --check`, which additionally asserts that the corpus **census** —
   the `<!-- gen:doc-links -->` block in this file — equals the run's own
   computation (`pnpm gen:doc-links` regenerates it; a stale block is an
   `E-GATE`). The census is a runtime figure, so it is generated rather than
   typed in prose.
   A second, always-on node step follows it — **evidence anchors** (`scripts/evidence-gate`,
   issue #226): a status row's run-citation is annotated
   `<!-- evidence: <type> as_of=<sha> kind=<record|current> -->`, and the gate
   resolves the sha, asserts it is still an ancestor of the reference, and diffs
   the claim type's relevant paths (`tests` → `packages`; `links` → the Markdown
   corpus; `registry` → the package manifests). `stale` **warns** (exit 0); `unreachable` **fails** (a citation
   nobody can resolve is a claim without a source). The reference is the commit
   being checked (`--ref HEAD`, #342 F6): on a pull request that is the PR's own
   head, so a `kind=current` anchor living on the unmerged branch is reachable —
   as it legitimately is — instead of turning `unreachable` the moment `main`
   moves past the fork; a rebased-away sha still fails, because it is not in the
   checkout. A `kind=record` citation is never stale. This is the only step that
   needs history, which is why the checkout above fetches `fetch-depth: 0`.
   A third, always-on node step follows the evidence gate — **decision-register
   references** (`scripts/spec-drefs`, issue #326, follow-up of #315): the
   register has ONE extent, the `| D<n> |` rows of `docs/SPEC.md` §5, so every
   `D<n>` cited in README/CONTRIBUTING/GOVERNANCE/AGENTS, `docs/**`,
   `skills/**` (Markdown and the YAML catalogs — `pasco check` echoes a row's
   `note`), `templates/**/*.md` (published on-ramps), the package READMEs,
   `schema/README.md`, `platforms/registry.yaml` and the PR + issue templates
   must resolve to a row, and no surface may type the extent as a range. The
   exclusions are declared by class, never implicit: `CHANGELOG.md` and
   `.sota/**` are dated records (rule 8), `site/**` is a projection of these
   files, `.github/workflows/**` are CI annotations/step labels, and source code
   plus machine data (`*.ts`, `*.js`/`*.mjs`, `*.json` such as the schema and the
   package manifests, `DCO`, `*.cff`) are code annotations rather than documents.
   A duplicated `| D<n> |` row is refused — the register has one row per decision. A decision
   the register itself declares ratified-but-pending is an entry with its
   removal trigger in `scripts/spec-drefs/allowlist.json` — reported as a
   warning once its row lands, so `main` stays green without hiding the debt.
   The seeded-defect self-test runs first: it proves the gate refuses a dangling
   reference, a re-typed range in every form prose has used, a duplicated row,
   and a malformed or out-of-scope pending entry. Zero deps, no install —
   before `pnpm install`.
3. **TypeScript workspace** — steps activate automatically once `package.json` lands
   (M1 core), in this order: **dependency gate** (`scripts/dep-gate`, issue #98 —
   node-only, before install to fail fast: `packages/server` must depend on
   `core` only among its runtime dependencies and nothing in `core`'s dependency
   graph may reach `server`, SPEC §5 D20; the gate passes vacuously until
   `packages/server` exists, and a fixture self-test runs first) →
   **renderer map in sync** (`scripts/renderer-map`, issue #165 — the `pasco` block of each renderer manifest is the sole data home, and the generated CLI map must match: self-test + `--check`, before install) →
   **workspace package inventory in sync** (`scripts/gen-packages`, issue #226 —
   node-only, before install: the package set is derived from the
   `pnpm-workspace.yaml` globs, and the `## Map` table in `AGENTS.md` must cover
   every package they match and name no `packages/…` path that is not one, so a
   new package cannot ship with a stale inventory the way `packages/artifact`
   nearly did in #216; the self-test first proves the gate refuses every class it
   claims) →
   **test-typecheck wiring gate** (`scripts/typecheck-gate`, issue #181 — node-only,
   before install to fail fast: every workspace package must wire a
   `tsconfig.test.json` into its `typecheck` script, with `tests/` included and
   not excluded and `noEmit` set; without the gate, `pnpm -r typecheck` silently
   skips a package that omits the script, so a new package could ship unchecked
   tests with CI green; the self-test first proves the gate refuses every class
   it claims) →
   **publishable-surface gate** (`scripts/publishable-gate`, issue #190 — node-only,
   before install to fail fast: every workspace manifest OUTSIDE the explicit
   allowlist (`packages/cli`) must declare `"private": true`, so a new package
   (e.g. the planned `packages/server`, D20) cannot silently rejoin the
   accidental-publish surface with every gate green; the gate VERIFIES, it never
   fixes a manifest, and the self-test first proves it refuses every class it
   claims) →
   `pnpm install --frozen-lockfile` →
   **project page** (`scripts/site-check`, issues #201/#277 — it moved here from
   the pre-install block: since #277 the gate runs over the documentation pages
   PROJECTED from the Markdown, which needs `marked` installed. It projects
   first (`scripts/site-docs/gen.mjs`), then checks ids, in-page anchors and
   local paths on **every** page, refuses `<script>`, inline event handlers and
   `http://`, and a companion `version-check.mjs` asserts that every published
   surface — the landing plus each projected document — states the version in
   `packages/cli/package.json`) →
   **`pnpm lint`** (Biome: lint + format + import order, issue #59) →
   **D3 freshness** (`pnpm gen:zod` then `git diff --exit-code` on the committed Zod, so a
   schema edit without regeneration fails here) →
   **platform registry projections** (`scripts/gen-platforms/test.mjs` then
   `node scripts/gen-platforms/gen.mjs --check`, issue #154 — the registry ↔ enum ↔
   generated surfaces must be fresh; reads YAML through the root `yaml` dependency,
   so it runs after install) →
   **Typecheck** (`pnpm build && pnpm typecheck`, issue #108 — the CLI builds with
   tsup, which transpiles without type-checking, so the gate runs an explicit
   build first: workspace type resolution needs the built `dist/`; issue #181 —
   each package's `typecheck` runs a `tsconfig.test.json` that extends the
   package's own tsconfig and adds `tests/**/*.ts` + `*.config.ts` +
   `scripts/**/*.ts`, so the test suites (and the vitest/tsup/build scripts) are
   type-checked too and a mistyped shared contract, e.g.
   `@profile-as-code/paste/conformance`, fails the gate) →
   `pnpm test` → `pnpm build`
   (all recursive over `packages/*`) → **AI policy is sourced and fresh**
   (`node packages/cli/dist/index.js export ai-policy --check`, issue #290 — the
   `ai:` crawler list of the platform registry must stay sourced and inside the
   180-day window; the command reads no workspace, so CI dogfoods it on the
   engine's own registry) → tarball bin smoke check (issue #43).
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
whole corpus and the self-test step completes in well under a second on CI
(`ci` run 37863932326) — so the offline gate is not more expensive than the
action, it is cheaper to run and to trust.

The corpus **size** is a runtime figure, so it is not typed in this prose: it is
the generated census block below (`pnpm gen:doc-links`, asserted fresh by
`--check` in CI), and every other surface cites that block. The figure taken at
the #149 landing — 46 files, 86 links (2026-10-09) — stays as that run's record,
not as a current claim.

<!-- gen:doc-links -->
<!-- GENERATED by scripts/link-check/check.mjs — do not edit by hand. Regenerate with `pnpm gen:doc-links`. -->
Link corpus at this commit: **56 files, 185 links** — counted by `node scripts/link-check/check.mjs` over the tracked, non-hidden Markdown doc areas; external URLs are recorded and skipped, never fetched. Cite this block rather than re-typing the number: a figure that moves with every commit is a citation, not a claim.
<!-- /gen -->

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
  (`fixture.package.json` / `fixture.pnpm-workspace.yaml` / `fixture.package.invalid-json` — the last
  for the deliberately-invalid manifest) and materialized with real names only at
  test time by `scripts/dep-gate/test.mjs` and `scripts/publishable-gate/test.mjs` (which run the
  production `check.mjs` unchanged), so no advisory can open a security job over them —
  `dependency_file_not_parseable` (#191) is gone by construction (#166).
  `exclude-paths: scripts/dep-gate/fixtures/**` and `scripts/publishable-gate/fixtures/**` are kept
  for the version-update path only (belt-and-braces).
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
  the transitive `chokidar` (tsup's watcher) carries no exclusion: the `overrides`
  block pins it to 4.0.1, the newest attested 4.x (#184). `blockExoticSubdeps` is
  stated explicitly (already pnpm's default since 10.26).
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

**Which trigger publishes: the tag push** — ratified 2026-10-24 as camino (c) of the #307
docket ([ratification](https://github.com/ChristianLuciani/profile-as-code/issues/307#issuecomment-6386416707)); the `workflow_dispatch` is the documented override and retry.
The precondition the ratification named **landed on 2026-10-26**: `github-pages` now carries
`tag v*` beside `branch main` / `branch gh-pages` (`environments/github-pages/deployment-branch-policies`,
measured right after the change), and the `v0.3.6` tag run (2026-10-27) measured
the deploy leg green (run `40430800936`). The full path is in
[§Releasing — the primary path](#releasing--the-primary-path-issue-208); what follows here is
the guard and the invariant it enforces, which are the same on both entry points.

The publish path is guarded by `packages/cli/scripts/release-guard.mjs`, which runs
before the build and asserts three things (issue #81):

1. the tag name matches `packages/cli/package.json`;
2. that version is tagged on origin (so `workflow_dispatch` cannot publish an
   untagged version — the tag|publish invariant has no exception);
3. the **tagged commit** is the right one. On a **tag push** it must BE the
   current default-branch tip; on **`workflow_dispatch`** (now the primary path,
   and the retry path in the #81 sense) it must be an ancestor, because a retry
   legitimately republishes a tag pushed when the branch was at that commit.

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
5. **Publish** — two steps, both OIDC-first (below): the **seam cohort** —
   `core → markdown → paste → artifact → github` — publishes with `pnpm publish`,
   which rewrites the runtime `workspace:*` dependency of `paste` and `github`
   (`npm publish` does not rewrite it — the published manifest would carry an
   unresolvable dependency, issue #301). A package whose version is already live
   is skipped: all six packages version independently — the policy **issue #301
   declares** (#259's decision covers publishing the five and left the version
   policy open). The **CLI** then publishes from its working directory as
   before, still carrying `prepublishOnly`.

   The release tag stays anchored to the CLI package (the guard above is
   unchanged); a release event publishes whatever member of the cohort changed.
   A seam-only change ships with the next release event; if none is pending,
   prepare a CLI version bump as the event's anchor — the tag must be the CLI's
   version (the guard's invariant) — and record the seam change under that
   section of the single CHANGELOG. #259's external-renderer criterion (`npm
   pack` + a clean publish with a renderer from outside the workspace) is a
   declared future pipeline step — no external renderer exists yet.

**First executed cohort run (v0.3.6, 2026-10-27 — issue #327):** run
[`40430800936`](https://github.com/ChristianLuciani/profile-as-code/actions/runs/40430800936)
attempt 2 executed the cohort step against the live registry and logged **5
explicit skips, one per package** (`skip @profile-as-code/<pkg>@<version> —
already live on the registry (independent semver)`): `core@0.1.1`,
`markdown@0.1.0`, `paste@0.1.0`, `artifact@0.1.0`, `github@0.1.0` were live at
02:38–02:39Z, before the step ran; the CLI `0.3.6` then published over OIDC with
`dist.attestations`. The step has therefore **not yet published a seam member**:
those five live versions carry no `dist.attestations` (registry
`/-/npm/v1/attestations/@profile-as-code/<pkg>@<version>` → 404), and the first
actual cohort publish is #313's remaining evidence — a release that bumps a seam
version. What this run *does* measure is the skip path end-to-end: the step ran,
the five skips are in its log with their reason, and the CLI publish that
followed is attested.

One class of manifest error escapes every hook above: npm's publish-time
auto-correction. `npm publish` fixes some malformed fields at publish time and
only warns (`npm warn publish npm auto-corrected some errors in your package.json …
Please run "npm pkg fix"`); the v0.2.0 tag run hit it once — `bin.pasco` was
`"pasco": "./dist/index.js"` and npm cleaned it to `dist/index.js` (#192). The
fix is `npm pkg fix` in `packages/cli/`, committed like any other manifest
change; after it, `npm publish --dry-run` prints no auto-corrections, which is
the check to run before tagging.

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

### Rehearsing the cohort publish — packs, publishes nothing (issue #313)

The cohort step (`pnpm publish` × 5, dependency order) is irreversible and, until a
seam version bump, it has only ever **skipped**: the `v0.3.6` run logged five skips
because every seam version was already live (§the publish chain). The first release
that actually publishes a seam member is therefore first contact with the whole
chain — order, the `workspace:*` rewrite, public access, the `repository.url` npm
validates — at the one moment it cannot be undone. `scripts/release-rehearsal/`
rehearses that moment offline and deterministically, with the same client the
publish uses:

```bash
pnpm rehearse:release            # packs the five, asserts, publishes nothing
```

It runs in three places: on PRs that touch a manifest, the workspace or
`release.yml` (`.github/workflows/release-rehearsal.yml`, which deliberately does
**not** hold `id-token: write`), by hand via
`gh workflow run release-rehearsal.yml --ref main` before preparing a release, and
as a barrier inside `release.yml` **immediately before** the cohort loop — so the
tagged run fails before npm, not after a version is consumed.

What it asserts, and the failure it names:

| Subject | Assertion |
|---|---|
| Order | `ORDER` in `release.yml` is a valid topological order of the cohort's runtime workspace dependencies (`paste`/`github` → `core`), covers exactly the five, and no member carries a runtime dependency on a workspace package outside the cohort |
| Tarball | `pnpm pack` (not `npm pack`) produces a manifest whose `name`/`version` equal the source, whose `private`/`publishConfig.access` allow a public publish, whose `workspace:*` is rewritten to the exact peer version the same run publishes (#301), and whose `main`/`types`/`exports`/`files` targets exist inside the tarball |
| Mechanism | the `publish` job still grants `id-token: write` (read from the job's effective `permissions:`, not as text), **every** publish invocation outside a `--dry-run` branch is `pnpm publish` (only pnpm rewrites `workspace:*`), the loop iterates `$ORDER`, the rehearsal barrier exists **before** the loop, the cohort precedes the CLI's `Publish` step, and every publishable workspace member **except `packages/cli`** (which publishes from its own step) is in the cohort |
| Provenance precondition | each manifest's `repository.url` equals the repo the workflow runs in, and `repository.directory` its monorepo home |

**What it cannot check — declared, not implied.** A rehearsal is offline: it cannot
perform the OIDC exchange, so it cannot prove the trusted-publisher binding, npm's
acceptance of the token, or that a version is already live (the loop then skips, and
npm cannot republish). It also cannot produce `dist.attestations`: npm generates the
attestation only during a successful publish. Those are the facts only a **release
event** creates, and the gate prints them as `NOT CHECKED` in every run rather than
letting a green rehearsal read as publish evidence.

**The premise this leaves open (issue #313).** The registry state was read **once,
on 2026-10-28**, read-only and without publishing — a dated record (`kind=record`),
not a standing claim: the numbers move with the next publish. The commands are the
record's source ([OFICIAL] registry.npmjs.org):

```bash
# each seam package at its manifest version → HTTP status
for pkg in core markdown paste artifact github; do
  v="$(node -p "require('./packages/$pkg/package.json').version")"
  printf '%s@%s ' "$pkg" "$v"
  curl -s -o /dev/null -w '%{http_code}\n' \
    "https://registry.npmjs.org/@profile-as-code/$pkg/$v"
done                                     # 2026-10-28 → 200 ×5
# provenance attestation of that same version
for pkg in core markdown paste artifact github; do
  v="$(node -p "require('./packages/$pkg/package.json').version")"
  printf '%s@%s ' "$pkg" "$v"
  curl -s -o /dev/null -w '%{http_code}\n' \
    "https://registry.npmjs.org/-/npm/v1/attestations/@profile-as-code/$pkg@$v"
done                                     # 2026-10-28 → 404 ×5
```

So: all five seam versions resolve (200 ×5) and `paste`/`github`'s published
manifests carry `@profile-as-code/core` `0.1.1`, not `workspace:*` — the #301
rewrite is true on the registry doc. <!-- evidence: registry as_of=aa29880 kind=record --> But none of the five carries
`dist.attestations`, and no seam member has ever been published **by the cohort
step**. A rehearsal cannot close that: the first real cohort publish requires a
**release event that bumps at least one seam version**, and the tag is the
operator's act (kernel AGOS · `repo-governance` §release). When that run happens,
its id + date and a fresh reading of the commands above land in this section, and
the `CHANGELOG` records the shipped seam version.

### npm publish auth — trusted publishing (OIDC, issue #80) — **configured and validated**

**State as of the 0.3.0 publish (verified 2026-10-11, re-verified 2026-10-12):**

| Fact | Evidence |
|---|---|
| The publish went out over **OIDC**, with **no token present** | `workflow_dispatch` run `38109158435` (2026-10-11T03:40:45Z, `main`) — `success` |
| `NPM_TOKEN` is **deleted** in npm **and** in GitHub | the failing tag run (`38108069946`) logged `NODE_AUTH_TOKEN:` **empty** and `npm error code ENEEDAUTH` — npm obtained **no** credential, so OIDC was the only path available ([OFICIAL] `gh run view --log-failed`, #208) |
| The trusted publisher is **configured and exercised** | the run above is the proof: the exchange succeeded where no fallback existed |
| `0.3.0` is `latest` on npm | `registry.npmjs.org`, published **2026-10-11T03:43:27Z** ([OFICIAL] registry `time` field, re-checked 2026-10-12) |

The migration is therefore **complete**: the trusted publisher is configured and has been
exercised, and the token is gone. The `#### Migration history` block below is the record of the
sequencing that got here — read it as history, not as instructions.

The publish step authenticates with **trusted publishing (OIDC)**: `id-token: write` is
granted to the `publish` job, and the npm CLI exchanges that short-lived OIDC token for a
publish token, so no long-lived write credential is required ([WEB]
docs.npmjs.com/trusted-publishers, checked 2026-09-19). Each publish step performs the
exchange with its own client ([OFICIAL] dist of the pinned tool, inspected
2026-10-24): `pnpm publish` for the seam cohort — pnpm 11.20.0, the
`packageManager` pin, implements it: `lib/publish/oidc/{idToken,authToken,provenance}.js`
in its dist, exchanging the Actions OIDC token against the registry's
trusted-publishing endpoint (`/-/npm/v1/oidc/token/exchange/package/…`) — and
the **npm CLI** for the CLI package (the client that published 0.2.0–0.3.5).
An earlier revision of the cohort step asserted the opposite (packed with pnpm,
published via `npm publish` on a false "this pnpm lacks the exchange") — caught
by PR #309's round-1 review against the dist itself, corrected here.

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
  config already had. **This is the trap as of 0.3.0**: the fallback is now *gone* (secret deleted
  in npm and GitHub), so a failed exchange degrades straight to `ENEEDAUTH` with no earlier warning
  — which is exactly what the tag run reported (#208). The old mitigation of keeping `NPM_TOKEN`
  as a safety net no longer exists and is not coming back: the credential is what #80 removes.
  Diagnose an `ENEEDAUTH` here first.

#### The trigger race — measured per release (issue #208 → #307)

Measured, not inferred — the trigger that publishes changed with release `v0.3.5`:

| Trigger | Result | Evidence |
|---|---|---|
| `push` of tag `v0.2.0` | **failed** (`E403`, token without 2FA bypass) | run `37990886285` |
| `push` of tag `v0.3.0` | **failed** (`ENEEDAUTH`) | run `38108069946` |
| `workflow_dispatch` from `main` (v0.2.0) | **success** — published | run `38004121038` |
| `workflow_dispatch` from `main` (v0.3.0) | **success** — published | run `38109158435` |
| `workflow_dispatch` repeat (v0.3.0) | **failed**, benign (`cannot publish over the previously published versions: 0.3.0`) | run `38109376245` |
| `push` of tag `v0.3.5` | **success — published**: `publish` ✓ (OIDC, `dist.attestations` back), `release` ✓ (the Release page); the `site` deploy alone **failed** — no tag policy existed on the `github-pages` environment at that date (`tag v*` was added 2026-10-26; measured green on `v0.3.6`, run `40430800936`) | run `40059745390` ([OFICIAL] readings recorded in #307, 2026-10-24) |
| `workflow_dispatch` (v0.3.5, duplicate) | **failed**, benign (`409 — Cannot publish over previously staged version "0.3.5"`) — the dependent jobs then skip | run `40059765655` |
| `push` of tag `v0.3.6` | **success — full green cycle**: `publish` ✓ (cohort step: 5 explicit skips, already live; CLI `0.3.6` over OIDC + `dist.attestations`), `release` ✓, `site` deploy ✓ — the first tag run after the `tag v*` policy | run [`40430800936`](https://github.com/ChristianLuciani/profile-as-code/actions/runs/40430800936) (attempt 2; attempt 1 red on the seam OIDC exchange, `ERR_PNPM_AUTH_TOKEN_EXCHANGE` → `E404`) |

**The measured flip (2026-10-24, after PR #304):** with the exchange working and the source repo
public, the **tag run publishes and creates the Release** — the "dispatch publishes, the tag
announces" model describes the 2026-10-12 state, not today's. The page's recovery ran as the
documented override (`gh workflow run pages.yml --ref main -f ref=<commit> -f release=v0.3.5`,
run `40061075031`, success — footer included). What made the tag exchange work is **not
pinned**: the release-prep PR #304 touched no auth surface (`CHANGELOG.md`, `docs/`, the CLI
manifest, `site/index.html` only), so the enabling change lives outside this repo (npm
trusted-publisher settings / client behavior) — flagged in #307, not guessed here. Whether the
tag run, the dispatch or an environment change becomes CANONICAL **was decided on 2026-10-24**:
camino (c) — the tag run is the release path and the dispatch stays as the documented override
([ratification](https://github.com/ChristianLuciani/profile-as-code/issues/307#issuecomment-6386416707); option (b), dropping `push: tags`, discarded). The ratification names
the environment state it needs — a tag policy on `github-pages` — which **landed on 2026-10-26**
(`tag v*`), and its exit criterion: a measured cycle that does not confirm the new state sends
the reconciliation back to option (b). That measurement is #327 (I5); the `v0.3.6` tag run above **confirms the new state** — all four legs green — so the exit criterion does not return to option (b).

The first thing to inspect is the `job_workflow_ref` OIDC claim, which differs between the
two runs (`…/release.yml@refs/tags/v0.3.0` vs `…@refs/heads/main`): if npm validates that ref
against the default branch, the tag path cannot publish by design. **The definitive statement
of the current primary path, and of what a tag push does and does not do, is
[§"Releasing — the primary path"](#releasing--the-primary-path-issue-208) below.** This section
only records why the auth layer behaves the way it does.

- **No `--provenance` flag — npm decides.** npm attests only when all three hold: the OIDC
  exchange **succeeded**, the **source repo is public**, and the **package is public**
  ([WEB] docs.npmjs.com/trusted-publishers, "Automatic provenance generation"; the code reads
  `repository_visibility` from the OIDC token and re-queries the package's visibility via
  `libaccess.getVisibility`). **At the 0.3.0 publish only the first condition held** (the flip
  #293, 2026-10-24, clears the rest for future publishes):
  the 0.3.0 publish ran on a successful OIDC exchange, but the source repo is private, so
  `dist.attestations` is **absent** from the published manifest ([OFICIAL] registry
  `@profile-as-code/cli@0.3.0`, re-checked 2026-10-12). This is a documented limitation of the
  private repo — **not a pending task of this migration**, and not something a workflow change
  can fix. The flip (2026-10-24, #293) cleared it for the **next** publish: the CLI carries
  `dist.attestations` from `v0.3.5` on, and `v0.3.6` repeats it (run `40430800936`,
  2026-10-27); the five seam versions live at that date were published outside the workflow
  and carry none (#313). Versions published before the flip stay un-attested.

- **`repository.url` must match the GitHub repo.** npm validates
  `packages/cli/package.json` → `repository.url` against the repository the workflow runs in
  and fails the publish on a mismatch. The field is the canonical
  `git+https://github.com/ChristianLuciani/profile-as-code.git` (plus `directory: packages/cli`),
  which is correct for a monorepo package — re-check it if the repo is ever renamed or forked.

#### Migration history (complete — do not re-run)

The migration is **done and validated**. This is the record of what happened, kept because
the sequencing had a real trap in it (the trusted publisher requires the package to already
exist, so the first publish necessarily ran on the token). **Not instructions.**

1. **v0.2.0 (2026-10-09) went out with the `NPM_TOKEN` fallback** — the first publish, and
   the only one that could. The tag push failed (`E403`: the granular token had no 2FA
   bypass) and the version was published by the `workflow_dispatch` retry. The publish is
   what claims the `pasco` bin name; issue #44 is closed, its reservation task void by
   construction, because a name cannot be reserved without publishing it
   ([WEB: docs.npmjs.com, 2026-09-07]).
2. **The trusted publisher was configured** on npmjs.com → the package's settings →
   **Trusted Publisher** → GitHub Actions: Organization or user `ChristianLuciani`;
   Repository `profile-as-code`; Workflow filename `release.yml` (the filename with its
   extension, not a path); Environment name empty (this workflow uses no GitHub environment);
   Allowed actions: `npm publish` (staged publishing is always allowed).
   npm does **not** validate these fields when you save them: a typo surfaces only as
   `ENEEDAUTH` at publish time, and every field is case-sensitive.
3. **v0.3.0 (2026-10-11) confirmed the exchange** — published via `workflow_dispatch` from
   `main`, `success`, with the tag run failing `ENEEDAUTH` (see the table above). A
   `repository.url` mismatch would have surfaced here; it did not.
4. **`NPM_TOKEN` was deleted in npm *and* in GitHub** — the repository secret. Be precise
   about what that did and did not touch: the `NODE_AUTH_TOKEN` **env declaration is still
   on the publish step** (`release.yml:155`, `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`)
   and resolves to the empty string now that the secret is gone — that empty value is what
   the tag run's log shows. Removing the env line is possible but was not done, and is not
   needed: with no secret it can never carry a credential. **Do not re-add the secret** —
   the long-lived credential is exactly what #80 removes.

Scheduled deprecation this removed: the granular access token with 2FA bypass used for publish
loses direct publishing ~January 2027 ([WEB] github.blog changelog 2026-07-08). The repo no
longer depends on it.

> **Divergence closed (issue #208) — history, superseded 2026-10-24 (`v0.3.5`, #307).** An
> earlier revision of this runbook carried a "Known
> divergence" note here: `.github/workflows/release.yml:3–6` used to claim that pushing the tag
> *was* publishing, and the `Publish` step comment described `NPM_TOKEN` as a live fallback. Both
> were stale prose in a file a maintainer reads first. They have been **corrected in the
> workflow** — the header now states that the dispatch publishes and the tag announces, that a
> tag push shows a red run and creates no Release, and that there is no token fallback left.
> Comments only: no executable behaviour changed, so the guard, the trigger set, the
> tag|publish invariant and the `release` job's ordering are all untouched. **The runbook and the
> workflow now say the same thing.**

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

### Releasing — the primary path (issue #208)

**The trigger that publishes is the TAG push**, as ratified on 2026-10-24 — camino (c) of the
[#307 docket](https://github.com/ChristianLuciani/profile-as-code/issues/307#issuecomment-6386416707) — and `v0.3.5` is the measurement behind it (the flip and its runs live in
[§the trigger race](#the-trigger-race--measured-per-release-issue-208--307) above): the tag run
ran the guard, published the cohort + the CLI over OIDC, created the Release, and failed ONLY
the `site` deploy. That leg failed on that run for a reason that no longer applies: the `v*`
tag policy landed on `github-pages` on 2026-10-26 (`environments/github-pages/deployment-branch-policies`: `branch main`,
`branch gh-pages`, `tag v*`). The next tag run, `v0.3.6` (2026-10-27), **measured
the deploy leg green** (run `40430800936`, deployment `7349132043`) — #327's
measurement; the ratification's exit criterion is satisfied, not returned to
option (b). The 2026-10-12 decision recorded below — the dispatch primary, the tag announces —
describes the state in which the exchange failed outside `main`; it is history.

Do this in order:

1. Land the release preparation on `main` (bump `packages/cli/package.json`, add the
   `## [<version>] - <date>` section to `CHANGELOG.md`) — see
   ["Preparing a release"](#preparing-a-release-do-this-before-tagging).
2. **Push the tag** — `git tag v<version> && git push origin v<version>`. The tag now exists on
   origin (what `release-guard.mjs` requires), and the tag run IS the publish: the guard
   validates, the build and tests run, the seam cohort + the CLI publish over OIDC, and the
   Release page is created (measured on `v0.3.5`, 2026-10-24; the full green
   cycle is measured on `v0.3.6`, 2026-10-27 — run `40430800936`).
3. **Recover the page when its deploy failed.** Until 2026-10-26 that was the routine case (the
   `v0.3.5` shape: no tag policy on the environment). With the `v*` policy in place the tag run's
   deploy is measured green on `v0.3.6` (run `40430800936`), so this step is only for a deploy that
   failed:

   ```bash
   gh workflow run pages.yml --ref main -f ref="$(git rev-parse v<version>)" -f release="v<version>"
   ```

   (`ref` = the tag's commit; without the `release` input the footer line is omitted —
   `gen.mjs` renders it only with the label; measured twice, 2026-10-24, in #307's comments.)

   > **Do not add `-f dry_run=true` when you mean to publish.** That input is the harmless
   > smoke — it adds `--dry-run` to `npm publish` — but it also makes `release-guard.mjs`
   > return early, so the tag=publish, commit-identity and tagged-manifest invariants are
   > **NOT enforced** (the guard says so in its own log: *"the tag=publish, commit-identity
   > and tagged-manifest invariants are NOT enforced"*). A smoke run proves the pipeline
   > runs; it proves **nothing** about the release invariants. A real publish is
   > `gh workflow run release.yml --ref main` with **no** input.
4. **Retry only when the publish really failed.** A `workflow_dispatch` from `main` after a
   published tag is the documented benign duplicate — `409 Cannot publish over …` — whose
   dependent jobs skip: a red run that says nothing (`v0.3.5`: run `40059765655`). It is the
   path for an actual retry (a failed publish) or a deliberate dispatch, not a routine step.

   > **Do not add `-f dry_run=true` when you mean to publish.** That input is the harmless
   > smoke — it skips the tag guard, so the tag=publish, commit-identity and tagged-manifest
   > invariants are **NOT enforced** (the guard says so in its own log: *"the tag=publish,
   > commit-identity and tagged-manifest invariants are NOT enforced"*). A smoke run proves the
   > pipeline runs; it proves **nothing** about the release invariants. A real publish is the
   > tag push (step 2), with **no** dispatch needed.
5. **Verify** — the post-publish checks in
   ["Post-publish verification"](#post-publish-verification-issue-142), plus that the GitHub
   Release for the tag exists (the TAG run creates it; the dispatch only ever would, as a
   retry).

**What a tag push does — measured.** The tag run **publishes**
(OIDC with `dist.attestations`, the Release page created by the same run — `v0.3.5`'s run
`40059745390`), and since 2026-10-27 it also **deploys the page**: the `v0.3.6` tag run
(run `40430800936`, attempt 2, all four legs green) measured the `site` leg green after the
`v*` policy landed on 2026-10-26 (`tag v*` beside `branch main`/`branch gh-pages`,
`environments/github-pages/deployment-branch-policies`). That closes #327's exit criterion:
camino (c), ratified 2026-10-24
([ratification](https://github.com/ChristianLuciani/profile-as-code/issues/307#issuecomment-6386416707)),
makes the tag run the whole path, and the measured cycle confirms the new state — it does not
return the reconciliation to option (b). The `v0.3.5` deploy failure (deployment
`7293641310`, 2026-10-24) stays as the dated record that motivated the policy.

The historical reading stays as its dated record: while the exchange failed from a tag ref,
`v0.2.0`/`v0.3.0`'s tag runs failed at the **publish** step and created no Release — both
Release pages then came from the successful dispatch runs (e.g. the `v0.3.0` Release at
2026-10-11T03:42:42Z sits between the successful dispatch (03:40:45Z) and the npm publish
(03:43:27Z)).

**The mechanism question — decided: option (c) of the #208 docket, 2026-10-12.** The operator chose option (c) and
separately authorized this comments-only correction of the workflow's prose. The ratification is
recorded in the [#208 ratification comment](https://github.com/ChristianLuciani/profile-as-code/issues/208#issuecomment-6134905019)
(2026-10-12T23:57:07Z) — transcribed by the session because the authorization itself was given
off-repo, and attributed there as the operator's decision, not the session's. It supersedes the
earlier reconciliation comment, which had recorded the question as open. The three options were:

- **(a) Make the tag publish.** Diagnose the OIDC exchange on a tag ref (the `job_workflow_ref`
  claim vs npm's matching rules). **Rejected:** an investigation with **no evidence it is
  possible**, and the private source repo blocks attestation regardless, so it would not buy
  provenance.
- **(b) Make the tag an announcement only.** The tag push creates the Release and does **not**
  publish; the dispatch publishes. **Rejected on inspection:** it inverts the `release` job's
  dependency, and since `CHANGELOG.md` already carries the section at tag time, the tag push
  would publish a Release page **before the artifact exists on npm** — it trades a red run for a
  premature announcement, which is worse.
- **(c) Leave the workflow alone — CHOSEN.** The tag run stays red and creates no Release; the
  dispatch publishes and creates the Release. **Zero mechanism risk.** The cost is accepted
  deliberately: a tag push is a red run, and a future reader must be told not to "fix" it —
  which is why the workflow header now states it explicitly.

So "the tag announces" means: the tag **marks the version on origin** (the precondition
`release-guard.mjs` enforces) and its run is expected to fail; it does not publish and does not
create the Release. Step 2 above is a version marker, step 3 is the release. **The runbook and
the workflow now say the same thing** — the workflow's header comments were corrected to this
model in the same change, comments only.

**Superseded in substance, 2026-10-24 (issue #307):** the premise that died is "the tag run
cannot authenticate" — `v0.3.5`'s tag run published the artifact and the Release over OIDC,
failing only the `site` leg (the flip's measurements in [§the trigger race]). The 2026-10-12
decision (c) remains the dated record of what was decided and why. The mechanism question it
reopened was **decided on 2026-10-24**: camino (c) — the tag
run is the release path, the dispatch is the documented override, and option (b) (dropping
`push: tags`) is discarded ([ratification](https://github.com/ChristianLuciani/profile-as-code/issues/307#issuecomment-6386416707)). The environment change that ratification
assumes — a tag policy on `github-pages` — landed on 2026-10-26 (`tag v*`); #327's
measurement — the `v0.3.6` tag run (2026-10-27, run `40430800936`) — is the first measured
green cycle.

### Preparing a release (do this before tagging)

The Release page's notes are the `## [<version>]` section of `CHANGELOG.md`. The
pre-publish step validates that the section **exists and is non-empty** — it cannot
know whether it is *complete*, so this preparation is a human step:

1. Bump the version of every package whose content changed. The CLI's tag rule is
   unchanged: `packages/cli/package.json` `version` must equal the tag (enforced by
   the release guard). The five seam packages version independently — bump each
   changed one in the same preparation commit; a package whose version is already
   on the registry is skipped at publish (issue #301). **A seam bump is also what
   makes a release exercise the cohort publish**: without one, all five are skipped
   again and no seam member gains the attestation #313 is waiting on. Run
   `pnpm rehearse:release` on the prepared commit; it packs the bumped tarballs and
   asserts the order/manifests before the tag exists.
2. Move the release-worthy `[Unreleased]` entries under a new
   `## [<version>] - <date>` heading; keep forward-looking `### Planned` items under
   `[Unreleased]`.
3. If the release changes what the page claims (status, command set, version), update
   `site/index.html` **and** the version claim in `docs/USER-GUIDE.md` in the same preparation
   commit — the page is deployed from the released commit (#277), so a stale claim goes public.
   The pre-publish barrier scans every published surface (the landing plus each document
   projected into `site/docs/`) and fails when any `@profile-as-code/cli@<version>` disagrees
   with `packages/cli/package.json`. A version stated in another form is not gated: keep it
   canonical.
4. Commit that preparation to `main`, then `git tag v<version> && git push origin v<version>` —
   the tag push IS the publish (reconciled 2026-10-24; the order of the next steps is
   [§Releasing — the primary path](#releasing--the-primary-path-issue-208): the tag run
   publishes and creates the Release, the page follows with its override dispatch, and a
   `workflow_dispatch` from `main` is only the retry path — run after a published tag, it is
   the benign `409` duplicate).

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

```bash
npm view @profile-as-code/<pkg> version   # for each seam package whose version changed —
npm pack @profile-as-code/<pkg>@<version> # must match the manifest at the tag (issue #301);
publint ./profile-as-code-<pkg>-<version>.tgz   # pack + publint the tarball the same way
```

`attw` on the CLI tarball is informational by design (bin-only, no `types`
entry — see the publish chain above); `publint` is the check that matters
there. A failure at this point is a **post-mortem, not a rollback**: record it
in the CHANGELOG and fix forward in the next version.

## Project page — `.github/workflows/pages.yml`

The page is the entry surface for readers who do not arrive through the repository
(#201). What it says is versioned under `site/`; it is static HTML with no runtime — no
`<script>`, no external asset — and `scripts/site-check` enforces that on every page.

**It deploys from a RELEASE, not from `main`** (#277). A feature merged to `main` never
appears on the page before the release that ships it: the `site` job at the end of
`release.yml` calls `pages.yml` with the exact commit `publish` verified and shipped
(`needs.publish.outputs.commit`) and is gated on the same `needs.publish.outputs.tag`, so a
failed publish leaves the page at the previous release. `pages.yml` also exposes
`workflow_dispatch` as the explicit override — a page fix the operator decides not to wait a
release for.

Two barriers run **before** the irreversible publish, from that same commit: the docs must
project (`scripts/site-docs/gen.mjs` + `scripts/site-check`), and **every surface the page
publishes** — the landing and each document projected into `site/docs/`, read from their
canonical Markdown via `scripts/site-docs/site-config.mjs` — must state
`@profile-as-code/cli@<version>` equal to `packages/cli/package.json`
(`scripts/site-check/version-check.mjs`). Neither is recoverable after npm publishes.

### Documentation pages are a projection, not a copy

`site/docs/*.html` is generated from the Markdown (`USER-GUIDE`, `SPEC`, `CONTRIBUTING`,
`ROADMAP`) by `scripts/site-docs/gen.mjs`, using `marked` (GFM) and `github-slugger` (so
anchors are identical to GitHub's). That output is **gitignored**: the Markdown is the only
committed copy, so there is nothing to drift — a doc edit either projects or CI fails.
Local preview: `pnpm site` (project, then gate).

Links are rewritten at projection time: a projected document becomes a local `.html`, any
other repository path becomes its GitHub URL **at the deployed ref** (`SITE_REF`), never `main`.
Adding a document to `scripts/site-docs/site-config.mjs` is the only registration step; a
declared source that is missing fails the run instead of shrinking the page silently.

The same run emits the **site-root artifacts** (issue #279), all gitignored:

| Artifact | Note |
|---|---|
| `404.html` | served by Pages for unknown paths; `noindex` |
| `sitemap.xml` | one `<url>` per page; `lastmod` from `git log -1 -- <file>`. The deploy checkout is `fetch-depth: 0` on purpose: a shallow clone returns HEAD's date, so the generator omits the date instead of lying |
| `robots.txt` | **host-scoped** (RFC 9309): under `…github.io/<repo>/` crawlers never fetch it. Ships because it becomes correct with a custom domain |
| JSON-LD | `SoftwareApplication` on the landing (hand-authored with the page, `softwareVersion` included), `TechArticle` per document with `author`. The page gate allows exactly `<script type="application/ld+json">` and nothing else |
| `llms.txt` | llmstxt.org shape: summary, documents, and each document's `##` anchors |
| `AGENTS.md` | the same guide for a cold agent that reads the site rather than the repo |

Dates are the only non-deterministic input: `git log` makes them reproducible per commit, and
a shallow checkout makes them *absent* rather than wrong.

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
  -F "required_status_checks[contexts][]=sign-off" \
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
