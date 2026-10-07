# `@profile-as-code/renderers-hotmart`

The **`hotmart`** renderer (v1.9, issue #137): the Hotmart storefront
**profile body** paste-source, as deterministic plain text from a
`PlatformProfile` — the `compile()` slice of the SSOT.

The surface field is **not verified** `[?]` — there is no public documentation
of a profile About/body field, and probes of the JS-rendered SPA 404'd
(2026-10-05); the per-platform skill follow-up sources it.

Pure function of the SSOT — no network, no AI, no randomness (SPEC §15.1).
Facts pass through untouched; texts are the platform+lang slice.

## Usage

```ts
import { compile, load } from "@profile-as-code/core";
import { render } from "@profile-as-code/renderers-hotmart";

const profile = load("/path/to/profile-data");
const { text } = render(compile(profile, "hotmart", "en"));
```

`pasco build hotmart` does exactly this and writes the artifact to
`profiles/hotmart/README.md`.

## Contract

Exactly ONE `bios` row reaches the surface, verbatim — `long` (the free-form
main body) > `medium` > `short` (the compact one-liner slot); the profile body
is the page's main profile text, so the longest curated bio wins. Never a
merge: the D18 ledger hashes exactly one row per entry (§19.1), so a composite
would hash something no single row owns and `pasco diff`/`status` staleness
could never match.

No row → `""` → the build **unbuilds** that platform's output (no artifact left
on disk, §15.1). `compile()` filters `bios` by EXACT platform+lang — bio rows
do **not** fall back to `en` — so a missing lang yields an empty artifact, and
no renderer-side lang override is offered (the bios are already the compile()
slice, so it would be dead code).

## Deploy

`deploySpec: "manual"` — the documented `developers.hotmart.com` APIs cover
sales/products, not the profile body `[?]`, so the artifact **is** the paste
source and `pasco status --mark hotmart <surface>` records the paste in the D18
ledger (`source: manual`, D9).

Fees and eligibility follow the official legal texts, fetched 2026-10-05 — see
[skills/hotmart/research/SOTA-2026.md](../../../skills/hotmart/research/SOTA-2026.md).

## Dependencies

`@profile-as-code/core`. The shared paste core (`pasteSource()`, #150) is this
adapter's extraction target
([#157](https://github.com/ChristianLuciani/profile-as-code/issues/157)).

See [SPEC §15](../../../docs/SPEC.md) · [skills/hotmart](../../../skills/hotmart/).
