/**
 * The paste core's own conformance run (#157): the shared body applied to the
 * seam itself, so `pasteSource` and the harness cannot drift apart. Adapter
 * suites run the same body against their own `render`.
 */
import { describe } from "vitest";
import { describePasteConformance } from "../src/conformance.js";
import { pasteSource } from "../src/index.js";

describe("pasteSource — shared paste core (#150/#157)", () => {
  describePasteConformance({
    platform: "linkedin",
    render: (p) => ({ text: pasteSource(p) }),
  });
});
