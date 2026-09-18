/**
 * `@profile-as-code/markdown` — the shared CommonMark-safety rule (SPEC §15.2).
 *
 * Two surfaces, two helpers: destinations (`mdHref`, issue #73) and link text
 * (`mdText`, issue #76). Both are pure and total, and both must stay
 * byte-identical for inputs that were never at risk — the renderers' output is
 * byte-stable (§15.1), so a helper that normalizes more than needed would
 * invalidate every deployed workspace.
 */

import { describe, expect, it } from "vitest";
import { mdHref, mdText } from "../src/index.js";

/** The ASCII set a label must never carry raw (CommonMark §6.3: a `]` closes
 *  the label, a `[` opens a nested one). */
const BRACKETS = /[[\]]/;

/** CommonMark backslash escape (§2.4) — the parser's inverse of `mdText`. */
function unescapeCommonMark(text: string): string {
  return text.replace(/\\([\s\S])/g, "$1");
}

const ASCII = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i));
const ASCII_RUN = ASCII.join("");

describe("mdText — link text (issue #76)", () => {
  it("escapes a `]` in the label so the link is not closed early (the issue repro)", () => {
    expect(mdText("example.com/a]b")).toBe("example.com/a\\]b");
    expect(mdText("10.5555/a]b")).toBe("10.5555/a\\]b");
    expect(mdText("Report [draft]")).toBe("Report \\[draft\\]");
  });

  it("escapes the escape character itself (a literal backslash must not eat the next char)", () => {
    expect(mdText("a\\b")).toBe("a\\\\b");
    expect(mdText("a\\")).toBe("a\\\\");
    expect(mdText("\\]")).toBe("\\\\\\]");
  });

  it("round-trips: the parser unescapes back to the exact fact (the rendered label keeps its bytes)", () => {
    for (const input of [
      "a]b",
      "[x]",
      "a\\b",
      "back\\slash]mixed[",
      "plain",
      "cafón (2024) 100%",
    ]) {
      expect(unescapeCommonMark(mdText(input))).toBe(input);
    }
  });

  it("byte-parity: a label without `\\`, `[` or `]` is untouched", () => {
    for (const input of [
      "Site",
      "example.com/my profile (2024)",
      "10.5555/report(v1)",
      "café",
      "a_b~c%20d",
    ]) {
      expect(mdText(input)).toBe(input);
    }
  });

  it("property (all 128 ASCII chars): only `\\`, `[` and `]` are escaped, and no raw bracket survives", () => {
    const escaped = mdText(ASCII_RUN);
    // The chars removed from the escaped output are exactly the three escaped ones.
    const removed = escaped.replace(/\\([\s\S])/g, "");
    expect(removed).toBe(ASCII.filter((c) => c !== "\\" && c !== "[" && c !== "]").join(""));
    expect(escaped.replace(/\\([\s\S])/g, "")).not.toMatch(BRACKETS);
    expect(unescapeCommonMark(escaped)).toBe(ASCII_RUN);
  });

  it("NOT idempotent by design: apply to raw facts only, never to escaped text", () => {
    // `mdText` escapes the escape character too, so re-applying it doubles the
    // backslashes and the rendered label would show them. Renderers must call it
    // exactly once, on the SSOT value — the round-trip test above is the
    // contract that matters.
    const once = mdText("a]b");
    expect(once).toBe("a\\]b");
    expect(mdText(once)).toBe(`a${"\\".repeat(3)}]b`); // the added escape is escaped in turn
    expect(unescapeCommonMark(mdText(once))).not.toBe("a]b");
  });
});

describe("mdHref — link destinations (issue #73)", () => {
  it("percent-encodes space and both parens (a raw space/paren ends the destination)", () => {
    expect(mdHref("https://example.com/my profile (2024)")).toBe(
      "https://example.com/my%20profile%20%282024%29",
    );
    expect(mdHref("https://example.com/a)b")).toBe("https://example.com/a%29b");
  });

  it("encodes `[`/`]` in a destination (a bracket is not valid in a bare destination)", () => {
    expect(mdHref("https://example.com/a]b")).toBe("https://example.com/a%5Db");
    expect(mdHref("https://example.com/a[b")).toBe("https://example.com/a%5Bb");
  });

  it("never double-encodes a VALID escape, and repairs a malformed `%`", () => {
    expect(mdHref("https://example.com/a%20b")).toBe("https://example.com/a%20b");
    expect(mdHref("https://example.com/100%discount")).toBe("https://example.com/100%25discount");
    expect(mdHref("https://example.com/50%")).toBe("https://example.com/50%25");
  });

  it("keeps non-ASCII verbatim (an IRI is a valid CommonMark destination)", () => {
    expect(mdHref("https://example.com/camión")).toBe("https://example.com/camión");
  });

  it("property (all 128 ASCII chars): no raw space, control char or paren survives", () => {
    const encoded = mdHref(`https://example.com/${ASCII_RUN}`);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — the property under test is that no raw control char survives
    expect(encoded).not.toMatch(/[\u0000-\u0020\u007F-\u009F()]/);
    expect(encoded.startsWith("https://example.com/")).toBe(true);
  });

  it("the helper is idempotent (an encoded href re-encodes to itself)", () => {
    for (const href of [
      "https://example.com/my profile (2024)",
      "https://example.com/a]b",
      "https://example.com/100%discount",
      "https://example.com/a%20b",
      "mailto:a@example.com",
      "assets/reel-1/reel (1).mp4",
    ]) {
      expect(mdHref(mdHref(href))).toBe(mdHref(href));
    }
  });
});
