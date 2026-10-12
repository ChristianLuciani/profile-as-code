#!/usr/bin/env node
/**
 * pasco — the profile-as-code CLI. Full command reference: packages/cli/README.md
 * (refine/check/skills:install are partial and each one says what still owns the
 * rest).
 *
 * Consumes @profile-as-code/core (load/driftCheck/geoCheck/compile); never
 * re-implements them. Exit codes: 0 ok · 1 schema/workspace failure · 2 usage.
 * Human output EN by default (D8/§11); `--json` machine-readable on every
 * command that reports data.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runBuild } from "./commands/build.js";
import { runCheck } from "./commands/check.js";
import { runDiff } from "./commands/diff.js";
import { runInit } from "./commands/init.js";
import { runRefine } from "./commands/refine.js";
import { runSkillsInstall } from "./commands/skills-install.js";
import { runStatus } from "./commands/status.js";
import { runValidate } from "./commands/validate.js";
import { parseFlavor, UsageError } from "./contract.js";
import { EXIT } from "./exit.js";
import { httpFetchText } from "./fetch-http.js";
import { setJsonMode } from "./output.js";
import {
  ConfigError,
  defaultsLang,
  readWorkspacePascorc,
  resolveWorkspace,
  WORKSPACE_NAME,
} from "./workspace.js";

const VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
})();

const GLOBAL_HELP = `pasco — profile-as-code CLI v${VERSION}

Commands:
  init [dir]                    Scaffold a ${WORKSPACE_NAME} workspace (content/, README.md, .pascorc)
  validate [--json]             Schema (FAIL, exit 1) + drift/geo (WARN, exit 0) — D12
  build [platform] [--lang]     Deterministic base texts per platform+lang
  diff [--json]                 Changes since the last release tag (git-based → CHANGELOG hint)
  refine <platform> [--lang]    PARTIAL: emit agent task template; --choose <id> records the
          [--variants N]        chosen variant in content/active.yaml (agent-driven, D11/D13;
                                full variant flow M3)
  check [platform]              Executes offline rules: brand handle matrix (M6/§17,
                                brand flavor), registry checks (M7/§18.8) and
                                media-transport rules (M8/§18.6); content/checks.yaml
                                rows are listed as not executed (M3/M4)
  status [platform] [--verify]   Per-entry deploy report — origin · surfaces · in-sync/stale/never
                                 + certification (D18/§19.5); --verify runs the opt-in C1
                                 live check (the engine's ONE network path, §19.5)
  skills:install <agent>        Prints the skills-studio projection command (AGOS);
                                projecting stays the studio's job, not the CLI's

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
  "write-checklist"?: boolean;
  completeness?: boolean;
  verify?: boolean;
}

function parseCommandFlags(
  args: string[],
  extra: Record<string, { type: "string" | "boolean" }> = {},
): {
  flags: FlagOptions;
  positionals: string[];
} {
  let values: FlagOptions;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args,
      options: {
        workspace: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
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
PARTIAL (agent-driven, D11/D13): without --choose, emits the task template the
executing agent works from. With --choose, records the chosen variant in
content/active.yaml. No LLM call, no hub. Full variant flow: M3.`,
  check: `pasco check [platform] [--json] [--workspace <path>]
Executes the offline rules that exist today: the brand handle matrix (brand
flavor, D15/§17), registry checks (M7/§18.8) and media-transport rules
(M8/§18.6). Rows declared in content/checks.yaml (schema-validated catalog)
are listed and reported as not executed — rule execution for those ships with
the skills checks.yaml union (M3) and the full pasco check (M4). Prints its
owner line (src/commands/check.ts).`,
  "skills:install": `pasco skills:install <agent>
Prints the skills-studio projection command for <agent> (pi|claude|aionui|opencode).
Projection is the skills-studio job (AGOS), not the CLI's.`,
  status: `pasco status [platform] [--mark <ledgerKey> <surface>] [--at <iso8601>] [--verify] [--write-checklist] [--completeness] [--json] [--workspace <path>]
Per-entry deploy-status report (D18, §19): ledger key · origin (template/user) ·
surfaces published · sync state (in-sync / stale / never) · certification
(verified / attested / unverifiable / out-of-band-drift, §19.5) — plus untracked
rows (add an id to track) and removed keys (ledger keeps the audit trail).
  --mark <ledgerKey> <surface>  confirm a manual paste: records deployedAt + the
        CURRENT contentHash in content/deployments.yaml (only pasco writes it,
        D14) plus certification.state attested — and the artifactHash ANCHOR when
        the surface can produce one. --at overrides the timestamp.
  --verify [platform]           §19.5 C1: the opt-in live check — the engine's ONE
        network-touching path. Resolves each recorded surface's artifact URL from
        the URL SSOT, validates its host against the surface's declared allowlist
        BEFORE any request, fetches sequentially without retries (one request per
        surface), and updates certification in place. v1: GitHub raw only; an
        unavailable check is unverifiable WITH the honest reason, never an error.
        A record with no anchor reads unverifiable: unattributed (anchors are
        forward-only in v1 — re-confirm with --mark to record one).
  --write-checklist             regenerate CHECKLIST.md from the ledger + the
        completeness line (AUTO-GENERATED view — do not edit by hand). Each
        surface carries its certification token.
  --completeness                profile-completeness checklist + percentage
        (issue #102). Policy (target/weights/langs) from .pascorc "completeness";
        the percentage is DERIVED — only the policy is ever stored.`,
};

async function runMain(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stderr.write(`${GLOBAL_HELP}\n`);
    return EXIT.USAGE;
  }

  const command = argv[0];
  const rest = argv.slice(1);

  switch (command) {
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(`${GLOBAL_HELP}\n`);
      return EXIT.OK;
    case "--version":
    case "-v":
    case "version":
      process.stdout.write(`pasco ${VERSION}\n`);
      return EXIT.OK;
    case "init": {
      const { flags, positionals } = parseCommandFlags(rest, { flavor: { type: "string" } });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.init}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 1)
        throw new UsageError("usage: pasco init [dir] [--flavor person|brand]");
      setJsonMode(flags.json === true);
      return runInit({
        cwd: process.cwd(),
        dir: positionals[0],
        ...(flags.flavor !== undefined ? { flavor: parseFlavor(flags.flavor) } : {}),
      });
    }
    case "validate": {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.validate}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 0)
        throw new UsageError("usage: pasco validate [--json] [--workspace <path>]");
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      return runValidate({ workspace });
    }
    case "build": {
      const { flags, positionals } = parseCommandFlags(rest, { lang: { type: "string" } });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.build}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 1)
        throw new UsageError("usage: pasco build [platform] [--lang <l>] [--json]");
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
    case "diff": {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.diff}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 0)
        throw new UsageError("usage: pasco diff [--json] [--workspace <path>]");
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runDiff({ workspace, pascorc });
    }
    case "refine": {
      const { flags, positionals } = parseCommandFlags(rest, {
        lang: { type: "string" },
        variants: { type: "string" },
        choose: { type: "string" },
      });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.refine}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 1)
        throw new UsageError(
          "usage: pasco refine <platform> [--lang <l>] [--variants N] [--choose <id>]",
        );
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
    case "check": {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.check}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 1)
        throw new UsageError("usage: pasco check [platform] [--json] [--workspace <path>]");
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      return runCheck({ workspace, platformArg: positionals[0] });
    }
    case "status": {
      const { flags, positionals } = parseCommandFlags(rest, {
        mark: { type: "string" },
        at: { type: "string" },
        "write-checklist": { type: "boolean" },
        completeness: { type: "boolean" },
        verify: { type: "boolean" },
      });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.status}\n`);
        return EXIT.OK;
      }
      if (flags.mark !== undefined && positionals.length !== 1) {
        throw new UsageError("usage: pasco status --mark <ledgerKey> <surface> [--at <iso8601>]");
      }
      if (flags.mark === undefined && positionals.length > 1) {
        throw new UsageError(
          "usage: pasco status [platform] [--write-checklist | --completeness] [--json]",
        );
      }
      if (flags.verify === true && flags.mark !== undefined) {
        throw new UsageError(
          "usage: --verify and --mark are both ledger write paths — run them separately",
        );
      }
      if (flags.verify === true && flags["write-checklist"] === true) {
        throw new UsageError(
          "usage: --verify writes the ledger and --write-checklist writes CHECKLIST.md — run them separately",
        );
      }
      if (flags.verify === true && flags.completeness === true) {
        throw new UsageError(
          "usage: --verify is a live check and --completeness is a read-only report — run them separately",
        );
      }
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return await runStatus({
        workspace,
        platformArg: positionals[0],
        markKey: flags.mark,
        markAt: flags.at,
        writeChecklist: flags["write-checklist"],
        completeness: flags.completeness,
        verify: flags.verify,
        completenessPolicy: pascorc.completeness,
        // §19.5: the `--mark` anchor renders at the same lang `pasco build` wrote,
        // so the digest is of the pasted artifact, not an approximation.
        lang: defaultsLang(pascorc),
        // §19.5: the HTTP driver is the production dep; the surface capabilities
        // are resolved PER WORKSPACE from the loaded profile (`verify.ts`), not
        // passed here — `artifactUrl` reads this workspace's URL SSOT. Tests
        // inject both through `deps`.
        deps: { fetchText: httpFetchText },
      });
    }
    case "skills:install": {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP["skills:install"]}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 1) throw new UsageError("usage: pasco skills:install <agent>");
      setJsonMode(flags.json === true);
      return runSkillsInstall({ agent: positionals[0] });
    }
    default:
      throw new UsageError(
        `unknown command "${command}" — run "pasco --help" for the command list`,
      );
  }
}

let exitCode: number;
try {
  exitCode = await runMain();
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
