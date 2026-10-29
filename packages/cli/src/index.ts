#!/usr/bin/env node
/**
 * pasco — the profile-as-code CLI. Full command reference: packages/cli/README.md
 * (refine/check are partial and each one says what still owns the
 * rest).
 *
 * Consumes @profile-as-code/core (load/driftCheck/geoCheck/compile); never
 * re-implements them. Exit codes: 0 ok · 1 schema/workspace failure, an unmet
 * `.pascorc` engine requirement (validate · build · export profile), or a data
 * finding that blocks the command (edit · audit · entity · export ai-policy ·
 * a malformed export profile --now) · 2 usage.
 * Human output EN by default (D8/§11); `--json` machine-readable on every
 * command that reports data.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PROFILE_SCHEMA_VERSION } from "@profile-as-code/core";
import { runAudit } from "./commands/audit.js";
import { runBuild } from "./commands/build.js";
import { runCheck } from "./commands/check.js";
import { runCiteCheck } from "./commands/cite-check.js";
import { runDiff } from "./commands/diff.js";
import { runDoctor } from "./commands/doctor.js";
import { runEdit } from "./commands/edit.js";
import { runEntity } from "./commands/entity.js";
import { runAiPolicyCheck, runAiPolicyExport } from "./commands/export.js";
import { runExportProfile } from "./commands/export-profile.js";
import { runInit } from "./commands/init.js";
import { runPost } from "./commands/post.js";
import { runRefine } from "./commands/refine.js";
import { runSkillsExport } from "./commands/skills-export.js";
import { runStatus } from "./commands/status.js";
import { runValidate } from "./commands/validate.js";
import { parseFlavor, parseLang, UsageError } from "./contract.js";
import type { EngineConfigSource } from "./engine-gate.js";
import { engineGateError, evaluateEngineRequirements } from "./engine-gate.js";
import { EXIT } from "./exit.js";
import { httpFetchText } from "./fetch-http.js";
import { report, setJsonMode } from "./output.js";
import {
  ConfigError,
  defaultsLang,
  readEnginePascorcSources,
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
  doctor [--json]               Engine · schema · workspace on one line (SPEC §7.6, #348):
                                installed version, the profile contract it validates,
                                and whether the workspace loads; also reports the
                                .pascorc engine requirement (unmet ⇒ exit 1)
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
  entity [--json] [--jsonld]    The schema.org entity projection: facts, @id, sameAs and
          [--out <file> [--force]] [--bare] [--lang <l>]
                                readiness gaps as JSON, or the paste-ready JSON-LD block
                                the renderers embed; for surfaces the engine does not
                                render. Exit 1 when @id is absent (no declared home)
  cite-check [<answers.ndjson>] Match the workspace's entity against saved answer-engine
          [--json]              answers (NDJSON; stdin when no path). Offline, no model,
                                no clock: per answer it reports cited · confidence · spans
                                · reasons, never a rate; exit 2 on malformed NDJSON
  post <subcommand>             MVP (week-1 experiment): seed → task bundle → choose →
                                check → optional Postiz draft payload. No LLM call.
                                Subcommands: seed · task · choose · check · export · import · list
  status [platform] [--verify]   Per-entry deploy report — origin · surfaces · in-sync/stale/never
                                 + certification (D18/§19.5); --verify runs the opt-in C1
                                 live check (the engine's ONE network path, §19.5)
  export ai-policy              Write the AI-policy artifacts (SPEC §7.3, M9): robots.txt
          [--out <dir> | --check] [--lang <l>]  (two named groups — listed retrieval crawlers
                                allowed, listed training crawlers disallowed, no wildcard) +
                                llms.txt (the workspace index) + AI-POLICY.md, into <dir>;
                                --check (exit 1) fails an unsourced, stale or incomplete entry
  export profile [--json]       The normalized profile for programmatic consumers (SPEC §7.5,
          [--now <iso8601>]     #348): { schemaVersion, engine, source: { commit, generatedAt },
                                profile } — every root the workspace declares, plus every list
                                root defaulted to [], from the same load() the other commands
                                use. No clock is read: generatedAt is null unless --now pins
                                it. Offline; byte-identical across runs
  skills:export <dir>           Copy the skill channels this package ships into <dir>
          [--force] [--list]     (--force overlays; --list shows them); no harness paths

Common flags (after the command):
  --workspace <path>  Workspace path (resolution: --workspace > .pascorc > cwd, D14)
  --json              Machine-readable output
  --help, -h          Command help

Exit codes: 0 ok · 1 schema/workspace failure, a .pascorc engine requirement that
the installed CLI does not meet (validate · build · export profile), or a data
finding that blocks the
command (edit: the address is not one row or the edit does not change the
published artifact; audit: at least one FAIL finding; entity: no canonical @id;
export ai-policy: an unsourced or stale UA list, or a refused write;
cite-check: the input file cannot be read) · 2 usage error (cite-check: malformed
NDJSON, never a silent skip). Drift warnings exit 0 (D12: facts warn, schema fails).

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
  jsonld?: boolean;
  bare?: boolean;
  now?: string;
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
GEO are warnings (exit 0). See schema/README.md "Validation semantics".
A .pascorc "engine" requirement is enforced BEFORE the load: an installed engine
older than the declared minimum fails with the installed version, the required
version and the upgrade command (SPEC §7.6).`,
  doctor: `pasco doctor [--json] [--workspace <path>]
Engine · schema · workspace on one line (SPEC §7.6, #348):
  engine    the installed pasco version
  schema    the profile contract version this build validates (from the schema $id)
  workspace the resolved path, whether it loads, and the effective .pascorc
            engine requirement (the strictest declaration in every config the
            resolution consulted, with the file it came from · met / NOT MET /
            INVALID · upgrade command)
It writes nothing, reads no clock and touches no network. Exit: 0 healthy
(workspace loads and any declared engine requirement is met) · 1 unhealthy (the
workspace fails to load, or the requirement is unmet/malformed) · 2 usage. It
reports the same truth the gate enforces; it does not replace the gate.`,
  build: `pasco build [platform] [--view <name>] [--lang <l>] [--json] [--workspace <path>]
Deterministic base texts per platform+lang (compile() slices). No platform =
all platforms. lang defaults to .pascorc defaults.lang or 'en'.
A .pascorc "engine" requirement is enforced before any render (SPEC §7.6).
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
in a FAIL class exits 1 here and 0 there (declared in SPEC §7.1). Two inputs are
declared no-class rules and are NOT findings: drift/url-not-in-identity (the
URL resolves — canonicalization, which validate warns about) and geoCheck's
coverage codes.
Composes load (schema), driftCheck with validate's #238 variant-store
reconciliation, geoCheck (the faq-coverage premise gate only), the
completeness evidence premise and fact-present (the built surface's facts vs
the SSOT render, symmetric; it runs only where the catalog declares it).
Touches no network, and no finding derives from content/deployments.yaml.
--json emits { schemaVersion: "1", scope: { catalog, declared, checked, notRun },
findings: [ { class, severity, path, detail } ] }. scope is the artifact side:
catalog = shipped | not-shipped (a package without its skills tree cannot declare
anything, and says so); declared = targeted surfaces whose catalog
declares fact-present (workspace checks + the shipped skills checks.yaml),
checked = declared surfaces compared, notRun = declared but no artifact —
declared: [] or checked: [] means nothing was measured, never "clean". path is a factRef (row id in place
of the index when the grammar block declares one) or the artifact path for a
surface finding. Exit: 0 no FAIL finding (WARN-only included) · 1 at least one
FAIL, or a schema/load failure · 2 usage error.`,
  entity: `pasco entity [--json | --jsonld [--out <file> [--force]] [--bare]] [--lang <l>] [--workspace <path>]
The entity projection for a surface this engine does not render (SPEC §7.2, #287):
the schema.org entity the renderers embed, exposed as an artifact.
  --json     the frozen view { schemaVersion: "1", entity: { id, type, name, sameAs,
             email }, gaps: [{ code, detail }], jsonld: null }. entity.id is null when
             no link declares role: identity — the engine never invents an @id. gaps
             are the structured-data geoCheck codes that scored below 1, verbatim.
  --jsonld   the SAME assembler output the renderers embed (core/src/structured-data.ts,
             one home — never a second emitter), serialized as a paste-ready
             <script type="application/ld+json"> block. Parsing it yields exactly
             structuredData()'s object.
    --bare   emit the bare JSON object instead of the <script> block.
    --out <file>  write the block to <file> instead of stdout; an existing file
                  is refused (nothing is truncated) unless --force is passed.
  --lang <l> the assembler language for BOTH modes (default: .pascorc
             defaults.lang, else 'en'). The readiness gaps are measured in it.
Exit: 0 when @id is present · 1 when it is absent (the entity has no declared home;
the JSON-LD is still emitted, without @id) · 2 usage error. Offline and
deterministic: no network, no clock, no AI.`,
  "cite-check": `pasco cite-check [<answers.ndjson>] [--json] [--workspace <path>]
Match the workspace's declared entity against SAVED answer-engine answers
(SPEC §7.4, issue #291). The input is the runner's NDJSON, one object per line
— the engine produces none of it:
  { "engine": "chatgpt", "askedAt": "<iso>", "question": "…", "answer": "…",
    "citations": [ { "url": "https://…", "title": "…" } ] }
"answer" and "citations" are required; "citations": [] declares "no sources".
Read from the path, or from stdin when no path is given (or "-"). Blank lines
are ignored; ANY other malformed line aborts the read with the 1-based line and
the field — never a silent skip.
The match ladder is fixed (SPEC §7.4), one rung per kind:
  citation-url  a citation of the entity's own page or a sameAs target:   HIGH
                host equal/subdomain, and — when the declared URL carries a
                path — that path or a descendant (a declared root URL claims
                the whole host, so github.com/<you> != github.com/someone)
  exact-name    the full name, word-bounded, case/accent-normalized         HIGH
  alias         identity.orgName                                           MEDIUM
  handle        a declared handle (identity.handle, claimed socialHandles)  MEDIUM
  partial       any contiguous multi-token prefix (>= 2 tokens, shorter
                than the name); a term a higher rung already claims is
                not repeated                                                     LOW
Matching is accent-insensitive (Domínguez = Dominguez) and word-bounded, so
"pasco" does not match inside "pascoño". confidence "low" is NEVER a citation
in a downstream report; the engine may say cited: true with low, and the
consumer must refuse it.
It refuses to guess: a one-word name whose sentence has no declared
disambiguator (ambiguous-term:<term> + no-qualifier; the longer capitalised
reading the text carries is then quoted as competing:<phrase>), a mention after
a contrast marker (contrast-context) and a term contained in a longer declared
term (longer-name:<term>) are all quoted in reasons[] as NOT citations. A
declared qualifier or an adjacent capital never disqualifies a hit by itself. A
citation URL the parser rejects (a missing scheme is the common case) is named as
url-invalid:<url>: never repaired, never dropped — a dropped citation would read
as a clean "not cited" and change the rate.
--json emits the frozen contract { schemaVersion: "1", entity: { name, aliases,
handles, partials, hosts }, answers: [ { line, engine, askedAt, question, cited,
confidence, spans, reasons } ] } inside the usual envelope — one row per input
line, in input order, NEVER aggregated (no rate, no score, no total).
Exit: 0 a successful read, whatever the matches (a non-citation is data) ·
1 the workspace cannot load, or the input path cannot be read · 2 usage, or
malformed NDJSON. Offline and deterministic: no network, no model, no clock.`,
  export: `pasco export ai-policy [--out <dir> | --check] [--lang <l>] [--json] [--workspace <path>]
pasco export profile [--json] [--now <iso8601>] [--workspace <path>]

--- export ai-policy -----------------------------------------------------------------
The §12 M9 stance as an artifact. Two modes, deliberately separate (one
writes, one verifies):
  --out <dir>   write robots.txt + llms.txt + AI-POLICY.md into <dir>.
                robots.txt carries TWO named groups and NO wildcard: the crawlers
                listed under ai-retrieval are allowed (Allow: /) and the ones
                listed under ai-training are disallowed (Disallow: /), each
                User-agent line commented with its registry entry, operator,
                source and date. The list is EXPLICIT: a crawler that is not
                listed is not restricted by the file — that limit is declared in
                the file and in AI-POLICY.md, never papered over with a wildcard
                that would also block the search engines it does not name.
                llms.txt is the workspace index — name, definition, canonical
                identity URL, faq[] and publications[] — and the builder ASSERTS
                that every document it claims to index appears in the text.
                AI-POLICY.md is the statement a client can be sent: what is
                allowed, what is blocked, who can change it, the date, quoting
                the M9 floor verbatim.
                An existing file is replaced only when pasco generated it; any
                other is refused unless --force is passed.
  --check       validate the list and write nothing: exit 1 when an entry has no
                source or no operator, a malformed as_of, an as_of older than
                180 days or in the future, a duplicate token (case-insensitive,
                RFC 9309), when either group would be empty, or when
                ai.policy.as_of itself is malformed, stale, future-dated or older
                than the newest crawler row it seals.
                --check reads no workspace (the list is registry data).
The crawler list is derived, never hardcoded here: it is projected from the
\`ai:\` block of the platform registry by \`pnpm gen:platforms\`.
--lang        the language of the llms.txt text (default: .pascorc defaults.lang,
              else 'en').
Exit: 0 ok · 1 a --check problem, a schema/load failure or a write failure ·
2 usage (no ai-policy subcommand, --out with --check, --force without --out).
Offline; --out reads no clock and two runs produce byte-identical files.

--- export profile ------------------------------------------------------------------
The normalized profile for programmatic consumers (SPEC §7.5, #348). One payload,
the same for a script, a site build or a service:
  { schemaVersion, engine, source: { commit, generatedAt }, profile }
  --json        emit the payload inside the standard envelope (command · ok ·
                exitCode · data). Human mode prints a summary of the same object.
  --now <iso>   pin source.generatedAt to this ISO 8601 date-time, verbatim, after a
                real-calendar check (2026-02-31 and T24:00:00 are refused). Without
                it the command reads NO clock: generatedAt is null, so two runs over
                one workspace produce byte-identical output.
profile is exactly what core's load() returns — schema-validated and normalized:
every root the workspace DECLARES, plus every LIST root defaulted to [] (never
absent). An optional object root (newsletter, podcast, audiences, active) appears
only when declared, because the contract has no valid empty value for it. It is
NOT a platform slice: compile(profile, platform) produces that other object, and
this command never calls it. artifactRefs stay ids (a consumer joins them to
profile.artifacts[] by id; load() already refuses a dangling ref),
publications[].url is exactly as declared, deployments is included. It is the
SSOT, not a rendered surface: no visibility filtering (that is §18.5, owned by
the renderers). source.commit is the workspace's git HEAD; null means the
workspace is not inside a git repository.
Exit: 0 ok · 1 the workspace fails to load (schema/ledger/registry — D12) or --now
is malformed · 2 usage (unknown export subcommand, --out/--check/--force/--lang).
Offline and deterministic: no network, no clock unless --now pins one.`,
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

/**
 * Issue #348 — the `.pascorc` engine gate (SPEC §7.6). Returns the exit code to
 * use when the workspace's declared minimum engine is not satisfied (or a
 * declaration is malformed), or `null` when the command may proceed. `sources`
 * is every `.pascorc` the resolution consulted (the cwd pointer AND the
 * workspace's own file), so resolution cannot drop a declaration. The report
 * goes through the standard envelope, so `--json` gets
 * `{ error: { kind, message } }` with the same three facts the human line carries.
 */
