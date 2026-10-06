/**
 * Shared paste-renderer core conformance (#150) — the ONE body asserting the
 * paste guarantee at its home: length priority, verbatim single-row
 * pass-through (D18 hashes exactly one bios row — never a merge), byte
 * stability, "" on an empty slice (§15.1 unbuild). Adapter suites keep their
 * platform facts and delegate to this contract.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compile, load, pasteSource } from "../src/index.js";

const dirs: string[] = [];
function slice(bios: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-paste-"));
  dirs.push(dir);
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "identity.yaml"), "name: Elena Vasquez\n");
  writeFileSync(join(content, "bios.yaml"), bios);
  return pasteSource(compile(load(dir), "linkedin", "en"));
}

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** JSON.stringify keeps the scalar YAML-safe (a leading `#` would open a comment). */
const row = (length: string, text: string, platform = "linkedin") =>
  `- platform: ${platform}\n  lang: en\n  length: ${length}\n  text: ${JSON.stringify(text)}\n`;

describe("pasteSource — shared paste-core contract (#150)", () => {
  it("picks the LONG row by priority; falls back medium, then short", () => {
    expect(slice(row("long", "L.") + row("medium", "M.") + row("short", "S."))).toBe("L.\n");
    expect(slice(row("medium", "M.") + row("short", "S."))).toBe("M.\n");
    expect(slice(row("short", "S."))).toBe("S.\n");
  });

  it("passes ONE row through VERBATIM (markdown chars survive; never a merge — D18 hashes one row)", () => {
    expect(slice(row("long", "# Head. [link](u) `code`"))).toBe("# Head. [link](u) `code`\n");
  });

  it("is byte-stable across two runs (§15.1)", () => {
    const bios = row("long", "Stable body — identical input, identical bytes.");
    expect(slice(bios)).toBe(slice(bios));
  });

  it('returns "" for a platform+lang with no bio row (build unbuilds)', () => {
    expect(slice(row("long", "another platform's row.", "x"))).toBe("");
  });
});
