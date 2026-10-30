---
name: ghost-post
description: >
  Long-form post skill for Ghost. Says what a Ghost essay/newsletter issue is for
  and how the agent writes it; the machine contract is
  skills/ghost/longform.yaml (required/optional fields, editorial word band,
  export: paste). The judgment layer — shape, voice, GEO, i18n — lives in
  post.md. The agent writes N variants, the operator picks one, and the choice is
  recorded with `pasco post choose`; the deploy is a manual paste driven by the
  generated checklist.
model: juicio (mid-tier) — the argument and the opening are judgment; the
  mechanical parts (markdown, front matter, paste checklist) are not
applies_to: ghost
projection: agent-agnostic (any harness that reads Markdown and can run the CLI)
version: 0.1.0
status: draft (#361)
sources: skills/ghost/longform.yaml
---

# Ghost long-form — skill

## Mission

Turn one canonical seed into an essay worth a subscription: one argument, the
evidence that carries it, and an opening that earns the first scroll in an
inbox. Ghost is the surface the operator owns end to end (publication, domain,
archive), so the piece is written to be the citable copy — while every URL it
claims still comes from the identity SSOT.

## When it runs

`pasco post task <seed> --format longform --channel ghost` emits a task bundle
pointing at `longform.yaml` (contract) and this skill (judgment). Read the
contract for fields and band, then `post.md` for how to write. `pasco post` is
this channel's path: `pasco refine ghost` does resolve this file, but refine emits
a **profile** task that expects the profile-skill `checks.yaml`, which this
directory does not ship — it will not give you a post workflow.

## Flow

1. Read `longform.yaml` + `post.md`; the contract owns every limit.
2. Write N variants as YAML front matter + markdown body, at
   `posts/<seed>/ghost/ghost-<n>.md`.
3. The operator picks one; record it with `pasco post choose`.
4. `pasco post check` — fix the findings.
5. `pasco post export <seed>` → `paste-checklist.md` (no body API in v1).
6. Paste the body and each field into the publication editor, tick the checklist,
   and verify the live page before calling it published.

## Contract pointers (single source each)

| Question | Home |
|---|---|
| required / optional fields | `longform.yaml` `fields` |
| editorial word band | `longform.yaml` `limits.words` (not a platform cap) |
| api vs paste | `longform.yaml` `export: paste` (decision #266) |
| link policy | `longform.yaml` `links.policy` (`identity-ssot-only`) |
| dated platform sources | `longform.yaml` `sources[]` |
| how to write the piece | `post.md` |

## GEO and i18n

The publication's domain is the citable address; its archive is public, the email
copy is not. State the claim next to a heading so the section is extractable, and
keep every fact byte-identical to the profile. One publication, one language:
write `en` by default and treat a Spanish publication as a separate surface with
its own domain. The crawler stance is the repo's global `ai.policy`
(`platforms/registry.yaml`, v1, 2026-10-27).

## Verification

- `pasco post check` exit 0 (no `missing-field`, `word-count` or
  `url-not-in-ssot` errors).
- The pasted body kept its heading levels, code fences and links; nothing was
  flattened by the editor.
- Front matter fields arrived on the live page (title + dek where the theme
  renders it); canonical, if set, matches the SSOT.
- Report any contract gap as a finding — the engine is not extended from a
  skill (#361).
