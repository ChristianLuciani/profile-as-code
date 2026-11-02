/**
 * `pasco discover` — the provisional-profile contract (SPEC §7.10, issue #329).
 *
 * No network: the transport is injected (§19.5 determinism), so every case is a
 * fixture. Each acceptance bullet of #329 has a case below — two surfaces that
 * disagree on a date (one contradiction, both provenances cited), a link that
 * does not resolve (dangling-ref), a numeric claim with no source
 * (unsourced-claim), a host outside the allowlist (NO request made), and the
 * write-nothing rule (the report says so AND no file is produced).
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeProfile, validateProfile } from "@profile-as-code/core";
import { describe, expect, it, vi } from "vitest";
import { discover } from "../src/commands/discover.js";
import {
  DiscoveryError,
  discoveryFindings,
  provisionalProfile,
  type SurfaceObservation,
} from "../src/discovery.js";
import type { FetchText } from "../src/verify.js";

const RETRIEVED = "2026-10-29T18:00:00.000Z";

function page(jsonLd: unknown, body = ""): string {
  return `<!doctype html><html><head><title>Ada Lovelace</title>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head>
<body>${body}</body></html>`;
}

function person(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Ada Lovelace",
    jobTitle: "Engineer",
    worksFor: { "@type": "Organization", name: "Acme", startDate: "2020" },
    sameAs: ["https://github.com/ada"],
    ...overrides,
  };
}

/** A fetch stub keyed by URL. Any URL absent here is a transport failure. */
function stubFetch(
  pages: Record<string, { status: number; text: string }>,
  calls: string[] = [],
): FetchText {
  return async (url) => {
    calls.push(url);
    return pages[url] ?? { status: 0 };
  };
}

describe("provisionalProfile", () => {
  it("keeps one row per surface so a date disagreement stays observable", () => {
    const observations: SurfaceObservation[] = [
      {
        surface: "github.com",
        url: "https://github.com/ada",
        retrieved: RETRIEVED,
        jsonLd: [person()],
        text: "",
        links: [],
      },
      {
        surface: "linkedin.com",
        url: "https://linkedin.com/in/ada",
        retrieved: RETRIEVED,
        jsonLd: [
          person({ worksFor: { "@type": "Organization", name: "Acme", startDate: "2019" } }),
        ],
        text: "",
        links: [],
      },
    ];
    const provisional = provisionalProfile(observations);
    expect(provisional.profile.experience).toHaveLength(2);
    const findings = discoveryFindings(provisional, observations);
    const contradictions = findings.filter((item) => item.class === "contradiction");
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]?.severity).toBe("FAIL");
    expect(contradictions[0]?.detail).toContain("duplicate-experience");
    // F4: the finding's address is a provenance key, and BOTH surfaces that
    // asserted the conflicting fact are cited (otherwise the reader can only
    // check one of the two claims).
    expect(provisional.provenance[contradictions[0]?.path ?? ""]).toBeDefined();
    expect(contradictions[0]?.detail).toContain("github.com");
    expect(contradictions[0]?.detail).toContain("linkedin.com");
  });

  it("carries provenance on every populated fact and marks it unattested", () => {
    const provisional = provisionalProfile([
      {
        surface: "github.com",
        url: "https://github.com/ada",
        retrieved: RETRIEVED,
        jsonLd: [person()],
        text: "",
        links: [],
      },
    ]);
    expect(provisional.provenance["identity.name"]).toEqual({
      surface: "github.com",
      url: "https://github.com/ada",
      retrieved: RETRIEVED,
      attested: false,
    });
    expect(provisional.provenance["identity.links[0]"]?.attested).toBe(false);
    expect(provisional.absent).toEqual([]);
  });

  it("lists the fields it looked for and did not find", () => {
    const provisional = provisionalProfile([
      {
        surface: "github.com",
        url: "https://github.com/ada",
        retrieved: RETRIEVED,
        jsonLd: [{ "@type": "Person", name: "Ada Lovelace" }],
        text: "",
        links: [],
      },
    ]);
    expect(provisional.absent).toEqual(["experience"]);
  });

  it("refuses to invent an identity when no surface declares a name", () => {
    expect(() =>
      provisionalProfile([
        {
          surface: "example.com",
          url: "https://example.com",
          retrieved: RETRIEVED,
          jsonLd: [],
          text: "<title>Ada</title> is a page title, not a declared name",
          links: [],
        },
      ]),
    ).toThrow(DiscoveryError);
  });

  it("names the qualifying surface in the refusal instead of a dead end (#418)", () => {
    let message = "";
    try {
      provisionalProfile([
        {
          surface: "github.com",
          url: "https://github.com/ada",
          retrieved: RETRIEVED,
          jsonLd: [],
          text: "",
          links: [],
        },
      ]);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Person/);
    expect(message).toMatch(/Organization/);
    expect(message).toMatch(/personal site or page/);
    expect(message).toMatch(/identity\.name/);
  });

  it("still refuses a generic SoftwareApplication node (#418: the class is unchanged)", () => {
    expect(() =>
      provisionalProfile([
        {
          surface: "christianluciani.github.io",
          url: "https://christianluciani.github.io/profile-as-code/",
          retrieved: RETRIEVED,
          jsonLd: [
            {
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "profile-as-code",
            },
          ],
          text: "",
          links: [],
        },
      ]),
    ).toThrow(DiscoveryError);
  });
});

