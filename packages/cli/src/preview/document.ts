/**
 * The preview DOCUMENT (issue #282, SPEC §7.9).
 *
 * One file, no JS, no external asset: the artifact `pasco build` would write for
 * each platform, projected into ONE HTML page whose sections are its anchors
 * (`#github-readme`, `#linkedin`, …). The single-file shape is what removes the
 * base-URL class of bug #279 hit (a page served at an arbitrary depth breaks
 * every relative URL) — here there is no base to resolve.
 *
 * Why the markdown renderer is configured, not post-processed:
 *
 *   - Raw HTML in a content file is ESCAPED, never emitted. The profile is user
 *     data; a `<script>` in a bio must not become executable because someone ran
 *     a preview. Escaping at the token level is the only seam where "no JS" is a
 *     property of the renderer instead of a hope about the input.
 *   - `link` keeps the profile's own URLs (that is the point of a profile) but
 *     refuses `javascript:`.
 *   - `image` inlines a declared workspace asset as a `data:` URI and turns
 *     anything else (a shields.io badge, a CDN image) into a LINK. A preview that
 *     fetched a badge would stop being offline and would tell a third party that
 *     the operator opened their own data.
 *
 * The page chrome is generated here (template + inline CSS); only the artifact
 * bodies go through the markdown renderer. `privacy.ts` then scans the finished
 * document — that is the gate, and it sees exactly what the reader would.
 */

import { Marked } from "marked";

/** An asset the preview inlined: deploy-relative target → inline bytes. */
export interface PreviewAsset {
  target: string;
  dataUri: string;
  bytes: number;
}

/** A media asset the preview could not inline, and why (never silent). */
export interface OmittedAsset {
  target: string;
  reason: string;
}

/** One platform surface of the page: the artifact, as it would be published. */
export interface PreviewSection {
  /** Anchor id — the platform slug (`github-readme`). */
  id: string;
  title: string;
  /** Where the text came from: `renderer` · `paste` · `variant <id>`. */
  origin: string;
  /** Workspace-relative artifact path, or `null` when nothing is published. */
  artifact: string | null;
  /** The artifact text (markdown), verbatim. */
  markdown: string;
  /** Facts the reader needs: an empty render, a variant body, a renderer warning. */
  notes: readonly string[];
}

/** A declared limit row (`content/checks.yaml`): the cap that applies where. */
export interface PreviewLimit {
  platform: string;
  rule: string;
  value: string;
}

export interface PreviewCheckFinding {
  severity: string;
  code: string;
  message: string;
  path: string;
}

/** A declared surface this language does not publish — listed, never dropped. */
export interface UnpublishedSurface {
  id: string;
  reason: string;
}

export interface PreviewDocument {
  title: string;
  /** ISO 8601 timestamp the page was generated at (freshness, not a version). */
  generatedAt: string;
  lang: string;
  /** Non-empty scalar leaves of the normalized profile — the `<N> facts` figure. */
  facts: number;
  engine: string;
  /** Workspace directory NAME (never its absolute path: see privacy.ts). */
  workspaceName: string;
  sections: readonly PreviewSection[];
  /** Surfaces `build` would not write for this language, with the reason. */
  unpublished: readonly UnpublishedSurface[];
  assets: readonly PreviewAsset[];
  omitted: readonly OmittedAsset[];
  checks: readonly PreviewCheckFinding[];
  limits: readonly PreviewLimit[];
  warnings: readonly string[];
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ESCAPES[char] ?? char);
}

/** Scheme check for a reader-facing link: absolute http(s)/mailto or an anchor. */
function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (trimmed.startsWith("#")) return trimmed;
  if (/^https?:\/\//iu.test(trimmed)) return trimmed;
  if (/^mailto:/iu.test(trimmed)) return trimmed;
  return undefined;
}

/**
 * Markdown → HTML with the three overrides the single-file invariant needs.
 * A fresh `Marked` instance per call: the global one is shared with the docs
 * projection (`scripts/site-docs`), and a preview must not change how the site
 * renders (nor inherit it).
 */
export function markdownToHtml(
  markdown: string,
  assets: ReadonlyMap<string, PreviewAsset>,
): string {
  const md = new Marked({ gfm: true, breaks: false });
  md.use({
    renderer: {
      // Raw HTML in the artifact is shown as text, never executed.
      html(token) {
        return `<pre class="raw-html">${escapeHtml(token.text)}</pre>\n`;
      },
      link(token) {
        const href = safeHref(token.href);
        const label = (
          this as { parser: { parseInline(tokens: unknown): string } }
        ).parser.parseInline(token.tokens);
        if (href === undefined) return `<span class="unsafe-link">${label}</span>`;
        return `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${label}</a>`;
      },
      image(token) {
        const asset = assets.get(token.href);
        const label = escapeHtml(token.text === "" ? token.href : token.text);
        if (asset !== undefined) return `<img src="${asset.dataUri}" alt="${label}">`;
        // No fetch, no broken image. A SPAN, never an anchor: a badge is usually
        // `[![alt](badge)](target)`, and emitting a link here would nest anchors
        // (invalid HTML the reader's brain has to parse). The URL survives in
        // `title`, which is neither a fetch nor an asset reference.
        return `<span class="asset-note" title="${escapeHtml(token.href)}">${label} (not embedded)</span>`;
      },
    },
  });
  return md.parse(markdown, { async: false });
}

