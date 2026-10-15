/**
 * Live-verification capability of the `github-readme` surface — SPEC §19.5
 * (issue #132; Lane B #212; one home #216).
 *
 * `pasco status --verify` may only JUDGE a surface whose producer declares how:
 * an artifact projection to compare, the host(s) the pass may request, and the
 * URL of the live artifact. The three are declared here, with the artifact's
 * producer (one home — D5, AGENTS.md rule 7), never in `core` (platform-specific,
 * D20: `pasco serve` acquires no network capability) and never in the CLI (which
 * consumes the declaration).
 *
 * The PROJECTION itself is not surface knowledge: the §15.3 bound and the
 * transport normalization are the same for every markdown artifact the engine
 * renders, so they live once in `@profile-as-code/artifact` and this adapter
 * DELEGATES (#216). What stays here is what is genuinely GitHub's: the fetch
 * allowlist, the owner resolution and the URL template. A boundary fix in the
 * shared home reaches every surface at once — it can no longer leave a sibling
 * certifying the same artifact under different rules.
 *
 * Pure, offline, deterministic: no network, no clock, no randomness, no AI. The
 * CALLER hashes — the digest is SHA-256 of `extractArtifact`'s bytes and the
 * renderer never hashes (§19.5).
 */

import { createArtifactExtractor } from "@profile-as-code/artifact";
import type { Profile } from "@profile-as-code/core";

/**
 * §19.5 fetch allowlist: the ONLY host `--verify` may request for this surface.
 *
 * The workspace is UNTRUSTED input (templates are cloned from strangers), so the
 * pass validates the derived URL's host against this list BEFORE any request: a
 * crafted `identity.links` entry must not aim an opt-in `--verify` at an
 * arbitrary or internal host. v1 reads the engine's own artifact back — the raw
 * README — which is why `github.com` (the deploy host declared in
 * `platforms/registry.yaml`) is not enough: the raw bytes live on this host.
 */
export const fetchHosts: readonly string[] = ["raw.githubusercontent.com"];

/** GitHub owner slug shape (user or org): alphanumerics joined by SINGLE hyphens,
 *  never leading or trailing — GitHub's own rule — and at most 39 characters. The
 *  charset check is also what keeps a crafted URL path segment from steering the
 *  derived URL: `..`, `%2f`, `trail-` and the like never survive it. */
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
  // http(s): anything else is not the declared surface.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;
  const segments = parsed.pathname.split("/").filter((part) => part !== "");
  // `github.com/orgs/<org>` is GitHub's own org landing route: the owner is the
  // segment AFTER the reserved prefix. Reading the prefix itself as an owner
  // derived `orgs/orgs/…` — a URL for someone else's page (review F2).
  const segment = segments[0] === "orgs" ? segments[1] : segments[0];
  if (segment === undefined) return null;
  try {
    return ownerSlug(decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/** The link platforms that can name THIS surface. `identity.links[].platform` is
 *  a free string (the schema does not tie it to `$defs/platform`), so the
 *  fixture convention `github` plus this surface's own slug are matched by name —
 *  and a SIBLING surface's slug is not: a `github-org` page link cannot name the
 *  personal profile README repo, and accepting it would derive a URL that is
 *  certainly wrong (a permanent `unverifiable` recorded as evidence). */
const GITHUB_LINK_PLATFORMS = new Set(["github", "github-readme"]);

/** Resolve the GitHub owner from the URL SSOT (§15.4/§18.4) — never from a new
 *  hand-maintained field. `identity.links` comes FIRST because §15.4 makes it the
 *  canonical URL set ("renderers and skills read URLs ONLY from here"); the handle
 *  matrix §17.1 declares is the canonical SURFACE set (which rows exist), not a
 *  URL precedence. Both sibling adapters resolve in this order so one workspace
 *  cannot name two different owners (review F3). */
function githubOwner(profile: Profile): string | null {
  for (const link of profile.identity.links ?? []) {
    // A github.com URL names the surface whether or not the row sets `platform`;
    // any OTHER declared platform does not.
    if (link.platform !== undefined && !GITHUB_LINK_PLATFORMS.has(link.platform)) continue;
    const owner = ownerFromUrl(link.url);
    if (owner !== null) return owner;
  }
  // The handle matrix keys on the SURFACE slug (`$defs/platform`), and this
  // surface's slug is its own name. Only CLAIMED rows count, matching the
  // renderer itself (`socialHandles` badges are `claimed` only, §17.1): a pending
  // row is not a deployed surface, and guessing its URL would record a wrong
  // `evidenceUrl` instead of the honest `no-artifact-url`.
  for (const handle of profile.socialHandles ?? []) {
    if (handle.platform !== "github-readme" || handle.status !== "claimed") continue;
    const owner =
      (handle.url !== undefined ? ownerFromUrl(handle.url) : null) ??
      ownerFromHandle(handle.handle);
    if (owner !== null) return owner;
  }
  return null;
}

/**
 * §19.5: the URL of the artifact this surface publishes, derived from the URL
 * SSOT. The GitHub profile README lives in the repo named exactly like its owner,
 * on the owner's default branch — `HEAD` resolves that branch, so no branch is
 * hand-maintained (SPEC §19.5: "never a new hand-maintained field").
 *
 * `null` when the workspace declares no GitHub surface: that is the declared
 * `no-artifact-url` rung, never an error (§19.5 row 2).
 */
export function artifactUrl(profile: Profile): string | null {
  const owner = githubOwner(profile);
  if (owner === null) return null;
  return `https://raw.githubusercontent.com/${owner}/${owner}/HEAD/README.md`;
}

/**
 * §19.5: the canonical projection of the artifact this surface publishes — the
 * engine-owned region, with platform/transport chrome stripped, for the frozen
 * `extractArtifact(text: string): string` seam of #212.
 *
 * The bound and the transport normalization live ONCE, in
 * `@profile-as-code/artifact` (#216): what this line binds is the one surface
 * input they take — this renderer's OWN generated footer (§15.3), the only marker
 * that may close the region. See the shared home for the rule's rationale and its
 * declared v1 limit.
 */
export const extractArtifact = createArtifactExtractor("github-readme");
