/**
 * The shared GitHub owner resolution of SPEC §19.5 — the ONE home
 * (issue #224, the declared residual of #216).
 *
 * `github-readme` and `github-org` both derive the owner of the artifact they
 * publish from the workspace's URL SSOT (§15.4/§18.4). The two copies were
 * byte-identical, and they had already received the same review fixes in #212 —
 * F2 (the reserved `orgs/` route: reading the prefix itself derived `orgs/orgs/…`,
 * a URL for someone else's page) and F5 (trailing/doubled hyphens and the 40-char
 * cap). That is the hazard: a future fix applied to one file leaves the other
 * surface deriving a DIFFERENT owner, and the owner is what the `evidenceUrl` and
 * the fetched artifact are derived from — so a divergence here silently certifies
 * a different URL. #216 gave the §19.5 projection one home and left this; #224 is
 * that debt paid.
 *
 * #227 completes F2 for the routes ADMITTED by the test below. #224 shipped the
 * rule with only the `orgs/` route handled and DECLARED the rest as its limit; this
 * file now carries the route grammar as a sourced table (`RESERVED_ROUTES`), so no
 * prefix admitted here is read as an owner. The first revision of this fix drew the
 * boundary by hand and missed 26 routes a fresh review + the admission sweep found
 * (#232 review, F1) — the boundary is now a mechanical test, not a judgement.
 *
 * What is SHARED is the algorithm: the one place a candidate becomes an owner, or
 * is refused. What stays per-surface is genuine per-surface DATA — the set of link
 * platforms that can name the surface, the URL template and `fetchHosts` (§19.5:
 * "the allowlist is a declared capability of the surface, beside its extractor —
 * one home, not a second platform list"). The engine also stops being the place
 * for it: GitHub's owner grammar is surface knowledge, not transport, so this is a
 * renderer support package and not `core` (D20, AGENTS.md rule 7) — the
 * `packages/paste` / `packages/artifact` precedent.
 *
 * Pure, offline, deterministic: no network, no clock, no randomness, no AI. The
 * CALLER fetches; this module only answers "which owner does this workspace name
 * for this surface — or none".
 */
import type { Profile } from "@profile-as-code/core";

/**
 * The per-surface DATA the shared algorithm takes. Neither field is inferred here:
 * `surface` is the D16 slug that keys the handle matrix (`socialHandles[].platform`,
 * §17.1), and `linkPlatforms` is the set of `identity.links[].platform` values that
 * can name THIS surface (`identity.links` is the canonical URL set, §15.4 — a
 * sibling surface's slug must not name this one, or a workspace could derive a URL
 * that is certainly wrong and record a permanent `unverifiable` as evidence).
 *
 * `surface` is used ONLY as an equality key (against `socialHandles[].platform`),
 * never to build a pattern — so a slug outside the D16 shape can only UNDER-match
 * and yields the honest `null`, never a mis-derived owner. That is why the D16 slug
 * regex is deliberately NOT re-validated here (and not copied from
 * `@profile-as-code/artifact`, where a bad slug could bound the wrong region and a
 * loud refusal is worth the second copy). The asymmetry is the consequence
 * direction, declared rather than accidental.
 */
export interface GithubSurfaceBinding {
  readonly surface: string;
  readonly linkPlatforms: ReadonlySet<string>;
}

/**
 * An owner resolution bound to one surface. Callable exactly like
 * `resolveGithubOwner(profile, binding)`, and carrying the binding it was built
 * from so a consumer (or the conformance body) can read it instead of re-deriving
 * or re-typing it.
 */
export type GithubOwnerResolver = ((profile: Profile) => string | null) & {
  readonly surface: string;
  /**
   * The platform set this resolver was bound to, SNAPSHOTTED and sorted at
   * construction. Carried for the same reason `surface` is — the shared
   * conformance body must prove the binding the ADAPTER declared — and it is
   * load-bearing: a body that took the set as an option would let the caller
   * re-type it in the test, which is the copy #224 removes, one level up
   * (fresh-review F1). A widening of the real set made one adapter's whole suite
   * green while only a distant suite caught it; this is what makes the failure
   * land in the file that changed.
   */
  readonly linkPlatforms: readonly string[];
};

