# Substack long-form post — skill (MVP)

> Long-form post skill. The contract is `longform.yaml`: required/optional
> fields, the editorial word band and `export` live there and are **not**
> restated here — this file is the judgment layer the agent reads before
> writing. The contract's `sources[]` carries the dated URL for every platform
> claim; re-verify before making a hard one, and cite a source (date + tier)
> before calling anything a limit.

## What a Substack piece is for

A newsletter issue for subscribers that also becomes a public archive page. Two
readers, one text: the subscriber who opens it in an inbox and the visitor who
lands on the archive from a link. Substack is a reading surface with a
subscription relation attached — the issue is a letter that ends with a reason to
keep receiving it, not a post that closes with a hashtag.

## Shape

1. **Title** — the line that earns the open in an inbox and the click in search.
   State the value of reading, not just the topic.
2. **Dek** — the line under the title in the archive and the setup in the email:
   one sentence of stake. The contract requires it; how the publication renders
   it is editor-controlled [?] — verify on the first publish.
3. **Sections** — the letter opens with the point, develops it once, and closes
   with what comes next. H2 per move; the closing line is written, never left to
   "thanks for reading".

## Rules

- **Front matter is the field contract.** `longform.yaml` declares the fields this
  channel consumes, required and optional alike; the engine exports only those,
  and an undeclared field is dropped (`pasco post check` warns `unknown-field`) —
  never smuggle one into the body instead.
- **Length:** the band in `limits.words` is the operator's editorial default (the
  contract says so), not a Substack limit. It is the budget for an issue read in
  one sitting.
- **Links:** `links.policy` is `identity-ssot-only`. `canonical` is only set when
  the SSOT already carries the target URL; the archive page is a public URL of
  its own and, once live, is what other channels can point at — but that pointer
  enters the SSOT first, never the prose.
- **Facts:** `{{fact:<pointer>}}` for every number, date and URL.
- **Voice:** first person, letter-like, no hype. Match `brandVoice`; a newsletter
  is where the operator's actual voice is the differentiator.

## Export: `paste`

The contract declares `export: paste` because Substack publishes from its editor
and exposes no body-publish API [OFICIAL — the contract's source, `sources[]` in
`longform.yaml`, dated 2026-10-29]. Consequences for the writing and the deploy:

- The body is **pasted into the editor**; keep the markdown paste-safe
  (headings, paragraphs, lists, bold/italic, block quotes, links). Re-check
  formatting after pasting — nothing should arrive flattened.
- Fields are pasted one by one; the generated `paste-checklist.md` is the record
  of what was pasted and in what order.
- The export is a checklist, not a publish: sending stays a manual action.

## GEO (how this channel is read and cited)

The archive page is public and indexable; the email copy is not. The citation
unit is a section heading plus the claim under it, resolving to the archive URL —
which is why the piece must read as well on the web as in the inbox. The crawler
stance is the repo's global `ai.policy` (`platforms/registry.yaml`, v1,
2026-10-27); no per-channel rule is invented here. Consistency check: the issue's
facts are byte-identical to the profile and to the other channels' projections.

## i18n

A publication is per language: one publication, one subscriber base, one
language. Write `en` by default; a Spanish publication is a separate surface with
its own archive. Do not send the same text in two languages to one list.

## Anti-patterns

- An issue that opens with "welcome back" instead of the point.
- A dek that repeats the title with different words.
- A "read the full piece on…" issue that is only a teaser.
- Rich formatting that the editor flattens on paste.
- A closing that asks for shares but not for a reply or a next step.

## Output contract

Save each variant as YAML front matter + a markdown body at
`posts/<seed>/substack/substack-<n>.md`, then record the choice and check it:

```
pasco post choose <seed> --channel substack --variant substack-1
pasco post check <seed>     # missing-field · word-count · url-not-in-ssot · unknown-field
pasco post export <seed>    # paste: writes posts/<seed>/substack/paste-checklist.md
```
