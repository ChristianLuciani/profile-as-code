/**
 * The engine floor is declared at BIRTH and the old-engine failure names the
 * upgrade (#434).
 *
 * Two premises the issue observed on real workspaces, pinned here:
 *  1. `pasco init` writes `"engine": "<installed version>"` into `.pascorc`, so
 *     a workspace born from the scaffold cannot have the floor off by default;
 *     the scaffold then meets its own floor (`validate` exits 0).
 *  2. A schema failure on an `Unrecognized key` with no declared floor adds ONE
 *     hint line naming the likely cause and the remedy. The verdict is
 *     unchanged (`exit 1`, same violations) and the hint does not fire when a
 *     floor is declared or when the failure is something else.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { unrecognizedKeyHint } from "../src/commands/validate.js";
import { engineFloorFor } from "../src/engine-gate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string }
).version;

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-engine-floor-"));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    ...(cwd === undefined ? {} : { cwd }),
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function scaffold(flavor?: "brand"): string {
  const dir = join(tempDir(), "ws");
  const args = flavor === undefined ? ["init", dir] : ["init", "--flavor", flavor, dir];
  const result = run(args);
  expect(result.code).toBe(0);
  return dir;
}

function readPascorc(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, ".pascorc"), "utf8")) as Record<string, unknown>;
}

function writePascorc(dir: string, value: Record<string, unknown>): void {
  writeFileSync(join(dir, ".pascorc"), `${JSON.stringify(value, null, 2)}\n`);
}

/** An old workspace: born before `init` declared the floor. */
function removeFloor(dir: string): void {
  const pascorc = readPascorc(dir);
  delete pascorc.engine;
  writePascorc(dir, pascorc);
}

/** A contract field this engine does not know — the issue's failure shape. */
function addUnrecognizedKey(dir: string): void {
  writeFileSync(
    join(dir, "content", "identity.yaml"),
    'name: Test Person\nbogusField: "this engine does not know this key"\n',
  );
}

function hintLines(stderr: string): string[] {
  return stderr.split("\n").filter((line) => line.startsWith("hint:"));
}