/**
 * Every resolver this module ever produced. Identity, not shape: a hand-written
 * function in an adapter that happens to match the shared resolution on a corpus is
 * still a second implementation and must fail CI — `isGithubOwnerResolver` is how
 * the conformance body says "this is the shared one" (the `isArtifactExtractor`
 * shape of #216; a forged brand is a deliberate act, a copied rule is the accident
 * #224 removes).
 */
const CREATED = new WeakSet<GithubOwnerResolver>();

/**
 * Refuse a binding that cannot be honoured, instead of mis-reading it.
 *
 * The load-bearing clause is `linkPlatforms.has(surface)`: a surface's own slug is
 * always a valid platform for its links (that is what the slug is FOR), so a
 * binding that omits it is incoherent — and the shape that produces one is exactly
 * the copy-paste this issue is about (the `github-org` adapter left carrying
 * `{github, github-readme}`). Left unchecked it does not crash: it silently answers
 * `null` for every valid link, and the surface reports the honest-looking
 * `no-artifact-url` rung for an artifact it does publish. A call-site bug must not
 * be reportable as a verdict.
 */
function assertBinding(binding: GithubSurfaceBinding): void {
  const { surface, linkPlatforms } = binding;
  if (surface === "" || !linkPlatforms.has(surface)) {
    throw new Error(
      `incoherent GitHub surface binding: ${JSON.stringify(surface)} is not in its own linkPlatforms — a surface whose own slug cannot name it would read "no-artifact-url" for an artifact it publishes`,
    );
  }
}

/** GitHub owner slug shape (user or org): alphanumerics joined by SINGLE hyphens,
 *  never leading or trailing — GitHub's own rule — and at most 39 characters. The
 *  charset check is also what keeps a crafted URL path segment from steering the
 *  derived URL: `..`, `%2f`, `trail-` and the like never survive it (review F5). */
const OWNER = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const OWNER_MAX = 39;

/** The one place a candidate becomes an owner, or is refused.
 *
 *  A name GitHub RESERVES is refused here whatever proposed it, so the rule holds
 *  for every candidate and not only for a URL's first segment (#227, review F1):
 *  the owner slot of an `owner-after-prefix` route (`/sponsors/settings` and
 *  `/orgs/topics` are 404s, not the accounts `settings`/`topics`) and a declared
 *  handle (`settings` cannot be a username) both reach this line. GitHub reserves
 *  the name, so no account can hold it in any casing, and the only URL it could
 *  derive is a 404 — a durable wrong `evidenceUrl`, which is the harm class #227
 *  exists to remove. A reserved FIRST segment never reaches here: the route lookup
 *  in `ownerFromUrl` refuses it first (see `RESERVED_BY_PREFIX`, declared below —
 *  nothing calls this during module evaluation, so the reference is initialized by
 *  the time any workspace can reach it). */
function ownerSlug(value: string): string | null {
  if (RESERVED_BY_PREFIX.has(value.toLowerCase())) return null;
  return value.length <= OWNER_MAX && OWNER.test(value) ? value : null;
}

/** A declared handle is a slug, not a display name: `@user` and `user` both name
 *  the same owner; anything outside the slug shape is not a handle. */
function ownerFromHandle(handle: string | undefined): string | null {
  if (handle === undefined) return null;
  return ownerSlug(handle.startsWith("@") ? handle.slice(1) : handle);
}

/**
 * What a reserved first path segment means for the segment AFTER it (#227).
 *
 * `owner-after-prefix` — the next segment IS the account's own page, so it is the
 * owner. `no-owner` — the page belongs to GitHub, not to a single account, so
 * there is no owner and the honest answer is `null` (§19.5 row 2).
 */
type ReservedRouteKind = "owner-after-prefix" | "no-owner";

