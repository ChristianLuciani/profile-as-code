#!/usr/bin/env node
/**
 * pasco — the profile-as-code CLI. Full command reference: packages/cli/README.md
 * (refine/check are partial and each one says what still owns the
 * rest).
 *
 * Consumes @profile-as-code/core (load/driftCheck/geoCheck/compile); never
 * re-implements them. Exit codes: 0 ok · 1 schema/workspace failure · 2 usage.
 * Human output EN by default (D8/§11); `--json` machine-readable on every
 * command that reports data.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runAudit } from "./commands/audit.js";
import { runBuild } from "./commands/build.js";
import { runCheck } from "./commands/check.js";
import { runDiff } from "./commands/diff.js";
import { runEdit } from "./commands/edit.js";
import { runInit } from "./commands/init.js";
import { runPost } from "./commands/post.js";
import { runRefine } from "./commands/refine.js";
import { runSkillsExport } from "./commands/skills-export.js";
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
  edit <contract-path>          Resolve one contract field; --set writes it (comment-preserving,
          [--set <text> [--check]]  validated, atomic) and --set --check previews the published lines
  diff [--json]                 Changes since the last release tag (git-based → CHANGELOG hint)
  refine <platform> [--lang]    PARTIAL: emit agent task template; --choose <id> records the
          [--variants N]        chosen variant in content/active.yaml (agent-driven, D11/D13;
                                full variant flow M3)
  check [platform]              Executes offline rules: brand handle matrix (M6/§17,
                                brand flavor), registry checks (M7/§18.8) and
                                media-transport rules (M8/§18.6) and max-chars/min-chars
                                over headlines/bios (offline, #240) and fact-present
                                (the built surface's facts vs the SSOT, #283);
                                remaining rows M3/M4
  audit [--json]                Offline diagnostic projection: findings only (no score,
                                no prioritisation) in three fixed classes — dangling-ref,
                                contradiction, unsourced-claim; stricter than
                                validate/check on those classes; exit 1 iff any FAIL
  post <subcommand>             MVP (week-1 experiment): seed → task bundle → choose →
                                check → optional Postiz draft payload. No LLM call.
                                Subcommands: seed · task · choose · check · export · import · list
  status [platform] [--verify]   Per-entry deploy report — origin · surfaces · in-sync/stale/never
                                 + certification (D18/§19.5); --verify runs the opt-in C1
                                 live check (the engine's ONE network path, §19.5)
  skills:export <dir>           Copy the skill channels this package ships into <dir>
          [--force] [--list]     (--force overlays; --list shows them); no harness paths

Common flags (after the command):
  --workspace <path>  Workspace path (resolution: --workspace > .pascorc > cwd, D14)
  --json              Machine-readable output
  --help, -h          Command help

Exit codes: 0 ok · 1 schema/workspace failure, or a data finding that blocks the
command (edit: the address is not one row, or the edit does not change the
published artifact) · 2 usage error. Drift warnings exit 0 (D12: facts warn,
schema fails).

pasco is free (MIT). Consider a tip ;)
  https://ko-fi.com/christianluciani · https://github.com/sponsors/ChristianLuciani

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
  set?: string;
  check?: boolean;
  at?: string;
  "write-checklist"?: boolean;
  completeness?: boolean;
  selection?: boolean;
  view?: string;
  verify?: boolean;
  channel?: string;
  variant?: string;
  text?: string;
  target?: string;
  out?: string;
  type?: string;
  date?: string;
  list?: boolean;
  force?: boolean;
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
  build: `pasco build [platform] [--view <name>] [--lang <l>] [--json] [--workspace <path>]
Deterministic base texts per platform+lang (compile() slices). No platform =
all platforms. lang defaults to .pascorc defaults.lang or 'en'.
--view resolves a declared view (D22/§21): its rule may carry the platform, the
lang and the fact selection, so the surface shows a SUBSET of the SSOT. Every
omission is reported as a warning; an addressed key that resolves to nothing is
an error. No selection policy = byte-identical output.`,
  edit: `pasco edit <contract-path> [--set <text> [--check]] [--json] [--workspace <path>]
Resolve ONE contract field (epic #247, S1–S5 — read · preview · write · surface impact · cap pre-flight · agent contract):
  positioning.statement.<lang>
  headlines[platform=<p>,lang=<l>].text
  bios[platform=<p>,lang=<l>,length=<len>].text
  identity.links[platform=<p>,label=<l>].url     (read-only; label optional)
Without --set it prints the current value. With --set it WRITES the value — a
byte-range splice over the original text (the CST locates, it never
re-serializes), so comments, layout and CRLF survive and the diff is one line;
the result is validated by load()+schema over a temp copy and only then replaces
the file atomically. Block scalars (|, >), multi-line scalars and anchored or
aliased scalars are refused in v1 (they would move the line count or silently
change every alias); re-setting an identical value is a noop (exit 0, nothing
written). Concurrent pasco edit writers on one workspace serialize on
content/.pasco-edit.lock (a second waits 2 s, then refuses; a crash-left lock is
broken after 30 s). The PREVIEW applies the same addressed-shape checks (scalar
kind, anchor, staleness, a read-only file); a read-only directory or a validation
failure is only detected by the write.
With --set --check it PREVIEWS instead: it renders the surface the way
\`pasco build\` does — active variant (#238) → renderer → shared paste source,
current vs proposed — and prints the artifact lines the edit changes, saying so
(with the reason) when the edit does not reach the artifact.
Every run against a resolved, writable address also prints the edited unit's
SURFACE IMPACT from the §19 ledger: each
recorded surface prints stale (the edit changed the hash) or in-sync (it still
matches), and a unit with no record rolls up to never — derived, never stored.
The block also carries the measured drift count.
A headline/bio value is pre-flighted against the catalog's own max-chars cap (the
workspace's checks.yaml, else the sourced caps shipped with pasco) and prints the
cap, its cited source and tier; over-cap is a WARNING (D12), never a block, and a platform
with no sourced cap reads \`cap: unknown\`.
An active variant (#238) on the addressed platform is NAMED (edit never chooses the
live variant — that is refine --choose).
\`--json\` payload { address, current, proposed, rendered, ok, noop, written,
warnings, stale, state, drift, limit, over, variant, reason } inside the usual
envelope
(command · ok · exitCode);
warnings carries a non-blocking finding the write proceeded through.
Exit: 0 a read / written / noop / the preview changes the artifact · 1 the address
did not resolve to exactly one row, the target is read-only or changed under the
command (stale — nothing was written), the validation refused the result, or
(preview) the artifact does not change · 2 usage (malformed address, unknown
platform or language, read-only field, block or multi-line scalar, anchored/aliased
scalar, a value with a line break, an empty --set, --check without --set).`,
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
(M8/§18.6), max-chars/min-chars over the headline/bio rows that exist
(offline, #240; optional surface selector), and fact-present (#283) — only for
the surfaces whose catalog declares it (content/checks.yaml + the shipped
skills/<platform>/checks.yaml): the artifact pasco build last wrote and the
SSOT render are compared in BOTH directions (a URL/date/number either side
carries and the other does not, a URL the surface adds, prose no token
explains), else WARN (D12). A declared surface with no artifact reports the
rule as not run, never OK; declared: [] says no catalog declares the premise.
Remaining rows in content/checks.yaml ship with the skills checks.yaml union
(M3) and the full pasco check (M4). Prints its owner line
(src/commands/check.ts).`,
  audit: `pasco audit [--json] [--workspace <path>]
The offline diagnostic projection over the identity (SPEC §7.1, issue #283):
findings only — no score, no prioritisation, no branding (those belong to the
consuming layer). Three fixed classes, each with a fixed severity:
  dangling-ref     a pointer that does not resolve in the current view   FAIL
  contradiction    two surfaces assert incompatible values for one datum  FAIL
  unsourced-claim  a quantitative claim with no evidence                 WARN
It is deliberately STRICTER than validate/check on these classes: D12 governs
validity (facts warn), the audit's contract is publishability, so a drift fact
in a FAIL class exits 1 here and 0 there (declared in SPEC §7.1).
Composes load (schema), driftCheck with validate's #238 variant-store
reconciliation, geoCheck (the faq-coverage premise gate only), the
completeness evidence premise and fact-present (the built surface's facts vs
the SSOT render, symmetric; it runs only where the catalog declares it). Touches no network, and no finding derives from
content/deployments.yaml.
--json emits { schemaVersion: "1", scope: { declared, checked, notRun }, findings:
[ { class, severity, path, detail } ] }. scope is the artifact side: declared = targeted surfaces whose catalog
declares fact-present (workspace checks + the shipped skills checks.yaml),
checked = declared surfaces compared, notRun = declared but no artifact —
declared: [] or checked: [] means nothing was measured, never "clean". path is a factRef (row id in place
of the index when the grammar block declares one) or the artifact path for a
surface finding. Exit: 0 no FAIL finding (WARN-only included) · 1 at least one
FAIL, or a schema/load failure · 2 usage error.`,
  "skills:export": `pasco skills:export <dir> [--force] [--json]
pasco skills:export --list [--json]
Copies the skill channels this package ships (SPEC §16) into a directory you
name. --list shows them; an existing non-empty directory needs --force (files are
overlaid, nothing is deleted). No harness-specific destination is invented.`,
  post: `pasco post <seed|task|choose|check|export|import|list> [...] [--json] [--workspace <path>]
MVP (week-1 experiment): a post is a PROJECTION of a seed, not an identity fact.
  seed <id> --text <file>          create posts/<id>/seed.md + post.yaml
  task <id> --channel <c1,c2> [--variants N]
                                   emit posts/<id>/<channel>/task.md (agent task:
                                   seed + facts + skill + channel rules); no LLM call
  choose <id> --channel <c> --variant <v> [--text <file>]
                                   record the chosen variant in post.yaml
  check <id>                       max-chars, URLs only from the SSOT, {{fact:...}}
                                   refs resolve; unsourced numeric claims warn
  export <id> [--target postiz] [--out <file>] [--type draft|schedule|now] [--date <iso>]
                                   build a Postiz POST /posts payload (integration
                                   IDs from postiz.yaml; REPLACE_ME when missing)
  import <dir> --channel <c>       import historical .md posts as seeds
  list                             list seeds and their chosen variants`,
  status: `pasco status [platform] [--mark <ledgerKey> <surface>] [--at <iso8601>] [--verify] [--write-checklist] [--completeness] [--json] [--workspace <path>]
Per-entry deploy-status report (D18, §19): ledger key · origin (template/user) ·
surfaces published · sync state (in-sync / stale / never) · certification
(verified / attested / unverifiable / out-of-band-drift, §19.5) — plus untracked
rows (add an id to track) and removed keys (ledger keeps the audit trail).
It ends with the DERIVED publication truth per surface (SPEC §20.1, #242):
  <surface>: <sync> · artifact: <matches-SSOT|diverges|absent> · limits: <ok|over(cap)>
— the artifact on disk vs what the SSOT renders TODAY (offline; offline cap
warnings carry their source). Derived, never stored: nothing here writes.
  --mark <ledgerKey> <surface>  confirm a manual paste: records deployedAt + the
        CURRENT contentHash in content/deployments.yaml (only pasco writes it,
        D14) plus certification.state attested — and the artifactHash ANCHOR when
        the surface can produce one. --at overrides the timestamp. The anchor is
        the digest of profiles/<surface>/README.md (what \`pasco build\` wrote, so
        \`--lang\` is honoured); with no build artifact on disk it renders at
        .pascorc defaults.lang instead.
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
        the percentage is DERIVED — only the policy is ever stored. Carries the
        publication-coverage line (SPEC §20.1): coverage, never a new score.
  --selection [--view <name>]   the resolved VIEW (D22/§21): what the surface
        emits, every entry it omits and WHY. Read-only. Policy from .pascorc
        "selection". Subset-only by design — the report exists so an omission is
        never silent.`,
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
      const { flags, positionals } = parseCommandFlags(rest, {
        lang: { type: "string" },
        view: { type: "string" },
      });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.build}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 1)
        throw new UsageError("usage: pasco build [platform] [--view <name>] [--lang <l>] [--json]");
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runBuild({
        workspace,
        platformArg: positionals[0],
        viewArg: flags.view,
        langArg: flags.lang,
        pascorc,
      });
    }
    case "edit": {
      const { flags, positionals } = parseCommandFlags(rest, {
        set: { type: "string" },
        check: { type: "boolean" },
      });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.edit}\n`);
        return EXIT.OK;
      }
      if (positionals.length !== 1) {
        throw new UsageError("usage: pasco edit <contract-path> [--set <text> [--check]]");
      }
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runEdit({
        workspace,
        addressArg: positionals[0],
        setArg: flags.set,
        check: flags.check === true,
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
      return runCheck({
        workspace,
        platformArg: positionals[0],
        pascorc: readWorkspacePascorc(workspace),
      });
    }
    case "audit": {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.audit}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 0) {
        throw new UsageError("usage: pasco audit [--json] [--workspace <path>]");
      }
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runAudit({ workspace, pascorc });
    }
    case "post": {
      const { flags, positionals } = parseCommandFlags(rest, {
        channel: { type: "string" },
        variants: { type: "string" },
        variant: { type: "string" },
        text: { type: "string" },
        target: { type: "string" },
        out: { type: "string" },
        type: { type: "string" },
        date: { type: "string" },
      });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.post}\n`);
        return EXIT.OK;
      }
      if (positionals.length < 1 || positionals.length > 2) {
        throw new UsageError(
          "usage: pasco post <seed|task|choose|check|export|import|list> [<seed-id|dir>] [flags]",
        );
      }
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runPost({
        workspace,
        subcommand: positionals[0],
        ...(positionals[1] !== undefined ? { seedArg: positionals[1] } : {}),
        channelArg: flags.channel,
        variantsArg: flags.variants,
        variantArg: flags.variant,
        textArg: flags.text,
        targetArg: flags.target,
        outArg: flags.out,
        typeArg: flags.type,
        dateArg: flags.date,
        pascorc,
      });
    }
    case "status": {
      const { flags, positionals } = parseCommandFlags(rest, {
        mark: { type: "string" },
        at: { type: "string" },
        "write-checklist": { type: "boolean" },
        completeness: { type: "boolean" },
        selection: { type: "boolean" },
        view: { type: "string" },
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
        selection: flags.selection,
        viewArg: flags.view,
        verify: flags.verify,
        completenessPolicy: pascorc.completeness,
        selectionPolicy: pascorc.selection,
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
    case "skills:export": {
      const { flags, positionals } = parseCommandFlags(rest, {
        list: { type: "boolean" },
        force: { type: "boolean" },
      });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP["skills:export"]}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 1) {
        throw new UsageError(
          "usage: pasco skills:export <dir> [--force] | pasco skills:export --list",
        );
      }
      setJsonMode(flags.json === true);
      return runSkillsExport({
        dir: positionals[0],
        list: flags.list === true,
        force: flags.force === true,
      });
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