describe("pasco init declares the engine floor at birth (#434)", () => {
  for (const flavor of [undefined, "brand"] as const) {
    it(`writes engine = the installed CLI version (${flavor ?? "person"})`, () => {
      const dir = scaffold(flavor);
      const pascorc = readPascorc(dir);
      // The declaration is the gate's grammar (normalized), not the raw
      // manifest string: a pre-release build declares nothing at all (#434 F3).
      expect(pascorc.engine).toBe(engineFloorFor(PACKAGE_VERSION));
      expect(pascorc.workspace).toBe(".");
    });
  }

  it("the scaffolded workspace meets its own floor", () => {
    const dir = scaffold();
    const res = run(["validate", "--workspace", dir]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("valid");
  });

  it("a pre-release build declares NO floor instead of pinning an unreleased version", () => {
    // Stripping the suffix would declare `0.4.0` while `@latest` is 0.3.7 — a
    // floor the published engine cannot meet. The raw string would violate the
    // declaration grammar. Absent is the honest state (doctor names it, #436).
    expect(engineFloorFor("0.4.0-rc.1")).toBeNull();
    expect(engineFloorFor(`${PACKAGE_VERSION}-next.1`)).toBeNull();
    expect(engineFloorFor("0.3.7")).toBe("0.3.7");
    expect(engineFloorFor("not-a-version")).toBeNull();
  });
});

describe("an Unrecognized key with no declared floor names the upgrade (#434)", () => {
  it("adds ONE hint line and keeps the verdict at exit 1", () => {
    const dir = scaffold();
    removeFloor(dir);
    addUnrecognizedKey(dir);

    const res = run(["validate", "--workspace", dir]);
    expect(res.code).toBe(1);
    // The failure itself is unchanged: the violation is still named.
    expect(res.stderr).toContain('Unrecognized key: "bogusField"');
    const hints = hintLines(res.stderr);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("npm i -g @profile-as-code/cli@latest");
    expect(hints[0]).toContain("pasco doctor");
    expect(hints[0]).toContain("does not know");
  });

  it("carries the same hint inside the --json error (additive, same exit)", () => {
    const dir = scaffold();
    removeFloor(dir);
    addUnrecognizedKey(dir);

    const res = run(["validate", "--json", "--workspace", dir]);
    expect(res.code).toBe(1);
    const envelope = JSON.parse(res.stdout) as {
      ok: boolean;
      exitCode: number;
      error?: { kind: string; message: string; hint?: string; violations?: { message: string }[] };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.exitCode).toBe(1);
    expect(envelope.error?.kind).toBe("schema");
    expect(envelope.error?.hint).toContain("pasco doctor");
    expect(envelope.error?.violations?.[0]?.message).toContain("Unrecognized key");
  });

  it("fires when a floor is declared and MET — the case init itself creates", () => {
    // #434 F1: `init` declares the floor at birth and nothing advances it, so an
    // older engine reading newer data sees a met floor; the gate has no
    // explanation and the hint is the only thing that names the upgrade.
    const dir = scaffold();
    expect(readPascorc(dir).engine).toBe(engineFloorFor(PACKAGE_VERSION));
    addUnrecognizedKey(dir);

    const res = run(["validate", "--workspace", dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Unrecognized key: "bogusField"');
    expect(hintLines(res.stderr)).toHaveLength(1);
  });

  it("does not fire on a schema failure that is not an Unrecognized key", () => {
    const dir = scaffold();
    removeFloor(dir);
    // A missing required field, not an unknown one.
    writeFileSync(join(dir, "content", "identity.yaml"), "# no name\n");

    const res = run(["validate", "--workspace", dir]);
    expect(res.code).toBe(1);
    expect(hintLines(res.stderr)).toEqual([]);
  });
});

describe("unrecognizedKeyHint predicate", () => {
  const issues = [{ path: "identity", message: 'Unrecognized key: "nationality"' }];

  it("fires when nothing explains the rejection (no floor, or a floor that is met)", () => {
    expect(unrecognizedKeyHint(issues, { declared: null, met: true })).toContain(
      "npm i -g @profile-as-code/cli@latest",
    );
    // A MET floor does not explain the rejection: the data is newer than the
    // engine that wrote it (F1).
    expect(unrecognizedKeyHint(issues, { declared: "0.3.7", met: true })).toContain("pasco doctor");
  });

  it("stays silent when the gate already names the upgrade (installed < declared)", () => {
    expect(unrecognizedKeyHint(issues, { declared: "9.9.9", met: false })).toBeNull();
  });

  it("ignores a failure that is not an unknown key", () => {
    expect(
      unrecognizedKeyHint([{ path: "identity", message: "Required" }], {
        declared: null,
        met: true,
      }),
    ).toBeNull();
  });
});

describe("the hint reads the requirement the gate actually evaluated (#434 fresh pass)", () => {
  it("fires even when a floor IS declared, because nobody advances it by hand", () => {
    // `init` declares the floor at birth and nothing bumps it: an older engine
    // reading newer data sees a MET floor, so the gate has no explanation and
    // the hint is exactly what the reader needs (F1).
    const dir = scaffold();
    expect(readPascorc(dir).engine).toBe(engineFloorFor(PACKAGE_VERSION));
    addUnrecognizedKey(dir);
    const res = run(["validate", "--workspace", dir]);
    expect(res.code).toBe(1);
    expect(hintLines(res.stderr)).toHaveLength(1);
  });

  it("stays silent when the gate already explains the mismatch (installed < declared)", () => {
    const dir = scaffold();
    const pascorc = readPascorc(dir);
    pascorc.engine = "9.9.9";
    writePascorc(dir, pascorc);
    addUnrecognizedKey(dir);
    const res = run(["validate", "--workspace", dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("requires engine 9.9.9 or newer");
    expect(hintLines(res.stderr)).toHaveLength(0);
  });

  it("reads a floor declared in a parent config, not only the workspace file (F5)", () => {
    const parent = tempDir();
    const dir = join(parent, "ws");
    expect(run(["init", dir]).code).toBe(0);
    // The workspace itself declares no floor: the only one in play is the
    // parent pointer's, which the gate must read (F3 of the second pass: the
    // fixture used to scaffold into ANOTHER tmp dir, so `parent/ws` did not
    // exist and the case passed vacuously on a missing workspace).
    const pascorc = readPascorc(dir);
    delete pascorc.engine;
    writePascorc(dir, pascorc);
    writeFileSync(
      join(parent, ".pascorc"),
      `${JSON.stringify({ workspace: "ws", engine: "9.9.9" }, null, 2)}\n`,
    );
    // No --workspace: the cwd pointer is the input that resolves the workspace.
    const res = run(["validate"], parent);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("requires engine 9.9.9 or newer");
    expect(hintLines(res.stderr)).toHaveLength(0);
  });
});
