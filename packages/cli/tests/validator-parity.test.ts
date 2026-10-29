/**
 * Validator parity — `validate` and `build` resolve the SAME schema and the SAME
 * `additionalProperties` policy (SPEC §7.5, issue #348 criterion 3).
 *
 * Why this test exists: #348's evidence is a real field failing one surface but
 * not the other in the consumer's world — `projects[].artifactRefs` (v1.12, #333)
 * was rejected by an older installed CLI as `Unrecognized key`, so a workspace
 * that `build` accepted could fail validation (and vice versa) depending on which
 * engine produced the schema. Today both commands call `core.load()` — one
 * assembler, one schema — and this file is the guard that keeps it that way:
 *
 *   1. a fixture carrying the NEW field (`artifactRefs`, the #333 witness) is
 *      accepted by BOTH commands, exit 0;
 *   2. the same fixture plus ONE unknown row field is REFUSED by BOTH commands,
 *      exit 1, with identical violations (same paths, same messages) — which is
 *      only true if both resolve the same schema and the same policy;
 *   3. the policy itself is the contract's: `additionalProperties: false` in
 *      `schema/profile.schema.json` at the root and at the row level.
 *
 * `build` writes into the workspace, so both cases run over a temp copy; the
 * committed fixture is never mutated.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

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

interface Envelope {
  command: string;
  ok: boolean;
  exitCode: number;
  error?: { kind: string; message: string; violations?: { path: string; message: string }[] };
}

function run(command: "validate" | "build", workspace: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, command, "--json", "--workspace", workspace], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function envelope(result: RunResult): Envelope {
  return JSON.parse(result.stdout) as Envelope;
}

const tempDirs: string[] = [];
function workspaceCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-parity-"));
  tempDirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("validate/build parity", () => {
  it("the contract declares additionalProperties: false at both levels both commands read", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as {
      additionalProperties?: unknown;
      $defs: Record<string, { additionalProperties?: unknown }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$defs.project?.additionalProperties).toBe(false);
    expect(schema.$defs.publication?.additionalProperties).toBe(false);
  });

  it("accepts the new field (#333 artifactRefs) on BOTH surfaces", () => {
    const workspace = workspaceCopy();
    // The witness is really there — otherwise this test proves nothing.
    const projects = readFileSync(join(workspace, "content", "projects.yaml"), "utf8");
    expect(projects).toContain("artifactRefs:");

    const validated = run("validate", workspace);
    const built = run("build", workspace);
    expect(validated.code, validated.stdout + validated.stderr).toBe(0);
    expect(built.code, built.stdout + built.stderr).toBe(0);
    expect(envelope(validated).ok).toBe(true);
    expect(envelope(built).ok).toBe(true);
  });

  it("refuses an unknown row field on BOTH surfaces with the same violations", () => {
    const workspace = workspaceCopy();
    const projectsPath = join(workspace, "content", "projects.yaml");
    const body = readFileSync(projectsPath, "utf8");
    const patched = body.replace(
      "  artifactRefs:\n    - hub-source\n",
      "  artifactRefs:\n    - hub-source\n  notInTheContract: true\n",
    );
    expect(patched).not.toBe(body);
    writeFileSync(projectsPath, patched, "utf8");

    const validated = run("validate", workspace);
    const built = run("build", workspace);
    expect(validated.code).toBe(1);
    expect(built.code).toBe(1);

    const a = envelope(validated);
    const b = envelope(built);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(a.error?.kind).toBe("schema");
    expect(b.error?.kind).toBe("schema");
    // Same schema → same paths and messages. A divergence (a second schema, a
    // different additionalProperties policy, a pre-normalization shortcut) fails
    // here instead of in a user's workspace.
    expect(a.error?.violations).toEqual(b.error?.violations);
    expect(a.error?.violations?.length).toBeGreaterThan(0);
    const first = a.error?.violations?.[0];
    expect(first?.path).toContain("projects");
    expect(first?.message).toMatch(/Unrecognized key/);
    expect(first?.message).toContain("notInTheContract");
  });
});
