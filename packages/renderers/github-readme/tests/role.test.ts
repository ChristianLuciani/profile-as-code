/**
 * Link roles (v1.6, #103) — `identity.links[].role` and its schema.org consequences.
 *
 * The role is a TRANSLATION LAYER of this engine onto schema.org, which does NOT treat
 * these as interchangeable:
 *   identity    → schema.org:url              (strong: the page IS the entity)  → `@id`
 *   realization → schema.org:sameAs           (weak: indirectly indicates it)   → `sameAs`
 *   aggregator  → schema.org:mainEntityOfPage (medium: aggregates references)   → neither
 *
 * Absent role = `realization` — the additive default: pre-v1.6 workspaces keep VALIDATING
 * unchanged (output does change; SPEC §15.4 lists the three deltas). Option A (operator
 * decision, 2026-09-24): an absent `@id` never
 * suppresses the JSON-LD block, because that would strip structured data from every
 * workspace that declares no role.
 *
 * The renderer does NOT derive any of this — core's `structuredData()` owns it and the
 * renderer emits `jsonLd` verbatim (SPEC §15.4; the §18.9 credentialLdEntries precedent).
 * These tests assert the renderer honours that split, and that it holds for BOTH the
 * `compile()` slice and a hand-built slice (so the contract is not accidentally tied to
 * fixture shape).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, geoCheck, load } from "@profile-as-code/core";
import { describe, expect, it } from "vitest";
import { render } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MINIMAL = join(__dirname, "..", "..", "..", "core", "tests", "fixtures", "minimal");

/** Build a slice from hand-written YAML files (mirrors the suite's existing helper). */
function sliceFrom(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "pasco-role-"));
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(content, name), body);
  const profile = load(dir);
  return {
    slice: compile(profile, "github-readme", "en"),
    cleanup: () => rmSync(dir, { recursive: true }),
  };
}

/** The JSON-LD object rendered into the README, parsed back. */
function jsonLdOf(text: string): Record<string, unknown> {
  const block = text.split("<!-- JSON-LD (schema.org Person) -->")[1];
  if (block === undefined) throw new Error("no JSON-LD block in output");
  const json = block.split("```json")[1]?.split("```")[0];
  if (json === undefined) throw new Error("no json fence in block");
  return JSON.parse(json) as Record<string, unknown>;
}

const IDENTITY = (links: string): string =>
  `name: Elena Vasquez\nlocation: Madrid, Spain\nphoto: https://example.com/e.jpg\nlinks:\n${links}`;

