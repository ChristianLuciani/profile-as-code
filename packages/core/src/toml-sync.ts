/**
 * TOML <-> YAML synchronization utilities.
 *
 * This module provides functions to convert between TOML and YAML formats,
 * enabling users to edit TOML files (more human-friendly, less indentation errors)
 * while the engine continues to work with YAML.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Types compatible with @iarna/toml's JsonMap and AnyJson.
 * Used to ensure type safety when converting YAML to TOML.
 */
type TomlArray = boolean[] | number[] | string[] | TomlMap[] | Date[];
type TomlValue = boolean | number | string | TomlMap | Date | TomlArray;
export interface TomlMap {
  [key: string]: TomlValue;
}
type TomlCompatible = TomlMap | TomlArray | TomlValue;

/**
 * Assert that a value is a TomlMap (compatible with @iarna/toml's JsonMap).
 * This is a type guard that ensures the value can be safely passed to stringifyToml.
 */
function isTomlMap(obj: unknown): obj is TomlMap {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj);
}

/**
 * Remove null values from an object recursively.
 * TOML doesn't support null, so we omit null values.
 * Empty arrays and objects are preserved.
 * Returns a value compatible with @iarna/toml's stringify function.
 */
export function removeNullValues(obj: unknown): TomlCompatible | undefined {
  if (obj === null || obj === undefined) {
    return undefined; // Will be omitted when stringified
  }
  if (Array.isArray(obj)) {
    const filtered = obj.map(removeNullValues).filter((v): v is TomlCompatible => v !== undefined);
    return filtered as TomlArray;
  }
  if (typeof obj === "object") {
    const result: TomlMap = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = removeNullValues(value);
      if (cleanedValue !== undefined) {
        result[key] = cleanedValue as TomlValue;
      }
    }
    return result;
  }
  // Primitive values: boolean, number, string, Date
  return obj as TomlValue;
}

/** Options for TOML to YAML conversion */
export interface TomlToYamlOptions {
  /** Indentation level for YAML output (default: 2) */
  indent?: number;
  /** Whether to create parent directories if they don't exist (default: true) */
  createDirs?: boolean;
  /** Whether to overwrite existing YAML files (default: false) */
  overwrite?: boolean;
}

/** Options for YAML to TOML conversion */
export interface YamlToTomlOptions {
  /** Whether to create parent directories if they don't exist (default: true) */
  createDirs?: boolean;
  /** Whether to overwrite existing TOML files (default: false) */
  overwrite?: boolean;
}

/** Result of a synchronization operation */
export interface SyncResult {
  /** Files that were successfully converted */
  converted: string[];
  /** Files that were skipped (already exist, no overwrite) */
  skipped: string[];
  /** Files that had errors */
  errors: { file: string; error: string }[];
}

/**
 * Convert a single TOML file to YAML.
 *
 * @param tomlPath - Path to the TOML file
 * @param yamlPath - Path to write the YAML file
 * @param options - Conversion options
 * @returns True if successful
 */
export function tomlToYamlFile(
  tomlPath: string,
  yamlPath: string,
  options: TomlToYamlOptions = {},
): boolean {
  const { indent = 2, createDirs = true, overwrite = false } = options;

  // Check if TOML file exists
  if (!existsSync(tomlPath)) {
    throw new Error(`TOML file not found: ${tomlPath}`);
  }

  // Check if YAML file exists and overwrite is false
  if (existsSync(yamlPath) && !overwrite) {
    return false;
  }

  // Create parent directory if needed
  if (createDirs) {
    const yamlDir = dirname(yamlPath);
    if (!existsSync(yamlDir)) {
      mkdirSync(yamlDir, { recursive: true });
    }
  }

  // Read and parse TOML
  const tomlContent = readFileSync(tomlPath, "utf-8");
  const data = parseToml(tomlContent);

  // Convert to YAML
  const yamlContent = stringifyYaml(data, { indent });

  // Write YAML file
  writeFileSync(yamlPath, yamlContent, "utf-8");

  return true;
}

/**
 * Convert a single YAML file to TOML.
 *
 * @param yamlPath - Path to the YAML file
 * @param tomlPath - Path to write the TOML file
 * @param options - Conversion options
 * @returns True if successful
 */
