---
name: devto-post
description: >
  Long-form post skill for DEV (Forem). Says what a DEV article is for and how
  the agent writes one; the machine contract is skills/devto/longform.yaml
  (required/optional fields, editorial word band, export: api). The judgment
  layer — shape, voice, GEO, i18n — lives in post.md. The agent writes N
  variants, the operator picks one, and the choice is recorded with
  `pasco post choose`.
model: juicio (mid-tier) — choosing the technical claim and its trade-off is
  judgment; the mechanical parts (markdown, front matter) are not
applies_to: devto
projection: agent-agnostic (any harness that reads Markdown and can run the CLI)
version: 0.1.0
status: draft (#361)
sources: skills/devto/longform.yaml
---

# DEV (Forem) long-form — skill

## Mission

Turn one canonical seed into a DEV article that a developer can act on: one
claim, the smallest example that proves it, and the caveat that keeps it honest.
The skill is the judgment layer (D5); the deterministic part is the contract plus
`pasco post check`.

## When it runs

`pasco post task <seed> --format longform --channel devto` emits a task bundle
that points at two files: `longform.yaml` (contract) and this skill (judgment).
Read the contract for the fields and the band, then `post.md` for how to write.
`pasco post` is this channel's path: `pasco refine devto` does resolve this file,
but refine emits a **profile** task that expects the profile-skill `checks.yaml`,
which this directory does not ship — it will not give you a post workflow.

## Flow

1. Read `longform.yaml` + `post.md`. Do not re-derive the limits: the contract
   owns them.
2. Write N variants as YAML front matter + markdown body, at
   `posts/<seed>/devto/devto-<n>.md`.
3. The operator picks one; record it with `pasco post choose`.
4. `pasco post check` — fix what it reports instead of explaining it away.
5. `pasco post export <seed> --target postiz` for the API draft payload.
6. Publish manually, then verify on the live page that the front matter landed.

## Contract pointers (single source each)

| Question | Home |
|---|---|
| required / optional fields | `longform.yaml` `fields` |
| editorial word band | `longform.yaml` `limits.words` (not a platform cap) |
| api vs paste | `longform.yaml` `export` |
| link policy | `longform.yaml` `links.policy` (`identity-ssot-only`) |
| dated platform sources | `longform.yaml` `sources[]` |
| how to write the piece | `post.md` |

## GEO and i18n

Public, indexed article page: the citation unit is the code block plus the
sentence that states what it proves. Write `en` by default; a Spanish piece is a
separate seed for that audience, never a duplicate of the English one. The
crawler stance is the repo's global `ai.policy` (`platforms/registry.yaml`, v1,
2026-10-27) — no per-channel rule is invented here.

## Verification

- `pasco post check` exit 0 (no `missing-field`, `word-count` or
  `url-not-in-ssot` errors).
- Facts byte-identical to the SSOT; every URL from the identity SSOT.
- On the live page: title, tags and canonical URL arrived; the dek shows up as
  the subtitle the channel renders, or not at all — never as a repeat of the
  body's first line.
- Report any contract gap as a finding — the engine is not extended from a
  skill (#361).
