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

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { AUDIT_SCHEMA_VERSION, runAudit } from "../src/commands/audit.js";
import { runBuild } from "../src/commands/build.js";
import { runCheck } from "../src/commands/check.js";
import { type JsonEnvelope, setJsonMode } from "../src/output.js";
import type { Pascorc } from "../src/workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures", "audit");
const INVALID = join(__dirname, "fixtures", "invalid");
const COMPLETE = join(__dirname, "..", "..", "core", "tests", "fixtures", "complete");

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

function audit(workspace: string) {
  return json(() => runAudit({ workspace, pascorc: PASCO }));
}

function check(workspace: string, platform?: string) {
  return json(() =>
    runCheck({ workspace, pascorc: PASCO, ...(platform ? { platformArg: platform } : {}) }),
  );
}

interface Finding {
  class: string;
  severity: string;
  path: string;
  detail: string;
}

describe("pasco audit — the frozen output contract (SPEC §7.1)", () => {
  it("emits findings only: the frozen schemaVersion, and no score anywhere", () => {
    const { code, data, out } = audit(join(FIXTURES, "unsourced-claim"));
    expect(code).toBe(0);
    const report = data as { schemaVersion: string; findings: Finding[] };
    expect(Object.keys(report).sort()).toEqual(["findings", "schemaVersion"]);
    expect(report.schemaVersion).toBe("1");
    expect(report.schemaVersion).toBe(AUDIT_SCHEMA_VERSION);
    expect(report.findings).toHaveLength(1);
    const [finding] = report.findings;
    expect(Object.keys(finding ?? {}).sort()).toEqual(["class", "detail", "path", "severity"]);
    // Findings only: a score, percentage or ranking token would breach the module
    // boundary the contract exists to keep.
    expect(out).not.toMatch(/"(score|percent|percentage|rank|priority)"/);
  });

  it("dangling-ref: a project link outside identity.links FAILs at exit 1", () => {
    const { code, data } = audit(join(FIXTURES, "dangling-ref"));
    expect(code).toBe(1);
    const findings = (data as { findings: Finding[] }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      class: "dangling-ref",
      severity: "FAIL",
      // factRef grammar: the row ID replaces the array index when declared.
      path: "projects[hub].links[0]",
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
});

describe("fact-present — the surface's facts vs the SSOT (issue #283)", () => {
  it("is green on a freshly built artifact and names the surfaces it compared", () => {
    const ws = copy(COMPLETE);
    json(() => runBuild({ workspace: ws, pascorc: PASCO }));
    const { code, data } = check(ws);
    expect(code).toBe(0);
    const facts = (
      data as { factPresent: { checked: string[]; notRun: string[]; findings: Finding[] } }
    ).factPresent;
    expect(facts.checked).toContain("github-readme");
    expect(facts.notRun).toEqual([]);
    expect(facts.findings).toEqual([]);
  });

  it("reports NOT RUN when no artifact exists — absence is never OK", () => {
    const ws = copy(COMPLETE);
    const { data } = check(ws);
    const facts = (data as { factPresent: { checked: string[]; notRun: string[] } }).factPresent;
    expect(facts.checked).toEqual([]);
    expect(facts.notRun).toEqual([]); // nothing built, nothing in scope
    const human = json(() =>
      runCheck({ workspace: ws, pascorc: PASCO, platformArg: "github-readme" }),
    );
    const named = (human.data as { factPresent: { notRun: string[] } }).factPresent;
    expect(named.notRun).toEqual(["github-readme"]);
  });

  it("classifies every tampered fact token — URL, date, number — and fails the audit", () => {
    const ws = copy(COMPLETE);
    json(() => runBuild({ workspace: ws, pascorc: PASCO }));
    const artifact = join(ws, "profiles", "github-readme", "README.md");
    const original = readFileSync(artifact, "utf8");
    writeFileSync(
      artifact,
      original
        .replace("https://example.com/verify/aws-ml", "https://example.com/verify/aws-OLD")
        .replace('"validFrom": "2021-06-01"', '"validFrom": "2019-06-01"')
        .replace("40 universities", "400 universities"),
      "utf8",
    );

    const checked = check(ws);
    expect(checked.code).toBe(0); // facts warn in `check` (D12)
    const findings = (checked.data as { factPresent: { findings: Finding[] } }).factPresent
      .findings;
    expect(findings.map((finding) => finding.class).sort()).toEqual([
      "contradiction",
      "dangling-ref",
      "unsourced-claim",
    ]);

    const audited = audit(ws);
    expect(audited.code).toBe(1); // two FAIL classes
    const auditFindings = (audited.data as { findings: Finding[] }).findings;
    expect(auditFindings.map((finding) => finding.class).sort()).toEqual([
      "contradiction",
      "dangling-ref",
      "unsourced-claim",
    ]);
    expect(
      auditFindings
        .filter((finding) => finding.severity === "FAIL")
        .map((finding) => finding.class),
    ).not.toContain("unsourced-claim");
    // The finding addresses the surface artifact: a fact absent from the SSOT has
    // no factRef by definition.
    expect(
      auditFindings.every((finding) => finding.path === "profiles/github-readme/README.md"),
    ).toBe(true);
  });
});

describe("audit is a leaf — no command depends on it", () => {
  it("build/check/validate never import the audit command", () => {
    for (const name of ["build", "check", "validate"]) {
      const source = readFileSync(join(__dirname, "..", "src", "commands", `${name}.ts`), "utf8");
      expect(source).not.toMatch(/commands\/audit|from "\.\/audit/);
    }
  });
});