export function yamlToTomlFile(
  yamlPath: string,
  tomlPath: string,
  options: YamlToTomlOptions = {},
): boolean {
  const { createDirs = true, overwrite = false } = options;

  // Check if YAML file exists
  if (!existsSync(yamlPath)) {
    throw new Error(`YAML file not found: ${yamlPath}`);
  }

  // Check if TOML file exists and overwrite is false
  if (existsSync(tomlPath) && !overwrite) {
    return false;
  }

  // Create parent directory if needed
  if (createDirs) {
    const tomlDir = dirname(tomlPath);
    if (!existsSync(tomlDir)) {
      mkdirSync(tomlDir, { recursive: true });
    }
  }

  // Read and parse YAML
  const yamlContent = readFileSync(yamlPath, "utf-8");
  const data = parseYaml(yamlContent);

  // Remove null values (TOML doesn't support null)
  const cleanedData = removeNullValues(data);

  // Convert to TOML - cleanedData from YAML parse is always an object
  // removeNullValues preserves the structure, so it's safe to assert as TomlMap
  if (!isTomlMap(cleanedData)) {
    throw new Error("Invalid data structure for TOML conversion");
  }
  const tomlContent = stringifyToml(cleanedData);

  // Write TOML file
  writeFileSync(tomlPath, tomlContent, "utf-8");

  return true;
}

/**
 * Convert all TOML files in a directory to YAML.
 *
 * @param inputDir - Directory containing TOML files
 * @param outputDir - Directory to write YAML files (same structure as inputDir)
 * @param options - Conversion options
 * @returns SyncResult with details of the operation
 */
