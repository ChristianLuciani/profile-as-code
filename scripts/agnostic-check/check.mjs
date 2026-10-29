#!/usr/bin/env node
/**
 * Public-surface agnostic gate (issue #274, AGENTS rule 9).
 *
 * A published surface may only reference what its reader can open. The class
 * this gate closes did not live in one file: private repos and tooling names
 * travelled by copy between docs, help text, tests and session artifacts, so a
 * one-off sweep could not keep them out. The gate turns the rule into a
 * predicate that runs on every PR:
 *
 *   R1 — no tracked text file names a private repo/path/tool declared in
 *        `private-targets.json` (the inventory: operator repos, tooling names
 *        AND their short aliases, private contract names, absolute home paths).
 *        Matching is case-insensitive: a capitalized or uppercase spelling is
 *        the same leak as the declared one. The list is DATA, not a paragraph,
 *        so adding a family target is a reviewable one-line change.
 *   R2 — no tracked text file links a repo target declared `private` in the
 *        same registry, in EVERY clone form: `github.com/<owner>/<repo>`,
 *        `<owner>/<repo>.git`, `git@github.com:<owner>/<repo>` and
 *        `ssh://[git@]github.com/<owner>/<repo>`, the `host:owner/repo`
 *        scp-like form and percent-encoded names — case-insensitively. That is
 *        the #273 clause:
 *        a PR that links a private family repo fails the gate. Visibility is
 *        verified OUT OF BAND (release/pre-merge, where the network is
 *        acceptable) and recorded in the registry; this gate is OFFLINE and
 *        deterministic by design — a visibility probe would make a required
 *        check depend on a third party's uptime and rate limits, the exact
 *        reason `scripts/link-check` never fetches (#132).
 *   R3 — the dated-record allowlist is well-formed and path-based: every entry
 *        declares a repo-relative PATH, a reason and a removal trigger. A file
 *        covered by an entry is exempt; nothing is exempted by matching the
 *        phrase it happens to contain. An entry that suppresses no reference is
 *        reported (`W-ALLOWLIST-UNUSED`) so the registry cannot rot silently —
 *        the same shape as `scripts/link-check/allowlist.json`.
 *
 * Two exemptions, each with its own mechanism:
 *   - AGENTS rule 8 dated records are OUT OF SCOPE BY CLASS and the walker
 *     enforces it (`CHANGELOG.md`, `docs/research/`): history is not rewritten,
 *     so a reference there is evidence, not a live pointer. The corpus's LIVE
 *     instructions (`docs/research/RUN.md`, `02-prompt-investigacion.md`) are
 *     explicit exceptions and stay scanned. Issue/PR bodies are not in the tree.
 *   - Historical copies kept OUTSIDE those classes (the dated build-session
 *     records under `docs/build/`) and synthesized test fixtures are exempt by
 *     PATH in `allowlist.json`, one FILE at a time — a directory prefix would
 *     let a new file inherit an old exemption. A fixture is not a reference at
 *     all: it is an input.
 *
 * Scope: every tracked-by-construction text file in the checkout (`.md`,
 * `.json`, `.yml`, `.ts`, … — see TEXT_EXTENSIONS), including `.github/`.
 * Hidden directories are skipped because they are gitignored session state
 * (#274 removed `.sota/`, `.e2e/`, `.e2e-agentic/` from the tree and put them
 * in `.gitignore`): a local copy of another session's artifacts must not fail
 * the gate. Generated projections (`site/docs/`, `packages/cli/skills/`), the
 * dated-record class (AGENTS rule 8) and this gate's own fixtures/data are
 * excluded by construction, never by silence.
 *
 * Zero dependencies, `node >=22` — runs on a fresh checkout before any install.
 * A file or JSON shape the gate cannot read is an explicit failure (E-GATE),
 * never a silent pass. Output is one line per finding:
 *
 *   E-AGNOSTIC  docs/example.md:12  private name "<name>" — "…snippet…"
 *
 * Usage: `node scripts/agnostic-check/check.mjs [--root <dir>] [--allowlist <file>] [--targets <file>]`
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_ALLOWLIST = path.join(HERE, "allowlist.json");
const DEFAULT_TARGETS = path.join(HERE, "private-targets.json");

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
export class GateError extends Error {}

const RULES = {
  agnostic: "E-AGNOSTIC",
  allowlistInvalid: "E-ALLOWLIST-INVALID",
  targetsInvalid: "E-TARGETS-INVALID",
  allowlistUnused: "W-ALLOWLIST-UNUSED",
  gate: "E-GATE",
};

/** Text extensions the gate reads. Binary files are never guessed at. */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".cff",
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
  ".py",
  ".html",
]);

