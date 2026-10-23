#!/usr/bin/env node
/**
 * Documentation link gate (issue #149).
 *
 * The repo is cross-reference intensive (README ↔ docs ↔ SPEC ↔ AGENTS ↔
 * skills ↔ templates) and nothing verified those cross-links: a broken
 * relative link is invisible until an outsider clicks it. This gate asserts,
 * offline and deterministically, that:
 *
 *   Rule A — every RELATIVE path in a tracked Markdown file inside the scope
 *     corpus resolves to a file or directory that exists in the checkout.
 *   Rule B — every in-page anchor (`#section`, including same-file `#anchor`)
 *     resolves against the headings of the destination Markdown file, using
 *     GitHub's slug rules (`github-slugger`: lowercased, punctuation removed,
 *     EACH space → `-` with no collapse, `_`/`-` kept; duplicates suffixed
 *     `-1`, `-2`, …).
 *   Rule C — the private-target allowlist (`allowlist.json`) is well-formed:
 *     every entry declares an http(s) target, a reason and a REMOVAL TRIGGER,
 *     and no two entries share a target.
 *
 * Explicitly OUT of scope, per the issue:
 *   - external URLs are never fetched. Walled/anti-bot surfaces answer 403 to
 *     bots (`https://ko-fi.com/christianluciani` → HTTP 403 from outside,
 *     #132, 2026-10) and a required check must not depend on third-party
 *     uptime or rate limits. An `https://…` destination — including a link to
 *     a private family repo — is recorded and skipped, never resolved.
 *   - the private family targets therefore need a declaration, not a fetch:
 *     `allowlist.json` is the explicit, documented registry, each entry carrying
 *     the trigger that removes it. A reference to an allowlisted target is
 *     surfaced with its count; a declaration nothing in scope references is
 *     reported as a WARNING so the registry cannot rot silently
 *     (W-ALLOWLIST-UNUSED) — that is how the last entry left: `profile-data-template`
 *     went public and its trigger fired (#273), so the registry is empty today.
 *
 * Scope is every tracked, non-hidden Markdown doc area: root `*.md`
 * (`README`, `CONTRIBUTING`, `AGENTS`, `GOVERNANCE`, `SECURITY`,
 * `CODE_OF_CONDUCT`, `CHANGELOG`), `docs/`, `schema/`, `skills/`, `templates/`,
 * and each package README (`packages/<pkg>/README.md`, renderers included).
 * Walking is filesystem based (like `scripts/dep-gate`), skipping VCS, build,
 * and hidden directories — hidden trees (`.github/`, `.sota/`) are excluded by
 * decision, not by accident (`.sota/` holds frozen historical artifacts, not
 * live docs). The scope paths are all tracked by construction, and the checker
 * must also run against a bare fixture tree in the self-test.
 *
 * Zero dependencies, `node >=22` — runs on a fresh checkout before any install.
 * A file the gate cannot read, or a link shape it cannot parse, is an explicit
 * failure (E-GATE), never a silent pass.
 *
 * The corpus CENSUS (`N files, M links`) is itself a derived figure, so since
 * #226 it is a generated surface, never prose: `<!-- gen:doc-links -->` …
 * `<!-- /gen -->` in `docs/ci-cd.md` carries the number, and `--check` asserts
 * the committed block equals the computation — the `scripts/gen-platforms` mold
 * (same `GateError`, same "is stale … run `pnpm gen:doc-links`" refusal). Prose
 * elsewhere CITES the block instead of re-typing the number, because a figure
 * that changes with every commit cannot be asserted as current state.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ALLOWLIST = path.join(HERE, "allowlist.json");

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
export class GateError extends Error {}

/** The generated census block (#226): home file, markers, and content. */
const BLOCK_REL = path.join("docs", "ci-cd.md");
const BLOCK_MARKER = "gen:doc-links";
const GEN_CLOSE = "<!-- /gen -->";

