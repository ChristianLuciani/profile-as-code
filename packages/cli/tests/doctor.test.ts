/**
 * `pasco doctor` + the `.pascorc` engine-version gate (SPEC §7.6, #348).
 *
 * What this file pins:
 *  - `doctor` reports engine · schema · workspace in ONE line, and its `--json`
 *    view inside the standard envelope;
 *  - `validate`, `build` and `export profile` fail EARLY — before loading or
 *    rendering — when `.pascorc.engine` is newer than the installed CLI, with
 *    the three facts (installed, required, upgrade command);
 *  - the declared field syntax and its failure modes: an equal or older
 *    requirement passes, an absent one is not a gate, and a malformed value is
 *    refused (never coerced) with the expected `MAJOR.MINOR.PATCH` form;
 *  - the exit matrix: 0 healthy, 1 unhealthy/unmet/malformed, 2 usage.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  compareEngineVersions,
  evaluateEngineRequirement,
  evaluateEngineRequirements,
  parseEngineVersion,
  parseInstalledVersion,
} from "../src/engine-gate.js";
import type { Pascorc } from "../src/workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const REPO_ROOT = join(__dirname, "..", "..", "..");
const FIXTURE = join(__dirname, "fixtures", "export-profile");
const SCHEMA = join(REPO_ROOT, "schema", "profile.schema.json");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd?: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    timeout: 15_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tempDirs: string[] = [];
function workspaceCopy(engine?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-doctor-"));
  tempDirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  // The fixture has no `.pascorc`; the gate's subject is the workspace file, so
  // every case writes exactly one (or deliberately none).
  if (engine !== undefined) {
    writeFileSync(join(dir, ".pascorc"), `${JSON.stringify({ workspace: ".", engine })}\n`);
  }
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * A cwd `.pascorc` that RESOLVES the workspace (`"workspace": "ws"`), with the
 * workspace in a subdirectory — the fresh-review F1 repro shape. `cwdEngine` is
 * the pointer file's declaration; `workspaceEngine` writes the workspace's own
 * `.pascorc` too (absent = only the pointer file declares).
 */
function pointerWorkspace(
  cwdEngine?: unknown,
  workspaceEngine?: unknown,
): { cwd: string; ws: string } {
  const cwd = mkdtempSync(join(tmpdir(), "pasco-doctor-pointer-"));
  tempDirs.push(cwd);
  const ws = join(cwd, "ws");
  mkdirSync(ws);
  cpSync(FIXTURE, ws, { recursive: true });
  writeFileSync(
    join(cwd, ".pascorc"),
    `${JSON.stringify({ workspace: "ws", ...(cwdEngine === undefined ? {} : { engine: cwdEngine }) })}\n`,
  );
  if (workspaceEngine !== undefined) {
    writeFileSync(
      join(ws, ".pascorc"),
      `${JSON.stringify({ workspace: ".", engine: workspaceEngine })}\n`,
    );
  }
  return { cwd, ws };
}

