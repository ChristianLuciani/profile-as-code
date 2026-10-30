---
name: wordpress-post
description: >
  Long-form post skill for WordPress. Says what a WordPress post is for and how
  the agent writes it; the machine contract is
  skills/wordpress/longform.yaml (required/optional fields, editorial word band,
  export: api). The dek→excerpt mapping is NOT declared by the contract: it is an
  open question [?], not a promise. The judgment layer — shape,
  voice, GEO, i18n — lives in post.md. The agent writes N variants, the operator
  picks one, and the choice is recorded with `pasco post choose`.
model: juicio (mid-tier) — what the page answers and how it is structured is
  judgment; the mechanical parts (markdown, front matter) are not
applies_to: wordpress
projection: agent-agnostic (any harness that reads Markdown and can run the CLI)
version: 0.1.0
status: draft (#361)
sources: skills/wordpress/longform.yaml
---

# WordPress long-form — skill

## Mission

Turn one canonical seed into a durable page on a site the operator owns: the
question answered first, the reasoning under it, the caveats at the end, and a
heading structure that a reader or an extractor can navigate. The skill is the
judgment layer (D5); the contract plus `pasco post check` are the deterministic
part.

## When it runs

`pasco post task <seed> --format longform --channel wordpress` emits a task
bundle pointing at `longform.yaml` (contract) and this skill (judgment). Read the
contract for fields and band, then `post.md` for how to write. `pasco post` is
this channel's path: `pasco refine wordpress` does resolve this file, but refine
emits a **profile** task that expects the profile-skill `checks.yaml`, which this
directory does not ship — it will not give you a post workflow.

## Flow

1. Read `longform.yaml` + `post.md`; the contract owns every limit.
2. Write N variants as YAML front matter + markdown body, at
   `posts/<seed>/wordpress/wordpress-<n>.md`.
3. The operator picks one; record it with `pasco post choose`.
4. `pasco post check` — fix the findings.
5. `pasco post export <seed> --target postiz` for the API draft payload.
6. Publish manually and verify the live page (title, dek, tags, canonical).

## Contract pointers (single source each)

| Question | Home |
|---|---|
| required / optional fields | `longform.yaml` `fields` |
| editorial word band | `longform.yaml` `limits.words` (not a platform cap) |
| api vs paste | `longform.yaml` `export` |
| link policy | `longform.yaml` `links.policy` (`identity-ssot-only`) |
| dated platform sources | `longform.yaml` `sources[]` |
| how to write the page | `post.md` |

## GEO and i18n

A page on the operator's own domain: public, indexed, stable — the most citable
surface of the set. The headings are the outline, the claim sits directly under
the heading that names it, and the dek is a field whose rendering the contract
leaves unmapped [?]. Write `en` by default; a
Spanish post belongs to the Spanish site with its own URL. The crawler stance is
the repo's global `ai.policy` (`platforms/registry.yaml`, v1, 2026-10-27).

## Verification

- `pasco post check` exit 0 (no `missing-field`, `word-count` or
  `url-not-in-ssot` errors).
- Heading hierarchy is structural (H2 → H3), not visual.
- The dek→excerpt mapping is unverified [?]: confirm on the first publish whether
  the theme's excerpt is the dek or a separate field.
- Facts byte-identical to the SSOT; every URL from the identity SSOT.
- Report any contract gap as a finding — the engine is not extended from a
  skill (#361).