/** One row of GitHub's reserved first-segment route table (#227). */
export interface ReservedRoute {
  /**
   * The reserved first path segment, lowercase. Matched case-insensitively
   * against the DECODED segment (see `ownerFromUrl`: GitHub's account namespace
   * is case-insensitive, and so is the refusal it implies).
   */
  readonly prefix: string;
  readonly kind: ReservedRouteKind;
  /** What the route is, and why the owner rule follows from it. */
  readonly why: string;
  /**
   * What GitHub ITSELF served for this prefix — the per-row source, not an
   * assertion about one. Probed [OFICIAL] 2026-10-15 with
   * `curl -sL -A 'Mozilla/5.0' -w '%{http_code} %{url_effective}' https://github.com/<prefix>`;
   * where a row's claim needs a second segment, the row records that probe
   * separately AND the bare-prefix result first, so every row reproduces with the
   * documented command, first number included. A bot-gated 4xx is not by itself
   * evidence of a route: for `/apps` the 302 — measured without `-L`, since the
   * gate only appears once the redirect is followed — is the evidence.
   *
   * This is HALF the admission test: the other half is
   * `gh api /users/<prefix>` → 404 (the login is free, so no account is shadowed).
   * Rows the case-variant sweep found (#232 review, F1) record that signature here
   * too; both commands are in the package README. Re-runnable by design: a route
   * GitHub retires, or a name it later assigns, shows up as a stale row instead of
   * staying a silent mis-derivation.
   */
  readonly observed: string;
}

/** Freeze a row: this table is a module constant, and a caller that reached it
 *  through the public type must not be able to rewrite the grammar. */
const route = (
  prefix: string,
  kind: ReservedRouteKind,
  why: string,
  observed: string,
): ReservedRoute => Object.freeze({ prefix, kind, why, observed });

/**
 * GitHub's reserved first path segments — the ONE place the route grammar is
 * written down (#227), replacing the single `segments[0] === "orgs"` ternary that
 * #212 shipped.
 *
 * WHY A TABLE. The bug is one harm class, not one route (the F2 finding of #212):
 * `github.com/sponsors/elenavasquez` read `sponsors` as the owner and derived
 * `raw.githubusercontent.com/sponsors/sponsors/HEAD/README.md`, so `--verify`
 * fetched a stranger's path and wrote durable `http-404` evidence — and that wrong
 * `evidenceUrl` — into the user's ledger. A `||` would have closed `sponsors` and
 * left the class open for `topics`, `apps`, `settings`, … : the fix is the RULE
 * ("a reserved route prefix never becomes an owner"), and a rule needs the set of
 * prefixes it quantifies over, each argued and sourced on its own row.
 *
 * DECIDING A ROW. Two questions, in order:
 *
 *   1. Is the first segment a ROUTE, or an account? The ADMISSION TEST, both halves
 *      re-run for every row on 2026-10-15:
 *        `gh api /users/<prefix>` → 404 — the login is FREE, so no account holds the
 *        name and refusing it can never cost a real owner; and
 *        `curl -sL -A 'Mozilla/5.0' https://github.com/<prefix>` → a page GitHub
 *        serves itself (the rows record what each one is).
 *      The web-side corroboration is the case variant: a route's all-caps spelling
 *      is a 404 (`/README`, `/SPARK`), while an ACCOUNT answers in every casing
 *      (`/WWW`, `/Profile`/`/PROFILE` — probed). A name a live account holds is NOT
 *      a row whatever its lowercase page looks like: `profile`, `www`,
 *      `customer-stories`, `careers`, `actions`, `docs`, `dependabot`, … are all
 *      `200` from `/users/<name>`, and `customer-stories` is exactly the trap — its
 *      lowercase spelling is GitHub's marketing page while `/CUSTOMER-STORIES` is a
 *      live profile, so a row would un-verify a real workspace.
 *   2. If it is a route, does its page belong to ONE account? `/orgs/<org>` and
 *      `/sponsors/<account>` resolve to that account's own page, so the owner is
 *      the segment after the prefix; `/topics/<topic>`, `/marketplace/<listing>`,
 *      `/apps/<slug>` and the viewer's own hubs are GitHub's pages, whose second
 *      segment is a topic/listing/app slug — not an account — so there is no owner.
 *
 * WHERE THE REFUSAL LIVES. This table answers "is this FIRST segment a route".
 * The reservation itself is enforced on every candidate, in `ownerSlug`: a
 * reserved name proposing itself as the owner of an owner-after route
 * (`/sponsors/settings`, `/orgs/topics`) or as a declared handle is refused there
 * too, because GitHub reserves the name and no account can hold it in any casing
 * (review F1 — the hole the first revision left one segment to the right).
 *
 * Two rows are deliberate calls, recorded because they deviate from the candidate
 * list in #227. Both come from the same probe, and both point away from inventing
 * an owner:
 *
 *   - `stars` is `no-owner` even though `/stars/<account>` IS that account's
 *     starred list (probed: 200, titled with the account). Reading the second
 *     segment there is a defensible owner-after reading, but #227 decides `null`
 *     and this row follows it: a lost verification is recoverable, a wrong URL is
 *     durable wrong evidence. Flipping the kind is one word of data plus a corpus
 *     case, not a code change.
 *   - `profile` is NOT a row at all. #227 listed it beside `settings` because
 *     `github.com/settings/profile` exists — but `settings` already covers that
 *     URL, and `github.com/profile` is a LIVE ACCOUNT (probed: 200, `og:type`
 *     `profile`). A row here would refuse a real owner and read `no-artifact-url`
 *     for a workspace that does publish. The list is decided route by route, not
 *     copied.
 *
 * DECLARED LIMIT, now precise. Every row passed the admission test, and the table's
 * own suite pins the full kind partition as a literal oracle plus a behavioural
 * sweep, so a row is either admitted with evidence or absent on purpose. What is
 * still NOT covered is narrower and named:
 *
 *   - names GitHub reserves but never serves as a first-segment page (the admission
 *     test's page half is unobservable signed-out, e.g. `api`, `legal`, `packages`),
 *     and the long tail of reserved NAMEs that are not routes at all (a few hundred,
 *     community-maintained). A first segment that is neither a row nor an account
 *     still reads as an owner — the residual F2 class, now one admission test away.
 *   - the table cannot be verified in CI: half the test needs the network
 *     (`gh api`), so the evidence is recorded per row and re-runnable by hand. A
 *     name GitHub retires or claims later shows up as a stale row, not as a gate.
 */
