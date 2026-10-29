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
 * Four refusal classes, each with a defect it exists for:
 *
 *   absolute-path     a machine path (`/Users/<name>/…`, `C:\…`, `file:///…`)
 *                     printed in the document discloses the host and its tree.
 *                     Real trigger: `pasco check`'s media/registry findings embed
 *                     absolute source paths — the assembler must relativize them.
 *   credential        a pasted token/private key is a leak independent of who
 *                     receives the file. The class is deliberately narrow
 *                     (token shapes + `secret: <16+ non-space>` assignments) so
 *                     prose about tokens is not flagged.
 *   external-asset    the invariant the preview sells is "one file, opens with
 *                     no network": a `<link rel=stylesheet>`, a remote `<img>`
 *                     or a `url(https:…)` breaks it (fonts, CDNs, badges).
 *   active-content    "no JS" is not a preference: a `<script>`/`on*=`/`<iframe>`
 *                     in the markdown would execute on `file://`. The renderer
 *                     escapes raw HTML (see `document.ts`) and this rule proves
 *                     it did.
 *
 * Plus one provenance class, checked over the SOURCES the preview read rather
 * than over the bytes:
 *
 *   source-outside-declared-roots  the preview may read the workspace (`content/`,
 *                     `.pascorc`) and media whose resolved path stays inside it.
 *                     A symlink escaping the workspace, or evidence-root media
 *                     (`origin: "external"`), is refused rather than inlined:
 *                     the declared set is what the workspace owns.
 *
 * Everything here is pure and offline: the gate takes the final document plus
 * the source list and returns findings. `preview` refuses on any finding (exit
 * 1) because a preview that silently drops a rule is a preview that leaks.
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
  /** What was found — the offending excerpt, never the surrounding payload. */
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
 * every sentence about API keys into a refusal, and a gate that cries wolf is
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

/**
 * References a self-contained document may not carry. `data:image/` is the one
 * admitted `src`: it is inline bytes, not a fetch.
 */
const EXTERNAL_ASSETS: readonly { name: string; re: RegExp }[] = [
  // The document's own <style> is fine; an imported or linked one is not.
  { name: "stylesheet-link", re: /<link\b[^>]*\brel\s*=\s*["']?stylesheet/iu },
  { name: "any-link-element", re: /<link\b/iu },
  { name: "css-import", re: /@import\b/u },
  { name: "css-url", re: /\burl\(\s*["']?(?!#|data:image\/)/iu },
  { name: "remote-or-relative-src", re: /\b(?:src|srcset)\s*=\s*["']?(?!#|data:image\/)/iu },
  { name: "poster", re: /\bposter\s*=/iu },
];

/** Executable or navigable content a preview never needs. */
const ACTIVE_CONTENT: readonly { name: string; re: RegExp }[] = [
  { name: "script-element", re: /<script\b/iu },
  { name: "iframe-or-embed", re: /<(?:iframe|object|embed|frame|frameset|applet|base)\b/iu },
  { name: "form", re: /<form\b[^>]*\baction\s*=/iu },
  { name: "event-handler", re: /\son[a-z]+\s*=\s*["']?[^\s>]/iu },
  { name: "javascript-url", re: /\b(?:href|src)\s*=\s*["']?\s*javascript:/iu },
  { name: "meta-refresh", re: /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/iu },
  { name: "svg", re: /<svg\b/iu },
];

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

/** Scan the FINAL document (markup included) for the byte-level classes. */
export function scanPreviewHtml(html: string): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  for (const rule of ABSOLUTE_PATHS) {
    const found = excerpt(html, rule.re);
    if (found !== undefined)
      findings.push({ rule: "absolute-path", detail: `${rule.name}: ${found}` });
  }
  for (const rule of CREDENTIALS) {
    const found = excerpt(html, rule.re);
    if (found !== undefined)
      findings.push({ rule: "credential", detail: `${rule.name}: ${found}` });
  }
  for (const rule of EXTERNAL_ASSETS) {
    const found = excerpt(html, rule.re);
    if (found !== undefined)
      findings.push({ rule: "external-asset", detail: `${rule.name}: ${found}` });
  }
  for (const rule of ACTIVE_CONTENT) {
    const found = excerpt(html, rule.re);
    if (found !== undefined)
      findings.push({ rule: "active-content", detail: `${rule.name}: ${found}` });
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
