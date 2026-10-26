import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LoadError, load, SchemaValidationError } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Create a throwaway workspace with the given content files. */
function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-core-"));
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(content, name), body, "utf8");
  }
  return dir;
}

describe("load(workspace)", () => {
  it("loads the minimal fixture end-to-end into a normalized Profile", () => {
    const profile = load(fixture("minimal"));
    expect(profile.identity.name).toBe("Elena Vasquez");
    expect(profile.identity.links).toHaveLength(5);
    expect(profile.bios).toHaveLength(6);
    expect(profile.headlines).toHaveLength(6);
    expect(profile.experience[0]?.role).toBe("Senior AI Engineer");
    expect(profile.experience[0]?.end).toBe("present");
    expect(profile.positioning?.statement?.en).toContain("sovereign");
    expect(profile.positioning?.geo?.semanticAssociations).toHaveLength(3);
    expect(profile.publications).toHaveLength(2);
    expect(profile.checks).toHaveLength(3);
    expect(profile.active?.linkedin?.variantId).toBe("li-en-2025-01");
  });

  it("merges root properties from separate content files (identity + experience + …)", () => {
    const profile = load(fixture("minimal"));
    expect(profile.identity.name).toBe("Elena Vasquez");
    expect(profile.experience).toHaveLength(2);
    expect(profile.skills).toHaveLength(3);
    expect(profile.keywords?.seo?.linkedin).toContain("sovereign AI");
  });

  it("normalizes absent collections to empty arrays (identity-only workspace)", () => {
    const dir = makeWorkspace({ "identity.yaml": "name: Someone\n" });
    try {
      const profile = load(dir);
      expect(profile.bios).toEqual([]);
      expect(profile.headlines).toEqual([]);
      expect(profile.skills).toEqual([]);
      expect(profile.experience).toEqual([]);
      expect(profile.projects).toEqual([]);
      expect(profile.publications).toEqual([]);
      expect(profile.checks).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws LoadError when the workspace has no content/ directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-core-"));
    try {
      expect(() => load(dir)).toThrow(LoadError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws LoadError on invalid YAML", () => {
    const dir = makeWorkspace({ "identity.yaml": "name: [unclosed\n" });
    try {
      expect(() => load(dir)).toThrow(LoadError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws LoadError when two files provide the same root property (.yaml/.yml collision)", () => {
    const dir = makeWorkspace({
      "experience.yaml": "- role: A\n  org: B\n  start: 2020-01-01\n",
      "experience.yml": "- role: C\n  org: D\n  start: 2021-01-01\n",
    });
    try {
      expect(() => load(dir)).toThrow(/duplicate root property "experience"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on schema when identity is missing (D12 fail-on-schema)", () => {
    const dir = makeWorkspace({
      "bios.yaml": "- platform: x\n  lang: en\n  length: short\n  text: hi\n",
    });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
      try {
        load(dir);
      } catch (error) {
        expect(error).toBeInstanceOf(SchemaValidationError);
        const e = error as SchemaValidationError;
        expect(e.issues.some((issue) => issue.path === "identity")).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on unknown top-level properties (additionalProperties: false)", () => {
    const dir = makeWorkspace({ "identity.yaml": "name: X\n", "typo.yaml": "- role: a\n" });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on invalid dates (format: date)", () => {
    const dir = makeWorkspace({
      "identity.yaml": "name: X\n",
      "experience.yaml": "experience:\n  - role: a\n    org: b\n    start: 2020-13-40\n",
    });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a langMap lacks en (contract §11)", () => {
    const dir = makeWorkspace({
      "identity.yaml": "name: X\n",
      "positioning.yaml": "statement:\n  es: solo español\n",
    });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a langMap uses a key outside en/es/fr (propertyNames guard)", () => {
    const dir = makeWorkspace({
      "identity.yaml": "name: X\n",
      "positioning.yaml": "statement:\n  en: ok\n  de: nein\n",
    });
    try {
      expect(() => load(dir)).toThrow(/unsupported language key 'de'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-string langMap value at the Zod boundary ({en: 0} — gen-zod catchall; issue #86 F3 pins it)", () => {
    // The generated Zod materializes langMap as {en: string} + catchall(string),
    // so non-string values were already engine-invalid BEFORE the JSON Schema
    // gained additionalProperties (issue #86, F3) — this pins the engine side.
    const dir = makeWorkspace({
      "identity.yaml": "name: X\n",
      "positioning.yaml": "statement:\n  en: 0\n",
    });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when bios use an unknown platform", () => {
    const dir = makeWorkspace({
      "identity.yaml": "name: X\n",
      "bios.yaml": "- platform: myspace\n  lang: en\n  length: short\n  text: hi\n",
    });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when the active entry is malformed", () => {
    const dir = makeWorkspace({
      "identity.yaml": "name: X\n",
      "active.yaml": "linkedin:\n  lang: en\n  variantId: v1\n",
    });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("URL scheme boundary (issue #53: http(s) only at $defs/url)", () => {
  it("rejects a javascript: URL in identity.links (href-injection boundary)", () => {
    const dir = makeWorkspace({
      "identity.yaml":
        'name: X\nlinks:\n  - platform: website\n    label: Site\n    url: "javascript:alert(1)"\n',
    });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
      try {
        load(dir);
      } catch (error) {
        const e = error as SchemaValidationError;
        expect(e.issues.some((issue) => issue.path === "identity.links.0.url")).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects data: and vbscript: schemes too", () => {
    for (const url of ["data:text/html,hi", "vbscript:msgbox(1)"]) {
      const dir = makeWorkspace({ "identity.yaml": `name: X\nlinks:\n  - url: "${url}"\n` });
      try {
        expect(() => load(dir)).toThrow(SchemaValidationError);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("accepts http:// and https:// URLs (no false positives)", () => {
    const dir = makeWorkspace({
      "identity.yaml":
        "name: X\nlinks:\n  - url: https://example.com\n  - platform: website\n    url: http://insecure.example.net\n",
    });
    try {
      const profile = load(dir);
      expect(profile.identity.links).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("identity.email (v1.5, issue #71 — the contact email is a fact, not a link)", () => {
  it("accepts identity.email at the identity root and preserves the value", () => {
    const dir = makeWorkspace({
      "identity.yaml": "name: X\nemail: cluciani@gmail.com\nlinks:\n  - url: https://example.com\n",
    });
    try {
      const profile = load(dir);
      expect(profile.identity.email).toBe("cluciani@gmail.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a malformed identity.email (RFC-5322-adjacent pattern)", () => {
    for (const bad of [
      "not-an-email",
      "missing-at.example",
      "a b@example.com",
      "a@b",
      "a@b.c.",
      "a@b..c",
      'a"b@example.com',
    ]) {
      const dir = makeWorkspace({ "identity.yaml": `name: X\nemail: '${bad}'\n` });
      try {
        expect(() => load(dir)).toThrow(SchemaValidationError);
        try {
          load(dir);
        } catch (error) {
          const e = error as SchemaValidationError;
          expect(e.issues.some((issue) => issue.path === "identity.email")).toBe(true);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("accepts identity.nationality as an ISO 3166-1 alpha-2 code (v1.11, #334)", () => {
    const dir = makeWorkspace({ "identity.yaml": "name: X\nnationality: VE\n" });
    try {
      const profile = load(dir);
      expect(profile.identity.nationality).toBe("VE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-alpha-2 identity.nationality — the CODE, not the name (v1.11, #334)", () => {
    for (const bad of ["ve", "Venezuela", "VEN", "V3", " V", "VE "]) {
      const dir = makeWorkspace({ "identity.yaml": `name: X\nnationality: '${bad}'\n` });
      try {
        expect(() => load(dir)).toThrow(SchemaValidationError);
        try {
          load(dir);
        } catch (error) {
          const e = error as SchemaValidationError;
          expect(e.issues.some((issue) => issue.path === "identity.nationality")).toBe(true);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("STILL rejects mailto: in identity.links — the #53 http(s) boundary holds (option B)", () => {
    const dir = makeWorkspace({
      "identity.yaml":
        'name: X\nemail: x@example.com\nlinks:\n  - platform: email\n    label: Email\n    url: "mailto:x@example.com"\n',
    });
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
      try {
        load(dir);
      } catch (error) {
        const e = error as SchemaValidationError;
        expect(e.issues.some((issue) => issue.path === "identity.links.0.url")).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
