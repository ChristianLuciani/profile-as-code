# `@profile-as-code/github`

The **shared GitHub owner resolution** of [SPEC §19.5](../../docs/SPEC.md) (issue
#224, the residual #216 declared; the route grammar of #227): the one place a
workspace candidate — a URL or a declared handle — becomes a GitHub owner, or is
refused. A renderer support package, the `packages/paste` / `packages/artifact`
precedent, so the engine stays an engine (AGENTS.md rule 7).

`github-readme` and `github-org` derive the owner of the artifact they publish
from the workspace's URL SSOT, and the two copies were byte-identical. They had
already received the same review fixes in #212 — F2 (GitHub's reserved `orgs/`
route, where reading the prefix itself derived `orgs/orgs/…`, a URL for someone
else's page) and F5 (trailing/doubled hyphens and the 40-character cap) — which is
exactly the hazard: the next fix applied to one file would have left the other
surface deriving a **different owner** for the same workspace. The owner is what
the `evidenceUrl` and the fetched artifact are derived from, so a divergence here
silently certifies a different URL. It lives here **once**; every GitHub adapter
delegates (`createGithubOwnerResolver`), never re-implements.

What stays with the surface is genuine per-surface DATA — and it still lives in
the adapter:

- `GITHUB_LINK_PLATFORMS` — which `identity.links[].platform` values can name that
  surface (a `github-readme` link must not name the org surface, or a workspace
  could name two different owners);
- the URL template (`/<owner>/<owner>/HEAD/README.md` vs `/<org>/.github/HEAD/
  profile/README.md`) ;
- `fetchHosts`, the fetch allowlist.

The split has a third party: the §19.5 *projection* (the bound + transport
normalization) is generic over every markdown artifact the engine renders and
lives in `@profile-as-code/artifact` (#216). This package is the GitHub half;
neither absorbs the other.

## Usage

```ts
import { createGithubOwnerResolver } from "@profile-as-code/github";

const GITHUB_LINK_PLATFORMS = new Set(["github", "github-readme"]);

/** The owner this surface publishes under, or `null` — the honest
 *  `no-artifact-url` rung (§19.5 row 2), never a guess. */
export const githubOwner = createGithubOwnerResolver({
  surface: "github-readme",
  linkPlatforms: GITHUB_LINK_PLATFORMS,
});

export function artifactUrl(profile: Profile): string | null {
  const owner = githubOwner(profile);
  return owner === null ? null : `https://raw.githubusercontent.com/${owner}/${owner}/HEAD/README.md`;
}
```

Three values, one table, and three types:

- `createGithubOwnerResolver(binding)` — bind the resolution to ONE surface's
  declaration. The returned function carries a **non-writable** `surface` property
  and the declaration itself, `linkPlatforms`, **snapshotted and sorted** at
  construction (so a caller mutating the Set it passed cannot move the matching
  behind the declaration). It is registered with this module, which is what
  `isGithubOwnerResolver` checks. Carrying the declaration is load-bearing: the
  conformance body reads it **from the resolver** and asserts it against the
  contract, so a widened or narrowed platform set fails in the adapter's own suite
  instead of only at a distance — a body that took the set as an option would let
  the caller re-type it in the test, which is the copy #224 removes, one level up.
- `resolveGithubOwner(profile, binding)` — the same resolution, unbound
  (one-shot consumer or test).
- `isGithubOwnerResolver(value)` — true **only** for a function this package
  produced: the mechanical form of "the adapter delegates, it does not
  re-implement it", which is what makes a one-file divergence fail CI.
- `RESERVED_ROUTES` — GitHub's reserved first-segment route table (#227): the data
  the rule quantifies over, one row per prefix with its `kind`, its rationale and
  the route GitHub itself served on the probe date. Exported so a consumer can read
  the grammar instead of re-typing it, and so this package's own suite can pin its
  shape (duplicate, non-lowercase or unsourced rows all fail).
- the `GithubOwnerResolver` / `GithubSurfaceBinding` / `ReservedRoute` types.

A binding must be coherent: `linkPlatforms` has to contain `surface` itself.
Anything else **throws** — that guard is deliberate, because the shape it refuses
is the copy-paste this package exists to remove (an adapter left carrying its
sibling's platform set). Left unchecked it does not crash: it silently answers
`null` for every valid link and reports the honest-looking `no-artifact-url` rung
for an artifact the surface does publish. A call-site bug must not be reportable
as a verdict.

## The workspace with no GitHub at all

This is not a corner case — it is every user who has no GitHub — and the
resolution answers `null` for it, which is what keeps the pass honest:

- the adapter derives no owner, so `artifactUrl(profile)` is `null`;
- the CLI still DECLARES the surface (`null` is the `no-artifact-url` rung, not
  the lie `no-extractor`), and `core`'s `declaredReason` reads that rung;
- the pass therefore makes **no request** and writes **no ledger row**
  (`verifySurface` returns `{ fetched: false, write: false }`), and the verdict is
  `unverifiable: no-artifact-url` — derived at read time, never recorded.

If this resolution ever derived an owner for such a workspace, `--verify` would
fetch `raw.githubusercontent.com` and write durable `unverifiable: http-404`
evidence into the user's ledger, where today there is nothing. The corpus pins it
on both surfaces.

## Conformance

Every GitHub adapter runs ONE shared body instead of copying a suite, and bridges
the corpus to a workspace the engine actually accepts (through `load()`, D12):

```ts
import { describe } from "vitest";
import { describeGithubOwnerConformance } from "@profile-as-code/github/conformance";
import { artifactUrl, githubOwner } from "../src/index.js";

describe("github-readme owner capability", () => {
  describeGithubOwnerConformance({
    surface: "github-readme",
    githubOwner, // carries the declared binding; the body reads it back
    artifactUrl,
    profileWith, // (workspace) => load(...) — the adapter owns its flavor
  });
});
```

Note what is NOT passed: the platform set. The adapter declares it once, in
`createGithubOwnerResolver`, and the body reads that declaration back from the
resolver and asserts it equals the contract (the `github` alias plus the surface's
own slug) — so a widened set fails in the adapter's own suite. Taken as an option
instead, the test could re-type it and a divergence would only fail at a distance.

The body asserts that declaration, the delegation (identity), agreement with the
canonical rule and with `resolveGithubOwner` on every corpus workspace, the expected
owner for each case — the positive rungs, the F3 ordering, the F2/F5 refusals, the
reserved route grammar of #227 (both kinds of route row, the ownerless prefix, the
encoded and case-variant spellings) and the no-GitHub negatives, whose family is
itself guarded against erosion — and that the `null` rung stays coherent with the
public `artifactUrl` seam.

`./conformance` is a test-only subpath (it imports vitest); the runtime entry
(`@profile-as-code/github`) stays free of the test tool.

## The reserved route grammar (#227)

`github.com/<first segment>` is not always `<owner>`. GitHub resolves a set of
**reserved first segments** to its own pages, and reading one of them as the owner
derived `raw.githubusercontent.com/<prefix>/<prefix>/…` — a URL for someone else's
path — which `--verify` fetched and recorded as durable `http-404` evidence, **with
that wrong `evidenceUrl`**, in the user's ledger. That is the F2 harm class of #212,
which #224 shipped closed for `orgs/` only; #227 closes it for **every prefix
admitted by the test below** — 65 rows, and the boundary is mechanical rather than a
judgement call (the first revision drew it by hand and a fresh review found 26 more
routes, #232 review F1). Before:

```console
$ node --input-type=module -e '…resolveGithubOwner(link, binding)…'
https://github.com/sponsors/elenavasquez     -> "sponsors"     ← a stranger's path
https://github.com/topics/typescript         -> "topics"
https://github.com/settings/profile          -> "settings"
https://github.com/apps/someapp              -> "apps"
https://github.com/orgs/elenavasquez         -> "elenavasquez"  ← the ONE route #212 handled
```

After: `sponsors/…` → `elenavasquez`; every route that belongs to GitHub rather
than to an account → `null`, i.e. the honest `no-artifact-url` rung (no request,
no ledger row).

The grammar is ONE table, `RESERVED_ROUTES`, and each row answers two questions in
order: is the first segment a route at all, and if so does its page belong to ONE
account? `owner-after-prefix` means the next segment IS that account's own page
(`/orgs/<org>` and `/sponsors/<account>` both resolve to the account's page);
`no-owner` means the page is GitHub's (`/topics/<topic>`, `/marketplace/<listing>`,
`/apps/<slug>`, the marketing and program pages, the viewer's own hubs), so there is
no owner. The bug is one harm class, not one route: a `||` would have closed
`sponsors` and left the class open for `topics`, `apps`, `settings`, … — so the fix
is the rule, plus the sourced data it quantifies over.

### The admission test (how a prefix becomes a row)

Both halves, re-run for every row on 2026-10-15 — this is what a new row must show,
and what a stale row fails:

```console
$ gh api /users/<prefix> -q .login          # → 404 (error): the login is FREE,
                                            #   so refusing it cannot cost a real owner
$ curl -sL -A 'Mozilla/5.0' -w '%{http_code} %{url_effective}' https://github.com/<prefix>
                                            # → 200 and GitHub's own page
```

The web-side corroboration is the case variant: a route's all-caps spelling is a
404 (`/README`, `/SPARK`, `/OPEN-SOURCE`), while an ACCOUNT answers in every casing
(`/WWW`, `/Profile`/`/PROFILE`). **A name a live account holds is never a row**,
whatever its lowercase page looks like: `profile`, `www`, `customer-stories`,
`careers`, `actions`, `docs`, `dependabot`, … are all `200` from `/users/<name>`.
`customer-stories` is the trap that makes the check load-bearing — its lowercase
spelling is GitHub's marketing page while `/CUSTOMER-STORIES` is a live profile, so
a row there would read `no-artifact-url` for a workspace that does publish.

Three decisions the table records rather than hides:

- **Decode first, match case-insensitively.** GitHub routes the *decoded* segment
  (`/%73ponsors/<account>` → the account's page) and its account *namespace* is
  case-insensitive (`/Elenavasquez` serves the same account), so a reserved name is
  unavailable as an account in every spelling. Matching the raw segment would leave
  a percent-encoded bypass; matching the exact case would leave a one-keystroke
  bypass (`/SPONSORS/<account>`, probed 404, would read `SPONSORS` as an owner).
- **`stars` is `no-owner`, deliberately.** `/stars/<account>` does name that account
  (probed), so `owner-after-prefix` is defensible — but #227 decides `null`, and the
  conservative direction is the honest one: a lost verification is recoverable, a
  wrong URL is durable wrong evidence. Flipping the kind is one word of data.
- **`profile` is NOT a row.** #227 listed it beside `settings`, but `settings/`
  already covers `github.com/settings/profile`, and `github.com/profile` is a
  **live account** (probed: 200, `og:type` `profile`, `/users/profile` → `Profile`).
  A row here would refuse a real owner and read `no-artifact-url` for a workspace
  that does publish. The list is decided by the test, not copied.

**Declared limit, now precise.** Every row passed the admission test, and the
suite pins the full kind partition as a literal oracle plus a behavioural sweep, so
a row is either admitted with evidence or absent on purpose. What is still **not**
covered is narrower and named:

- names GitHub reserves but never serves as a first-segment page (`api`, `legal`,
  `packages`, … — the test's page half is unobservable signed-out), and the long tail
  of reserved *names* that are not routes at all (a few hundred, community-maintained,
  not enumerable offline). A first segment that is neither a row nor an account still
  reads as an owner: the residual F2 class, now one admission test away.
- the admission test needs the network (`gh api`), so it cannot be a CI gate: the
  evidence is recorded per row and re-runnable by hand. A name GitHub retires, or
  assigns later, shows up as a stale row — not as a red suite.

**Declared cost, measured.** `pnpm build` at `d0e6039` → this branch's head
(2026-10-15): `packages/github/dist/index.js` 8,421 → 26,284 bytes, and the CLI
bundle (tsup) 198.65 → 210.69 KB (`packages/cli/dist/index.js` 203,453 → 215,795
bytes). The rows' `why`/`observed` are shipped string fields (~10.1 KB of the
package's growth); the documentation comments are stripped by the bundler.
Widening this to the name list is its own decision, with its own source.

## Dependencies

`@profile-as-code/core` for the `Profile` type only. `vitest` is an optional peer,
needed only by `./conformance`.

See [SPEC §19.5](../../docs/SPEC.md) · [repository README](../../README.md).