describe("discover", () => {
  it("reads the allowlisted surfaces and writes nothing", async () => {
    const result = await discover({
      urls: ["https://github.com/ada", "https://linkedin.com/in/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": { status: 200, text: page(person()) },
        "https://linkedin.com/in/ada": {
          status: 200,
          text: page(
            person({ worksFor: { "@type": "Organization", name: "Acme", startDate: "2019" } }),
          ),
        },
      }),
    });
    expect(result.surfaces.map((item) => item.surface)).toEqual(["github.com", "linkedin.com"]);
    expect(result.wrote).toBe(false);
    expect(result.findings.some((item) => item.class === "contradiction")).toBe(true);
    expect(Object.keys(result.provisional.provenance).length).toBeGreaterThan(0);
  });

  it("makes NO request to a host outside the allowlist", async () => {
    const calls: string[] = [];
    await expect(
      discover({
        urls: ["https://prospect.example/profile"],
        retrieved: RETRIEVED,
        fetchText: stubFetch({}, calls),
      }),
    ).rejects.toThrow(/host-not-allowed/);
    // The invariant: the refusal happens BEFORE any request exists.
    expect(calls).toEqual([]);
  });

  it("accepts an operator-declared host", async () => {
    const result = await discover({
      urls: ["https://prospect.example/profile"],
      retrieved: RETRIEVED,
      allowHosts: ["prospect.example"],
      fetchText: stubFetch({
        "https://prospect.example/profile": { status: 200, text: page(person()) },
      }),
    });
    expect(result.surfaces).toHaveLength(1);
  });

  it("reports a link on the surface that does not resolve as dangling-ref", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(person(), '<a href="https://github.com/ada/missing">work</a>'),
        },
        "https://github.com/ada/missing": { status: 404, text: "nope" },
      }),
    });
    const dangling = result.findings.filter((item) => item.class === "dangling-ref");
    expect(dangling).toHaveLength(1);
    expect(dangling[0]?.detail).toContain("404");
  });

  it("warns on a quantitative claim about the entity with no source on the surface", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(person(), "<p>Ada grew revenue 40% in 2022.</p>"),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.severity).toBe("WARN");
  });

  it("reports only the entity's claim, not badge/footer chrome (#419)", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(
            person(),
            `<p>Close 10,000 Thumbs Up Milestone Awarded for giving 10,000 thumbs ups</p>
             <p>DEV Community &copy; 2016 - 2026.</p>
             <p>Ada advised 12 teams in 2024.</p>`,
          ),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.detail).toContain("Ada advised 12 teams in 2024");
  });

  it("keeps a first-person claim (#419)", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(person(), "<p>I have 12 years of experience.</p>"),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.detail).toContain("I have 12 years");
  });

  it("drops a third party's claim (#419)", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(person(), "<p>Jane has 10,000 followers.</p>"),
        },
      }),
    });
    expect(result.findings.filter((item) => item.class === "unsourced-claim")).toHaveLength(0);
  });

  it("matches a non-ASCII name (Unicode boundaries, not ASCII \\b)", async () => {
    const result = await discover({
      urls: ["https://example.com/"],
      retrieved: RETRIEVED,
      allowHosts: ["example.com"],
      fetchText: stubFetch({
        "https://example.com/": {
          status: 200,
          text: page(
            { "@type": "Person", name: "José García" },
            "<p>José García grew revenue 40% in 2022.</p>",
          ),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.detail).toContain("José García grew revenue");
  });

  it("does not treat the abbreviation i.e. as first-person", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(person(), "<p>The stack, i.e. 40 services, ships weekly.</p>"),
        },
      }),
    });
    expect(result.findings.filter((item) => item.class === "unsourced-claim")).toHaveLength(0);
  });

  it("matches a short declared name (no length threshold)", async () => {
    const result = await discover({
      urls: ["https://github.com/li"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/li": {
          status: 200,
          text: page({ "@type": "Person", name: "Li" }, "<p>Li shipped 30 products.</p>"),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.detail).toContain("Li shipped 30 products");
  });

  it("does not treat a linked repo slug as the entity's handle (#419)", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(
            person({ sameAs: ["https://github.com/ada/profile-as-code"] }),
            "<p>profile-as-code has 500 stars.</p>",
          ),
        },
      }),
    });
    expect(result.findings.filter((item) => item.class === "unsourced-claim")).toHaveLength(0);
  });

  it("does not treat a navigation segment (/about) as the entity's handle", async () => {
    const result = await discover({
      urls: ["https://example.com/about/"],
      retrieved: RETRIEVED,
      allowHosts: ["example.com"],
      fetchText: stubFetch({
        "https://example.com/about/": {
          status: 200,
          text: page(
            { "@type": "Person", name: "Ada Lovelace" },
            "<p>Software about accessibility ships 40 releases a year.</p>",
          ),
        },
      }),
    });
    expect(result.findings.filter((item) => item.class === "unsourced-claim")).toHaveLength(0);
  });

  it("matches a short token case-sensitively (Will is not the word will)", async () => {
    const result = await discover({
      urls: ["https://github.com/willsmith"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/willsmith": {
          status: 200,
          text: page(
            { "@type": "Person", name: "Will Smith" },
            "<p>will ship 40 releases.</p><p>Will shipped 30 releases.</p>",
          ),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.detail).toContain("Will shipped 30 releases");
  });

  it("does not read a name starting with I (Iñaki) as the first-person pronoun", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(person(), "<p>Iñaki shipped 40 releases.</p>"),
        },
      }),
    });
    expect(result.findings.filter((item) => item.class === "unsourced-claim")).toHaveLength(0);
  });

  it("keeps a claim whose sentence is wrapped in the HTML source", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(person(), "<p>Ada has\n20 years of experience.</p>"),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.detail).toContain("Ada has 20 years");
  });

  it("does not treat a lowercase name particle as the entity", async () => {
    const result = await discover({
      urls: ["https://github.com/josedelacruz"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/josedelacruz": {
          status: 200,
          text: page(
            { "@type": "Person", name: "José de la Cruz" },
            "<p>Más de 40 clientes atendidos.</p><p>José de la Cruz atendió 40 clientes.</p>",
          ),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.detail).toContain("José de la Cruz atendió");
  });

  it("skips a three-letter lowercase particle (van) but keeps a capitalized Al", async () => {
    const vangogh = await discover({
      urls: ["https://example.com/vincent"],
      retrieved: RETRIEVED,
      allowHosts: ["example.com"],
      fetchText: stubFetch({
        "https://example.com/vincent": {
          status: 200,
          text: page(
            { "@type": "Person", name: "Vincent van Gogh" },
            "<p>van 40 medewerkers werken hier.</p><p>Vincent van Gogh made 40 paintings.</p>",
          ),
        },
      }),
    });
    const goghClaims = vangogh.findings.filter((item) => item.class === "unsourced-claim");
    expect(goghClaims).toHaveLength(1);
    expect(goghClaims[0]?.detail).toContain("Vincent van Gogh made 40 paintings");

    const gore = await discover({
      urls: ["https://example.com/al"],
      retrieved: RETRIEVED,
      allowHosts: ["example.com"],
      fetchText: stubFetch({
        "https://example.com/al": {
          status: 200,
          text: page({ "@type": "Person", name: "Al Gore" }, "<p>Al shipped 40 releases.</p>"),
        },
      }),
    });
    const goreClaims = gore.findings.filter((item) => item.class === "unsourced-claim");
    expect(goreClaims).toHaveLength(1);
    expect(goreClaims[0]?.detail).toContain("Al shipped 40 releases");
  });

  it("matches the handle in a surface URL (#419)", async () => {
    const result = await discover({
      urls: ["https://dev.to/ben"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://dev.to/ben": {
          status: 200,
          text: page(
            { "@type": "Person", name: "Ben Halpern" },
            "<p>Ben has shipped 30 products.</p><p>Jane has 10,000 followers.</p>",
          ),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.detail).toContain("Ben has shipped 30 products");
  });

  it("deduplicates identical sentences across surfaces (#419)", async () => {
    const result = await discover({
      urls: ["https://github.com/ada", "https://linkedin.com/in/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(person(), "<p>Ada advised 12 teams in 2024.</p>"),
        },
        "https://linkedin.com/in/ada": {
          status: 200,
          text: page(
            person({ worksFor: { "@type": "Organization", name: "Acme", startDate: "2020" } }),
            "<p>Ada advised 12 teams in 2024.</p>",
          ),
        },
      }),
    });
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(claims).toHaveLength(1);
  });

  it("declares a surface it could not read instead of pretending it was empty", async () => {
    const result = await discover({
      urls: ["https://github.com/ada", "https://linkedin.com/in/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": { status: 200, text: page(person()) },
        "https://linkedin.com/in/ada": { status: 999, text: "" },
      }),
    });
    expect(result.unchecked).toEqual([
      { url: "https://linkedin.com/in/ada", surface: "linkedin.com", reason: "http-999" },
    ]);
  });

  it("fails loudly when no surface could be read", async () => {
    await expect(
      discover({
        urls: ["https://github.com/ada"],
        retrieved: RETRIEVED,
        fetchText: stubFetch({}),
      }),
    ).rejects.toThrow(DiscoveryError);
  });
});

