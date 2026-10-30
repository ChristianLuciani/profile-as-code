# Ghost long-form post — skill (MVP)

> Long-form post skill. The contract is `longform.yaml`: required/optional
> fields, the editorial word band and `export` live there and are **not**
> restated here — this file is the judgment layer the agent reads before
> writing. The contract's `sources[]` carries the dated URL for every platform
> claim; re-verify before making a hard one, and cite a source (date + tier)
> before calling anything a limit.

## What a Ghost piece is for

An essay or newsletter issue that lives on a publication the operator controls,
with its own domain and archive. That makes it the surface where the canonical
URL of a piece can exist: other channels point their `canonical` here *when the
SSOT already carries that URL* — never a URL the agent typed. The reader is
either a subscriber reading an email or someone who arrived from search; write
for both without writing twice.

## Shape

1. **Title** — the one claim the piece makes, stated so it still reads well in
   an inbox list and in a search result.
2. **Dek** — the line that earns the next scroll: context, stake, or the
   question the piece answers. The contract requires it; how the theme renders
   it (subtitle, excerpt, nothing) varies per publication theme [?] — verify on
   the first publish and record what you saw.
3. **Sections** — an essay argues, so give each section one move: the situation,
   the tension, the evidence, the conclusion. H2 headings are the anchors a
   reader (and an extractor) navigates by.

## Rules

- **Front matter is the field contract.** The fields `longform.yaml` declares are
  the ones the channel consumes; anything else is dropped (`unknown-field`
  warning) — do not re-add it in the body.
- **Length:** the band in `limits.words` is the operator's editorial default
  (the contract says so). Aim for the piece the argument needs; the band is a
  guardrail, not a quota.
- **Links:** `links.policy` is `identity-ssot-only`. A Ghost publication is a
  URL surface like any other: every URL in the piece comes from the identity
  SSOT, and `canonical` is only set when the SSOT already carries the target.
- **Facts:** `{{fact:<pointer>}}` for every number, date and URL; a dangling
  pointer fails the check.
- **Voice:** first person, essayistic, no hype. Match `brandVoice`; a newsletter
  issue is the one surface where a longer voice can breathe — do not turn that
  into padding.

## Export: `paste`

The contract declares `export: paste` even though Ghost ships an Admin API: v1
keeps Ghost a paste surface like Substack, by decision (#266), and the contract's
`sources[]` records the Admin API docs [OFICIAL, dated 2026-10-29]. Consequences
for the writing and the deploy:

- The body is **pasted into the publication editor**; formatting must survive a
  paste. Keep markdown simple: headings, paragraphs, lists, code fences, block
  quotes. No raw HTML, no footnotes the editor may flatten, no tables unless you
  re-check them after pasting.
- `pasco post export` writes a paste checklist, not a publish: the deploy is
  manual and the checklist is the record of what was pasted.
- Fields are pasted one by one — treat the checklist as the field contract's
  human-readable form and tick each line.

## GEO (how this channel is read and cited)

The publication's own domain is the citable address: its archive pages are
public and indexable, while the email copy is not. That is why the canonical URL
matters here more than on a network — the citation unit is a section heading
plus the claim under it, and it resolves to a URL the operator owns. The crawler
stance is the repo's global `ai.policy` (`platforms/registry.yaml`, v1,
2026-10-27); no per-channel rule is invented here. Consistency check: the piece's
facts are byte-identical to the profile and to every other channel's projection.

## i18n

A Ghost publication is per language: one publication, one audience language.
Write `en` by default; a Spanish publication is a separate publication with its
own domain and archive, and the piece belongs to exactly one of them. Do not
publish a machine translation of the same text under the same canonical.

## Anti-patterns

- An essay whose first two paragraphs are a table of contents.
- A `canonical` invented for the occasion — it must come from the SSOT.
- Rich HTML that the editor flattens on paste, discovered after publishing.
- Email-only framing in a piece that is also the public archive page.
- A newsletter issue that is a link dump with no argument.

## Output contract

Save each variant as YAML front matter + a markdown body at
`posts/<seed>/ghost/ghost-<n>.md`, then record the choice and check it:

```
pasco post choose <seed> --channel ghost --variant ghost-1
pasco post check <seed>     # missing-field · word-count · url-not-in-ssot · unknown-field
pasco post export <seed>    # paste: writes posts/<seed>/ghost/paste-checklist.md
```
