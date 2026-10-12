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
skills · links (the contact email first, then every `identity.links[]` entry,
all visible) · evidence registry (`public` entries only, §18.5) · `schema.org`
Person JSON-LD · generated footer with a fact count.

The JSON-LD `sameAs` set is a **different, overlapping** set — not a subset of
that visible list: it drops the contact email and adds the claimed
`socialHandles[].url` entries (which the visible list never prints), and it
carries only `role: realization` links plus claimed handles. It is assembled by
core (`structured-data.ts`) — this renderer never re-derives `@id`/`sameAs`
(§15.4).

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

## Live-verification capability (§19.5, issue #212)

The adapter also declares how `pasco status --verify` can judge the **live**
artifact, so the ledger anchors a value that can be compared back. Three exports,
one home (the artifact's producer owns both directions of it — D5):

| Export | Meaning |
|---|---|
| `extractArtifact(text)` | The canonical projection: the engine-owned region (§15.3, opening header → **last** generated footer), with platform/transport chrome (BOM, CRLF, a preamble above, an appendix below) stripped. Both bounds take the **last** match, so an H1 inside a chrome preamble cannot open the artifact and a copy of the footer literal inside it cannot close it early. Pure, offline, idempotent. The **caller** hashes it (SHA-256); the renderer never hashes. |
| `fetchHosts` | The fetch allowlist `["raw.githubusercontent.com"]`. `--verify` validates the derived URL's host against it **before** any request (the workspace is untrusted input). |
| `artifactUrl(profile)` | The live URL, derived from the URL SSOT alone (`identity.links` / the declared **claimed** handle matrix): `https://raw.githubusercontent.com/<owner>/<owner>/HEAD/README.md`. `null` when nothing here names this surface (`no-artifact-url`) — a pending handle, or a sibling surface's link, declares nothing. |

`HEAD` resolves the owner's default branch, so no branch is hand-maintained.
Declared v1 limit: content a human adds **outside** the engine's region (above
the header or below the footer) is not part of the artifact, so it is not judged;
content inside it is, and an edit there reads `out-of-band-drift`.

## Dependencies

`@profile-as-code/core` · `@profile-as-code/markdown`.

See [SPEC §15](../../../docs/SPEC.md) · [skills/github-readme](../../../skills/github-readme/).
