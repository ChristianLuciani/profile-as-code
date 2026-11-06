---
name: substack-profile
description: >
  Turns the SSOT facts into Substack's identity-bearing copy: the profile header
  (display name, bio, links) and the publication's textual identity (name, short
  description, About page body, canonical URL) as one paste sheet — the target
  artifact of `pasco build substack` (#483 ships the renderer, see `playbook.md`).
  Substack is a paste
  surface (D9) — no public body-write API — so that artifact is what gets pasted,
  and this skill is the judgment layer. The post
  flow is a different file: `post.md` + `longform.yaml`, driven by `pasco post`.
model: juicio (frontier) — the profile/publication copy is the judgment; the mechanical fields and the paste steps are not
applies_to: substack
projection: agent-agnostic (AionUi, OpenHands, Claude Code, Cursor, pi…)
version: 0.1.0
status: draft (#482)
sources: skills/substack/research/SOTA-2026.md
---

# Substack profile & publication — communication skill

## Mission

Turn the workspace's FACTS (SSOT) into the **two identity-bearing bodies**
Substack publishes under one slug — the **profile** (display name, bio, links) and
the **publication** (name, short description, About page) — as ONE paste sheet
(the target artifact; `pasco build substack` writes it, #483) that agrees with
every other surface.
Substack is a **paste** platform (D9): there is no public body-write API
(SOTA-2026 §5), so the target artifact is what gets pasted. This file is the judgment and narrative layer
(D4/D5); the post contract lives in `post.md` + `longform.yaml` and is operated
by `pasco post` — never write post copy from here.

## One slug, three products (SOTA-2026 §0)

Substack is not one surface but three: **profile** (social identity),
**publication** (site + newsletter) and **monetization** (subscriptions); a
fourth layer, **distribution** (Notes, Chat, DMs, recommendations), is where the
social graph lives and stays out of the identity body (D23). The engine's
renderer contract is one artifact per platform, so the target paste sheet
(#483) covers the **identity-bearing bodies** (profile + publication) and leaves
design, billing and analytics out (SOTA-2026 §8).

## Gold rule

> Facts are sacred (byte-identical to the SSOT); only the STORY varies.

- Names, dates, numbers, URLs: **identical** to `content/*.yaml`.
- URLs ONLY from `identity.links` and `newsletter.url` (drift rule). Never
  invent a link — the profile has its own links field; links do not go in the
  bio.
- Quantitative claims ONLY from `projects[].evidence` or `keywords.geo.claims`.
- The handle is `identity.handle` / `socialHandles[].handle`; the `@` the UI
  shows is a rule of this skill, not part of the stored fact (SOTA-2026 §1).
- A `newsletter.url` the SSOT does not carry yet is not invented: it is declared
  as a gap and the paste waits.

## Data source

```
content/identity.yaml      → name, handle, photo (pointer), email, links, definition, nationality
content/bios.yaml          → platform=substack: short = profile bio; long = About page body
content/newsletter.yaml    → name, url (canonical), description (short description), cadence
content/positioning.yaml   → statement + per-audience angles + GEO anchors
content/keywords.yaml      → seo.substack + geo.claims
content/faq.yaml           → the citable surface (definition + faq[]; also feeds the JSON-LD)
content/projects.yaml      → what is being published NOW, with verifiable evidence
```

`newsletter` and `podcast` are **flavor-neutral** blocks (SPEC §17, #481): a
`person` workspace may declare them. A missing `newsletter` is not an error of
this skill — it is a gap the paste reports, never fills.

## Strategy (3 questions)

1. **Who reads?** Two readers in one visit: the visitor who lands on the profile
   from another channel and is deciding whether subscribing is worth it, and the
   reader already on the welcome page/About deciding the same. The email of an
   issue is not written here: that is `post.md`.
2. **What should they do?** ONE action: subscribe. The publication is the CTA;
   the rest of the page does not compete with it.
3. **What is the strongest signal?** The work being published NOW: the declared
   cadence and the last thing delivered, with its evidence. A reader subscribes
   to what comes next, not to the archive.

Lead with #3 filtered by #1. The profile truncates the bio in practice (~26
words `[EXPERTO]`, no documented cap `[?]`, SOTA-2026 §1): what matters goes
first.

## Structure (two bodies, one voice)

1. **Profile — header.** Display name (`identity.name`), bio (the `short` row of
   `bios`; a `medium` row is promoted to Bio when neither `short` nor `long`
   exists, and to About when it pairs with a `short`), links (from
   `identity.links`), photo (pointer from `identity.photo`;
   the upload/crop is manual). The Posts tab shows the publication's posts unless
   the publication is in private mode (SOTA-2026 §1).
2. **Publication — name and one-liner.** Publication name (`newsletter.name`),
   short description (`newsletter.description`), hero text/tagline
   (`identity.tagline` is reusable as hero copy but not the same concept: the
   hero is publication UI copy, SOTA-2026 §7).
3. **Publication — About page.** What the publication is, who it is for, how
   often it appears (`newsletter.cadence`), what a subscriber receives, and the
   canonical URL (`newsletter.url`). It is a rich page: the text comes from
   `bios` `long`; testimonials, images, video, highlighted posts and offers are
   NOT SSOT facts and stay out (SOTA-2026 §8).
4. **One closing:** subscribe. The contact email (`identity.email`) is a fact and
   appears as such when it helps; the canonical URL goes in its own field.

What does NOT go in the profile or the About: theme/color/font/nav pickers
(design), plans/prices/founding tiers (billing), analytics, email sender name,
welcome emails, private mode and privacy toggles (account settings).
`playbook.md` lists them as manual steps; they are not identity and are not
rendered (SOTA-2026 §8).

## Limits (summary with source — SOTA-2026 §1, §2.1, §6)

- Profile bio: **no documented cap** `[?]`; truncated in practice after ~26 words
  `[EXPERTO]` — a curated soft cap in `checks.yaml` (180 chars), never a hard
  rule.
- Short description: **no documented cap** `[?]`; ~26 words is the editorial
  default `[EXPERTO]` — the same soft cap.
- Hero text / tagline: **no documented cap** `[?]`.
- About page: a rich composition, **no documented text cap** `[?]`; its shape
  (what / for whom / cadence / what you get) matters, not the character count.
- Post title: `<60` chars is a **recommendation** `[OFICIAL]`, not a cap — and it
  belongs to `post.md`, not this skill.
- Notes: **no documented cap** `[?]`; distribution, out of scope.

None of these values is a hard limit: if a workspace copies them into its
catalog, they stay curated (D12: facts warn, the schema fails).

## Variants (refine flow)

- Produce **N variants** (`--variants N`, default 3) of the SAME identity
  (profile + publication) with different angles:
  1. **Stewardship** (default): lead with what is being published now + the
     cadence.
  2. **Thesis**: lead with the idea the publication defends and why it matters.
  3. **Transparency**: lead with the contract with the reader (what they get, how
     often, what they will not get).
- Each variant: `variantId` = `substack-<lang>-<n>` (e.g. `substack-es-1`).
- The human picks; it is recorded with `pasco refine substack --choose <id>` →
  writes `content/active.yaml`. The later paste is marked with
  `pasco status --mark <ledgerKey> substack` (D18).
- `pasco refine substack` resolves THIS file: it is the profile command, not the
  post command. A post is written with `pasco post` (see `post.md`).

## Verification (checks)

- `pasco validate` exit 0 (schema + drift 0 + geo).
- `pasco check substack`: runs the `fact-present` premise `checks.yaml` declares
  (the built artifact against the SSOT render). Character caps come from the
  workspace catalog when it declares checks, or from the package defaults —
  **never** from this skill's rows (#455).
- Facts byte-identical: cross-check every profile and About fact against the YAML.
- Links: those in `identity.links` + `newsletter.url`; the bio carries no inline
  links.
- Language: the bio/description for the requested `--lang` exists; `compile` does
  no per-row fallback (an empty artifact is a visible gap, not silence).
- URL live: the profile and the publication resolve in a **browser** — the help
  center and public pages return 403 to plain fetchers and were read through a
  mirror in the research (SOTA-2026, Method and §5).

## GEO (consistency = citability)

- The profile and the About page are public and indexable; email is not. The
  citation unit is a section heading plus its claim, resolving to the
  publication's canonical URL (`newsletter.url`).
- Facts must agree byte for byte with CV/LinkedIn/GitHub/papers.
- The crawler stance is the repo's global `ai.policy`
  (`platforms/registry.yaml`), never a per-channel rule. Substack's AI training
  protection toggle is a playbook step (SOTA-2026 §2.1 `[OFICIAL]`), not an
  identity fact.
- One publication per language: `en` by default; a Spanish publication is a
  separate surface with its own archive and canonical URL.

## What this skill does not cover

- The **post** flow (issue/long-form): `post.md` + `longform.yaml`, operated by
  `pasco post`. That is the channel's other axis.
- The `substack` **renderer** itself (the code of the deterministic paste
  sheet): `packages/renderers/substack` (#483).
- Design, billing, analytics, rich About composition and account settings:
  `playbook.md` and SOTA-2026 §8 — manual steps, deliberately outside the
  contract.

## Facts vs narrative (the two axes)

Facts are unique; narrative is per surface. Read the rule and the pasco surfaces it
touches in [`../FACTS-VS-NARRATIVE.md`](../FACTS-VS-NARRATIVE.md) (SPEC §21.8) — one
home, never restated here.