function packageVersion(): string {
  return (
    JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
}

function schemaVersion(): string {
  const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as { $id: string };
  const match = /\/v(\d+\.\d+)\/profile\.schema\.json$/.exec(schema.$id);
  if (match === null) throw new Error(`schema $id carries no version: ${schema.$id}`);
  return match[1] as string;
}

interface Envelope {
  command: string;
  ok: boolean;
  exitCode: number;
  data?: {
    engine: { name: string; version: string };
    schema: { version: string };
    workspace: {
      path: string;
      valid: boolean;
      error?: { kind: string; message: string; violations?: { path: string; message: string }[] };
    };
    requirement: { declared: string | null; met: boolean; problem?: string; source?: string };
  };
  error?: { kind: string; message: string };
}

function doctor(args: string[], workspace?: string): Envelope {
  const res = run([
    "doctor",
    "--json",
    ...(workspace === undefined ? [] : ["--workspace", workspace]),
    ...args,
  ]);
  return { ...(JSON.parse(res.stdout) as Envelope), exitCode: res.code };
}

describe("pasco doctor — engine · schema · workspace", () => {
  it("reports the three facts on ONE line and exits 0 for a healthy workspace", () => {
    const dir = workspaceCopy();
    const res = run(["doctor", "--workspace", dir]);
    expect(res.code).toBe(0);
    const lines = res.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`engine ${packageVersion()}`);
    expect(lines[0]).toContain(`schema v${schemaVersion()}`);
    expect(lines[0]).toContain(`workspace ${dir} (valid)`);
    expect(lines[0]).toContain("no engine requirement");
  });

  it("emits the frozen --json view inside the standard envelope", () => {
    const dir = workspaceCopy();
    const envelope = doctor([], dir);
    expect(envelope.command).toBe("doctor");
    expect(envelope.ok).toBe(true);
    expect(envelope.exitCode).toBe(0);
    expect(envelope.data?.engine).toEqual({
      name: "@profile-as-code/cli",
      version: packageVersion(),
    });
    // The schema label is the contract's own `$id` version, not a CLI literal.
    expect(envelope.data?.schema.version).toBe(schemaVersion());
    expect(envelope.data?.workspace).toEqual({ path: dir, valid: true });
    expect(envelope.data?.requirement).toEqual({ declared: null, met: true });
  });

  it("reports a workspace that does not load and exits 1", () => {
    const dir = workspaceCopy();
    rmSync(join(dir, "content", "identity.yaml"), { force: true });
    const res = run(["doctor", "--workspace", dir]);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("(invalid: schema —");
    const envelope = doctor([], dir);
    expect(envelope.ok).toBe(false);
    expect(envelope.exitCode).toBe(1);
    expect(envelope.data?.workspace.valid).toBe(false);
    expect(envelope.data?.workspace.error?.kind).toBe("schema");
  });
});

