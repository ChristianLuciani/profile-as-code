# profile-as-code — identity

The mark, the lockup, and the two type voices. This is the source of truth for the
project page and the favicon.

**Covers:** the mark (SVG), the horizontal lockup, the favicon tile, colour and type
usage. **Does not cover:** social cards, the npm/README banner, or the CLI's terminal
output. `as_of: 2026-10-20`.

## Direction — “Loop & Line”

One closed loop resting on one straight line. No frame, no badge, no illustration:
the mark is a single filled path, and everything it means is carried by proportion and
counter-space. The loop is a human shape — a cycle, a person, a profile that is
maintained rather than finished. The line is the code it is written on. They meet
without a seam, because the claim of the product is that the profile and its source are
the same artefact seen at two resolutions.

Colour is ink on paper, with a single electric signal. There are no gradients, no
shadows, no second accent: the blue appears once per surface, on the mark or on one
action, never both. A brand that promises one source of truth cannot afford a palette
that says two.

The drawing lives on a 32-unit grid and is specified in units, not pixels, so it holds
from 16 px to a 320 px construction sheet. Weight is constant: the counter is wide
enough to survive as a dot at favicon size, and the stem keeps a stable spine when the
loop is scaled down. Nothing is nudged by eye after the fact; every node sits on a half
unit and the arcs are tangent by construction.

The composition is deliberately asymmetric: mass sits in the loop, the descender gives
the mark a foot, and the wordmark carries the width. The mark never competes with the
name — it is smaller, quieter, and separated by one constant gap. Clear space is
generous because the form is simple; crowding it would make it look accidental.

This is the part that has to look laboured over even though it is reduced: the join
between bowl and stem has no visible step, the counter is a true circle rather than an
optical oval, and the lockup is set once, at one weight, at one tracking. The reference
is structural, not pictorial: the p is the first letter of *profile* and of `pasco`; the
loop is the profile, the line is the code, and because both are one path, there is one
source. Someone who uses the CLI should feel it; someone who does not should simply see
a confident mark.

## The mark

| Property | Value |
|---|---|
| Artboard | 32 × 32 units |
| Path | one path, `fill-rule="evenodd"` |
| Stem | 5 units wide, `x 7 → 12`, `y 5 → 28`, full-radius foot |
| Bowl | circle Ø 17 (r 8.5) at `(17.5, 11.5)` |
| Counter | circle Ø 8.6 (r 4.3), same centre |
| Stroke | 4.2 units at the bowl, 5 at the stem |
| Bounding box | 19 × 25 units (`x 7 → 26`, `y 3 → 28`) |
| Minimum size | 16 px (the counter still reads as a dot) |
| Clear space | ≥ 4 units on every side |

The mark is an SVG source, never a PNG. It inherits `currentColor`, so it takes the
accent in the header and paper/ink wherever it is placed.

## The lockup

Mark 28 px, wordmark 19 px, gap 6 px, optically baseline-aligned — see
`lockup.svg`. In HTML the wordmark is live text, not outlines: it keeps the page
selectable, searchable and translatable. The accessible name is always
`profile-as-code`; the mark itself is decorative (`aria-hidden="true"`) when the name is
already in the link.

## Colour

| Token | Hex | Use |
|---|---|---|
| Paper | `#F7F5EF` | page ground, glyph on the tile |
| Ink | `#12161C` | mark, wordmark, body |
| Signal | `#1F4FFF` | mark in the header, tile ground, one action per screen |

Dark mode reuses the same three roles with the page tokens already defined in
`site/styles.css`: the mark takes `--accent` (`#8AB0FF`), the tile keeps Signal.

## Type

Two voices, one family each:

- **Voice** — system sans (`system-ui, -apple-system, "Segoe UI", Roboto, …`), 700 for
  the wordmark, 780 for the page headline. This is the human register.
- **Data** — `ui-monospace` for labels, kickers, code and version strings. This is the
  machine register.

No third face. No italics for emphasis in the identity; emphasis is weight and space.

## Rules

- Do not outline the mark, add a stroke, rotate it, or place it in a circle or a badge.
- Do not recolour the tile; it is Signal with a Paper glyph, full stop.
- Do not set the wordmark in another face or re-track it below `-0.03em`.
- Do not place the monochrome mark on a mid-tone without checking contrast; it is
  designed for paper or ink.
- Do not scale the mark below 16 px; use the tile instead.

## Considered and rejected

- **Three lines in a rounded box** (the previous mark): reads as a list or a form field,
  and the box does the work instead of the idea.
- **Fan of lines from a dot**: the “share” glyph, already everywhere.
- **Brace beside stacked lines**: correctly says “text becomes code”, but at 28 px it
  reads as an indent control, not as an identity.

## Assets

| File | What it is |
|---|---|
| `mark.svg` | the mark, `currentColor`, 32 grid |
| `mark-tile.svg` | app icon / favicon, Signal tile + Paper glyph |
| `lockup.svg` | horizontal lockup (mark + wordmark) |
| `identity.svg` | construction sheet + sizes + palette + type |
| `identity.png` | 1120 px render of the sheet for quick review |

`site/favicon.svg` is a copy of `mark-tile.svg`; `site/index.html` inlines `mark.svg`.
