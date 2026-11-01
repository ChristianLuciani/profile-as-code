/**
 * `textOf` — the langMap reading helper (schema §11, v1.1).
 *
 * Two contracts are pinned here (issue #415):
 *   1. with no `lang` it is the pre-#415 helper: a langMap reads as `en`;
 *   2. with a `lang` it applies the rule `compile()` uses for language-aware
 *      text — the requested language, falling back to `en`, and an EMPTY
 *      string counting as ABSENT at both levels (issue #84). #415's fresh
 *      review found that branch had no test naming it; a helper every consumer
 *      reads a langMap through cannot have an untested fallback.
 */

import { describe, expect, it } from "vitest";
import { textOf } from "../src/index.js";

describe("textOf (langMap read)", () => {
  const bilingual = { en: "Demo Engineer", es: "Ingeniero Demo" };

  it("returns a plain string verbatim", () => {
    expect(textOf("Data Analyst")).toBe("Data Analyst");
    expect(textOf("Data Analyst", "es")).toBe("Data Analyst");
  });

  it("reads `en` when no language is requested", () => {
    expect(textOf(bilingual)).toBe("Demo Engineer");
  });

  it("reads the requested language, falling back to `en`", () => {
    expect(textOf(bilingual, "es")).toBe("Ingeniero Demo");
    expect(textOf(bilingual, "en")).toBe("Demo Engineer");
    expect(textOf(bilingual, "fr")).toBe("Demo Engineer");
  });

  it("treats an empty value as absent at both levels (#84)", () => {
    expect(textOf({ en: "Demo Engineer", es: "" }, "es")).toBe("Demo Engineer");
    expect(textOf({ en: "", es: "Ingeniero Demo" }, "es")).toBe("Ingeniero Demo");
    expect(textOf({ en: "" }, "es")).toBe("");
  });

  it("returns an empty string for an absent value", () => {
    expect(textOf(undefined)).toBe("");
    expect(textOf(undefined, "es")).toBe("");
  });
});
