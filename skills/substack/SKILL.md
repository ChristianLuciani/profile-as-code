---
name: substack-post
description: >
  Long-form post skill for Substack. Says what a Substack issue is for and how
  the agent writes it; the machine contract is
  skills/substack/longform.yaml (required/optional fields, editorial word band,
  export: paste). The judgment layer — shape, voice, GEO, i18n — lives in
  post.md. The agent writes N variants, the operator picks one, and the choice is
  recorded with `pasco post choose`; the deploy is a manual paste driven by the
  generated checklist, because Substack exposes no body-publish API.
model: juicio (mid-tier) — the letter's opening and its closing are judgment; the
  mechanical parts (markdown, front matter, paste checklist) are not
applies_to: substack
projection: agent-agnostic (any harness that reads Markdown and can run the CLI)
version: 0.1.0
status: draft (#361)
sources: skills/substack/longform.yaml
---

# Substack long-form — skill

## Mission

Turn one canonical seed into a newsletter issue that works twice: as the email a
subscriber opens and as the public archive page a visitor lands on. One idea, a
stake, an argument developed once, and a closing that says what comes next. The
skill is the judgment layer (D5); the contract plus `pasco post check` are the
deterministic part.

## When it runs

`pasco post task <seed> --format longform --channel substack` emits a task bundle
pointing at `longform.yaml` (contract) and this skill (judgment). Read the
contract for fields and band, then `post.md` for how to write. `pasco post` is
this channel's path: `pasco refine substack` does resolve this file, but refine
emits a **profile** task that expects the profile-skill `checks.yaml`, which this
directory does not ship — it will not give you a post workflow.

## Flow

1. Read `longform.yaml` + `post.md`; the contract owns every limit.
2. Write N variants as YAML front matter + markdown body, at
   `posts/<seed>/substack/substack-<n>.md`.
3. The operator picks one; record it with `pasco post choose`.
4. `pasco post check` — fix the findings.
5. `pasco post export <seed>` → `paste-checklist.md` (no body API in v1).
6. Paste the body and each field into the editor, tick the checklist, and verify
   the live archive page before calling it published.

## Contract pointers (single source each)

| Question | Home |
|---|---|
| required / optional fields | `longform.yaml` `fields` |
| editorial word band | `longform.yaml` `limits.words` (not a platform cap) |
| api vs paste | `longform.yaml` `export: paste` (no body API) |
| link policy | `longform.yaml` `links.policy` (`identity-ssot-only`) |
| dated platform sources | `longform.yaml` `sources[]` |
| how to write the issue | `post.md` |

## GEO and i18n

The archive page is public and indexable while the email copy is not; the section
heading plus its claim is the citation unit, and it resolves to the archive URL.
Keep facts byte-identical to the profile. One publication per language; `en` by
default, a Spanish publication as its own surface. The crawler stance is the
repo's global `ai.policy` (`platforms/registry.yaml`, v1, 2026-10-27).

## Verification

- `pasco post check` exit 0 (no `missing-field`, `word-count` or
  `url-not-in-ssot` errors).
- The pasted body kept headings, links and quotes; the archive page renders the
  dek and title as intended.
- Facts byte-identical to the SSOT; every URL from the identity SSOT.
- Report any contract gap as a finding — the engine is not extended from a
  skill (#361).
