/**
 * The contract-floor policy has ONE canonical statement (SPEC §7.6) and must
 * never regress to the retired "declares and is never enforced" phrasing: this
 * PR makes `pasco migrate` refuse a >=2.0/INVALID floor, so the old sentence is
 * false on a published surface (the class-3 recurrence the fresh passes kept
 * finding). This is the gate that closes the class, not another local edit.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SURFACES = [
  "docs/SPEC.md",
  "docs/USER-GUIDE.md",
  "packages/cli/src/index.ts",
  "packages/cli/src/commands/doctor.ts",
  "packages/cli/src/workspace.ts",
] as const;

describe("the contract-floor policy has no 'never enforced' surface", () => {
  for (const file of SURFACES) {
    it(`${file} does not claim the floor is unenforced`, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).not.toMatch(/never enforced/i);
      expect(source).not.toMatch(/do(?:es)? not read it/i);
    });
  }

  it("SPEC §7.6 names the strictest-floor exception", () => {
    const spec = readFileSync(join(ROOT, "docs/SPEC.md"), "utf8");
    expect(spec).toContain("migration notice/refusal is the opposite");
    expect(spec).toContain("strictest");
  });
});
