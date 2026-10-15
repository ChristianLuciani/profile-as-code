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

/** The one place a candidate becomes an owner, or is refused. */
function ownerSlug(value: string): string | null {
  return value.length <= OWNER_MAX && OWNER.test(value) ? value : null;
}

/** A declared handle is a slug, not a display name: `@user` and `user` both name
 *  the same owner; anything outside the slug shape is not a handle. */
function ownerFromHandle(handle: string | undefined): string | null {
  if (handle === undefined) return null;
  return ownerSlug(handle.startsWith("@") ? handle.slice(1) : handle);
}

/** The owner of a `github.com` page URL — or `null` when the URL is not an
 *  http(s) GitHub page URL. A display name never becomes a slug here. */
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
  // `github.com/orgs/<org>` is GitHub's own org landing route: the owner is the
  // segment AFTER the reserved prefix. Reading the prefix itself as an owner
  // derived a URL for someone else's page (review F2). It is also the ONLY
  // reserved route handled — the rest are the declared limit of #227, so the
  // example here stays surface-neutral on purpose (fresh-review F6: the template
  // shape differs per surface, and this module is generic over it).
  const segment = segments[0] === "orgs" ? segments[1] : segments[0];
  if (segment === undefined) return null;
  try {
    return ownerSlug(decodeURIComponent(segment));
  } catch {
    return null;
  }
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
