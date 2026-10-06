/**
 * Renderer `hotmart` (v1.9, issue #137) — deterministic, byte-stable plain-text
 * profile paste-source from a compile() slice. Same input → same bytes.
 *
 * The fixture is a minimal workspace exercising the full contract: length
 * priority (long > medium > short), single-row emission (no merge — the D18
 * ledger hashes exactly one bios row), empty slice → empty artifact (skipped
 * by build), per-lang isolation (compile filters by exact lang), paste deploy
 * spec (D9), asset-less output.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, load } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { deploySpec, render } from "../src/index.js";

const tempDirs: string[] = [];
function workspace(bios: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-hotmart-"));
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

describe("hotmart renderer (v1.9, #137)", () => {
  it("picks the LONG bio by length priority (profile body = free-form)", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: hotmart
  lang: en
  length: long
  text: Long profile body.
- platform: hotmart
  lang: en
  length: medium
  text: Medium body.
- platform: hotmart
  lang: en
  length: short
  text: Short.
`,
        ),
      ),
      "hotmart",
      "en",
    );
    expect(render(slice).text).toBe("Long profile body.\n");
  });

  it("falls back to medium, then short, when long is absent", () => {
    const mediumSlice = compile(
      load(
        workspace(
          `- platform: hotmart
  lang: en
  length: medium
  text: Medium body.
- platform: hotmart
  lang: en
  length: short
  text: Short.
`,
        ),
      ),
      "hotmart",
      "en",
    );
    expect(render(mediumSlice).text).toBe("Medium body.\n");

    const shortSlice = compile(
      load(
        workspace(
          `- platform: hotmart
  lang: en
  length: short
  text: Short.
`,
        ),
      ),
      "hotmart",
      "en",
    );
    expect(render(shortSlice).text).toBe("Short.\n");
  });

  it("is byte-stable across two runs (same input → same bytes)", () => {
    const bios = `- platform: hotmart
  lang: en
  length: long
  text: Stable body — identical input, identical bytes.
`;
    const dir = workspace(bios);
    const first = render(compile(load(dir), "hotmart", "en")).text;
    const second = render(compile(load(dir), "hotmart", "en")).text;
    expect(first).toBe(second);
  });

  it("renders empty for a platform+lang without a hotmart bio (build skips it)", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: linkedin
  lang: en
  length: medium
  text: A LinkedIn bio must never leak into the hotmart artifact.
`,
        ),
      ),
      "hotmart",
      "en",
    );
    expect(slice.bios.length).toBe(0);
    expect(render(slice).text).toBe("");
  });

  it("renders only the requested lang slice (compile filters by exact lang)", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: hotmart
  lang: en
  length: long
  text: English body.
- platform: hotmart
  lang: es
  length: long
  text: Cuerpo en español.
`,
        ),
      ),
      "hotmart",
      "es",
    );
    expect(slice.bios.length).toBe(1);
    expect(render(slice).text).toBe("Cuerpo en español.\n");
  });

  it("passes the SSOT row through verbatim — the renderer transforms nothing", () => {
    // The real guarantee: `render()` is a verbatim pass-through of the ONE bios row
    // (`${bio.text}\n`) — it neither ADDS nor STRIPS Markdown/HTML. So a markdown-bearing
    // `bios` row WOULD reach the paste target as-is; keeping the row plain is the skill's
    // job (SKILL.md §Verificación, a human step — no check rule covers markdown/HTML
    // absence today; the parametrized conformance suite is issue #150).
    const body = "# Heading kept verbatim\n\nSee [link](https://example.org).";
    const slice = compile(
      load(
        workspace(
          `- platform: hotmart
  lang: en
  length: long
  text: ${JSON.stringify(body)}
`,
        ),
      ),
      "hotmart",
      "en",
    );
    expect(render(slice).text).toBe(`${body}\n`);
  });

  it("declares the manual deploy spec (§7 union; D9 paste in prose) and no assets", () => {
    expect(deploySpec).toBe("manual");
    const slice = compile(
      load(
        workspace(
          `- platform: hotmart
  lang: en
  length: long
  text: Body.
`,
        ),
      ),
      "hotmart",
      "en",
    );
    expect(render(slice).assets).toBeUndefined();
  });
});
