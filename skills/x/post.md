# X post — skill (MVP)

> Week-1 post skill. The machine-readable limits live in `posting.yaml`; this file
> is the judgment layer the agent reads before writing. Sources are dated in
> `posting.yaml`; re-verify before making a hard claim.

## What an X post is for

One sharp claim, observation or link. X rewards the first line and punishes
context-free threads. The post is a projection of the seed, not a summary of the
profile.

## Shape

1. **Hook** — one line, concrete, no "🧵" unless the thread is real.
2. **Body** — 1–2 short lines. One idea. If it does not fit, the seed is a
   thread, not a post; the MVP writes single posts, so cut.
3. **Close** — optional link or question; do not bait replies.

## Rules

- **Length:** 280 characters for standard accounts (see `posting.yaml` sources;
  verified/premium accounts have a different ceiling — do not assume).
- **Links:** only from the SSOT. X may shorten visually; the URL you write must
  be the canonical one.
- **Hashtags:** 0–3, only if they are how the audience searches. No stuffing.
- **Mentions:** only handles that are real and relevant; do not invent or
  mass-mention.
- **Facts:** cite with `{{fact:<pointer>}}`; never invent a number, date or URL.
- **Voice:** first person, direct, no hype. Match `brandVoice`; the post should
  sound like the person, not like a growth account.

## Anti-patterns

- "A thread 🧵" on a single post.
- Engagement bait ("like if you agree").
- A link with no claim.
- Hashtag stuffing; emoji spam.

## Output contract

Save one text block per variant at `posts/<seed>/x/x-<n>.md`, then record it:

```
pasco post choose <seed> --channel x --variant x-1
```
