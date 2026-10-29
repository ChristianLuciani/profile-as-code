import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GeoReport, Profile } from "../src/index.js";
import { geoCheck, load } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("geoCheck(profile)", () => {
  it("produces a weighted report with a 0..100 score for the minimal fixture", () => {
    const profile = load(fixture("minimal"));
    const report = geoCheck(profile);

    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
    // 14 since v1.10 (#289): the nine post-v1.6 checks (the canonical @id came
    // with #103/#103's readiness) + the five citability codes of geoCheck v2 —
    // the table in §8 declares them all.
    expect(report.checks).toHaveLength(14);

    // weights add up to 1
    const totalWeight = report.checks.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 5);

    // sections partition the checks
    const flat = Object.values(report.sections).flatMap((s) => s.checks);
    expect(flat).toHaveLength(report.checks.length);

    // #322 pins the severity default: ABSENT = `warn` — the nine pre-v1.10
    // checks carry NO tier key (they are all warnings); only the five
    // citability codes declare theirs.
    const v2Codes = new Set([
      "geo/canonical-definition",
      "geo/faq-coverage",
      "geo/freshness",
      "geo/sameas-coverage",
      "geo/name-collision",
    ]);
    for (const c of report.checks) {
      if (v2Codes.has(c.code)) continue;
      expect(c.severity).toBeUndefined();
    }
  });

  it("scores fact consistency from conflicts + platform coverage (substack has a headline but no bio)", () => {
    const report = geoCheck(load(fixture("minimal")));
    const section = report.sections.factConsistency;

    expect(section.score).toBeGreaterThanOrEqual(90); // no contradictions; bio coverage 4/5
    const bioCoverage = report.checks.find((c) => c.code === "geo/platform-bio-coverage");
    expect(bioCoverage?.score).toBeCloseTo(4 / 5, 5);
    expect(bioCoverage?.detail).toContain("substack");
  });

  it("exposes machine-readable schema.org Person readiness for the web renderer", () => {
    const report = geoCheck(load(fixture("minimal")));
    const { readiness } = report.sections.structuredData;

    expect(readiness.ready).toBe(true);
    // name + sameAs + image + address + jobTitle + worksFor = 6 of 8 (v1.5 counts
    // identity.email in the completeness denominator — issue #71; the fixture has
    // none; v1.10, #288: `description` is the 8th considered field — emitted only
    // when `identity.definition` exists, which this fixture does not declare).
    expect(readiness.completeness).toBeCloseTo(6 / 8, 5);
    expect(readiness.fields.name).toBe(true);
    expect(readiness.fields.sameAs).toHaveLength(5);
    expect(readiness.fields.jobTitle).toBe("Senior AI Engineer");
    expect(readiness.fields.worksFor).toBe("Nimbus Labs");
    expect(readiness.fields.address).toBe("Madrid, Spain");

    expect(readiness.jsonLd?.["@type"]).toBe("Person");
    expect(readiness.jsonLd?.sameAs).toContain("https://github.com/elenavasquez");
    expect(readiness.jsonLd?.jobTitle).toBe("Senior AI Engineer");
  });

  it("names the missing canonical @id in the structured-data detail (#241)", () => {
    const report = geoCheck(load(fixture("minimal")));
    const entity = report.checks.find((c) => c.code === "geo/entity-id");
    const points = Math.round((entity?.weight ?? 0.05) * 100);

    expect(report.sections.structuredData.readiness.fields.id).toBeUndefined();
    expect(report.sections.structuredData.detail).toContain("role: identity");
    expect(report.sections.structuredData.detail).toContain(`+${points} overall`);
  });

  it("omits the @id gap when a role: identity link exists (#241)", () => {
    const profile = load(fixture("minimal"));
    const link = profile.identity.links?.[0];
    if (link === undefined) throw new Error("minimal fixture must declare an identity link");
    profile.identity.links = [{ ...link, role: "identity" }];
    const report = geoCheck(profile);

    expect(report.sections.structuredData.readiness.fields.id).toBeDefined();
    expect(report.sections.structuredData.detail).not.toContain("Missing canonical @id");
  });

  it("emits schema.org email on Person JSON-LD (v1.5, issue #71) and counts it toward completeness", () => {
    const profile = load(fixture("minimal"));
    profile.identity.email = "elena@example.com";
    const { readiness } = geoCheck(profile).sections.structuredData;

    expect(readiness.completeness).toBe(7 / 8); // … + email = 7/8 (v1.10: description is the 8th considered field, #288)
    expect(readiness.fields.email).toBe("elena@example.com");
    expect(readiness.jsonLd?.email).toBe("elena@example.com");
    // sameAs stays page-URLs-only: the mailto: href is output-only (renderer), never sameAs.
    expect(readiness.jsonLd?.sameAs).not.toContain("mailto:elena@example.com");
  });

  it("emits schema.org nationality as Country.identifier (v1.13, #334) without moving completeness or score", () => {
    const profile = load(fixture("minimal"));
    const baseline = geoCheck(profile);
    profile.identity.nationality = "VE";
    const report = geoCheck(profile);
    const { readiness } = report.sections.structuredData;

    expect(readiness.jsonLd?.nationality).toEqual({ "@type": "Country", identifier: "VE" });
    expect(readiness.fields.nationality).toBe("VE");
    // Optional, outside the gate: same 6/8 as without the field (no new denominator;
    // v1.10 #288 added `description` as the 8th considered field).
    expect(readiness.completeness).toBeCloseTo(6 / 8, 5);
    expect(readiness.ready).toBe(true);
    // And the weighted GEO score is untouched: no check reads the field (#334).
    expect(report.score).toBe(baseline.score);
  });

  it("omits the nationality node when identity.nationality is absent (v1.13, #334)", () => {
    const { readiness } = geoCheck(load(fixture("minimal"))).sections.structuredData;

    expect(readiness.fields.nationality).toBeUndefined();
    expect(readiness.jsonLd?.nationality).toBeUndefined();
    expect(readiness.jsonLd).not.toHaveProperty("nationality");
  });

  it("reports semantic-association anchors with per-anchor reinforcement", () => {
    const report = geoCheck(load(fixture("minimal")));
    const { anchors } = report.sections.semanticAssociations;
    const check = report.checks.find((c) => c.code === "geo/semantic-anchors");

    expect(anchors.anchors).toHaveLength(3);
    expect(anchors.missing).toEqual([]);
    expect(anchors.coverage).toBe(1);
    expect(check?.score).toBe(1);
    expect(check?.detail).toContain("3/3 anchors reinforced");
  });

  it("drops the anchor score to 0 when no positioning.geo anchors exist", () => {
    const profile = load(fixture("minimal"));
    const bare = { identity: profile.identity };
    const report = geoCheck(bare);

    const check = report.checks.find((c) => c.code === "geo/semantic-anchors");
    expect(check?.score).toBe(0);
    expect(check?.detail).toContain("no positioning.geo.semanticAssociations defined");
    expect(report.sections.semanticAssociations.anchors.coverage).toBe(0);
  });

  it("scores citability from DOI/ORCID and evidence[]", () => {
    const report = geoCheck(load(fixture("minimal")));
    const pubs = report.checks.find((c) => c.code === "geo/citable-publications");
    const evidence = report.checks.find((c) => c.code === "geo/evidence-claims");

    expect(pubs?.score).toBe(1); // 2/2 publications carry a DOI
    expect(evidence?.score).toBe(0.5); // 1/2 projects carry evidence
  });

  it("flags contradictions in the drifting fixture (report, not a gate)", () => {
    const minimal = geoCheck(load(fixture("minimal")));
    const drifting = geoCheck(load(fixture("drifting")));
    const conflicts = drifting.checks.find((c) => c.code === "geo/conflicts");

    expect(conflicts?.score).toBeLessThan(1);
    expect(conflicts?.detail).toContain("contradiction(s)");
    expect(drifting.score).toBeLessThan(minimal.score);
  });

  it("is neutral (not penalizing) on missing data", () => {
    const profile = load(fixture("minimal"));
    const bare = { identity: profile.identity };
    const report = geoCheck(bare);

    expect(report.checks.find((c) => c.code === "geo/citable-publications")?.score).toBe(1);
    expect(report.checks.find((c) => c.code === "geo/evidence-claims")?.score).toBe(1);
    expect(report.checks.find((c) => c.code === "geo/platform-bio-coverage")?.score).toBe(1);
  });

  it("empty location counts as absent in the entity-fields check (empty=absent sweep, issue #86)", () => {
    const profile = load(fixture("minimal"));
    profile.identity.location = "";
    const report = geoCheck(profile);
    const check = report.checks.find((c) => c.code === "geo/structured-person");

    expect(report.sections.structuredData.readiness.fields.address).toBeUndefined();
    expect(check?.detail).toContain("location: no");
  });

  it("empty-string langMap role counts as absent in the entity-fields check (textOf parity, issue #86)", () => {
    const profile = load(fixture("minimal"));
    (profile.experience[0] as { role: unknown }).role = { en: "" };
    const report = geoCheck(profile);
    const check = report.checks.find((c) => c.code === "geo/structured-person");

    expect(report.sections.structuredData.readiness.fields.jobTitle).toBeUndefined();
    expect(check?.detail).toContain("jobTitle: no");
  });
});

