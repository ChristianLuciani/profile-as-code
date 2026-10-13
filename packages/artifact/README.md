# `@profile-as-code/artifact`

The **canonical artifact projection** of [SPEC §19.5](../../docs/SPEC.md) (issue
#216, follow-up of #212): the bound — *"the engine-owned region opens at the last
header above its terminus and closes at the last generated footer"* — plus the
transport normalization (BOM, CRLF/CR). A renderer support package, the
`packages/paste` precedent, so the engine stays an engine (AGENTS.md rule 7).

The projection decides whether a live artifact reads `verified` or
`out-of-band-drift`, and both of its bounds were wrong in the first submission
(#212). It lives here **once**; every verifying adapter delegates
(`createArtifactExtractor`), never re-implements — a boundary fix applied to one
file must not leave the other surface certifying under different rules.

Everything GitHub-specific — `fetchHosts`, the owner resolution, the URL template
— stays with the surface, in its adapter. The only surface input the projection
takes is **which generated footer is this surface's terminus**.

## Usage

```ts
import { createArtifactExtractor } from "@profile-as-code/artifact";

/** The frozen #212 seam: `extractArtifact(text: string): string`. */
export const extractArtifact = createArtifactExtractor("github-readme");
```

`projectArtifact(text, surface)` is the same projection, unbound (for a one-shot
consumer or a test). `normalizeTransport(text)` exposes the transport half alone.
`isArtifactExtractor(value)` answers true **only** for a function this package
produced — the mechanical form of "the adapter delegates, it does not
re-implement it".

The adapter still owns its surface facts (`fetchHosts`, `artifactUrl` derived from
the URL SSOT, §15.4/§18.4) and re-exports the three §19.5 exports unchanged.

## Conformance

Every verifying adapter runs ONE shared body instead of copying a suite:

```ts
import { describe } from "vitest";
import { describeArtifactConformance } from "@profile-as-code/artifact/conformance";
import { extractArtifact } from "../src/index.js";

describe("github-readme artifact capability", () => {
  describeArtifactConformance({ surface: "github-readme", extractArtifact });
});
```

`./conformance` is a test-only subpath (it imports vitest); the runtime entry
(`@profile-as-code/artifact`) stays free of the test tool.

## Dependencies

None at runtime. `vitest` is an optional peer, needed only by `./conformance`.

See [SPEC §19.5](../../docs/SPEC.md) · [repository README](../../README.md).
