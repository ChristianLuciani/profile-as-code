/**
 * `pasco entity [--json | --jsonld]` — the entity projection (SPEC §7.2, #287).
 *
 * The contract that matters here is the ONE-ASSEMBLER rule: `--jsonld` must
 * serialize exactly `structuredData()`'s own object, never a CLI-local rebuild.
 * The round-trip test parses the emitted artifact and compares it to the
 * assembler's output, so a second emitter cannot land silently.
 *
 * The fixture is the core `minimal` workspace (no `role: identity`), reused
 * rather than duplicated; the @id case is derived from it in a temp copy, the
 * same way `geo.test.ts` exercises the role transition.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function entityJson(workspace: string): { code: number; data: EntityReport; out: string } {
  setJsonMode(true);
  try {
    const { code, out } = capture(() =>
      runEntity({ workspace, pascorc: PASCO, jsonld: false, bare: false, lang: "en" }),
    );
    return { code, data: (JSON.parse(out) as JsonEnvelope).data as EntityReport, out };
  } finally {
    setJsonMode(false);
  }
}

function entityJsonLd(
  workspace: string,
  opts: { bare?: boolean; out?: string } = {},
): { code: number; out: string } {
  setJsonMode(false);
  return capture(() =>
    runEntity({
      workspace,
      pascorc: PASCO,
      jsonld: true,
      bare: opts.bare === true,
      ...(opts.out !== undefined ? { out: opts.out } : {}),
      lang: "en",
    }),
  );
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

  it("reuses geoCheck codes verbatim — no new gap vocabulary", () => {
    const { data } = entityJson(MINIMAL);
    const known = new Set(geoCheck(load(MINIMAL)).checks.map((check) => check.code));
    expect(data.gaps.length).toBeGreaterThan(0);
    for (const gap of data.gaps) {
      expect(known.has(gap.code)).toBe(true);
      expect(gap.detail.length).toBeGreaterThan(0);
    }
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
    const { code, out } = entityJsonLd(withIdentityLink(), { out: file });

    expect(code).toBe(0);
    expect(out).toContain(`wrote ${file}`);
    const written = readFileSync(file, "utf8").trimEnd();
    expect(written.startsWith('<script type="application/ld+json">')).toBe(true);
    const json = written.slice(written.indexOf("\n") + 1, written.lastIndexOf("</script>"));
    expect(JSON.parse(json)).toEqual(structuredData(load(withIdentityLink())).jsonLd);
  });
});
