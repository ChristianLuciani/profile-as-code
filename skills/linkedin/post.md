# LinkedIn post — skill (MVP)

> Week-1 post skill. The machine-readable limits live in `posting.yaml`; this file
> is the judgment layer the agent reads before writing. Sources are dated in
> `posting.yaml`; re-verify before making a hard claim.

## What a LinkedIn post is for

One idea, one reader, one reason to keep reading. The post is not a profile
summary: it is a claim or a story that earns the next line. Write for a specific
audience from `positioning.audiences`; do not write for "everyone".

## Shape

1. **Hook** — the first 1–2 lines carry the whole post. A concrete tension,
   observation or result; no throat-clearing ("En el mundo de…").
2. **Body** — 2–5 short paragraphs. One idea per paragraph. Concrete nouns,
   dates, numbers, links from the SSOT. Use `{{fact:...}}` for every fact.
3. **Close** — a question, an invitation or a next step. No rage-bait, no
   "comenta SÍ" engagement farming.

## Rules

- **Length:** 3,000 characters max (LinkedIn's current limit; see
  `posting.yaml` sources). Aim for 900–1,800 — the ceiling is not the target.
- **Links:** only from `identity.links`, `projects[].links`,
  `publications[].url`, `credentials[].verifyUrl` or `artifacts[].locator.url`.
  Do not invent or shorten a URL.
- **Hashtags:** 3–5 maximum, only if they are how the audience searches.
- **Facts:** never paraphrase a date, number, DOI or URL. Cite with
  `{{fact:<pointer>}}`; the engine renders it and fails on a dangling pointer.
- **Voice:** first person, direct, no hype. Match `brandVoice` (tone, values,
  avoid); the post should sound like the person, not like a content template.

## Anti-patterns

- A hook that could belong to any post in the niche.
- A list of achievements without a claim.
- "I'm humbled to announce" / "Excited to share" openings.
- A link dump; a post is not a newsletter.
- Hashtag stuffing.

## Output contract

Save one text block per variant at `posts/<seed>/linkedin/linkedin-<n>.md`, then
record it:

```
pasco post choose <seed> --channel linkedin --variant linkedin-1
```
