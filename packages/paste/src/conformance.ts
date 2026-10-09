/**
 * The shared paste conformance body (#150/#157): ONE suite, run by every paste
 * adapter against its own `render`, so the guarantee cannot drift per adapter.
 *
 * It ships as a subpath (`@profile-as-code/paste/conformance`) consumed only by
 * tests, keeping the runtime entry free of the test tool. That is exactly why
 * this lives in a renderer support package and not in `core`: a conformance
 * body in the engine's dist would drag vitest into the engine's runtime (the
 * operator's ratified decision, option B, 2026-10-07).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BioLength,
  compile,
  type Lang,
  load,
  type Platform,
  type PlatformProfile,
} from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";

/** The renderer surface a paste adapter exposes (SPEC §7). */
export interface PasteRenderResult {
  text: string;
  assets?: string[];
}

export interface PasteConformanceOptions {
  /** SPEC §7 renderer id — `compile()` filters `bios` by this EXACT platform. */
  platform: Platform;
  /** The adapter's `render`. */
  render: (p: PlatformProfile) => PasteRenderResult;
}

const tempDirs: string[] = [];

/**
 * Build a `compile()` slice for `platform` from a `bios.yaml` body. Exported so
 * an adapter's platform-fact assertions reuse the shared fixture instead of
 * copying the workspace scaffolding. Call it from a suite that also runs
 * `describePasteConformance` — cleanup is that suite's `afterAll`.
 */
export function pasteSlice(platform: Platform, bios: string, lang: Lang = "en"): PlatformProfile {
  const dir = mkdtempSync(join(tmpdir(), `pasco-paste-${platform}-`));
  tempDirs.push(dir);
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "identity.yaml"), "name: Elena Vasquez\n");
  writeFileSync(join(content, "bios.yaml"), bios);
  return compile(load(dir), platform, lang);
}

/** One `bios` row, YAML-safe (`JSON.stringify` keeps a leading `#` a scalar). */
export function pasteRow(
  platform: Platform,
  length: BioLength,
  text: string,
  lang: Lang = "en",
): string {
  return `- platform: ${platform}\n  lang: ${lang}\n  length: ${length}\n  text: ${JSON.stringify(text)}\n`;
}

/**
 * Register the shared paste guarantee as a suite: length priority
 * (`long` > `medium` > `short`), EXACTLY ONE row verbatim + `"\n"` (D18 hashes
 * one row — never a merge), byte stability, `""` on an empty slice (§15.1
 * unbuild), and exact-lang isolation (no `en` fallback).
 */
export function describePasteConformance({ platform, render }: PasteConformanceOptions): void {
  afterAll(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  describe(`shared paste guarantee — ${platform}`, () => {
    it("picks the LONG row by priority; falls back medium, then short", () => {
      const all =
        pasteRow(platform, "long", "L.") +
        pasteRow(platform, "medium", "M.") +
        pasteRow(platform, "short", "S.");
      expect(render(pasteSlice(platform, all)).text).toBe("L.\n");

      const mediumShort = pasteRow(platform, "medium", "M.") + pasteRow(platform, "short", "S.");
      expect(render(pasteSlice(platform, mediumShort)).text).toBe("M.\n");
      expect(render(pasteSlice(platform, pasteRow(platform, "short", "S."))).text).toBe("S.\n");
    });

    it("passes ONE row through verbatim plus a trailing newline (markdown chars survive; never a merge — D18 hashes one row)", () => {
      const body = "# Heading kept verbatim\n\nSee [link](https://example.org) `code`.";
      expect(render(pasteSlice(platform, pasteRow(platform, "long", body))).text).toBe(`${body}\n`);
    });

    it("is byte-stable across two runs (§15.1)", () => {
      const bios = pasteRow(platform, "long", "Stable body — identical input, identical bytes.");
      expect(render(pasteSlice(platform, bios)).text).toBe(render(pasteSlice(platform, bios)).text);
    });

    it('returns "" for a platform+lang with no bio row (build unbuilds)', () => {
      const foreignPlatform: Platform = platform === "linkedin" ? "github-org" : "linkedin";
      const foreign = pasteRow(foreignPlatform, "long", "A foreign bio must never leak.");
      expect(render(pasteSlice(platform, foreign)).text).toBe("");
    });

    it("renders only the requested lang slice (compile filters by exact lang)", () => {
      const bios =
        pasteRow(platform, "long", "English body.", "en") +
        pasteRow(platform, "long", "Cuerpo en español.", "es");
      expect(render(pasteSlice(platform, bios, "es")).text).toBe("Cuerpo en español.\n");
    });
  });
}
