/**
 * pasco skills:export <dir> [--force] | --list
 *
 * Copies the platform skills this package ships (SPEC §16, D5/D6) into a
 * directory the user names. The CLI never projects into a harness-specific
 * path (those differ per agent and have no verified source — #254 C1), and it
 * never reads a repo the user does not have.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { UsageError } from "../contract.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report } from "../output.js";
import { listChannels, NOT_SHIPPED_MESSAGE, skillsDir } from "../skill-path.js";

export interface SkillsExportArgs {
  dir?: string;
  list: boolean;
  force: boolean;
}

/** Recursively count files below `dir` (for the export report). */
function countFiles(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name));
    else total += 1;
  }
  return total;
}

export function runSkillsExport(args: SkillsExportArgs): number {
  if (!args.list && args.dir === undefined) {
    throw new UsageError("usage: pasco skills:export <dir> [--force] | pasco skills:export --list");
  }
  if (args.list && args.dir !== undefined) {
    throw new UsageError("--list takes no destination — run them separately");
  }

  const root = skillsDir();
  if (root === undefined) {
    return report("skills:export", false, EXIT.FAIL, {
      error: { kind: "skills", message: NOT_SHIPPED_MESSAGE },
    });
  }

  const platforms = listChannels(root);

  if (args.list) {
    if (isJsonMode()) {
      return report("skills:export", true, EXIT.OK, { data: { root, platforms } });
    }
    line(`pasco skills:export: ${platforms.length} skill channels shipped with this package`);
    line(`  ${root}`);
    for (const platform of platforms) line(`  - ${platform}`);
    line("  run: pasco skills:export <dir>   # copy them into a directory you name");
    return EXIT.OK;
  }

  const destination = resolve(args.dir as string);
  if (destination === resolve(root) || destination.startsWith(`${resolve(root)}${sep}`)) {
    return report("skills:export", false, EXIT.FAIL, {
      error: {
        kind: "destination",
        message: "the destination cannot be inside the shipped skills tree",
      },
    });
  }
  if (existsSync(destination) && !statSync(destination).isDirectory()) {
    return report("skills:export", false, EXIT.FAIL, {
      error: { kind: "destination", message: `${destination} exists and is not a directory` },
    });
  }
  if (existsSync(destination) && readdirSync(destination).length > 0 && !args.force) {
    return report("skills:export", false, EXIT.FAIL, {
      error: {
        kind: "destination",
        message: `${destination} is not empty — pass --force to overlay the shipped skills`,
      },
    });
  }
  mkdirSync(destination, { recursive: true });
  cpSync(root, destination, {
    recursive: true,
    force: true,
    filter: (source) => !source.endsWith(".DS_Store"),
  });

  const files = countFiles(root);
  if (isJsonMode()) {
    return report("skills:export", true, EXIT.OK, {
      data: { root, destination, platforms, files },
    });
  }
  line(
    `pasco skills:export: copied ${platforms.length} skill channels (${files} files) to ${destination}`,
  );
  return EXIT.OK;
}
