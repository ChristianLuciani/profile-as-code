#!/usr/bin/env node
/**
 * pasco — the profile-as-code CLI (M1).
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
import { runStatus } from './commands/status.js';
import { runValidate } from './commands/validate.js';
import { parseFlavor, UsageError } from './contract.js';
import { WORKSPACE_NAME } from './workspace.js';
import { EXIT } from './exit.js';
import { setJsonMode } from './output.js';
import { ConfigError, readWorkspacePascorc, resolveWorkspace } from './workspace.js';

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

const GLOBAL_HELP = `pasco — profile-as-code CLI v${VERSION}

Commands:
  init [dir]                    Scaffold a ${WORKSPACE_NAME} workspace (content/, README.md, .pascorc)
  validate [--json]             Schema (FAIL, exit 1) + drift/geo (WARN, exit 0) — D12
  build [platform] [--lang]     Deterministic base texts per platform+lang
  diff [--json]                 Changes since the last release tag (git-based → CHANGELOG hint)
  refine <platform> [--lang]    STUB: emit agent task template; --choose <id> records the
          [--variants N]        chosen variant in content/active.yaml (agent-driven, D11/D13)
  check [platform]              STUB: list user checks from content (schema-validated catalog)
  status [platform] [--mark …]   Per-entry deploy report — origin · surfaces · in-sync/stale/never (D17)
  skills:install <agent>        STUB: print the skills-studio projection command

Common flags (after the command):
  --workspace <path>  Workspace path (resolution: --workspace > .pascorc > cwd, D14)
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
  flavor?: string;
  mark?: string;
  at?: string;
  'write-checklist'?: boolean;
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
  init: `pasco init [dir] [--flavor person|brand]
Scaffold a ${WORKSPACE_NAME} workspace skeleton (SPEC §9): content/identity.yaml,
README.md, .pascorc. Minimal but pasco validate-clean. Refuses to overwrite.
  --flavor person|brand   workspace flavor (D15/§17); brand scaffolds the org
                          identity variant + socialHandles/newsletter/podcast/
                          press/audiences blocks. Default: person.
  dir   target directory (default: current directory)`,
  validate: `pasco validate [--json] [--workspace <path>]
Load + validate the workspace (D12): schema violations FAIL (exit 1); drift and
GEO are warnings (exit 0). See schema/README.md "Validation semantics".`,
  build: `pasco build [platform] [--lang <l>] [--json] [--workspace <path>]
Deterministic base texts per platform+lang (compile() slices). No platform =
all platforms. lang defaults to .pascorc defaults.lang or 'en'.`,
  diff: `pasco diff [--json] [--workspace <path>]
Git-based: what changed since the last tag matching release-* (.pascorc
diff.tagPattern) — commits + changed content files → CHANGELOG hint.`,
  refine: `pasco refine <platform> [--lang <l>] [--variants N] [--choose <variantId>] [--json] [--workspace <path>]
STUB (agent-driven, D11/D13): without --choose, emits the task template the
executing agent works from. With --choose, records the chosen variant in
content/active.yaml. No LLM call, no hub.`,
  check: `pasco check [platform] [--json] [--workspace <path>]
STUB: lists the user checks declared in content/checks.yaml (schema-validated
catalog). Rule execution ships with M3 (skills checks.yaml union) + M4.`,
  'skills:install': `pasco skills:install <agent>
STUB: prints the skills-studio projection command for <agent> (pi|claude|aionui|opencode).
Projection is the skills-studio job (AGOS), not implemented in M1.`,
  status: `pasco status [platform] [--mark <ledgerKey> <surface>] [--at <iso8601>] [--write-checklist] [--json] [--workspace <path>]
Per-entry deploy-status report (D17, §18): ledger key · origin (template/user) ·
surfaces published · sync state (in-sync / stale / never) — plus untracked rows
(add an id to track) and removed keys (ledger keeps the audit trail).
  --mark <ledgerKey> <surface>  confirm a manual paste: records deployedAt + the
        CURRENT contentHash in content/deployments.yaml (only pasco writes it,
        D14). --at overrides the timestamp.
  --write-checklist             regenerate CHECKLIST.md from the ledger
        (AUTO-GENERATED view — do not edit by hand).`,
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
      process.stdout.write(`pasco ${VERSION}\n`);
      return EXIT.OK;
    case 'init': {
      const { flags, positionals } = parseCommandFlags(rest, { flavor: { type: 'string' } });
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.init + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 1) throw new UsageError('usage: pasco init [dir] [--flavor person|brand]');
      setJsonMode(flags.json === true);
      return runInit({
        cwd: process.cwd(),
        dir: positionals[0],
        ...(flags.flavor !== undefined ? { flavor: parseFlavor(flags.flavor) } : {}),
      });
    }
    case 'validate': {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.validate + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 0) throw new UsageError('usage: pasco validate [--json] [--workspace <path>]');
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
      if (positionals.length > 1) throw new UsageError('usage: pasco build [platform] [--lang <l>] [--json]');
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runBuild({
        workspace,
        platformArg: positionals[0],
        langArg: flags.lang,
        pascorc,
      });
    }
    case 'diff': {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.diff + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 0) throw new UsageError('usage: pasco diff [--json] [--workspace <path>]');
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runDiff({ workspace, pascorc });
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
      if (positionals.length > 1) throw new UsageError('usage: pasco refine <platform> [--lang <l>] [--variants N] [--choose <id>]');
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runRefine({
        workspace,
        platformArg: positionals[0],
        langArg: flags.lang,
        variantsArg: flags.variants,
        choose: flags.choose,
        pascorc,
      });
    }
    case 'check': {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.check + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 1) throw new UsageError('usage: pasco check [platform] [--json] [--workspace <path>]');
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      return runCheck({ workspace, platformArg: positionals[0] });
    }
    case 'status': {
      const { flags, positionals } = parseCommandFlags(rest, {
        mark: { type: 'string' },
        at: { type: 'string' },
        'write-checklist': { type: 'boolean' },
      });
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP.status + '\n');
        return EXIT.OK;
      }
      if (flags.mark !== undefined && positionals.length !== 1) {
        throw new UsageError('usage: pasco status --mark <ledgerKey> <surface> [--at <iso8601>]');
      }
      if (flags.mark === undefined && positionals.length > 1) {
        throw new UsageError('usage: pasco status [platform] [--write-checklist] [--json]');
      }
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      return runStatus({
        workspace,
        platformArg: positionals[0],
        markKey: flags.mark,
        markAt: flags.at,
        writeChecklist: flags['write-checklist'],
      });
    }
    case 'skills:install': {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(COMMAND_HELP['skills:install'] + '\n');
        return EXIT.OK;
      }
      if (positionals.length > 1) throw new UsageError('usage: pasco skills:install <agent>');
      setJsonMode(flags.json === true);
      return runSkillsInstall({ agent: positionals[0] });
    }
    default:
      throw new UsageError(`unknown command "${command}" — run "pasco --help" for the command list`);
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