/**
 * Never descended into: installs and build output (non-hidden). VCS, session
 * state and every other hidden tree are skipped by the hidden-dir rule, which is
 * also why this set must not name them: naming one would print a private name in
 * this file.
 */
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "coverage"]);

/**
 * Generated or test-corpus paths, excluded by construction:
 *   - `site/docs/`            projected documentation (#277), never a source;
 *   - `packages/cli/skills/`  generated copy of `<repo>/skills/` (#254);
 *   - `docs/research/_drafts/` local drafts (gitignored);
 *   - `scripts/agnostic-check/private-targets.json` and `allowlist.json` — the
 *     gate's own data: the inventory must name every private target and an
 *     exemption may explain it by name; that is their content, not a reference;
 *   - `scripts/agnostic-check/fixtures/` this gate's self-test corpus, whose
 *     whole purpose is to CONTAIN the private references it must refuse.
 */
const SKIP_PATH_PREFIXES = [
  "site/docs",
  "packages/cli/skills",
  "docs/research/_drafts",
  "scripts/agnostic-check/private-targets.json",
  "scripts/agnostic-check/allowlist.json",
  "scripts/agnostic-check/fixtures",
];

/**
 * AGENTS rule 8: dated records are exempt AS A CLASS, not per file — history is
 * not rewritten, so a private name inside it is evidence, not a live pointer.
 * This is a scope exclusion (like the generated projections above), NOT an
 * allowlist entry: an allowlist is for historical copies that live outside the
 * class, and an entry that suppresses nothing would only warn forever.
 *   - `CHANGELOG.md`         the released history, source of the release record;
 *   - `docs/research/`       the sourced + dated prior-art corpus (its value is
 *                            the source and its date).
 * Issue/PR bodies are exempt too; they are not in the checkout.
 */
const SCOPE_EXCLUDED_BY_CLASS = [
  {
    path: "CHANGELOG.md",
    reason: "released history — the release record itself",
  },
  {
    path: "docs/research",
    reason: "sourced + dated prior-art corpus (its value is the source and its date)",
    // The corpus also holds LIVE instructions: a runbook the reader executes and
    // the prompt that starts a research session. Those stay scanned, so the class
    // exclusion cannot hide a live pointer inside a dated corpus.
    except: ["docs/research/RUN.md", "docs/research/02-prompt-investigacion.md"],
  },
];

/** True when `rel` is inside a dated-record class and is not a live exception. */
function excludedByClass(rel) {
  for (const rule of SCOPE_EXCLUDED_BY_CLASS) {
    const inside = rel === rule.path || rel.startsWith(`${rule.path}/`);
    if (!inside) continue;
    const except = rule.except ?? [];
    const isException = except.some((entry) => rel === entry || rel.startsWith(`${entry}/`));
    const ancestorOfException = except.some((entry) => entry.startsWith(`${rel}/`));
    if (!isException && !ancestorOfException) return true;
  }
  return false;
}

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A whole-token matcher, CASE-INSENSITIVE: a capitalized or uppercase spelling
 * is the same private name as its canonical one, and a one-word target does not
 * fire inside a longer word.
 */
