# `@profile-as-code/artifact`

The **canonical artifact projection** of [SPEC §19.5](https://github.com/ChristianLuciani/profile-as-code/blob/main/docs/SPEC.md) (issue
#216, follow-up of #212): the bound — *"the engine-owned region opens at the last
header above its terminus and closes at the last generated footer"* — plus the
transport normalization (BOM, CRLF/CR). A renderer support package, the
`packages/paste` precedent, so the engine stays an engine (AGENTS.md rule 7).

The projection decides whether a live artifact reads `verified` or
`out-of-band-drift`, and both of its bounds were wrong in the first submission
(#212). It lives here **once**; every verifying adapter delegates
(`createArtifactExtractor`), never re-implements — a boundary fix applied to one
file must not leave the other surface certifying under different rules.

Nothing GitHub-specific belongs here: the URL template and `fetchHosts` stay with
the surface, and the owner resolution shared by the GitHub adapters lives in its
own home, `@profile-as-code/github` (#224) — this package is transport, not
surface. The only surface input the projection takes is **which generated footer
is this surface's terminus**.

## Usage

```ts
import { createArtifactExtractor } from "@profile-as-code/artifact";

/** The frozen #212 seam: `extractArtifact(text: string): string`. */
export const extractArtifact = createArtifactExtractor("github-readme");
```

Three exports, no more:

- `createArtifactExtractor(surface)` — bind the projection to ONE surface's
  generated footer. The returned function is the frozen `(text: string) => string`
  seam plus a **non-writable** `surface` property; it is registered with this
  module, which is what `isArtifactExtractor` checks.
- `projectArtifact(text, surface)` — the same projection, unbound (one-shot
  consumer or test).
- `isArtifactExtractor(value)` — true **only** for a function this package
  produced: the mechanical form of "the adapter delegates, it does not
  re-implement it", which is what makes a one-file divergence fail CI.

`surface` must be a D16 platform slug (`^[a-z0-9]+(?:-[a-z0-9]+)*$`); anything
else **throws**. That guard is deliberate: `""` used to match every surface's
footer and a trailing `-` matched none — silent ways to bound the wrong region,
which is the false verdict §19.5 exists to prevent.

The terminus is the surface's OWN slug, never an extension of it. The marker ends
with `(?![\w-])`, not `\b`: `-` is not a word character, so `\b` let `linkedin`
close at `linkedin-page`'s footer (and `instagram` at `instagram-standalone` —
both pairs exist in `$defs.platform.enum`) and hide every edit below it. The
transport normalizer is intentionally **not** exported: a consumer that normalized
transport separately could bound a different region than `projectArtifact`.

The adapter still owns its surface facts (`fetchHosts`, `githubOwner`, `artifactUrl`
derived from the URL SSOT, §15.4/§18.4) and re-exports the four §19.5 exports
unchanged.

## How §19.5's "ships with the renderer adapter" is read here

SPEC §19.5 says the extractor *ships with the surface's renderer adapter*. That
sentence places the extractor **with the producer — not in `core` (D20) and not
in the CLI** — and it stays true: each adapter declares the capability for its own
surface. The *implementation* of the bound is shared here because the D5 one-home
rule forbids two implementations of one artifact, exactly as `packages/paste`
shares the paste invariant across every paste adapter. The SPEC prose is left
untouched by #216 (a contract edit is an operator decision, not a refactor).

## Conformance

Every verifying adapter runs ONE shared body instead of copying a suite, and opts
into the fixture integration with its own committed bytes:

```ts
import { describe } from "vitest";
import { describeArtifactConformance } from "@profile-as-code/artifact/conformance";
import { extractArtifact } from "../src/index.js";
import { readFileSync } from "node:fs";

describe("github-readme artifact capability", () => {
  describeArtifactConformance({
    surface: "github-readme",
    extractArtifact,
    fixtures: {
      bare: readFileSync("tests/fixtures/artifact/bare.md", "utf8"),
      chrome: readFileSync("tests/fixtures/artifact/chrome.md", "utf8"),
      projection: readFileSync("tests/fixtures/artifact/projection.md", "utf8"),
      edited: readFileSync("tests/fixtures/artifact/edited.md", "utf8"),
    },
  });
});
```

`./conformance` is a test-only subpath (it imports vitest); the runtime entry
(`@profile-as-code/artifact`) stays free of the test tool.

## Dependencies

None at runtime. `vitest` is an optional peer, needed only by `./conformance`.
Node ≥ 22 (the `engines` field of this manifest).

See [SPEC §19.5](https://github.com/ChristianLuciani/profile-as-code/blob/main/docs/SPEC.md) · [repository README](https://github.com/ChristianLuciani/profile-as-code/blob/main/README.md).