export const RESERVED_ROUTES: readonly ReservedRoute[] = Object.freeze([
  // --- the route's next segment IS the account's own page ---------------------
  route(
    "orgs",
    "owner-after-prefix",
    "GitHub's organization landing route: the page at /orgs/<org> IS the org's own page, so the owner is the segment after the prefix (the shipped F2 fix of #212).",
    "bare /orgs → 404 (no index page) · /orgs/vercel → 200 → github.com/vercel",
  ),
  route(
    "sponsors",
    "owner-after-prefix",
    "GitHub Sponsors: /sponsors/<account> is that account's sponsored profile and GitHub resolves it to the account's own page, so the owner is the segment after the prefix.",
    "/sponsors/<account> → 200 → github.com/<account>; bare /sponsors → 200 (the Sponsors landing at /open-source/sponsors)",
  ),

  // --- GitHub's own discovery, marketplace and marketing pages ---------------
  route(
    "topics",
    "no-owner",
    "GitHub Topics: /topics/<topic> is a hub aggregating many repositories, not an account's page.",
    "/topics/typescript → 200 (a topic hub)",
  ),
  route(
    "collections",
    "no-owner",
    "GitHub Collections: /collections/<slug> is a curated list of repositories, not an account.",
    "/collections → 200 (the collections index)",
  ),
  route(
    "marketplace",
    "no-owner",
    "GitHub Marketplace: /marketplace/<listing> is an App/Action listing page; a listing is not an account.",
    "bare /marketplace → 400 (bot-gated) · /marketplace/actions/checkout → 200 (an Action listing)",
  ),
  route(
    "apps",
    "no-owner",
    "GitHub Apps: /apps/<slug> is an App's public page; an App is not a user or an org, so no owner artifact exists for it.",
    "bare /apps → 400 followed (bot-gated at /marketplace) · without `-L`: 302 → github.com/marketplace, which IS the route evidence",
  ),
  route(
    "trending",
    "no-owner",
    "GitHub Trending: GitHub's own leaderboard page.",
    "/trending → 200",
  ),
  route("explore", "no-owner", "GitHub Explore: GitHub's own discovery hub.", "/explore → 200"),
  route(
    "discover",
    "no-owner",
    "A GitHub discovery alias that resolves to Explore, not to an account.",
    "/discover → 200 → github.com/explore",
  ),
  route(
    "search",
    "no-owner",
    "GitHub Search: a query page over the whole site, owned by no account.",
    "/search → 200",
  ),
  route(
    "events",
    "no-owner",
    "GitHub's events/webinars index (a marketing page), not an account.",
    "/events → 200 → github.com/resources/events",
  ),
  route(
    "education",
    "no-owner",
    "GitHub Education: GitHub's own program page.",
    "/education → 200",
  ),
  route(
    "partners",
    "no-owner",
    "GitHub Partner Program: GitHub's own program page.",
    "/partners → 200",
  ),
  route(
    "customers",
    "no-owner",
    "GitHub's customer-stories page, an alias of GitHub's own marketing surface.",
    "/customers → 200 → github.com/customer-stories",
  ),
  route(
    "business",
    "no-owner",
    "GitHub's business/Enterprise marketing alias, not an account.",
    "/business → 200 → github.com/enterprise",
  ),
  route(
    "enterprise",
    "no-owner",
    "GitHub Enterprise: GitHub's own product page.",
    "/enterprise → 200",
  ),
  route(
    "enterprises",
    "no-owner",
    "GitHub Enterprise Cloud accounts live at /enterprises/<slug>: an enterprise account is not a user or org owner, and the route itself is GitHub's.",
    "bare /enterprises → 404 signed out (the per-slug page is GitHub-gated)",
  ),
  route("security", "no-owner", "GitHub Security: GitHub's own security hub.", "/security → 200"),
  route("about", "no-owner", "GitHub About: GitHub's own page.", "/about → 200"),
  route("pricing", "no-owner", "GitHub Pricing: GitHub's own plans page.", "/pricing → 200"),
  route("features", "no-owner", "GitHub Features: GitHub's own product tour.", "/features → 200"),
  route(
    "contact",
    "no-owner",
    "GitHub Support: GitHub's own contact page.",
    "/contact → 200 → help.github.com",
  ),
  route("home", "no-owner", "GitHub's signed-in home page.", "/home → 200"),
  route("copilot", "no-owner", "GitHub Copilot: GitHub's own product page.", "/copilot → 200"),

  // --- the marketing, program and doc-hosted pages (review of PR #232, F1) ----
  // Admitted by the case-variant SIGNATURE, not by guessing: GitHub serves a
  // lowercase page whose `og:type` is not `profile`, while the all-caps spelling is
  // a 404 — a route, because an ACCOUNT answers in every casing (`/WWW` and
  // `/WWW`==`/www`, `/Profile`/`/PROFILE`, probed). The fresh review named 8 of
  // these; the same sweep found 18 more, and it is what keeps the live accounts it
  // touched (`www`, `actions`, `desktop`, `docs`, `dependabot`, `students`, …) OUT:
  // their uppercase spelling returns a profile. `observed` records both halves of
  // the signature for these rows; the sweep command is in the README.
  route(
    "open-source",
    "no-owner",
    "GitHub's open-source program landing — also where the bare `/sponsors` redirect lands, which is why `/sponsors` alone is not an owner either.",
    "bare /open-source → 200 (object) · /OPEN-SOURCE → 404",
  ),
  route(
    "readme",
    "no-owner",
    "The README Project: GitHub's own editorial hub about maintainers.",
    "bare /readme → 200 (object) · /README → 404",
  ),
  route(
    "team",
    "no-owner",
    "GitHub for Teams: GitHub's own marketing page.",
    "bare /team → 200 (object) · /TEAM → 404",
  ),
  route(
    "solutions",
    "no-owner",
    "GitHub Solutions: GitHub's own by-industry landing page.",
    "bare /solutions → 200 (object) · /SOLUTIONS → 404",
  ),
  route(
    "why-github",
    "no-owner",
    "GitHub's 'why GitHub' marketing page.",
    "bare /why-github → 200 (object) · /WHY-GITHUB → 404",
  ),
  route(
    "trust-center",
    "no-owner",
    "GitHub Trust Center: GitHub's own compliance and assurance page.",
    "bare /trust-center → 200 (object) · /TRUST-CENTER → 404",
  ),
  route(
    "repositories",
    "no-owner",
    "A GitHub alias that resolves to the Trending leaderboard, not a repository index an owner could be read from.",
    "bare /repositories → 200 → /trending · /REPOSITORIES → 404",
  ),
  route(
    "users",
    "no-owner",
    "A GitHub alias to the signed-in home; there is no user index at the bare segment to read an owner from.",
    "bare /users → 200 (object) · /USERS → 404",
  ),
  route(
    "mobile",
    "no-owner",
    "GitHub Mobile: GitHub's own product page.",
    "bare /mobile → 200 (object) · /MOBILE → 404",
  ),
  route(
    "pages",
    "no-owner",
    "GitHub Pages: GitHub's own product site (pages.github.com).",
    "bare /pages → 200 → pages.github.com · /PAGES → 404",
  ),
  route(
    "wiki",
    "no-owner",
    "GitHub Wikis: GitHub's own feature page.",
    "bare /wiki → 200 (object) · /WIKI → 404",
  ),
  route(
    "discussions",
    "no-owner",
    "GitHub Discussions: the viewer's cross-repository discussions hub.",
    "bare /discussions → 200 → login?return_to=/discussions · /DISCUSSIONS → 404",
  ),
  route(
    "site-policy",
    "no-owner",
    "GitHub's site-policy corpus, served from docs.github.com.",
    "bare /site-policy → 200 → docs.github.com/en/site-policy · /SITE-POLICY → 404",
  ),
  route(
    "resources",
    "no-owner",
    "GitHub Resources: GitHub's own content hub.",
    "bare /resources → 200 (object) · /RESOURCES → 404",
  ),
  route(
    "guides",
    "no-owner",
    "GitHub Guides, served from docs.github.com.",
    "bare /guides → 200 → docs.github.com · /GUIDES → 404",
  ),
  route(
    "support",
    "no-owner",
    "GitHub Support, served from help.github.com.",
    "bare /support → 200 → help.github.com · /SUPPORT → 404",
  ),
  route(
    "status",
    "no-owner",
    "GitHub Status: GitHub's own availability page.",
    "bare /status → 200 · /STATUS → 404",
  ),
  route(
    "blog",
    "no-owner",
    "The GitHub Blog (github.blog).",
    "bare /blog → 200 → github.blog · /BLOG → 404",
  ),
  route(
    "nonprofit",
    "no-owner",
    "GitHub for Nonprofits, served from socialimpact.github.com.",
    "bare /nonprofit → 200 → socialimpact.github.com · /NONPROFIT → 404",
  ),
  route(
    "advisories",
    "no-owner",
    "The GitHub Advisory Database: GitHub's own security-advisories index.",
    "bare /advisories → 200 (object) · /ADVISORIES → 404",
  ),
  route(
    "spark",
    "no-owner",
    "GitHub Spark: GitHub's own product page.",
    "bare /spark → 200 (object) · /SPARK → 404",
  ),
  route(
    "press",
    "no-owner",
    "GitHub Press, served under /about/press.",
    "bare /press → 200 → /about/press · /PRESS → 404",
  ),
  route(
    "social-impact",
    "no-owner",
    "GitHub Social Impact: GitHub's own program page.",
    "bare /social-impact → 200 (object) · /SOCIAL-IMPACT → 404",
  ),
  route(
    "universe",
    "no-owner",
    "GitHub Universe: GitHub's own conference site (githubuniverse.com).",
    "bare /universe → 200 → githubuniverse.com · /UNIVERSE → 404",
  ),
  route(
    "sitemap",
    "no-owner",
    "GitHub's own sitemap index.",
    "bare /sitemap → 200 · /SITEMAP → 404",
  ),
  route(
    "terms",
    "no-owner",
    "GitHub's Terms of Service, served from docs.github.com.",
    "bare /terms → 200 → docs.github.com/en/site-policy/github-terms/… · /TERMS → 404",
  ),

  // --- account and session routes -------------------------------------------
  route(
    "settings",
    "no-owner",
    "Account settings are per-viewer, not a page belonging to a named account (/settings/profile is the canonical example from #227).",
    "/settings → 200 → github.com/login?return_to=/settings",
  ),
  route(
    "account",
    "no-owner",
    "GitHub's own account entry point, an alias of settings.",
    "/account → 200 → github.com/login?return_to=/account",
  ),
  route("login", "no-owner", "GitHub's sign-in form.", "/login → 200"),
  route("logout", "no-owner", "GitHub's sign-out action.", "/logout → 200 → github.com/"),
  route("join", "no-owner", "GitHub's sign-up funnel.", "/join → 403 → github.com/signup"),
  route("signup", "no-owner", "GitHub's sign-up form.", "/signup → 403 (bot-gated)"),
  route(
    "new",
    "no-owner",
    "GitHub's new-repository entry point for the viewer.",
    "/new → 200 → github.com/login?return_to=/new",
  ),
  route(
    "notifications",
    "no-owner",
    "The viewer's notification inbox, not an account's page.",
    "/notifications → 200 → github.com/login?return_to=/notifications",
  ),
  route(
    "dashboard",
    "no-owner",
    "The viewer's dashboard, not an account's page.",
    "/dashboard → 200 → github.com/login?return_to=/dashboard",
  ),
  route(
    "stars",
    "no-owner",
    "DELIBERATE, and the one row whose evidence would also support owner-after: /stars/<account> IS that account's starred list. #227 decides null and this row follows it — the conservative direction (an honest no-artifact-url, never a wrong URL). Flipping the kind is one word of data plus a corpus case.",
    "/stars/<account> → 200 (titled with the account); bare /stars → 200 → github.com/login?return_to=/stars",
  ),
  route(
    "pulls",
    "no-owner",
    "The viewer's cross-repository pull-request inbox.",
    "/pulls → 200 → github.com/login?return_to=/pulls",
  ),
  route(
    "issues",
    "no-owner",
    "The viewer's cross-repository issue inbox.",
    "bare /issues → 404 signed out (the signed-in global list)",
  ),
  route(
    "codespaces",
    "no-owner",
    "The viewer's Codespaces hub.",
    "/codespaces → 200 → github.com/login?return_to=/codespaces",
  ),
  route(
    "organizations",
    "no-owner",
    "GitHub's organization management routes (/organizations/<org>/settings/…); the bare segment is not an account page.",
    "bare /organizations → 404 signed out",
  ),
  route(
    "gists",
    "no-owner",
    "Gists live on a separate host; /gists is a GitHub redirect, not an account.",
    "/gists → 200 → gist.github.com/starred",
  ),
]);

