import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { load, SchemaValidationError, structuredData } from "../src/index.js";

/**
 * The v1.10 answer-engine surface (#288, consumer half in #316): identity.definition
 * + root faq[] — what `structuredData()` exposes and what the CONTRACT enforces
 * through the generated Zod (load-time, D12). The schema-check fixtures pin the
 * JSON-Schema side (scripts/schema-check/fixtures/*faq*); here the same constraints
 * are exercised through `load()`'s own path, and the EMITTED nodes are the behavior
 * tests.
 */

let counter = 0;
function workspace(content: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), `pasco-structured-data-${counter++}-`));
  mkdirSync(join(dir, "content"), { recursive: true });
  for (const [name, text] of Object.entries(content)) {
    writeFileSync(join(dir, "content", name), text);
  }
  return dir;
}

const PERSON = `name: Ada Example
links:
  - url: https://ada.example
    role: identity
`;

const FAQ3 = `- id: faq-what-is
  q: { en: "What is Ada Example?", es: "¿Qué es Ada Example?" }
  a: { en: "A fictional identity the engine fixtures exercise.", es: "Una identidad ficticia que ejercitan los fixtures del engine." }
  source: https://example.com/ada-spec
- id: faq-why-code
  q: { en: "Why profile-as-code?" }
  a: { en: "Because one identity must stay consistent across platforms." }
- id: faq-how-fast
  q: { en: "How fast is validation?" }
  a: { en: "Offline deterministic checks, no network." }
`;

