/**
 * Brand flavor tests (v1.1, D15/§17) — the contract change for issue #25:
 *   - flavor normalization (absent = person, every v1 workspace still valid)
 *   - org identity variant + brand blocks load and validate
 *   - drift: handle-matrix rules (duplicate-handle, handle-claimed-not-linked,
 *     handle-host-mismatch) — deterministic, offline
 *   - geo: schema.org/Organization for brand, Person for the default flavor
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { driftCheck, geoCheck, load, SchemaValidationError } from "../src/index.js";

function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-brand-"));
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(content, name), body, "utf8");
  }
  return dir;
}

const clean = (dir: string) => rmSync(dir, { recursive: true, force: true });

const BRAND_WORKSPACE: Record<string, string> = {
  "flavor.yaml": "brand\n",
  "identity.yaml": `name: Topia Press
orgName: Topia Press
logo: https://topia.press/logo.png
established: 2026-08-18
mission:
  en: "High-epistemic essays moving from dystopia to utopia."
  es: "Ensayos de alta exigencia epistémica, de la distopía a la utopía."
tagline:
  en: "From dystopia to utopia — the newsletter"
brandVoice:
  tone:
    en: "editorial, rigorous, hopeful"
  values: [clarity, evidence, longtermism]
  avoid: [doom-scrolling, hype]
links:
  - platform: website
    label: Website
    url: https://topia.press
  - platform: x
    label: X
    url: https://x.com/topiapress
  - platform: bluesky
    label: Bluesky
    url: https://bsky.app/profile/topiapress
`,
  "socialHandles.yaml": `- platform: x
  handle: topiapress
  status: claimed
  url: https://x.com/topiapress
- platform: bluesky
  handle: topiapress
  status: claimed
  url: https://bsky.app/profile/topiapress
- platform: instagram
  handle: topiapress
  status: pending
`,
  "newsletter.yaml": `platform: substack
url: https://topiapress.substack.com
name:
  en: Topia Press
cadence: monthly
`,
  "podcast.yaml": `title:
  en: Topia Radio
status: planned
`,
  "press.yaml": `- outlet: Example Gazette
  title:
    en: Topia Press launches
  url: https://example.com/topia-launch
  date: 2026-08-18
`,
  "audiences.yaml": `readers:
  en: "High-epistemic readers who want constructive futures."
  es: "Lectores de alta exigencia que buscan futuros constructivos."
`,
};

describe("brand flavor: load + normalize (D15)", () => {
  it("defaults flavor to person when absent (every v1 workspace still validates)", () => {
    const dir = makeWorkspace({ "identity.yaml": "name: Someone\n" });
    try {
      expect(load(dir).flavor).toBe("person");
    } finally {
      clean(dir);
    }
  });

  it("loads a full brand workspace with the org variant + brand blocks", () => {
    const dir = makeWorkspace(BRAND_WORKSPACE);
    try {
      const profile = load(dir);
      expect(profile.flavor).toBe("brand");
      expect(profile.identity.orgName).toBe("Topia Press");
      expect(profile.identity.mission?.es).toContain("distopía");
      expect(profile.identity.brandVoice?.values).toEqual(["clarity", "evidence", "longtermism"]);
      expect(profile.identity.established).toBe("2026-08-18");
      expect(profile.socialHandles).toHaveLength(3);
      expect(profile.socialHandles[1]?.status).toBe("claimed");
      expect(profile.newsletter?.url).toBe("https://topiapress.substack.com");
      expect(profile.podcast?.status).toBe("planned");
      expect(profile.press).toHaveLength(1);
      expect(profile.audiences?.readers?.en).toContain("High-epistemic");
    } finally {
      clean(dir);
    }
  });

  it("rejects an unknown flavor value", () => {
    const dir = makeWorkspace({ "flavor.yaml": "alien\n", "identity.yaml": "name: X\n" });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
    } finally {
      clean(dir);
    }
  });
});

describe("brand flavor: drift (handle matrix, offline/deterministic)", () => {
  it("clean handle matrix → no handle warnings", () => {
    const dir = makeWorkspace(BRAND_WORKSPACE);
    try {
      const issues = driftCheck(load(dir)).filter(
        (i) => i.code.startsWith("drift/handle") || i.code === "drift/duplicate-handle",
      );
      expect(issues).toEqual([]);
    } finally {
      clean(dir);
    }
  });

  it("warns drift/duplicate-handle when the same platform appears twice", () => {
    const dir = makeWorkspace({
      ...BRAND_WORKSPACE,
      "socialHandles.yaml":
        "- platform: x\n  handle: topiapress\n  status: claimed\n  url: https://x.com/topiapress\n- platform: x\n  handle: topiapress2\n  status: pending\n",
    });
    try {
      const issues = driftCheck(load(dir));
      expect(issues.some((i) => i.code === "drift/duplicate-handle")).toBe(true);
    } finally {
      clean(dir);
    }
  });

  it("warns drift/handle-claimed-not-linked for a claimed handle with no url", () => {
    const dir = makeWorkspace({
      ...BRAND_WORKSPACE,
      "socialHandles.yaml": "- platform: instagram\n  handle: topiapress\n  status: claimed\n",
    });
    try {
      const issues = driftCheck(load(dir));
      expect(issues.some((i) => i.code === "drift/handle-claimed-not-linked")).toBe(true);
      expect(issues.some((i) => i.code === "drift/handle-host-mismatch")).toBe(false);
    } finally {
      clean(dir);
    }
  });

  it("warns drift/handle-host-mismatch when the url host does not match the platform", () => {
    const dir = makeWorkspace({
      ...BRAND_WORKSPACE,
      "socialHandles.yaml":
        "- platform: x\n  handle: topiapress\n  status: claimed\n  url: https://instagram.com/topiapress\n",
    });
    try {
      const issues = driftCheck(load(dir));
      expect(issues.some((i) => i.code === "drift/handle-host-mismatch")).toBe(true);
    } finally {
      clean(dir);
    }
  });

  it("a claimed handle resolved via identity.links (no own url) is not flagged", () => {
    const dir = makeWorkspace({
      ...BRAND_WORKSPACE,
      "socialHandles.yaml": "- platform: bluesky\n  handle: topiapress\n  status: claimed\n",
    });
    try {
      const issues = driftCheck(load(dir));
      expect(issues.some((i) => i.code === "drift/handle-claimed-not-linked")).toBe(false);
    } finally {
      clean(dir);
    }
  });
});

describe("brand flavor: GEO (Organization, §17.1)", () => {
  it("emits schema.org/Organization with sameAs = links + claimed handle urls", () => {
    const dir = makeWorkspace(BRAND_WORKSPACE);
    try {
      const report = geoCheck(load(dir));
      const sd = report.sections.structuredData.readiness;
      expect(sd.entityType).toBe("Organization");
      expect(sd.ready).toBe(true);
      expect(sd.jsonLd?.["@type"]).toBe("Organization");
      expect(sd.jsonLd?.sameAs).toContain("https://topia.press");
      expect(sd.jsonLd?.sameAs).toContain("https://bsky.app/profile/topiapress");
      expect(sd.jsonLd?.logo).toBe("https://topia.press/logo.png");
      expect(sd.jsonLd?.foundingDate).toBe("2026-08-18");
      expect(sd.jsonLd?.slogan).toContain("dystopia");
      expect(sd.jsonLd?.description).toContain("High-epistemic");
    } finally {
      clean(dir);
    }
  });

  it("emits email on Organization JSON-LD (v1.5, issue #71 — §17.1 parity)", () => {
    const dir = makeWorkspace({
      "flavor.yaml": "brand\n",
      "identity.yaml":
        "name: Topia Press\nemail: hello@topia.press\nlinks:\n  - platform: website\n    label: Website\n    url: https://topia.press\n",
    });
    try {
      const sd = geoCheck(load(dir)).sections.structuredData.readiness;
      expect(sd.entityType).toBe("Organization");
      expect(sd.jsonLd?.email).toBe("hello@topia.press");
    } finally {
      clean(dir);
    }
  });

  it("does NOT emit nationality on Organization JSON-LD (v1.13, #334 — a Person property)", () => {
    const dir = makeWorkspace({
      "flavor.yaml": "brand\n",
      "identity.yaml":
        "name: Topia Press\nnationality: VE\nlinks:\n  - platform: website\n    label: Website\n    url: https://topia.press\n",
    });
    try {
      const sd = geoCheck(load(dir)).sections.structuredData.readiness;
      expect(sd.entityType).toBe("Organization");
      expect(sd.jsonLd).not.toHaveProperty("nationality");
      expect(sd.fields.nationality).toBeUndefined();
    } finally {
      clean(dir);
    }
  });

  it("still emits schema.org/Person for the default (person) flavor", () => {
    const dir = makeWorkspace({
      "identity.yaml":
        "name: Someone\nlinks:\n  - platform: x\n    label: X\n    url: https://x.com/someone\n",
    });
    try {
      const sd = geoCheck(load(dir)).sections.structuredData.readiness;
      expect(sd.entityType).toBe("Person");
      expect(sd.jsonLd?.["@type"]).toBe("Person");
    } finally {
      clean(dir);
    }
  });

  it("handle-matrix drift feeds the factConsistency score", () => {
    const dir = makeWorkspace({
      ...BRAND_WORKSPACE,
      "socialHandles.yaml":
        "- platform: x\n  handle: topiapress\n  status: claimed\n  url: https://instagram.com/topiapress\n",
    });
    try {
      const report = geoCheck(load(dir));
      const conflicts = report.checks.find((c) => c.code === "geo/conflicts");
      expect(conflicts?.detail).toContain("contradiction");
    } finally {
      clean(dir);
    }
  });

  it("empty mission = absent in the entity-fields check, agreeing with structuredData (issue #86, F1)", () => {
    const dir = makeWorkspace({
      "flavor.yaml": "brand\n",
      "identity.yaml": `name: Topia Press
logo: https://topia.press/logo.png
established: 2026-08-18
mission:
  en: ""
links:
  - platform: website
    label: Website
    url: https://topia.press
`,
    });
    try {
      const report = geoCheck(load(dir));
      const check = report.checks.find((c) => c.code === "geo/structured-person");
      // structuredData (en-read, falsy) treats the empty mission as ABSENT —
      // the readiness entity-fields check must agree (one accessor rule, #84/#86).
      expect(report.sections.structuredData.readiness.fields.description).toBeUndefined();
      expect(check?.detail).toContain("description(mission): no");
      expect(check?.score).toBeCloseTo(2 / 3, 5); // logo + foundingDate, not the empty mission
    } finally {
      clean(dir);
    }
  });

  it('the entity-fields check is en-canonical: {en: "", es: "…"} is absent for structured data (issue #86 review pin)', () => {
    // The structured-data section is en-canonical (schema.org JSON-LD emits the
    // canonical en text) — a lang-specific mission still renders on the es surface
    // (compile + pickText are lang-aware), but it does not make the entity field
    // present for structured data. Documented boundary, unchanged from structuredData.
    const dir = makeWorkspace({
      "flavor.yaml": "brand\n",
      "identity.yaml": `name: Topia Press
logo: https://topia.press/logo.png
established: 2026-08-18
mission:
  en: ""
  es: "misión real"
links:
  - platform: website
    label: Website
    url: https://topia.press
`,
    });
    try {
      const report = geoCheck(load(dir));
      const check = report.checks.find((c) => c.code === "geo/structured-person");
      expect(report.sections.structuredData.readiness.fields.description).toBeUndefined();
      expect(check?.detail).toContain("description(mission): no");
    } finally {
      clean(dir);
    }
  });
});
