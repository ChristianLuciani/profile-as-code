/**
 * The contract-floor policy has ONE canonical statement (SPEC §7.6) and must
 * never regress to the retired "declares and is never enforced" phrasing: this
 * PR makes `pasco migrate` refuse a >=2.0/INVALID floor, so the old sentence is
 * false on a published surface (the class-3 recurrence the fresh passes kept
 * finding). This gate scans the docs corpus and the CLI sources, not a
 * hand-picked list, so a new surface cannot restate the claim silently.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const SURFACES = [
  ...walk(join(ROOT, "docs"))
    .filter((file) => file.endsWith(".md") && !file.includes("/research/"))
    .map((file) => relative(ROOT, file)),
  ...walk(join(ROOT, "packages/cli/src"))
    .filter((file) => file.endsWith(".ts") && !file.includes("/generated/"))
    .map((file) => relative(ROOT, file)),
  "README.md",
  "packages/cli/README.md",
  "schema/README.md",
];

describe("the contract-floor policy has no 'never enforced' surface", () => {
  for (const file of SURFACES) {
    it(`${file} does not claim the floor is unenforced`, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).not.toMatch(/never enforced/i);
      expect(source).not.toMatch(/do(?:es)? not read it/i);
      // `validate`/`export profile` never read the floor; only build/preview
      // (notice) and migrate (refusal) do.
      expect(source).not.toMatch(/reader for [^.\n]*validate/i);
    });
  }

  it("SPEC §7.6 names the strictest-floor exception", () => {
    const spec = readFileSync(join(ROOT, "docs/SPEC.md"), "utf8");
    expect(spec).toContain("migration notice/refusal is the opposite");
    expect(spec).toContain("strictest");
  });
});
