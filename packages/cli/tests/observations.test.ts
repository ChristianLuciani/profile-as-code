/**
 * Manual observations — the operator's hand-read rows (SPEC §7.10, issue #412).
 *
 * The measured gap (#412): a prospect's real surfaces publish no schema.org
 * `Person`/`Organization`, so `discover` had no input for the person the engine
 * sells an audit to. These cases pin the second input path and, just as
 * importantly, that it is not a second assembly path: rows become the same
 * `SurfaceObservation` the transport produces, so `provisionalProfile`,
 * provenance, `absent[]` and `discoveryFindings` are the ones that already ran.
 *
 * No network anywhere: a manual row's URL is a provenance label. The stub below
 * throws if the transport is touched, which is how "zero requests" is asserted
 * instead of claimed.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../src/commands/discover.js";
import { DiscoveryError } from "../src/discovery.js";
import { loadObservations, OBSERVATION_FIELDS, parseObservations } from "../src/observations.js";
import type { FetchText } from "../src/verify.js";

const RETRIEVED = "2026-11-01T00:00:00.000Z";
const AT = '"2026-11-01"';
const ADA = "https://www.linkedin.com/in/ada";

type FieldValue = string | number | Record<string, string | number>;
/** One YAML row, so a case states its facts instead of ten lines of indent. */
function row(fields: Record<string, FieldValue>): string {
  const out: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "object") {
      out.push(`  ${key}:`);
      for (const [inner, item] of Object.entries(value)) out.push(`    ${inner}: ${item}`);
    } else {
      out.push(`${out.length === 0 ? "- " : "  "}${key}: ${value}`);
    }
  }
  return out.join("\n");
}
const doc = (...rows: string[]): string => rows.join("\n");

const adaName = row({
  surface: "linkedin.com",
  field: "name",
  value: '"Ada Lovelace"',
  url: ADA,
  retrieved_at: AT,
});
const adaLink = row({
  surface: "linkedin.com",
  field: "link",
  value: "https://github.com/ada",
  url: ADA,
  retrieved_at: AT,
});
const adaJob = row({
  surface: "linkedin.com",
  field: "experience",
  value: { role: "Engineer", org: "Acme", start: '"2020-03"' },
  url: ADA,
  retrieved_at: AT,
});
const orcidJob = row({
  surface: "orcid.org",
  field: "experience",
  value: { role: "Engineer", org: "Acme", start: '"2019-06"', end: "present" },
  url: "https://orcid.org/0000-0002-1825-0097",
  retrieved_at: "2026-11-02",
});
const ROWS = doc(adaName, adaLink, adaJob, orcidJob);

/** No request may leave the process in manual mode: this stub fails the test. */
const NO_FETCH: FetchText = async (url) => {
  throw new Error(`a request was made to ${url} in manual-only mode`);
};
const manual = (text: string): ReturnType<typeof discover> =>
  discover({ urls: [], fetchText: NO_FETCH, manualObservations: parseObservations(text) });