function tokenMatcher(name) {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(name)}(?![A-Za-z0-9_-])`, "gi");
}

/**
 * A repo-target matcher for EVERY form a reader can paste, case-insensitively
 * (hosts and GitHub paths are not case-sensitive):
 *   - web:            `github.com/<repo>`, with/without scheme and `www.`;
 *   - scp-like:       `git@github.com:<repo>` and `github.com:<repo>` (no user);
 *   - URL schemes:    `ssh://[git@]github.com/<repo>`, `git://…`, `http(s)://…`;
 *   - optional `.git`;
 *   - percent-encoded names (`profile%2Ddata`) — the caller decodes the safe
 *     URL escapes before matching (`decodeUrlEscapes`).
 * A bare `<owner>/<repo>` is NOT matched: it is a name, not a target.
 */
function repoTargetMatcher(repo) {
  const target = `${escapeRegExp(repo)}(?:\\.git)?(?![A-Za-z0-9_.-])`;
  const host = "(?:www\\.)?github\\.com";
  return new RegExp(
    `(?<![A-Za-z0-9.-])(?:(?:https?|ssh|git)://)?(?:[^@\\s/]+@)?${host}[:/]${target}`,
    "gi",
  );
}

/**
 * Decode only the URL-safe escapes a repo target can be written with
 * (`%2D` `-`, `%2F` `/`, `%3A` `:`, `%2E` `.`, `%40` `@`), so a percent-encoded
 * name cannot walk past the matcher. Never throws on an unrelated `%` sequence.
 */
function decodeUrlEscapes(text) {
  return text.replace(/%([0-9A-Fa-f]{2})/g, (match, hex) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return /[A-Za-z0-9._:/@-]/.test(char) ? char : match;
  });
}

function requireString(value, label, rule = RULES.targetsInvalid) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new GateError(`${rule}: ${label} must be a non-empty string`);
  }
  return value;
}

