import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { completeness, DEFAULT_COMPLETENESS_POLICY, load } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway workspace with exactly the given content files. */
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-completeness-"));
  tmpDirs.push(dir);
  mkdirSync(join(dir, "content"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, "content", name), body, "utf8");
  }
  return dir;
}

const IDENTITY_MIN = "name: Elena Vasquez\n";

describe("completeness(profile, policy)", () => {
  it("scores an identity-only workspace low but above zero", () => {
    const report = completeness(load(workspace({ "identity.yaml": IDENTITY_MIN })));

    // identity exists, everything else is absent: a low score with real direction.
    expect(report.percent).toBeGreaterThan(0);
    expect(report.percent).toBeLessThan(50);
    expect(report.satisfied).toBeLessThan(report.total);
    expect(report.target).toBe(DEFAULT_COMPLETENESS_POLICY.target);
  });

  it("is deterministic: same profile + same policy → byte-identical report", () => {
    const profile = load(workspace({ "identity.yaml": IDENTITY_MIN }));
    const a = completeness(profile);
    const b = completeness(profile);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("scores a fully populated workspace 100%", () => {
    const report = completeness(load(fixture("complete")));
    expect(report.percent).toBe(100);
    expect(report.satisfied).toBe(report.total);
    for (const result of report.items) expect(result.score).toBe(1);
  });

  it("returns one result per catalog item, each in 0..1 with its weight", () => {
    const report = completeness(load(fixture("minimal")));
    expect(report.items.length).toBeGreaterThanOrEqual(5);
    for (const result of report.items) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.weight).toBeGreaterThan(0);
      expect(result.label.length).toBeGreaterThan(0);
    }
    // percentage = earned weight / total eligible weight (rounded for byte-stability)
    const earned = report.items.reduce((sum, i) => sum + i.score * i.weight, 0);
    const totalWeight = report.items.reduce((sum, i) => sum + i.weight, 0);
    expect(report.percent).toBeCloseTo((earned / totalWeight) * 100, 1);
  });

  it("excludes an item the policy drops by weight 0 — percentage is policy-driven", () => {
    const profile = load(workspace({ "identity.yaml": IDENTITY_MIN }));
    const withoutLang = completeness(profile, {
      items: [{ id: "langCoverage", weight: 0 }],
    });
    expect(withoutLang.items.some((i) => i.id === "langCoverage")).toBe(false);
    // Dropping a zero-scoring item must raise the percentage, never lower it.
    expect(withoutLang.percent).toBeGreaterThanOrEqual(completeness(profile).percent);
  });

  it("honours the expected langs from the policy (fewer langs → higher coverage)", () => {
    const profile = load(
      workspace({
        "identity.yaml": IDENTITY_MIN,
        "positioning.yaml": "statement:\n  en: Engineer building open tools for research.\n",
      }),
    );
    const enOnly = completeness(profile, { langs: ["en"] });
    const enEsFr = completeness(profile, { langs: ["en", "es", "fr"] });
    const item = (r: typeof enOnly) => r.items.find((i) => i.id === "langCoverage");
    expect(item(enOnly)?.score).toBe(1);
    expect(item(enEsFr)?.score).toBeCloseTo(1 / 3, 6);
  });

  it("scores GEO anchors from reinforced semantic associations", () => {
    const profile = load(
      workspace({
        "identity.yaml": IDENTITY_MIN,
        "positioning.yaml":
          "statement:\n  en: I work on physics education and AI sovereignty.\n" +
          "geo:\n  semanticAssociations: [physics education, AI sovereignty, open science]\n",
        "keywords.yaml": "geo:\n  associations: [physics education, AI sovereignty]\n",
      }),
    );
    const anchor = completeness(profile).items.find((i) => i.id === "geoAnchors");
    // 2 of 3 anchors reinforced → partial (never 0 or 1 for a genuine middle).
    expect(anchor?.score).toBeGreaterThan(0);
    expect(anchor?.score).toBeLessThan(1);
  });

  it("scores evidence by the share of sourced claims", () => {
    const profile = load(
      workspace({
        "identity.yaml": IDENTITY_MIN,
        "projects.yaml":
          "- name: With evidence\n  evidence:\n" +
          "    - claim:\n        en: Shipped to a million users.\n      source: https://example.com/proof\n" +
          "- name: Without evidence\n",
      }),
    );
    const evidence = completeness(profile).items.find((i) => i.id === "evidence");
    expect(evidence?.score).toBeGreaterThan(0);
    expect(evidence?.score).toBeLessThan(1);
    expect(evidence?.detail).toContain("1/2");
  });

  it("scores deployment from the ledger's in-sync share, never blocking on an empty ledger", () => {
    const profile = load(fixture("minimal"));
    const deployment = completeness(profile).items.find((i) => i.id === "deployment");
    // fresh workspace: bookkeeping is empty → score 0, but it is a scored item, not an error.
    expect(deployment?.score).toBe(0);
    expect(deployment?.detail.length).toBeGreaterThan(0);
  });

  it("brand flavor scores its own expected blocks (socialHandles), not the person set", () => {
    const profile = load(
      workspace({
        "identity.yaml": "name: Topia\n",
        "flavor.yaml": "brand\n",
      }),
    );
    expect(profile.flavor).toBe("brand");
    const report = completeness(profile);
    const presence = report.items.find((i) => i.id === "presence");
    // identity + flavor exist; socialHandles/newsletter/podcast/press do not.
    expect(presence?.score).toBeGreaterThan(0);
    expect(presence?.score).toBeLessThan(1);
  });

  it("target names the milestone set and is reported verbatim", () => {
    const report = completeness(load(fixture("minimal")), { target: "github-milestone" });
    expect(report.target).toBe("github-milestone");
  });
});
