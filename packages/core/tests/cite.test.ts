/**
 * `cite-check` matcher — SPEC §7.4, issue #291.
 *
 * Each test pins ONE documented behaviour of the ladder or one of its guards:
 * a rung that regresses to substring matching, a guard that silently stops
 * firing, or a fold that drifts from the offsets must fail here. The fixtures
 * are committed (`tests/fixtures/cite-person`, `cite-brand`); the accent and
 * offset cases derive a temp copy — the same way `entity.test.ts` exercises the
 * @id transition — because the fixture set would otherwise multiply per
 * spelling.
 *
 * Determinism is a contract, not a nicety: the matcher reads no network, no
 * model and no clock, so two runs over the same bytes must be deep-equal.
 *
 * Review F2 pins `geoCheck`: this PR must NOT change the published GEO score or
 * its findings (the fold is the matcher's, not geoCheck's).
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  type CiteCitation,
  citationHost,
  citeMatch,
  citeVocabulary,
  findTerm,
  foldForMatch,
  geoCheck,
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

/** `citeMatch` with the answer contract's required `citations` defaulted to []. */
function match(profile: Profile, answer: string, citations: CiteCitation[] = []) {
  return citeMatch(profile, { answer, citations });
}

describe("the matcher fold (SPEC §7.4)", () => {
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
    const result = match(person(), "Pasco is a CLI for profile-as-code, built in Ecuador.");
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([{ start: 0, end: 5, kind: "name" }]);
    expect(result.reasons).toContain("exact-name");
    expect(result.reasons).not.toContain("ambiguous-term:pasco");
  });

  it("alias (identity.orgName) is medium and wins over a same-span partial", () => {
    const result = match(brand(), "DA SEO is an agency.");
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.spans).toEqual([{ start: 0, end: 6, kind: "alias" }]);
    expect(result.reasons).toContain("alias");
    // The identical span also matches the `DA SEO` partial; a same-span lower
    // rung is dropped without a `longer-name` claim (nothing was shorter).
    expect(result.reasons).not.toContain("longer-name:DA SEO");
  });

  it("partial (the longest multi-token prefix) is low", () => {
    const result = match(brand(), "DA SEO Digital is a studio.");
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.spans).toEqual([{ start: 0, end: 14, kind: "partial" }]);
    expect(result.reasons).toContain("partial");
  });

  it("every multi-token prefix is a partial, not only the longest", () => {
    // The shortest prefix only shows once the alias no longer covers it.
    const dir = tempDir();
    cpSync(BRAND, dir, { recursive: true });
    const identity = join(dir, "content", "identity.yaml");
    writeFileSync(
      identity,
      readFileSync(identity, "utf8").replace("orgName: DA SEO\n", ""),
      "utf8",
    );
    const result = match(load(dir), "DA SEO is an agency.");
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.spans).toEqual([{ start: 0, end: 6, kind: "partial" }]);
    expect(result.reasons).toContain("partial");
  });

  it("handle is medium, and a handle hit is not a one-word name risk", () => {
    const result = match(brand(), "Follow daseo for updates.");
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.spans).toEqual([{ start: 7, end: 12, kind: "handle" }]);
    expect(result.reasons).toContain("handle");
    expect(result.reasons).not.toContain("no-qualifier");
  });

  it("citation-url is high and needs no text match (cited without naming)", () => {
    const result = match(person(), "A deterministic tool ships the profile from its source.", [
      { url: "https://github.com/pascocli" },
    ]);
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([
      { start: 0, end: 0, kind: "citation-url", url: "https://github.com/pascocli" },
    ]);
    expect(result.reasons).toEqual(expect.arrayContaining(["citation-url", "identity-domain"]));
  });

  it("a shared host alone is not a citation: the path must match", () => {
    const result = match(person(), "No mention here.", [
      { url: "https://github.com/someone-else" },
    ]);
    expect(result.cited).toBe(false);
    expect(result.spans).toEqual([]);
  });

  it("a declared root URL claims its whole host", () => {
    const result = match(brand(), "No mention here.", [
      { url: "https://daseo.substack.com/p/any-post" },
    ]);
    expect(result.cited).toBe(true);
    expect(result.reasons).toContain("sameAs-domain");
  });

  it("a leading www. is stripped before the host comparison", () => {
    expect(citationHost("https://WWW.X.com/daseo")).toBe("x.com");
    const result = match(brand(), "No mention here.", [{ url: "https://www.x.com/daseo" }]);
    expect(result.cited).toBe(true);
  });
});