function loadJson(file, label) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw new GateError(`${RULES.gate}: cannot read ${label} ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GateError(`${RULES.gate}: ${label} ${file} is not valid JSON: ${error.message}`);
  }
}

/** Load and validate the private-target inventory into compiled matchers. */
export function loadTargets(file) {
  const data = loadJson(file, "targets file");
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new GateError(`${RULES.targetsInvalid}: targets file must be a JSON object`);
  }
  const matchers = [];
  const seen = new Set();
  const entries = [
    ["privateNames", "name", (value) => `private name ${JSON.stringify(value)}`, tokenMatcher],
    [
      "privateRepos",
      "repo",
      (value) => `private repo target ${JSON.stringify(value)}`,
      repoTargetMatcher,
    ],
  ];
  for (const [key, field, describe, compile] of entries) {
    const list = data[key];
    if (!Array.isArray(list)) {
      throw new GateError(`${RULES.targetsInvalid}: ${key} must be an array`);
    }
    for (const [index, entry] of list.entries()) {
      if (typeof entry !== "object" || entry === null) {
        throw new GateError(`${RULES.targetsInvalid}: ${key}[${index}] must be an object`);
      }
      const value = requireString(entry[field], `${key}[${index}].${field}`);
      requireString(entry.reason, `${key}[${index}].reason`);
      if (key === "privateRepos" && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
        throw new GateError(
          `${RULES.targetsInvalid}: ${key}[${index}].repo must look like <owner>/<repo> (got ${JSON.stringify(value)})`,
        );
      }
      const dedupe = `${key}:${value}`;
      if (seen.has(dedupe)) {
        throw new GateError(
          `${RULES.targetsInvalid}: duplicate ${key} entry ${JSON.stringify(value)}`,
        );
      }
      seen.add(dedupe);
      matchers.push({ regex: compile(value), label: describe(value, entry.reason) });
    }
  }
  const paths = data.operatorPaths;
  if (!Array.isArray(paths)) {
    throw new GateError(`${RULES.targetsInvalid}: operatorPaths must be an array`);
  }
  for (const [index, entry] of paths.entries()) {
    if (typeof entry !== "object" || entry === null) {
      throw new GateError(`${RULES.targetsInvalid}: operatorPaths[${index}] must be an object`);
    }
    const pattern = requireString(entry.pattern, `operatorPaths[${index}].pattern`);
    requireString(entry.reason, `operatorPaths[${index}].reason`);
    let regex;
    try {
      regex = new RegExp(pattern, "g");
    } catch (error) {
      throw new GateError(
        `${RULES.targetsInvalid}: operatorPaths[${index}].pattern does not compile: ${error.message}`,
      );
    }
    const label = `operator path (${entry.label ?? pattern})`;
    matchers.push({ regex, label });
  }
  if (matchers.length === 0) {
    throw new GateError(`${RULES.targetsInvalid}: the inventory declares no matcher`);
  }
  return matchers;
}

/**
 * Load and validate the dated-record allowlist. Entries are PATH prefixes —
 * a phrase can never be exempted, only a file. Overlapping entries are refused
 * so a hit is never double-counted (and so "which entry suppressed this?" has
 * exactly one answer).
 */
export function loadAllowlist(file) {
  const data = loadJson(file, "allowlist");
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new GateError(`${RULES.allowlistInvalid}: allowlist must be a JSON object`);
  }
  const entries = data.entries;
  if (!Array.isArray(entries)) {
    throw new GateError(`${RULES.allowlistInvalid}: entries must be an array`);
  }
  const normalized = [];
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== "object" || entry === null) {
      throw new GateError(`${RULES.allowlistInvalid}: entries[${index}] must be an object`);
    }
    const rawPath = requireString(entry.path, `entries[${index}].path`, RULES.allowlistInvalid);
    const pathValue = rawPath.replace(/\/+$/, "");
    if (
      path.isAbsolute(rawPath) ||
      rawPath.includes("\\") ||
      rawPath.startsWith("./") ||
      pathValue.split("/").includes("..") ||
      pathValue === ""
    ) {
      throw new GateError(
        `${RULES.allowlistInvalid}: entries[${index}].path must be a repo-relative path without '.' or '..' segments (got ${JSON.stringify(rawPath)})`,
      );
    }
    requireString(entry.reason, `entries[${index}].reason`, RULES.allowlistInvalid);
    requireString(entry.removalTrigger, `entries[${index}].removalTrigger`, RULES.allowlistInvalid);
    if (seen.has(pathValue)) {
      throw new GateError(`${RULES.allowlistInvalid}: duplicate path ${JSON.stringify(pathValue)}`);
    }
    seen.add(pathValue);
    normalized.push({ path: pathValue, hits: 0 });
  }
  normalized.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1].path;
    const current = normalized[index].path;
    if (current === previous || current.startsWith(`${previous}/`)) {
      throw new GateError(
        `${RULES.allowlistInvalid}: overlapping paths ${JSON.stringify(previous)} and ${JSON.stringify(current)} — one entry must own a hit`,
      );
    }
  }
  return normalized;
}

function covers(entry, file) {
  return file === entry.path || file.startsWith(`${entry.path}/`);
}

/** Every text file under `root`, relative and sorted (deterministic output). */
function walkFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      throw new GateError(`${RULES.gate}: cannot read directory ${dir}: ${error.message}`);
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (SKIP_PATH_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) {
        continue;
      }
      if (excludedByClass(rel)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith(".") && rel !== ".github") continue;
        walk(full);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(rel);
      }
    }
  };
  walk(root);
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function readText(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new GateError(`${RULES.gate}: cannot read ${file}: ${error.message}`);
  }
  return text.includes("\u0000") ? null : text;
}

function snippet(line) {
  const collapsed = line.replace(/\s+/g, " ").trim();
  return collapsed.length > 110 ? `${collapsed.slice(0, 107)}...` : collapsed;
}

/**
 * Run the gate. Returns the machine-readable status
 * `{ status, messages, findings, suppressed, warnings }`: `status` is `"pass"`
 * or `"fail"`; `findings` is the failing set; `warnings` is the non-failing set
 * (an allowlist entry that suppresses nothing — it warns, it does not pass
 * silently); `messages` is the ordered report the CLI prints. Exported so the
 * self-test exercises the production path directly.
 */
export function check({ root, allowlistPath, targetsPath }) {
  const matchers = loadTargets(targetsPath);
  const allowlist = loadAllowlist(allowlistPath);
  const files = walkFiles(root);
  const findings = [];
  for (const file of files) {
    const text = readText(path.join(root, file));
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const decoded = decodeUrlEscapes(line);
      for (const matcher of matchers) {
        matcher.regex.lastIndex = 0;
        let match = matcher.regex.exec(decoded);
        while (match !== null) {
          findings.push({
            file,
            line: index + 1,
            label: matcher.label,
            snippet: snippet(line),
          });
          if (match[0] === "") matcher.regex.lastIndex += 1;
          match = matcher.regex.exec(decoded);
        }
      }
    }
  }
  const messages = [];
  const reported = [];
  let suppressed = 0;
  for (const finding of findings) {
    const entry = allowlist.find((candidate) => covers(candidate, finding.file));
    if (entry) {
      entry.hits += 1;
      suppressed += 1;
    } else {
      reported.push(finding);
    }
  }
  for (const finding of reported) {
    messages.push(
      `${RULES.agnostic}  ${finding.file}:${finding.line}  ${finding.label} — ${finding.snippet}`,
    );
  }
  const warnings = [];
  for (const entry of allowlist) {
    if (entry.hits === 0) {
      const warning = `${RULES.allowlistUnused}: allowlist entry ${JSON.stringify(entry.path)} suppresses no reference — remove it or fix its path`;
      warnings.push(warning);
      messages.push(warning);
    }
  }
  const status = reported.length === 0 ? "pass" : "fail";
  const exempt = allowlist.filter((entry) => entry.hits > 0).length;
  const suppressedNote =
    suppressed === 0 ? "" : `; ${suppressed} suppressed by ${exempt} dated-record path(s)`;
  if (status === "pass") {
    messages.push(
      `agnostic-check: PASS — 0 private references in ${files.length} file(s)${suppressedNote}`,
    );
  } else {
    const hitFiles = new Set(reported.map((finding) => finding.file)).size;
    messages.push(
      `agnostic-check: FAIL — ${reported.length} private reference(s) in ${hitFiles} file(s)${suppressedNote}`,
    );
  }
  return { status, messages, findings: reported, suppressed, warnings };
}

function parseArgs(argv) {
  const options = {
    root: REPO_ROOT,
    allowlistPath: DEFAULT_ALLOWLIST,
    targetsPath: DEFAULT_TARGETS,
  };
  const flags = new Map([
    ["--root", "root"],
    ["--allowlist", "allowlistPath"],
    ["--targets", "targetsPath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = flags.get(flag);
    if (!key) {
      throw new GateError(
        `unknown argument ${JSON.stringify(flag)} (usage: check.mjs [--root <dir>] [--allowlist <file>] [--targets <file>])`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new GateError(`${flag} needs a value`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function main() {
  let result;
  try {
    result = check(parseArgs(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof GateError) {
      const message = error.message.startsWith("E-")
        ? error.message
        : `${RULES.gate}: ${error.message}`;
      console.error(message);
      process.exit(1);
    }
    throw error;
  }
  for (const message of result.messages) console.log(message);
  process.exit(result.status === "pass" ? 0 : 1);
}

/**
 * Direct-execution guard. `import.meta.url` is the REALPATH of this module;
 * `process.argv[1]` is whatever path invoked it — on a machine where the
 * invocation path crosses a symlink (/tmp is one on macOS), comparing the
 * two as-is never matches and the CLI silently no-ops (a fail-open).
 */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // unresolvable path — compare as-is rather than fail closed on a probe
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isMain()) {
  main();
}