/**
 * The page stylesheet, inline. No font, no CDN, no `url()`: the document must
 * render identically on a machine with the network unplugged.
 */
const STYLES = `
:root{color-scheme:light dark;--fg:#1b1f23;--muted:#5a6673;--bg:#ffffff;--panel:#f6f8fa;--line:#d8dee4;--accent:#0969da;--warn:#9a6700;--fail:#cf222e}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#9aa7b2;--bg:#0d1117;--panel:#161b22;--line:#30363d;--accent:#4493f8;--warn:#d29922;--fail:#f85149}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:60rem;margin:0 auto;padding:2rem 1.25rem 4rem}
header.page{border-bottom:1px solid var(--line);padding-bottom:1rem;margin-bottom:1.5rem}
h1{font-size:1.6rem;margin:0 0 .25rem}
.meta{color:var(--muted);font-size:.85rem;margin:0}
nav.toc{display:flex;flex-wrap:wrap;gap:.4rem;margin:.9rem 0 0;padding:0;list-style:none}
nav.toc a{font-size:.82rem;text-decoration:none;color:var(--accent);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:.15rem .6rem}
section.surface{border:1px solid var(--line);border-radius:.6rem;margin:0 0 1.5rem;overflow:hidden}
section.surface>header{display:flex;flex-wrap:wrap;gap:.5rem;align-items:baseline;background:var(--panel);padding:.55rem .9rem;border-bottom:1px solid var(--line)}
section.surface>header h2{font-size:1rem;margin:0}
section.surface>header .tag{font-size:.72rem;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:.05rem .5rem}
section.surface>header .path{font-size:.75rem;color:var(--muted);word-break:break-all}
.body{padding:.9rem 1.1rem}
.body>:first-child{margin-top:0}
.body>:last-child{margin-bottom:0}
.body h1,.body h2,.body h3{line-height:1.3;margin:1.2rem 0 .5rem}
.body h1{font-size:1.3rem}.body h2{font-size:1.12rem}.body h3{font-size:1rem}
.body a{color:var(--accent)}
.body code{font:0.875em ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--panel);padding:.1em .35em;border-radius:.25rem}
.body pre{background:var(--panel);border:1px solid var(--line);border-radius:.4rem;padding:.7rem;overflow:auto}
.body pre code{background:none;padding:0}
.body table{border-collapse:collapse;width:100%;font-size:.9rem}
.body th,.body td{border:1px solid var(--line);padding:.35rem .5rem;text-align:left}
.body img{max-width:100%;height:auto;border-radius:.4rem}
.body blockquote{margin:0;padding-left:.9rem;border-left:3px solid var(--line);color:var(--muted)}
.raw-html{font-size:.8rem;color:var(--muted);white-space:pre-wrap}
.asset-note{font-size:.85rem;color:var(--muted)}
.unsafe-link{text-decoration:underline dotted}
.notes{margin:0;padding:.5rem .9rem;border-top:1px solid var(--line);background:var(--panel);font-size:.82rem;color:var(--muted)}
.notes li{margin:.15rem 0}
.empty{padding:.9rem 1.1rem;color:var(--muted);font-style:italic}
.findings{font-size:.85rem}
.findings li{margin:.2rem 0}
table.limits{width:100%;border-collapse:collapse;margin:0 0 .9rem;font-size:.85rem}
table.limits caption{text-align:left;color:var(--muted);padding-bottom:.3rem}
table.limits th,table.limits td{border:1px solid var(--line);padding:.25rem .5rem;text-align:left}
.sev-error{color:var(--fail)}.sev-warn{color:var(--warn)}
footer.page{border-top:1px solid var(--line);margin-top:2rem;padding-top:1rem;color:var(--muted);font-size:.8rem}
`;

function renderSection(section: PreviewSection, assets: ReadonlyMap<string, PreviewAsset>): string {
  const body =
    section.markdown.trim() === ""
      ? `<p class="empty">${escapeHtml(
          section.notes[0] ?? "no artifact for this platform and language",
        )}</p>`
      : `<div class="body">${markdownToHtml(section.markdown, assets)}</div>`;
  const notes =
    section.markdown.trim() === "" || section.notes.length === 0
      ? ""
      : `<ul class="notes">${section.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`;
  return `<section class="surface" id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-title">
  <header>
    <h2 id="${escapeHtml(section.id)}-title">${escapeHtml(section.title)}</h2>
    <span class="tag">${escapeHtml(section.origin)}</span>
    ${section.artifact === null ? "" : `<span class="path">${escapeHtml(section.artifact)}</span>`}
  </header>
  ${body}
  ${notes}
</section>`;
}

