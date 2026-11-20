/**
 * Tests for TOML <-> YAML synchronization utilities.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "@iarna/toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  removeNullValues,
  syncTomlYaml,
  tomlToYamlDirectory,
  tomlToYamlFile,
  yamlToTomlDirectory,
  yamlToTomlFile,
} from "../src/toml-sync.js";

let tempDirPath: string;

beforeEach(() => {
  tempDirPath = mkdtempSync(join(tmpdir(), "pasco-toml-test-"));
});

afterEach(() => {
  try {
    rmSync(tempDirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("removeNullValues", () => {
  it("removes null values from simple object", () => {
    const input = { a: 1, b: null, c: "test" };
    const expected = { a: 1, c: "test" };
    expect(removeNullValues(input)).toEqual(expected);
  });

  it("removes null values from nested object", () => {
    const input = { a: 1, b: { c: null, d: 2 }, e: null };
    const expected = { a: 1, b: { d: 2 } };
    expect(removeNullValues(input)).toEqual(expected);
  });

  it("preserves empty arrays", () => {
    const input = { a: [], b: null };
    const expected = { a: [] };
    expect(removeNullValues(input)).toEqual(expected);
  });

  it("preserves empty objects", () => {
    const input = { a: {}, b: null };
    const expected = { a: {} };
    expect(removeNullValues(input)).toEqual(expected);
  });

  it("removes null from arrays", () => {
    const input = [1, null, "test", null, 2];
    const expected = [1, "test", 2];
    expect(removeNullValues(input)).toEqual(expected);
  });

  it("handles undefined values", () => {
    const input = { a: undefined, b: 1 };
    const expected = { b: 1 };
    expect(removeNullValues(input)).toEqual(expected);
  });

  it("returns undefined for null input", () => {
    expect(removeNullValues(null)).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(removeNullValues(undefined)).toBeUndefined();
  });

  it("preserves primitive values", () => {
    expect(removeNullValues(1)).toBe(1);
    expect(removeNullValues("test")).toBe("test");
    expect(removeNullValues(true)).toBe(true);
    expect(removeNullValues(false)).toBe(false);
  });
});

describe("tomlToYamlFile", () => {
  it("converts TOML file to YAML", () => {
    const tomlPath = join(tempDirPath, "test.toml");
    const yamlPath = join(tempDirPath, "test.yaml");

    writeFileSync(tomlPath, `[identity]\nname = "Test User"\nlocation = "Test City"`, "utf-8");

    const success = tomlToYamlFile(tomlPath, yamlPath);
    expect(success).toBe(true);

    const yamlContent = parseYaml(readFileSync(yamlPath, "utf-8"));
    expect(yamlContent).toEqual({
      identity: { name: "Test User", location: "Test City" },
    });
  });

  it("creates parent directories if needed", () => {
    const tomlPath = join(tempDirPath, "subdir", "test.toml");
    const yamlPath = join(tempDirPath, "output", "subdir", "test.yaml");

    mkdirSync(join(tempDirPath, "subdir"), { recursive: true });
    writeFileSync(tomlPath, `name = "Test"`, "utf-8");

    const success = tomlToYamlFile(tomlPath, yamlPath, { createDirs: true });
    expect(success).toBe(true);
  });

  it("skips if YAML file exists and overwrite is false", () => {
    const tomlPath = join(tempDirPath, "test.toml");
    const yamlPath = join(tempDirPath, "test.yaml");

    writeFileSync(tomlPath, `name = "Test"`, "utf-8");
    writeFileSync(yamlPath, `name: "Existing"`, "utf-8");

    const success = tomlToYamlFile(tomlPath, yamlPath, { overwrite: false });
    expect(success).toBe(false);
  });

  it("overwrites if overwrite is true", () => {
    const tomlPath = join(tempDirPath, "test.toml");
    const yamlPath = join(tempDirPath, "test.yaml");

    writeFileSync(tomlPath, `name = "New"`, "utf-8");
    writeFileSync(yamlPath, `name: "Existing"`, "utf-8");

    const success = tomlToYamlFile(tomlPath, yamlPath, { overwrite: true });
    expect(success).toBe(true);

    const yamlContent = parseYaml(readFileSync(yamlPath, "utf-8"));
    expect(yamlContent).toEqual({ name: "New" });
  });
});

describe("yamlToTomlFile", () => {
  it("converts YAML file to TOML", () => {
    const yamlPath = join(tempDirPath, "test.yaml");
    const tomlPath = join(tempDirPath, "test.toml");

    writeFileSync(yamlPath, `identity:\n  name: Test User\n  location: Test City`, "utf-8");

    const success = yamlToTomlFile(yamlPath, tomlPath);
    expect(success).toBe(true);

    const tomlContent = parseToml(readFileSync(tomlPath, "utf-8"));
    expect(tomlContent).toEqual({
      identity: { name: "Test User", location: "Test City" },
    });
  });

  it("handles null values by removing them", () => {
    const yamlPath = join(tempDirPath, "test.yaml");
    const tomlPath = join(tempDirPath, "test.toml");

    writeFileSync(yamlPath, `a: 1\nb: null\nc: test`, "utf-8");

    const success = yamlToTomlFile(yamlPath, tomlPath);
    expect(success).toBe(true);

    const tomlContent = parseToml(readFileSync(tomlPath, "utf-8"));
    expect(tomlContent).toEqual({ a: 1, c: "test" });
  });

  it("skips if TOML file exists and overwrite is false", () => {
    const yamlPath = join(tempDirPath, "test.yaml");
    const tomlPath = join(tempDirPath, "test.toml");

    writeFileSync(yamlPath, `name: "Test"`, "utf-8");
    writeFileSync(tomlPath, `name = "Existing"`, "utf-8");

    const success = yamlToTomlFile(yamlPath, tomlPath, { overwrite: false });
    expect(success).toBe(false);
  });
});

describe("syncTomlYaml", () => {
  it("converts TOML to YAML in directory", async () => {
    const factsDir = join(tempDirPath, "facts");
    mkdirSync(factsDir, { recursive: true });

    writeFileSync(join(factsDir, "identity.toml"), `name = "Test"`, "utf-8");
    writeFileSync(join(factsDir, "positioning.toml"), `statement = { en = "Test" }`, "utf-8");

    const result = await syncTomlYaml(factsDir, { toYaml: true, toToml: false });

    expect(result.converted).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("converts YAML to TOML in directory", async () => {
    const factsDir = join(tempDirPath, "facts");
    mkdirSync(factsDir, { recursive: true });

    writeFileSync(join(factsDir, "identity.yaml"), `name: Test`, "utf-8");
    writeFileSync(join(factsDir, "positioning.yaml"), `statement:\n  en: Test`, "utf-8");

    const result = await syncTomlYaml(factsDir, { toYaml: false, toToml: true });

    expect(result.converted).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("handles both .yaml and .yml extensions", async () => {
    const factsDir = join(tempDirPath, "facts");
    mkdirSync(factsDir, { recursive: true });

    writeFileSync(join(factsDir, "identity.yaml"), `name: Test1`, "utf-8");
    writeFileSync(join(factsDir, "positioning.yml"), `statement:\n  en: Test2`, "utf-8");

    const result = await syncTomlYaml(factsDir, { toYaml: false, toToml: true });

    expect(result.converted).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("skips existing files when overwrite is false", async () => {
    const factsDir = join(tempDirPath, "facts");
    mkdirSync(factsDir, { recursive: true });

    writeFileSync(join(factsDir, "identity.toml"), `name = "TOML"`, "utf-8");
    writeFileSync(join(factsDir, "identity.yaml"), `name: "YAML"`, "utf-8");

    const result = await syncTomlYaml(factsDir, { toYaml: true, toToml: false, overwrite: false });

    expect(result.skipped).toHaveLength(1);
    expect(result.converted).toHaveLength(0);
  });
});

describe("tomlToYamlDirectory", () => {
  it("converts all TOML files in directory to YAML", async () => {
    const inputDir = join(tempDirPath, "toml");
    const outputDir = join(tempDirPath, "yaml");
    mkdirSync(inputDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(join(inputDir, "file1.toml"), `key1 = "value1"`, "utf-8");
    writeFileSync(join(inputDir, "file2.toml"), `key2 = "value2"`, "utf-8");

    const result = await tomlToYamlDirectory(inputDir, outputDir);

    expect(result.converted).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });
});

describe("yamlToTomlDirectory", () => {
  it("converts all YAML files in directory to TOML", async () => {
    const inputDir = join(tempDirPath, "yaml");
    const outputDir = join(tempDirPath, "toml");
    mkdirSync(inputDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(join(inputDir, "file1.yaml"), `key1: value1`, "utf-8");
    writeFileSync(join(inputDir, "file2.yaml"), `key2: value2`, "utf-8");

    const result = await yamlToTomlDirectory(inputDir, outputDir);

    expect(result.converted).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });
});
