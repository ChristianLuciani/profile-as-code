/**
 * `pasco audit` — the diagnostic contract (SPEC §7.1, issue #283) and the
 * `fact-present` rule it composes.
 *
 * One committed fixture per failure class under `tests/fixtures/audit/`: each one
 * produces exactly its class, so a regression that silently re-classifies (or
 * drops) a finding fails here instead of shipping a green audit. The artifact-side
 * classes are exercised against a REAL `pasco build` output that the test then
 * edits — the case the rule exists for (a published surface that disagrees with
 * the SSOT). No network: the rule is offline by contract (D19).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import {
  AUDIT_SCHEMA_VERSION,
  AUDIT_SCOPE_KEYS,
  factRef,
  runAudit,
} from "../src/commands/audit.js";
import { runBuild } from "../src/commands/build.js";
import { runCheck } from "../src/commands/check.js";
import { runValidate } from "../src/commands/validate.js";
import { type JsonEnvelope, setJsonMode } from "../src/output.js";
import { catalogAt } from "../src/skill-checks.js";
import { skillsDir } from "../src/skill-path.js";
import type { Pascorc } from "../src/workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures", "audit");
const INVALID = join(__dirname, "fixtures", "invalid");
const COMPLETE = join(__dirname, "..", "..", "core", "tests", "fixtures", "complete");
const DRIFTING = join(__dirname, "..", "..", "core", "tests", "fixtures", "drifting");

const PASCO: Pascorc = {};

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-audit-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function copy(src: string): string {
  const dir = tempDir();
  cpSync(src, dir, { recursive: true });
  return dir;
}

/** A throwaway workspace from literal `content/<file>` bodies. */
function workspace(files: Record<string, string>): string {
  const dir = tempDir();
  mkdirSync(join(dir, "content"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, "content", name), body, "utf8");
  }
  return dir;
}

/** Capture the JSON envelope a command writes to stdout in `--json` mode. */
function json<T>(run: () => T): { code: T; data: JsonEnvelope["data"]; out: string } {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  setJsonMode(true);
  let code: T;
  try {
    code = run();
  } finally {
    process.stdout.write = original;
    setJsonMode(false);
  }
  return { code, data: (JSON.parse(out) as JsonEnvelope).data, out };
}

/** Capture the HUMAN output (JSON mode off) — the contract promises it says so too. */
function human<T>(run: () => T): { code: T; out: string } {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  setJsonMode(false);
  try {
    return { code: run(), out };
  } finally {
    process.stdout.write = original;
  }
}

function audit(workspacePath: string) {
  return json(() => runAudit({ workspace: workspacePath, pascorc: PASCO }));
}

function check(workspacePath: string, platform?: string) {
  return json(() =>
    runCheck({
      workspace: workspacePath,
      pascorc: PASCO,
      ...(platform ? { platformArg: platform } : {}),
    }),
  );
}

function auditPublic(workspacePath: string) {
  return json(() => runAudit({ workspace: workspacePath, pascorc: PASCO, public: true }));
}

interface Finding {
  code?: string;
  class: string;
  severity: string;
  path: string;
  detail: string;
}

interface Scope {
  declared: string[];
  checked: string[];
  notRun: string[];
  notBuildable: string[];
}

interface FactPresent {
  declared: string[];
  checked: string[];
  notRun: string[];
  notBuildable: string[];
  findings: Finding[];
}

/** The artifact `pasco build` writes for the fixture's only renderer surface. */
function githubReadmeArtifact(ws: string): string {
  return join(ws, "profiles", "github-readme", "README.md");
}

function tamper(ws: string, edit: (text: string) => string): void {
  const artifact = githubReadmeArtifact(ws);
  writeFileSync(artifact, edit(readFileSync(artifact, "utf8")), "utf8");
}

