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

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 15_000 });
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
      expect(pascorc.engine).toBe(PACKAGE_VERSION);
      expect(pascorc.workspace).toBe(".");
    });
  }

  it("the scaffolded workspace meets its own floor", () => {
    const dir = scaffold();
    const res = run(["validate", "--workspace", dir]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("valid");
  });

  it("writes the declaration grammar even when the installed version carries a suffix", () => {
    // A declaration must be exactly MAJOR.MINOR.PATCH; a pre-release suffix on
    // the installed version would make the gate refuse `init`'s own output.
    expect(engineFloorFor("0.4.0-rc.1")).toBe("0.4.0");
    expect(engineFloorFor("0.3.7")).toBe("0.3.7");
    expect(engineFloorFor(`${PACKAGE_VERSION}-next.1`)).toBe(PACKAGE_VERSION);
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
    expect(hints[0]).toContain("no engine floor");
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

  it("does not fire when a floor is declared", () => {
    const dir = scaffold();
    expect(readPascorc(dir).engine).toBe(PACKAGE_VERSION);
    addUnrecognizedKey(dir);

    const res = run(["validate", "--workspace", dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Unrecognized key: "bogusField"');
    expect(hintLines(res.stderr)).toEqual([]);
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
  it("fires only on the conjunction (unknown key AND no declared floor)", () => {
    const issues = [{ path: "identity", message: 'Unrecognized key: "nationality"' }];
    expect(unrecognizedKeyHint(issues, false)).toContain("npm i -g @profile-as-code/cli@latest");
    expect(unrecognizedKeyHint(issues, true)).toBeNull();
    expect(unrecognizedKeyHint([{ path: "identity", message: "Required" }], false)).toBeNull();
  });
});
