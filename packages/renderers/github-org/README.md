# `@profile-as-code/renderers-github-org`

The **`github-org`** renderer (M6, brand flavor, SPEC §17): a deterministic,
byte-stable org `README.md` from a **brand** `PlatformProfile` — the `compile()`
slice of the SSOT.

Pure function of the SSOT — no network, no AI, no randomness. Facts pass
through untouched; texts are the platform+lang slice (brand langMaps fall back
to `en`).

## Usage

```ts
import { compile, load } from "@profile-as-code/core";
import { render } from "@profile-as-code/renderers-github-org";

const profile = load("/path/to/profile-data"); // flavor: brand
const { text } = render(compile(profile, "github-org", "en"));
```

`pasco build github-org` does exactly this and writes the result to
`profiles/github-org/README.md`.

## Output

Ordered, deterministic sections: header (org name · tagline · mission) · social
handles (the claimed matrix, one badge per platform) · newsletter · podcast ·
press · audiences (reader profile) · every link (visible list) · `schema.org`
Organization JSON-LD · generated footer with a fact count.

The JSON-LD is assembled by core (`structured-data.ts`, v1.6/#103): `@id` from
the `role: identity` link, `sameAs` from the `role: realization` links plus
claimed handles. No `role: identity` link → no `@id` — it is never invented.

## Deploy

`deploySpec: "git"` (D9) — the output lands in a git-tracked file.

## Live-verification capability (§19.5, issue #212)

Same class as `github-readme`: the §17 org README carries the same header →
generated-footer boundary (§15.3's shape, for this surface) and the adapter
declares
`extractArtifact` (the canonical projection — the engine-owned region bounded by
the last header above the LAST generated footer, chrome stripped; pure, offline,
idempotent; the caller hashes), `fetchHosts` (`["raw.githubusercontent.com"]`)
and `githubOwner`/`artifactUrl`, derived from the URL SSOT (§15.4/§18.4) —
`identity.links` first (the canonical URL set), then the **claimed** handle
matrix:
`https://raw.githubusercontent.com/<org>/.github/HEAD/profile/README.md`
(`HEAD` resolves the default branch; measured 2026-10-12,
`raw.githubusercontent.com/nodejs/.github/HEAD/profile/README.md` → 200
`[BENCHMARK]`). Both sibling surfaces resolve in that same order, so one
workspace cannot name two different owners — the rule itself lives once, in
`@profile-as-code/github` (#224), and `githubOwner` is exported so the shared
conformance body can prove this adapter delegates it. `null` when the brand
declares no GitHub org surface (`no-artifact-url`) — a pending handle, or a
`github-readme` link (the personal sibling surface), declares nothing, and no
request is made.

## Dependencies

`@profile-as-code/core` · `@profile-as-code/markdown` (CommonMark escaping for
destinations and labels — never re-implemented in an adapter, §15.2) ·
`@profile-as-code/artifact` · `@profile-as-code/github`.

See [SPEC §17](../../../docs/SPEC.md) · [skills/github-org](../../../skills/github-org/).