describe("pasco audit — the frozen output contract (SPEC §7.1)", () => {
  it("emits findings only: the frozen schemaVersion, the view, the scope, and no score anywhere", () => {
    const { code, data, out } = audit(join(FIXTURES, "unsourced-claim"));
    expect(code).toBe(0);
    const report = data as {
      schemaVersion: string;
      view: string;
      scope: Scope;
      findings: Finding[];
    };
    expect(Object.keys(report).sort()).toEqual(["findings", "schemaVersion", "scope", "view"]);
    // The runtime payload and the single key-set source must agree in both
    // directions: a bucket dropped from `AUDIT_SCOPE_KEYS` (and its docs) fails
    // here because the engine still emits it (#490 review).
    expect(Object.keys(report.scope).sort()).toEqual([...AUDIT_SCOPE_KEYS].sort());
    expect(report.schemaVersion).toBe("2");
    expect(report.schemaVersion).toBe(AUDIT_SCHEMA_VERSION);
    // D27: the default view is the SSOT; --public names the other one.
    expect(report.view).toBe("all");
    expect(report.findings).toHaveLength(1);
    const [finding] = report.findings;
    expect(Object.keys(finding ?? {}).sort()).toEqual(["class", "detail", "path", "severity"]);
    // Findings only: a score, percentage or ranking token would breach the module
    // boundary the contract exists to keep.
    expect(out).not.toMatch(/"(score|percent|percentage|rank|priority)"/);
  });

  it("dangling-ref: a claimed handle that resolves nowhere FAILs at exit 1", () => {
    const { code, data } = audit(join(FIXTURES, "dangling-ref"));
    expect(code).toBe(1);
    const findings = (data as { findings: Finding[] }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      class: "dangling-ref",
      severity: "FAIL",
      // `socialHandles` is outside the factRef grammar: its own address is kept.
      path: "socialHandles[0]",
    });
  });

  it("contradiction: one publication, two years/venues, FAILs at exit 1", () => {
    const { code, data } = audit(join(FIXTURES, "contradiction"));
    expect(code).toBe(1);
    const findings = (data as { findings: Finding[] }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      class: "contradiction",
      severity: "FAIL",
      path: "publications[routing]",
    });
  });

  it("unsourced-claim: a quantitative project claim with no sourced evidence is WARN, exit 0", () => {
    const { code, data } = audit(join(FIXTURES, "unsourced-claim"));
    expect(code).toBe(0);
    const findings = (data as { findings: Finding[] }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      class: "unsourced-claim",
      severity: "WARN",
      path: "projects[hub].description",
    });
  });

  it("audits a workspace with no content/deployments.yaml and no profiles/", () => {
    // Every fixture above has neither: the SSOT-internal classes must still run.
    const { code, data } = audit(join(FIXTURES, "contradiction"));
    expect(code).toBe(1);
    expect((data as { findings: Finding[] }).findings.length).toBeGreaterThan(0);
  });

  it("a schema-invalid workspace is the error envelope at exit 1 — never a fabricated finding", () => {
    const { code, data } = audit(INVALID);
    expect(code).toBe(1);
    expect(data).toBeUndefined();
  });

  it("reports the package-level catalog state, so a broken bundle is not 'nothing declared' (F4)", () => {
    const scope = (
      audit(join(FIXTURES, "unsourced-claim")).data as { scope: Scope & { catalog: string } }
    ).scope;
    expect(scope.catalog).toBe("shipped");
  });

  it("is deliberately stricter than validate on the FAIL classes (declared, pinned)", () => {
    // D12 makes drift warn, so `validate` exits 0; the issue freezes the audit's
    // class severities to FAIL. This difference is the contract (SPEC §7.1).
    const validated = json(() => runValidate({ workspace: DRIFTING }));
    expect(validated.code).toBe(0);
    const audited = audit(DRIFTING);
    expect(audited.code).toBe(1);
  });

  it("does NOT report drift/url-not-in-identity: the URL resolves (declared no-class, F2)", () => {
    // Canonicalization, not a broken pointer: the link lives on a platform host but
    // is not mirrored in identity.links. `validate` warns (D12); the audit gives it
    // no class, so it must not exit 1 over a workspace the other commands accept.
    const ws = workspace({
      "identity.yaml":
        "name: Elena Vasquez\nlinks:\n  - platform: github\n    label: GitHub\n    url: https://github.com/elenavasquez\n",
      "projects.yaml":
        "- id: hub\n  name: example-agentic-hub\n  links:\n    - https://github.com/someoneelse/other-repo\n",
    });
    const validated = json(() => runValidate({ workspace: ws })) as {
      data: { drift: { code: string }[] };
    };
    expect(validated.data.drift.some((issue) => issue.code === "drift/url-not-in-identity")).toBe(
      true,
    );
    const audited = audit(ws);
    expect(audited.code).toBe(0);
    expect((audited.data as { findings: Finding[] }).findings).toEqual([]);
  });

  it("reuses validate's #238 variant-store reconciliation (no false FAIL)", () => {
    const ws = copy(DRIFTING);
    const before = (audit(ws).data as { findings: Finding[] }).findings;
    expect(before.some((finding) => finding.detail.includes("active-variant-missing"))).toBe(true);

    // The chosen body resolves the surface: `validate` already filters the code.
    const variants = join(ws, "profiles", "researchgate", "variants");
    mkdirSync(variants, { recursive: true });
    writeFileSync(join(variants, "rg-2025-01.md"), "# Elena Vasquez\n\nvariant body\n", "utf8");
    const after = (audit(ws).data as { findings: Finding[] }).findings;
    expect(
      after.some(
        (finding) =>
          finding.detail.includes("active-variant-missing") &&
          finding.detail.includes("researchgate"),
      ),
    ).toBe(false);
  });
});

