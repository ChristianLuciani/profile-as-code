/**
 * Renderer `liberapay` (v1.8, issue #133) — deterministic, byte-stable plain-text
 * About paste-source from a compile() slice. Same input → same bytes.
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
  const dir = mkdtempSync(join(tmpdir(), "pasco-liberapay-"));
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

describe("liberapay renderer (v1.7, #130)", () => {
  it("picks the LONG bio by length priority (profile body = free-form)", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: liberapay
  lang: en
  length: long
  text: Long About body.
- platform: liberapay
  lang: en
  length: medium
  text: Medium body.
- platform: liberapay
  lang: en
  length: short
  text: Short.
`,
        ),
      ),
      "liberapay",
      "en",
    );
    expect(render(slice).text).toBe("Long About body.\n");
  });

  it("falls back to medium, then short, when long is absent", () => {
    const mediumSlice = compile(
      load(
        workspace(
          `- platform: liberapay
  lang: en
  length: medium
  text: Medium body.
- platform: liberapay
  lang: en
  length: short
  text: Short.
`,
        ),
      ),
      "liberapay",
      "en",
    );
    expect(render(mediumSlice).text).toBe("Medium body.\n");

    const shortSlice = compile(
      load(
        workspace(
          `- platform: liberapay
  lang: en
  length: short
  text: Short.
`,
        ),
      ),
      "liberapay",
      "en",
    );
    expect(render(shortSlice).text).toBe("Short.\n");
  });

  it("is byte-stable across two runs (same input → same bytes)", () => {
    const bios = `- platform: liberapay
  lang: en
  length: long
  text: Stable body — identical input, identical bytes.
`;
    const dir = workspace(bios);
    const first = render(compile(load(dir), "liberapay", "en")).text;
    const second = render(compile(load(dir), "liberapay", "en")).text;
    expect(first).toBe(second);
  });

  it("renders empty for a platform+lang without a liberapay bio (build skips it)", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: linkedin
  lang: en
  length: medium
  text: A LinkedIn bio must never leak into the liberapay artifact.
`,
        ),
      ),
      "liberapay",
      "en",
    );
    expect(slice.bios.length).toBe(0);
    expect(render(slice).text).toBe("");
  });

  it("renders only the requested lang slice (compile filters by exact lang)", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: liberapay
  lang: en
  length: long
  text: English body.
- platform: liberapay
  lang: es
  length: long
  text: Cuerpo en español.
`,
        ),
      ),
      "liberapay",
      "es",
    );
    expect(slice.bios.length).toBe(1);
    expect(render(slice).text).toBe("Cuerpo en español.\n");
  });

  it("emits plain text: no Markdown headers, links or code fences", () => {
    const slice = compile(
      load(
        workspace(
          `- platform: liberapay
  lang: en
  length: long
  text: Plain paragraph one. Plain paragraph two.
`,
        ),
      ),
      "liberapay",
      "en",
    );
    const text = render(slice).text;
    expect(text).not.toMatch(/^(#+\s|!\[|\[.*\]\(|```)/m);
  });

  it("declares the manual deploy spec (§7 union; D9 paste in prose) and no assets", () => {
    expect(deploySpec).toBe("manual");
    const slice = compile(
      load(
        workspace(
          `- platform: liberapay
  lang: en
  length: long
  text: Body.
`,
        ),
      ),
      "liberapay",
      "en",
    );
    expect(render(slice).assets).toBeUndefined();
  });
});
