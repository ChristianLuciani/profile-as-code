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
 *     GitHub's slug rules (lowercased, punctuation removed, spaces → `-`,
 *     duplicates suffixed `-1`, `-2`, …).
 *   Rule C — the private-target allowlist (`allowlist.json`) is well-formed:
 *     every entry declares a target, a reason and a REMOVAL TRIGGER, and no
 *     two entries share a target.
 *
 * Explicitly OUT of scope, per the issue:
 *   - external URLs are never fetched. Walled/anti-bot surfaces answer 403 to
 *     bots (`https://ko-fi.com/christianluciani` → HTTP 403 from outside,
 *     #132, 2026-10) and a required check must not depend on third-party
 *     uptime or rate limits. An `https://…` destination — including a link to
 *     a private family repo — is recorded and skipped, never resolved.
 *   - the private family targets therefore need a declaration, not a fetch:
 *     `allowlist.json` is the explicit, documented registry with its removal
 *     trigger (the `profile-data-template` visibility flip). A reference to an
 *     allowlisted target is surfaced with its count; a declaration nothing in
 *     scope references is reported as a WARNING so the registry cannot rot
 *     silently (W-ALLOWLIST-UNUSED).
 *
 * Scope is the corpus the issue enumerates: root `README.md`, `CONTRIBUTING.md`
 * and `AGENTS.md`, `docs/`, `skills/`, `templates/`, and each package README
 * (`packages/<pkg>/README.md`, renderers included). Walking is filesystem
 * based (like `scripts/dep-gate`), skipping VCS/build directories — the scope
 * paths are all tracked by construction, and the checker must also run against
 * a bare fixture tree in the self-test.
 *
 * Zero dependencies, `node >=22` — runs on a fresh checkout before any install.
 * A file the gate cannot read, or a link shape it cannot parse, is an explicit
 * failure (E-GATE), never a silent pass.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ALLOWLIST = path.join(HERE, "allowlist.json");

/** The scope corpus (#149). Paths use POSIX separators, relative to the root. */
const SCOPE = [
  /^README\.md$/,
  /^CONTRIBUTING\.md$/,
  /^AGENTS\.md$/,
  /^docs\/.+\.md$/,
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

/** GitHub's slugger: lowercase, drop punctuation, spaces → `-`, keep `_`/`-`. */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "") // inline HTML
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](dest) → label
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "") // punctuation out
    .trim()
    .replace(/\s+/g, "-");
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
  const masked = maskFencedCode(text).replace(/`[^`\n]*`/g, " ");
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
    if (isExternal(entry.target) === false) {
      return {
        error: `${RULES.allowlistInvalid}: entry ${index} target must be an absolute URL: ${entry.target}`,
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
    files = walkMarkdown(rootReal).filter((file) => inScope(relPosix(rootReal, file)));
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
        const wantsDir = rawPath.endsWith("/");
        if (wantsDir && !statSync(target).isDirectory()) {
          messages.push(`${RULES.linkMissing}: ${rel}:${line}: ${dest} (not a directory)`);
          continue;
        }
      }

      if (fragment === "" || statSync(target).isDirectory()) continue;
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
    const maskedLines = maskFencedCode(text)
      .replace(/`[^`\n]*`/g, " ")
      .split("\n");
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

async function main() {
  const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
  const root = process.argv[2] ?? defaultRoot;
  const result = check(root);
  for (const message of result.messages) console.log(message);
  if (result.allowlisted.length > 0) {
    const detail = result.allowlisted.map(({ target, count }) => `${target} ×${count}`).join(", ");
    console.log(`Allowlisted private targets: ${detail}`);
  }
  console.log(
    `Link gate: ${result.status.toUpperCase()} (${result.files} files, ${result.links} links)`,
  );
  process.exit(result.status === "pass" ? 0 : 1);
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