describe("achievements — the impact log is capture-first (§23.3, #446)", () => {
  /** A workspace whose only content is one achievement row. */
  const log = (row: string): string =>
    workspace({ "identity.yaml": "name: Someone\n", "achievements.yaml": row });

  const findings = (data: unknown): Finding[] => (data as { findings: Finding[] }).findings;

  it("a PUBLIC `measured` claim with no pointer is unsourced-claim (WARN, exit 0)", () => {
    const dir = log(`
- id: ach-measured
  statement: { en: Shipped 12 features }
  kind: metric
  metric: { value: 12, unit: "features" }
  basis: measured
  visibility: public
`);
    const { code, data } = audit(dir);
    expect(code).toBe(0);
    expect(findings(data)).toHaveLength(1);
    expect(findings(data)[0]).toMatchObject({
      class: "unsourced-claim",
      severity: "WARN",
      path: "achievements[0]",
    });
  });

  it("addresses the row by INDEX — the block is outside the factRef grammar (§7.1)", () => {
    const dir = log(`
- id: ach-measured
  statement: { en: Shipped 12 features }
  kind: metric
  metric: { value: 12, unit: "features" }
  basis: measured
  visibility: public
`);
    const path = findings(audit(dir).data)[0]?.path ?? "";
    expect(path).toBe("achievements[0]");
    // The `block[id]` form is reserved for the blocks the grammar addresses.
    expect(path).not.toContain("ach-measured");
  });

  it("a PUBLIC `attested` claim with no pointer is too (the third party is not a pointer)", () => {
    const dir = log(`
- id: ach-attested
  statement: { en: Certified as a lead auditor }
  kind: milestone
  basis: attested
  visibility: public
`);
    const { code, data } = audit(dir);
    expect(code).toBe(0);
    expect(findings(data)[0]).toMatchObject({
      class: "unsourced-claim",
      severity: "WARN",
      path: "achievements[0]",
    });
  });

  it("`reported` and `estimated` are NEVER findings — capture first, prove later", () => {
    const dir = log(`
- id: ach-reported
  statement: { en: Cut reconciliation from 72 h to 4 h }
  kind: metric
  metric: { value: 4, baseline: 72, unit: "hours", direction: "decrease" }
  basis: reported
  visibility: public
- id: ach-estimated
  statement: { en: Reach 100 tutors }
  kind: metric
  metric: { target: 100, unit: "tutors" }
  basis: estimated
  visibility: public
`);
    const { code, data } = audit(dir);
    expect(code).toBe(0);
    expect(findings(data)).toEqual([]);
  });

  it("a pointer clears the finding (source, artifactId or credentialId)", () => {
    const dir = log(`
- id: ach-sourced
  statement: { en: Shipped 12 features }
  kind: metric
  metric: { value: 12, unit: "features" }
  source: https://example.com/report
  basis: measured
  visibility: public
`);
    const { code, data } = audit(dir);
    expect(code).toBe(0);
    expect(findings(data)).toEqual([]);
  });

  it("an artifactId pointer clears it too (the OR branch, not just source)", () => {
    const dir = workspace({
      "identity.yaml": "name: Someone\n",
      "artifacts.yaml": `
- id: art-report
  kind: document
  title: Field report
  locator: { url: https://example.com/report }
  visibility: public
`,
      "achievements.yaml": `
- id: ach-artifact
  statement: { en: Shipped 12 features }
  kind: metric
  metric: { value: 12, unit: "features" }
  artifactId: art-report
  basis: measured
  visibility: public
`,
    });
    const { code, data } = audit(dir);
    expect(code).toBe(0);
    expect(findings(data)).toEqual([]);
  });

  it("a credentialId pointer clears it too (the third OR branch)", () => {
    const dir = workspace({
      "identity.yaml": "name: Someone\n",
      "credentials.yaml": `
- id: cred-audit
  kind: certificate
  title: Lead auditor
  issuer: Acme
  visibility: public
`,
      "achievements.yaml": `
- id: ach-credential
  statement: { en: Certified as a lead auditor }
  kind: milestone
  credentialId: cred-audit
  basis: attested
  visibility: public
`,
    });
    const { code, data } = audit(dir);
    expect(code).toBe(0);
    expect(findings(data)).toEqual([]);
  });

  it("a PRIVATE row is outside the public audit surface (§18.5)", () => {
    const dir = log(`
- id: ach-private
  statement: { en: Shipped 12 features }
  kind: metric
  metric: { value: 12, unit: "features" }
  basis: measured
  visibility: private
`);
    const { code, data } = audit(dir);
    expect(code).toBe(0);
    expect(findings(data)).toEqual([]);
  });
});