/** The scope corpus (#149): every tracked, non-hidden Markdown doc area. */
const SCOPE = [
  /^[^/]+\.md$/, // root: README, CONTRIBUTING, AGENTS, GOVERNANCE, SECURITY, CODE_OF_CONDUCT, CHANGELOG
  /^docs\/.+\.md$/,
  /^schema\/.+\.md$/,
  /^skills\/.+\.md$/,
  /^templates\/.+\.md$/,
  /^packages\/[^/]+\/README\.md$/,
  /^packages\/renderers\/[^/]+\/README\.md$/,
];

/** Directories never descended into: VCS, installs, build output, worktrees. */
const SKIP_DIRS = new Set([".git", ".worktrees", "node_modules", "dist", "coverage", ".turbo"]);

const RULES = {
  linkMissing: "E-LINK-MISSING",
  linkEscapes: "E-LINK-ESCAPES",
  anchorMissing: "E-ANCHOR-MISSING",
  allowlistInvalid: "E-ALLOWLIST-INVALID",
  gate: "E-GATE",
  allowlistUnused: "W-ALLOWLIST-UNUSED",
};

function isError(message) {
  return /^E-[A-Z-]+:/.test(message);
}

/** Every Markdown file under `root`, sorted for a deterministic report. */
function walkMarkdown(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`${RULES.gate}: cannot read directory ${dir}: ${error.message}`);
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      // A broken symlink is not a directory; statSync would throw on one.
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir) walkMarkdown(full, acc);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) acc.push(full);
  }
  return acc;
}

/** POSIX relative path of `file` under `root` (the form SCOPE matches). */
function relPosix(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function inScope(rel) {
  return SCOPE.some((pattern) => pattern.test(rel));
}

/**
 * Replace fenced code blocks with blank lines (line count preserved) so a
 * `[x](y)` inside a fence is never read as a link, and a `# heading` inside a
 * fence is never read as a heading.
 */
function maskFencedCode(text) {
  const lines = text.split("\n");
  let marker = null;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker !== null) {
      lines[i] = "";
      if (match && match[1][0] === marker[0] && match[1].length >= marker.length) marker = null;
      continue;
    }
    if (match) {
      marker = match[1];
      lines[i] = "";
    }
  }
  return lines.join("\n");
}

/**
 * Mask everything GitHub does not link: fenced code blocks (line count
 * preserved) and inline code spans. Exported because a documentation gate that
 * scans for a MARKER must not fire on prose that merely DOCUMENTS the marker in
 * backticks (`scripts/evidence-gate`) — one masking definition, so the two gates
 * can never disagree on what counts as code.
 */
export function maskCode(text) {
  return maskFencedCode(text).replace(/`[^`\n]*`/g, " ");
}

/**
 * GitHub's heading slug (`github-slugger`, the reference implementation):
 * lowercase, drop punctuation, then replace EACH space with `-` — no collapse,
 * no trim, so `## 5. Validate & build` → `5-validate--build` (the `&` goes and
 * both spaces become hyphens). `_` and `-` are kept. The punctuation class is
 * the ASCII-equivalent of github-slugger's regex for the corpus's headings; it
 * is verified against the library in `test.mjs` (see the slug oracle fixtures),
 * so a divergence fails CI instead of silently rejecting a correct anchor.
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