/** The route grammar, keyed for the one lookup `ownerFromUrl` performs. Built once
 *  at module load: pure data, no clock, no network. */
const RESERVED_BY_PREFIX: ReadonlyMap<string, ReservedRoute> = new Map(
  RESERVED_ROUTES.map((row) => [row.prefix, row]),
);

/** Percent-decode one path segment — `null` for malformed escapes, so a crafted
 *  URL is refused instead of steering the derived URL (review F5). */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The owner of a `github.com` page URL — or `null` when the URL is not an
 *  http(s) GitHub page URL, or names no single account. A display name never
 *  becomes a slug here. */
function ownerFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // §19.5 derives the URL from the URL SSOT, and the SSOT's own `url` rule is
  // http(s): anything else is not the declared surface (review F5).
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;
  const segments = parsed.pathname.split("/").filter((part) => part !== "");
  const first = segments[0];
  if (first === undefined) return null;
  // WHAT GITHUB NAMES, in two steps that are both load-bearing:
  //
  //   1. DECODE FIRST. GitHub routes the decoded segment — probed 2026-10-15,
  //      `github.com/%73ponsors/<account>` returns 200 and resolves to the
  //      account's page exactly like `/sponsors/<account>`. Matching the table on
  //      the raw segment would let a percent-encoded reserved prefix through as an
  //      owner: the F5 bypass, in a new place.
  //   2. MATCH CASE-INSENSITIVELY. GitHub's account NAMESPACE is case-insensitive
  //      (`/Elenavasquez` and `/ELENAVASQUEZ` both serve the same account, probed
  //      2026-10-15), so a reserved route's name is unavailable as an account in
  //      ANY case: `/SPONSORS` and `/Sponsors` are 404, not profiles. Reserving
  //      the name case-insensitively is therefore the reading that cannot cost a
  //      real owner, and it closes the `Sponsors/…` one-keystroke bypass of this
  //      fix — the invariant has to hold for every spelling of the prefix.
  const decodedFirst = decodeSegment(first);
  if (decodedFirst === null) return null;
  const reserved = RESERVED_BY_PREFIX.get(decodedFirst.toLowerCase());
  if (reserved !== undefined) {
    // GitHub's own page: the path names no single account (#227).
    if (reserved.kind === "no-owner") return null;
    // The account's own page one segment later; no second segment means no owner
    // (the corpus pins it for `orgs/` and `sponsors/`).
    const ownerSegment = segments[1];
    if (ownerSegment === undefined) return null;
    const decodedOwner = decodeSegment(ownerSegment);
    return decodedOwner === null ? null : ownerSlug(decodedOwner);
  }
  return ownerSlug(decodedFirst);
}