describe("discover — write rule and CLI layer", () => {
  it("writes nothing to the working tree (fs assertion, not a report flag)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-discover-"));
    const cwd = process.cwd();
    try {
      writeFileSync(join(dir, "sentinel.txt"), "keep me");
      const before = readdirSync(dir).sort();
      process.chdir(dir);
      await discover({
        urls: ["https://github.com/ada"],
        retrieved: RETRIEVED,
        fetchText: stubFetch({ "https://github.com/ada": { status: 200, text: page(person()) } }),
      });
      process.chdir(cwd);
      expect(readdirSync(dir).sort()).toEqual(before);
      expect(existsSync(join(dir, "content"))).toBe(false);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not grade a failed link probe (429) as a dead pointer", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(person(), '<a href="https://github.com/ada/busy">busy</a>'),
        },
        "https://github.com/ada/busy": { status: 429, text: "" },
      }),
    });
    expect(result.findings.filter((item) => item.class === "dangling-ref")).toHaveLength(0);
  });

  it("runDiscover: --json envelope, exit 1 on a FAIL finding, exit 0 when clean", async () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    const { setJsonMode } = await import("../src/output.js");
    const { runDiscover } = await import("../src/commands/discover.js");
    try {
      setJsonMode(true);
      const failing = await runDiscover({
        urls: ["https://github.com/ada", "https://linkedin.com/in/ada"],
        retrieved: RETRIEVED,
        fetchText: stubFetch({
          "https://github.com/ada": { status: 200, text: page(person()) },
          "https://linkedin.com/in/ada": {
            status: 200,
            text: page(
              person({ worksFor: { "@type": "Organization", name: "Acme", startDate: "2019" } }),
            ),
          },
        }),
      });
      expect(failing).toBe(1);
      const envelope = JSON.parse(chunks.join(""));
      expect(envelope.command).toBe("discover");
      expect(envelope.data.wrote).toBe(false);
      expect(envelope.data.findings.some((f: { severity: string }) => f.severity === "FAIL")).toBe(
        true,
      );

      chunks.length = 0;
      const clean = await runDiscover({
        urls: ["https://github.com/ada"],
        retrieved: RETRIEVED,
        fetchText: stubFetch({
          "https://github.com/ada": {
            status: 200,
            text: page({ "@type": "Person", name: "Ada Lovelace" }),
          },
        }),
      });
      expect(clean).toBe(0);
    } finally {
      spy.mockRestore();
      const { setJsonMode: reset } = await import("../src/output.js");
      reset(false);
    }
  });
});

