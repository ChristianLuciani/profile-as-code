import { describe, expect, it } from "vitest";
import { byteOrder } from "../src/byte-order.js";

describe("byteOrder — the one text-order home (D19, #305)", () => {
  it("is UTF-16 code-unit order: uppercase closes FIRST (ICU would read the other way)", () => {
    // Measured probe (2026-10-24, node 22 ICU): 'apple'.localeCompare('APPLE')
    // is -1 under the English collation (lowercase first); code units are the
    // opposite — 65 ('A') < 97 ('a') — so this probe FAILS if any engine sort
    // goes back to a localeCompare.
    expect(byteOrder("apple", "APPLE")).toBe(1);
    expect(byteOrder("APPLE", "apple")).toBe(-1);
    expect(byteOrder("apple", "apple")).toBe(0);
  });

  it("ignores no character: digits, space and punctuation order by code unit", () => {
    expect(byteOrder("2.0", "10.0")).toBe(1); // "2" > "1" lexicographic, never numeric
    expect(byteOrder("a b", "ab")).toBe(-1); // 0x20 < 'b'
  });
});
