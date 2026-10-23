# `pasco post` — week-1 MVP

> Status: experiment (issue #264). Not a ratified product surface. The point of
> the week is to decide whether this is a tool for the operator, a commercial
> feature, or a service — not to grow the engine.

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
  seed.md                 # canonical text
  post.yaml               # per-channel chosen variant + publish state
  <channel>/
    task.md               # the agent task bundle (seed + facts + skill + rules)
    <variant>.md          # one text block per variant
  postiz.json             # optional Postiz payload (export)
```

`post.yaml` records two independent axes per channel:

- **sync**: `local-only` · `published` · `diverged` · `deleted-remote`
- **certification**: `verified` · `attested` · `unverifiable`

## Commands

```bash
# 1. Seed (from a file you wrote)
pasco post seed <seed-id> --text seed.md --workspace <profile-data>

# 2. Emit the agent task bundle(s) — no LLM call
pasco post task <seed-id> --channel linkedin,x --variants 3 --workspace <profile-data>
#    → posts/<seed-id>/<channel>/task.md

# 3. The agent writes posts/<seed-id>/<channel>/<channel>-<n>.md, then:
pasco post choose <seed-id> --channel linkedin --variant linkedin-1 \
  [--text <file>] --workspace <profile-data>

# 4. Check the chosen text
pasco post check <seed-id> --workspace <profile-data>
#    errors: max-chars · url-not-in-ssot · dangling-ref
#    warns:  hashtags · unsourced-claim

# 5. Build the Postiz payload (optional; you can also paste into Postiz)
pasco post export <seed-id> --target postiz --workspace <profile-data>
#    → posts/<seed-id>/postiz.json  (type: draft)

# Historical posts (the 20-post test)
pasco post import <dir> --channel linkedin --workspace <profile-data>

# Overview
pasco post list --workspace <profile-data>
```

`postiz.yaml` (workspace root) maps a channel to a Postiz integration id:

```yaml
channels:
  linkedin: <integration-id>
  x: <integration-id>
```

Without it, the payload uses `REPLACE_ME` and the export warns.

## The rules (week 1)

- **Two channels only**: `linkedin`, `x`. The enum has 49; the skills cover 2.
- **No scheduler, no OAuth, no LLM.** The agent writes; the CLI composes the
  task, records the choice, checks, and optionally emits the payload.
- **The seed is canonical; the post is a projection.** The check never edits
  the seed.
- **Facts are cited, not copied**: `{{fact:identity.name}}`,
  `{{fact:projects[<id>].name}}`, `{{fact:publications[<id>].doi}}`. The export
  renders them; a dangling pointer fails.
- **URLs only from the SSOT**: `identity.links`, `projects[].links`,
  `publications[].url`, `credentials[].verifyUrl`, `artifacts[].locator.url`.
- **Contradiction is not implemented yet.** `post check` catches dangling
  refs, URL drift, limits and unsourced numeric claims; a semantic
  contradiction (the post says a different year/role than the SSOT) is the next
  check, not a claim of this MVP.

## Known limits (MVP)

- Two channels, no threads, no scheduler/OAuth.
- Char limits use JavaScript `.length`, not the platform's weighted count
  (emoji/CJK may pass `check` and fail the platform).
- Re-choosing a variant after publishing keeps the old `publishedAt`/`url` but
  marks the channel `local-only`; **per-variant publish history is not modeled
  yet**. The ledger is per seed/channel, not per projection.
- `post.yaml` is one ledger per seed; concurrent `choose` on the same seed can
  race (single-operator MVP; no lock).
- `unsourced-claim` is a warning with false positives on dates/versions; it is
  a nudge, not a gate.

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
