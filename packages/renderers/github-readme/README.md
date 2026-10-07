# `@profile-as-code/renderers-github-readme`

The **`github-readme`** renderer (M2, SPEC §15): a deterministic, byte-stable
`README.md` from a `PlatformProfile` — the `compile()` slice of the SSOT.

Pure function of the SSOT — no network, no AI, no randomness. Facts pass
through untouched; texts are the platform+lang slice, with `en` falling back
for langMaps.

## Usage

```ts
import { compile, load } from "@profile-as-code/core";
import { render } from "@profile-as-code/renderers-github-readme";

const profile = load("/path/to/profile-data");
const slice = compile(profile, "github-readme", "en");
const { text, assets } = render(slice);
```

`pasco build github-readme` does exactly this and writes the result to
`profiles/github-readme/README.md`, bundling the media the renderer declares.

## Output

Ordered, deterministic sections (§15.3): header (name · headline · identity
badges) · statement · featured projects · publications (DOI-resolvable) ·
skills · links (`sameAs`) · evidence registry (`public` entries only, §18.5) ·
`schema.org` Person JSON-LD · generated footer with a fact count.

Nothing is invented: every line comes from the SSOT, and an empty accessor is
absent rather than rendered blank.

## Assets (M8/D19)

`assets?: string[]` declares the deploy-relative targets the text references
(`assets/<id>/<basename>`). The build owns the I/O: it collects the media
bundle, copies exactly the referenced targets, and writes
`assets/manifest.json`. A `path` locator whose bytes the build did not bundle
emits no link — byte-identical to the pre-M8 output. Renderers never touch the
filesystem and never emit a workspace-internal path (D14).

Markdown destinations go through `@profile-as-code/markdown` (§15.2) — the
escaping rule is never re-implemented here.

## Deploy

`deploySpec: "git"` (D9) — the output lands in a git-tracked file.

## Dependencies

`@profile-as-code/core` · `@profile-as-code/markdown`.

See [SPEC §15](../../../docs/SPEC.md) · [skills/github-readme](../../../skills/github-readme/).
