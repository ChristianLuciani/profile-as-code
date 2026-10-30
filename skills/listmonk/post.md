# listmonk long-form post — skill (MVP)

> Long-form post skill. The contract is `longform.yaml`: required/optional
> fields, the editorial word band and `export` live there and are **not**
> restated here — this file is the judgment layer the agent reads before
> writing. The contract's `sources[]` carries the dated URL for every platform
> claim; re-verify before making a hard one, and cite a source (date + tier)
> before calling anything a limit.

## What a listmonk piece is for

One email campaign to one or more lists the reader already subscribed to. The
audience is the list, not a feed: there is no discovery, no search surface and no
second chance — the subject line decides whether the issue is read at all. The
piece is a letter to a named group, not a post that hopes to be found.

## Shape

1. **Title** — the subject line. It is what the reader sees first and the only
   line that competes with an inbox; state the value of opening, not the topic.
2. **Dek** — the line that sets up the issue: why this, why now. Where the
   channel renders a preview line, the optional `preview` field carries it — the
   contract declares both, and they must not say the same thing.
3. **Sections** — an email is read top to bottom in one sitting: lead with the
   point, then the evidence, then one action. Short paragraphs, no nested
   headings, no "read more" link as the only payload.

## Rules

- **Front matter is the field contract.** `longform.yaml` declares the fields this
  channel consumes, required and optional alike; the engine exports only those,
  and an undeclared field is dropped (`pasco post check` warns `unknown-field`).
  The field that selects the audience is a targeting decision, not prose: choose
  it deliberately, and never send one issue to a list it was not written for.
- **Length:** the band in `limits.words` is the operator's editorial default (the
  contract says so) — and it is the tightest of the long-form channels, because
  the channel is read in one sitting, not skimmed. Do not pad to reach it and do
  not assume the ceiling is the goal.
- **Links:** `links.policy` is `identity-ssot-only`. An email has no canonical
  field in the contract, so the SSOT is the only URL source and the archive copy
  (if any) is the only place a URL can be cited from.
- **Facts:** `{{fact:<pointer>}}` for every number, date and URL.
- **Voice:** direct, personal, no marketing cadence. Match `brandVoice`; a
  newsletter that sounds like a press release is an unsubscribe.

## Export: `api`

The contract declares `export: api`: listmonk's API creates a campaign with a
body and one or more list ids [OFICIAL — the contract's source, `sources[]` in
`longform.yaml`, dated 2026-10-29]. Consequences:

- The body is markdown/HTML the campaign carries; keep it paste-safe and
  email-safe (no scripts, no layout that only a browser renders).
- The audience is a `list` id, not a channel: the send is a targeting decision
  the operator makes, and this skill never picks it for them.
- The export produces a draft payload; sending stays manual.
- Consent, unsubscribe mechanics and deliverability are the operator's
  responsibility and out of scope here.

## GEO (how this channel is read and cited)

Email is not a crawlable surface: an issue that exists only in an inbox is
invisible to search and to citation. Citability therefore depends on the same
text also existing where it can be linked and quoted — if it matters, mirror it
to a public surface whose URL the SSOT already carries, and keep the two copies
byte-identical in their facts. The crawler stance is the repo's global
`ai.policy` (`platforms/registry.yaml`, v1, 2026-10-27); no per-channel rule is
invented here.

## i18n

The list is the segmentation: one list per language, and one language per issue.
Write `en` by default; a Spanish issue goes to the Spanish list, not to every
list. Do not machine-translate an issue and send both to the same audience.

## Anti-patterns

- A subject line that is the article title ("On X") with no reason to open.
- A dek and a preview that repeat each other.
- An issue with five calls to action.
- Marketing cadence in a letter ("Don't miss out!").
- Sending a piece written for one audience to a list it does not fit.

## Output contract

Save each variant as YAML front matter + a markdown body at
`posts/<seed>/listmonk/listmonk-<n>.md`, then record the choice and check it:

```
pasco post choose <seed> --channel listmonk --variant listmonk-1
pasco post check <seed>     # missing-field · word-count · url-not-in-ssot · unknown-field
pasco post export <seed> --target postiz
```
