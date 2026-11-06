/**
 * `targetedSurfaces()` — "targeted means buildable" (#483, the ESCALATE(2)
 * instrument).
 *
 * The class the escalation named: a curated row (socialHandle, keyword, active
 * entry, headline, newsletter) could put a platform in `fact-present`'s scope
 * even when `pasco build` has no path to an artifact for it, leaving a
 * permanent `notRun` whose advice ("run pasco build") can never be satisfied.
 * The predicate is now ONE function shared by every leg; this test asserts the
 * property, not a single case: every returned surface has a build path (renderer
 * / bios paste / active variant).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { targetedSurfaces } from "../src/fact-present.js";
import { RENDERERS } from "../src/generated/renderers.gen.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-targeted-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "content"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, "content", name), body, "utf8");
  }
  return dir;
}

function isBuildable(profile: ReturnType<typeof load>, surface: string): boolean {
  return (
    RENDERERS[surface] !== undefined ||
    profile.bios.some((bio) => bio.platform === surface) ||
    profile.active?.[surface] !== undefined
  );
}

describe("targetedSurfaces — targeted means buildable (#483)", () => {
  it("drops every curated surface no build can satisfy and keeps the buildable ones", () => {
    const profile = load(
      workspace({
        "identity.yaml": "name: Elena Vasquez\n",
        // kofi has no renderer, but this bio row makes the flat paste buildable.
        "bios.yaml": "- platform: kofi\n  lang: en\n  length: short\n  text: Support the work.\n",
        // A claimed handle alone cannot build: x has no renderer and no bio row.
        "socialHandles.yaml": "- platform: x\n  handle: elena\n  status: claimed\n",
        // A keyword row and a newsletter block alone cannot build either.
        "keywords.yaml": "seo:\n  ghost:\n    - notes\n",
        "newsletter.yaml": "platform: ghost\nurl: https://notes.elena.dev\n",
      }),
    );
    const targeted = targetedSurfaces(profile);
    for (const surface of targeted) {
      expect(isBuildable(profile, surface), `${surface} must have a build path`).toBe(true);
    }
    expect(targeted).not.toContain("x");
    expect(targeted).not.toContain("ghost");
    expect(targeted).toContain("kofi");
  });

  it("keeps a newsletter platform a renderer owns and a paste platform with a bio", () => {
    const profile = load(
      workspace({
        "identity.yaml": "name: Elena Vasquez\n",
        "bios.yaml": "- platform: ghost\n  lang: en\n  length: short\n  text: A Ghost bio.\n",
        "newsletter.yaml": "platform: substack\nurl: https://elenavasquez.substack.com\n",
      }),
    );
    const targeted = targetedSurfaces(profile);
    // substack has a renderer; ghost builds through the shared paste fallback.
    expect(targeted).toContain("substack");
    expect(targeted).toContain("ghost");
    for (const surface of targeted) {
      expect(isBuildable(profile, surface), `${surface} must have a build path`).toBe(true);
    }
  });
});