describe("discovery — address honesty (round-2 majors)", () => {
  it("cites only the conflicting group, never an agreeing sibling group", () => {
    const profile = normalizeProfile(
      validateProfile({
        identity: { name: "Ada", links: [{ url: "https://github.com/ada" }] },
        experience: [
          { id: "s1-x", role: "X", org: "Acme", start: "2020-01-01" },
          { id: "s2-x", role: "X", org: "Acme", start: "2019-01-01" },
          { id: "s1-y", role: "Y", org: "Beta", start: "2021-01-01" },
          { id: "s2-y", role: "Y", org: "Beta", start: "2022-01-01" },
        ],
      }),
    );
    const provenance = Object.fromEntries(
      ["s1-x", "s2-x", "s1-y", "s2-y"].map((id) => [
        `experience[${id}]`,
        {
          surface: id.startsWith("s1") ? "github.com" : "linkedin.com",
          url: `https://${id.startsWith("s1") ? "github.com" : "linkedin.com"}/ada`,
          retrieved: RETRIEVED,
          attested: false as const,
        },
      ]),
    );
    const findings = discoveryFindings({ profile, provenance, absent: [] }, []);
    const xConflict = findings.find((item) => item.detail.includes("x @ acme"));
    const yConflict = findings.find((item) => item.detail.includes("y @ beta"));
    expect(xConflict).toBeDefined();
    expect(yConflict).toBeDefined();
    // The false-attribution bug: citing Beta rows for the Acme conflict.
    expect(xConflict?.detail).not.toContain("Beta");
    expect(yConflict?.detail).not.toContain("Acme");
  });

  it("gives each dead link and each unsourced sentence its own address", async () => {
    const result = await discover({
      urls: ["https://github.com/ada"],
      retrieved: RETRIEVED,
      fetchText: stubFetch({
        "https://github.com/ada": {
          status: 200,
          text: page(
            person(),
            '<a href="https://github.com/ada/one">1</a><a href="https://github.com/ada/two">2</a><p>Ada grew 40%.</p><p>Ada saved $500.</p>',
          ),
        },
        "https://github.com/ada/one": { status: 404, text: "" },
        "https://github.com/ada/two": { status: 410, text: "" },
      }),
    });
    const dangling = result.findings.filter((item) => item.class === "dangling-ref");
    const claims = result.findings.filter((item) => item.class === "unsourced-claim");
    expect(new Set(dangling.map((item) => item.path)).size).toBe(dangling.length);
    expect(new Set(claims.map((item) => item.path)).size).toBe(claims.length);
    expect(dangling[0]?.path).toMatch(/^links\[github\.com\]\[\d+\]$/);
    expect(claims[0]?.path).toMatch(/^surface\[github\.com\]\.text\[\d+\]$/);
  });
});