describe("the .pascorc engine-version gate", () => {
  it("does not gate when the field is absent", () => {
    const dir = workspaceCopy();
    for (const command of [["validate"], ["build"], ["export", "profile", "--json"]]) {
      expect(run([...command, "--workspace", dir]).code).toBe(0);
    }
  });

  it("accepts a requirement the installed engine meets (equal and older)", () => {
    const current = packageVersion();
    for (const engine of [current, "0.0.1"]) {
      const dir = workspaceCopy(engine);
      expect(run(["validate", "--workspace", dir]).code).toBe(0);
    }
  });

  it("fails validate/build/export profile EARLY with installed, required and upgrade", () => {
    const dir = workspaceCopy("9.0.0");
    // Human mode: the refusal is the ONLY output — the command did no work.
    for (const command of [["validate"], ["build"]]) {
      const res = run([...command, "--workspace", dir]);
      expect(res.code, command.join(" ")).toBe(1);
      expect(res.stderr).toContain(packageVersion());
      expect(res.stderr).toContain("9.0.0");
      expect(res.stderr).toContain("npm i -g @profile-as-code/cli@latest");
      expect(res.stdout, "the command did no work — no payload on stdout").toBe("");
    }
    // The JSON command fails before emitting any payload/data.
    const json = run(["export", "profile", "--json", "--workspace", dir]);
    expect(json.code).toBe(1);
    const envelope = JSON.parse(json.stdout) as Envelope;
    expect(envelope.data).toBeUndefined();
    expect(envelope.error?.kind).toBe("engine");
  });

  it("puts the same three facts inside the --json error", () => {
    const dir = workspaceCopy("9.0.0");
    const res = run(["export", "profile", "--json", "--workspace", dir]);
    expect(res.code).toBe(1);
    const envelope = JSON.parse(res.stdout) as Envelope;
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.kind).toBe("engine");
    expect(envelope.error?.message).toContain(packageVersion());
    expect(envelope.error?.message).toContain("9.0.0");
    expect(envelope.error?.message).toContain("npm i -g @profile-as-code/cli@latest");
  });

  it("refuses a malformed requirement with the accepted syntax (never coerced)", () => {
    for (const engine of ["v9.0.0", "^9.0.0", "9.0", "9.0.0.1", "nine", 9]) {
      const dir = workspaceCopy(engine);
      const res = run(["validate", "--workspace", dir]);
      expect(res.code, JSON.stringify(engine)).toBe(1);
      expect(res.stderr).toContain("MAJOR.MINOR.PATCH");
      expect(res.stderr).toContain(JSON.stringify(engine));
      // The upgrade command is meaningless for a grammar error — it is not printed.
      expect(res.stderr).not.toContain("npm i -g @profile-as-code/cli@latest");
    }
  });

  it("doctor reports an unmet requirement and exits 1", () => {
    const dir = workspaceCopy("9.0.0");
    const res = run(["doctor", "--workspace", dir]);
    expect(res.code).toBe(1);
    expect(res.stdout.trim().split("\n")).toHaveLength(1);
    expect(res.stdout).toContain("requires engine >= 9.0.0 (NOT MET");
    expect(res.stdout).toContain("npm i -g @profile-as-code/cli@latest");
    const envelope = doctor([], dir);
    expect(envelope.ok).toBe(false);
    expect(envelope.data?.requirement).toMatchObject({
      declared: "9.0.0",
      met: false,
      source: join(dir, ".pascorc"),
    });
  });

  it("doctor reports a malformed requirement and exits 1", () => {
    const dir = workspaceCopy("^9.0.0");
    const res = run(["doctor", "--workspace", dir]);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("engine requirement INVALID");
    expect(res.stdout).toContain("MAJOR.MINOR.PATCH");
    const envelope = doctor([], dir);
    expect(envelope.data?.requirement.met).toBe(false);
    expect(envelope.data?.requirement.problem).toContain("MAJOR.MINOR.PATCH");
  });

  it('refuses a null requirement without reporting the string "null" (F1 nit)', () => {
    const dir = workspaceCopy(null);
    const res = run(["doctor", "--workspace", dir]);
    expect(res.code).toBe(1);
    expect(res.stdout).not.toContain("no engine requirement");
    expect(res.stdout).toContain("engine requirement INVALID");
    const envelope = doctor([], dir);
    expect(envelope.data?.requirement.declared).toBeNull();
    expect(envelope.data?.requirement.problem).toContain("null");
  });

  it("enforces a requirement declared in the cwd .pascorc that RESOLVED the workspace (F1)", () => {
    // The exact repro: `.pascorc` at cwd declares the workspace AND the engine;
    // the workspace has no `.pascorc` of its own. Reading only the workspace file
    // silently dropped the declaration.
    const { cwd } = pointerWorkspace("9.0.0");
    for (const command of [["validate"], ["build"], ["export", "profile", "--json"]]) {
      const res = run(command, cwd);
      expect(res.code, command.join(" ")).toBe(1);
      expect(`${res.stdout}${res.stderr}`).toContain("9.0.0");
    }
    const doc = run(["doctor"], cwd);
    expect(doc.code).toBe(1);
    expect(doc.stdout).toContain("requires engine >= 9.0.0 (NOT MET");
    const envelope = JSON.parse(run(["doctor", "--json"], cwd).stdout) as Envelope;
    expect(envelope.data?.requirement).toMatchObject({
      declared: "9.0.0",
      met: false,
      source: realpathSync(join(cwd, ".pascorc")),
    });
  });

  it("enforces the workspace's own declaration when the pointer file has none (F1)", () => {
    const { cwd, ws } = pointerWorkspace(undefined, "9.0.0");
    expect(run(["validate"], cwd).code).toBe(1);
    const envelope = JSON.parse(run(["doctor", "--json"], cwd).stdout) as Envelope;
    expect(envelope.data?.requirement).toMatchObject({
      declared: "9.0.0",
      met: false,
      source: realpathSync(join(ws, ".pascorc")),
    });
  });

  it("the STRICTER of two declarations wins, and doctor names that file (F1)", () => {
    const pointerStricter = pointerWorkspace("9.0.0", "0.1.0");
    expect(run(["validate"], pointerStricter.cwd).code).toBe(1);
    expect(
      (JSON.parse(run(["doctor", "--json"], pointerStricter.cwd).stdout) as Envelope).data
        ?.requirement,
    ).toMatchObject({
      declared: "9.0.0",
      source: realpathSync(join(pointerStricter.cwd, ".pascorc")),
    });

    const workspaceStricter = pointerWorkspace("0.1.0", "9.0.0");
    expect(run(["validate"], workspaceStricter.cwd).code).toBe(1);
    expect(
      (JSON.parse(run(["doctor", "--json"], workspaceStricter.cwd).stdout) as Envelope).data
        ?.requirement,
    ).toMatchObject({
      declared: "9.0.0",
      source: realpathSync(join(workspaceStricter.ws, ".pascorc")),
    });

    // Both satisfied: the gate passes.
    const bothMet = pointerWorkspace("0.0.1", "0.0.2");
    expect(run(["validate"], bothMet.cwd).code).toBe(0);
  });

  it("an explicit --workspace bypasses the cwd pointer config (D14)", () => {
    const { cwd, ws } = pointerWorkspace("9.0.0");
    expect(run(["validate", "--workspace", ws], cwd).code).toBe(0);
    const envelope = JSON.parse(
      run(["doctor", "--json", "--workspace", ws], cwd).stdout,
    ) as Envelope;
    expect(envelope.data?.requirement).toEqual({ declared: null, met: true });
  });

  it("is usage (exit 2) for an extra positional or an unknown flag", () => {
    expect(run(["doctor", "extra"]).code).toBe(2);
    expect(run(["doctor", "--nope"]).code).toBe(2);
  });
});

