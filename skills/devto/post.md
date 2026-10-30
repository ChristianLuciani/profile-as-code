# DEV (Forem) long-form post — skill (MVP)

> Long-form post skill. The contract is `longform.yaml`: required/optional
> fields, the editorial word band and `export` live there and are **not**
> restated here — this file is the judgment layer the agent reads before
> writing. The contract's `sources[]` carries the dated URL for every platform
> claim; re-verify before making a hard one, and cite a source (date + tier)
> before calling anything a limit.

## What a DEV piece is for

A technical piece for developers who will judge it by whether the code and the
claim hold up. The reader arrives from a tag feed, from search, or from a
cross-post on another channel — so the piece must stand alone: one technique,
one result, or one decision with its trade-off. It is not a career update and
not a newsletter issue.

## Shape

1. **Title** — the outcome the reader gets, in concrete verbs. No numbers you
   cannot source, no curiosity gap the body does not pay off.
2. **Dek** — one line of scope: what the piece assumes and what it delivers.
   The contract requires it as a field, and the engine's task bundle is explicit
   that title and dek are fields, never the first lines of the body — so the dek
   is delivered in the front matter, not repeated as the body's opening line. No
   platform mapping is declared; confirm on the first publish whether DEV renders
   it as a subtitle [?].
3. **Sections** — one H2 per step or idea. Show the smallest example that
   proves the point, then the caveat. The contract fixes the three-part
   structure; how many sections that takes is editorial.

## Rules

- **Front matter is the field contract.** Supply the fields `longform.yaml`
  declares. A field the channel does not declare is not exported (`pasco post
  check` warns `unknown-field`) — never smuggle it into the body instead.
- **Length:** the band in `limits.words` is the operator's editorial default,
  not a DEV limit (the contract says so in its own header). Treat it as the
  budget for a piece a developer finishes in one sitting, not as a ceiling to
  fill.
- **Links:** `links.policy` is `identity-ssot-only` — every URL comes from the
  identity SSOT. DEV syndicates, so `canonical` must point at the canonical
  home from the SSOT, never at a second syndication copy.
- **Facts:** every number, date, version and URL is cited with
  `{{fact:<pointer>}}`; the engine renders it and fails on a dangling pointer.
- **Voice:** first person, technical, no hype. Match `brandVoice`; the piece
  should sound like an engineer explaining a decision, not a growth account.

## Export: `api`

The contract declares `export: api`: the body is markdown that the Forem/DEV
articles API receives, with the title, tags and canonical URL carried as payload
fields [OFICIAL — the contract's source, `sources[]` in `longform.yaml`, dated
2026-10-29]. Consequences for the writing:

- Markdown only. No raw HTML, no embeds that only an editor understands.
- `canonical` is a payload field, not a body line — do not paste the URL into
  the text as a substitute.
- The export produces a Postiz draft payload; publishing stays manual (no
  scheduler, no OAuth — `docs/post-mvp.md`).

## GEO (how this channel is read and cited)

DEV article pages are public and indexed, and the quotable unit is the snippet
plus the sentence that says what it proves. Keep the version and the date inside
the code block or the sentence around it; a table of unsourced benchmarks is not
citable. The crawler stance is the repo's global `ai.policy`
(`platforms/registry.yaml`, v1, 2026-10-27) — do not invent a per-channel rule.
Consistency check: every version, date and number matches the SSOT byte for
byte, exactly as on the profile surfaces.

## i18n

DEV's audience and tag vocabulary are English-first: write `en` by default. A
Spanish piece is its own seed for the hispano dev community, not a translation
of the English one. Do not publish the same text twice in two languages: two
canonical URLs of one text split the citation.

## Anti-patterns

- "X is dead" / "N tools you must know" listicles with no artifact behind them.
- An intro that restates the title for three paragraphs.
- A code block that cannot run, or a version pin that is never stated.
- Cross-posting without `canonical` — two copies then compete for one query.
- A benchmark number with no method, date or source.

## Output contract

Save each variant as YAML front matter + a markdown body at
`posts/<seed>/devto/devto-<n>.md`, then record the choice and check it:

```
pasco post choose <seed> --channel devto --variant devto-1
pasco post check <seed>     # missing-field · word-count · url-not-in-ssot · unknown-field
pasco post export <seed> --target postiz
```