/** Anchor ids a destination exposes: heading slugs + explicit `<a id|name>`. */
function anchorsOf(text) {
  // Inline code is NOT masked here: GitHub slugs the code span's text
  // (`## 2. Install the `pasco` CLI` → `2-install-the-pasco-cli`).
  const masked = maskFencedCode(text);
  const lines = masked.split("\n");
  const seen = new Map();
  const anchors = new Set();
  for (let i = 0; i < lines.length; i++) {
    let heading = null;
    const atx = lines[i].match(/^\s{0,3}#{1,6}\s+(.*?)\s*$/);
    if (atx) {
      heading = atx[1].replace(/\s+#+\s*$/, "");
    } else if (
      lines[i].trim() !== "" &&
      i + 1 < lines.length &&
      /^\s{0,3}(=+|-+)\s*$/.test(lines[i + 1])
    ) {
      heading = lines[i];
    }
    if (heading !== null) {
      const slug = slugify(heading);
      if (slug !== "") {
        const count = seen.get(slug) ?? 0;
        seen.set(slug, count + 1);
        anchors.add(count === 0 ? slug : `${slug}-${count}`);
      }
    }
    for (const match of lines[i].matchAll(/<[a-z][^>]*\s(?:id|name)=["']([^"']+)["']/gi)) {
      anchors.add(match[1]);
    }
  }
  return anchors;
}

function isExternal(dest) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(dest) || dest.startsWith("//");
}

/**
 * Every Markdown link/image destination in `text`, with its 1-based line.
 * Inline `[label](dest)`, image `![alt](dest)`, the nested image-in-link idiom
 * `[![alt](img)](dest)` and reference style (`[label][id]` + `[id]: dest`
 * definitions) are all covered — a reference link or a nested shape escaping
 * the scan would be a hole in the gate.
 *
 * `unparsed` lists lines that still hold a `](`, i.e. a link shape this parser
 * did not consume. That is a fail-closed guard: an unknown shape is reported by
 * the caller as E-GATE, never silently skipped.
 */
function extractLinks(text) {
  const masked = maskCode(text);
  const lines = masked.split("\n");
  const inline =
    /!?\[([^\]\n]*)\]\(\s*(<[^>]*>|[^()\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  const nested = /\[!\[[^\]\n]*\]\([^)]*\)\]\(\s*(<[^>]*>|[^()\s]+)/g;
  const defs = new Map();
  const links = [];
  const parsedPerLine = new Array(lines.length).fill(0);
  const push = (line, dest) => {
    links.push({ line, dest });
    parsedPerLine[line - 1] += 1;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const def = line.match(/^\s{0,3}\[([^\]]+)\]:\s*(\S+)\s*$/);
    if (def) defs.set(def[1].toLowerCase(), { dest: def[2], line: i + 1 });
    for (const match of line.matchAll(inline)) push(i + 1, unwrap(match[2]));
    for (const match of line.matchAll(nested)) push(i + 1, unwrap(match[1]));
  }
  const uses = /!?\[([^\]\n]*)\]\[([^\]\n]*)\]/g;
  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(uses)) {
      const def = defs.get((match[2] || match[1]).toLowerCase());
      if (def) push(i + 1, unwrap(def.dest));
    }
  }
  const unparsed = [];
  for (let i = 0; i < lines.length; i++) {
    const occurrences = (lines[i].match(/\]\(/g) ?? []).length;
    if (occurrences > parsedPerLine[i]) unparsed.push(i + 1);
  }
  return { links, unparsed };
}

/** Strip the optional `<…>` angle brackets a destination may be wrapped in. */
function unwrap(raw) {
  return raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
}

/** Validate an allowlist object into a target→entry map, or an `E-` reason. */
function validateAllowlist(raw) {
  if (raw === null || typeof raw !== "object" || !Array.isArray(raw.privateTargets)) {
    return { error: `${RULES.allowlistInvalid}: privateTargets must be an array` };
  }
  const targets = new Map();
  for (const [index, entry] of raw.privateTargets.entries()) {
    if (entry === null || typeof entry !== "object") {
      return { error: `${RULES.allowlistInvalid}: entry ${index} is not an object` };
    }
    for (const field of ["target", "reason", "removalTrigger"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        return {
          error: `${RULES.allowlistInvalid}: entry ${index} (${entry.target ?? "?"}) is missing a non-empty ${field}`,
        };
      }
    }
    if (!/^https?:\/\//.test(entry.target)) {
      return {
        error: `${RULES.allowlistInvalid}: entry ${index} target must be an http(s) URL: ${entry.target}`,
      };
    }
    if (targets.has(entry.target)) {
      return { error: `${RULES.allowlistInvalid}: duplicate target ${entry.target}` };
    }
    targets.set(entry.target, entry);
  }
  return { targets };
}