function renderChecks(
  checks: readonly PreviewCheckFinding[],
  limits: readonly PreviewLimit[],
): string {
  const errors = checks.filter((c) => c.severity === "error").length;
  const warns = checks.length - errors;
  const rows =
    checks.length === 0
      ? `<p class="empty">no finding — the offline rules that ran did not complain</p>`
      : `<ul class="findings">${checks
          .map(
            (c) =>
              `<li><span class="sev-${escapeHtml(c.severity)}">${escapeHtml(c.severity)}</span> [${escapeHtml(c.code)}] ${escapeHtml(c.message)} <span class="meta">${escapeHtml(c.path)}</span></li>`,
          )
          .join("")}</ul>`;
  return `<section class="surface" id="checks" aria-labelledby="checks-title">
  <header>
    <h2 id="checks-title">checks</h2>
    <span class="tag">${errors} error(s) · ${warns} warning(s)</span>
    <span class="path">the same offline rules pasco check runs</span>
  </header>
  <div class="body">${renderLimits(limits)}${rows}</div>
</section>`;
}

/**
 * The surfaces `build` would not write for this language. Not a section per
 * surface: forty empty frames say less than one line that names them and the
 * reason (the issue's "cero remainder silencio" in page form).
 */
function renderUnpublished(items: readonly UnpublishedSurface[]): string {
  if (items.length === 0) return "";
  return `<section class="surface" id="not-published" aria-labelledby="not-published-title">
  <header>
    <h2 id="not-published-title">not published for this language</h2>
    <span class="tag">${items.length} surface(s)</span>
  </header>
  <div class="body"><ul class="findings">${items
    .map((item) => `<li><code>${escapeHtml(item.id)}</code> — ${escapeHtml(item.reason)}</li>`)
    .join("")}</ul></div>
</section>`;
}

/** The declared caps, so "with its limits" is a table and not a footnote. */
function renderLimits(limits: readonly PreviewLimit[]): string {
  if (limits.length === 0) return "";
  return `<table class="limits"><caption>declared limits (content/checks.yaml)</caption><thead><tr><th>platform</th><th>rule</th><th>value</th></tr></thead><tbody>${limits
    .map(
      (l) =>
        `<tr><td><code>${escapeHtml(l.platform)}</code></td><td>${escapeHtml(l.rule)}</td><td><code>${escapeHtml(l.value)}</code></td></tr>`,
    )
    .join("")}</tbody></table>`;
}

/** The finished document. Deterministic for a given `PreviewDocument`. */
export function renderPreviewDocument(doc: PreviewDocument): string {
  const assets = new Map(doc.assets.map((a) => [a.target, a] as const));
  const toc = doc.sections
    .map((s) => `<li><a href="#${escapeHtml(s.id)}">${escapeHtml(s.title)}</a></li>`)
    .join("");
  const warnings =
    doc.warnings.length === 0
      ? ""
      : `<section class="surface" id="warnings" aria-labelledby="warnings-title">
  <header><h2 id="warnings-title">preview notes</h2></header>
  <div class="body"><ul class="findings">${doc.warnings
    .map((w) => `<li class="sev-warn">${escapeHtml(w)}</li>`)
    .join("")}</ul></div>
</section>`;
  const omitted =
    doc.omitted.length === 0
      ? ""
      : `<ul class="notes">${doc.omitted
          .map((o) => `<li>not embedded: ${escapeHtml(o.target)} — ${escapeHtml(o.reason)}</li>`)
          .join("")}</ul>`;
  return `<!doctype html>
<html lang="${escapeHtml(doc.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(doc.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
<header class="page">
  <h1>${escapeHtml(doc.title)}</h1>
  <p class="meta">generated ${escapeHtml(doc.generatedAt)} from ${doc.facts} facts · ${escapeHtml(doc.engine)} · lang ${escapeHtml(doc.lang)} · ${escapeHtml(doc.workspaceName)} · local preview, not published</p>
  <nav aria-label="sections"><ul class="toc">${toc}<li><a href="#checks">checks</a></li>${
    doc.unpublished.length === 0 ? "" : '<li><a href="#not-published">not published</a></li>'
  }</ul></nav>
</header>
<main>
${doc.sections.map((s) => renderSection(s, assets)).join("\n")}
${renderUnpublished(doc.unpublished)}
${renderChecks(doc.checks, doc.limits)}
${warnings}
${
  omitted === ""
    ? ""
    : `<section class="surface" id="assets" aria-labelledby="assets-title">
  <header><h2 id="assets-title">assets</h2><span class="tag">${doc.assets.length} embedded · ${doc.omitted.length} left out</span></header>
  <div class="body">${omitted}</div>
</section>`
}
</main>
<footer class="page">
  One self-contained file: no script, no external asset, no server. Rendered by <code>pasco preview</code> from the workspace's own data; it is not a publication.
</footer>
</div>
</body>
</html>
`;
}
