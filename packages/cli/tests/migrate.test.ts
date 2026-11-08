/**
 * `pasco migrate` — the schema v2.0 visibility migration (D27, issue #498, S4a).
 *
 * What this file pins:
 *  - an existing (pre-v2.0) workspace gets `visibility: public` on every
 *    credentials/artifacts/projects/experience row that lacks the field;
 *  - comments, alignment and every other byte survive (a source splice, never a
 *    re-serialization), and a row that already declares a value is untouched;
 *  - the command is idempotent: a second run writes nothing;
 *  - `achievements` is never touched (its visibility is required);
 *  - the GOLDEN non-regression: after migration the github-readme artifact is
 *    byte-identical to the pre-D27 output captured from the same fixture;
 *  - `doctor --contract-delta` reports the rows still missing the field, before
 *    and after the migration.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load, trackableUnits } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "fixtures", "migrate");
const GOLDEN = readFileSync(join(FIXTURE, "readme.golden.md"), "utf8");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd?: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    timeout: 20_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tempDirs: string[] = [];
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-migrate-"));
  tempDirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function bytes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(join(dir, "content")).sort()) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    out[name] = readFileSync(join(dir, "content", name), "utf8");
  }
  return out;
}

function migrate(ws: string): RunResult {
  return run(["migrate", "--workspace", ws]);
}

describe("pasco migrate (D27, schema v2.0)", () => {
  it("writes `visibility: public` on every row that lacks it, preserving comments and layout", () => {
    const ws = workspace();
    const res = migrate(ws);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain("migrated 1 row(s) — content/credentials.yaml");
    expect(res.stdout).toContain("migrated 1 row(s) — content/artifacts.yaml");
    expect(res.stdout).toContain("migrated 2 row(s) — content/projects.yaml");
    expect(res.stdout).toContain("migrated 2 row(s) — content/experience.yaml");

    const credentials = readFileSync(join(ws, "content", "credentials.yaml"), "utf8");
    // The comment block and the trailing inline comment are untouched.
    expect(credentials).toContain("# Credentials: third-party attestations.");
    expect(credentials).toContain("issued: 2021-06-01 # the credential's issue date");
    // The first row gained the field; the private row is untouched.
    expect(credentials).toContain(
      "  issued: 2021-06-01 # the credential's issue date\n  visibility: public",
    );
    expect(credentials).toContain("  issuer: Nimbus Labs\n  visibility: private");
    expect(credentials.match(/visibility: public/g)?.length ?? 0).toBe(1);

    const projects = readFileSync(join(ws, "content", "projects.yaml"), "utf8");
    expect(projects.match(/visibility: public/g)?.length ?? 0).toBe(2);
    // The inserted line uses the row's own indentation (2 spaces).
    expect(projects).toMatch(/\n {2}visibility: public/);
  });

  it("is idempotent — a second run writes nothing and every byte is identical", () => {
    const ws = workspace();
    expect(migrate(ws).code).toBe(0);
    const before = bytes(ws);
    const res = migrate(ws);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("no migration needed");
    expect(bytes(ws)).toEqual(before);
  });

  it("does not touch achievements (its visibility is required, not migrated)", () => {
    const ws = workspace();
    expect(migrate(ws).code).toBe(0);
    // The fixture ships no achievements file; the assertion is that migrate
    // creates none (it only edits the four migration blocks).
    expect(readdirSync(join(ws, "content"))).not.toContain("achievements.yaml");
  });

  it("keeps §19 deploy hashes in-sync — visibility is a publication gate, not content", () => {
    const ws = workspace();
    const units = (): Map<string, string> =>
      new Map(trackableUnits(load(ws)).map((unit) => [unit.key, unit.hash]));
    const before = units();
    // A real pre-migration ledger: the hashes the deployed rows had WITHOUT the
    // explicit field. Writing them back lets `pasco status` judge the migrated
    // workspace, not just the hash function (F3 of the PR #509 review).
    const record = (hash: string): string =>
      `  github-readme:\n    deployedAt: "2025-01-15T09:30:00Z"\n    contentHash: ${hash}\n    source: git\n`;
    writeFileSync(
      join(ws, "content", "deployments.yaml"),
      `projects:sovereign-hub:\n${record(before.get("projects:sovereign-hub") ?? "")}` +
        `experience:nimbus:\n${record(before.get("experience:nimbus") ?? "")}`,
    );

    expect(migrate(ws).code).toBe(0);
    const after = units();
    expect(after.get("projects:sovereign-hub")).toBe(before.get("projects:sovereign-hub"));
    expect(after.get("experience:nimbus")).toBe(before.get("experience:nimbus"));
    expect(after.get("experience:dataforge")).toBe(before.get("experience:dataforge"));

    const status = run(["status", "--workspace", ws, "--json"]);
    expect(status.code, status.stderr).toBe(0);
    const data = JSON.parse(status.stdout) as {
      data: { units: { key: string; state: string }[] };
    };
    expect(data.data.units.find((unit) => unit.key === "projects:sovereign-hub")?.state).toBe(
      "in-sync",
    );
    expect(data.data.units.find((unit) => unit.key === "experience:nimbus")?.state).toBe("in-sync");
  });

  it("preserves CRLF line endings (no mixed EOL after the splice)", () => {
    const ws = workspace();
    const file = join(ws, "content", "experience.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
    expect(migrate(ws).code).toBe(0);
    const migrated = readFileSync(file, "utf8");
    expect(migrated).toContain("  visibility: public\r\n");
    // Remove the CRLF pairs: any remaining LF would be a mixed line ending.
    expect(migrated.split("\r\n").join("")).not.toContain("\n");
  });

  it("migrates a flow row without a space before the comma", () => {
    const ws = workspace();
    const file = join(ws, "content", "projects.yaml");
    writeFileSync(file, "- { id: flow, name: Flow }\n");
    expect(migrate(ws).code).toBe(0);
    const migrated = readFileSync(file, "utf8");
    expect(migrated).toContain("{ id: flow, name: Flow, visibility: public }");
    expect(migrated).not.toContain(" , visibility");
  });

  it("reports its work in the standard envelope", () => {
    const ws = workspace();
    const res = run(["migrate", "--workspace", ws, "--json"]);
    expect(res.code).toBe(0);
    const envelope = JSON.parse(res.stdout) as {
      command: string;
      ok: boolean;
      data: {
        schemaVersion: string;
        rows: number;
        migrated: { file: string; rows: number }[];
        missing: unknown[];
      };
    };
    expect(envelope.command).toBe("migrate");
    expect(envelope.ok).toBe(true);
    expect(envelope.data.schemaVersion).toBe("2.0");
    expect(envelope.data.rows).toBe(6);
    expect(envelope.data.missing).toEqual([]);
    expect(envelope.data.migrated).toContainEqual({ file: "content/experience.yaml", rows: 2 });
  });

  it("GOLDEN: the migrated workspace renders the pre-D27 github-readme byte-for-byte", () => {
    const ws = workspace();
    expect(migrate(ws).code).toBe(0);
    const built = run(["build", "github-readme", "--workspace", ws]);
    expect(built.code, built.stderr).toBe(0);
    const readme = readFileSync(join(ws, "profiles", "github-readme", "README.md"), "utf8");
    expect(readme).toBe(GOLDEN);
  });

  it("refuses without writing when the migrated workspace would not load", () => {
    const ws = workspace();
    const before = bytes(ws);
    // A schema-invalid row (a credential without its required issuer) makes the
    // whole content/ fail the same load() gate every write goes through.
    const file = join(ws, "content", "credentials.yaml");
    const broken = readFileSync(file, "utf8").replace("  issuer: Amazon Web Services\n", "");
    writeFileSync(file, broken);
    const res = migrate(ws);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("pasco migrate:");
    // The invalid input file is the only change; no visibility was written.
    expect(bytes(ws)["experience.yaml"]).toBe(before["experience.yaml"]);
  });
});

describe("pasco doctor --contract-delta reports unmigrated rows (D27)", () => {
  it("names every row that still lacks visibility, then reports zero after migrate", () => {
    const ws = workspace();
    const before = run(["doctor", "--workspace", ws, "--contract-delta"]);
    expect(before.code).toBe(0);
    expect(before.stdout).toContain("migration — 6 row(s) still lack visibility");
    expect(before.stdout).toContain("credentials[0] (aws-ml)");
    expect(before.stdout).toContain("experience[1] (dataforge)");

    expect(migrate(ws).code).toBe(0);
    const after = run(["doctor", "--workspace", ws, "--contract-delta"]);
    expect(after.code).toBe(0);
    expect(after.stdout).toContain(
      "migration — every credentials/artifacts/projects/experience row declares visibility",
    );
  });

  it("carries the migration block in --json only with --contract-delta", () => {
    const ws = workspace();
    const withFlag = run(["doctor", "--workspace", ws, "--contract-delta", "--json"]);
    const envelope = JSON.parse(withFlag.stdout) as {
      data: {
        contractDelta: {
          migration: { total: number; rows: { block: string; index: number; id?: string }[] };
        };
      };
    };
    expect(envelope.data.contractDelta.migration.total).toBe(6);
    expect(envelope.data.contractDelta.migration.rows).toContainEqual({
      block: "projects",
      index: 0,
      id: "sovereign-hub",
    });

    const withoutFlag = run(["doctor", "--workspace", ws, "--json"]);
    const plain = JSON.parse(withoutFlag.stdout) as { data: Record<string, unknown> };
    expect(plain.data.contractDelta).toBeUndefined();
  });
});