describe("link roles (v1.6, #103) — @id derivation", () => {
  it("emits @id from the role: identity link", () => {
    const { slice, cleanup } = sliceFrom({
      "identity.yaml": IDENTITY(
        "  - role: identity\n    label: Site\n    url: https://elenavasquez.com\n  - label: GitHub\n    url: https://github.com/elenavasquez\n",
      ),
    });
    try {
      expect(jsonLdOf(render(slice).text)["@id"]).toBe("https://elenavasquez.com");
    } finally {
      cleanup();
    }
  });

  it("omits @id when no link declares role: identity — but still emits the JSON-LD (Option A)", () => {
    const { slice, cleanup } = sliceFrom({
      "identity.yaml": IDENTITY("  - label: GitHub\n    url: https://github.com/elenavasquez\n"),
    });
    try {
      const ld = jsonLdOf(render(slice).text);
      expect(ld["@id"]).toBeUndefined();
      // The block itself survives: suppressing it would strip structured data from every
      // pre-v1.6 workspace (which declares no role).
      expect(ld["@type"]).toBe("Person");
      expect(ld.name).toBe("Elena Vasquez");
    } finally {
      cleanup();
    }
  });

  it("takes the FIRST role: identity link — the user's declaration order is the user's decision", () => {
    // No hostname ranking (an earlier draft ranked "own domain > social network" and was
    // deleted, operator decision 2026-09-24): the engine does not second-guess which link
    // the user marked as their entity. It is self-correcting — reorder, or mark another.
    const { slice, cleanup } = sliceFrom({
      "identity.yaml": IDENTITY(
        "  - role: identity\n    url: https://linkedin.com/in/elenavasquez\n  - role: identity\n    url: https://elenavasquez.com\n",
      ),
    });
    try {
      expect(jsonLdOf(render(slice).text)["@id"]).toBe("https://linkedin.com/in/elenavasquez");
    } finally {
      cleanup();
    }
  });

  it("is deterministic across renders (same slice, same @id — never random)", () => {
    const links =
      "  - role: identity\n    url: https://b.example.com\n  - role: identity\n    url: https://a.example.com\n";
    const first = sliceFrom({ "identity.yaml": IDENTITY(links) });
    const second = sliceFrom({ "identity.yaml": IDENTITY(links) });
    try {
      const a = jsonLdOf(render(first.slice).text)["@id"];
      const b = jsonLdOf(render(second.slice).text)["@id"];
      expect(a).toBe("https://b.example.com");
      expect(a).toBe(b);
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });
});

describe("link roles (v1.6, #103) — sameAs membership", () => {
  it("sameAs carries only role: realization links (never identity, never aggregator)", () => {
    const { slice, cleanup } = sliceFrom({
      "identity.yaml": IDENTITY(
        [
          "  - role: identity\n    url: https://elenavasquez.com",
          "  - url: https://github.com/elenavasquez", // absent role = realization (default)
          "  - role: realization\n    url: https://orcid.org/0000-0001-2345-6789",
          "  - role: aggregator\n    url: https://linktr.ee/elenavasquez",
          "",
        ].join("\n"),
      ),
    });
    try {
      expect(jsonLdOf(render(slice).text).sameAs).toEqual([
        "https://github.com/elenavasquez",
        "https://orcid.org/0000-0001-2345-6789",
      ]);
    } finally {
      cleanup();
    }
  });

  it("an aggregator link is never the @id, even when it is the only candidate the user marked", () => {
    // `aggregator` maps to mainEntityOfPage: a link-in-bio aggregates references to the
    // entity, it does not describe it (schema.org reserves `url` for "the page is 'his'").
    const { slice, cleanup } = sliceFrom({
      "identity.yaml": IDENTITY(
        "  - role: aggregator\n    url: https://linktr.ee/elenavasquez\n  - url: https://github.com/elenavasquez\n",
      ),
    });
    try {
      const ld = jsonLdOf(render(slice).text);
      expect(ld["@id"]).toBeUndefined();
      expect(ld.sameAs).toEqual(["https://github.com/elenavasquez"]);
    } finally {
      cleanup();
    }
  });

  it("the geoCheck diagnostic NAMES the aggregator — it must not claim nothing was declared", () => {
    // The user DID declare something; saying "no link declares role: identity" would be
    // false and would leave them with no idea what to fix.
    const dir = mkdtempSync(join(tmpdir(), "pasco-agg-diag-"));
    const content = join(dir, "content");
    mkdirSync(content, { recursive: true });
    writeFileSync(
      join(content, "identity.yaml"),
      `name: Elena Vasquez\nlinks:\n  - role: aggregator\n    url: https://linktr.ee/elenavasquez\n`,
    );
    try {
      const report = geoCheck(load(dir));
      const check = report.checks.find((c) => c.code === "geo/entity-id");
      expect(check?.score).toBe(0);
      expect(check?.detail).toContain("aggregator");
      expect(check?.detail).toContain("https://linktr.ee/elenavasquez");
      expect(check?.detail).toContain("NOT eligible");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("claimed socialHandles join sameAs (v1.6 delta: the old github-readme did NOT include them)", () => {
    // §17.1 already did this for brand (github-org); v1.6 shares one sameAs builder, so a
    // PERSON workspace with claimed handles now sees them in sameAs too. Declared in SPEC
    // §15.4 delta (b) — pinned here so it cannot drift silently.
    const dir = mkdtempSync(join(tmpdir(), "pasco-handles-"));
    const content = join(dir, "content");
    mkdirSync(content, { recursive: true });
    writeFileSync(
      join(content, "identity.yaml"),
      `name: Elena Vasquez\nlinks:\n  - url: https://github.com/elenavasquez\n`,
    );
    writeFileSync(
      join(content, "socialHandles.yaml"),
      "- platform: x\n  handle: elenavasquez\n  status: claimed\n  url: https://x.com/elenavasquez\n- platform: bluesky\n  handle: elena\n  status: pending\n",
    );
    try {
      const ld = jsonLdOf(render(compile(load(dir), "github-readme", "en")).text);
      // claimed → included; pending → never (it has no URL by definition)
      expect(ld.sameAs).toEqual(["https://github.com/elenavasquez", "https://x.com/elenavasquez"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("the visible Links section still lists EVERY link (roles gate structured data, not the human list)", () => {
    const { slice, cleanup } = sliceFrom({
      "identity.yaml": IDENTITY(
        "  - role: identity\n    label: Site\n    url: https://elenavasquez.com\n  - role: aggregator\n    label: Links\n    url: https://linktr.ee/elenavasquez\n",
      ),
    });
    try {
      const text = render(slice).text;
      const linksSection = text.split("## Links")[1]?.split("<!--")[0] ?? "";
      expect(linksSection).toContain("https://elenavasquez.com");
      expect(linksSection).toContain("https://linktr.ee/elenavasquez");
    } finally {
      cleanup();
    }
  });
});

describe("link roles (v1.6, #103) — hand-built slices", () => {
  it("a slice without structuredData renders (no throw) instead of dereferencing undefined", () => {
    // The docblock claims hand-built slices are covered; `sliceFrom()` calls compile(), so
    // this is the test that actually holds it. A compile() slice always carries
    // `structuredData`; a hand-built one may not — that is the documented seam.
    const compiled = compile(load(MINIMAL), "github-readme", "en");
    const { structuredData: _omit, ...handBuilt } = compiled;
    const text = render(handBuilt as unknown as typeof compiled).text;
    expect(text).toContain("# Elena Vasquez");
    expect(text).not.toContain("JSON-LD");
  });
});

describe("link roles (v1.6, #103) — backward compatibility", () => {
  it("a workspace with no role anywhere renders byte-identically to its role: realization form", () => {
    // The additive guarantee (dev-methodology §3): absent role = realization, so declaring
    // it explicitly must change nothing in the output.
    const bare = sliceFrom({
      "identity.yaml": IDENTITY("  - label: GitHub\n    url: https://github.com/elenavasquez\n"),
    });
    const explicit = sliceFrom({
      "identity.yaml": IDENTITY(
        "  - role: realization\n    label: GitHub\n    url: https://github.com/elenavasquez\n",
      ),
    });
    try {
      expect(render(bare.slice).text).toBe(render(explicit.slice).text);
    } finally {
      bare.cleanup();
      explicit.cleanup();
    }
  });

  it("a role the schema does not allow is rejected at load (the enum is the contract)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-role-bad-"));
    const content = join(dir, "content");
    mkdirSync(content, { recursive: true });
    writeFileSync(
      join(content, "identity.yaml"),
      IDENTITY("  - role: canonical\n    url: https://elenavasquez.com\n"),
    );
    try {
      expect(() => load(dir)).toThrow();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("the shipped minimal fixture keeps its JSON-LD (no regression from the refactor)", () => {
    const slice = compile(load(MINIMAL), "github-readme", "en");
    const ld = jsonLdOf(render(slice).text);
    expect(ld["@type"]).toBe("Person");
    // The fixture declares no role: no @id, and every link stays in sameAs.
    expect(ld["@id"]).toBeUndefined();
    expect((ld.sameAs as string[]).length).toBe(5);
  });
});
