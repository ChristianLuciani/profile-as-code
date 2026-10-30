---
name: hashnode-post
description: >
  Long-form post skill for Hashnode. Says what a Hashnode article is for and how
  the agent writes it; the machine contract is
  skills/hashnode/longform.yaml (required/optional fields, editorial word band,
  export: api). The judgment layer — shape, voice, GEO, i18n — lives in post.md.
  The agent writes N variants, the operator picks one, and the choice is recorded
  with `pasco post choose`.
model: juicio (frontier) — the technical claim and its example are judgment; the
  mechanical parts (markdown, front matter) are not
applies_to: hashnode
projection: agent-agnostic (any harness that reads Markdown and can run the CLI)
version: 0.1.0
status: draft (#361)
sources: skills/hashnode/longform.yaml
---

# Hashnode long-form — skill

## Mission

Turn one canonical seed into a Hashnode article a developer can build from: the
problem, a runnable example, the reasoning, the caveats. The skill is the
judgment layer (D5); the contract plus `pasco post check` are the deterministic
part.

## When it runs

`pasco post task <seed> --format longform --channel hashnode` emits a task bundle
that points at the contract (`longform.yaml`) and the judgment file (`post.md`);
it does **not** carry this `SKILL.md`. This file is the channel's strategy
reference for whoever opens it directly: read the contract for the fields and the
band, then `post.md` for how to write.

Do **not** run `pasco refine hashnode` for this channel. Refine is the profile
command: with a `SKILL.md` now present it resolves this file instead of answering
"no skill for hashnode yet", and emits a **profile** task ("write N variants of
the hashnode profile") that saves to `profiles/hashnode/variants/<id>.md` — not a
post workflow. Telling a profile skill from a post skill is an engine decision,
not something this skill can fix.

## Flow

1. Read `longform.yaml` + `post.md`; do not re-derive the limits.
2. Write N variants as YAML front matter + markdown body, at
   `posts/<seed>/hashnode/hashnode-<n>.md`.
3. The operator picks one; record it with `pasco post choose`.
4. `pasco post check` — fix the findings.
5. `pasco post export <seed> --target postiz` for the API draft payload.
6. Publish manually, then verify the live page (title, tags, canonical).

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

Public, indexed article page; tags are the arrival paths; the citation unit is
the snippet plus the claim it proves. Write `en` by default, and treat a Spanish
article as a separate seed for that audience — never a duplicate of the English
one under a shared canonical. The crawler stance is the repo's global `ai.policy`
(`platforms/registry.yaml`, v1, 2026-10-27).

## Verification

- `pasco post check` exit 0 (no `missing-field`, `word-count` or
  `url-not-in-ssot` errors).
- Every code block runs as printed; every version is stated.
- Facts byte-identical to the SSOT; every URL from the identity SSOT.
- Report any contract gap as a finding — the engine is not extended from a
  skill (#361).