function loadAllowlist(allowlistPath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(allowlistPath, "utf8"));
  } catch (error) {
    return { error: `${RULES.allowlistInvalid}: cannot read ${allowlistPath}: ${error.message}` };
  }
  return validateAllowlist(raw);
}

/** Every in-scope Markdown file under `root`, sorted (the corpus definition,
 *  exported so `scripts/evidence-gate` scans the SAME corpus instead of keeping
 *  a second walker that could disagree on scope). */
export function listMarkdown(root) {
  const rootReal = path.resolve(root);
  return walkMarkdown(rootReal).filter((file) => inScope(relPosix(rootReal, file)));
}

/**
 * Run the gate over `root`.
 *
 * @returns {{status: "pass"|"fail", messages: string[], files: number,
 *            links: number, allowlisted: Array<{target: string, count: number}>}}
 */
export function check(root, options = {}) {
  const messages = [];
  const allowlistPath = options.allowlistPath ?? DEFAULT_ALLOWLIST;
  const parsed = options.allowlist
    ? validateAllowlist(options.allowlist)
    : loadAllowlist(allowlistPath);
  if (parsed.error) {
    return { status: "fail", messages: [parsed.error], files: 0, links: 0, allowlisted: [] };
  }
  const targets = parsed.targets;

  const rootReal = path.resolve(root);
  let files;
  try {
    files = listMarkdown(rootReal);
  } catch (error) {
    return { status: "fail", messages: [error.message], files: 0, links: 0, allowlisted: [] };
  }
  const anchorCache = new Map();
  const referenceCounts = new Map();
  let links = 0;

  for (const file of files) {
    const rel = relPosix(rootReal, file);
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      messages.push(`${RULES.gate}: cannot read ${rel}: ${error.message}`);
      continue;
    }
    const { links: found, unparsed } = extractLinks(text);
    for (const line of unparsed) {
      messages.push(`${RULES.gate}: ${rel}:${line}: unrecognized link shape (fail-closed)`);
    }
    for (const { dest, line } of found) {
      links += 1;
      if (isExternal(dest)) continue;

      const hash = dest.indexOf("#");
      const rawPath = hash === -1 ? dest : dest.slice(0, hash);
      const rawFragment = hash === -1 ? "" : dest.slice(hash + 1);
      let fragment = rawFragment;
      try {
        fragment = decodeURIComponent(rawFragment);
      } catch {
        // malformed percent-encoding — keep it literal and let the lookup fail
      }

      let target;
      if (rawPath === "") {
        target = file;
      } else {
        let decoded;
        try {
          decoded = decodeURIComponent(rawPath);
        } catch {
          decoded = rawPath;
        }
        target = path.resolve(path.dirname(file), decoded);
        const within = target === rootReal || target.startsWith(rootReal + path.sep);
        if (!within) {
          messages.push(`${RULES.linkEscapes}: ${rel}:${line}: ${dest}`);
          continue;
        }
        if (!existsSync(target)) {
          messages.push(`${RULES.linkMissing}: ${rel}:${line}: ${dest}`);
          continue;
        }
      }

      // The module contract says an unreadable target is an explicit E-GATE
      // failure, never a stack trace: existsSync can be beaten by an FS race, a
      // symlink appearing/disappearing, or an OS sandbox, so the stat is guarded.
      let targetStat;
      try {
        targetStat = statSync(target);
      } catch (error) {
        messages.push(`${RULES.gate}: ${rel}:${line}: cannot stat ${dest}: ${error.message}`);
        continue;
      }
      if (rawPath !== "" && rawPath.endsWith("/") && !targetStat.isDirectory()) {
        messages.push(`${RULES.linkMissing}: ${rel}:${line}: ${dest} (not a directory)`);
        continue;
      }

      if (fragment === "") continue;
      if (targetStat.isDirectory()) {
        // A fragment on a directory can never resolve — a directory has no
        // headings — so it is an explicit finding, not a silent skip.
        messages.push(`${RULES.anchorMissing}: ${rel}:${line}: ${dest} (fragment on a directory)`);
        continue;
      }
      // Line anchors (`#L10`) address code files, not headings — out of scope.
      if (/^L\d+(-L\d+)?$/.test(fragment)) continue;
      if (path.extname(target).toLowerCase() !== ".md") continue;

      let anchors = anchorCache.get(target);
      if (!anchors) {
        try {
          anchors = anchorsOf(readFileSync(target, "utf8"));
        } catch (error) {
          messages.push(
            `${RULES.gate}: cannot read ${relPosix(rootReal, target)}: ${error.message}`,
          );
          continue;
        }
        anchorCache.set(target, anchors);
      }
      if (!anchors.has(fragment)) {
        const destRel = relPosix(rootReal, target);
        messages.push(
          `${RULES.anchorMissing}: ${rel}:${line}: ${dest} (no #${fragment} in ${destRel})`,
        );
      }
    }

    // Allowlist accounting counts autolinked bare URLs too (GitHub autolinks
    // them), from the code-masked text so a URL in a fence/inline code — which
    // GitHub does NOT link — never counts. Per line, so a link destination and
    // its bare form on the same line cannot double-count.
    const maskedLines = maskCode(text).split("\n");
    for (const target of targets.keys()) {
      const occurrences = maskedLines.filter((line) => line.includes(target)).length;
      if (occurrences > 0) {
        referenceCounts.set(target, (referenceCounts.get(target) ?? 0) + occurrences);
      }
    }
  }

  const allowlisted = [];
  for (const [target, entry] of targets) {
    const count = referenceCounts.get(target) ?? 0;
    allowlisted.push({ target, count });
    if (count === 0) {
      messages.push(`${RULES.allowlistUnused}: ${target} — ${entry.removalTrigger}`);
    }
  }

  const status = messages.some(isError) ? "fail" : "pass";
  return { status, messages, files: files.length, links, allowlisted };
}

