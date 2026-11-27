/**
 * Tests for pasco sync command.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = join(__dirname, "..", "dist", "index.js");

let tempDirPath: string;

beforeEach(() => {
  tempDirPath = join(tmpdir(), `pasco-sync-test-${Date.now()}`);
  mkdirSync(tempDirPath, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(tempDirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

/** Create a temporary workspace with facts directory */
function createWorkspace(): string {
  const factsDir = join(tempDirPath, "facts");
  mkdirSync(factsDir, { recursive: true });
  return tempDirPath;
}

/** Run pasco sync command */
function runSync(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  try {
    const result = execFileSync("node", [CLI, "sync", ...args], {
      cwd,
      encoding: "utf-8",
    });
    return { code: 0, stdout: result, stderr: "" };
  } catch (error: unknown) {
    // execFileSync reports a non-zero EXIT STATUS in `status`; `code` is only set
    // for spawn failures — reading `code` here masked every real exit code as 1.
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("pasco sync", () => {
  describe("argument validation", () => {
    it("requires at least one of --to-yaml, --to-toml, or --watch", () => {
      const workspace = createWorkspace();
      const result = runSync([], workspace);
      // usage error (missing direction flag) = exit 2 per the CLI exit contract
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(
        "Please specify at least one of --to-yaml, --to-toml, or --watch",
      );
    });

    it("accepts both --to-yaml and --to-toml for bidirectional sync", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.toml"), `name = "Test"`, "utf-8");
      writeFileSync(
        join(workspace, "facts", "positioning.yaml"),
        `statement:\n  en: Test`,
        "utf-8",
      );
      const result = runSync(["--to-yaml", "--to-toml"], workspace);
      expect(result.code).toBe(0);
    });

    it("accepts --to-yaml", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.toml"), `name = "Test"`, "utf-8");
      const result = runSync(["--to-yaml"], workspace);
      expect(result.code).toBe(0);
    });

    it("bidirectional -f does not rewrite a hand-authored .toml (no round-trip re-canonicalization)", () => {
      const workspace = createWorkspace();
      const toml = `# header\nname = "T" # trailing\n`;
      writeFileSync(join(workspace, "facts", "identity.toml"), toml, "utf-8");

      const result = runSync(["--to-yaml", "--to-toml", "-f"], workspace);
      expect(result.code).toBe(0);

      expect(readFileSync(join(workspace, "facts", "identity.toml"), "utf-8")).toBe(toml);
      expect(existsSync(join(workspace, "facts", "identity.yaml"))).toBe(true);
    });

    it("accepts --to-toml", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.yaml"), `name: Test`, "utf-8");
      const result = runSync(["--to-toml"], workspace);
      expect(result.code).toBe(0);
    });
  });

  describe("TOML to YAML conversion", () => {
    it("converts TOML files to YAML", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.toml"), `name = "Test User"`, "utf-8");

      const result = runSync(["--to-yaml"], workspace);
      expect(result.code).toBe(0);

      // Check YAML file was created
      const yamlPath = join(workspace, "facts", "identity.yaml");
      expect(() => readFileSync(yamlPath, "utf-8")).not.toThrow();
    });

    it("converts uppercase .TOML files to .yaml", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.TOML"), `name = "Upper"`, "utf-8");

      const result = runSync(["--to-yaml"], workspace);
      expect(result.code).toBe(0);

      const yamlPath = join(workspace, "facts", "identity.yaml");
      expect(() => readFileSync(yamlPath, "utf-8")).not.toThrow();
      // the .TOML file itself must be left untouched
      expect(readFileSync(join(workspace, "facts", "identity.TOML"), "utf-8")).toContain(
        'name = "Upper"',
      );
    });

    it("ignores files in subdirectories (load() reads the facts dir flat)", () => {
      const workspace = createWorkspace();
      const subdir = join(workspace, "facts", "subdir");
      mkdirSync(subdir, { recursive: true });
      writeFileSync(join(subdir, "test.toml"), `key = "value"`, "utf-8");
      writeFileSync(join(workspace, "facts", "top.toml"), `key = "top"`, "utf-8");

      const result = runSync(["--to-yaml"], workspace);
      expect(result.code).toBe(0);

      expect(existsSync(join(workspace, "facts", "top.yaml"))).toBe(true);
      expect(existsSync(join(subdir, "test.yaml"))).toBe(false);
    });

    it("skips existing YAML files without --overwrite", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.toml"), `name = "TOML"`, "utf-8");
      writeFileSync(join(workspace, "facts", "identity.yaml"), `name: "Existing"`, "utf-8");

      const result = runSync(["--to-yaml"], workspace);
      expect(result.code).toBe(0);

      // YAML file should not be overwritten
      const yamlContent = readFileSync(join(workspace, "facts", "identity.yaml"), "utf-8");
      expect(yamlContent).toContain("Existing");
    });

    it("overwrites existing YAML files with --overwrite", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.toml"), `name = "New"`, "utf-8");
      writeFileSync(join(workspace, "facts", "identity.yaml"), `name: "Existing"`, "utf-8");

      const result = runSync(["--to-yaml", "--overwrite"], workspace);
      expect(result.code).toBe(0);

      // YAML file should be overwritten
      const yamlContent = readFileSync(join(workspace, "facts", "identity.yaml"), "utf-8");
      expect(yamlContent).not.toContain("Existing");
    });
  });

  describe("YAML to TOML conversion", () => {
    it("converts YAML files to TOML", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.yaml"), `name: Test User`, "utf-8");

      const result = runSync(["--to-toml"], workspace);
      expect(result.code).toBe(0);

      // Check TOML file was created
      const tomlPath = join(workspace, "facts", "identity.toml");
      expect(() => readFileSync(tomlPath, "utf-8")).not.toThrow();
    });

    it("handles .yml extension", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.yml"), `name: Test User`, "utf-8");

      const result = runSync(["--to-toml"], workspace);
      expect(result.code).toBe(0);

      // Check TOML file was created
      const tomlPath = join(workspace, "facts", "identity.toml");
      expect(() => readFileSync(tomlPath, "utf-8")).not.toThrow();
    });

    it("rejects YAML files with null values", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "test.yaml"), `a: 1\nb: null\nc: test`, "utf-8");

      const result = runSync(["--to-toml"], workspace);
      expect(result.code).toBe(1);
      // CLI writes errors to stdout, not stderr
      expect(result.stdout).toContain(
        "YAML file contains null values which are not supported by TOML",
      );
    });
  });

  describe("JSON output", () => {
    it("outputs JSON with --json flag", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.toml"), `name = "Test"`, "utf-8");

      const result = runSync(["--to-yaml", "--json"], workspace);
      expect(result.code).toBe(0);

      // Should be valid JSON
      const output = result.stdout.trim();
      expect(() => JSON.parse(output)).not.toThrow();
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("converted");
      expect(parsed).toHaveProperty("skipped");
      expect(parsed).toHaveProperty("errors");
    });

    it("returns non-zero exit code on errors with --json", () => {
      const workspace = createWorkspace();
      // Create invalid TOML
      writeFileSync(join(workspace, "facts", "invalid.toml"), `name = "unclosed string`, "utf-8");

      const result = runSync(["--to-yaml", "--json"], workspace);
      expect(result.code).toBe(1);
      const parsed = JSON.parse(result.stdout.trim()) as {
        converted: string[];
        skipped: string[];
        errors: { file: string; error: string }[];
      };
      expect(parsed.errors.length).toBeGreaterThan(0);
    });

    it("emits the standard CLI error envelope for missing direction flag (exit 2)", () => {
      const workspace = createWorkspace();
      const result = runSync(["--json"], workspace);
      expect(result.code).toBe(2);
      const parsed = JSON.parse(result.stdout.trim()) as {
        command: string;
        ok: boolean;
        exitCode: number;
        error: { kind: string; message: string };
      };
      expect(parsed).toMatchObject({
        command: "sync",
        ok: false,
        exitCode: 2,
        error: { kind: "usage" },
      });
      expect(parsed.error.message).toContain("--to-yaml");
    });

    it("emits the standard CLI error envelope when facts dir is missing (exit 1)", () => {
      const workspace = join(tempDirPath, "no-facts-json-ws");
      mkdirSync(workspace, { recursive: true });
      const result = runSync(["--to-yaml", "--json"], workspace);
      expect(result.code).toBe(1);
      const parsed = JSON.parse(result.stdout.trim()) as {
        command: string;
        ok: boolean;
        exitCode: number;
        error: { kind: string; message: string };
      };
      expect(parsed).toMatchObject({
        command: "sync",
        ok: false,
        exitCode: 1,
        error: { kind: "sync" },
      });
      expect(parsed.error.message).toContain("directory not found");
    });

    it("emits the standard CLI error envelope when facts is a regular file (exit 1)", () => {
      const workspace = join(tempDirPath, "file-facts-json-ws");
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, "facts"), "not a directory", "utf-8");
      const result = runSync(["--to-yaml", "--json"], workspace);
      expect(result.code).toBe(1);
      const parsed = JSON.parse(result.stdout.trim()) as {
        command: string;
        ok: boolean;
        exitCode: number;
        error: { kind: string; message: string };
      };
      expect(parsed).toMatchObject({
        command: "sync",
        ok: false,
        exitCode: 1,
        error: { kind: "sync" },
      });
      expect(parsed.error.message).toContain("expected a directory");
    });

    it("emits the standard CLI error envelope when both facts/ and content/ exist (exit 1)", () => {
      const workspace = createWorkspace();
      mkdirSync(join(workspace, "content"), { recursive: true });
      const result = runSync(["--to-yaml", "--json"], workspace);
      expect(result.code).toBe(1);
      const parsed = JSON.parse(result.stdout.trim()) as {
        command: string;
        ok: boolean;
        exitCode: number;
        error: { kind: string; message: string };
      };
      expect(parsed).toMatchObject({
        command: "sync",
        ok: false,
        exitCode: 1,
        error: { kind: "sync" },
      });
      expect(parsed.error.message).toContain("ambiguous");
    });

    it("emits the standard CLI error envelope on invalid .pascorc JSON (exit 1)", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, ".pascorc"), "{invalid json", "utf-8");
      const result = runSync(["--to-yaml", "--json"], workspace);
      expect(result.code).toBe(1);
      const parsed = JSON.parse(result.stdout.trim()) as {
        command: string;
        ok: boolean;
        exitCode: number;
        error: { kind: string; message: string };
      };
      expect(parsed).toMatchObject({
        command: "sync",
        ok: false,
        exitCode: 1,
        error: { kind: "sync" },
      });
      expect(parsed.error.message).toContain("invalid JSON in .pascorc");
    });
  });

  describe("missing facts dir", () => {
    it("fails with exit 1 (not a silent 0) when the facts dir does not exist", () => {
      const workspace = join(tempDirPath, "no-facts-ws");
      mkdirSync(workspace, { recursive: true });
      const result = runSync(["--to-yaml"], workspace);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("directory not found");
    });
  });

  describe("workspace flag", () => {
    it("uses specified workspace path", () => {
      const workspace = createWorkspace();
      const customWorkspace = join(tempDirPath, "custom");
      mkdirSync(join(customWorkspace, "facts"), { recursive: true });
      writeFileSync(join(customWorkspace, "facts", "identity.toml"), `name = "Test"`, "utf-8");

      const result = runSync(["--to-yaml", "--workspace", customWorkspace], workspace);
      expect(result.code).toBe(0);

      // Check YAML file was created in custom workspace
      const yamlPath = join(customWorkspace, "facts", "identity.yaml");
      expect(() => readFileSync(yamlPath, "utf-8")).not.toThrow();
    });
  });

  describe("help flag", () => {
    it("displays help text with --help", () => {
      const workspace = createWorkspace();
      const result = runSync(["--help"], workspace);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("pasco sync");
      expect(result.stdout).toContain("--to-yaml");
      expect(result.stdout).toContain("--to-toml");
    });
  });
});