describe("parseObservations — the row grammar", () => {
  it("turns each row into the transport's own observation shape, in file order", () => {
    const observations = parseObservations(ROWS);
    expect(observations.map((item) => item.surface)).toEqual([
      "linkedin.com",
      "linkedin.com",
      "linkedin.com",
      "orcid.org",
    ]);
    // The node types the JSON-LD path yields: `name`, `sameAs`, and
    // `jobTitle` + `worksFor` for the extractor's experience rule.
    expect(observations[0]?.jsonLd).toEqual([{ "@type": "Person", name: "Ada Lovelace" }]);
    expect(observations[1]?.jsonLd).toEqual([
      { "@type": "Person", sameAs: ["https://github.com/ada"] },
    ]);
    expect(observations[2]?.jsonLd).toEqual([
      {
        "@type": "Person",
        jobTitle: "Engineer",
        worksFor: { "@type": "Organization", name: "Acme", startDate: "2020-03" },
      },
    ]);
    // A date-only retrieval is a full instant, exactly like the transport's; an
    // explicit `present` is the absence of an end date, never a date.
    expect(observations[0]?.retrieved).toBe(RETRIEVED);
    expect(observations[3]?.retrieved).toBe("2026-11-02T00:00:00.000Z");
    expect(observations[3]?.jsonLd).toEqual([
      {
        "@type": "Person",
        jobTitle: "Engineer",
        worksFor: { "@type": "Organization", name: "Acme", startDate: "2019-06" },
      },
    ]);
    // Manual rows carry no page text or links: those classes need a machine read.
    expect(observations.every((item) => item.text === "" && item.links.length === 0)).toBe(true);
  });

  it("accepts an unquoted numeric year (the YAML number a human writes)", () => {
    const observations = parseObservations(
      row({
        surface: "example.com",
        field: "experience",
        value: { role: "Engineer", org: "Acme", start: 2020 },
        url: "https://example.com/cv",
        retrieved_at: AT,
      }),
    );
    expect(observations[0]?.jsonLd).toEqual([
      {
        "@type": "Person",
        jobTitle: "Engineer",
        worksFor: { "@type": "Organization", name: "Acme", startDate: "2020" },
      },
    ]);
  });

  it("refuses every malformed row by number, never silently", () => {
    const base = { surface: "a.com", url: "https://a.com", retrieved_at: AT };
    const name = (extra: Record<string, FieldValue> = {}): string =>
      row({ ...base, field: "name", value: "Ada", ...extra });
    const job = (value: Record<string, string>): string =>
      row({ ...base, field: "experience", value });
    const cases: [string, string][] = [
      ["unknown field", row({ ...base, field: "headline", value: "x" })],
      ["unknown key", `${name()}\n  note: extra`],
      [
        "missing key",
        row({ surface: "a.com", field: "name", url: "https://a.com", retrieved_at: AT }),
      ],
      ["blank surface", name({ surface: '"  "' })],
      ["non-http url", name({ url: "ftp://a.com" })],
      ["link value is not a URL", row({ ...base, field: "link", value: "github" })],
      ["invalid date", job({ role: "Engineer", org: "Acme", start: '"spring 2020"' })],
      ["experience missing org", job({ role: "Engineer", start: "2020" })],
      [
        "experience unknown key",
        job({ role: "Engineer", org: "Acme", start: "2020", location: "Remote" }),
      ],
      ["retrieved_at without a zone", name({ retrieved_at: '"2026-11-01 10:00"' })],
      // Review F1: a shape regex blessed impossible dates; a provenance instant
      // nobody can open is refused like any other malformed row.
      ["impossible month", name({ retrieved_at: '"2026-13-45"' })],
      ["impossible day in retrieved_at", name({ retrieved_at: '"2026-02-31T00:00:00Z"' })],
      // Round 2, F1: day 00 was inside the bound (Date.UTC month, 0) and leaked.
      ["day zero in retrieved_at", name({ retrieved_at: '"2026-02-00"' })],
      [
        "day zero in an experience start",
        job({ role: "Engineer", org: "Acme", start: '"2020-01-00"' }),
      ],
      [
        "impossible month in an experience start",
        job({ role: "Engineer", org: "Acme", start: '"2020-13"' }),
      ],
    ];
    for (const [label, text] of cases) {
      expect(() => parseObservations(text), label).toThrow(DiscoveryError);
      expect(() => parseObservations(text), label).toThrow(/observations: row 1: /u);
    }
  });

  it("accepts a leap day and the last day of a short month", () => {
    expect(
      parseObservations(
        row({
          surface: "a.com",
          field: "experience",
          value: { role: "Engineer", org: "Acme", start: '"2024-02-29"', end: '"2024-04-30"' },
          url: "https://a.com",
          retrieved_at: AT,
        }),
      ),
    ).toHaveLength(1);
  });

  it("refuses a second experience row for the same surface and org (review F2)", () => {
    // The assembly keys employment by (surface, org); without this refusal the
    // second row is dropped in silence — the class this repo refuses.
    const job = (role: string, start: string, end?: string, org = "Acme"): string =>
      row({
        surface: "linkedin.com",
        field: "experience",
        value: { role, org, start, ...(end !== undefined ? { end } : {}) },
        url: ADA,
        retrieved_at: AT,
      });
    expect(() =>
      parseObservations(
        doc(job("Engineer", '"2018-01"', '"2021-01"'), job("Senior Engineer", '"2021-01"')),
      ),
    ).toThrow(/row 2: experience for linkedin.com \/ Acme is already declared by row 1/u);
    // Round 2, F2: the refusal uses the ASSEMBLY's key (`experienceId`), so two
    // spellings of one org are one key — not a second silent collapse.
    expect(() =>
      parseObservations(doc(job("Engineer", "2020"), job("Engineer", "2020", undefined, "ACME"))),
    ).toThrow(/already declared by row 1 \(Acme\)/u);
  });

  it("refuses an empty or non-sequence document", () => {
    expect(() => parseObservations("")).toThrow(/the file is empty/u);
    expect(() => parseObservations("surface: a.com\nfield: name\n")).toThrow(
      /must be a YAML sequence/u,
    );
    expect(() => parseObservations("[]")).toThrow(/declares no rows/u);
    expect(() => parseObservations("surface: [unclosed")).toThrow(/not valid YAML/u);
  });

  it("names the field vocabulary from one home", () => {
    expect(OBSERVATION_FIELDS).toEqual(["name", "link", "experience"]);
  });
});

