# `pasco post` — week-1 MVP + the long-form shape

> Status: experiment (issues #264/#265, long-form #266). Not a ratified product
> surface. The point of the week is to decide whether this is a tool for the
> operator, a commercial feature, or a service — not to grow the engine.

A post is a **projection of a seed**, not an identity fact. The store lives in
the user's workspace at `posts/` — **the stream**, beside `content/` (identity) and
`profiles/` (generated output), outside `profile.schema.json`. The three top-level
directories are three grains and never nest (#267): no `content/posts` (mixes the
stream into the identity root and forces `load()` to ignore a subtree), no
`content/identities` (plural, and it contradicts D15: one workspace per identity),
no `content/profiles` (collides with the generated output directory), and no
`posts/content` (the stream never owns the SSOT):

```
posts/<seed-id>/
  seed.md                 # canonical text (a DERIVED seed has none)
  post.yaml               # format + derivedFrom + per-channel choice + publish state
  <channel>/
    task.md               # the agent task bundle (seed + facts + skill + rules)
    <variant>.md          # short: one text block; longform: front matter + body
    paste-checklist.md    # long-form paste channels only (export)
  postiz.json             # optional Postiz payload (export; API channels only)
```

`post.yaml` records two independent axes per channel:

- **sync**: `local-only` · `published` · `diverged` · `deleted-remote`
- **certification**: `verified` · `attested` · `unverifiable`

## Two seed formats (#266)

The format is a property of the **seed**, not of the channel:

- **`format: short`** — the distribution post. Rules live in
  `skills/<channel>/posting.yaml` (char limits, hashtags). This is the week-1
  shape and the default when `post.yaml` omits `format`.
- **`format: longform`** — the essay/newsletter, the canonical seed for a
  writer. Rules live in `skills/<channel>/longform.yaml`; the field contract is
  the variant's **YAML front matter**.

Both shapes ship the judgment layer the task bundle points at: `post.md` beside
the rule file (the short channels since #266, the seven long-form channels since
#361). The long-form channels add a `SKILL.md` that the bundle does not carry: it
is a strategy reference, not an input to `post task`. Adding it does change
`pasco refine <channel>` — refine finds a skill where it used to find none, and
emits a **profile** task that saves to `profiles/<channel>/variants/<id>.md`, so
do not use refine on a post channel; the post path is `pasco post`, and the rule
file remains the only machine contract. (`checks.yaml` is not part of this:
`pasco check` reads it and reports "no catalog" without failing when it is
absent.)

The **short family** is derived from the essay: `post task <child> --format
short --from <essay> --channel linkedin,x` creates a child seed whose
`post.yaml` carries `derivedFrom: <essay>`, with **no `seed.md` of its own** (the
essay is canonical; `post.yaml.seed` points at `../<essay>/seed.md`, and
`seedText()` follows `derivedFrom` to read the essay's text). One essay
can spawn as many short children as it has channels/angles; all of them link
back by `derivedFrom`. The essay itself derives from nothing.

Long-form variant files are front matter + markdown body (the body is what the
platform receives; the fields are the platform's own fields):

```markdown
---
title: Repeatable work
dek: What compounds, and why most of it is invisible
tags: [craft, work]
canonical: https://elenavasquez.substack.com
---
The body in markdown…
```

`skills/<channel>/longform.yaml` declares the rules:

| Key | Meaning |
|---|---|
| `format: longform` | self-declares the file's shape (a `posting.yaml` must not) |
| `export: api \| paste` | API channel (Postiz settings mapping) vs paste surface (checklist, no body API) |
| `fields.required` | must include `title` and `dek`; a missing one fails `check` |
| `fields.optional` | `preview`, `tags`, `canonical`, `publication`, `list` (images are **not** a v0 field — D17 `artifacts[].locator` owns pointers) |
| `limits.words` | editorial band (`min`/`max`), enforced by `check` |
| `structure` · `sources` | judgment + evidence, same shape as `posting.yaml` |

v1 channels: `substack`, `ghost` (paste) · `medium`, `devto`, `hashnode`,
`wordpress`, `listmonk` (API). Ghost's Admin API exists but v1 keeps it a paste
surface, like Substack (#266). Images are out of scope in v0. `check` reports a
front-matter field the channel does not declare (`unknown-field`, warn) instead
of letting the export drop it silently; `title`, `tags`, `canonical`,
`publication` and `list` are the fields an API channel maps into its Postiz
settings.

## Commands

```bash
# 1. Seed (from a file you wrote)
pasco post seed <seed-id> --text seed.md [--format short|longform] \
  --workspace <profile-data>

# 2. Emit the agent task bundle(s) — no LLM call
pasco post task <seed-id> --channel linkedin,x --variants 3 --workspace <profile-data>
#    → posts/<seed-id>/<channel>/task.md

#    Long-form projection of the essay (title/dek/word rules)
pasco post task <essay-id> --format longform --channel medium,substack \
  --workspace <profile-data>

#    The short family derived from the essay (one child seed per angle/channel)
pasco post task <child-id> --format short --from <essay-id> --channel linkedin,x \
  --workspace <profile-data>
#    → posts/<child-id>/post.yaml carries derivedFrom: <essay-id>; no seed.md

# 3. The agent writes posts/<seed-id>/<channel>/<channel>-<n>.md, then:
pasco post choose <seed-id> --channel linkedin --variant linkedin-1 \
  [--text <file>] --workspace <profile-data>
#    short: one text block. longform: YAML front matter (title/dek/tags/canonical)
#    + the markdown body.

# 4. Check the chosen text
pasco post check <seed-id> --workspace <profile-data>
#    short:    errors max-chars · url-not-in-ssot · dangling-ref
#              warns  hashtags · unsourced-claim
#    longform: errors missing-field (title/dek) · word-count · url-not-in-ssot
#              (canonical included) · dangling-ref · front-matter
#              warns  unsourced-claim · unknown-field (not exported)
#    both:     derivedFrom must resolve to a long-form parent (dangling-derived-from)

# 5. Build the Postiz payload / paste checklist (optional)
pasco post export <seed-id> --target postiz --workspace <profile-data>
#    API channels    → posts/<seed-id>/postiz.json  (type: draft; long-form
#                      fields land in settings: title/tags/canonical/list)
#    paste channels  → posts/<seed-id>/<channel>/paste-checklist.md
#                      (substack, ghost: no body API — body + fields, pasted)

# Historical posts (the 20-post test)
pasco post import <dir> --channel linkedin --workspace <profile-data>

# Overview (format + derivedFrom + chosen variants)
pasco post list --workspace <profile-data>
```

`postiz.yaml` (workspace root) maps a channel to a Postiz integration id:

```yaml
channels:
  linkedin: <integration-id>
  x: <integration-id>
```

Without it, the payload uses `REPLACE_ME` and the export warns.

## The rules

- **Short channels**: `linkedin`, `x` (`posting.yaml`). **Long-form channels**:
  `substack`, `ghost`, `medium`, `devto`, `hashnode`, `wordpress`, `listmonk`
  (`longform.yaml`). The enum has 49; a channel with no rule file is a usage
  error, never a silent pass.
- **No scheduler, no OAuth, no LLM.** The agent writes; the CLI composes the
  task, records the choice, checks, and optionally emits the payload/checklist.
- **The seed is canonical; the post is a projection.** The check never edits
  the seed. A derived short seed has no `seed.md`: the essay owns the text.
- **Facts are cited, not copied**: `{{fact:identity.name}}`,
  `{{fact:projects[<id>].name}}`, `{{fact:publications[<id>].doi}}`. The export
  renders them; a dangling pointer fails.
- **URLs only from the SSOT**: `identity.links`, `projects[].links`,
  `publications[].url`, `credentials[].verifyUrl`, `artifacts[].locator.url`
  (long-form `canonical` included).
- **Images are not a v0 field** (#266): when a channel requires one, the pointer
  is `artifacts[].locator` (D17), never a new post-local media field.
- **Contradiction is not implemented yet.** `post check` catches dangling
  refs, URL drift, limits, missing long-form fields and unsourced numeric
  claims; a semantic contradiction (the post says a different year/role than the
  SSOT) is the next check, not a claim of this MVP.

## Known limits (MVP)

- Short: two channels, no threads. Long-form: seven channels, one projection per
  channel/variant, no threads or series.
- Char limits use JavaScript `.length`, not the platform's weighted count
  (emoji/CJK may pass `check` and fail the platform). Word counts are whitespace
  tokens, and the band is an editorial default from the skill, not a platform cap.
- Long-form `check` validates front matter and body, not section structure
  (`structure` is judgment in the task bundle).
- Re-choosing a variant after publishing keeps the old `publishedAt`/`url` but
  marks the channel `local-only`; **per-variant publish history is not modeled
  yet**. The ledger is per seed/channel, not per projection.
- `post.yaml` is one ledger per seed; concurrent `choose` on the same seed can
  race (single-operator MVP; no lock).
- `unsourced-claim` is a warning with false positives on dates/versions; it is
  a nudge, not a gate.
- The paste checklist is a file, not a deploy: no OAuth, no auto-publish.

## Week-1 protocol (the evaluation)

1. Import 20 historical posts (`post import`) and create 5 new seeds.
2. For each seed, run `post task` for `linkedin` and `x`; write 3 variants with
   the agent; choose one; `post check`; paste the chosen text into Postiz.
3. Log, per post: import time, time from seed to published, number of edits,
   whether you used the task bundle or free-handed it.
4. At day 7, score:
   - **Voice**: does the chosen text sound like you? (self + 2 readers, 1–5)
   - **Return**: did you go back to the vault to find something? How many times?
   - **Willingness to pay**: would you pay for this as a service? At what price?
5. Decide one of:
   - **tool for me** — keep it as a private workflow, no product;
   - **commercial feature** — a paid add-on to the profile product;
   - **service** — a community-manager-style offer for agencies/clients.

The experiment fails if, after a week, you do not return to the vault and the
text is not better than a naked LLM with the profile pasted in. In that case the
archive is a folder, not a product; say so and stop.
