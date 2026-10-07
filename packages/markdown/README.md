# `@profile-as-code/markdown`

CommonMark-safety helpers shared by every markdown-emitting renderer — the ONE
home of the rule, never re-implemented in an adapter (SPEC §15.2).

A renderer interpolates SSOT values into Markdown. Two surfaces are reachable
with contract-legitimate content — `$defs/url` is `^https?://` + `format: uri`,
and labels are free text — and each one breaks the parse when interpolated raw:

| Export | Protects | Breaks without it |
|---|---|---|
| `mdHref(href)` | a link **destination** | an ASCII space, a control character or an unbalanced paren ends the destination early |
| `mdText(label)` | a link **label** | a raw `[`/`]` closes the label early — the link disappears and the rest degrades into text plus an autolink |

Both are pure and total. Structured surfaces (JSON-LD `sameAs`/`email`) stay
verbatim (§18.4), and facts keep their bytes: `mdText` escapes only `\`, `[` and
`]`, and the parser removes the escape again, so the rendered label is
unchanged — with a known, accepted cosmetic exception (the one the source
documents): a label carrying a code span **and** a bracket still parses (the
span protects the bracket), but the visible text shows the backslash, because
CommonMark does not process escapes inside a code span. Escaping the backtick
would fix that case by destroying the intended span — a worse trade, so it is
deliberately not done.

## Usage

```ts
import { mdHref, mdText } from "@profile-as-code/markdown";

const line = `- [${mdText(project.title)}](${mdHref(project.url)})`;
```

`mdHref` encodes exactly the unsafe ASCII (space, controls, DEL, the
URL-invalid printable set, `(`/`)` and a malformed `%`) and keeps everything
else verbatim — including valid percent-escapes and non-ASCII (IRIs). An
already-encoded URL is therefore never double-encoded: `encodeURI` turned
`%20` into `%2520`, addressing a different resource.

It is **not** for filesystem-facing surfaces. The asset manifest and a
renderer's declared asset target keep the raw path — they address the file,
the href addresses the URL on the deploy surface.

## Dependencies

None at runtime. Consumed by the Markdown renderers
(`renderers-github-readme`, `renderers-github-org`).

See [SPEC §15.2](../../docs/SPEC.md) · [repository README](../../README.md).