describe("the guards (SPEC §7.4 — it refuses to guess)", () => {
  it("a contained shorter declared term is not a second hit", () => {
    const result = match(brand(), "DA SEO Digital Studio ships.");
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([{ start: 0, end: 21, kind: "name" }]);
    expect(result.reasons).toContain("longer-name:DA SEO Digital Studio");
  });

  it("a longer capitalised phrase NAMES the competing reading of an ambiguous hit", () => {
    const result = match(person(), "Pasco County School District serves students.");
    expect(result.cited).toBe(false);
    expect(result.confidence).toBe("low");
    expect(result.reasons).toContain("competing:Pasco County School District");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["ambiguous-term:pasco", "no-qualifier"]),
    );
  });

  it("an adjacent capital never turns a qualified hit into a competitor (review F1)", () => {
    // The declared qualifier itself is the left neighbour: the old guard made it
    // the competing entity and reported cited:false over a sentence that names
    // the entity AND its declared location.
    const result = match(person(), "In Ecuador Pasco is a CLI.");
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([{ start: 11, end: 16, kind: "name" }]);
    expect(result.reasons).toEqual(["exact-name"]);
  });

  it("a capitalised token after the name is ordinary prose, not a competitor (review F1)", () => {
    const result = match(brand(), "DA SEO Digital Studio Founder Ana ships profiles.");
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([{ start: 0, end: 21, kind: "name" }]);
    expect(result.reasons).toContain("exact-name");
    // `Founder Ana` is not a declared reading and the hit is not ambiguous, so it
    // can never become a competitor. (`longer-name` is a different guard: the
    // declared partials inside the full name.)
    expect(result.reasons.some((reason) => reason.startsWith("competing:"))).toBe(false);
  });

  it("a one-word name with no declared qualifier is ambiguous, never cited", () => {
    const result = match(person(), "Pasco is a city in Washington.");
    expect(result.cited).toBe(false);
    expect(result.confidence).toBe("low");
    expect(result.spans).toEqual([{ start: 0, end: 5, kind: "name" }]);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["exact-name", "ambiguous-term:pasco", "no-qualifier"]),
    );
    expect(result.reasons.some((reason) => reason.startsWith("competing:"))).toBe(false);
  });

  it("a contrast clause is a mention, not a citation", () => {
    const result = match(brand(), "Unlike DA SEO Digital Studio, agency X ships results monthly.");
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
      // `DA SEO` is the alias, so the same declared text is not repeated as a
      // partial: one rung owns a term.
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
      JSON.stringify(citeMatch(load(PERSON), answer)),
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
    const result = match(load(dir), "Sofia Dominguez is a researcher in Ecuador.");
    expect(result.cited).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.spans).toEqual([{ start: 0, end: 15, kind: "name" }]);
  });
});

describe("geoCheck is untouched by this PR (review F2)", () => {
  it("keeps the pre-PR reading: an unaccented definition does not name the entity", () => {
    const dir = tempDir();
    cpSync(PERSON, dir, { recursive: true });
    const identity = join(dir, "content", "identity.yaml");
    writeFileSync(
      identity,
      `${readFileSync(identity, "utf8").replace(
        "name: Pasco",
        'name: "Sofía Domínguez"',
      )}definition:\n  en: "Sofia Dominguez builds deterministic profiles."\n`,
      "utf8",
    );
    const report = geoCheck(load(dir));
    // Pinned against `main@e8be568`: if a later change wants accent-insensitive
    // geoCheck, it is a separate contract change with its own SPEC entry — this
    // PR must not move a published GEO score.
    expect(report.score).toBe(59);
    expect(report.sections.citability.score).toBe(41);
    const canonical = report.checks.find((check) => check.code === "geo/canonical-definition");
    expect(canonical?.score).toBe(0);
    expect(canonical?.detail).toContain("does not contain the entity name");
  });
});
