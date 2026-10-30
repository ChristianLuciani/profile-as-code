---
name: medium-post
description: >
  Long-form post skill for Medium. Says what a Medium essay is for and how the
  agent writes it; the machine contract is
  skills/medium/longform.yaml (required/optional fields, editorial word band,
  export: api). The judgment layer — shape, voice, GEO, i18n — lives in post.md.
  The agent writes N variants, the operator picks one, and the choice is recorded
  with `pasco post choose`. The contract's api export is mapped, not guaranteed:
  verify API access before relying on it.
model: juicio (frontier) — the position and its stakes are judgment; the
  mechanical parts (markdown, front matter) are not
applies_to: medium
projection: agent-agnostic (any harness that reads Markdown and can run the CLI)
version: 0.1.0
status: draft (#361)
sources: skills/medium/longform.yaml
---

# Medium long-form — skill

## Mission

Turn one canonical seed into an essay that argues a position a professional
audience can disagree with: the situation, the tension, what was done, what it
cost. The skill is the judgment layer (D5); the contract plus `pasco post check`
are the deterministic part.

## When it runs

`pasco post task <seed> --format longform --channel medium` emits a task bundle
that points at the contract (`longform.yaml`) and the judgment file (`post.md`);
it does **not** carry this `SKILL.md`. This file is the channel's strategy
reference for whoever opens it directly: read the contract for the fields and the
band, then `post.md` for how to write.

Do **not** run `pasco refine medium` for this channel. Refine is the profile
command: with a `SKILL.md` now present it resolves this file instead of answering
"no skill for medium yet", and emits a **profile** task ("write N variants of the
medium profile") that saves to `profiles/medium/variants/<id>.md` — not a post
workflow. Telling a profile skill from a post skill is an engine decision, not
something this skill can fix.

## Flow

1. Read `longform.yaml` + `post.md`; the contract owns every limit.
2. Write N variants as YAML front matter + markdown body, at
   `posts/<seed>/medium/medium-<n>.md`.
3. The operator picks one; record it with `pasco post choose`.
4. `pasco post check` — fix the findings.
5. `pasco post export <seed> --target postiz` for the API draft payload.
6. Publish manually and verify the live page (title, tags, canonical).

## Contract pointers (single source each)

| Question | Home |
|---|---|
| required / optional fields | `longform.yaml` `fields` |
| editorial word band | `longform.yaml` `limits.words` (not a platform cap) |
| api vs paste | `longform.yaml` `export` |
| link policy | `longform.yaml` `links.policy` (`identity-ssot-only`) |
| dated platform sources | `longform.yaml` `sources[]` |
| how to write the piece | `post.md` |

## Open precondition

The contract maps `export: api` onto the Medium posting API, but whether an
operator can still obtain write access is not stated by the contract's source:
treat it as unverified [?] and check before promising an API publish.

## GEO and i18n

Public, indexed essay pages; tags are browsing paths, not search intent; the
citation unit is the stated position plus the evidence under it. Write `en` by
default; a Spanish essay is a separate seed for that audience, never a translation
sharing a canonical. The crawler stance is the repo's global `ai.policy`
(`platforms/registry.yaml`, v1, 2026-10-27).

## Verification

- `pasco post check` exit 0 (no `missing-field`, `word-count` or
  `url-not-in-ssot` errors).
- The title is arguable; the dek states the stake.
- Facts byte-identical to the SSOT; canonical (when set) points at the SSOT home.
- Report any contract gap as a finding — the engine is not extended from a
  skill (#361).
