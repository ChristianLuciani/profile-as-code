/**
 * The GEO section human line (SPEC §8/#399).
 *
 * The all-N/A branch is unreachable through a profile today (every shipped
 * section keeps at least one always-applicable code), so it is pinned here
 * against the exported formatter rather than through `pasco validate` output.
 */

import type { GeoSection } from "@profile-as-code/core";
import { describe, expect, it } from "vitest";
import { geoSectionLine } from "../src/commands/validate.js";

const section = (overrides: Partial<GeoSection> = {}): GeoSection => ({
  label: "Citability",
  detail: "claims, answers, disambiguation",
  checks: [],
  score: 41,
  ...overrides,
});

describe("geoSectionLine", () => {
  it("renders a measured section with its score", () => {
    expect(geoSectionLine(section())).toBe(
      "  Citability: 41/100 — claims, answers, disambiguation",
    );
  });

  it("renders an all-N/A section as n/a, never 0/100 (§8/#399)", () => {
    expect(geoSectionLine(section({ score: 0, applicable: false }))).toBe(
      "  Citability: n/a — claims, answers, disambiguation",
    );
  });
});
