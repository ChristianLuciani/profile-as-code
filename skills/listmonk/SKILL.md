---
name: listmonk-post
description: >
  Long-form post skill for listmonk — a self-hosted email campaign to named
  lists, not a feed. Says what the issue is for and how the agent writes it; the
  machine contract is skills/listmonk/longform.yaml (required/optional fields,
  the tightest editorial word band of the long-form channels, export: api). The
  judgment layer — subject line, shape, GEO, i18n — lives in post.md. The agent
  writes N variants, the operator picks one and the list, and the choice is
  recorded with `pasco post choose`.
model: juicio (mid-tier) — the subject line and the single action are judgment;
  the mechanical parts (markdown, front matter) are not
applies_to: listmonk
projection: agent-agnostic (any harness that reads Markdown and can run the CLI)
version: 0.1.0
status: draft (#361)
sources: skills/listmonk/longform.yaml
---

# listmonk long-form — skill

## Mission

Turn one canonical seed into one email issue that a subscriber reads to the end
and acts on once. The reader opted in, so the piece owes them a letter: a
subject that states the value, a body that delivers it, one action at the close.
The skill is the judgment layer (D5); the contract plus `pasco post check` are
the deterministic part.

## When it runs

`pasco post task <seed> --format longform --channel listmonk` emits a task bundle
pointing at `longform.yaml` (contract) and this skill (judgment). Read the
contract for fields and band, then `post.md` for how to write. `pasco post` is
this channel's path: `pasco refine listmonk` does resolve this file, but refine
emits a **profile** task that expects the profile-skill `checks.yaml`, which this
directory does not ship — it will not give you a post workflow.

## Flow

1. Read `longform.yaml` + `post.md`; the band is narrower here, and the contract
   — not this file — is where its numbers live.
2. Write N variants as YAML front matter + markdown body, at
   `posts/<seed>/listmonk/listmonk-<n>.md`.
3. The operator picks one and the target `list`; record the choice with
   `pasco post choose`.
4. `pasco post check` — fix the findings.
5. `pasco post export <seed> --target postiz` for the campaign draft payload.
6. Send manually; the operator owns consent, unsubscribes and deliverability.

## Contract pointers (single source each)

| Question | Home |
|---|---|
| required / optional fields | `longform.yaml` `fields` (`list` selects the audience) |
| editorial word band | `longform.yaml` `limits.words` (not a platform cap) |
| api vs paste | `longform.yaml` `export` |
| link policy | `longform.yaml` `links.policy` (`identity-ssot-only`) |
| dated platform sources | `longform.yaml` `sources[]` |
| how to write the issue | `post.md` |

## GEO and i18n

Email is not crawlable: citation depends on the same text existing on a public
surface, with facts byte-identical to this issue. One list per language, one
language per issue; `en` by default. The crawler stance is the repo's global
`ai.policy` (`platforms/registry.yaml`, v1, 2026-10-27).

## Verification

- `pasco post check` exit 0 (no `missing-field`, `word-count` or
  `url-not-in-ssot` errors).
- Subject (title), dek and preview are three different sentences doing three
  different jobs.
- Exactly one call to action; every URL from the identity SSOT.
- Report any contract gap as a finding — the engine is not extended from a
  skill (#361).
