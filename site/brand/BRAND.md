# profile-as-code — identity

**Status:** v1.0, ratified 2026-10-21. **Covers:** the mark, the lockup, the tile,
colour, type and usage. **Does not cover:** social cards, README banners, CLI output.
`as_of: 2026-10-21`.

## 1. The decision

The mark is **Smile · Soft**: a solid disc with a lowercase `p` cut out of it; the
counter of the p is the eye, one short cut below it is the mouth.

It was chosen on 2026-10-21 by three readers on visual preference alone (the author and
two reviewers), after the monogram-only p and the typographic directions had been drawn
and compared. The semiotic review in §2–§5 is the test that decision has to survive; it
does:

- it keeps the letter that names the tool;
- it adds one trait, not a second shape;
- every feature is a cut, so the mark stays one colour;
- the face is the shortest way to say “profile” without drawing a person.

## 2. The sign, in three registers

| Register | What it is |
|---|---|
| **Symbol** | the `p` = *profile*, *pasco* — a convention: the initial |
| **Icon** | the counter = an eye; the disc = a head / avatar; the p = a head in profile |
| **Index** | the disc = a badge or seal (an object that certifies); the cut = an inscription; the pupil = a gaze |

A logo usually works in one register. This one works in three at once, which is why it
survives scaling: a reader who knows the product sees the letter; a reader who does not
sees a face; both see the badge shape that every avatar already uses.

## 3. The name is arbitrary; the mark motivates it

`pasco` was not coined as an acronym. The bin was renamed `pac` → `pasco` because an
unrelated npm package already shipped a `pac` binary (`docs/USER-GUIDE.md`, “Why the
names”, checked 2026-09-30). Semiotically it is an **arbitrary signifier** — and it
sounds like a surname (Pascal, Pasco, Pasquale), not like a command. `profile-as-code`
is the motivated name.

The `p` is the hinge: the initial of both. It is the only element that can serve both
names without repeating the word, and the only one that can become a face. The chain is
`p` → *profile* → person → `pasco`: the mark gives the arbitrary name the body it lacks.
Nothing forces a reader to parse `P·AS·CO`; the mark does not depend on that reading.

## 4. One eye is a profile

A frontal face has two eyes. One eye, with the mouth moved to the side, is a head
turned: a **profile** — the portrait and the professional summary are the same word.
That fixes two constraints: never add a second eye, and keep the mouth off-centre, at
the side, not in the middle.

## 5. Every feature is a cut

The mark is one plate with holes: the p, the pupil and the mouth are all knockouts of
the disc. No inlay, no second ink, no gradient, no outline. That is why the coloured
pupil was rejected at the final step: an inlay breaks the technique for a 2 px accent,
and on the ink disc it sat at ≈3.1:1 — just over the 3:1 floor.

The source uses an SVG `mask`; it is the only non-path primitive in the asset. Flatten
it for print if the pipeline does not support masks (Illustrator/Figma “flatten”, or
`rsvg-convert`). The tile is the one exception to “everything is a cut”: its pupil is
painted Paper, because the tile is an opaque ground and a knockout there would show the
page through the eye.

## 6. Construction

| Property | Value |
|---|---|
| Artboard | 32 × 32 units |
| Disc | circle Ø 26 (r 13) at `(16, 16)` |
| p | stem 4 wide, bowl Ø 13.6 (r 6.8), counter Ø 6.88 (r 3.44) |
| p bounding box | 16.1 × 19.9 (`x 9.2 → 25.3`, `y 4.5 → 24.4`) |
| Pupil | Ø 2.3 at `(16.6, 10.2)` |
| Mouth | cubic from `(16.4, 20.6)` to `(23.8, 20.6)`, depth 2.7, stroke 1.6, round caps |
| Minimum size | 16 px; the face reads from 32 px |
| Clear space | ≥ 4 units when placed; the 32 artboard already carries 3 |

The mark is an SVG source, never a PNG, and it inherits `currentColor`.

## 7. Lockup

Mark 28 px, wordmark 19 px, gap 8 px — about 10 px visual, because the disc’s
sidebearing does the rest. In HTML the wordmark is live text, not outlines: it keeps the
page selectable, searchable and translatable. The accessible name is always
`profile-as-code`; the mark is decorative (`aria-hidden="true"`) when the name is
already in the link.

## 8. Colour

| Token | Hex | Use |
|---|---|---|
| Paper | `#F7F5EF` | ground |
| Ink | `#12161C` | the mark, the wordmark, body |
| Signal | `#1F4FFF` | the tile, one action per screen |

The rule: **the mark is ink on paper and paper on ink; Signal never enters the mark.**
The accent belongs to the tile and to actions. Dark mode reuses the page tokens; the
mark follows `currentColor`.

## 9. Type

Two voices, one family each:

- **Voice** — system sans (`system-ui, -apple-system, "Segoe UI", Roboto, …`), 700 for
  the wordmark, 780 for the page headline.
- **Data** — `ui-monospace` for labels, kickers, code and version strings.

No third face. Emphasis is weight and space, never italics.

## 10. Rules

- Do not add a second eye, a nose, eyebrows or teeth.
- Do not colour the pupil. In the mark it is a cut; in the tile it is Paper, because the
  tile is an opaque ground.
- Do not place the disc in a circle or a badge frame; it is already the badge.
- Do not scale the mark below 16 px. Below 32 px the face fades to a dot and a dash —
  that is expected; the tile carries the icon.
- Do not outline, rotate, add a stroke or a shadow.
- Do not set the wordmark in another face or re-track it below `-0.03em`.

## 11. Considered and rejected

- **Monogram p** (first direction on this branch): clean, but no face and no motivation
  for the name; superseded.
- **Drop Cap + eye**: a slab-serif p whose counter becomes an eye; strong at large
  sizes, but the serifs vanish below 20 px and the face is only an eye.
- **Pilcrow**: the paragraph mark; literary, but reads as a flag or a microphone at
  lockup size.
- **Disc + Signal pupil**: the inlay; lost to the one-colour rule and to ≈3.1:1 on ink.
- **Brow, Wink, Smile · Open**: the face turns into a cartoon and the letter loses
  dominance.
- **Earlier geometric marks** (fan, brace, contours, hash, fingerprint, tag): stock
  glyphs; drawn and discarded in the exploration round.

## 12. Assets

| File | What it is |
|---|---|
| `mark.svg` | the mark, `currentColor`, 32 grid, one mask |
| `mark-tile.svg` | app icon / favicon: Signal tile, Paper glyph |
| `lockup.svg` | horizontal lockup (mark + wordmark) |
| `identity.svg` | construction sheet, sizes, tile, palette, type |
| `identity.png` | 1120 px render of the sheet |
| `lockup.png` | 600 px render on paper (2× the 300 px README size) |

`site/favicon.svg` is a copy of `mark-tile.svg`; `site/index.html` inlines `mark.svg`.

The geometry is repeated by necessity in the tile, the lockup, the inline mark and the
identity sheet — each asset is standalone. `mark.svg` is the source: change it first,
then propagate the same path and the same mask to the other surfaces.

## 13. Licensing

The code is MIT. The mark, the tile, the lockup and the wordmark are **not** covered by
that license: they are marks of Christian Luciani, all rights reserved. What is allowed
without asking (referring to the project, linking, unmodified editorial use) and what is
not (another product's logo, modified geometry, endorsement) is written in
[`../../TRADEMARK.md`](../../TRADEMARK.md); the local notice is in `LICENSE`.

## Change log

- **v1.0** — 2026-10-21 — Smile · Soft ratified; supersedes the monogram p.
