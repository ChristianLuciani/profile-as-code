# `@profile-as-code/renderers-substack`

The **`substack`** renderer (issue #483): a deterministic **paste sheet** for the
Substack profile and its publication, built from a `PlatformProfile` — the
`compile()` slice of the SSOT.

Pure function of the SSOT — no network, no AI, no randomness, no timestamp
(SPEC §15.1). Facts pass through untouched; texts are the platform+lang slice.

## Usage

```ts
import { compile, load } from "@profile-as-code/core";
import { render } from "@profile-as-code/renderers-substack";

const profile = load("/path/to/profile-data");
const { text } = render(compile(profile, "substack", "en"));
```

`pasco build substack` does exactly this and writes the artifact to
`profiles/substack/README.md`.

## The sheet

One `Field: value` line per fact, in this order; a line whose fact the SSOT does
not declare is omitted, never filled with a placeholder:

```
# Substack — <identity.name> (<lang>)
Handle: @<handle>
Display name: <identity.name>
Bio (profile): <bios[substack,short]>
About: <bios[substack,long]>
Links: <identity.links — URLs only, declaration order>
Publication: <newsletter.name>
Short description: <newsletter.description>
Cadence: <newsletter.cadence>
Canonical: <newsletter.url>
```

- **Handle** prefers a claimed `socialHandles` row for `substack`, then falls
  back to `identity.handle`; the leading `@` is stripped and printed once.
- **Bio (profile)** and **About** read the `short` and `long` rows that
  `compile()` already filtered by exact platform+lang (bio rows do not fall back
  to `en`). A lone `medium` row — legal, and the shape several fixtures use — is
  promoted to **Bio (profile)**; with `short`+`medium` (no `long`) the `medium`
  row becomes **About**. When all three lengths exist, `medium` is the middle
  variant and stays unpublished (the sheet has exactly two body fields). A
  whitespace-only row is absent, so it neither shadows a real row nor satisfies
  the empty guard.
- **Publication** and **Short description** are RAW langMaps on the slice;
  they are resolved with core's `textOf(..., lang)` (#415), which owns the
  `es`→`en` fallback. The renderer never re-implements it. Only a
  `platform: substack` newsletter is consumed: `compile()` passes the block into
  every platform slice and the schema admits `ghost`, so a Ghost-only workspace
  must not receive a Substack sheet.
- **Links** are `identity.links[].url`, the one URL home (SPEC §15.4) — no
  duplicated or handle-derived URL.

No substack bio row **and** no substack `newsletter` block → `""`; the build
**unbuilds** that platform's output and leaves no artifact on disk (§15.1).
Either body alone is enough to emit the sheet.

## Deploy

`deploySpec: "manual"` — Substack has no public body-write API for the profile
or the publication (SOTA-2026 §5), so the artifact **is** the paste source and
`pasco status --mark <ledgerKey> substack` records the deploy in the D18 ledger
(`source: manual`, D9). `pasco status` prints the ledger key of each unit.

## Dependencies

`@profile-as-code/core` (the `PlatformProfile` type + `textOf`).

See [SPEC §7](../../../docs/SPEC.md) · [skills/substack](../../../skills/substack/).
