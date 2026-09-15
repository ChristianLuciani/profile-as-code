/**
 * Markdown-safety helpers shared by the markdown-emitting renderers — SPEC §15.2.
 *
 * A renderer interpolates SSOT values into markdown. Two surfaces are reachable
 * with contract-legitimate content (`$defs/url` is `^https?://` + `format: uri`;
 * labels are free text) and break the parse when interpolated raw:
 *
 * - the DESTINATION goes through `mdHref()` (issue #73) — an ASCII space,
 *   control character or an unbalanced paren ends a CommonMark destination early;
 * - the link TEXT goes through `mdText()` (issue #76) — a raw `[`/`]` closes the
 *   label early and the rest of the line degrades into text plus an autolink.
 *
 * Both are pure and total. Structured surfaces (JSON-LD `sameAs`/`email`) stay
 * verbatim (§18.4), and facts keep their bytes: `mdText` adds a CommonMark
 * backslash escape that the parser removes again, so the rendered label is
 * unchanged — only the markdown source gains the escape.
 *
 * This is a package rather than a per-renderer copy: the rule must reach every
 * markdown renderer (M2/M4) without being re-implemented, because a rule that
 * travels by copy is exactly how the same bug arrives in the next adapter.
 */

/**
 * Make a URL safe as a CommonMark link destination.
 *
 * `mdHref` encodes exactly the unsafe ASCII — space/controls/DEL (`%XX`, UTF-8),
 * the URL-invalid printable set, `(`, `)` and an invalid `%` — and keeps
 * everything else verbatim, including VALID percent-escapes and non-ASCII (IRIs).
 * TAB/LF/CR never arrive (the schema boundary's WHATWG preprocessing strips
 * them), so encoding them here is defensive only.
 *
 * Invariants (verified exhaustively over all 128 ASCII chars):
 * - an already-encoded URL is never double-encoded (`encodeURI` turned `%20` into
 *   `%2520`, addressing a different resource) — the addressed resource is
 *   preserved, since percent-escapes resolve identically after CommonMark's
 *   destination decoding;
 * - a lone `%` (malformed escape) becomes `%25` — it changes how the URL resolves
 *   downstream;
 * - the output is byte-identical to the plain-ASCII path for every URL without a
 *   valid `%` escape and without non-ASCII.
 *
 * Used by EVERY markdown destination a renderer emits from a SSOT URL: badges,
 * project links, evidence sources, DOI hrefs, credential `verifyUrl`s, artifact
 * url locators (issue #73), brand handles/newsletter/podcast/press/logo
 * (issue #75), asset targets (M8/§18.6) and the contact email (v1.5/#71). It is
 * NOT for filesystem-facing surfaces: the manifest and the renderer's declared
 * asset target keep the RAW path (they address the file; the href addresses the
 * URL on the deploy surface).
 */
export function mdHref(href: string): string {
  return (
    href
      // A `%` that does not start a valid escape is a literal percent → %25
      // (a malformed escape changes how the URL resolves downstream). A VALID
      // escape stays verbatim: an already-encoded URL must never be
      // double-encoded — `encodeURI` turned `%20` into `%2520`, addressing a
      // different resource.
      .replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
      // Exactly what `encodeURI` percent-encodes in ASCII minus `%` — ASCII
      // controls, space, DEL, C1 controls and the URL-invalid printable set.
      // All are invalid in a URL; space and controls also end a CommonMark
      // destination. Non-ASCII (≥ U+00A0) is deliberately left verbatim: an
      // IRI is a valid CommonMark destination and byte-stability beats
      // normalization.
      .replace(/[\u0000-\u0020\u007F-\u009F"<>[\]\\^`{|}]/g, (c) => encodeURIComponent(c))
      // Both parens are encoded: a `)` ends a bare destination unless balanced,
      // and uniform output is deterministic (immune to balance games).
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
  );
}

/**
 * Make a value safe as CommonMark link TEXT (a label).
 *
 * A raw `[`/`]` in the label closes it early — the link does not exist and the
 * remainder becomes text plus an autolink. A backslash escape is the fix: it is
 * the only CommonMark-level construct that survives verbatim into the rendered
 * label (percent-encoding the label would change the visible bytes, which are
 * facts — §18.4 keeps facts raw).
 *
 * Only the three characters that can break or be broken by escaping are touched
 * (`\`, `[`, `]`). A space, a paren or an accent in a label is perfectly valid
 * CommonMark text and stays raw, so the output is byte-identical for every label
 * without those three characters.
 */
export function mdText(text: string): string {
  // Backslash first (it is also the escape character), then both brackets.
  return text.replace(/[\\[\]]/g, '\\$&');
}