describe("loadObservations — the operator's file", () => {
  it("reads a YAML file and refuses an unreadable path with the same error class", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-observations-"));
    try {
      const file = join(dir, "observations.yaml");
      writeFileSync(file, ROWS);
      expect(loadObservations(file)).toHaveLength(4);
      expect(() => loadObservations(join(dir, "missing.yaml"))).toThrow(
        /observations: cannot read/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("discover --observations — the same assembly and the same classes", () => {
  it("builds the provisional profile with per-row provenance and NO request", async () => {
    const result = await manual(ROWS);
    expect(result.surfaces).toEqual([
      { url: ADA, surface: "linkedin.com", status: null, via: "manual" },
      {
        url: "https://orcid.org/0000-0002-1825-0097",
        surface: "orcid.org",
        status: null,
        via: "manual",
      },
    ]);
    expect(result.unchecked).toEqual([]);
    expect(result.wrote).toBe(false);
    expect(result.provisional.profile.identity.name).toBe("Ada Lovelace");
    expect(result.provisional.profile.experience).toHaveLength(2);
    // Provenance points at the row that declared the fact, never at a merge.
    expect(result.provisional.provenance["identity.name"]).toEqual({
      surface: "linkedin.com",
      url: ADA,
      retrieved: RETRIEVED,
      attested: false,
    });
    expect(result.provisional.provenance["experience[orcid-org-acme]"]).toEqual({
      surface: "orcid.org",
      url: "https://orcid.org/0000-0002-1825-0097",
      retrieved: "2026-11-02T00:00:00.000Z",
      attested: false,
    });
    expect(result.provisional.absent).toEqual([]);
  });

  it("reports a cross-surface date disagreement as a contradiction citing BOTH rows", async () => {
    const result = await manual(ROWS);
    const contradiction = result.findings.find((item) => item.class === "contradiction");
    expect(contradiction?.severity).toBe("FAIL");
    expect(contradiction?.path).toMatch(/^experience\[/u);
    expect(contradiction?.detail).toContain(`linkedin.com (${ADA})`);
    expect(contradiction?.detail).toContain("orcid.org (https://orcid.org/0000-0002-1825-0097)");
  });

  it("reports two surfaces that declare different names instead of dropping the second", async () => {
    const result = await manual(
      doc(
        adaName,
        row({
          surface: "x.com",
          field: "name",
          value: '"Ada King"',
          url: "https://x.com/ada",
          retrieved_at: AT,
        }),
      ),
    );
    expect(result.provisional.profile.identity.name).toBe("Ada Lovelace");
    const finding = result.findings.find((item) => item.path === "identity.name");
    expect(finding?.class).toBe("contradiction");
    expect(finding?.severity).toBe("FAIL");
    expect(finding?.detail).toContain('"Ada Lovelace" — linkedin.com');
    expect(finding?.detail).toContain('"Ada King" — x.com');
    expect(finding?.detail).toContain("across surfaces");
  });

  it("treats a casing/whitespace variant as the same name", async () => {
    const result = await manual(
      doc(
        adaName,
        row({
          surface: "x.com",
          field: "name",
          value: '"ada   lovelace"',
          url: "https://x.com/ada",
          retrieved_at: AT,
        }),
      ),
    );
    expect(result.findings.filter((item) => item.path === "identity.name")).toEqual([]);
  });

  it("treats an NFC/NFD spelling as the same name (review F3)", async () => {
    const composed = "José García";
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    const result = await manual(
      doc(
        row({
          surface: "linkedin.com",
          field: "name",
          value: `"${composed}"`,
          url: "https://linkedin.com/in/jose",
          retrieved_at: AT,
        }),
        row({
          surface: "x.com",
          field: "name",
          value: `"${decomposed}"`,
          url: "https://x.com/jose",
          retrieved_at: AT,
        }),
      ),
    );
    expect(result.findings.filter((item) => item.path === "identity.name")).toEqual([]);
  });

  it("names the declarations' scope when they come from one surface", async () => {
    const result = await manual(
      doc(
        adaName,
        row({
          surface: "linkedin.com",
          field: "name",
          value: '"A. Lovelace"',
          url: ADA,
          retrieved_at: AT,
        }),
      ),
    );
    expect(result.findings.find((item) => item.path === "identity.name")?.detail).toContain(
      "on one surface",
    );
  });

  it("lists absent fields the operator did not record (never defaulted)", async () => {
    // The row's URL becomes the identity link (the provisional profile's own
    // rule); what the operator did not record is absent, never defaulted.
    expect((await manual(adaName)).provisional.absent).toEqual(["experience"]);
  });

  it("refuses rows that declare no name, in the manual terms (never invented)", async () => {
    await expect(manual(adaLink)).rejects.toThrow(/no row declares `name`/u);
  });

  it("declares the payload version the shape changes under", async () => {
    // v2 (#412): `via` added and `status` nullable — declared, not shipped as v1.
    expect((await manual(adaName)).schemaVersion).toBe("2");
  });

  it("merges manual rows with machine-read surfaces, manual first", async () => {
    const calls: string[] = [];
    const fetchText: FetchText = async (url) => {
      calls.push(url);
      return url === "https://dev.to/ada"
        ? {
            status: 200,
            text: `<script type="application/ld+json">{"@type":"Person","name":"Ada L."}</script>`,
          }
        : { status: 0 };
    };
    const result = await discover({
      urls: ["https://dev.to/ada"],
      fetchText,
      manualObservations: parseObservations(adaName),
    });
    // Exactly ONE request: the machine-read surface. The manual row is a label.
    expect(calls).toEqual(["https://dev.to/ada"]);
    expect(result.surfaces.map((item) => item.via)).toEqual(["manual", "fetch"]);
    // The operator's own reading is the declared identity, and the machine-read
    // surface that disagrees is reported rather than silently reconciled.
    expect(result.provisional.profile.identity.name).toBe("Ada Lovelace");
    expect(result.findings.some((item) => item.path === "identity.name")).toBe(true);
  });
});