describe("structuredData — the answer-engine surface (#288/#316)", () => {
  it("emits description from identity.definition, lang-sliced with en fallback", () => {
    const profile = load(
      workspace({
        "identity.yaml": `${PERSON}definition:
  en: "Ada Example is a fictional identity in the engine fixtures."
  es: "Ada Example es una identidad ficticia en los fixtures del engine."
`,
        "faq.yaml": FAQ3,
      }),
    );
    const es = structuredData(profile, "es");
    expect(es.fields.description).toBe(
      "Ada Example es una identidad ficticia en los fixtures del engine.",
    );
    expect(es.jsonLd?.description).toBe(es.fields.description);
    // The en slice follows the same rule when the compile lang carries no value.
    const en = structuredData(profile, "en");
    expect(en.fields.description).toBe(
      "Ada Example is a fictional identity in the engine fixtures.",
    );
    // The FAQPage is the SAME node for both langs (questions are rows; the slice
    // happens inside mainEntity, not by dropping the node).
    expect(es.faqJsonLd?.mainEntity[0]?.name).toBe("¿Qué es Ada Example?");
    // A row declared only in `en` still answers in `es` (the same [lang] || en rule).
    expect(es.faqJsonLd?.mainEntity[1]?.name).toBe("Why profile-as-code?");
    const enFaq = structuredData(profile, "en").faqJsonLd;
    expect(enFaq?.mainEntity[0]?.name).toBe("What is Ada Example?");
    expect(enFaq?.mainEntity[0]?.acceptedAnswer.text).toBe(
      "A fictional identity the engine fixtures exercise.",
    );
    expect(enFaq?.mainEntity[1]?.acceptedAnswer.text).toBe(
      "Because one identity must stay consistent across platforms.",
    );
  });

  it("never invents a description or a FAQPage when the SSOT declares none", () => {
    const profile = load(workspace({ "identity.yaml": PERSON }));
    const sd = structuredData(profile);
    expect("description" in sd.fields).toBe(false);
    expect(sd.jsonLd).not.toHaveProperty("description");
    expect(sd.faqJsonLd).toBeUndefined(); // never an empty FAQPage
  });

  it("emits the FAQPage as its own node: no @id, and the Rich-Results required shape", () => {
    const sd = structuredData(load(workspace({ "identity.yaml": PERSON, "faq.yaml": FAQ3 })));
    expect(sd.faqJsonLd?.["@type"]).toBe("FAQPage");
    // Never folded into the entity node (a different schema.org @type).
    expect(sd.jsonLd).not.toHaveProperty("mainEntity");
    // The engine NEVER invents an anchor: no fragment convention, no @id.
    expect(sd.faqJsonLd).not.toHaveProperty("@id");
    // The Rich Results contract for FAQPage: Question.name + acceptedAnswer.text.
    for (const question of sd.faqJsonLd?.mainEntity ?? []) {
      expect(question["@type"]).toBe("Question");
      expect(typeof question.name).toBe("string");
      expect(question.name.length).toBeGreaterThan(0);
      expect(question.acceptedAnswer["@type"]).toBe("Answer");
      expect(typeof question.acceptedAnswer.text).toBe("string");
      expect(question.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  it("counts description in the person readiness budget (v1.10 delta)", () => {
    const without = structuredData(load(workspace({ "identity.yaml": PERSON })));
    const with_ = structuredData(
      load(
        workspace({
          "identity.yaml": `${PERSON}definition:
  en: "Ada Example is a fictional identity in the engine fixtures."
`,
          "faq.yaml": FAQ3,
        }),
      ),
    );
    // 7 old considered fields stay; description is the 8th — populated grows
    // only when the definition is declared (HONEST ACCOUNTING, like the v1.6
    // entity-id delta: upgrading CAN move the number).
    expect(without.fields.description).toBeUndefined();
    expect(with_.fields.description).toBeDefined();
    expect(with_.completeness).toBeGreaterThan(without.completeness);
  });

  it("brand: definition wins over mission; without one, the v1.9 mission fallback is unchanged", () => {
    const base = `name: Topia Press
mission:
  en: "Publishing what machines can cite."
`;
    const fallback = structuredData(
      load(workspace({ "identity.yaml": base, "flavor.yaml": "brand" })),
      "en",
    );
    expect(fallback.fields.description).toBe("Publishing what machines can cite.");
    expect(fallback.faqJsonLd).toBeUndefined();

    const withDef = structuredData(
      load(
        workspace({
          "identity.yaml": `${base}definition:
  en: "Topia Press is the brand flavor of a profile-as-code identity."
`,
          "faq.yaml": FAQ3,
        }),
      ),
    );
    expect(withDef.fields.description).toBe(
      "Topia Press is the brand flavor of a profile-as-code identity.",
    );
    // The mission line does not disappear from the emitted node by magic — the
    // definition REPLACED the description slot; mission stays SSOT data.
    expect(withDef.jsonLd?.description).toBe(withDef.fields.description);
    expect(withDef.faqJsonLd?.mainEntity.length).toBe(3);
  });

  it("the caps are the contract: load() fails above them (lengths, unsupported lang, count floor)", () => {
    // definition 161 chars → >160 per value
    const longDef = `name: Ada Example
definition:
  en: "${"x".repeat(161)}"
`;
    expect(() => load(workspace({ "identity.yaml": longDef }))).toThrow(SchemaValidationError);

    // unsupported language key → the langMap guard
    const badLang = `name: Ada Example
definition:
  en: "Ada Example is a fictional identity."
  pt: "Nao e um idioma do contrato."
`;
    expect(() => load(workspace({ "identity.yaml": badLang }))).toThrow(SchemaValidationError);

    // faq with 2 entries → below the 3 floor
    expect(() =>
      load(
        workspace({
          "identity.yaml": PERSON,
          "faq.yaml": FAQ3.slice(0, FAQ3.indexOf("- id: faq-how-fast")),
        }),
      ),
    ).toThrow(SchemaValidationError);
  });

  it("the capped-langMap LOAD path requires `en` (gen-zod en-required fix, #288 F5)", () => {
    // `q` with only `es` → the capped langMap lost its EN requirement before the
    // gen-zod fix; this exercises it at the BEHAVIOR level, not in the generated text.
    const qWithoutEn = `- id: faq-solo-es
  q: { es: "¿Qué es Ada Example?" }
  a: { en: "A fictional identity." }
- id: faq-two
  q: { en: "Why profile-as-code?" }
  a: { en: "Because one identity must stay consistent across platforms." }
- id: faq-three
  q: { en: "How fast is validation?" }
  a: { en: "Offline deterministic checks, no network." }
`;
    expect(() => load(workspace({ "identity.yaml": PERSON, "faq.yaml": qWithoutEn }))).toThrow(
      SchemaValidationError,
    );

    // Same rule for the answer value and for identity.definition (EN required).
    const aWithoutEn = FAQ3.replace(
      'a: { en: "Offline deterministic checks, no network." }',
      'a: { es: "Chequeos deterministas offline, sin red." }',
    );
    expect(() => load(workspace({ "identity.yaml": PERSON, "faq.yaml": aWithoutEn }))).toThrow(
      SchemaValidationError,
    );

    const defWithoutEn = `name: Ada Example
definition:
  es: "Ada Example es una identidad ficticia."
`;
    expect(() => load(workspace({ "identity.yaml": defWithoutEn }))).toThrow(SchemaValidationError);
  });

  it("faq[] must carry the §19.2 id shape (slug pattern)", () => {
    const badId = FAQ3.replace("id: faq-what-is", "id: FAQ WHAT IS");
    expect(() => load(workspace({ "identity.yaml": PERSON, "faq.yaml": badId }))).toThrow(
      SchemaValidationError,
    );
  });
});
