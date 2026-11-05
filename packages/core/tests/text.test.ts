import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { load, sameTextAcrossPlatforms } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const base = load(fixture("minimal"));

describe("sameTextAcrossPlatforms(profile) — the advisory narrative rule (SPEC §21.8, #462)", () => {
  it("stays quiet when every platform writes its own text", () => {
    const profile = {
      ...base,
      headlines: [
        { platform: "linkedin" as const, lang: "en" as const, text: "Builds sovereign AI systems" },
        {
          platform: "x" as const,
          lang: "en" as const,
          text: "Sovereign AI, one release at a time",
        },
      ],
      bios: [
        {
          platform: "linkedin" as const,
          lang: "en" as const,
          length: "medium" as const,
          text: "A",
        },
        { platform: "x" as const, lang: "en" as const, length: "medium" as const, text: "B" },
      ],
    };
    expect(sameTextAcrossPlatforms(profile)).toEqual([]);
  });

  it("warns once when two different platforms carry a byte-identical headline", () => {
    const text = "Engineer building sovereign AI systems";
    const findings = sameTextAcrossPlatforms({
      ...base,
      headlines: [
        { platform: "github-readme" as const, lang: "en" as const, text },
        { platform: "linkedin" as const, lang: "en" as const, text },
        { platform: "x" as const, lang: "en" as const, text },
      ],
    });
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.code).toBe("text/same-across-platforms");
    expect(finding?.severity).toBe("warn");
    expect(finding?.kind).toBe("headline");
    expect(finding?.surfaces).toEqual(["github-readme", "linkedin", "x"]);
    // The finding names the kind and every platform that shares the text.
    expect(finding?.message).toContain("headline");
    expect(finding?.message).toContain("github-readme, linkedin, x");
  });

  it("exempts the same platform across langs (a coincidence is not homogenization)", () => {
    const text = "Sovereign AI";
    expect(
      sameTextAcrossPlatforms({
        ...base,
        headlines: [
          { platform: "linkedin" as const, lang: "en" as const, text },
          { platform: "linkedin" as const, lang: "es" as const, text },
        ],
      }),
    ).toEqual([]);
  });

  it("compares bios within their length band, so a short and a long row never collide", () => {
    const text = "I build sovereign AI systems.";
    const shared = sameTextAcrossPlatforms({
      ...base,
      headlines: [],
      bios: [
        { platform: "linkedin" as const, lang: "en" as const, length: "short" as const, text },
        { platform: "x" as const, lang: "en" as const, length: "short" as const, text },
      ],
    });
    expect(shared).toHaveLength(1);
    expect(shared[0]?.kind).toBe("bio");
    expect(shared[0]?.surfaces).toEqual(["linkedin", "x"]);

    const differentBands = sameTextAcrossPlatforms({
      ...base,
      headlines: [],
      bios: [
        { platform: "linkedin" as const, lang: "en" as const, length: "short" as const, text },
        { platform: "x" as const, lang: "en" as const, length: "long" as const, text },
      ],
    });
    expect(differentBands).toEqual([]);
  });

  it("names the headline row it points at", () => {
    const text = "Same words";
    const findings = sameTextAcrossPlatforms({
      ...base,
      headlines: [
        { platform: "linkedin" as const, lang: "en" as const, text },
        { platform: "x" as const, lang: "en" as const, text },
      ],
    });
    expect(findings[0]?.path).toBe("headlines:linkedin:en");
  });
});
