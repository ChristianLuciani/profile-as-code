/**
 * `cite-check` matcher — SPEC §7.4, issue #291.
 *
 * Each test pins ONE documented behaviour of the ladder or one of its guards:
 * a rung that regresses to substring matching, a guard that silently stops
 * firing, or a normalizer that drifts from `geoCheck`'s must fail here. The
 * fixtures are committed (`tests/fixtures/cite-person`, `cite-brand`); the
 * accent and offset cases derive a temp copy — the same way `entity.test.ts`
 * exercises the @id transition — because the fixture set would otherwise
 * multiply per spelling.
 *
 * Determinism is a contract, not a nicety: the matcher reads no network, no
 * model and no clock, so two runs over the same bytes must be deep-equal.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  citationHost,
  citeMatch,
  citeVocabulary,
  findTerm,
  foldForMatch,
  load,
  normalizeText,
  type Profile,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSON = join(__dirname, "fixtures", "cite-person");
const BRAND = join(__dirname, "fixtures", "cite-brand");

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-cite-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const person = (): Profile => load(PERSON);
const brand = (): Profile => load(BRAND);

describe("the one normalizer (SPEC §8, #291)", () => {
  it("folds case, accents and typographic punctuation", () => {
    expect(normalizeText("Domínguez")).toBe("dominguez");
    expect(normalizeText("Sofía")).toBe("sofia");
    expect(normalizeText("Ñandú")).toBe("nandu");
    expect(normalizeText("it’s “quoted”")).toBe('it\'s "quoted"');
  });

  it("keeps the map back to the original offsets", () => {
    const folded = foldForMatch("Sofía Domínguez");
    expect(folded.text).toBe("sofia dominguez");
    expect(findTerm(folded, "sofia dominguez")).toEqual([{ start: 0, end: 15 }]);
    expect(findTerm(folded, "dominguez")).toEqual([{ start: 6, end: 15 }]);
  });

  it("is word-bounded, so a name never matches inside a longer word", () => {
    expect(findTerm(foldForMatch("pascoño"), "pasco")).toEqual([]);
    expect(findTerm(foldForMatch("el pasco."), "pasco")).toEqual([{ start: 3, end: 8 }]);
  });
});

describe("the ladder (SPEC §7.4)", () => {
  it("exact-name is high, with the original span", () => {
    const result = citeMatch(person(), {
      answer: "Pasco is a CLI for profile-as-code, built in Ecuador.",
    });
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([{ start: 0, end: 5, kind: "name" }]);
    expect(result.reasons).toContain("exact-name");
    expect(result.reasons).not.toContain("ambiguous-term:pasco");
  });

  it("alias (identity.orgName) is medium", () => {
    const result = citeMatch(brand(), { answer: "DA SEO is an agency." });
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.spans).toEqual([{ start: 0, end: 6, kind: "alias" }]);
    expect(result.reasons).toContain("alias");
  });

  it("partial (a multi-token prefix of the name) is low", () => {
    const result = citeMatch(brand(), { answer: "DA SEO Digital is a studio." });
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.spans).toEqual([{ start: 0, end: 14, kind: "partial" }]);
    expect(result.reasons).toContain("partial");
  });

  it("handle is medium, and a handle hit is not a one-word name risk", () => {
    const result = citeMatch(brand(), { answer: "Follow daseo for updates." });
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.spans).toEqual([{ start: 7, end: 12, kind: "handle" }]);
    expect(result.reasons).toContain("handle");
    expect(result.reasons).not.toContain("no-qualifier");
  });

  it("citation-url is high and needs no text match (cited without naming)", () => {
    const result = citeMatch(person(), {
      answer: "A deterministic tool ships the profile from its source.",
      citations: [{ url: "https://github.com/pascocli" }],
    });
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([
      { start: 0, end: 0, kind: "citation-url", url: "https://github.com/pascocli" },
    ]);
    expect(result.reasons).toEqual(expect.arrayContaining(["citation-url", "identity-domain"]));
  });

  it("a shared host alone is not a citation: the path must match", () => {
    const result = citeMatch(person(), {
      answer: "No mention here.",
      citations: [{ url: "https://github.com/someone-else" }],
    });
    expect(result.cited).toBe(false);
    expect(result.spans).toEqual([]);
  });

  it("a declared root URL claims its whole host", () => {
    const result = citeMatch(brand(), {
      answer: "No mention here.",
      citations: [{ url: "https://daseo.substack.com/p/any-post" }],
    });
    expect(result.cited).toBe(true);
    expect(result.reasons).toContain("sameAs-domain");
  });

  it("a leading www. is stripped before the host comparison", () => {
    expect(citationHost("https://WWW.X.com/daseo")).toBe("x.com");
    const result = citeMatch(brand(), {
      answer: "No mention here.",
      citations: [{ url: "https://www.x.com/daseo" }],
    });
    expect(result.cited).toBe(true);
  });
});

describe("the guards (SPEC §7.4 — it refuses to guess)", () => {
  it("a contained shorter declared term is not a second hit", () => {
    const result = citeMatch(brand(), { answer: "DA SEO Digital Studio ships." });
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([{ start: 0, end: 21, kind: "name" }]);
    expect(result.reasons).toContain("longer-name:DA SEO Digital Studio");
  });

  it("a longer capitalised phrase in the text names the competing entity", () => {
    const result = citeMatch(person(), {
      answer: "Pasco County School District serves students.",
    });
    expect(result.cited).toBe(false);
    expect(result.confidence).toBe("low");
    expect(result.reasons).toContain("competing:Pasco County School District");
  });

  it("a one-word name with no declared qualifier is ambiguous, never cited", () => {
    const result = citeMatch(person(), { answer: "Pasco is a city in Washington." });
    expect(result.cited).toBe(false);
    expect(result.confidence).toBe("low");
    expect(result.spans).toEqual([{ start: 0, end: 5, kind: "name" }]);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["exact-name", "ambiguous-term:pasco", "no-qualifier"]),
    );
  });

  it("a contrast clause is a mention, not a citation", () => {
    const result = citeMatch(brand(), {
      answer: "Unlike DA SEO Digital Studio, agency X ships results monthly.",
    });
    expect(result.cited).toBe(false);
    expect(result.confidence).toBe("low");
    expect(result.reasons).toContain("contrast-context");
    expect(result.spans).toEqual([{ start: 7, end: 28, kind: "name" }]);
  });
});

describe("the declared vocabulary (SPEC §7.4)", () => {
  it("resolves name · alias · claimed handles · partials · hosts", () => {
    expect(citeVocabulary(brand())).toEqual({
      name: "DA SEO Digital Studio",
      aliases: ["DA SEO"],
      handles: ["daseo"],
      partials: ["DA SEO Digital"],
      hosts: ["x.com", "daseo.substack.com"],
    });
  });

  it("reads identity.handle's final token, '@' stripped", () => {
    const personVocab = citeVocabulary(person());
    expect(personVocab.handles).toEqual(["pasco_cli"]);
    expect(personVocab.hosts).toEqual(["github.com", "linkedin.com", "x.com"]);
  });
});

describe("determinism and portability (D19)", () => {
  it("same profile + same bytes → same result", () => {
    const answer = {
      answer: "Pasco is a CLI for profile-as-code, built in Ecuador.",
      citations: [{ url: "https://github.com/pascocli" }],
    };
    expect(JSON.stringify(citeMatch(person(), answer))).toBe(
      JSON.stringify(citeMatch(person(), answer)),
    );
  });

  it("matches an accented name typed without accents, keeping the original span", () => {
    const dir = tempDir();
    cpSync(PERSON, dir, { recursive: true });
    const identity = join(dir, "content", "identity.yaml");
    writeFileSync(
      identity,
      readFileSync(identity, "utf8").replace("name: Pasco", 'name: "Sofía Domínguez"'),
      "utf8",
    );
    const result = citeMatch(load(dir), {
      answer: "Sofia Dominguez is a researcher in Ecuador.",
    });
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([{ start: 0, end: 15, kind: "name" }]);
  });
});