/**
 * Resolve the GitHub owner the surface in `binding` publishes under, from the URL
 * SSOT (§15.4/§18.4) — never from a new hand-maintained field. `identity.links`
 * comes FIRST because §15.4 makes it the canonical URL set ("renderers and skills
 * read URLs ONLY from here"); the handle matrix §17.1 declares is the canonical
 * SURFACE set (which rows exist), not a URL precedence. Every GitHub surface
 * resolves in this order so one workspace cannot name two different owners
 * (review F3).
 *
 * `null` when nothing in the workspace names this surface: the caller's honest
 * `no-artifact-url` rung (§19.5 row 2), never an error and never a guess. That
 * includes the ordinary case of a workspace with no GitHub at all — it must stay
 * a `null`, so no request is ever aimed at a surface the workspace never declared.
 *
 * THROWS on an incoherent `binding`, and on nothing else: the binding is a module
 * constant, so no workspace can reach that path — it is a call-site bug refused
 * loudly (see `assertBinding`), not a verdict to report.
 */
export function resolveGithubOwner(profile: Profile, binding: GithubSurfaceBinding): string | null {
  assertBinding(binding);
  const { surface, linkPlatforms } = binding;
  for (const link of profile.identity.links ?? []) {
    // A github.com URL names the surface whether or not the row sets `platform`;
    // any OTHER declared platform does not.
    if (link.platform !== undefined && !linkPlatforms.has(link.platform)) continue;
    const owner = ownerFromUrl(link.url);
    if (owner !== null) return owner;
  }
  // The handle matrix keys on the SURFACE slug (`$defs/platform`), and this
  // surface's slug is its own name. Only CLAIMED rows count, matching the renderer
  // itself (`socialHandles` badges are `claimed` only, §17.1): a pending row is not
  // a deployed surface, and guessing its URL would record a wrong `evidenceUrl`
  // instead of the honest `no-artifact-url`.
  for (const handle of profile.socialHandles ?? []) {
    if (handle.platform !== surface || handle.status !== "claimed") continue;
    const owner =
      (handle.url !== undefined ? ownerFromUrl(handle.url) : null) ??
      ownerFromHandle(handle.handle);
    if (owner !== null) return owner;
  }
  return null;
}

