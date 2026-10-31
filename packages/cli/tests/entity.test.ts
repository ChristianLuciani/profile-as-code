/**
 * `pasco entity [--json | --jsonld]` — the entity projection (SPEC §7.2, #287),
 * including the `FAQPage` consumer (#360).
 *
 * The contract that matters here is the ONE-ASSEMBLER rule: `--jsonld` must
 * serialize exactly `structuredData()`'s own objects, never a CLI-local rebuild.
 * The round-trip tests parse the emitted artifact and compare it to the
 * assembler's output, so a second emitter cannot land silently.
 *
 * The fixture is the core `minimal` workspace (no `role: identity`), reused
 * rather than duplicated; the @id case is derived from it in a temp copy, the
 * same way `geo.test.ts` exercises the role transition. `entity-faq` is the
 * committed answer surface: its `expected.html` is the paste-ready Code input
 * of the #360 Rich Results step, asserted byte-for-byte.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { geoCheck, load, structuredData } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { type EntityReport, jsonLdBare, runEntity } from "../src/commands/entity.js";
import { type JsonEnvelope, setJsonMode } from "../src/output.js";
import type { Pascorc } from "../src/workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");
const FAQ_FIXTURE = join(__dirname, "fixtures", "entity-faq");
const FAQ_EXPECTED = join(FAQ_FIXTURE, "expected.html");
const PASCO: Pascorc = {};

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-entity-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** The core fixture, copied, with `role: identity` added to its GitHub link. */
function withIdentityLink(): string {
  const dir = tempDir();
  cpSync(MINIMAL, dir, { recursive: true });
  const identityPath = join(dir, "content", "identity.yaml");
  const body = readFileSync(identityPath, "utf8");
  const patched = body.replace(
    "  - platform: github\n    label: GitHub\n",
    "  - platform: github\n    label: GitHub\n    role: identity\n",
  );
  if (patched === body) throw new Error("fixture did not declare the github link to patch");
  writeFileSync(identityPath, patched, "utf8");
  return dir;
}

/** Capture stdout for a command run (JSON envelopes and artifacts both go there). */
function capture<T>(run: () => T): { code: T; out: string } {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: run(), out };
  } finally {
    process.stdout.write = original;
  }
}

/** Capture stderr for the error envelope (a write failure must not print a stack). */
function captureStderr<T>(run: () => T): { code: T; err: string } {
  const original = process.stderr.write.bind(process.stderr);
  let err = "";
  process.stderr.write = ((chunk: string) => {
    err += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: run(), err };
  } finally {
    process.stderr.write = original;
  }
}

function entityJson(
  workspace: string,
  lang: "en" | "es" | "fr" = "en",
): { code: number; data: EntityReport; out: string } {
  setJsonMode(true);
  try {
    const { code, out } = capture(() =>
      runEntity({ workspace, pascorc: PASCO, jsonld: false, bare: false, force: false, lang }),
    );
    return { code, data: (JSON.parse(out) as JsonEnvelope).data as EntityReport, out };
  } finally {
    setJsonMode(false);
  }
}

function entityJsonLd(
  workspace: string,
  opts: { bare?: boolean; out?: string; force?: boolean; lang?: "en" | "es" | "fr" } = {},
): { code: number; out: string } {
  setJsonMode(false);
  return capture(() =>
    runEntity({
      workspace,
      pascorc: PASCO,
      jsonld: true,
      bare: opts.bare === true,
      ...(opts.out !== undefined ? { out: opts.out } : {}),
      force: opts.force === true,
      lang: opts.lang ?? "en",
    }),
  );
}

/**
 * A brand workspace whose only populated `mission` is `es` (`en: ""` counts as
 * absent at the text accessor). It is the F1 regression: `--json` must not report
 * `description(definition|mission): no` while `--jsonld` emits the `es` description.
 */
function brandWorkspace(): string {
  const dir = tempDir();
  mkdirSync(join(dir, "content"), { recursive: true });
  writeFileSync(join(dir, "content", "flavor.yaml"), "brand\n", "utf8");
  writeFileSync(
    join(dir, "content", "identity.yaml"),
    `name: Topia Press
logo: https://topia.press/logo.png
established: 2026-08-18
mission:
  en: ""
  es: "Ensayos de alta exigencia epistémica, de la distopía a la utopía."
links:
  - platform: website
    label: Website
    url: https://topia.press
`,
    "utf8",
  );
  return dir;
}

