/**
 * Validator parity — `validate`, `build` and `export profile` resolve the SAME
 * schema and the SAME `additionalProperties` policy (SPEC §7.5, issue #348
 * criterion 3).
 *
 * Why this test exists: #348's evidence is a real field failing one surface but
 * not the other in the consumer's world — `projects[].artifactRefs` (v1.12, #333)
 * was rejected by an older installed CLI as `Unrecognized key`, so a workspace
 * that `build` accepted could fail validation (and vice versa) depending on which
 * engine produced the schema. Today the commands all call `core.load()` — one
 * assembler, one schema — and this file is the guard that keeps it that way:
 *
 *   1. a fixture carrying the NEW field (`artifactRefs`, the #333 witness) is
 *      accepted by ALL commands, exit 0;
 *   2. the same fixture plus ONE unknown row field is REFUSED by all of them,
 *      exit 1, with identical violations (same paths, same messages) — which is
 *      only true if they resolve the same schema and the same policy;
 *   3. a workspace whose `artifactRefs` points at no artifact (the load-level
 *      joinability refinement) is refused by all of them too — the schema-valid
 *      side of the same load contract;
 *   4. the policy itself is the contract's: `additionalProperties: false` in
 *      `schema/profile.schema.json` at the root and at the row level.
 *
 * `build` writes into the workspace, so every case runs over a temp copy; the
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

/** The three surfaces that must agree on the contract. */
const COMMANDS = ["validate", "build"] as const;
type Command = (typeof COMMANDS)[number];

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

function run(command: Command, workspace: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, command, "--json", "--workspace", workspace], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** `export profile` names its subcommand; same envelope, same load path. */
function runExportProfile(workspace: string): RunResult {
  const res = spawnSync(
    process.execPath,
    [CLI, "export", "profile", "--json", "--workspace", workspace],
    { encoding: "utf8", timeout: 15_000 },
  );
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

describe("validate/build/export-profile parity", () => {
  it("the contract declares additionalProperties: false at both levels all commands read", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as {
      additionalProperties?: unknown;
      $defs: Record<string, { additionalProperties?: unknown }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$defs.project?.additionalProperties).toBe(false);
    expect(schema.$defs.publication?.additionalProperties).toBe(false);
  });

  it("accepts the new field (#333 artifactRefs) on ALL surfaces", () => {
    const workspace = workspaceCopy();
    // The witness is really there — otherwise this test proves nothing.
    const projects = readFileSync(join(workspace, "content", "projects.yaml"), "utf8");
    expect(projects).toContain("artifactRefs:");

    for (const command of COMMANDS) {
      const result = run(command, workspace);
      expect(result.code, `${command}: ${result.stdout}${result.stderr}`).toBe(0);
      expect(envelope(result).ok).toBe(true);
    }
    const exported = runExportProfile(workspace);
    expect(exported.code, exported.stdout + exported.stderr).toBe(0);
    expect(envelope(exported).ok).toBe(true);
  });

  it("refuses an unknown row field on ALL surfaces with the same violations", () => {
    const workspace = workspaceCopy();
    const projectsPath = join(workspace, "content", "projects.yaml");
    const body = readFileSync(projectsPath, "utf8");
    const patched = body.replace(
      "  artifactRefs:\n    - hub-source\n",
      "  artifactRefs:\n    - hub-source\n  notInTheContract: true\n",
    );
    expect(patched).not.toBe(body);
    writeFileSync(projectsPath, patched, "utf8");

    const results = [
      ...COMMANDS.map((command) => run(command, workspace)),
      runExportProfile(workspace),
    ];
    const envelopes = results.map((result) => envelope(result));
    for (const [index, result] of results.entries()) {
      expect(result.code, `command ${index}`).toBe(1);
      expect(envelopes[index]?.ok).toBe(false);
      expect(envelopes[index]?.error?.kind).toBe("schema");
    }
    // Same schema → same paths and messages. A divergence (a second schema, a
    // different additionalProperties policy, a pre-normalization shortcut) fails
    // here instead of in a user's workspace.
    const first = envelopes[0]?.error?.violations;
    expect(first?.length).toBeGreaterThan(0);
    for (const envelope of envelopes.slice(1)) {
      expect(envelope.error?.violations).toEqual(first);
    }
    expect(first?.[0]?.path).toContain("projects");
    expect(first?.[0]?.message).toMatch(/Unrecognized key/);
    expect(first?.[0]?.message).toContain("notInTheContract");
  });

  it("refuses a dangling artifactRefs target on ALL surfaces (load refinement, kind schema)", () => {
    const workspace = workspaceCopy();
    const projectsPath = join(workspace, "content", "projects.yaml");
    const body = readFileSync(projectsPath, "utf8");
    const patched = body.replace(
      "  artifactRefs:\n    - hub-source\n",
      "  artifactRefs:\n    - does-not-exist\n",
    );
    expect(patched).not.toBe(body);
    writeFileSync(projectsPath, patched, "utf8");

    const results = [
      ...COMMANDS.map((command) => run(command, workspace)),
      runExportProfile(workspace),
    ];
    const envelopes = results.map((result) => envelope(result));
    for (const [index, result] of results.entries()) {
      expect(result.code, `command ${index}`).toBe(1);
      expect(envelopes[index]?.ok).toBe(false);
      expect(envelopes[index]?.error?.kind).toBe("schema");
      expect(envelopes[index]?.error?.violations?.length).toBeGreaterThan(0);
    }
    const first = envelopes[0]?.error?.violations;
    for (const envelope of envelopes.slice(1)) {
      expect(envelope.error?.violations).toEqual(first);
    }
    expect(first?.[0]?.message).toContain("does-not-exist");
  });
});
