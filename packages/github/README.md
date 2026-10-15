# `@profile-as-code/github`

The **shared GitHub owner resolution** of [SPEC §19.5](../../docs/SPEC.md) (issue
#224, the residual #216 declared): the one place a workspace candidate — a URL or
a declared handle — becomes a GitHub owner, or is refused. A renderer support
package, the `packages/paste` / `packages/artifact` precedent, so the engine stays
an engine (AGENTS.md rule 7).

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

Three values and two types, no more:

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
- the `GithubOwnerResolver` / `GithubSurfaceBinding` types.

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
owner for each case — the positive rungs, the F3 ordering, the F2/F5 refusals and
the no-GitHub negatives, whose family is itself guarded against erosion — and that
the `null` rung stays coherent with the public `artifactUrl` seam.

`./conformance` is a test-only subpath (it imports vitest); the runtime entry
(`@profile-as-code/github`) stays free of the test tool.

## Declared limit — reserved GitHub routes (#227)

The resolution special-cases exactly ONE of GitHub's reserved first segments
(`orgs/`), so the others are still read as owners: a workspace whose only GitHub
entry is a Sponsors page derives `raw.githubusercontent.com/sponsors/sponsors/…`,
which `--verify` would fetch and record as durable evidence for a stranger's path.
That is inherited from #212 (the same class as the F2 fix) and deliberately **not**
changed by #224, whose acceptance criterion is "no behavior change for a valid
workspace" — the route table is its own decision, argued route by route with a
source: **#227**. Until it lands, such a workspace reads a wrong URL instead of the
honest `no-artifact-url`.

## Dependencies

`@profile-as-code/core` for the `Profile` type only. `vitest` is an optional peer,
needed only by `./conformance`.

See [SPEC §19.5](../../docs/SPEC.md) · [repository README](../../README.md).
