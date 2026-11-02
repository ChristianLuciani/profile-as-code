/**
 * The ONE quantitative-claim predicate (#437).
 *
 * The table is the gate: `unsourced-claim` is a WARN an author has to clear, and
 * the only honest clear for a private fact (`76`) or a prose year (`Aug 2024`) is
 * deleting the truth or inventing a source. Direction (a) of #437 narrows the
 * predicate to numbers that carry a unit, currency or percent marker, so this
 * table pins both directions of the line — a future widening that starts
 * flagging ages or years fails here instead of in a user's audit.
 */

import { describe, expect, it } from "vitest";
import { isQuantitativeClaim } from "../src/claims.js";

/** [text, expected]. The first six rows are #437's acceptance table, verbatim. */
const TABLE: ReadonlyArray<readonly [string, boolean]> = [
  ["Aug 2024", false],
  ["76", false],
  ["800+", true],
  ["$2M", true],
  ["36 tutors", true],
  ["195 jurisdictions", true],
  // The reported field, verbatim: an age is a fact about the subject, not a claim.
  [
    "Voice-guided PWA for my father (76, post-stroke aphasia). Offline-first, zero telemetry.",
    false,
  ],
  // A standalone calendar year is a date even when a word follows it...
  ["in 2024 the hub served requests", false],
  ["Since Aug 2024 the project ships weekly.", false],
  // ...but an explicit marker still makes a year-shaped token a quantity.
  ["2024%", true],
  // Percent and currency keep the broad rule.
  ["40% of the traffic", true],
  ["saved $500", true],
  ["€1.2M raised", true],
  // A number with a unit is a claim, in prose and with separators.
  ["12 years of experience", true],
  ["10,000 followers", true],
  ["1.5k downloads", true],
  ["3,000 users", true],
  // No digit, no claim; version-like runs without a unit are not measurements.
  ["no numbers here", false],
  ["v2.1.0", false],
  ["released on 2024-11-02", false],
  ["", false],
];

describe("isQuantitativeClaim — a number is a claim only with a quantity marker (#437)", () => {
  for (const [text, expected] of TABLE) {
    it(`${expected ? "claims" : "ignores"} ${JSON.stringify(text)}`, () => {
      expect(isQuantitativeClaim(text)).toBe(expected);
    });
  }

  it("does not treat a comma-after-number as a unit (the age in the field report)", () => {
    // Regression pin for `76, post-stroke aphasia`: the old `\b\d{2,}\b` flagged
    // it; a trailing separator must not turn the age into `76` + unit.
    expect(isQuantitativeClaim("my father (76, post-stroke aphasia)")).toBe(false);
  });
});
