/**
 * Renderer `kofi` (v1.7, issue #130) — deterministic, byte-stable plain-text
 * About paste-source from a compile() slice. Same input → same bytes.
 *
 * The fixture is a minimal workspace exercising the full contract: length
 * priority (long > medium > short), single-row emission (no merge — the D18
 * ledger hashes exactly one bios row), empty slice → empty artifact (unbuilt
 * by `pasco build`, §15.1 — no artifact left on disk), per-lang isolation
 * (compile filters by exact lang), paste deploy spec (D9), asset-less output.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, load } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { deploySpec, render } from "../src/index.js";

const tempDirs: string[] = [];
function workspace(bios: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-kofi-"));
  tempDirs.push(dir);
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "identity.yaml"), "name: Elena Vasquez\n");
  writeFileSync(join(content, "bios.yaml"), bios);
  return dir;
}
const clean = (dir: string) => rmSync(dir, { recursive: true, force: true });
afterAll(() => {
  for (const dir of tempDirs) clean(dir);
});

describe("kofi renderer (v1.7, #130)", () => {
  it("picks the LONG bio by length priority (About = free-form body)", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: kofi
  lang: en
  length: long
  text: Long About body.
- platform: kofi
  lang: en
  length: medium
  text: Medium body.
- platform: kofi
  lang: en
  length: short
  text: Short.
`,
        ),
      ),
      "kofi",
      "en",
    );
    expect(render(slice).text).toBe("Long About body.\n");
  });

  it("falls back to medium, then short, when long is absent", () => {
    const mediumSlice = compile(
      load(
        workspace(
          `- platform: kofi
  lang: en
  length: medium
  text: Medium body.
- platform: kofi
  lang: en
  length: short
  text: Short.
`,
        ),
      ),
      "kofi",
      "en",
    );
    expect(render(mediumSlice).text).toBe("Medium body.\n");

    const shortSlice = compile(
      load(
        workspace(
          `- platform: kofi
  lang: en
  length: short
  text: Short.
`,
        ),
      ),
      "kofi",
      "en",
    );
    expect(render(shortSlice).text).toBe("Short.\n");
  });

  it("is byte-stable across two runs (same input → same bytes)", () => {
    const bios = `- platform: kofi
  lang: en
  length: long
  text: Stable body — identical input, identical bytes.
`;
    const dir = workspace(bios);
    const first = render(compile(load(dir), "kofi", "en")).text;
    const second = render(compile(load(dir), "kofi", "en")).text;
    expect(first).toBe(second);
  });

  it("renders empty for a platform+lang without a kofi bio (build unbuilds it)", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: linkedin
  lang: en
  length: medium
  text: A LinkedIn bio must never leak into the kofi artifact.
`,
        ),
      ),
      "kofi",
      "en",
    );
    expect(slice.bios.length).toBe(0);
    expect(render(slice).text).toBe("");
  });

  it("renders only the requested lang slice (compile filters by exact lang)", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: kofi
  lang: en
  length: long
  text: English body.
- platform: kofi
  lang: es
  length: long
  text: Cuerpo en español.
`,
        ),
      ),
      "kofi",
      "es",
    );
    expect(slice.bios.length).toBe(1);
    expect(render(slice).text).toBe("Cuerpo en español.\n");
  });

  it("passes the SSOT row through verbatim — the renderer transforms nothing", () => {
    // The real guarantee: `render()` is a verbatim pass-through of the ONE bios row
    // (`${bio.text}\n`) — it neither ADDS nor STRIPS Markdown/HTML. So a markdown-bearing
    // `bios` row WOULD reach the paste target as-is; keeping the row plain is the skill's
    // job (skills/kofi/research, applied by a human step — no check rule covers
    // markdown/HTML absence today). The parametrized conformance body lives in
    // `packages/core/tests/paste-source.test.ts` (#150).
    const body = "# Heading kept verbatim\n\nSee [link](https://example.org).";
    const slice = compile(
      load(
        workspace(
          `- platform: kofi
  lang: en
  length: long
  text: ${JSON.stringify(body)}
`,
        ),
      ),
      "kofi",
      "en",
    );
    expect(render(slice).text).toBe(`${body}\n`);
  });

  it("declares the manual deploy spec (§7 union; D9 paste in prose) and no assets", () => {
    expect(deploySpec).toBe("manual");
    const slice = compile(
      load(
        workspace(
          `- platform: kofi
  lang: en
  length: long
  text: Body.
`,
        ),
      ),
      "kofi",
      "en",
    );
    expect(render(slice).assets).toBeUndefined();
  });
});