describe("pasco entity --json", () => {
  it("never invents @id: absent means null, exit 1, and the gap names it", () => {
    const { code, data } = entityJson(MINIMAL);

    expect(code).toBe(1);
    expect(data.schemaVersion).toBe("1");
    expect(data.entity.id).toBeNull();
    expect(data.entity.type).toBe("Person");
    expect(data.entity.name).toBe("Elena Vasquez");
    expect(data.entity.email).toBeNull();
    expect(data.entity.sameAs.length).toBeGreaterThan(0);
    expect(data.jsonld).toBeNull();
    expect(data.gaps.map((gap) => gap.code)).toContain("geo/entity-id");
  });

  it("reports the declared @id and exits 0 when a role: identity link exists", () => {
    const workspace = withIdentityLink();
    const { code, data } = entityJson(workspace);

    expect(code).toBe(0);
    expect(data.entity.id).toBe("https://github.com/elenavasquez");
    expect(data.gaps.map((gap) => gap.code)).not.toContain("geo/entity-id");
  });

  it("reuses exactly the structured-data geoCheck codes — no new vocabulary", () => {
    const { data } = entityJson(MINIMAL);
    // The FILTER is the contract, so the oracle is the section, not the whole
    // report: a gap leaking in from `geo/faq-coverage` would pass the wider set.
    const section = new Set(
      geoCheck(load(MINIMAL)).sections.structuredData.checks.map((check) => check.code),
    );
    expect(data.gaps.length).toBeGreaterThan(0);
    for (const gap of data.gaps) {
      expect(section.has(gap.code)).toBe(true);
      expect(gap.detail.length).toBeGreaterThan(0);
    }
  });

  it("measures readiness in the resolved lang, like --jsonld (F1)", () => {
    const workspace = brandWorkspace();
    const es = entityJson(workspace, "es");
    const en = entityJson(workspace, "en");

    expect(es.data.entity.type).toBe("Organization");
    expect(es.data.gaps.map((gap) => gap.code)).not.toContain("geo/structured-person");
    expect(en.data.gaps.map((gap) => gap.code)).toContain("geo/structured-person");
    expect(en.data.gaps.find((gap) => gap.code === "geo/structured-person")?.detail).toContain(
      "description(definition|mission): no",
    );
  });

  it("is deterministic: two runs emit byte-identical output", () => {
    const first = entityJson(MINIMAL).out;
    const second = entityJson(MINIMAL).out;
    expect(second).toBe(first);
  });
});

describe("pasco entity --jsonld", () => {
  it("--bare round-trips to exactly structuredData()'s object (one assembler)", () => {
    const { code, out } = entityJsonLd(MINIMAL, { bare: true });

    expect(code).toBe(1);
    expect(JSON.parse(out)).toEqual(structuredData(load(MINIMAL)).jsonLd);
    expect(out).toBe(`${jsonLdBare(structuredData(load(MINIMAL)).jsonLd ?? {})}\n`);
  });

  it("wraps the same object in a paste-ready <script> block", () => {
    const { out } = entityJsonLd(MINIMAL);

    expect(out.startsWith('<script type="application/ld+json">\n')).toBe(true);
    expect(out.trimEnd().endsWith("</script>")).toBe(true);
    const json = out.slice(out.indexOf("\n") + 1, out.lastIndexOf("</script>"));
    expect(JSON.parse(json)).toEqual(structuredData(load(MINIMAL)).jsonLd);
  });

  it("--out writes the same bytes it would print, and still exits on the @id rule", () => {
    const file = join(tempDir(), "entity.jsonld");
    const workspace = withIdentityLink();
    const { code, out } = entityJsonLd(workspace, { out: file });

    expect(code).toBe(0);
    expect(out).toContain(`wrote ${file}`);
    const written = readFileSync(file, "utf8").trimEnd();
    expect(written.startsWith('<script type="application/ld+json">')).toBe(true);
    const json = written.slice(written.indexOf("\n") + 1, written.lastIndexOf("</script>"));
    expect(JSON.parse(json)).toEqual(structuredData(load(workspace)).jsonLd);
  });

  it("--out refuses to overwrite without --force (nothing is truncated, F4)", () => {
    const file = join(tempDir(), "existing.jsonld");
    writeFileSync(file, "PRESERVE ME", "utf8");

    const { code, err } = captureStderr(() =>
      runEntity({
        workspace: MINIMAL,
        pascorc: PASCO,
        jsonld: true,
        bare: false,
        out: file,
        force: false,
        lang: "en",
      }),
    );

    expect(code).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("PRESERVE ME");
    expect(err).toContain("refusing to overwrite");
    expect(err).not.toContain("at Object");
  });

  it("--out --force replaces an existing file atomically", () => {
    const file = join(tempDir(), "existing.jsonld");
    writeFileSync(file, "PRESERVE ME", "utf8");

    const { code } = entityJsonLd(MINIMAL, { out: file, force: true });

    expect(code).toBe(1); // @id still absent: the write succeeded, the exit rule does not change
    expect(readFileSync(file, "utf8")).toContain('"@type": "Person"');
  });

  it("--out on an unwritable path is an error envelope, not a stack (F4)", () => {
    const file = join(tempDir(), "missing-dir", "entity.jsonld");

    const { code, err } = captureStderr(() =>
      runEntity({
        workspace: MINIMAL,
        pascorc: PASCO,
        jsonld: true,
        bare: false,
        out: file,
        force: false,
        lang: "en",
      }),
    );

    expect(code).toBe(1);
    expect(err).toContain("cannot write");
    expect(err).not.toContain("at Object");
  });

  it("--jsonld --lang es emits the lang-aware brand description (F1)", () => {
    const workspace = brandWorkspace();
    const { code, out } = entityJsonLd(workspace, { bare: true, lang: "es" });

    expect(code).toBe(1); // no @id in this fixture
    expect(JSON.parse(out)).toEqual(structuredData(load(workspace), "es").jsonLd);
    expect((JSON.parse(out) as { description?: string }).description).toContain("distopía");
  });
});

