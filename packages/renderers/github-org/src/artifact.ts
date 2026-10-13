/**
 * Live-verification capability of the `github-org` surface (brand flavor,
 * SPEC §17) — SPEC §19.5 (issue #132; Lane B #212; one home #216).
 *
 * Same class as `github-readme`: `github-org` publishes a README the engine owns,
 * so the surface declares an artifact projection, a fetch allowlist and the URL
 * of the live artifact. The three are declared here, with the producer (one home
 * — D5, AGENTS.md rule 7), never in `core` (D20) or the CLI.
 *
 * The PROJECTION itself is shared, not surface knowledge: the §15.3 bound and the
 * transport normalization live once in `@profile-as-code/artifact` and this
 * adapter DELEGATES (#216), binding only its own generated footer. The fetch
 * allowlist, the owner resolution and the URL template are GitHub's and stay
 * here.
 *
 * Pure, offline, deterministic: no network, no clock, no randomness, no AI. The
 * CALLER hashes — the digest is SHA-256 of `extractArtifact`'s bytes and the
 * renderer never hashes (§19.5).
 */

import { createArtifactExtractor } from "@profile-as-code/artifact";
import type { Profile } from "@profile-as-code/core";

/**
 * §19.5 fetch allowlist: the ONLY host `--verify` may request for this surface.
 * The workspace is untrusted input, so the pass validates the derived URL's host
 * against this list BEFORE any request. v1 reads the raw README back, which is
 * served from the raw host — not the `github.com` deploy host of
 * `platforms/registry.yaml`.
 */
export const fetchHosts: readonly string[] = ["raw.githubusercontent.com"];

/** GitHub owner slug shape (org or user): alphanumerics joined by SINGLE hyphens,
 *  never leading or trailing — GitHub's own rule — and at most 39 characters. The
 *  charset check is also the guard that keeps a crafted URL path segment from
 *  steering the derived URL. */
const OWNER = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const OWNER_MAX = 39;

/** The one place a candidate becomes an owner, or is refused. */
function ownerSlug(value: string): string | null {
  return value.length <= OWNER_MAX && OWNER.test(value) ? value : null;
}

/** A declared handle is a slug: `@org` and `org` name the same owner. */
function ownerFromHandle(handle: string | undefined): string | null {
  if (handle === undefined) return null;
  return ownerSlug(handle.startsWith("@") ? handle.slice(1) : handle);
}

/** The owner of a `github.com` page URL — or `null` when the URL is not an
 *  http(s) GitHub page URL. */
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
  // derived `orgs/.github/…` — a URL for someone else's page (review F2).
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
 *  and a SIBLING surface's slug is not: a `github-readme` page link names the
 *  personal profile README repo, and accepting it would derive an org URL that is
 *  certainly wrong (a permanent `unverifiable` recorded as evidence). */
const GITHUB_LINK_PLATFORMS = new Set(["github", "github-org"]);

/** Resolve the org from the URL SSOT (§15.4/§18.4) — never from a new
 *  hand-maintained field. `identity.links` comes FIRST because §15.4 makes it the
 *  canonical URL set ("renderers and skills read URLs ONLY from here"); the handle
 *  matrix §17.1 declares is the canonical SURFACE set (which rows exist), not a
 *  URL precedence. Both sibling adapters resolve in this order so one workspace
 *  cannot name two different owners (review F3). */
function githubOrg(profile: Profile): string | null {
  for (const link of profile.identity.links ?? []) {
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
    if (handle.platform !== "github-org" || handle.status !== "claimed") continue;
    const owner =
      (handle.url !== undefined ? ownerFromUrl(handle.url) : null) ??
      ownerFromHandle(handle.handle);
    if (owner !== null) return owner;
  }
  return null;
}

/**
 * §19.5: the URL of the artifact this surface publishes, derived from the URL
 * SSOT. A GitHub org's profile README lives in the org's `.github` repo at
 * `profile/README.md`, on the org's default branch — `HEAD` resolves that branch,
 * so no branch is hand-maintained (SPEC §19.5: "never a new hand-maintained
 * field"; measured 2026-10-12: `raw.githubusercontent.com/nodejs/.github/HEAD/
 * profile/README.md` → 200 [BENCHMARK]).
 *
 * `null` when the workspace declares no GitHub org surface: that is the declared
 * `no-artifact-url` rung, never an error (§19.5 row 2).
 */
export function artifactUrl(profile: Profile): string | null {
  const org = githubOrg(profile);
  if (org === null) return null;
  return `https://raw.githubusercontent.com/${org}/.github/HEAD/profile/README.md`;
}

/**
 * §19.5: the canonical projection of the artifact this surface publishes — the
 * engine-owned region, with platform/transport chrome stripped, for the frozen
 * `extractArtifact(text: string): string` seam of #212.
 *
 * The bound and the transport normalization live ONCE, in
 * `@profile-as-code/artifact` (#216), where the rule's rationale and its declared
 * v1 limit are recorded; what this line binds is this surface's OWN generated
 * footer (§15.3) — a `github-readme` footer inside an org artifact is NOT this
 * surface's terminus, so it cannot close the region early and hide a real edit.
 */
export const extractArtifact = createArtifactExtractor("github-org");