export async function tomlToYamlDirectory(
  inputDir: string,
  outputDir: string,
  options: TomlToYamlOptions = {},
): Promise<SyncResult> {
  const result: SyncResult = { converted: [], skipped: [], errors: [] };
  const { globSync } = await import("glob");

  // Find all TOML files
  const tomlFiles = globSync(join(inputDir, "**/*.toml"));

  for (const tomlPath of tomlFiles) {
    try {
      const relativePath = relative(inputDir, tomlPath);
      const yamlPath = join(outputDir, relativePath.replace(".toml", ".yaml"));

      const success = tomlToYamlFile(tomlPath, yamlPath, options);
      if (success) {
        result.converted.push(tomlPath);
      } else {
        result.skipped.push(tomlPath);
      }
    } catch (error) {
      result.errors.push({
        file: tomlPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Convert all YAML files in a directory to TOML.
 *
 * @param inputDir - Directory containing YAML files
 * @param outputDir - Directory to write TOML files (same structure as inputDir)
 * @param options - Conversion options
 * @returns SyncResult with details of the operation
 */
export async function yamlToTomlDirectory(
  inputDir: string,
  outputDir: string,
  options: YamlToTomlOptions = {},
): Promise<SyncResult> {
  const result: SyncResult = { converted: [], skipped: [], errors: [] };
  const { globSync } = await import("glob");

  // Find all YAML files
  const yamlFiles = globSync(join(inputDir, "**/*.yaml"));

  for (const yamlPath of yamlFiles) {
    try {
      const relativePath = relative(inputDir, yamlPath);
      const tomlPath = join(outputDir, relativePath.replace(".yaml", ".toml"));

      const success = yamlToTomlFile(yamlPath, tomlPath, options);
      if (success) {
        result.converted.push(yamlPath);
      } else {
        result.skipped.push(yamlPath);
      }
    } catch (error) {
      result.errors.push({
        file: yamlPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Synchronize TOML and YAML files in the same directory.
 * Converts TOML files to YAML (or vice versa) while preserving the directory structure.
 *
 * @param factsDir - Directory containing fact files (TOML or YAML)
 * @param options - Conversion options
 * @returns SyncResult with details of the operation
 */
export async function syncTomlYaml(
  factsDir: string,
  options: TomlToYamlOptions & { toYaml?: boolean; toToml?: boolean } = {},
): Promise<SyncResult> {
  const { toYaml = true, toToml = false, ...restOptions } = options;
  const result: SyncResult = { converted: [], skipped: [], errors: [] };
  const { globSync } = await import("glob");

  if (toYaml) {
    // Convert TOML to YAML (also handle .yml files)
    const tomlFiles = globSync(join(factsDir, "**/*.{toml,yml}"));
    for (const tomlPath of tomlFiles) {
      try {
        // Determine output extension based on input
        const ext = tomlPath.endsWith(".toml") || tomlPath.endsWith(".yml") ? ".yaml" : ".yaml";
        const yamlPath = tomlPath.replace(/\.(toml|yml)$/, ext);
        const success = tomlToYamlFile(tomlPath, yamlPath, restOptions);
        if (success) {
          result.converted.push(`${tomlPath} -> ${yamlPath}`);
        } else {
          result.skipped.push(tomlPath);
        }
      } catch (error) {
        result.errors.push({
          file: tomlPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (toToml) {
    // Convert YAML to TOML (handle both .yaml and .yml)
    const yamlFiles = globSync(join(factsDir, "**/*.{yaml,yml}"));
    for (const yamlPath of yamlFiles) {
      try {
        const tomlPath = yamlPath.replace(/\.(yaml|yml)$/, ".toml");
        const success = yamlToTomlFile(yamlPath, tomlPath, restOptions);
        if (success) {
          result.converted.push(`${yamlPath} -> ${tomlPath}`);
        } else {
          result.skipped.push(yamlPath);
        }
      } catch (error) {
        result.errors.push({
          file: yamlPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}

/**
 * Watch a directory for changes and sync TOML <-> YAML automatically.
 *
 * @param factsDir - Directory to watch
 * @param options - Conversion options
 * @param callback - Optional callback for each sync event
 * @returns Function to stop watching
 */
export async function watchTomlYaml(
  factsDir: string,
  options: TomlToYamlOptions & { toYaml?: boolean; toToml?: boolean } = {},
  callback?: (result: SyncResult) => void,
): Promise<() => void> {
  const { toYaml = true, toToml = false, ...restOptions } = options;
  const { watch } = await import("chokidar");

  // Track files being written to avoid re-triggering on our own writes
  const writingFiles = new Set<string>();
  // Collect changed files during debounce period
  const changedFiles = new Set<string>();
  // Debounce timer
  let debounceTimer: NodeJS.Timeout | null = null;

  const watcher = watch(join(factsDir, "**/*.{toml,yaml,yml}"), {
    persistent: true,
    ignoreInitial: true,
  });

  // Helper to schedule sync after debounce
  const scheduleSync = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(async () => {
      // Collect all files that will be written
      const filesToWrite = new Set<string>();
      for (const path of changedFiles) {
        if (toYaml && path.endsWith(".toml")) {
          filesToWrite.add(path.replace(".toml", ".yaml"));
        }
        if (toToml && path.endsWith(".yaml")) {
          filesToWrite.add(path.replace(".yaml", ".toml"));
        }
        if (toToml && path.endsWith(".yml")) {
          filesToWrite.add(path.replace(".yml", ".toml"));
        }
        if (toYaml && path.endsWith(".toml")) {
          filesToWrite.add(path.replace(".toml", ".yml"));
        }
      }

      // Add to writing set
      for (const f of filesToWrite) {
        writingFiles.add(f);
      }

      // Clear changed files for next batch
      changedFiles.clear();

      try {
        const result = await syncTomlYaml(factsDir, { ...restOptions, toYaml, toToml });
        if (callback) {
          callback(result);
        }
      } finally {
        // Remove from writing set after sync completes
        for (const f of filesToWrite) {
          writingFiles.delete(f);
        }
      }
    }, 100); // 100ms debounce
  };

  // Handle all file events
  const handleFileEvent = (path: string) => {
    // Skip if this file is being written by us
    if (writingFiles.has(path)) {
      return;
    }
    changedFiles.add(path);
    scheduleSync();
  };

  watcher.on("add", handleFileEvent);
  watcher.on("change", handleFileEvent);
  watcher.on("unlink", handleFileEvent);

  // Initial sync
  const initialResult = await syncTomlYaml(factsDir, { ...restOptions, toYaml, toToml });
  if (callback) {
    callback(initialResult);
  }

  return () => watcher.close();
}
