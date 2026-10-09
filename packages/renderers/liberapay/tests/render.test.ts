/**
 * Renderer `liberapay` (v1.8, issue #133) — the platform facts (manual paste
 * deploy, asset-less output). The shared paste guarantee is delegated to the ONE
 * conformance body in `@profile-as-code/paste/conformance` (#150/#157), never
 * copied into this suite.
 */
import { describePasteConformance, pasteRow, pasteSlice } from "@profile-as-code/paste/conformance";
import { describe, expect, it } from "vitest";
import { deploySpec, render } from "../src/index.js";

describe("liberapay renderer (v1.8, #133)", () => {
  describePasteConformance({ platform: "liberapay", render });

  it("declares the manual deploy spec (§7 union; D9 paste in prose) and no assets", () => {
    expect(deploySpec).toBe("manual");
    const slice = pasteSlice("liberapay", pasteRow("liberapay", "long", "Body."));
    expect(render(slice).assets).toBeUndefined();
  });
});
