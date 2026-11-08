import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { linkIconFindings, load, PLATFORM_ICONS } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** A profile slice carrying only what the rule reads. */
const withLinks = (links: { platform?: string; url: string }[]) => ({
  identity: { name: "Elena Vasquez", links },
});

describe("PLATFORM_ICONS — the registry projection (#511)", () => {
  it("projects the icon block of the badgeable rows", () => {
    // The eight platforms the retired renderer table carried, plus the row whose
    // body this engine renders. Values are the moved ones, not new claims.
    expect(PLATFORM_ICONS.github).toEqual({ slug: "github", color: "181717", label: "GitHub" });
    expect(PLATFORM_ICONS.substack).toEqual({
      slug: "substack",
      color: "FF6719",
      label: "Substack",
    });
    expect(PLATFORM_ICONS.website).toEqual({ slug: "github", color: "111111", label: "Website" });
  });

  it("never carries a '#' in a color (the badge URL interpolates the value)", () => {
    for (const [platform, icon] of Object.entries(PLATFORM_ICONS)) {
      expect(icon.color, platform).toMatch(/^[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("linkIconFindings(profile) — icon coverage (#511)", () => {
  it("stays quiet when every declared link platform has icon metadata", () => {
    const profile = load(fixture("minimal"));
    expect(linkIconFindings(profile)).toEqual([]);
  });

  it("warns, naming the platform and the link path, when a platform has none", () => {
    const findings = linkIconFindings(
      withLinks([
        { platform: "github", url: "https://github.com/e" },
        { platform: "myspace", url: "https://myspace.com/e" },
      ]),
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.code).toBe("check/link-platform-icon");
    expect(finding?.severity).toBe("warn");
    expect(finding?.message).toContain('"myspace"');
    expect(finding?.path).toBe("identity.links[1].platform");
  });

  it("reports a platform once, however many links name it", () => {
    const findings = linkIconFindings(
      withLinks([
        { platform: "myspace", url: "https://myspace.com/e" },
        { platform: "myspace", url: "https://myspace.com/other" },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe("identity.links[0].platform");
  });

  it("ignores a link with no platform (a URL-only row is not a badge subject)", () => {
    expect(linkIconFindings(withLinks([{ url: "https://example.com/cv" }]))).toEqual([]);
  });
});
