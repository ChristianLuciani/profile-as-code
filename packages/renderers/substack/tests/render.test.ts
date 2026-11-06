/**
 * Renderer `substack` (issue #483) — the sheet is the deploy artifact, so the
 * tests pin its bytes: the golden sheet, the two-run determinism the issue asks
 * for, the `es`→`en` fallback delegated to core's `textOf`, and the empty render
 * that makes `pasco build` unbuild the platform.
 *
 * Every slice comes from a real workspace through `load()` + `compile()`, not a
 * hand-built object: the lang fallback and the exact bio slice are behaviour of
 * the engine, and a hand-built slice would test the test.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedProfile } from "@profile-as-code/core";
import { compile, load } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { deploySpec, render } from "../src/index.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-substack-renderer-"));
  tempDirs.push(dir);
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(content, name), body, "utf8");
  }
  return dir;
}

function profileOf(files: Record<string, string>): LoadedProfile {
  return load(workspace(files));
}

const IDENTITY = `name: Elena Vasquez
handle: "@elenavasquez"
links:
  - platform: github
    label: GitHub
    url: https://github.com/elenavasquez
  - platform: substack
    label: Substack
    url: https://elenavasquez.substack.com
`;

const BILINGUAL_NEWSLETTER = `platform: substack
url: https://elenavasquez.substack.com
cadence: weekly
name:
  en: Notes on Sovereign AI
  es: Notas sobre IA soberana
description:
  en: Notes on sovereign AI, open education and generative-engine optimization.
  es: Notas sobre IA soberana, educación abierta y optimización para motores generativos.
`;

const EXPECTED_EN = `# Substack — Elena Vasquez (en)
Handle: @elenavasquez
Display name: Elena Vasquez
Bio (profile): Sovereign AI infrastructure · open-source education · GEO for profiles.
About: Elena Vasquez builds sovereign AI infrastructure. She leads the open-source example-agentic-hub project, routes LLM traffic to local-first providers and writes about generative-engine optimization for professional profiles.
Links: https://github.com/elenavasquez · https://elenavasquez.substack.com
Publication: Notes on Sovereign AI
Short description: Notes on sovereign AI, open education and generative-engine optimization.
Cadence: weekly
Canonical: https://elenavasquez.substack.com
`;

function fullWorkspace(): Record<string, string> {
  return {
    "identity.yaml": IDENTITY,
    "bios.yaml": `- platform: substack
  lang: en
  length: short
  text: Sovereign AI infrastructure · open-source education · GEO for profiles.
- platform: substack
  lang: en
  length: long
  text: Elena Vasquez builds sovereign AI infrastructure. She leads the open-source
    example-agentic-hub project, routes LLM traffic to local-first providers and
    writes about generative-engine optimization for professional profiles.
`,
    "newsletter.yaml": BILINGUAL_NEWSLETTER,
  };
}

describe("substack renderer (issue #483)", () => {
  it("declares the manual deploy spec (§7 union) and no assets", () => {
    expect(deploySpec).toBe("manual");
    expect(render(compile(profileOf(fullWorkspace()), "substack", "en")).assets).toBeUndefined();
  });

  it("renders the golden paste sheet byte-for-byte", () => {
    const slice = compile(profileOf(fullWorkspace()), "substack", "en");
    expect(render(slice).text).toBe(EXPECTED_EN);
  });

  it("is deterministic: two runs produce the same bytes", () => {
    const profile = profileOf(fullWorkspace());
    const first = render(compile(profile, "substack", "en")).text;
    const second = render(compile(profile, "substack", "en")).text;
    expect(second).toBe(first);
  });

  it("resolves newsletter langMaps with core's es→en fallback (#415), never a local copy", () => {
    // Only the newsletter is bilingual here: the bio slice is empty for `es`
    // (compile filters bios exactly), so the publication lines prove the fallback.
    const dir = workspace({
      "identity.yaml": IDENTITY,
      "newsletter.yaml": `platform: substack
url: https://elenavasquez.substack.com
cadence: weekly
name:
  en: Notes on Sovereign AI
description:
  en: Notes on sovereign AI, open education and generative-engine optimization.
`,
    });
    const text = render(compile(load(dir), "substack", "es")).text;
    expect(text).toContain("# Substack — Elena Vasquez (es)");
    expect(text).toContain("Publication: Notes on Sovereign AI");
    expect(text).toContain(
      "Short description: Notes on sovereign AI, open education and generative-engine optimization.",
    );
    expect(text).not.toContain("Bio (profile):");
    expect(text).not.toContain("About:");
  });

  it("prefers a claimed substack socialHandle over the generic identity handle", () => {
    const dir = workspace({
      "identity.yaml": `name: Topia Press
handle: topiapress
links:
  - label: Site
    url: https://topia.press
`,
      "socialHandles.yaml": `- platform: x
  handle: topiapress
  status: claimed
- platform: substack
  handle: from-the-matrix
  status: claimed
`,
      "newsletter.yaml": "platform: substack\nurl: https://topiapress.substack.com\n",
    });
    const text = render(compile(load(dir), "substack", "en")).text;
    expect(text).toContain("Handle: @from-the-matrix");
  });

  it("omits a line the SSOT does not declare", () => {
    const dir = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "bios.yaml": "- platform: substack\n  lang: en\n  length: short\n  text: Header bio.\n",
    });
    const text = render(compile(load(dir), "substack", "en")).text;
    expect(text).toBe(
      "# Substack — Elena Vasquez (en)\nDisplay name: Elena Vasquez\nBio (profile): Header bio.\n",
    );
  });

  it("returns an empty render when the workspace has no substack bio and no newsletter", () => {
    const dir = workspace({ "identity.yaml": IDENTITY });
    expect(render(compile(load(dir), "substack", "en")).text).toBe("");
  });

  it("still renders the publication when no bio row exists (either body is enough)", () => {
    const dir = workspace({
      "identity.yaml": IDENTITY,
      "newsletter.yaml": "platform: substack\nurl: https://elenavasquez.substack.com\n",
    });
    const text = render(compile(load(dir), "substack", "en")).text;
    expect(text).toContain("Canonical: https://elenavasquez.substack.com");
    expect(text).not.toContain("Bio (profile):");
  });
});