describe("engine-gate units (the declared grammar)", () => {
  it("compares numeric triples and parses an installed pre-release suffix", () => {
    expect(parseEngineVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseEngineVersion("v1.2.3")).toBeNull();
    expect(parseInstalledVersion("1.2.3-rc.1")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(compareEngineVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareEngineVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareEngineVersions("1.2.3", "1.2.3")).toBe(0);
    // A requirement is a MINIMUM: equal passes, one patch below is refused.
    expect(evaluateEngineRequirement({ engine: "1.2.3" }, "1.2.3").met).toBe(true);
    expect(evaluateEngineRequirement({ engine: "1.2.4" }, "1.2.3").met).toBe(false);
    expect(evaluateEngineRequirement({}, "0.0.0")).toEqual({ declared: null, met: true });
  });

  it("combines every consulted .pascorc: the strictest wins, malformed refuses", () => {
    const met = { declared: null, met: true };
    expect(evaluateEngineRequirements([], "0.3.6")).toEqual(met);
    expect(
      evaluateEngineRequirements(
        [
          { pascorc: { engine: "0.1.0" }, pascorcPath: "/a/.pascorc" },
          { pascorc: { engine: "9.0.0" }, pascorcPath: "/b/.pascorc" },
        ],
        "0.3.6",
      ),
    ).toEqual({ declared: "9.0.0", met: false, source: "/b/.pascorc" });
    // A malformed declaration in ANY file is refused, even when another is met.
    const malformed = evaluateEngineRequirements(
      [
        { pascorc: { engine: "0.1.0" }, pascorcPath: "/a/.pascorc" },
        { pascorc: { engine: "nope" }, pascorcPath: "/b/.pascorc" },
      ],
      "0.3.6",
    );
    expect(malformed.met).toBe(false);
    expect(malformed.problem).toContain("MAJOR.MINOR.PATCH");
    expect(malformed.source).toBe("/b/.pascorc");
    // `engine: null` is a shape error, never the string "null".
    const nullDecl = evaluateEngineRequirement({ engine: null } as unknown as Pascorc, "0.3.6");
    expect(nullDecl.declared).toBeNull();
    expect(nullDecl.problem).toContain("null");
  });
});