/**
 * Bind the shared resolution to one surface's declaration — the ONE thing a
 * GitHub adapter needs, so a surface cannot carry a second copy of the rule. The
 * returned function is registered with this module, which is what
 * `isGithubOwnerResolver` verifies.
 *
 * Both halves of the binding are carried and non-writable (`surface` and the
 * snapshotted `linkPlatforms`): they ARE the declaration, and a resolver that kept
 * answering under a binding it no longer advertises would be unprovable by the
 * conformance body that exists to prove exactly that. The set is copied, not
 * aliased, so a caller mutating the object it passed cannot move the resolver's
 * behaviour out from under its own declaration.
 */
export function createGithubOwnerResolver(binding: GithubSurfaceBinding): GithubOwnerResolver {
  assertBinding(binding);
  const linkPlatforms = Object.freeze([...binding.linkPlatforms].sort());
  const declared: GithubSurfaceBinding = {
    surface: binding.surface,
    linkPlatforms: new Set(linkPlatforms),
  };
  const resolver = Object.defineProperty(
    (profile: Profile): string | null => resolveGithubOwner(profile, declared),
    "surface",
    { value: binding.surface, enumerable: true },
  ) as GithubOwnerResolver;
  Object.defineProperty(resolver, "linkPlatforms", { value: linkPlatforms, enumerable: true });
  CREATED.add(resolver);
  return resolver;
}

/**
 * True only for a function this module produced: the mechanical form of "the
 * adapter delegates the owner resolution, it does not re-implement it". A future
 * one-file divergence (a hand-rolled resolver in one adapter) is a second
 * implementation and fails the conformance body, before it can derive a different
 * owner than its sibling for the same workspace (#224).
 */
export function isGithubOwnerResolver(value: unknown): value is GithubOwnerResolver {
  // Functions only, and deliberately narrower than the `isArtifactExtractor`
  // idiom it is modelled on: `CREATED` is fed exclusively by
  // `createGithubOwnerResolver`, which registers functions, so the object branch
  // there is unreachable — and an identity guard that is load-bearing (it is what
  // makes a copy fail) should not declare a contract it cannot honour
  // (fresh-review F4).
  return typeof value === "function" && CREATED.has(value as GithubOwnerResolver);
}