/** Split the emitted artifact into its `<script>` blocks, parsed. */
function scriptBlocks(out: string): unknown[] {
  return [...out.matchAll(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g)].map(
    (match) => JSON.parse(match[1] as string),
  );
}

describe("pasco entity — the FAQPage consumer (#360)", () => {
  it("--json exposes the assembler's faqJsonLd node, and null when faq[] is undeclared", () => {
    const withFaq = entityJson(FAQ_FIXTURE);
    const sd = structuredData(load(FAQ_FIXTURE));

    expect(withFaq.code).toBe(0); // the fixture declares role: identity
    expect(withFaq.data.faqJsonLd).toEqual(sd.faqJsonLd);
    expect(withFaq.data.faqJsonLd?.["@type"]).toBe("FAQPage");
    // No invented anchor: the FAQPage node carries no @id (SPEC §15.4).
    expect(withFaq.data.faqJsonLd).not.toHaveProperty("@id");
    // The declared pointer stays with the answer it backs.
    expect(withFaq.data.faqJsonLd?.mainEntity[0]?.acceptedAnswer.citation).toBe(
      "https://example.com/about",
    );

    const withoutFaq = entityJson(MINIMAL);
    // The field is always present (the additive envelope), and never an empty node.
    expect(withoutFaq.data).toHaveProperty("faqJsonLd");
    expect(withoutFaq.data.faqJsonLd).toBeNull();
  });

  it("--jsonld emits the FAQPage as its own block after the entity, never folded", () => {
    const { out } = entityJsonLd(FAQ_FIXTURE);
    const blocks = scriptBlocks(out);
    const sd = structuredData(load(FAQ_FIXTURE));

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(sd.jsonLd);
    expect(blocks[1]).toEqual(sd.faqJsonLd);
    // A different schema.org @type: never merged into the entity block.
    expect(blocks[0]).not.toHaveProperty("mainEntity");
    expect(blocks[1]).not.toHaveProperty("@id");
  });

  it("emits one block when faq[] is undeclared — the pre-#360 artifact, byte-identical", () => {
    const { out } = entityJsonLd(MINIMAL);
    const sd = structuredData(load(MINIMAL));

    expect(scriptBlocks(out)).toHaveLength(1);
    expect(out).toBe(
      `<script type="application/ld+json">\n${JSON.stringify(sd.jsonLd, null, 2).replace(/</g, "\\u003c")}\n</script>\n`,
    );
  });

  it("--bare: the entity object alone without faq[], the node array with it", () => {
    const withFaq = entityJsonLd(FAQ_FIXTURE, { bare: true });
    const sd = structuredData(load(FAQ_FIXTURE));
    expect(JSON.parse(withFaq.out)).toEqual([sd.jsonLd, sd.faqJsonLd]);

    const withoutFaq = entityJsonLd(MINIMAL, { bare: true });
    expect(JSON.parse(withoutFaq.out)).toEqual(structuredData(load(MINIMAL)).jsonLd);
  });

  it("the committed block is exactly what --jsonld emits (the Rich Results Code input)", () => {
    const { out } = entityJsonLd(FAQ_FIXTURE);

    expect(out).toBe(readFileSync(FAQ_EXPECTED, "utf8"));
  });
});
