# Medium long-form post — skill (MVP)

> Long-form post skill. The contract is `longform.yaml`: required/optional
> fields, the editorial word band and `export` live there and are **not**
> restated here — this file is the judgment layer the agent reads before
> writing. The contract's `sources[]` carries the dated URL for every platform
> claim; re-verify before making a hard one, and cite a source (date + tier)
> before calling anything a limit.

## What a Medium piece is for

An essay for a professional audience that reads to *understand a position*, not
to copy a snippet. Medium is a reading surface with tags and publications as its
two distribution paths; the piece competes for a reader's attention against other
essays, so the argument — not the feature list — is what travels. The technical
depth lives on the other channels; here the decision, its cost and its
consequence carry the piece.

## Shape

1. **Title** — the position in one line. Concrete and arguable; if nobody could
   disagree, it is not a title for this channel.
2. **Dek** — the stake: what the reader gets by finishing. The contract requires
   it as a field and the engine delivers it as front matter, never as the body's
   first lines. No platform mapping is declared; confirm on the first publish how
   Medium renders it [?].
3. **Sections** — narrative arc, not a manual: situation → tension → what was
   done → what it cost → what follows. H2 per move; short paragraphs; one idea
   per paragraph.

## Rules

- **Front matter is the field contract.** `longform.yaml` declares the fields this
  channel consumes, required and optional alike; the engine exports only those,
  and an undeclared field is dropped (`pasco post check` warns `unknown-field`) —
  never smuggle one into the body instead.
- **Length:** the band in `limits.words` is the operator's editorial default (the
  contract says so), not a Medium limit — Medium does not publish a cap this
  contract relies on.
- **Links:** `links.policy` is `identity-ssot-only`. When the piece is syndicated,
  `canonical` points at the canonical home from the SSOT — a Medium URL is never
  the canonical for the original.
- **Facts:** `{{fact:<pointer>}}` for every number, date, URL and claim of
  achievement.
- **Voice:** first person, essayistic, no hype and no "lessons learned" filler.
  Match `brandVoice`; Medium's audience rewards specificity, not enthusiasm.

## Export: `api`

The contract declares `export: api`: the Medium posting API takes the title, tags
and canonical URL in the post payload and the body as markdown [OFICIAL — the
contract's source, `sources[]` in `longform.yaml`, dated 2026-10-29]. Two
consequences:

- The writer must not depend on a formatting feature the API payload does not
  carry: markdown, no raw HTML.
- Whether the operator can still obtain write access to that API is **not**
  stated by the contract's source: verify access before relying on `export: api`
  for a real publish [?]. The export itself only produces a Postiz draft payload,
  and publishing stays manual (no scheduler, no OAuth — `docs/post-mvp.md`).

## GEO (how this channel is read and cited)

Medium pages are public and indexed, and the tags are browsing paths rather than
search intent. The quotable unit is a stated position plus the evidence
immediately under it, so keep the claim next to its proof instead of building a
reveal. The crawler stance is the repo's global `ai.policy`
(`platforms/registry.yaml`, v1, 2026-10-27); no per-channel rule is invented
here. Consistency check: every fact agrees with the profile and with the other
channels' projections, byte for byte.

## i18n

Write `en` by default: the audience and the tag vocabulary are English-first, and
a publication is per language. A Spanish essay is its own seed for that audience,
not a translated copy of the English one — two canonicals of one text split the
citation.

## Anti-patterns

- A "10 lessons" listicle with no evidence per lesson.
- An essay that opens with a dictionary definition.
- A `canonical` invented for the occasion.
- Syndicating the original without a canonical back to the SSOT home.
- Enthusiasm in place of an argument.

## Output contract

Save each variant as YAML front matter + a markdown body at
`posts/<seed>/medium/medium-<n>.md`, then record the choice and check it:

```
pasco post choose <seed> --channel medium --variant medium-1
pasco post check <seed>     # missing-field · word-count · url-not-in-ssot · unknown-field
pasco post export <seed> --target postiz
```
