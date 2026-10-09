# `@profile-as-code/renderers-buymeacoffee`

The **`buymeacoffee`** renderer (v1.8, issue #133): the Buy Me a Coffee
creator page **profile body** paste-source, as deterministic plain text from a
`PlatformProfile` — the `compile()` slice of the SSOT.

The paste surface (About) is **not verified yet** `[?]` — bot-blocked / JS
pages, probed 2026-10-05; the per-platform skill follow-up sources it.

Pure function of the SSOT — no network, no AI, no randomness (SPEC §15.1).
Facts pass through untouched; texts are the platform+lang slice.

## Usage

```ts
import { compile, load } from "@profile-as-code/core";
import { render } from "@profile-as-code/renderers-buymeacoffee";

const profile = load("/path/to/profile-data");
const { text } = render(compile(profile, "buymeacoffee", "en"));
```

`pasco build buymeacoffee` does exactly this and writes the artifact to
`profiles/buymeacoffee/README.md`.

## Contract

Exactly ONE `bios` row reaches the surface, verbatim — `long` (the free-form
main body) > `medium` > `short` (the compact one-liner slot); the page's main
profile text is the longest curated bio. Never a merge: the D18 ledger hashes
exactly one row per entry (§19.1), so a composite would hash something no
single row owns and `pasco diff`/`status` staleness could never match.

No row → `""` → the build **unbuilds** that platform's output (no artifact left
on disk, §15.1). `compile()` filters `bios` by EXACT platform+lang — bio rows
do **not** fall back to `en` — so a missing lang yields an empty artifact, and
no renderer-side lang override is offered (the bios are already the compile()
slice, so it would be dead code).

## Deploy

`deploySpec: "manual"` — no management API for the profile body, so the
artifact **is** the paste source and `pasco status --mark bios:<platform>:<lang>:<length> <platform>` records the
paste in the D18 ledger (`source: manual`, D9) — the ledger key is the row the
artifact hashes (§19.2), the surface is positional.

## Dependencies

`@profile-as-code/core` (the `PlatformProfile` type) and
`@profile-as-code/paste` — this adapter delegates to the shared paste core
(`pasteSource()`, #150/#157) rather than re-implementing the invariant.

See [SPEC §15](../../../docs/SPEC.md) · [repository README](../../../README.md).
