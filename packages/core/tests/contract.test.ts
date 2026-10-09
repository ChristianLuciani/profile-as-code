/**
 * Contract tests for the platform set (D16, issue #30): Postiz parity + operator
 * extras. Guards the single-source discipline the schema documents:
 *   - the generated `PLATFORM_VALUES` matches the schema enum (codegen boundary)
 *   - PLATFORMS has no duplicates
 *   - behavior: new platform hosts are recognized by drift (patreon regression,
 *     ghost subdomains) and accepted by load (checks + bios on new platforms)
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLATFORM_VALUES } from "../src/generated/schema.zod.js";
import { driftCheck, load, PASTE_PLATFORMS, PLATFORMS } from "../src/index.js";

const SCHEMA = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../schema/profile.schema.json", import.meta.url)),
    "utf8",
  ),
) as {
  $defs: { platform: { enum: string[] }; check: { properties: { platform: { enum: string[] } } } };
};

function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-contract-"));
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(content, name), body, "utf8");
  }
  return dir;
}

const clean = (dir: string) => rmSync(dir, { recursive: true, force: true });

describe("platform set contract (D16)", () => {
  it("the generated platform value list matches the schema enum (codegen boundary)", () => {
    // Both lists are generated from `$defs.platform.enum` by scripts/gen-zod.ts:
    // a stale commit (schema changed, `pnpm gen:zod` not run) fails here.
    expect([...PLATFORM_VALUES]).toEqual(SCHEMA.$defs.platform.enum);
  });

  it("PLATFORMS (registry projection) matches the schema enum (#154)", () => {
    // `PLATFORMS` now comes from `platforms/registry.yaml` via `pnpm gen:platforms`;
    // the registry ↔ enum ↔ generated agreement is the CI contract
    // (scripts/schema-check/check.py). A stale projection fails here.
    expect([...PLATFORMS]).toEqual(SCHEMA.$defs.platform.enum);
  });

  it("PLATFORMS has no duplicates", () => {
    expect(new Set(PLATFORMS).size).toBe(PLATFORMS.length);
  });

  it('check.platform enum == ["all", ...platform] (schema dedup contract)', () => {
    expect(SCHEMA.$defs.check.properties.platform.enum).toEqual([
      "all",
      ...SCHEMA.$defs.platform.enum,
    ]);
  });
});

describe("drift recognizes the new platforms (Postiz parity + extras)", () => {
  // identity.links only holds the website — every platform-host project link is
  // an uncanonicalized duplicate and must warn.
  const makeProfile = () =>
    makeWorkspace({
      "identity.yaml": `name: Test
location: Test City
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      "projects.yaml": `- name: Demo
  links:
    - https://patreon.com/testcreator
    - https://blog.ghost.io/hello-world
    - https://twitch.tv/teststreamer
    - https://moltbook.com/u/test
`,
    });

  it("warns on platform-host URLs missing from identity.links (patreon regression)", () => {
    const dir = makeProfile();
    try {
      const issues = driftCheck(load(dir));
      const codes = issues.map((i) => i.code);
      expect(codes).toContain("drift/url-not-in-identity");
      // patreon.com specifically (was missing from PLATFORM_HOSTS before D16)
      expect(issues.some((i) => i.path === "projects[0].links[0]")).toBe(true);
    } finally {
      clean(dir);
    }
  });

  it("treats ghost subdomains as platform surfaces (v1.2 operator extra)", () => {
    const dir = makeProfile();
    try {
      const issues = driftCheck(load(dir));
      expect(
        issues.some(
          (i) => i.code === "drift/url-not-in-identity" && i.path === "projects[0].links[1]",
        ),
      ).toBe(true);
    } finally {
      clean(dir);
    }
  });

  it("treats twitch and moltbook as platform surfaces (Postiz parity)", () => {
    const dir = makeProfile();
    try {
      const issues = driftCheck(load(dir));
      const paths = issues.filter((i) => i.code === "drift/url-not-in-identity").map((i) => i.path);
      expect(paths).toContain("projects[0].links[2]"); // twitch.tv
      expect(paths).toContain("projects[0].links[3]"); // moltbook.com
    } finally {
      clean(dir);
    }
  });

  it("treats ko-fi.com as a platform surface (v1.7 operator extra, #130)", () => {
    const dir = makeWorkspace({
      "identity.yaml": `name: Test
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      "projects.yaml": `- name: Demo
  links:
    - https://ko-fi.com/testcreator
`,
    });
    try {
      const issues = driftCheck(load(dir));
      expect(
        issues.some(
          (i) => i.code === "drift/url-not-in-identity" && i.path === "projects[0].links[0]",
        ),
      ).toBe(true);
    } finally {
      clean(dir);
    }
  });

  it("treats the creator-monetization hosts as platform surfaces (v1.8, #133)", () => {
    const dir = makeWorkspace({
      "identity.yaml": `name: Test
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      "projects.yaml": `- name: Demo
  links:
    - https://buymeacoffee.com/testcreator
    - https://liberapay.com/testcreator
    - https://nat.gumroad.com/
    - https://payhip.com/teststore
`,
    });
    try {
      const issues = driftCheck(load(dir));
      const paths = issues.filter((i) => i.code === "drift/url-not-in-identity").map((i) => i.path);
      expect(paths).toContain("projects[0].links[0]"); // buymeacoffee.com
      expect(paths).toContain("projects[0].links[1]"); // liberapay.com
      expect(paths).toContain("projects[0].links[2]"); // <user>.gumroad.com (subdomain)
      expect(paths).toContain("projects[0].links[3]"); // payhip.com
    } finally {
      clean(dir);
    }
  });

  it("treats hotmart.com as a platform surface (v1.9, #137)", () => {
    const dir = makeWorkspace({
      "identity.yaml": `name: Test
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      "projects.yaml": `- name: Demo
  links:
    - https://hotmart.com/testcreator
`,
    });
    try {
      const issues = driftCheck(load(dir));
      expect(
        issues.some(
          (i) => i.code === "drift/url-not-in-identity" && i.path === "projects[0].links[0]",
        ),
      ).toBe(true);
    } finally {
      clean(dir);
    }
  });

  it("does not warn for open-ended instance hosts (mastodon beyond curated)", () => {
    const dir = makeWorkspace({
      "identity.yaml": `name: Test
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      "projects.yaml": `- name: Demo
  links:
    - https://fosstodon.org/@someone
`,
    });
    try {
      const issues = driftCheck(load(dir));
      expect(
        issues.some((i) => i.code === "drift/url-not-in-identity" && i.path.includes("projects")),
      ).toBe(false);
    } finally {
      clean(dir);
    }
  });
});

describe("load accepts new platforms (schema parity end-to-end)", () => {
  it("validates bios/checks using v1.2 platforms (ghost, devto, linkedin-page)", () => {
    const dir = makeWorkspace({
      "identity.yaml": `name: Test
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      "bios.yaml": `- platform: ghost
  lang: en
  length: short
  text: Ghost bio for the v1.2 set.
- platform: devto
  lang: en
  length: medium
  text: Dev.to bio for the Postiz-parity set.
`,
      "checks.yaml": `- platform: linkedin-page
  rule: max-chars
  value: 200
`,
    });
    try {
      const profile = load(dir);
      expect(profile.bios?.map((b) => b.platform)).toEqual(["ghost", "devto"]);
      expect(profile.checks?.[0]?.platform).toBe("linkedin-page");
    } finally {
      clean(dir);
    }
  });

  it("validates kofi end-to-end: bio + check + handle + ledger (v1.7, #130)", () => {
    const dir = makeWorkspace({
      "identity.yaml": `name: Test
handle: kluciani
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      "bios.yaml": `- platform: kofi
  lang: en
  length: long
  text: Ko-fi About body — the paste source for the creator page.
`,
      "checks.yaml": `- platform: kofi
  rule: max-chars
  value: 500
`,
      "socialHandles.yaml": `- platform: kofi
  handle: kluciani
  status: claimed
  url: https://ko-fi.com/kluciani
`,
      "deployments.yaml": `bios:kofi.long@en:
    kofi:
      deployedAt: "2026-10-05T10:00:00Z"
      contentHash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      source: manual
`,
    });
    try {
      const profile = load(dir);
      expect(profile.bios?.map((b) => b.platform)).toEqual(["kofi"]);
      expect(profile.checks?.[0]?.platform).toBe("kofi");
      expect(Object.keys(profile.deployments ?? {})).toContain("bios:kofi.long@en");
    } finally {
      clean(dir);
    }
  });

  // Derived from `platforms/registry.yaml` (#154), never a hand-extended list:
  // the creator-monetization members added v1.8+, with a handle URL built from
  // each entry's handle host. For hotmart the apex carries the handle path — the
  // offline handle proxy checks host consistency only, so that exercises the
  // same contract without claiming a verified shape (issue #137).
  it.each(
    PASTE_PLATFORMS.map((entry) => [entry.platform, `https://${entry.host}/kluciani`] as const),
  )(
    "validates %s end-to-end: bio + check + handle + ledger (v1.8/v1.9, #133/#137)",
    (slug, handleUrl) => {
      const dir = makeWorkspace({
        "identity.yaml": `name: Test
handle: kluciani
links:
  - platform: website
    label: Site
    url: https://example.org
`,
        "bios.yaml": `- platform: ${slug}
  lang: en
  length: long
  text: Creator monetization body — the paste source for the platform profile.
`,
        "checks.yaml": `- platform: ${slug}
  rule: max-chars
  value: 500
`,
        "socialHandles.yaml": `- platform: ${slug}
  handle: kluciani
  status: claimed
  url: ${handleUrl}
`,
        "deployments.yaml": `bios:${slug}.long@en:
    ${slug}:
      deployedAt: "2026-10-05T10:00:00Z"
      contentHash: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
      source: manual
`,
      });
      try {
        const profile = load(dir);
        expect(profile.bios?.map((b) => b.platform)).toEqual([slug]);
        expect(profile.checks?.[0]?.platform).toBe(slug);
        expect(Object.keys(profile.deployments ?? {})).toContain(`bios:${slug}.long@en`);
      } finally {
        clean(dir);
      }
    },
  );
});
