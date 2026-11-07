# Playbook — Substack deploy (paste, D9)

Surface: the profile (`substack.com/@handle`) plus the publication site
(`<name>.substack.com` or a custom domain) — **no public body-write API**
(SOTA-2026 §5; `longform.yaml` carries `export: paste` for the post). The deploy
is manual; the ledger records it with `pasco status --mark`, and the caps are
soft (see `checks.yaml`).

Substack's UI paths drift: each one below is transcribed from the dated sources
where the source names it (`[OFICIAL]` help center, `[EXPERTO]` settings mirror),
and a path the research does not transcribe is marked `[?]` and reopened at paste
time rather than trusted.

## Pre-paste

1. `pasco validate` — exit 0 (schema + drift + geo).
2. `pasco build substack --lang <lang>` — writes the paste sheet to
   `profiles/substack/README.md`: `Field: value` lines for the profile header,
   the two bio lengths, the link set and the publication copy (SOTA-2026 §9).
   A line whose fact the SSOT does not declare is omitted — never fill it by
   hand; and a workspace with no substack bio and no `newsletter` block leaves
   no artifact (unbuild).
3. Check the canonical URL: `newsletter.url` must be the live publication URL.
   A custom domain is a separate, paid step (see _Fields the renderer cannot
   paste_) and it needs the URL declared in the SSOT **before** it is used.
4. Check the handle: `identity.handle` / `socialHandles[].handle`, stored without
   the `@` the UI shows. Verify it resolves while signed in; a profile URL is
   derived from it, so a handle change moves the profile.

## Paste (profile + publication)

Order matters: the profile is the surface other channels link to, and the
publication copy is read inside it.

1. **Profile → Edit** (`substack.com/profile/edit`, `[OFICIAL]`): display name
   (`identity.name`), bio (the `short` row of `bios` for the language), social /
   website links (from `identity.links`), photo upload (the pointer in
   `identity.photo`; cropping is manual). The bio is plain text — the links field
   is where URLs live.
2. **Publication name** (`Settings → Publication`, path `[?]` — the setting is
   `[EXPERTO]` in SOTA-2026 §2.1): `newsletter.name`
   for the language. This is the site title, the email sender label and the
   archive title.
3. **Short description** (`Settings → Publication Description`; older guides say
   `Settings → Basics`, path drifts `[?]`, `[EXPERTO]`): the `description` of
   `newsletter`. One line, ~26 words is the editorial default (`[EXPERTO]`,
   SOTA-2026 §1/§6, fetched 2026-11-05), no documented cap `[?]`.
4. **About page** (`Settings → Website → About page`, path `[?]` — the page is
   `[OFICIAL]` in SOTA-2026 §2.1, the path is not transcribed): paste the
   `long` bio as the body, then add the parts that are not SSOT facts but make
   the page usable — cadence (`newsletter.cadence`), what a subscriber gets, and
   the canonical URL. Testimonials, images, video, highlighted posts and offers
   are editorial assembly: they belong to the page, not to the SSOT (§8).
5. **Hero text / tagline** (optional; `Settings → Website`, path `[?]`):
   `identity.tagline` is reusable here, but the hero is publication UI copy —
   do not paste it as a fact claim.
6. **Welcome email** (`Settings → Emails → Welcome email`, path `[?]`): subject
   and body. These are **not SSOT fields** — this is why the step is here. Keep
   the first email consistent with the About's one action (subscribe) and its
   canonical URL; do not introduce a fact the SSOT does not carry.
7. **Privacy / training toggle** — two separate settings, both account-level
   (`Settings → Privacy`, path `[?]`, and the AI-training protection toggle described in the
   `[OFICIAL]` AI opt-out article, updated 2026-07-08): hide likes / hide Reads,
   private mode, and the robots-level request to third-party AI tools. The
   repo-wide stance is `ai.policy` in `platforms/registry.yaml`; this toggle is
   how the publication applies it. Record what you set — it is not derivable
   from the SSOT.
8. **Subscribe footer / email from name** (`Settings → Emails`, path `[?]`):
   sender name and footer copy; publication ops, not identity.

## Fields the renderer cannot paste (why they are steps, not data)

The engine's artifact covers text it can derive from the SSOT. These are the
deliberate exclusions (SOTA-2026 §8) — the paste is the only path:

- **Design layer** — homepage layout (profile / newspaper / magazine / custom),
  theme colors, fonts, header/footer, hero alignment, navigation, sections.
  Presentation, not identity; it changes without the SSOT changing.
- **Assets** — logo ≥ 256×256 (transparent background), wordmark ≥ 1344×256
  (max 21:4), cover ≥ 600×600, social preview recommended ≥ 1456×1048 (minimum
  420×300, 14:10), favicon `[OFICIAL]`, customization guide 2023-05-02. The
  SSOT stores the logo **pointer** (`identity.logo`); the upload and the sizes
  are manual.
- **Billing** — plans, prices ($5/month and $30/year minimum `[OFICIAL]`),
  founding tier, trials, coupons, gifts, group plans, payouts. Stripe/Substack
  is the source of truth; duplicating it in the SSOT guarantees drift.
- **Analytics** — subscribers, ARR, opens, clicks. A read surface that changes
  daily; never stored.
- **Custom domain** — one-time $50 USD, subdomain required (`www.…`), root
  domain 301-redirects, CNAME → `target.substack-custom-domains.com`, up to 36 h
  verification, and **email still sends from `@substack.com`** `[OFICIAL]`,
  updated 2026-10. Declare the final URL in `newsletter.url` first.
- **Podcast settings** and the welcome/founding emails: publication ops, no SSOT
  body.

## Post-paste (verification)

1. Open the profile and the publication in a **browser** (Cloudflare 403 for
   plain fetchers, SOTA-2026 §5): display name, bio, links, photo; the
   publication's one-liner; the About page renders headings and paragraphs.
   Nothing flattened, no markdown leaks, no truncated sentence where the meaning
   was.
2. Follow every link: each URL must be one of `identity.links` or
   `newsletter.url`, and every one must resolve.
3. `pasco check substack` — the `fact-present` premise compares the built sheet
   with the current SSOT; fix the sheet, not the finding. The char caps it
   reports come from the workspace catalog (when declared) or the package
   defaults, never from `skills/substack/checks.yaml` (#455).
4. Record the deploy: `pasco status --mark <ledgerKey> substack` (the ledgerKey
   of the exact row pasted). Then `pasco status substack` must read in-sync and
   `pasco diff` must be empty for that unit.
5. Re-verify after any rename: a Substack username can change and old handles
   keep resolving, so update `identity.links` and the canonical URL before the
   next re-paste.

## Do not do it by hand in the workspace

- The paste is recorded only through `--mark`; editing `content/deployments.yaml`
  by hand breaks the D18 contract (only `pasco` writes the ledger).
- Do not paste a variant that was not chosen: only the active row is deployable.
- Do not add a `max-chars` row to `content/checks.yaml` to make the shipped soft
  cap apply — that is not how the executor works (#455), and the shipped value is
  curation, not a limit.
