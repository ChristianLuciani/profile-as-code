/**
 * The PREVIEW privacy gate (issue #282, SPEC §7.8).
 *
 * `pasco preview` renders the user's own data into ONE file that a webserver is
 * never asked to serve with an access-control check — the file is opened from
 * disk (`file://`) or shipped as a CI artifact readable by anyone with repo
 * access. So the gate is the opposite of the public site's: the site publishes
 * public entries only and lets the ledger decide; the preview must refuse to
 * carry anything the operator did not intend to put on screen.
 *
 * Two families of checks, and the split is the point (fresh review of #354, F2):
 *
 *   TEXT    rules run over the whole document — a path or a token leaks in prose
 *           exactly as it leaks in markup.
 *   MARKUP  rules run over the document's real TAGS (extracted) and over the CSS
 *           of its `<style>` blocks, never over plain text. Escaped HTML (the
 *           renderer emits `&lt;img src=&quot;…&quot;&gt;`) is inert and must not
 *           be judged as a live element — the review found the gate refusing a
 *           bio that merely *mentioned* an `<img>`, while an escaped `<script>`
 *           passed. Markup rules on markup only.
 *
 * Refusal classes:
 *
 *   absolute-path     a machine path (`/Users/<name>/…`, `C:\…`, `file:///…`)
 *                     printed in the document discloses the host and its tree.
 *                     Real trigger: `pasco check`'s findings embed absolute
 *                     source paths — the assembler must relativize them.
 *   credential        a pasted token/private key. The DETAIL IS REDACTED (shape
 *                     + length, never the secret): a gate that echoes the token
 *                     into stderr, `--json` and CI logs leaks exactly what it
 *                     refused to write (review F3).
 *   external-asset    the invariant the preview sells is "one file, opens with no
 *                     network": a `<link>`, a non-`data:` `src`, a remote CSS
 *                     `url()` breaks it (fonts, CDNs, badge fetches).
 *   active-content    "no JS" is not a preference: a `<script>`/`on*=`/`<iframe>`
 *                     would execute on `file://`. The renderer escapes raw HTML
 *                     (see `document.ts`) and this rule proves it did.
 *   source-outside-declared-roots  a file the preview READ resolves outside the
 *                     workspace (a symlink escape). Evidence-root media never
 *                     reaches the gate: it is left out of the page before this
 *                     point (review F5 — the docs say so now).
 *   source-missing    a declared source that no longer exists.
 *   credential-file   a media source shaped like a dotfile/credential.
 *
 * Everything here is pure and offline. `preview` refuses on any finding (exit 1)
 * because a preview that silently drops a rule is a preview that leaks.
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

export type PrivacyRule =
  | "absolute-path"
  | "credential"
  | "external-asset"
  | "active-content"
  | "source-outside-declared-roots"
  | "source-missing"
  | "credential-file";

export interface PrivacyFinding {
  rule: PrivacyRule;
  /** What was found — a readable excerpt, REDACTED for credentials. */
  detail: string;
}

/** A file the preview read, tagged with why. The gate never widens this set. */
export interface PreviewSource {
  role: "content" | "config" | "asset";
  path: string;
}

