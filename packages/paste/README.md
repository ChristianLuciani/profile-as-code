# `@profile-as-code/paste`

The **shared paste-renderer core** (#150, re-homed in #157): `pasteSource()` and
the conformance body every paste adapter runs. A renderer support package — the
`packages/markdown` precedent — so the engine stays an engine (AGENTS.md rule 7).

## Usage

```ts
import { compile, load } from "@profile-as-code/core";
import { pasteSource } from "@profile-as-code/paste";

const slice = compile(load("/path/to/profile-data"), "kofi", "en");
const text = pasteSource(slice);
```

`pasteSource(slice)` returns EXACTLY ONE `bios` row's verbatim text + `"\n"` —
length priority `long` > `medium` > `short`, never a merge (the D18 ledger
hashes exactly one row per entry, SPEC §19.1). No row → `""` → the build
**unbuilds** (§15.1). This module is blind to platform, voice and framing; the
adapter's skill owns the narrative.

## Conformance

Every paste adapter delegates its shared guarantee to ONE body instead of copying
a suite. The adapter's `tests/render.test.ts` keeps only its platform facts:

```ts
import { describe, expect, it } from "vitest";
import { describePasteConformance, pasteRow, pasteSlice } from "@profile-as-code/paste/conformance";
import { deploySpec, render } from "../src/index.js";

describe("kofi renderer", () => {
  describePasteConformance({ platform: "kofi", render });

  it("declares the manual deploy spec and no assets", () => {
    expect(deploySpec).toBe("manual");
    const slice = pasteSlice("kofi", pasteRow("kofi", "long", "Body."));
    expect(render(slice).assets).toBeUndefined();
  });
});
```

`./conformance` is a test-only subpath (it imports vitest); the runtime entry
(`@profile-as-code/paste`) stays free of the test tool.

## Dependencies

`@profile-as-code/core` (the `PlatformProfile` type and, for the conformance
harness, `compile`/`load`). `vitest` is an optional peer, needed only by
`./conformance`.
