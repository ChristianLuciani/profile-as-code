# `@profile-as-code/renderers-gumroad`

The **`gumroad`** renderer (v1.8, issue #133): the Gumroad creator profile
**profile body** paste-source, as deterministic plain text from a
`PlatformProfile` — the `compile()` slice of the SSOT.

The profile URLs (`<user>.gumroad.com`) are verified live (2026-10-05), but the
profile page is an SPA and the bio **field** is not verified `[?]`; the
per-platform skill follow-up sources it.

Pure function of the SSOT — no network, no AI, no randomness (SPEC §15.1).
Facts pass through untouched; texts are the platform+lang slice.

## Usage

```ts
import { compile, load } from "@profile-as-code/core";
import { render } from "@profile-as-code/renderers-gumroad";

const profile = load("/path/to/profile-data");
const { text } = render(compile(profile, "gumroad", "en"));
```

`pasco build gumroad` does exactly this and writes the artifact to
`profiles/gumroad/README.md`.

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

`deploySpec: "manual"` — no management API for the profile body, so the
artifact **is** the paste source and `pasco status --mark gumroad <surface>`
records the paste in the D18 ledger (`source: manual`, D9).

## Dependencies

`@profile-as-code/core`. The shared paste core (`pasteSource()`, #150) is this
adapter's extraction target
([#157](https://github.com/ChristianLuciani/profile-as-code/issues/157)).

See [SPEC §15](../../../docs/SPEC.md) · [repository README](../../../README.md).
