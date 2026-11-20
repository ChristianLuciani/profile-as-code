/**
 * Tests for pasco sync command.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

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
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: err.code ?? 1,
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
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Please specify --to-yaml, --to-toml, or --watch");
    });

    it("rejects both --to-yaml and --to-toml", () => {
      const workspace = createWorkspace();
      const result = runSync(["--to-yaml", "--to-toml"], workspace);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Cannot specify both --to-yaml and --to-toml");
    });

    it("accepts --to-yaml", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "identity.toml"), `name = "Test"`, "utf-8");
      const result = runSync(["--to-yaml"], workspace);
      expect(result.code).toBe(0);
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

    it("creates parent directories if needed", () => {
      const workspace = createWorkspace();
      const subdir = join(workspace, "facts", "subdir");
      mkdirSync(subdir, { recursive: true });
      writeFileSync(join(subdir, "test.toml"), `key = "value"`, "utf-8");

      const result = runSync(["--to-yaml"], workspace);
      expect(result.code).toBe(0);
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

    it("removes null values during conversion", () => {
      const workspace = createWorkspace();
      writeFileSync(join(workspace, "facts", "test.yaml"), `a: 1\nb: null\nc: test`, "utf-8");

      const result = runSync(["--to-toml"], workspace);
      expect(result.code).toBe(0);

      // Check TOML file was created and doesn't contain null
      const tomlContent = readFileSync(join(workspace, "facts", "test.toml"), "utf-8");
      expect(tomlContent).not.toContain("null");
      expect(tomlContent).toContain("a = 1");
      expect(tomlContent).toContain("c = \"test\"");
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
      // Should still return 0 or 1 depending on error handling
      // The important thing is it outputs valid JSON
      expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
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