/**
 * The block body (#226). Deliberately inert for the gate itself: it is prose
 * with no link destination, no image and no heading, so writing it cannot move
 * the census it reports (an `](` here would be an unparsed link shape, a `#`
 * line a new anchor — the self-test pins that by regenerating twice).
 */
export function renderDocLinksBlock(result) {
  return [
    "<!-- GENERATED by scripts/link-check/check.mjs — do not edit by hand. Regenerate with `pnpm gen:doc-links`. -->",
    `Link corpus at this commit: **${result.files} files, ${result.links} links** — counted by ` +
      "`node scripts/link-check/check.mjs` over the tracked, non-hidden Markdown doc areas; " +
      "external URLs are recorded and skipped, never fetched. Cite this block rather than " +
      "re-typing the number: a figure that moves with every commit is a citation, not a claim.",
  ].join("\n");
}

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The block region. The marker must sit on a LINE OF ITS OWN: the block lives in
 * `docs/ci-cd.md`, so prose in that same file legitimately NAMES it (in
 * backticks), and a plain `indexOf` would start the region at the mention rather
 * than at the block — a document able to break its own gate by describing it
 * (caught while writing #226's own prose). `committed` is the region's trimmed
 * inner text, so indentation cannot fake staleness either.
 */
export function renderBlock(source, inner, where) {
  const open = `<!-- ${BLOCK_MARKER} -->`;
  const openMatch = new RegExp(`^[ \\t]*${escapeRe(open)}[ \\t]*$`, "m").exec(source);
  if (openMatch === null) throw new GateError(`${where}: missing ${open} marker on its own line`);
  const bodyStart = openMatch.index + openMatch[0].length;
  const closeRe = new RegExp(`^[ \\t]*${escapeRe(GEN_CLOSE)}[ \\t]*$`, "gm");
  closeRe.lastIndex = bodyStart;
  const closeMatch = closeRe.exec(source);
  if (closeMatch === null) throw new GateError(`${where}: missing ${GEN_CLOSE} after ${open}`);
  return {
    committed: source.slice(bodyStart, closeMatch.index).trim(),
    rendered:
      `${source.slice(0, openMatch.index)}${open}\n${inner}\n${GEN_CLOSE}` +
      source.slice(closeMatch.index + closeMatch[0].length),
  };
}

/** First divergence between a committed block and the computed one. */
function firstDifference(committed, generated) {
  const a = committed.split("\n");
  const b = generated.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `block line ${i + 1}: committed ${JSON.stringify(a[i] ?? "<eof>")} vs census ${JSON.stringify(b[i] ?? "<eof>")}`;
    }
  }
  return "no line differs";
}

