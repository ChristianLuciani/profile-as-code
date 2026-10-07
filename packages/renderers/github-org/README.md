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

## Dependencies

`@profile-as-code/core` · `@profile-as-code/markdown` (CommonMark escaping for
destinations and labels — never re-implemented in an adapter, §15.2).

See [SPEC §17](../../../docs/SPEC.md) · [skills/github-org](../../../skills/github-org/).
