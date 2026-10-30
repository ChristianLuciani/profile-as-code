# Hashnode long-form post — skill (MVP)

> Long-form post skill. The contract is `longform.yaml`: required/optional
> fields, the editorial word band and `export` live there and are **not**
> restated here — this file is the judgment layer the agent reads before
> writing. The contract's `sources[]` carries the dated URL for every platform
> claim; re-verify before making a hard one, and cite a source (date + tier)
> before calling anything a limit.

## What a Hashnode piece is for

A technical article published on a developer blogging network — the network feed
plus, optionally, a publication. It is the "write it once, let it be found by
developers" surface: an idea, a working example and the reasoning between them.
It is not a copy of the newsletter issue with a different header.

## Shape

1. **Title** — what the reader can build or decide after reading. No curiosity
   gap that the body does not close.
2. **Dek** — one line of scope: the problem, the approach, the result. The
   contract requires it as a field and the engine delivers it as front matter,
   never as the body's first lines. No platform mapping is declared; confirm on
   the first publish how Hashnode renders it [?].
3. **Sections** — an opening that states the problem, then one H2 per step of
   the solution, then the caveats. Code is the evidence: show it, state the
   version, and keep it runnable.

## Rules

- **Front matter is the field contract.** `longform.yaml` declares the fields this
  channel consumes, required and optional alike; the engine exports only those,
  and an undeclared field is dropped (`pasco post check` warns `unknown-field`) —
  never smuggle one into the body instead.
- **Length:** the band in `limits.words` is the operator's editorial default (the
  contract says so in its header), not a platform cap. It is a guardrail for a
  piece read in one sitting.
- **Links:** `links.policy` is `identity-ssot-only`. `canonical` points at the
  canonical home from the SSOT when the piece is syndicated; a network URL is
  never the canonical for another channel's copy unless the SSOT says so.
- **Facts:** `{{fact:<pointer>}}` for every number, date, version and URL.
- **Voice:** first person technical, second person for the reader ("you"); no
  hype, no "revolutionary".

## Export: `api`

The contract declares `export: api`: the body is markdown published through
Hashnode's GraphQL API, with the title, tags and markdown content in the mutation
[OFICIAL — the contract's source, `sources[]` in `longform.yaml`, dated
2026-10-29]. Consequences for the writing:

- Markdown only; no raw HTML or editor-only embeds.
- `publication` is a payload field (which blog the post belongs to) — it is not
  a body line and it is not the author profile.
- The export produces a Postiz draft payload; publishing stays manual (no
  scheduler, no OAuth — `docs/post-mvp.md`).

## GEO (how this channel is read and cited)

Hashnode article pages are public and indexed, and the tags are the paths readers
arrive from. The quotable unit is the code block plus the sentence that says what
it proves — so keep the claim adjacent to the snippet. The crawler stance is the
repo's global `ai.policy` (`platforms/registry.yaml`, v1, 2026-10-27); no
per-channel rule is invented here. Consistency check: version numbers, dates and
claims match the SSOT byte for byte, same as the profile.

## i18n

The network's audience and tag vocabulary are English-first: write `en` by
default. A Spanish article is its own seed for that audience, not a translation
of the English one, and it must not share a canonical with it.

## Anti-patterns

- A tutorial whose code cannot run as printed.
- A "getting started" post that is only a link to someone else's docs.
- Tag stuffing to reach feeds the piece does not belong to.
- Cross-posting without `canonical`.
- Numbers with no method, date or source.

## Output contract

Save each variant as YAML front matter + a markdown body at
`posts/<seed>/hashnode/hashnode-<n>.md`, then record the choice and check it:

```
pasco post choose <seed> --channel hashnode --variant hashnode-1
pasco post check <seed>     # missing-field · word-count · url-not-in-ssot · unknown-field
pasco post export <seed> --target postiz
```
