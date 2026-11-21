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
 * Check if an object contains null values recursively.
 * TOML doesn't support null, so YAML files with explicit null values
 * cannot be accurately converted to TOML (round-trip would lose the nulls).
 *
 * @param obj - The object to check
 * @returns true if the object contains null values, false otherwise
 */
function hasNullValues(obj: unknown): boolean {
  if (obj === null) {
    return true;
  }
  if (Array.isArray(obj)) {
    return obj.some(hasNullValues);
  }
  if (typeof obj === "object") {
    return Object.values(obj).some(hasNullValues);
  }
  return false;
}

/**
 * Remove null values from an object recursively.
 * TOML doesn't support null, so we omit null values.
 * Empty arrays and objects are preserved.
 * Returns a value compatible with @iarna/toml's stringify function.
 */
/**
 * Find the path to the first null value in an object.
 * Returns the path as a dot-separated string, or undefined if no null values found.
 */
function findNullPath(obj: unknown, path: string = ""): string | undefined {
  if (obj === null) {
    return path || "(root)";
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const result = findNullPath(obj[i], path ? `${path}[${i}]` : `[${i}]`);
      if (result) {
        return result;
      }
    }
  } else if (typeof obj === "object" && obj !== null) {
    for (const key of Object.keys(obj)) {
      const result = findNullPath(
        (obj as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      );
      if (result) {
        return result;
      }
    }
  }
  return undefined;
}

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
  /** Whether to strip null values from YAML before conversion (default: false) */
  /** Note: TOML doesn't support null, so this allows conversion at the cost of losing explicit nulls */
  stripNulls?: boolean;
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
  let data = parseYaml(yamlContent);

  // Check for null values (TOML doesn't support null, so we can't convert YAML with explicit nulls)
  if (hasNullValues(data)) {
    if (options.stripNulls) {
      // Strip null values to allow conversion
      data = removeNullValues(data);
    } else {
      const nullPath = findNullPath(data);
      throw new Error(
        `YAML file contains null values which are not supported by TOML. ` +
          `Field "${nullPath}" has null value; null in YAML indicates "explicitly no value" but TOML has no null type. ` +
          `To convert to TOML, use the stripNulls option or remove all null values from the YAML file first. ` +
          `Note: This means YAML->TOML->YAML round-trip will lose explicit nulls.`,
      );
    }
  }

  // Convert to TOML - data is guaranteed to have no nulls
  if (!isTomlMap(data)) {
    throw new Error("Invalid data structure for TOML conversion");
  }
  const tomlContent = stringifyToml(data);

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
  const tomlFiles = globSync(join(inputDir, "**/*.{toml,TOML}"));

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

  // Find all YAML files (both .yaml and .yml)
  const yamlFiles = globSync(join(inputDir, "**/*.{yaml,yml,YAML,YML}"));

  for (const yamlPath of yamlFiles) {
    try {
      const relativePath = relative(inputDir, yamlPath);
      const tomlPath = join(outputDir, relativePath.replace(/\.(yaml|yml)$/, ".toml"));

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
    // Convert TOML to YAML (only .toml files, not .yml which are already YAML)
    const tomlFiles = globSync(join(factsDir, "**/*.{toml,TOML}"));
    for (const tomlPath of tomlFiles) {
      try {
        const yamlPath = tomlPath.replace(/\.toml$/, ".yaml");
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
    const yamlFiles = globSync(join(factsDir, "**/*.{yaml,yml,YAML,YML}"));
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

  // chokidar v4 removed glob support, so we watch the directory and filter events
  const watcher = watch(factsDir, {
    persistent: true,
    ignoreInitial: true,
    // Only watch files with these extensions
    ignored: (path: string) => {
      const basename = path.split(/[\\/]/).pop() || "";
      return !/\\.(toml|yaml|yml)$/i.test(basename) || basename.startsWith(".");
    },
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
        const pathLower = path.toLowerCase();
        if (toYaml && pathLower.endsWith(".toml")) {
          filesToWrite.add(path.replace(/\.toml$/i, ".yaml"));
        }
        if (toToml && pathLower.endsWith(".yaml")) {
          filesToWrite.add(path.replace(/\.yaml$/i, ".toml"));
        }
        if (toToml && pathLower.endsWith(".yml")) {
          filesToWrite.add(path.replace(/\.yml$/i, ".toml"));
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
          try {
            callback(result);
          } catch (callbackError) {
            console.error("Error in watch callback:", callbackError);
          }
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
  try {
    const initialResult = await syncTomlYaml(factsDir, { ...restOptions, toYaml, toToml });
    if (callback) {
      callback(initialResult);
    }
  } catch (error) {
    // If initial sync fails, close the watcher and re-throw
    watcher.close();
    throw error;
  }

  return () => watcher.close();
}