describe("geoCheck — link roles (v1.6, #103)", () => {
  const withLinks = (links: string) => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-geo-role-"));
    const content = join(dir, "content");
    mkdirSync(content, { recursive: true });
    writeFileSync(
      join(content, "identity.yaml"),
      `name: Elena Vasquez\nlocation: Madrid, Spain\nphoto: https://example.com/e.jpg\nlinks:\n${links}`,
    );
    return { profile: load(dir), cleanup: () => rmSync(dir, { recursive: true }) };
  };

  const check = (report: ReturnType<typeof geoCheck>, code: string) =>
    report.checks.find((c) => c.code === code);

  it("reports geo/entity-id as a gap when no link declares role: identity (never invented)", () => {
    const { profile, cleanup } = withLinks("  - url: https://github.com/elenavasquez\n");
    try {
      const c = check(geoCheck(profile), "geo/entity-id");
      expect(c?.score).toBe(0);
      // The diagnostic names the actual situation (one realization declared), not a
      // generic "nothing declared" — the user DID declare a link.
      expect(c?.detail).toContain("role: realization");
    } finally {
      cleanup();
    }
  });

  it("scores geo/entity-id 1 and names the @id when a link declares role: identity", () => {
    const { profile, cleanup } = withLinks(
      "  - role: identity\n    url: https://elenavasquez.com\n  - url: https://github.com/elenavasquez\n",
    );
    try {
      const c = check(geoCheck(profile), "geo/entity-id");
      expect(c?.score).toBe(1);
      expect(c?.detail).toContain("https://elenavasquez.com");
    } finally {
      cleanup();
    }
  });

  it("counts ONLY role: realization links toward geo/sameas-links (no credit for a signal it does not emit)", () => {
    // Three links but only one will become `sameAs`; counting all three would score a
    // citability signal the JSON-LD never carries.
    const { profile, cleanup } = withLinks(
      [
        "  - role: identity\n    url: https://elenavasquez.com",
        "  - url: https://github.com/elenavasquez",
        "  - role: aggregator\n    url: https://linktr.ee/elenavasquez",
        "",
      ].join("\n"),
    );
    try {
      const c = check(geoCheck(profile), "geo/sameas-links");
      expect(c?.score).toBeCloseTo(1 / 5, 5); // 1 realization / 5 recommended
      expect(c?.detail).toContain("role: realization");
    } finally {
      cleanup();
    }
  });

  it("keeps the documented weights summing to 1 with the new check", () => {
    const report = geoCheck(load(fixture("minimal")));
    expect(report.checks.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1, 5);
  });
});

