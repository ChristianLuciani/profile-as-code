/**
 * pasco sync - synchronize TOML and YAML fact files.
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

import { join } from "node:path";
import type { SyncResult, TomlToYamlOptions, YamlToTomlOptions } from "@profile-as-code/core";
import { factsDir, syncTomlYaml, watchTomlYaml } from "@profile-as-code/core";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section, setJsonMode } from "../output.js";
import { resolveWorkspace } from "../workspace.js";

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
export async function runSync(args: SyncArgs): Promise<number> {
  const {
    workspace,
    toYaml = false,
    toToml = false,
    watch = false,
    overwrite = false,
    json = false,
  } = args;

  // Validate arguments
  if (!toYaml && !toToml && !watch) {
    return report("sync", false, EXIT.USAGE, {
      error: {
        kind: "usage",
        message:
          "Please specify at least one of --to-yaml, --to-toml, or --watch (note: --watch implies bidirectional sync by default)",
      },
    });
  }

  // Resolve workspace and get facts directory
  const resolvedWorkspace = resolveWorkspace(workspace);
  const factsDirectory = join(resolvedWorkspace, factsDir(resolvedWorkspace));

  // Set JSON mode for output
  if (json) {
    setJsonMode(true);
  }

  try {
    if (watch) {
      // Watch mode: sync both directions automatically
      line(`Watching ${factsDirectory} for changes...`);

      const stopWatch = await watchTomlYaml(
        factsDirectory,
        {
          toYaml: true,
          toToml: true,
          overwrite,
        },
        (result) => {
          reportSyncResult(result, "watch");
        },
      );

      // Handle graceful shutdown
      process.on("SIGINT", () => {
        stopWatch();
        line("Watch mode stopped.");
        process.exit(0);
      });

      // Keep process running
      process.stdin.resume();
      return EXIT.OK;
    } else {
      // Single sync operation
      const options: TomlToYamlOptions &
        YamlToTomlOptions & { toYaml?: boolean; toToml?: boolean } = {
        overwrite,
        toYaml,
        toToml,
      };

      const result = await syncTomlYaml(factsDirectory, options);
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
function reportSyncResult(result: SyncResult, _command: string): number {
  if (isJsonMode()) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.errors.length > 0 ? EXIT.FAIL : EXIT.OK;
  }

  // Human-readable output
  if (result.converted.length > 0) {
    section("Converted files");
    for (const file of result.converted) {
      line(`  \u001b[32m\u2713\u001b[0m ${file}`);
    }
  }

  if (result.skipped.length > 0) {
    section("Skipped files (already exist)");
    for (const file of result.skipped) {
      line(`  \u001b[33m-\u001b[0m ${file}`);
    }
  }

  if (result.errors.length > 0) {
    section("Errors");
    for (const { file, error } of result.errors) {
      line(`  \u001b[31m\u2717\u001b[0m ${file}: ${error}`);
    }
    return EXIT.FAIL;
  }

  if (result.converted.length === 0 && result.skipped.length === 0) {
    line("No files to sync.");
  }

  line(
    `Sync complete: ${result.converted.length} converted, ${result.skipped.length} skipped, ${result.errors.length} errors.`,
  );
  return EXIT.OK;
}
