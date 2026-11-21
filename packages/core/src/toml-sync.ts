/**
 * TOML <-> YAML synchronization utilities.
 *
 * This module provides functions to convert between TOML and YAML formats,
 * enabling users to edit TOML files (more human-friendly, less indentation errors)
 * while the engine continues to work with YAML.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { FACT_FILE_RE } from "./load.js";

// Per-format extension predicates with the SAME case-insensitive semantics as
// load()'s FACT_FILE_RE (load.ts) — one spelling of "valid fact file" everywhere.
// Never re-express these as glob brace patterns (`*.{toml,TOML}`): braces only
// cover all-lower/all-upper and silently miss mixed case like `id.Yml`, and
// glob's `nocase` option is platform-dependent.
const TOML_FILE_RE = /\.toml$/i;
const YAML_FILE_RE = /\.ya?ml$/i;

/** List the fact files under `dir` matching `extRe` (dotfiles/dot-dirs excluded, so
 *  `.pasco-edit.lock` and `.git/` never appear). A missing or unreadable dir lists
 *  as empty. `recursive` walks subdirectories (the directory converters); `false`
 *  is the flat facts-dir listing, matching load(). */
function listFactFiles(dir: string, extRe: RegExp, recursive: boolean): string[] {
  let entries: string[];
  try {
    entries = recursive
      ? readdirSync(dir, { recursive: true, encoding: "utf-8" })
      : readdirSync(dir, "utf-8");
  } catch {
    return [];
  }
  return entries
    .filter((entry) => {
      const segments = entry.split(/[\\/]/);
      if (segments.some((segment) => segment.startsWith("."))) return false;
      const base = segments[segments.length - 1] ?? "";
      return FACT_FILE_RE.test(base) && extRe.test(base);
    })
    .sort()
    .map((entry) => join(dir, entry));
}

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

  // Already in sync: skip the write so watch mode cannot ping-pong on our own output
  if (overwrite && existsSync(yamlPath) && readFileSync(yamlPath, "utf-8") === yamlContent) {
    return false;
  }

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

  // Already in sync: skip the write so watch mode cannot ping-pong on our own output
  if (overwrite && existsSync(tomlPath) && readFileSync(tomlPath, "utf-8") === tomlContent) {
    return false;
  }

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

  // Find all TOML files (case-insensitive, recursive)
  const tomlFiles = listFactFiles(inputDir, TOML_FILE_RE, true);

  for (const tomlPath of tomlFiles) {
    try {
      const relativePath = relative(inputDir, tomlPath);
      const yamlPath = join(outputDir, relativePath.replace(/\.toml$/i, ".yaml"));

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
  // Find all YAML files (.yaml and .yml, any case)
  const yamlFiles = listFactFiles(inputDir, YAML_FILE_RE, true);

  for (const yamlPath of yamlFiles) {
    try {
      const relativePath = relative(inputDir, yamlPath);
      const tomlPath = join(outputDir, relativePath.replace(/\.(yaml|yml)$/i, ".toml"));

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
 * Converts TOML files to YAML (or vice versa). Only the TOP LEVEL of `factsDir`
 * is synced: `load()` reads the facts dir flat, so files in subdirectories are
 * not fact files and are left alone.
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
  // Fail loudly on a missing dir (same contract as watchTomlYaml) — a one-shot
  // sync on a nonexistent facts dir must not exit 0 with "No files to sync".
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(factsDir);
  } catch {
    throw new Error(`cannot sync: directory not found: ${factsDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`cannot sync: not a directory: ${factsDir}`);
  }
  const result: SyncResult = { converted: [], skipped: [], errors: [] };

  if (toYaml) {
    // Convert TOML to YAML (only .toml files, not .yml which are already YAML)
    const tomlFiles = listFactFiles(factsDir, TOML_FILE_RE, false);
    for (const tomlPath of tomlFiles) {
      try {
        const yamlPath = tomlPath.replace(/\.toml$/i, ".yaml");
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
    const yamlFiles = listFactFiles(factsDir, YAML_FILE_RE, false);
    for (const yamlPath of yamlFiles) {
      try {
        const tomlPath = yamlPath.replace(/\.(yaml|yml)$/i, ".toml");
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
 * Each changed file is converted to its MIRROR only — the rest of the tree is
 * never re-scanned, so a YAML→TOML pass can never rewrite a TOML file the user
 * just edited (which would strip its comments and formatting). Writes made by
 * the watcher itself are recognized by content and never converted back.
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
  // Fail loudly on a missing dir instead of resolving into a silently dead watch
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(factsDir);
  } catch {
    throw new Error(`cannot watch: directory not found: ${factsDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`cannot watch: not a directory: ${factsDir}`);
  }
  const { watch } = await import("chokidar");

  // Content of the mirror files WE wrote. An event for such a file whose content
  // still matches is an echo of our own write and is never converted back.
  const writtenByUs = new Map<string, string>();
  // Collect changed files during the debounce period
  const changedFiles = new Set<string>();
  let debounceTimer: NodeJS.Timeout | null = null;

  /** The mirror path a change to `path` should propagate to, if any. */
  const mirrorOf = (path: string): string | undefined => {
    const lower = path.toLowerCase();
    if (toYaml && lower.endsWith(".toml")) return path.replace(/\.toml$/i, ".yaml");
    if (toToml && lower.endsWith(".yaml")) return path.replace(/\.yaml$/i, ".toml");
    if (toToml && lower.endsWith(".yml")) return path.replace(/\.yml$/i, ".toml");
    return undefined;
  };

  /** Convert ONE source file to its mirror, recording our own writes. */
  const convertOne = (src: string, overwrite: boolean): SyncResult => {
    const result: SyncResult = { converted: [], skipped: [], errors: [] };
    const dst = mirrorOf(src);
    if (dst === undefined) return result;
    try {
      const ok = src.toLowerCase().endsWith(".toml")
        ? tomlToYamlFile(src, dst, { ...restOptions, overwrite })
        : yamlToTomlFile(src, dst, { ...restOptions, overwrite });
      if (ok) {
        result.converted.push(`${src} -> ${dst}`);
        writtenByUs.set(dst, readFileSync(dst, "utf-8"));
      } else {
        result.skipped.push(src);
      }
    } catch (error) {
      result.errors.push({
        file: src,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return result;
  };

  const mergeInto = (into: SyncResult, part: SyncResult): void => {
    into.converted.push(...part.converted);
    into.skipped.push(...part.skipped);
    into.errors.push(...part.errors);
  };

  const notify = (result: SyncResult): void => {
    if (!callback) return;
    try {
      callback(result);
    } catch (callbackError) {
      console.error("Error in watch callback:", callbackError);
    }
  };

  // chokidar v4 removed glob support, so we watch the directory and filter events.
  // depth 0 matches load()'s flat facts read: subdirectory files are not synced.
  const watcher = watch(factsDir, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    ignored: (path: string) => {
      // Only segments INSIDE the watched root decide — an ancestor like
      // ~/.config/… or .worktrees/… must not disable the watcher.
      const rel = relative(factsDir, path);
      const segments = rel.split(/[\\/]/);
      // Dotfiles and dot-directories inside the tree (.git, .pasco-edit.lock, …)
      if (segments.some((segment) => segment.startsWith("."))) return true;
      const basename = segments[segments.length - 1] ?? "";
      // Directories (no extension) must NOT be ignored: ignoring one prunes its
      // whole subtree and the watcher would never fire on any file inside it.
      if (!/\.[^.\\/]+$/.test(basename)) return false;
      return !/\.(toml|yaml|yml)$/i.test(basename);
    },
  });

  // Debounced per-file sync: each changed file is converted to its mirror ONLY.
  const scheduleSync = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      const batch = [...changedFiles];
      changedFiles.clear();
      const result: SyncResult = { converted: [], skipped: [], errors: [] };
      // Echoes of our own writes are dropped FIRST, so an echo never masks a
      // real edit of the mirror that landed in the same window.
      const real = batch.filter((path) => {
        const written = writtenByUs.get(path);
        if (written === undefined) return true;
        try {
          return readFileSync(path, "utf-8") !== written; // changed since: a real edit
        } catch {
          writtenByUs.delete(path); // it disappeared: stop tracking it
          return true;
        }
      });
      // A file and its mirror both changed in the SAME debounce window is a
      // conflict: converting both directions would silently lose one — report it.
      const inBatch = new Set(real);
      const conflicts = new Set<string>();
      for (const path of real) {
        const mirror = mirrorOf(path);
        if (mirror !== undefined && inBatch.has(mirror)) {
          conflicts.add(path);
          conflicts.add(mirror);
        }
      }
      for (const path of real) {
        if (conflicts.has(path)) continue;
        mergeInto(result, convertOne(path, true));
      }
      for (const path of [...conflicts].sort()) {
        result.errors.push({
          file: path,
          error: `conflict: ${path} and ${mirrorOf(path)} both changed in the same debounce window — neither was synced; edit one of them again to resolve`,
        });
      }
      if (result.converted.length > 0 || result.skipped.length > 0 || result.errors.length > 0) {
        notify(result);
      }
    }, 100); // 100ms debounce
  };

  // Handle file events (unlink deliberately does nothing: deleting a source file
  // never deletes its mirror — the engine reads the YAML side).
  const handleFileEvent = (path: string) => {
    changedFiles.add(path);
    scheduleSync();
  };

  watcher.on("add", handleFileEvent);
  watcher.on("change", handleFileEvent);

  // Resolve only once chokidar finished its initial scan: with ignoreInitial,
  // an edit that lands before "ready" would be swallowed as part of the scan.
  await new Promise<void>((resolve, reject) => {
    watcher.on("ready", () => resolve());
    watcher.on("error", (err) => reject(err));
  });

  // Initial sync: create MISSING mirrors only (overwrite: false) — a counterpart
  // that already exists is an ambiguous state the human resolves, never clobbered.
  // Both listings are computed before any write so a just-created mirror is not
  // converted back in the same pass.
  const initial: SyncResult = { converted: [], skipped: [], errors: [] };
  const sources = [
    ...(toYaml ? listFactFiles(factsDir, TOML_FILE_RE, false) : []),
    ...(toToml ? listFactFiles(factsDir, YAML_FILE_RE, false) : []),
  ];
  for (const src of sources) {
    mergeInto(initial, convertOne(src, false));
  }
  notify(initial);

  return () => watcher.close();
}