/** Absolute machine paths, kept to the roots that actually disclose a host. */
const ABSOLUTE_PATHS: readonly { name: string; re: RegExp }[] = [
  {
    name: "posix-home-or-system",
    re: /(?<![\w:/.~-])\/(?:Users|home|private|usr|var|tmp|opt|mnt|Volumes|root|srv|etc)\/[^\s"'<>()]*/u,
  },
  { name: "windows-drive", re: /\b[A-Za-z]:\\(?:[^\s"<>\\]+\\)*[^\s"<>\\]*/u },
  { name: "file-uri", re: /\bfile:\/\/\/?[^\s"'<>()]*/iu },
];

/**
 * Credential shapes. Narrow on purpose: a general "looks secret" heuristic turns
 * every sentence about API keys into a refusal, and a gate that cries wolf gets
 * turned off (the class would then protect nothing).
 */
const CREDENTIALS: readonly { name: string; re: RegExp }[] = [
  { name: "private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u },
  {
    name: "github-token",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/u },
  { name: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/u },
  { name: "aws-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u },
  { name: "bearer-header", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/u },
  {
    // `token: <16+ non-space>` / `api_key=<...>` — an ASSIGNMENT, not a mention.
    name: "secret-assignment",
    re: /\b[A-Za-z0-9_]*(?:token|secret|passwd|password|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*\s*[:=]\s*\S{16,}/iu,
  },
];

/** Elements/attributes the document may not contain, each with its own class. */
const FORBIDDEN_MARKUP: readonly { name: string; rule: PrivacyRule; re: RegExp }[] = [
  { name: "any-link-element", rule: "external-asset", re: /<link\b/iu },
  { name: "script-element", rule: "active-content", re: /<script\b/iu },
  {
    name: "iframe-or-embed",
    rule: "active-content",
    re: /<(?:iframe|object|embed|frame|frameset|applet|base)\b/iu,
  },
  { name: "form", rule: "active-content", re: /<form\b[^>]*\baction\s*=/iu },
  {
    name: "meta-refresh",
    rule: "active-content",
    re: /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/iu,
  },
  { name: "svg", rule: "active-content", re: /<svg\b/iu },
  { name: "event-handler", rule: "active-content", re: /\son[a-z]+\s*=/iu },
];

/** Real tags only: an escaped `&lt;img …&gt;` never matches (see the header). */
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*\b[^>]*>/gu;
/** The CSS of a `<style>` block — where a `url(...)`/import would live. */
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/giu;
/** `name="…" | name='…' | name=bare` inside a tag. */
const attribute = (name: string): RegExp =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "iu");
const SRC = attribute("src");
const SRCSET = attribute("srcset");
const HREF = attribute("href");
const POSTER = attribute("poster");
/** `url(...)` inside CSS, value captured (never judged through backtracking). */
const CSS_URL = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*?))\s*\)/giu;

function attr(re: RegExp, source: string): string | undefined {
  const match = re.exec(source);
  if (match === null) return undefined;
  return (match[1] ?? match[2] ?? match[3] ?? "").trim();
}

/** A value that is inline bytes or an in-page anchor — never a fetch. */
function isInlineValue(value: string): boolean {
  return /^data:image\//iu.test(value) || value.startsWith("#");
}

/**
 * `srcset` is a comma-separated candidate list, and a `data:` URI CONTAINS
 * commas — splitting first corrupts it. So: strip the inline candidates, then
 * every remaining token must be a descriptor (`2x` / `100w`) or an anchor; any
 * URL or relative path left is a fetch.
 */
function srcsetIsInlineOnly(value: string): boolean {
  const stripped = value.replace(/data:image\/[^\s,]*,[^\s]*/giu, " ").trim();
  if (stripped === "") return true;
  return stripped
    .split(/[\s,]+/u)
    .every((part) => part === "" || /^(?:#|[\d.]+[wx])$/iu.test(part));
}

/**
 * Basenames a media source may never be inlined from — the "dotfiles/tokens"
 * half of the issue's gate. A `path` locator is meant to point at a publication
 * artifact (a paper, a dataset), never at the operator's credential files.
 */
const CREDENTIAL_FILE =
  /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pgpass|\.git-credentials|credentials(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|keystore|kdbx))$/iu;

/** The roots the preview may read: the workspace's own data surface. */
export function declaredRoots(workspace: string): readonly string[] {
  return [join(workspace, "content"), join(workspace, ".pascorc")];
}

/** Every refusal class, in one place so `--json` and the docs can list them. */
export const PRIVACY_RULES: readonly PrivacyRule[] = [
  "absolute-path",
  "credential",
  "external-asset",
  "active-content",
  "source-outside-declared-roots",
  "source-missing",
  "credential-file",
];

/** First match of `re` in `text`, trimmed to a readable excerpt (≤120 chars). */
function excerpt(text: string, re: RegExp): string | undefined {
  const match = re.exec(text);
  if (match === null) return undefined;
  const found = match[0].replace(/\s+/gu, " ").trim();
  return found.length > 120 ? `${found.slice(0, 117)}…` : found;
}

/**
 * Scan the FINAL document: text rules over the whole bytes, markup rules over its
 * real tags and its `<style>` CSS — never over escaped text as if it were markup
 * (the defect this split exists to prevent).
 */
export function scanPreviewHtml(html: string): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];

  // ── TEXT: a path or a token leaks in prose exactly as it leaks in markup.
  for (const rule of ABSOLUTE_PATHS) {
    const found = excerpt(html, rule.re);
    if (found !== undefined) {
      findings.push({ rule: "absolute-path", detail: `${rule.name}: ${found}` });
    }
  }
  for (const rule of CREDENTIALS) {
    const found = rule.re.exec(html);
    if (found !== null) {
      // Redacted: echoing the secret into stderr/--json/CI logs would leak it.
      findings.push({
        rule: "credential",
        detail: `${rule.name}: <redacted, ${found[0].length} chars>`,
      });
    }
  }

  // ── MARKUP: element/attribute presence, judged on tags only.
  const tags = html.match(TAG) ?? [];
  for (const rule of FORBIDDEN_MARKUP) {
    const tag = tags.find((candidate) => rule.re.test(candidate));
    if (tag !== undefined) {
      findings.push({ rule: rule.rule, detail: `${rule.name}: ${tag.slice(0, 100)}` });
    }
  }

  // ── MARKUP: attribute values, EXTRACTED first and judged after. Never a
  // lookahead behind an optional quote — that is the backtracking bug of F1.
  for (const tag of tags) {
    const src = attr(SRC, tag);
    if (src !== undefined && !isInlineValue(src)) {
      findings.push({ rule: "external-asset", detail: `src: ${src.slice(0, 80)}` });
    }
    const srcset = attr(SRCSET, tag);
    if (srcset !== undefined && !srcsetIsInlineOnly(srcset)) {
      findings.push({ rule: "external-asset", detail: `srcset: ${srcset.slice(0, 80)}` });
    }
    if (attr(POSTER, tag) !== undefined) {
      findings.push({ rule: "external-asset", detail: "poster attribute" });
    }
    const href = attr(HREF, tag);
    if (href !== undefined && /^javascript:/iu.test(href)) {
      findings.push({ rule: "active-content", detail: "javascript: URL" });
    }
  }

  // ── CSS: the `<style>` block's own text (not tags) — imports and url().
  for (const block of html.matchAll(STYLE_BLOCK)) {
    const css = block[1] ?? "";
    if (/@import\b/iu.test(css)) {
      findings.push({ rule: "external-asset", detail: "stylesheet import in the inline CSS" });
    }
    for (const match of css.matchAll(CSS_URL)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (value !== "" && !isInlineValue(value)) {
        findings.push({ rule: "external-asset", detail: `css url(): ${value.slice(0, 80)}` });
      }
    }
  }

  return findings;
}

/** `true` when `path` resolves inside `root` (symlinks resolved, not textual). */
export function isInside(root: string, path: string): boolean {
  const insideOf = (parent: string, child: string): boolean =>
    child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
  try {
    return insideOf(realpathSync(root), realpathSync(path));
  } catch {
    // A path that does not resolve cannot be proven inside — never a free pass.
    return insideOf(resolve(root), resolve(path));
  }
}

/**
 * Provenance over the sources: every file the preview read must (a) exist, (b)
 * resolve inside the workspace, and (c) not be a credential-shaped file. The
 * declared roots are the workspace's `content/` + `.pascorc`; media is admitted
 * only when its resolved path stays inside the workspace, which is exactly the
 * line §18.6 already draws for the bundle (`origin: "workspace"`).
 */
export function checkSources(
  sources: readonly PreviewSource[],
  workspace: string,
): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const key = `${source.role}:${source.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!existsSync(source.path)) {
      findings.push({ rule: "source-missing", detail: `${source.role}: ${basename(source.path)}` });
      continue;
    }
    if (!isInside(workspace, source.path)) {
      findings.push({
        rule: "source-outside-declared-roots",
        detail: `${source.role}: ${basename(source.path)} resolves outside the workspace`,
      });
      continue;
    }
    if (source.role === "asset" && CREDENTIAL_FILE.test(basename(source.path))) {
      findings.push({
        rule: "credential-file",
        detail: `asset: ${basename(source.path)} is a dotfile/credential shape, never a publication artifact`,
      });
    }
  }
  return findings;
}

/** The whole gate: bytes + provenance, one finding list, deterministic order. */
export function privacyFindings(input: {
  html: string;
  sources: readonly PreviewSource[];
  workspace: string;
}): PrivacyFinding[] {
  return [...scanPreviewHtml(input.html), ...checkSources(input.sources, input.workspace)];
}
