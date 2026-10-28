# ai-policy fixture

A minimal profile-data workspace exercising `pasco export ai-policy` (SPEC §7.3,
issue #290): `identity.definition` (the one-line definition `llms.txt` quotes),
a `role: identity` link (the canonical URL), three `faq[]` rows — one with a
`source` — and two `publications[]` (a DOI and a URL), which are the documents
the generated index must cover.

It is deliberately NOT a copy of the core `minimal` fixture: those rows exist to
exercise renderers and limits, these exist to exercise the index and its
coverage assertion.