function enforceEngineRequirement(
  command: string,
  sources: readonly EngineConfigSource[],
): number | null {
  const requirement = evaluateEngineRequirements(sources, VERSION);
  const error = engineGateError(requirement, VERSION);
  if (error === null) return null;
  return report(command, false, EXIT.FAIL, { error });
}

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
      // Issue #348: the `.pascorc` engine gate runs BEFORE the command does any
      // work, so a workspace written for a newer contract fails with the three
      // facts (installed · required · upgrade) instead of a confusing load error.
      // Every config the resolution consulted is read (cwd pointer + workspace),
      // so a declaration cannot disappear with the pointer file (fresh review F1).
      const engineSources = readEnginePascorcSources(process.cwd(), flags.workspace, workspace);
      const engineGate = enforceEngineRequirement("validate", engineSources);
      if (engineGate !== null) return engineGate;
      return runValidate({ workspace });
    }
    case "doctor": {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.doctor}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 0) {
        throw new UsageError("usage: pasco doctor [--json] [--workspace <path>]");
      }
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      return runDoctor({
        workspace,
        engineVersion: VERSION,
        schemaVersion: PROFILE_SCHEMA_VERSION,
        engineSources: readEnginePascorcSources(process.cwd(), flags.workspace, workspace),
      });
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
      const engineSources = readEnginePascorcSources(process.cwd(), flags.workspace, workspace);
      const engineGate = enforceEngineRequirement("build", engineSources);
      if (engineGate !== null) return engineGate;
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
    case "cite-check": {
      const { flags, positionals } = parseCommandFlags(rest);
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP["cite-check"]}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 1) {
        throw new UsageError(
          "usage: pasco cite-check [<answers.ndjson>] [--json] [--workspace <path>]",
        );
      }
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      return runCiteCheck({ workspace, input: positionals[0] });
    }
    case "entity": {
      const { flags, positionals } = parseCommandFlags(rest, {
        jsonld: { type: "boolean" },
        bare: { type: "boolean" },
        out: { type: "string" },
        force: { type: "boolean" },
        lang: { type: "string" },
      });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.entity}\n`);
        return EXIT.OK;
      }
      if (positionals.length > 0) {
        throw new UsageError(
          "usage: pasco entity [--json | --jsonld [--out <file>] [--bare]] [--lang <l>]",
        );
      }
      // Two output contracts and one artifact: mixing them would make a consumer
      // guess whether stdout is an envelope or a paste-ready block (§7.2).
      if (flags.json === true && flags.jsonld === true) {
        throw new UsageError(
          "usage: --json (the view) and --jsonld (the artifact) are separate modes — run them separately",
        );
      }
      if (flags.bare === true && flags.jsonld !== true) {
        throw new UsageError("usage: --bare only applies to --jsonld");
      }
      if (flags.out !== undefined && flags.jsonld !== true) {
        throw new UsageError("usage: --out only applies to --jsonld");
      }
      if (flags.force === true && (flags.jsonld !== true || flags.out === undefined)) {
        throw new UsageError("usage: --force only applies to --jsonld --out <file>");
      }
      setJsonMode(flags.json === true);
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runEntity({
        workspace,
        pascorc,
        jsonld: flags.jsonld === true,
        bare: flags.bare === true,
        ...(flags.out !== undefined ? { out: flags.out } : {}),
        force: flags.force === true,
        lang: flags.lang !== undefined ? parseLang(flags.lang) : defaultsLang(pascorc),
      });
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
    case "export": {
      const { flags, positionals } = parseCommandFlags(rest, {
        out: { type: "string" },
        check: { type: "boolean" },
        force: { type: "boolean" },
        lang: { type: "string" },
        now: { type: "string" },
      });
      if (flags.help === true) {
        process.stdout.write(`${COMMAND_HELP.export}\n`);
        return EXIT.OK;
      }
      const subcommand = positionals[0];
      if (positionals.length !== 1 || (subcommand !== "ai-policy" && subcommand !== "profile")) {
        throw new UsageError(
          "usage: pasco export <ai-policy | profile> — ai-policy: --out <dir> | --check; profile: [--json] [--now <iso8601>]",
        );
      }
      // `export profile` is a read-only projection: the writer/verifier flags of
      // `ai-policy` would be a request it cannot honour, so they are refused
      // instead of ignored.
      if (subcommand === "profile") {
        if (
          flags.out !== undefined ||
          flags.check === true ||
          flags.force === true ||
          flags.lang !== undefined
        ) {
          throw new UsageError(
            "usage: pasco export profile [--json] [--now <iso8601>] — --out/--check/--force/--lang do not apply",
          );
        }
        setJsonMode(flags.json === true);
        const workspace = resolveWorkspace(process.cwd(), flags.workspace);
        const engineSources = readEnginePascorcSources(process.cwd(), flags.workspace, workspace);
        const engineGate = enforceEngineRequirement("export profile", engineSources);
        if (engineGate !== null) return engineGate;
        return runExportProfile({
          workspace,
          engineVersion: VERSION,
          ...(flags.now !== undefined ? { nowArg: flags.now } : {}),
        });
      }
      if (flags.out === undefined && flags.check !== true) {
        throw new UsageError(
          "usage: pasco export ai-policy needs --out <dir> (write) or --check (verify)",
        );
      }
      if (flags.now !== undefined) {
        throw new UsageError(
          "usage: --now only applies to export profile (ai-policy reads its own dates)",
        );
      }
      // One mode writes and one verifies: combining them would make a failing
      // check silently produce files, which is the rot this command exists to stop.
      if (flags.out !== undefined && flags.check === true) {
        throw new UsageError("usage: --out writes and --check verifies — run them separately");
      }
      if (flags.force === true && flags.out === undefined) {
        throw new UsageError("usage: --force only applies to --out <dir>");
      }
      if (flags.lang !== undefined && flags.out === undefined) {
        throw new UsageError(
          "usage: --lang only applies to --out <dir> (--check loads no workspace)",
        );
      }
      setJsonMode(flags.json === true);
      if (flags.out === undefined) {
        return runAiPolicyCheck({ now: new Date() });
      }
      const workspace = resolveWorkspace(process.cwd(), flags.workspace);
      const pascorc = readWorkspacePascorc(workspace);
      return runAiPolicyExport({
        workspace,
        out: flags.out,
        force: flags.force === true,
        lang: flags.lang !== undefined ? parseLang(flags.lang) : defaultsLang(pascorc),
        pascorc,
        now: new Date(),
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
