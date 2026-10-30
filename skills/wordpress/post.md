# WordPress long-form post — skill (MVP)

> Long-form post skill. The contract is `longform.yaml`: required/optional
> fields, the editorial word band and `export` live there and are **not**
> restated here — this file is the judgment layer the agent reads before
> writing. The contract's `sources[]` carries the dated URL for every platform
> claim; re-verify before making a hard one, and cite a source (date + tier)
> before calling anything a limit.

## What a WordPress piece is for

The piece on a site the operator controls: a durable page with its own URL,
its own theme and its own permanence. WordPress supports the longest shelf life
of any channel here — a well-structured post keeps being found and cited after
the feeds move on — so write for the reader who arrives six months later with a
question, not only for the reader who subscribes today.

## Shape

1. **Title** — the question the post answers or the outcome it delivers, in the
   words a reader would search.
2. **Dek** — the summary. The contract requires it as a field and declares no
   mapping to the REST `excerpt`: the endpoint takes an excerpt per the
   contract's source, but whether the engine's `dek` arrives there is unverified
   [?]. Write it as a standalone summary and confirm the mapping on the first
   publish.
3. **Sections** — one H2 per step or idea, H3 only for sub-steps; the heading
   hierarchy is the page's table of contents and its extractable structure. Open
   with the answer, then the reasoning, then the caveats.

## Rules

- **Front matter is the field contract.** `longform.yaml` declares the fields this
  channel consumes, required and optional alike; the engine exports only those,
  and an undeclared field is dropped (`pasco post check` warns `unknown-field`) —
  never smuggle one into the body instead.
- **Length:** the band in `limits.words` is the operator's editorial default (the
  contract says so), not a WordPress limit. It is the budget for a page that
  answers one question completely.
- **Links:** `links.policy` is `identity-ssot-only`. On a site the operator owns,
  internal links are still SSOT links — do not type a URL the SSOT does not
  carry, and set `canonical` only when the piece is syndicated and the SSOT
  carries the original.
- **Facts:** `{{fact:<pointer>}}` for every number, date and URL.
- **Voice:** first person, explanatory, no hype. Match `brandVoice`; a durable
  page is written to be re-read, so avoid references that only make sense "this
  week" unless the date is stated.

## Export: `api`

The contract declares `export: api`: the WordPress REST posts endpoint takes the
title, content, tags and an excerpt [OFICIAL — the contract's source, `sources[]`
in `longform.yaml`, dated 2026-10-29]. Consequences for the writing:

- The body is content the endpoint receives; keep it valid markdown/HTML with a
  clean heading hierarchy — no layout that depends on the editor's blocks.
- The contract declares no dek→excerpt mapping. The endpoint takes an excerpt per
  its source, and whether the engine's `dek` lands there is unverified [?] —
  confirm on the first publish. Either way the dek is a field, never the body's
  first paragraph.
- The export produces a Postiz draft payload; publishing stays manual (no
  scheduler, no OAuth — `docs/post-mvp.md`).

## GEO (how this channel is read and cited)

A page on the operator's own domain is the most citable surface here: public,
indexed, stable URL. Structure is what gets extracted — a question-shaped title, a
summary in the dek field (mapped to the excerpt only if the site does that, [?]),
and claims stated directly under the heading that
names them. The crawler stance is the repo's global `ai.policy`
(`platforms/registry.yaml`, v1, 2026-10-27); no per-channel rule is invented
here. Consistency check: every fact matches the profile byte for byte, and the
page's dates stay truthful as it ages.

## i18n

A WordPress site is per language (one site, one locale, or a multilingual setup
the operator already runs). Write `en` by default; a Spanish post belongs to the
Spanish site, and each translation is its own post with its own URL — never a
duplicate of the English one under the same canonical.

## Anti-patterns

- A page that buries the answer under three paragraphs of context.
- Heading levels used for visual size instead of structure.
- A dek repeated verbatim as the first paragraph.
- Time-bound language with no date ("recently", "this week").
- Syndicated content with no canonical back to the original.

## Output contract

Save each variant as YAML front matter + a markdown body at
`posts/<seed>/wordpress/wordpress-<n>.md`, then record the choice and check it:

```
pasco post choose <seed> --channel wordpress --variant wordpress-1
pasco post check <seed>     # missing-field · word-count · url-not-in-ssot · unknown-field
pasco post export <seed> --target postiz
```