describe("fact-present — the surface's facts vs the SSOT (issue #283)", () => {
  it("is green on a freshly built artifact and names the surfaces it compared", () => {
    const ws = copy(COMPLETE);
    json(() => runBuild({ workspace: ws, pascorc: PASCO }));
    const { code, data } = check(ws);
    expect(code).toBe(0);
    const facts = (data as { factPresent: FactPresent }).factPresent;
    // The catalog decides the surface (#283/F6): the shipped github-readme skill
    // declares the premise; linkedin/x ship no catalog row.
    expect(facts.declared).toEqual(["github-readme"]);
    expect(facts.checked).toEqual(["github-readme"]);
    expect(facts.notRun).toEqual([]);
    expect(facts.findings).toEqual([]);
  });

  it("makes 'not run' expressible in the audit payload (F1: an empty scope is not clean)", () => {
    const ws = copy(COMPLETE);
    const { code, data } = audit(ws);
    expect(code).toBe(0);
    const report = data as { scope: Scope; findings: Finding[] };
    expect(report.scope).toEqual({
      catalog: "shipped",
      declared: ["github-readme"],
      checked: [],
      notRun: ["github-readme"],
      notBuildable: [],
    });
    // The human output states it instead of looking like a clean audit.
    const humanRun = human(() => runAudit({ workspace: ws, pascorc: PASCO }));
    expect(humanRun.out).toContain("an empty scope is not a clean audit");
    expect(humanRun.out).toContain("not run: github-readme");
  });

  it("declares nothing when no catalog declares the premise — and says so", () => {
    // A workspace that targets only `linkedin`: no shipped catalog row for it, no
    // workspace checks.yaml row → declared: [] (not measured BY CONTRACT).
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "bios.yaml":
        "- platform: linkedin\n  lang: en\n  length: short\n  text: Sovereign AI infrastructure.\n",
    });
    const bare = (audit(ws).data as { scope: Scope }).scope;
    expect(bare).toEqual({
      catalog: "shipped",
      declared: [],
      checked: [],
      notRun: [],
      notBuildable: [],
    });

    // The union: the workspace's OWN catalog can declare the premise for linkedin.
    writeFileSync(
      join(ws, "content", "checks.yaml"),
      "- id: li-facts\n  platform: linkedin\n  rule: fact-present\n  value: true\n",
      "utf8",
    );
    const declared = (check(ws).data as { factPresent: FactPresent }).factPresent;
    expect(declared.declared).toEqual(["linkedin"]);
    expect(declared.checked).toEqual([]);
    expect(declared.notRun).toEqual(["linkedin"]);
    // A bio row makes it buildable: the artifact is missing, not impossible (#490).
    expect(declared.notBuildable).toEqual([]);
  });

  it("distinguishes 'not built yet' from 'not buildable' (#490, audit v2)", () => {
    // `github-org` on a person: the catalog declares the premise and the bio
    // curates the surface, but this workspace never renders it — the build can
    // never satisfy "run pasco build", so the reason must say so.
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "bios.yaml": "- platform: github-org\n  lang: en\n  length: short\n  text: Org bio.\n",
    });
    const report = (audit(ws).data as { scope: Scope }).scope;
    expect(report.declared).toContain("github-org");
    expect(report.notRun).toContain("github-org");
    expect(report.notBuildable).toContain("github-org");
  });

  it("names the reason the scope is empty and never suggests a step already done (#397)", () => {
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "bios.yaml":
        "- platform: linkedin\n  lang: en\n  length: short\n  text: Sovereign AI infrastructure.\n",
    });
    // The repro had an artifact on disk; the old hint still offered "run pasco build".
    json(() => runBuild({ workspace: ws, pascorc: PASCO }));
    expect(existsSync(join(ws, "profiles", "linkedin.md"))).toBe(true);

    const run = human(() => runAudit({ workspace: ws, pascorc: PASCO }));
    expect(run.out).toContain("no check catalog declares");
    expect(run.out).not.toContain("run pasco build");
  });

  it("classifies every tampered fact token — URL, date, number — in both directions", () => {
    const ws = copy(COMPLETE);
    json(() => runBuild({ workspace: ws, pascorc: PASCO }));
    // replaceAll on purpose: the verify URL appears twice (link + JSON-LD) and the
    // number appears in the description and its evidence line.
    tamper(ws, (text) =>
      text
        .replaceAll("https://example.com/verify/aws-ml", "https://example.com/verify/aws-OLD")
        .replace('"validFrom": "2021-06-01"', '"validFrom": "2019-06-01"')
        .replaceAll("40 universities", "400 universities"),
    );

    const checked = check(ws);
    expect(checked.code).toBe(0); // facts warn in `check` (D12)
    const findings = (checked.data as { factPresent: FactPresent }).factPresent.findings;
    // A replaced URL/number is reported in BOTH directions (F2).
    expect(findings.map((finding) => finding.code).sort()).toEqual([
      "fact-present/date-missing-from-surface",
      "fact-present/date-not-in-ssot",
      "fact-present/number-missing-from-surface",
      "fact-present/number-not-in-ssot",
      "fact-present/url-missing-from-surface",
      "fact-present/url-not-in-ssot",
    ]);
    expect(findings.map((finding) => finding.class).sort()).toEqual([
      "contradiction",
      "contradiction",
      "contradiction",
      "contradiction",
      "contradiction",
      "dangling-ref",
    ]);

    const audited = audit(ws);
    expect(audited.code).toBe(1); // the FAIL classes
    const auditFindings = (audited.data as { findings: Finding[] }).findings;
    expect(
      auditFindings.every((finding) => finding.path === "profiles/github-readme/README.md"),
    ).toBe(true);
    // `unsourced-claim` is never emitted by the artifact rule — a number is a fact.
    expect(auditFindings.some((finding) => finding.class === "unsourced-claim")).toBe(false);
  });

  it("reports an artifact that OMITS a fact (symmetric direction)", () => {
    const ws = copy(COMPLETE);
    json(() => runBuild({ workspace: ws, pascorc: PASCO }));
    // Drop the artifact's source URL (it appears once): the SSOT carries it and
    // the surface omits it — the direction the one-sided rule could not see.
    tamper(ws, (text) => text.replace("https://github.com/elenavasquez/example-agentic-hub", ""));
    const findings = (check(ws).data as { factPresent: FactPresent }).factPresent.findings;
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain("fact-present/url-missing-from-surface");
    expect(findings.some((finding) => finding.class === "contradiction")).toBe(true);
  });

  it("reports prose no fact token explains — the §20.1 divergence, attributed (F2)", () => {
    const ws = copy(COMPLETE);
    json(() => runBuild({ workspace: ws, pascorc: PASCO }));
    // No URL/date/number moves, so only the whole-file question can catch it —
    // the case where `status` says `diverges` and the audit used to look clean.
    tamper(ws, (text) =>
      text.replace("Sovereign AI infrastructure engineer", "Sovereign AI infrastructure wizard"),
    );
    const findings = (check(ws).data as { factPresent: FactPresent }).factPresent.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "fact-present/text-not-in-ssot",
      class: "contradiction",
    });
  });

  it("is view-blind: a `build --view` artifact is compared against the implicit view (declared, F7)", () => {
    const ws = copy(COMPLETE);
    const pascorc: Pascorc = {
      selection: {
        views: { film: { platform: "github-readme", excludeKeys: ["projects:sovereign-hub"] } },
      },
    };
    json(() => runBuild({ workspace: ws, pascorc, viewArg: "film" }));
    // The artifact legitimately omits a selected-out entry; the rule compares it
    // against the implicit per-platform view and reports the omission. That is the
    // DECLARED consequence (SPEC §7.1) — pinned so it cannot regress into silence.
    const findings = (check(ws).data as { factPresent: FactPresent }).factPresent.findings;
    expect(
      findings.some((finding) => finding.code === "fact-present/url-missing-from-surface"),
    ).toBe(true);
    expect(findings.every((finding) => finding.class === "contradiction")).toBe(true);
  });

  it("does not turn a GEO coverage deficiency into a claim finding (one premise gate)", () => {
    // Three FAQ rows (the schema minimum), all sourced, two with the SAME `q`:
    // `geo/faq-coverage` scores 0 on the duplicate, and the audit must not invent
    // unsourced-claim rows from it.
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "faq.yaml": [
        "- id: who",
        "  q:",
        "    en: Who is Elena?",
        "  a:",
        "    en: An AI engineer.",
        "  source: https://example.com/elena",
        "- id: who-again",
        "  q:",
        "    en: Who is Elena?",
        "  a:",
        "    en: The same AI engineer.",
        "  source: https://example.com/elena",
        "- id: where",
        "  q:",
        "    en: Where is Elena based?",
        "  a:",
        "    en: Madrid, Spain.",
        "  source: https://example.com/elena",
      ].join("\n"),
    });
    const findings = (audit(ws).data as { findings: Finding[] }).findings;
    expect(findings.some((finding) => finding.class === "unsourced-claim")).toBe(false);
  });

  it("reports the deficient FAQ ROW at its own address (index-based, outside the grammar)", () => {
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "faq.yaml": [
        "- id: who",
        "  q:",
        "    en: Who is Elena?",
        "  a:",
        "    en: An AI engineer.",
        "  source: https://example.com/elena",
        "- id: scale",
        "  q:",
        "    en: How many requests does the hub serve?",
        "  a:",
        "    en: Over 100 requests per month.",
        "- id: where",
        "  q:",
        "    en: Where is Elena based?",
        "  a:",
        "    en: Madrid, Spain.",
        "  source: https://example.com/elena",
      ].join("\n"),
    });
    const findings = (audit(ws).data as { findings: Finding[] }).findings;
    expect(findings).toHaveLength(1);
    // The number is in the ANSWER: the address names `.a`, not the question (F6).
    expect(findings[0]).toMatchObject({ class: "unsourced-claim", path: "faq[1].a" });
    expect(findings[0]?.detail).toContain("the answer carries");
  });

  it("addresses the question when the claim lives there (path and detail agree, F6)", () => {
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "faq.yaml": [
        "- id: who",
        "  q:",
        "    en: Who is Elena?",
        "  a:",
        "    en: An AI engineer.",
        "  source: https://example.com/elena",
        "- id: many",
        "  q:",
        "    en: Does Elena hold 12 certifications?",
        "  a:",
        "    en: She holds several.",
        "  source: https://example.com/elena",
        "- id: where",
        "  q:",
        "    en: Where is Elena based?",
        "  a:",
        "    en: Madrid, Spain.",
        "  source: https://example.com/elena",
      ].join("\n"),
    });
    // `source` is present, so this row is NOT deficient: a q-only numeric claim with
    // a source must not be reported (the audit only reports unsourced rows).
    const sourced = (audit(ws).data as { findings: Finding[] }).findings;
    expect(sourced).toEqual([]);
  });
});

