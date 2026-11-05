---
name: x-post
description: >
  Channel skill for X. Says what an X post is for and how the agent writes it;
  the machine contract is skills/x/posting.yaml (char limit, hashtag cap, link
  policy, reply settings) and the judgment layer — shape, voice, GEO, i18n — is
  post.md. Audience and angle are THIS channel's, deliberately different from the
  LinkedIn and GitHub README ones. The agent writes N variants, the operator picks
  one, and the choice is recorded with `pasco post choose`.
model: juicio (frontier) — the single sharp claim is judgment; fitting the
  channel's limit is not
applies_to: x
projection: agent-agnostic (any harness that reads Markdown and can run the CLI)
version: 0.1.0
status: draft (#462)
sources: skills/x/posting.yaml
---

# X — channel skill

## Mission

One sharp claim, observation or link. X rewards the first line and punishes
context-free threads; the post is a projection of the seed, not a summary of the
profile. The skill is the judgment layer (D5); the contract plus
`pasco post check` are the deterministic part.

## Who reads it, and what changes

X's reader scrolls past everything that does not earn attention in one line. What
this channel adds is **compression and reach**: the single most surprising or
useful consequence of the work, stated so a stranger can repeat it. One idea; if
it does not fit, the seed is a thread, and the MVP writes single posts — cut, do
not sprawl.

That is the axis where this skill **must differ** from `linkedin` and from
`github-readme`: the same fact, compressed to its sharpest edge for a reader who
owes the post no context. The facts are identical (same dates, same numbers, same
URLs from the SSOT) — the angle and the length are not, and copying another
channel's text here is the failure this skill exists to prevent (SPEC §21.8).

## When it runs

`pasco post task <seed> --format short --channel x` emits a task bundle that
points at `posting.yaml` and the judgment file `post.md`; it does **not** carry
this `SKILL.md`. This file is the channel's strategy reference for whoever opens
it directly: read the contract for the limits, then `post.md` for how to write.

Do **not** run `pasco refine x` for this channel. `refine` is the PROFILE
command: with a `SKILL.md` present it resolves this file and emits a profile task
("write N variants of the x profile") that saves to `profiles/x/variants/<id>.md`
— not a post workflow. The post path is `pasco post`.

## Flow

1. Read `posting.yaml` + `post.md`; the contract owns every limit.
2. Write N variants at `posts/<seed>/x/x-<n>.md`.
3. The operator picks one; record it with `pasco post choose`.
4. `pasco post check` — fix the findings.
5. Publish manually and verify the live post.

## Contract pointers (single source each)

| Question | Home |
|---|---|
| character limit (and its account-tier caveat) | `posting.yaml` `limits.maxChars` + `sources[]` |
| hashtag cap | `posting.yaml` `hashtags.max` |
| link policy | `posting.yaml` `links.policy` (`identity-ssot-only`) |
| reply settings | `posting.yaml` `settings.who_can_reply_post` |
| shape (hook · body · close) | `posting.yaml` `structure` |
| how to write the piece, voice, anti-patterns | `post.md` |

The numbers are **not** restated here: a second copy drifts from the source the
command actually reads.

## GEO and i18n

X posts are quoted and summarised by other agents more often than they are read on
x.com: the fact in the post must match the SSOT byte for byte, because a model
that finds two versions of one number discounts the person. Write `en` by default;
a Spanish post is a separate seed for that audience, never a translation sharing a
canonical. The crawler stance is the repo's global `ai.policy`
(`platforms/registry.yaml`).

## Verification

- `pasco post check` exit 0; the findings it prints are the gate.
- Facts byte-identical to the SSOT — no rounded date, number or DOI.
- Links ⊆ the SSOT link sources; the URL you write is the canonical one.
- The post does not restate another channel's profile text.

## Facts vs narrative (the two axes)

Facts are unique; narrative is per surface. Read the rule and the pasco surfaces it
touches in [`../FACTS-VS-NARRATIVE.md`](../FACTS-VS-NARRATIVE.md) (SPEC §21.8) — one
home, never restated here.
