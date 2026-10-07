# `@profile-as-code/renderers-kofi`

The **`kofi`** renderer (v1.7, issue #130): the Ko-fi creator page **About**
paste-source, as deterministic plain text from a `PlatformProfile` — the
`compile()` slice of the SSOT.

Pure function of the SSOT — no network, no AI, no randomness (SPEC §15.1).
Facts pass through untouched; texts are the platform+lang slice.

## Usage

```ts
import { compile, load } from "@profile-as-code/core";
import { render } from "@profile-as-code/renderers-kofi";

const profile = load("/path/to/profile-data");
const { text } = render(compile(profile, "kofi", "en"));
```

`pasco build kofi` does exactly this and writes the artifact to
`profiles/kofi/README.md`.

## Contract

Exactly ONE `bios` row reaches the surface, **verbatim** — `long` > `medium` >
`short`. The row is neither added to nor stripped of Markdown/HTML, so a
markdown-bearing row arrives at the paste target as-is; keeping the row plain
is the skill's job (`skills/kofi/research` owns the sourced formatting rules,
applied by a human step). Never a merge: the D18 ledger hashes exactly one row
per entry (§19.1), so a composite would hash something no single row owns and
staleness could never match.

No row → `""` → the build **unbuilds** that platform's output (no artifact left
on disk, §15.1). `compile()` filters `bios` by EXACT platform+lang — bio rows
do **not** fall back to `en` — so a missing lang yields an empty artifact; the
skill's lang rule is what surfaces that gap to the operator.

## Deploy

`deploySpec: "manual"` — Ko-fi has no write API for the About section, so the
artifact **is** the paste source and `pasco status --mark kofi <surface>`
records the paste in the D18 ledger (`source: manual`, D9).

## Dependencies

`@profile-as-code/core` — this adapter delegates to the shared paste core
(`pasteSource()`, #150) rather than re-implementing the invariant.

See [SPEC §15](../../../docs/SPEC.md) · [skills/kofi](../../../skills/kofi/) ·
[issue #157](https://github.com/ChristianLuciani/profile-as-code/issues/157)
(sibling adapters still to migrate).