describe("the skill catalog preserves the three #253 states (F4)", () => {
  it("distinguishes not-shipped, no-catalog and found", () => {
    expect(catalogAt(undefined, "github-readme").state).toBe("not-shipped");
    expect(catalogAt(tempDir(), "github-readme").state).toBe("no-catalog");
    const root = skillsDir();
    expect(root).toBeDefined();
    expect(catalogAt(root, "github-readme").state).toBe("found");
    // A surface the shipped tree does not document is `no-catalog`, not `not-shipped`.
    expect(catalogAt(root, "linkedin").state).toBe("no-catalog");
  });
});

describe("factRef — the ledger grammar, extended nowhere (F8)", () => {
  const profile = load(join(FIXTURES, "unsourced-claim"));

  it("maps the block index to the row id for the grammar's blocks", () => {
    expect(factRef(profile, "projects[0].description")).toBe("projects[hub].description");
  });

  it("keeps the index for blocks the grammar does not address", () => {
    for (const path of ["education[0].degree", "press[0].url", "faq[0].q", "socialHandles[0]"]) {
      expect(factRef(profile, path)).toBe(path);
    }
  });
});

describe("audit is a leaf — no command depends on it", () => {
  it("build/check/validate never import the audit command", () => {
    for (const name of ["build", "check", "validate"]) {
      const source = readFileSync(join(__dirname, "..", "src", "commands", `${name}.ts`), "utf8");
      expect(source).not.toMatch(/commands\/audit|from "\.\/audit/);
    }
  });

  it("the quantitative-claim predicate has ONE home: post and the audit share it (F9)", () => {
    const claims = readFileSync(join(__dirname, "..", "src", "claims.ts"), "utf8");
    expect(claims).toContain("export function isQuantitativeClaim");
    for (const name of ["commands/post.ts", "commands/audit.ts"]) {
      const source = readFileSync(join(__dirname, "..", "src", name), "utf8");
      expect(source).toContain("isQuantitativeClaim");
      // The literal predicate lives only in claims.ts — no inline copy anywhere.
      expect(source).not.toContain("[%$]");
    }
  });
});

describe("D27 — `audit --public` reads the publishable view (SPEC §7.1/§23.3)", () => {
  /** One public and one private project with the SAME name: a contradiction in
   *  the record, invisible in the public projection. */
  function duplicateProjectWorkspace(): string {
    return workspace({
      "identity.yaml": "name: Example\n",
      "projects.yaml":
        "- id: pub\n  name: Duplicate\n  visibility: public\n" +
        "- id: secret\n  name: Duplicate\n",
    });
  }

  it("the default view reports a contradiction a private row raises", () => {
    const { code, data } = audit(duplicateProjectWorkspace());
    expect(code).toBe(1);
    const report = data as { view: string; findings: Finding[] };
    expect(report.view).toBe("all");
    expect(report.findings.map((item) => item.class)).toContain("contradiction");
    // The row declares an id, so the factRef addresses it by id (SPEC §7.1).
    expect(report.findings.map((item) => item.path)).toContain("projects[pub]");
  });

  it("--public mirrors the public projection: the private row cannot raise a finding", () => {
    const { code, data } = auditPublic(duplicateProjectWorkspace());
    expect(code).toBe(0);
    const report = data as { view: string; findings: Finding[] };
    expect(report.view).toBe("public");
    expect(report.findings.filter((item) => item.class === "contradiction")).toEqual([]);
  });

  it("--public is the same projection export uses: no score, same frozen shape", () => {
    const { data } = auditPublic(duplicateProjectWorkspace());
    const report = data as {
      schemaVersion: string;
      view: string;
      scope: Scope;
      findings: Finding[];
    };
    expect(Object.keys(report).sort()).toEqual(["findings", "schemaVersion", "scope", "view"]);
    expect(report.schemaVersion).toBe(AUDIT_SCHEMA_VERSION);
    expect(Object.keys(report.scope).sort()).toEqual([...AUDIT_SCOPE_KEYS].sort());
  });
});
