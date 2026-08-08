#!/usr/bin/env node
/**
 * pac — the profile-as-code CLI (M1).
 *
 * Consumes @profile-as-code/core (load/driftCheck/geoCheck/compile); never
 * re-implements them. Exit codes: 0 ok · 1 schema/workspace failure · 2 usage.
 * Human output EN by default (D8/§11); `--json` machine-readable on every
 * command that reports data.
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runBuild } from './commands/build.js';
import { runCheck } from './commands/check.js';
import { runDiff } from './commands/diff.js';
import { runInit } from './commands/init.js';
import { runRefine } from './commands/refine.js';
import { runSkillsInstall } from './commands/skills-install.js';
import { runValidate } from './commands/validate.js';
import { UsageError } from './contract.js';
import { EXIT } from './exit.js';
import { setJsonMode } from './output.js';
import { ConfigError, readWorkspacePacrc, resolveWorkspace } from './workspace.js';

const VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
})();

const GLOBAL_HELP = `pac — profile-as-code CLI v${VERSION}

Commands:
  init [dir]                    Scaffold a user-brand-data workspace (content/, README.md, .pacrc)
  validate [--json]             Schema (FAIL, exit 1) + drift/geo (WARN, exit 0) — D12
  build [platform] [--lang]     Deterministic base texts per platform+lang
  diff [--json]                 Changes since the last release tag (git-based → CHANGELOG hint)
  refine <platform> [--lang]    STUB: emit agent task template; --choose <id> records the
          [--variants N]        chosen variant in content/active.yaml (agent-driven, D11/D13)
  check [platform]              STUB: list user checks from content (schema-validated catalog)
  skills:install <agent>        STUB: print the skills-studio projection command

Common flags (after the command):
  --workspace <path>  Workspace path (resolution: --workspace > .pacrc > cwd, D14)
  --json              Machine-readable output
  --help, -h          Command help

Exit codes: 0 ok · 1 schema/workspace failure · 2 usage error.
Drift warnings exit 0 (D12: facts warn, schema fails).

See packages/cli/README.md for details.
`;

interface FlagOptions {
  workspace?: string;
  json?: boolean;
  help?: boolean;
  lang?: string;
  variants?: string;
  choose?: string;
}

function parseCommandFlags(args: string[], extra: Record<string, { type: 'string' | 'boolean' }> = {}): {
  flags: FlagOptions;
  positionals: string[];
} {
  let values: FlagOptions;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args,
      options: {
        workspace: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        ...extra,
      },
      allowPositionals: true,
      strict: true,
    });
    values = parsed.values as FlagOptions;
    positionals = parsed.positionals;
  } catch (err) {
    // strict:true throws on unknown options / bad values → usage error (exit 2)
    throw new UsageError((err as Error).message);
  }
  return { flags: values, positionals };
}

const COMMAND_HELP: Record<string, string> = {
  init: `pac init [dir]
Scaffold a user-brand-data workspace skeleton (SPEC §9): content/identity.yaml,
README.md, .pacrc. Minimal but pac validate-clean. Refuses to overwrite.
  dir   target directory (default: current directory)`,
  validate: `pac validate [--json] [--workspace <path>]
Load + validate the workspace (D12): schema violations FAIL (exit 1); drift and
GEO are warnings (exit 0). See schema/README.md "Validation semantics".`,
  build: `pac build [platform] [--lang <l>] [--json] [--workspace <path>]
Deterministic base texts per platform+lang (compile() slices). No platform =
all platforms. lang defaults to .pacrc defaults.lang or 'en'.`,
  diff: `pac diff [--json] [--workspace <path>]
Git-based: what changed since the last tag matching release-* (.pacrc
diff.tagPattern) — commits + changed content files → CHANGELOG hint.`,
  refine: `pac refine <platform> [--lang <l>] [--variants N] [--choose <variantId>] [--json] [--workspace <path>]
STUB (agent-driven, D11/D13): without --choose, emits the task template the
executing agent works from. With --choose, records the chosen variant in
content/active.yaml. No LLM call, no hub.`,
  check: `pac check [platform] [--json] [--workspace <path>]
STUB: lists the user checks declared in content/checks.yaml (schema-validated
catalog). Rule execution ships with M3 (skills checks.yaml union) + M4.`,
  'skills:install': `pac skills:install <agent>
STUB: prints the skills-studio projection command for <agent> (pi|claude|aionui|opencode).
Projection is the skills-studio job (AGOS), not implemented in M1.`,
};

function runMain(): number {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stderr.write(GLOBAL_HELP + '\n');
    return EXIT.USAGE;
  }

  const command = argv[0];
  const rest = argv.slice(1);

  switch (command) {
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(GLOBAL_HELP + '\n');
      return EXIT.OK;
    case '--version':
    case '-v':
    case 'version':
      process.stdout.write(`pac ${VERSION}\n`);
      return EXIT.OK;
    case 'init': {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.init + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 1) throw new UsageError('usage: pac init [dir]');
      setJsonMode(flags.json === true);
      return runInit({ cwd: process.cwd(), dir: positionals[0] });
    }
    case 'validate': {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.validate + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 0) throw new UsageError('usage: pac validate [--json] [--workspace <path>]');
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      return runValidate({ workspace });
    }
    case 'build': {
      const { flags, positionals } = parseCommandFlags(rest, { lang: { type: 'string' } });
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.build + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 1) throw new UsageError('usage: pac build [platform] [--lang <l>] [--json]');
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pacrc = readWorkspacePacrc(workspace);
      return runBuild({
        workspace,
        platformArg: positionals[0],
        langArg: flags.lang,
        pacrc,
      });
    }
    case 'diff': {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.diff + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 0) throw new UsageError('usage: pac diff [--json] [--workspace <path>]');
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pacrc = readWorkspacePacrc(workspace);
      return runDiff({ workspace, pacrc });
    }
    case 'refine': {
      const { flags, positionals } = parseCommandFlags(rest, {
        lang: { type: 'string' },
        variants: { type: 'string' },
        choose: { type: 'string' },
      });
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.refine + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 1) throw new UsageError('usage: pac refine <platform> [--lang <l>] [--variants N] [--choose <id>]');
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pacrc = readWorkspacePacrc(workspace);
      return runRefine({
        workspace,
        platformArg: positionals[0],
        langArg: flags.lang,
        variantsArg: flags.variants,
        choose: flags.choose,
        pacrc,
      });
    }
    case 'check': {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.check + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 1) throw new UsageError('usage: pac check [platform] [--json] [--workspace <path>]');
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      return runCheck({ workspace, platformArg: positionals[0] });
    }
    case 'skills:install': {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP['skills:install'] + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 1) throw new UsageError('usage: pac skills:install <agent>');
      setJsonMode(flags.json === true);
      return runSkillsInstall({ agent: positionals[0] });
    }
    default:
      throw new UsageError(`unknown command "${command}" — run "pac --help" for the command list`);
  }
}

let exitCode: number;
try {
  exitCode = runMain();
} catch (err) {
  if (err instanceof UsageError) {
    process.stderr.write(`usage: ${err.message}\n`);
    exitCode = EXIT.USAGE;
  } else if (err instanceof ConfigError) {
    process.stderr.write(`config error: ${err.message}\n`);
    exitCode = EXIT.FAIL;
  } else {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    exitCode = EXIT.FAIL;
  }
}
process.exitCode = exitCode;
