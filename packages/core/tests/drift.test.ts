import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { driftCheck, load } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("driftCheck(profile)", () => {
  it("returns no issues for the minimal (drift-free) fixture", () => {
    const profile = load(fixture("minimal"));
    expect(driftCheck(profile)).toEqual([]);
  });

  it("returns a WARN issue for every planted contradiction (never throws)", () => {
    const profile = load(fixture("drifting"));
    const issues = driftCheck(profile);

    // WARN semantics (D12): everything is a warning, the function never throws.
    expect(issues.length).toBeGreaterThanOrEqual(13);
    for (const issue of issues) {
      expect(issue.severity).toBe("warn");
      expect(issue.code).toMatch(/^drift\//);
      expect(issue.message.length).toBeGreaterThan(0);
    }

    const codes = new Set(issues.map((i) => i.code));
    expect(codes).toContain("drift/duplicate-identity-link");
    expect(codes).toContain("drift/url-not-in-identity");
    expect(codes).toContain("drift/date-range-inverted");
    expect(codes).toContain("drift/duplicate-experience");
    expect(codes).toContain("drift/duplicate-bio");
    expect(codes).toContain("drift/duplicate-headline");
    expect(codes).toContain("drift/duplicate-project");
    expect(codes).toContain("drift/publication-conflict");
    expect(codes).toContain("drift/orcid-conflict");
    expect(codes).toContain("drift/orcid-mismatch");
    expect(codes).toContain("drift/skill-conflict");
    expect(codes).toContain("drift/active-platform-unknown");
    expect(codes).toContain("drift/active-variant-missing");

    // every issue points somewhere real
    for (const issue of issues) {
      expect(issue.path.length).toBeGreaterThan(0);
    }
  });

  it("reports an uncanonicalized platform URL with the exact offending link", () => {
    const profile = load(fixture("drifting"));
    const issues = driftCheck(profile);
    const link = issues.find((i) => i.code === "drift/url-not-in-identity");
    expect(link?.message).toContain("https://github.com/someoneelse");
    expect(link?.path).toBe("projects[0].links[0]");
  });

  it("reports inverted date ranges with the precise experience item", () => {
    const profile = load(fixture("drifting"));
    const issue = driftCheck(profile).find((i) => i.code === "drift/date-range-inverted");
    expect(issue?.message).toContain("start (2025-01-01) is after end (2020-01-01)");
    expect(issue?.path).toBe("experience[2]");
  });

  it("flags an active entry whose platform has no curated bio/headline", () => {
    const profile = load(fixture("drifting"));
    const issue = driftCheck(profile).find((i) => i.code === "drift/active-variant-missing");
    expect(issue?.surfaces).toEqual(["researchgate"]);
  });

  it("does not flag evidence[] sources (citations are exempt from the identity-links rule)", () => {
    const profile = load(fixture("minimal"));
    const issues = driftCheck(profile);
    expect(issues.some((i) => i.message.includes("doi.org"))).toBe(false);
  });

  it("survives a profile with no collections at all", () => {
    const profile = load(fixture("minimal"));
    const bare = { identity: profile.identity };
    expect(driftCheck(bare)).toEqual([]);
  });
});