function parseArgs(argv) {
  const rootIndex = argv.indexOf("--root");
  const flagValue = rootIndex === -1 ? -1 : rootIndex + 1;
  const positionals = argv.filter((arg, i) => !arg.startsWith("--") && i !== flagValue);
  const root =
    rootIndex !== -1
      ? argv[rootIndex + 1]
      : (positionals[0] ?? fileURLToPath(new URL("../../", import.meta.url)));
  if (root === undefined) throw new GateError("--root requires a directory");
  return { check: argv.includes("--check"), root: path.resolve(root) };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.log(`E-GATE: ${error.message}`);
    console.log("link-check: FAIL");
    process.exit(1);
  }
  const { check: assertBlock, root } = options;

  // The scan itself is identical in both modes — `--check` only adds the
  // assertion that the committed census block matches this computation.
  const result = check(root);
  for (const message of result.messages) console.log(message);
  if (result.allowlisted.length > 0) {
    const detail = result.allowlisted.map(({ target, count }) => `${target} ×${count}`).join(", ");
    console.log(`Allowlisted private targets: ${detail}`);
  }
  console.log(
    `Link gate: ${result.status.toUpperCase()} (${result.files} files, ${result.links} links)`,
  );
  if (result.status !== "pass") {
    if (assertBlock) console.log("link-check: FAIL");
    process.exit(1);
  }

  // The census block. A tree with no marked block (a fixture tree, or a checkout
  // where the block was deleted) is a silent gap in write mode but an explicit
  // refusal under `--check` — never a pass that verified nothing.
  const target = path.join(root, BLOCK_REL);
  const relTarget = path.relative(root, target) || BLOCK_REL;
  const generated = renderDocLinksBlock(result);
  const expected = generated.trim();
  let source = null;
  try {
    source = readFileSync(target, "utf8");
  } catch {
    source = null;
  }

  if (assertBlock) {
    if (source === null) {
      console.log(`E-GATE: cannot read ${relTarget} — the \`${BLOCK_MARKER}\` block has no home`);
    } else {
      let committed;
      try {
        committed = renderBlock(source, generated, relTarget).committed;
      } catch (error) {
        console.log(`E-GATE: ${error.message}`);
        committed = null;
      }
      if (committed !== null && committed !== expected) {
        console.log(
          `E-GATE: ${relTarget} is stale against the link census — run \`pnpm gen:doc-links\` ` +
            `(${firstDifference(committed, expected)})`,
        );
      } else if (committed === expected) {
        console.log(`link-check: in sync (${result.files} files, ${result.links} links)`);
        process.exit(0);
      }
    }
    console.log("link-check: FAIL");
    process.exit(1);
  }

  if (source === null) process.exit(0);
  let rendered;
  try {
    rendered = renderBlock(source, generated, relTarget).rendered;
  } catch (error) {
    console.log(`E-GATE: ${error.message}`);
    console.log("link-check: FAIL");
    process.exit(1);
  }
  if (rendered !== source) writeFileSync(target, rendered);
  console.log(
    `link-check: ${rendered === source ? "in sync" : "wrote"} ${relTarget} (${result.files} files, ${result.links} links)`,
  );
  process.exit(0);
}

/** Direct-execution guard — realpath the invocation path (symlink-safe). */
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
  await main();
}
