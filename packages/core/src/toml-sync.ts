/**
 * TOML <-> YAML synchronization utilities.
 * 
 * This module provides functions to convert between TOML and YAML formats,
 * enabling users to edit TOML files (more human-friendly, less indentation errors)
 * while the engine continues to work with YAML.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

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
  options: TomlToYamlOptions = {}
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
  const tomlContent = readFileSync(tomlPath, 'utf-8');
  const data = parseToml(tomlContent);

  // Convert to YAML
  const yamlContent = stringifyYaml(data, { indent });

  // Write YAML file
  writeFileSync(yamlPath, yamlContent, 'utf-8');

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
  options: YamlToTomlOptions = {}
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
  const yamlContent = readFileSync(yamlPath, 'utf-8');
  const data = parseYaml(yamlContent);

  // Convert to TOML
  const tomlContent = stringifyToml(data);

  // Write TOML file
  writeFileSync(tomlPath, tomlContent, 'utf-8');

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
export function tomlToYamlDirectory(
  inputDir: string,
  outputDir: string,
  options: TomlToYamlOptions = {}
): SyncResult {
  const result: SyncResult = { converted: [], skipped: [], errors: [] };
  const { globSync } = require('glob');

  // Find all TOML files
  const tomlFiles = globSync(join(inputDir, '**/*.toml'));

  for (const tomlPath of tomlFiles) {
    try {
      const relativePath = relative(inputDir, tomlPath);
      const yamlPath = join(outputDir, relativePath.replace('.toml', '.yaml'));

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
export function yamlToTomlDirectory(
  inputDir: string,
  outputDir: string,
  options: YamlToTomlOptions = {}
): SyncResult {
  const result: SyncResult = { converted: [], skipped: [], errors: [] };
  const { globSync } = require('glob');

  // Find all YAML files
  const yamlFiles = globSync(join(inputDir, '**/*.yaml'));

  for (const yamlPath of yamlFiles) {
    try {
      const relativePath = relative(inputDir, yamlPath);
      const tomlPath = join(outputDir, relativePath.replace('.yaml', '.toml'));

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
export function syncTomlYaml(
  factsDir: string,
  options: TomlToYamlOptions & { toYaml?: boolean; toToml?: boolean } = {}
): SyncResult {
  const { toYaml = true, toToml = false, ...restOptions } = options;
  const result: SyncResult = { converted: [], skipped: [], errors: [] };
  const { globSync } = require('glob');

  if (toYaml) {
    // Convert TOML to YAML
    const tomlFiles = globSync(join(factsDir, '**/*.toml'));
    for (const tomlPath of tomlFiles) {
      try {
        const yamlPath = tomlPath.replace('.toml', '.yaml');
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
    // Convert YAML to TOML
    const yamlFiles = globSync(join(factsDir, '**/*.yaml'));
    for (const yamlPath of yamlFiles) {
      try {
        const tomlPath = yamlPath.replace('.yaml', '.toml');
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
export function watchTomlYaml(
  factsDir: string,
  options: TomlToYamlOptions & { toYaml?: boolean; toToml?: boolean } = {},
  callback?: (result: SyncResult) => void
): () => void {
  const { toYaml = true, toToml = false, ...restOptions } = options;
  const { watch } = require('chokidar');

  const watcher = watch(join(factsDir, '**/*.{toml,yaml}'), {
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', (path: string) => {
    const result = syncTomlYaml(factsDir, { ...restOptions, toYaml, toToml });
    if (callback) {
      callback(result);
    }
  });

  // Initial sync
  const initialResult = syncTomlYaml(factsDir, { ...restOptions, toYaml, toToml });
  if (callback) {
    callback(initialResult);
  }

  return () => watcher.close();
}
