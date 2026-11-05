---
name: linkedin-post
description: >
  Channel skill for LinkedIn. Says what a post on the channel is for and how the
  agent writes it; the machine contract is
  `skills/linkedin/posting.yaml` (char limit, hashtag cap, link policy) and the judgment layer is split:
  `post.md` owns the shape and the voice, this file's own GEO/i18n section
  owns that policy. Audience and angle are THIS channel's, deliberately
  different from the GitHub profile README's. The agent writes N variants,
  the operator picks one, and the choice is recorded with `pasco post choose`.
model: juicio (frontier) — the angle and the claim are judgment; the character
  count is not
applies_to: linkedin
projection: agent-agnostic (any harness that reads Markdown and can run the CLI)
version: 0.1.0
status: draft (#462)
sources: skills/linkedin/posting.yaml
---

# LinkedIn — channel skill

## Mission

Turn one canonical seed into a post that earns the next line for a
**professional reader**: a peer, a hiring manager, a collaborator. The post is a
claim or a story, not a profile summary. The skill is the judgment layer (D5); the
contract plus `pasco post check <seed>` are the deterministic part.

## Who reads it, and what changes

LinkedIn's reader already knows the professional context — the résumé, the titles,
the stack. What this channel adds is **judgment and stakes**: what you decided and
why, what it cost, what you would tell a peer who faces the same call. First
person, direct, no hype; one idea per post.

That is the axis where this skill **must differ** from `github-readme`: the README
answers "who is this person and what do they maintain" for a reader evaluating the
work in a repository; a LinkedIn post answers "what do I think about the work" for
a reader evaluating the person. The facts are identical (same dates, same numbers,
same URLs from the SSOT) — the angle is not, and copying one channel's text into
the other is the failure this skill exists to prevent (SPEC §21.8).

## When it runs

`pasco post task <seed> --format short --channel linkedin` emits a task bundle
that points at `posting.yaml` and the judgment file `post.md`; it does **not**
carry this `SKILL.md`. This file is the channel's strategy reference for whoever
opens it directly: read the contract for the limits, then `post.md` for how to
write.

Do **not** run `pasco refine linkedin` for this channel. `refine` is the PROFILE
command: with a `SKILL.md` present it resolves this file and emits a profile task
("write N variants of the linkedin profile") that saves to
`profiles/linkedin/variants/<id>.md` — not a post workflow. The post path is
`pasco post`.

## Flow

1. Read `posting.yaml` + `post.md`; the contract owns every limit.
2. Write N variants at `posts/<seed>/linkedin/linkedin-<n>.md`.
3. The operator picks one; record it with `pasco post choose`.
4. `pasco post check <seed>` — fix the findings.
5. Publish manually and verify the live post.

## Contract pointers (single source each)

| Question | Home |
|---|---|
| character limit | `posting.yaml` `limits.maxChars` |
| hashtag cap | `posting.yaml` `hashtags.max` |
| link policy | `posting.yaml` `links.policy` (`identity-ssot-only`) |
| shape (hook · body · close) | `posting.yaml` `structure` |
| dated platform sources | `posting.yaml` `sources[]` |
| how to write the piece, voice, anti-patterns | `post.md` |

The numbers are **not** restated here: a second copy drifts from the source the
command actually reads.

## GEO and i18n

LinkedIn is an indexed professional page and an LLM's favourite triangulation
surface: the facts in the post must match the SSOT byte for byte, because a model
that finds two versions of one date discounts the person. Write `en` by default; a
Spanish post is a separate seed for that audience, never a translation sharing a
canonical. The crawler stance is the repo's global `ai.policy`
(`platforms/registry.yaml`).

## Verification

- `pasco post check <seed>` exit 0; the findings it prints are the gate.
- Facts byte-identical to the SSOT — no rounded date, number or DOI.
- Links ⊆ the SSOT link sources; no invented or shortened URL.
- The post does not restate another channel's profile text.

## Facts vs narrative (the two axes)

Facts are unique; narrative is per surface. Read the rule and the pasco surfaces it
touches in [`../FACTS-VS-NARRATIVE.md`](../FACTS-VS-NARRATIVE.md) (SPEC §21.8) — one
home, never restated here.
