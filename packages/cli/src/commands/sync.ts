/**
 * pasco sync  synchronize TOML and YAML fact files.
 * 
 * Enables users to edit TOML files (more human-friendly, less indentation errors)
 * while the engine continues to work with YAML. This provides the best of both
 * worlds: TOML for human editing and YAML for engine compatibility.
 * 
 * Usage:
 *   pasco sync --to-yaml          Convert all TOML files to YAML
 *   pasco sync --to-toml          Convert all YAML files to TOML
 *   pasco sync --watch            Watch for changes and sync automatically
 */

import type { SyncResult, TomlToYamlOptions, YamlToTomlOptions } from "@profile-as-code/core";
import { syncTomlYaml, watchTomlYaml } from "@profile-as-code/core";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";
import { resolveWorkspace, WORKSPACE_NAME } from "../workspace.js";

/** Arguments for the sync command */
export interface SyncArgs {
  workspace: string;
  /** Convert TOML files to YAML */
  toYaml?: boolean;
  /** Convert YAML files to TOML */
  toToml?: boolean;
  /** Watch for changes and sync automatically */
  watch?: boolean;
  /** Overwrite existing files */
  overwrite?: boolean;
  /** JSON output mode */
  json?: boolean;
}

/**
 * Run the sync command.
 * Converts between TOML and YAML formats for fact files.
 */
export function runSync(args: SyncArgs): number {
  const { workspace, toYaml = false, toToml = false, watch = false, overwrite = false, json = false } = args;

  // Validate arguments
  if (!toYaml && !toToml && !watch) {
    return report("sync", false, EXIT.USAGE, {
      error: {
        kind: "usage",
        message: "Please specify --to-yaml, --to-toml, or --watch",
      },
    });
  }

  if (toYaml && toToml) {
    return report("sync", false, EXIT.USAGE, {
      error: {
        kind: "usage",
        message: "Cannot specify both --to-yaml and --to-toml at the same time",
      },
    });
  }

  // Resolve workspace
  const factsDir = resolveWorkspace(workspace, WORKSPACE_NAME);

  // Set JSON mode for output
  if (json) {
    setJsonMode(true);
  }

  try {
    if (watch) {
      // Watch mode: sync both directions automatically
      line("sync", `Watching ${factsDir} for changes...`);
      
      const stopWatch = watchTomlYaml(factsDir, {
        toYaml: true,
        toToml: true,
        overwrite,
      }, (result) => {
        reportSyncResult(result, "watch");
      });

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        stopWatch();
        line("sync", "Watch mode stopped.");
        process.exit(0);
      });

      // Keep process running
      process.stdin.resume();
      return EXIT.OK;
    } else {
      // Single sync operation
      const options: TomlToYamlOptions & YamlToTomlOptions & { toYaml?: boolean; toToml?: boolean } = {
        overwrite,
        toYaml,
        toToml,
      };

      const result = syncTomlYaml(factsDir, options);
      return reportSyncResult(result, "sync");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return report("sync", false, EXIT.FAIL, {
      error: {
        kind: "sync",
        message: `Sync failed: ${message}`,
      },
    });
  }
}

/**
 * Report the result of a sync operation.
 */
function reportSyncResult(result: SyncResult, command: string): number {
  if (isJsonMode()) {
    line(command, JSON.stringify(result));
    return result.errors.length > 0 ? EXIT.FAIL : EXIT.OK;
  }

  // Human-readable output
  if (result.converted.length > 0) {
    section(command, "Converted files");
    for (const file of result.converted) {
      line(command, `  [32m✓[0m ${file}`);
    }
  }

  if (result.skipped.length > 0) {
    section(command, "Skipped files (already exist)");
    for (const file of result.skipped) {
      line(command, `  [33m-[0m ${file}`);
    }
  }

  if (result.errors.length > 0) {
    section(command, "Errors");
    for (const { file, error } of result.errors) {
      line(command, `  [31m✗[0m ${file}: ${error}`);
    }
    return EXIT.FAIL;
  }

  if (result.converted.length === 0 && result.skipped.length === 0) {
    line(command, "No files to sync.");
  }

  line(command, `Sync complete: ${result.converted.length} converted, ${result.skipped.length} skipped, ${result.errors.length} errors.`);
  return EXIT.OK;
}

/**
 * Parse sync command arguments from process.argv.
 */
export function parseSyncArgs(args: string[]): SyncArgs {
  const workspace = args[0] || ".";
  const toYaml = args.includes("--to-yaml");
  const toToml = args.includes("--to-toml");
  const watch = args.includes("--watch");
  const overwrite = args.includes("--overwrite") || args.includes("-f");
  const json = args.includes("--json");

  return {
    workspace,
    toYaml,
    toToml,
    watch,
    overwrite,
    json,
  };
}
