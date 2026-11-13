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
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashUnit, load, PROFILE_SCHEMA_VERSION, trackableUnits } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { migrateVisibility } from "../src/commands/migrate.js";

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
    const achievements = join(ws, "content", "achievements.yaml");
    const row =
      "- id: ach\n  statement:\n    en: Shipped it\n  kind: milestone\n  basis: reported\n  visibility: private\n";
    writeFileSync(achievements, row);
    const before = readFileSync(achievements, "utf8");
    expect(migrate(ws).code).toBe(0);
    expect(readFileSync(achievements, "utf8")).toBe(before);
  });

  it("keeps deployed §19 hashes in-sync across the migration (public == the old absent state)", () => {
    const ws = workspace();
    // The stored hash a pre-D27 deployment had: the row WITHOUT the field. The
    // migration writes `visibility: public`, which must normalize to that same
    // hash — otherwise every deployed project/experience flips stale (F3 of the
    // PR #509 review).
    const legacyHash = (key: string): string => {
      const [block, id] = key.split(":") as ["projects" | "experience", string];
      const row = (load(ws)[block] ?? []).find((entry) => entry.id === id);
      if (row === undefined) throw new Error(`missing ${key}`);
      const { visibility: _visibility, ...rest } = row as Record<string, unknown> & {
        visibility?: string;
      };
      return hashUnit(rest);
    };
    const baseline = {
      "projects:sovereign-hub": legacyHash("projects:sovereign-hub"),
      "experience:nimbus": legacyHash("experience:nimbus"),
    };
    const record = (hash: string): string =>
      `  github-readme:\n    deployedAt: "2025-01-15T09:30:00Z"\n    contentHash: ${hash}\n    source: git\n`;
    writeFileSync(
      join(ws, "content", "deployments.yaml"),
      `projects:sovereign-hub:\n${record(baseline["projects:sovereign-hub"])}` +
        `experience:nimbus:\n${record(baseline["experience:nimbus"])}`,
    );

    expect(migrate(ws).code).toBe(0);
    const after = new Map(trackableUnits(load(ws)).map((unit) => [unit.key, unit.hash]));
    expect(after.get("projects:sovereign-hub")).toBe(baseline["projects:sovereign-hub"]);
    expect(after.get("experience:nimbus")).toBe(baseline["experience:nimbus"]);

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

  it("an unpublish transition changes the hash (private is not public)", () => {
    const ws = workspace();
    expect(migrate(ws).code).toBe(0);
    const before = new Map(trackableUnits(load(ws)).map((unit) => [unit.key, unit.hash]));
    const file = join(ws, "content", "experience.yaml");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "  visibility: public\n- id: dataforge",
        "  visibility: private\n- id: dataforge",
      ),
    );
    const after = new Map(trackableUnits(load(ws)).map((unit) => [unit.key, unit.hash]));
    expect(after.get("experience:nimbus")).not.toBe(before.get("experience:nimbus"));
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

  it("preserves CRLF in a file without a final newline", () => {
    const ws = workspace();
    const file = join(ws, "content", "experience.yaml");
    const crlf = readFileSync(file, "utf8").replace(/\n/g, "\r\n").replace(/\r\n$/, "");
    writeFileSync(file, crlf);
    expect(migrate(ws).code).toBe(0);
    const migrated = readFileSync(file, "utf8");
    expect(migrated.split("\r\n").join("")).not.toContain("\n");
  });

  it("migrates a multi-line flow row whose last value carries an inline comment", () => {
    const ws = workspace();
    const file = join(ws, "content", "projects.yaml");
    writeFileSync(file, "- { id: flow,\n    name: Flow # inline comment\n  }\n");
    expect(migrate(ws).code).toBe(0);
    const migrated = readFileSync(file, "utf8");
    expect(migrated).toContain("name: Flow, visibility: public # inline comment");
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

  it("still fails on a workspace that does not load when there is nothing to migrate", () => {
    const ws = workspace();
    rmSync(join(ws, "content"), { recursive: true, force: true });
    mkdirSync(join(ws, "content"));
    writeFileSync(join(ws, "content", "identity.yaml"), "name: Example\n");
    // Explicit public, so there is NO missing row; the missing `name` makes the
    // schema fail. "no migration needed" must never hide an invalid workspace.
    writeFileSync(join(ws, "content", "projects.yaml"), "- id: broken\n  visibility: public\n");
    const res = migrate(ws);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("pasco migrate:");
    expect(res.stdout).not.toContain("no migration needed");
  });

  it("never writes through a content symlink when validation fails", () => {
    const ws = workspace();
    const target = join(ws, "real-projects.yaml");
    const link = join(ws, "content", "projects.yaml");
    const invalid = "- id: needs\n  name: Needs\n- id: broken\n  visibility: public\n";
    writeFileSync(target, invalid);
    rmSync(link);
    symlinkSync(target, link);
    const res = migrate(ws);
    expect(res.code).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(invalid);
  });

  it("preserves a content symlink on success and updates its target atomically", () => {
    const ws = workspace();
    const target = join(ws, "real-projects.yaml");
    const link = join(ws, "content", "projects.yaml");
    writeFileSync(target, "- id: needs\n  name: Needs\n");
    rmSync(link);
    symlinkSync(target, link);
    expect(migrate(ws).code).toBe(0);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("visibility: public");
  });

  it("never writes through a content DIRECTORY symlink when validation fails", () => {
    const ws = workspace();
    const real = join(ws, "real-content");
    renameSync(join(ws, "content"), real);
    symlinkSync(real, join(ws, "content"));
    const target = join(real, "credentials.yaml");
    const invalid = readFileSync(target, "utf8").replace("  issuer: Amazon Web Services\n", "");
    writeFileSync(target, invalid);
    const res = migrate(ws);
    expect(res.code).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(invalid);
  });

  it("preserves a content DIRECTORY symlink on success", () => {
    const ws = workspace();
    const real = join(ws, "real-content");
    renameSync(join(ws, "content"), real);
    symlinkSync(real, join(ws, "content"));
    expect(migrate(ws).code).toBe(0);
    expect(lstatSync(join(ws, "content")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(real, "credentials.yaml"), "utf8")).toContain("visibility: public");
  });

  it("is a no-op for an already-public aliased row", () => {
    const ws = workspace();
    const file = join(ws, "content", "experience.yaml");
    const alias =
      "- &role\n  role: Engineer\n  org: Example\n  start: 2020-01-01\n  visibility: public\n- *role\n";
    writeFileSync(file, alias);
    expect(migrate(ws).code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(alias);
  });

  it("resolves an alias whose anchor still needs visibility", () => {
    const ws = workspace();
    const file = join(ws, "content", "experience.yaml");
    writeFileSync(
      file,
      "- &role\n  role: Engineer\n  org: Example\n  start: 2020-01-01\n- *role\n",
    );
    const res = run(["migrate", "--workspace", ws, "--json"]);
    expect(res.code, res.stderr).toBe(0);
    const data = JSON.parse(res.stdout) as {
      data: { migrated: { file: string; rows: number }[] };
    };
    // Two effective rows become public through ONE insertion on the anchor.
    expect(data.data.migrated.find((file) => file.file === "content/experience.yaml")?.rows).toBe(
      2,
    );
    const migrated = readFileSync(file, "utf8");
    expect(migrated.match(/visibility: public/g)?.length ?? 0).toBe(1);
    expect(load(ws).experience.every((row) => row.visibility === "public")).toBe(true);
  });

  it("bumps the floor so a second run cannot publish a newly created private row", () => {
    const ws = workspace();
    writeFileSync(
      join(ws, ".pascorc"),
      `${JSON.stringify({ workspace: ".", contract: "1.16" })}\n`,
    );
    expect(migrate(ws).code).toBe(0);
    const floor = JSON.parse(readFileSync(join(ws, ".pascorc"), "utf8")) as { contract?: string };
    expect(floor.contract).toBe("2.0");

    // Create a NEW row under the v2.0 default (omitted = private).
    const projects = join(ws, "content", "projects.yaml");
    writeFileSync(
      projects,
      `${readFileSync(projects, "utf8")}- id: new-secret\n  name: New Secret\n`,
    );

    const built = run(["build", "github-readme", "--json", "--workspace", ws]);
    expect(built.code, built.stderr).toBe(0);
    const buildData = JSON.parse(built.stdout) as { data: { notices?: string[] } };
    expect(buildData.data.notices ?? []).toEqual([]);

    const second = migrate(ws);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("intentional private default");
    expect(readFileSync(projects, "utf8")).toContain("name: New Secret");
  });

  it("warns on build only when the DECLARED floor predates v2.0", () => {
    const legacy = workspace();
    writeFileSync(
      join(legacy, ".pascorc"),
      `${JSON.stringify({ workspace: ".", contract: "1.16" })}\n`,
    );
    const built = run(["build", "github-readme", "--workspace", legacy]);
    expect(built.code, built.stderr).toBe(0);
    expect(built.stderr).toContain("pasco migrate");
    expect(built.stderr).toContain("schema v2.0");

    const v2 = workspace();
    writeFileSync(join(v2, ".pascorc"), `${JSON.stringify({ workspace: ".", contract: "2.0" })}\n`);
    const v2Build = run(["build", "github-readme", "--workspace", v2]);
    expect(v2Build.code, v2Build.stderr).toBe(0);
    // In v2.0 an omitted visibility is the intentional private default: the
    // notice would tell the user to publish hidden rows (F1 of the round-3 pass).
    expect(v2Build.stderr).not.toContain("pasco migrate");
  });

  it("re-checks the floor INSIDE the locked migration (no TOCTOU window)", () => {
    const ws = workspace();
    // The floor check lives in migrateVisibility, under the lock: a row that
    // appears while the command waits is still classified under the same floor.
    expect(() =>
      migrateVisibility(ws, { contractFloor: { declared: "2.0" }, lockWaitMs: 50 }),
    ).toThrow(/intentional private default/);
  });

  it("refuses to publish a v2.0 workspace's intentional private rows", () => {
    const ws = workspace();
    writeFileSync(join(ws, ".pascorc"), `${JSON.stringify({ workspace: ".", contract: "2.0" })}\n`);
    const before = readFileSync(join(ws, "content", "credentials.yaml"), "utf8");
    const res = migrate(ws);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("intentional private default");
    expect(readFileSync(join(ws, "content", "credentials.yaml"), "utf8")).toBe(before);
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
    expect(envelope.data.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
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
    writeFileSync(
      join(ws, ".pascorc"),
      `${JSON.stringify({ workspace: ".", contract: "1.16" })}\n`,
    );
    const before = run(["doctor", "--workspace", ws, "--contract-delta"]);
    expect(before.code).toBe(0);
    expect(before.stdout).toContain("migration — 6 row(s) still lack visibility");
    expect(before.stdout).toContain("credentials[0] (aws-ml)");
    expect(before.stdout).toContain("experience[1] (dataforge)");

    expect(migrate(ws).code).toBe(0);
    const after = run(["doctor", "--workspace", ws, "--contract-delta"]);
    expect(after.code).toBe(0);
    // A real migration also bumps the `.pascorc` floor to 2.0, so the delta's
    // migration block now says no migration is due (rather than a row count).
    expect(
      JSON.parse(readFileSync(join(ws, ".pascorc"), "utf8")) as { contract?: string },
    ).toMatchObject({ contract: "2.0" });
    expect(after.stdout).toContain("no migration is due");
  });

  it("does not advise migration for a v2.0 contract floor", () => {
    const ws = workspace();
    writeFileSync(join(ws, ".pascorc"), `${JSON.stringify({ workspace: ".", contract: "2.0" })}\n`);
    const res = run(["doctor", "--workspace", ws, "--contract-delta"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("contract floor 2.0");
    expect(res.stdout).not.toContain("run `pasco migrate` once:");
  });

  it("carries the migration block in --json only with --contract-delta", () => {
    const ws = workspace();
    writeFileSync(
      join(ws, ".pascorc"),
      `${JSON.stringify({ workspace: ".", contract: "1.16" })}\n`,
    );
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

describe("the strictest declared floor governs the refusal (D27/S4a)", () => {
  it("a legacy parent pointer cannot outvote the workspace's 2.0 floor", () => {
    const root = mkdtempSync(join(tmpdir(), "pasco-migrate-dual-"));
    const ws = join(root, "ws");
    cpSync(FIXTURE, ws, { recursive: true });
    writeFileSync(join(ws, ".pascorc"), `${JSON.stringify({ workspace: ".", contract: "2.0" })}\n`);
    writeFileSync(
      join(root, ".pascorc"),
      `${JSON.stringify({ workspace: "ws", contract: "1.16" })}\n`,
    );
    const credentials = join(ws, "content", "credentials.yaml");
    const before = readFileSync(credentials, "utf8");

    const migrated = run(["migrate"], root);
    expect(migrated.code).toBe(1);
    expect(migrated.stderr).toContain("intentional private default");
    expect(readFileSync(credentials, "utf8")).toBe(before);

    const built = run(["build", "github-readme", "--json"], root);
    expect(built.code, built.stderr).toBe(0);
    const buildData = JSON.parse(built.stdout) as { data: { notices?: string[] } };
    expect(buildData.data.notices ?? []).toEqual([]);

    const doctor = run(["doctor", "--contract-delta"], root);
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).toContain("no migration is due");
  });
});

describe("the contract-floor policy table (D27/S4a)", () => {
  const cases = [
    { name: "absent", floor: undefined, kind: "legacy" as const },
    { name: "INVALID", floor: "latest", kind: "unknown" as const },
    { name: "< 2.0", floor: "1.16", kind: "legacy" as const },
    { name: "== 2.0", floor: "2.0", kind: "current" as const },
    { name: "> 2.0", floor: "3.0", kind: "current" as const },
  ];

  for (const testCase of cases) {
    it(`floor ${testCase.name}: build/preview/doctor/migrate agree`, () => {
      const ws = workspace();
      if (testCase.floor !== undefined) {
        writeFileSync(
          join(ws, ".pascorc"),
          `${JSON.stringify({ workspace: ".", contract: testCase.floor })}\n`,
        );
      }

      const build = run(["build", "github-readme", "--workspace", ws, "--json"]);
      expect(build.code, build.stderr).toBe(0);
      const buildData = JSON.parse(build.stdout) as { data: { notices?: string[] } };
      const notices = buildData.data.notices ?? [];

      const out = mkdtempSync(join(tmpdir(), "pasco-migrate-preview-"));
      const preview = run(["preview", "--workspace", ws, "--no-open", "--out", out, "--json"]);
      expect(preview.code, preview.stderr).toBe(0);
      const previewData = JSON.parse(preview.stdout) as { data: { warnings: string[] } };

      const doctor = run(["doctor", "--workspace", ws, "--contract-delta"]);
      expect(doctor.code).toBe(0);

      const migrated = migrate(ws);

      if (testCase.kind === "legacy") {
        expect(notices.join("\n")).toContain("pasco migrate");
        expect(previewData.data.warnings.join("\n")).toContain("pasco migrate");
        expect(doctor.stdout).toContain("run `pasco migrate` once");
        expect(migrated.code, migrated.stderr).toBe(0);
      } else if (testCase.kind === "unknown") {
        expect(notices.join("\n")).toContain("INVALID");
        expect(notices.join("\n")).not.toContain("run `pasco migrate` once");
        expect(previewData.data.warnings.join("\n")).toContain("INVALID");
        expect(doctor.stdout).toContain("contract floor INVALID");
        expect(migrated.code).toBe(1);
        expect(migrated.stderr).toContain("INVALID");
      } else {
        expect(notices).toEqual([]);
        expect(previewData.data.warnings).toEqual([]);
        expect(doctor.stdout).toContain("no migration is due");
        expect(migrated.code).toBe(1);
        expect(migrated.stderr).toContain("intentional private default");
      }
    });
  }
});

describe("pasco migrate --facts-dir (D30)", () => {
  it("renames the legacy content/ to facts/ and the migrated paths report facts/", () => {
    const dir = workspace();
    const res = run(["migrate", "--facts-dir", "--workspace", dir]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("renamed content/ -> facts/ (D30)");
    expect(existsSync(join(dir, "facts", "credentials.yaml"))).toBe(true);
    expect(existsSync(join(dir, "content"))).toBe(false);
    expect(res.stdout).toContain("facts/credentials.yaml");
  });

  it("is idempotent — a workspace already on facts/ is not renamed again", () => {
    const dir = workspace();
    expect(run(["migrate", "--facts-dir", "--workspace", dir]).code).toBe(0);
    const second = run(["migrate", "--facts-dir", "--workspace", dir]);
    expect(second.code).toBe(0);
    expect(second.stdout).not.toContain("renamed");
    expect(existsSync(join(dir, "facts"))).toBe(true);
  });

  it("without --facts-dir a legacy workspace keeps its directory name", () => {
    const dir = workspace();
    const res = run(["migrate", "--workspace", dir]);
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("renamed");
    expect(existsSync(join(dir, "content"))).toBe(true);
    expect(existsSync(join(dir, "facts"))).toBe(false);
  });
});