describe("geoCheck — sameAs never carries the @id (v1.6 review)", () => {
  it("a claimed handle pointing at the identity link does not reappear in sameAs", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-ididem-"));
    const content = join(dir, "content");
    mkdirSync(content, { recursive: true });
    writeFileSync(
      join(content, "identity.yaml"),
      "name: Elena Vasquez\nlinks:\n  - role: identity\n    url: https://x.com/elenavasquez\n  - url: https://github.com/elenavasquez\n",
    );
    writeFileSync(
      join(content, "socialHandles.yaml"),
      "- platform: x\n  handle: elenavasquez\n  status: claimed\n  url: https://x.com/elenavasquez\n",
    );
    try {
      const report = geoCheck(load(dir));
      const sameAs = report.sections.structuredData.readiness.fields.sameAs;
      expect(sameAs).toEqual(["https://github.com/elenavasquez"]);
      expect(sameAs).not.toContain("https://x.com/elenavasquez");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("geoCheck v2 — the citability codes (v1.10, issue #289)", () => {
  let n = 0;
  const ws = (content: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), `pasco-geo2-${n++}-`));
    mkdirSync(join(dir, "content"), { recursive: true });
    for (const [file, text] of Object.entries(content)) {
      writeFileSync(join(dir, "content", file), text);
    }
    return dir;
  };
  const IDENTITY_BODY = `name: Ada Example
location: Guayaquil, Ecuador
definition:
  en: "Ada Example is a fictional identity working from Guayaquil, Ecuador."
links:
  - url: https://ada.example
    role: identity
  - url: https://github.com/adaexample
    role: realization
  - url: https://www.linkedin.com/in/adaexample
    role: realization
  - url: https://x.com/adaexample
    role: realization
`;
  const FAQ_BODY = `- id: faq-a
  q: { en: "First question?" }
  a: { en: "First answer." }
  source: https://example.com/a
- id: faq-b
  q: { en: "Second question?" }
  a: { en: "Second answer." }
  source: https://example.com/b
- id: faq-c
  q: { en: "Third question?" }
  a: { en: "Third answer." }
  source: https://example.com/c
`;
  const find = (report: GeoReport, code: string) => report.checks.find((x) => x.code === code);

  it("the weighted math sums to 1 exactly (the contract)", () => {
    const report = geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY })));
    expect(report.checks.reduce((acc: number, c) => acc + c.weight, 0)).toBeCloseTo(1, 5);
  });

  it("geo/canonical-definition: pass with the quoted sentence; WARN without it (or without the name)", () => {
    const report = geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY })));
    expect(find(report, "geo/canonical-definition")?.score).toBe(1);
    const noDef = ws({ "identity.yaml": "name: Ada Example\nlocation: Guayaquil, Ecuador\n" });
    const c = find(geoCheck(load(noDef)), "geo/canonical-definition");
    expect(c?.score).toBe(0);
    expect(c?.severity).toBe("warn");
    expect(c?.detail).toContain("no identity.definition");
    const namelessBody = `name: Ada Example\nlocation: Guayaquil, Ecuador\ndefinition:\n  en: "A fictional identity working from Guayaquil, Ecuador."\n`;
    const c2 = find(
      geoCheck(load(ws({ "identity.yaml": namelessBody }))),
      "geo/canonical-definition",
    );
    // The fail-conditions land in the SCORE, not the prose (fresh-pass F2).
    expect(c2?.score).toBe(0);
    expect(c2?.detail).toContain("does not contain the entity name");
    // > 160 chars is ALSO schema-capped (max 160, #288) — the geo rule repeats
    // it as defense-in-depth, so the over-cap case is a synthetic profile too.
    const overCap = {
      identity: { name: "Ada Example", definition: { en: `Ada Example, ${"x".repeat(160)}` } },
    } as unknown as Profile;
    const c3 = find(geoCheck(overCap), "geo/canonical-definition");
    expect(c3?.score).toBe(0);
    expect(c3?.detail).toContain("exceeds 160 chars");
  });

  it("geo/faq-coverage: pass with the sourced pair set; WARN under floor / duplicate q / unsourced row", () => {
    const pass = geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY, "faq.yaml": FAQ_BODY })));
    expect(find(pass, "geo/faq-coverage")?.score).toBe(1);
    // < 3 rows is schema-blocked (faq[] minItems: 3, #288): the floor branch of
    // the geo predicate is defense-in-depth for direct callers, so this case is
    // a synthetic profile — a load() of a one-row faq fails at the gate (D12).
    const oneRow = {
      identity: { name: "Ada Example" },
      faq: [{ q: { en: "Only question?" }, a: { en: "Only answer." } }],
    } as unknown as Profile;
    const c1 = find(geoCheck(oneRow), "geo/faq-coverage");
    expect(c1?.score).toBe(0);
    expect(c1?.detail).toContain("below the 3-row floor");
    const dupBody = FAQ_BODY.replace(/id: faq-/g, "id: faq-z6-");
    const c2 = find(
      geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY, "faq.yaml": `${FAQ_BODY}${dupBody}` }))),
      "geo/faq-coverage",
    );
    expect(c2?.score).toBe(0);
    expect(c2?.detail).toContain("duplicate q");
    const unsourcedBody = `- id: faq-a
  q: { en: "First question?" }
  a: { en: "First answer." }
  source: https://example.com/a
- id: faq-b
  q: { en: "Second question?" }
  a: { en: "Second answer." }
- id: faq-c
  q: { en: "Third question?" }
  a: { en: "Third answer." }
  source: https://example.com/c
`;
    const c3 = find(
      geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY, "faq.yaml": unsourcedBody }))),
      "geo/faq-coverage",
    );
    expect(c3?.score).toBe(0);
    expect(c3?.detail).toContain("answer with no pointer is a claim");
  });

  it("geo/freshness: PASS is INFO with a recent confirmed deploy; the gap is INFO too — never WARN", () => {
    const recentTs = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const withDeployBody = `experience:essay-2026:\n  github-readme:\n    deployedAt: ${recentTs}\n    contentHash: ${"c".repeat(64)}\n    source: manual\n`;
    const c = find(
      geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY, "deployments.yaml": withDeployBody }))),
      "geo/freshness",
    );
    expect(c?.score).toBe(1);
    expect(c?.severity).toBe("info");
    expect(c?.detail).toContain("fresher than 12 months");
    const gapBody = "name: Ada Example\n";
    const gap = find(geoCheck(load(ws({ "identity.yaml": gapBody }))), "geo/freshness");
    expect(gap?.score).toBe(0);
    expect(gap?.severity).toBe("info"); // INFO, NEVER WARN (#289)
    // Future-dated facts cannot evidence freshness — an anomaly, not a signal
    // (the 365-day flat constant used to score a typo'd 2099 deploy as 1 — F4).
    const futureTs = new Date(Date.now() + 91 * 86_400_000).toISOString();
    const futureBody = `experience:typo-future:\n  github-readme:\n    deployedAt: ${futureTs}\n    contentHash: ${"d".repeat(64)}\n    source: manual\n`;
    const c2 = find(
      geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY, "deployments.yaml": futureBody }))),
      "geo/freshness",
    );
    expect(c2?.score).toBe(0);
    expect(c2?.severity).toBe("info");
    expect(c2?.detail).toContain("future-dated fact(s)");
    const staleTs = new Date(Date.now() - 397 * 86_400_000).toISOString(); // ~13 months back
    const staleBody = `experience:stale-deploy:\n  github-readme:\n    deployedAt: ${staleTs}\n    contentHash: ${"e".repeat(64)}\n    source: manual\n`;
    const c3 = find(
      geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY, "deployments.yaml": staleBody }))),
      "geo/freshness",
    );
    expect(c3?.score).toBe(0);
    expect(c3?.detail).toContain("older than 12 months");
    // r2 F1 (#322): the anomaly is reported WHENEVER future-dated facts are
    // observed — even when a valid fresh fact wins the score.
    const bothBody = `experience:fresh-deploy:\n  github-readme:\n    deployedAt: ${recentTs}\n    contentHash: ${"f".repeat(64)}\n    source: manual\nexperience:typo-future2:\n  x:\n    deployedAt: ${futureTs}\n    contentHash: ${"ab".repeat(32)}\n    source: manual\n`;
    const c4 = find(
      geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY, "deployments.yaml": bothBody }))),
      "geo/freshness",
    );
    expect(c4?.score).toBe(1); // the fresh fact still carries the score
    expect(c4?.detail).toContain("fresher than 12 months");
    expect(c4?.detail).toContain("future-dated fact(s)");
  });

  it("geo/sameas-coverage: pass with the handles resolved; WARN with the @id duplicate or realization < 3", () => {
    const aliasBody = `- platform: x\n  handle: adaexample-fan\n  status: claimed\n  url: https://x.com/adaexample-fan-page\n`;
    const c = find(
      geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY, "socialHandles.yaml": aliasBody }))),
      "geo/sameas-coverage",
    );
    // 3 realization links + 1 alias = 4 emitted URLs; the identity link is never an "also".
    expect(c?.score).toBe(1);
    expect(c?.detail).toContain("4 URLs in the emitted sameAs");
    const dupBody = `- platform: x\n  handle: adaexample\n  status: claimed\n  url: https://ada.example\n`;
    const c2 = find(
      geoCheck(load(ws({ "identity.yaml": IDENTITY_BODY, "socialHandles.yaml": dupBody }))),
      "geo/sameas-coverage",
    );
    expect(c2?.score).toBe(0);
    expect(c2?.detail).toContain("not resolving");
    const fewBody = `name: Ada Example\nlinks:\n  - url: https://ada.example\n    role: identity\n  - url: https://github.com/adaexample\n    role: realization\n`;
    const c3 = find(geoCheck(load(ws({ "identity.yaml": fewBody }))), "geo/sameas-coverage");
    expect(c3?.score).toBe(0);
    expect(c3?.detail).toContain("1 role: realization link");
  });

  it("geo/name-collision: INFO pass multi-word / disambiguated; the gap names what it cannot do", () => {
    const multiBody = `name: Ada Maria Example\nlocation: Guayaquil, Ecuador\ndefinition:\n  en: "Ada Maria Example is a fiction used by the fixtures."\n`;
    const c = find(geoCheck(load(ws({ "identity.yaml": multiBody }))), "geo/name-collision");
    expect(c?.score).toBe(1);
    expect(c?.detail).toContain("multi-word identity");
    const qualifiedBody = `name: Ada\nlocation: Guayaquil, Ecuador\ndefinition:\n  en: "Ada is a fiction working from Guayaquil, Ecuador."\n`;
    const c2 = find(geoCheck(load(ws({ "identity.yaml": qualifiedBody }))), "geo/name-collision");
    expect(c2?.score).toBe(1);
    expect(c2?.detail).toContain("disambiguated by the declared");
    const roleBody = `name: Ada\ndefinition:\n  en: "Ada is a fictional systems engineer working from Quito, Ecuador."\n`;
    const roleProfile = load(
      ws({
        "identity.yaml": roleBody,
        "experience.yaml": `- org: Fictional Org\n  role: systems engineer\n  start: "2020-01-01"\n`,
      }),
    );
    const c4 = find(geoCheck(roleProfile), "geo/name-collision");
    // The role title disambiguates too (location absent): the score flips with
    // the qualifier it declares (fresh-pass F3 — the advice must count).
    expect(c4?.score).toBe(1);
    expect(c4?.detail).toContain("disambiguated by the declared");
    // r2 F3 (#322): qualifier containment is CASE-INSENSITIVE, like the name
    // containment beside it — a differently-cased mention still says it.
    const casedBody = `name: Ada\nlocation: Madrid, Spain\ndefinition:\n  en: "Ada is a fiction working from madrid, spain."\n`;
    const c5 = find(geoCheck(load(ws({ "identity.yaml": casedBody }))), "geo/name-collision");
    expect(c5?.score).toBe(1);
    expect(c5?.detail).toContain("disambiguated by the declared");
    const bareBody = `name: Ada\nlocation: Guayaquil, Ecuador\n`;
    const c3 = find(geoCheck(load(ws({ "identity.yaml": bareBody }))), "geo/name-collision");
    expect(c3?.score).toBe(0);
    expect(c3?.severity).toBe("info");
    expect(c3?.detail).toContain("[?]"); // the unobservable, marked as such
  });
});
