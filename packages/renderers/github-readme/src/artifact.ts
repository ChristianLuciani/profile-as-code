/**
 * Live-verification capability of the `github-readme` surface — SPEC §19.5
 * (issue #132, Lane B #212).
 *
 * `pasco status --verify` may only JUDGE a surface whose producer declares how:
 * an artifact projection to compare, the host(s) the pass may request, and the
 * URL of the live artifact. All three live here, with the artifact's producer
 * (one home — D5, AGENTS.md rule 7), never in `core` (platform-specific, D20:
 * `pasco serve` acquires no network capability) and never in the CLI (which
 * consumes the declaration).
 *
 * Pure, offline, deterministic: no network, no clock, no randomness, no AI. The
 * CALLER hashes — the digest is SHA-256 of `extractArtifact`'s bytes and the
 * renderer never hashes (§19.5).
 */

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

/** GitHub owner slug shape (user or org). The charset check is also what keeps a
 *  crafted URL path segment from steering the derived URL: `..`, `%2f` and the
 *  like never survive it. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** A declared handle is a slug, not a display name: `@user` and `user` both name
 *  the same owner; anything outside the slug charset is not a handle. */
function ownerFromHandle(handle: string | undefined): string | null {
  if (handle === undefined) return null;
  const slug = handle.startsWith("@") ? handle.slice(1) : handle;
  return OWNER.test(slug) ? slug : null;
}

/** The owner of a `github.com` page URL — its first path segment — or `null` when
 *  the URL is not a GitHub page URL. A display name never becomes a slug here. */
function ownerFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;
  const segment = parsed.pathname.split("/").find((part) => part !== "");
  if (segment === undefined) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return OWNER.test(decoded) ? decoded : null;
}

/** The link platforms that can name THIS surface. `identity.links[].platform` is
 *  a free string (the schema does not tie it to `$defs/platform`), so the
 *  fixture convention `github` plus this surface's own slug are matched by name —
 *  and a SIBLING surface's slug is not: a `github-org` page link cannot name the
 *  personal profile README repo, and accepting it would derive a URL that is
 *  certainly wrong (a permanent `unverifiable` recorded as evidence). */
const GITHUB_LINK_PLATFORMS = new Set(["github", "github-readme"]);

/** Resolve the GitHub owner from the URL SSOT (§15.4/§18.4) — `identity.links`
 *  first (the canonical link set), then the declared handle matrix (§17) — never
 *  from a new hand-maintained field. */
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

/** The renderer's OWN terminus marker (§15.3: the generated footer). With the
 *  opening header it bounds the region the engine owns — the artifact. */
const FOOTER = /^<!-- generated by profile-as-code pasco build github-readme\b/;

const H1 = /^# /;

/**
 * §19.5: the canonical projection of the artifact this surface publishes —
 * the engine-owned region, with platform/transport chrome stripped. The
 * projection is what the ledger anchors and what a live fetch is compared
 * against, so decoration that the engine did not deploy can never read as
 * `out-of-band-drift`:
 *
 *   1. a BOM and CRLF/CR line endings are how the bytes travelled, not what was
 *      deployed;
 *   2. the artifact OPENS at the last header above its terminus and CLOSES at its
 *      LAST generated footer (§15.3) — a preamble injected above or an appendix
 *      appended below is outside the engine's region. Both bounds take the LAST
 *      match on purpose: an H1 inside a chrome preamble must not become the
 *      artifact's opening (that would pull chrome in and report FALSE drift), and
 *      a copy of the footer literal INSIDE the artifact (a fenced example) must
 *      not become its terminus (that would hide a real edit — a false
 *      `verified`, the one verdict §19.5 exists to prevent). DECLARED v1 limit:
 *      content a human adds outside the region is not part of the artifact and so
 *      is not judged; content inside it is, and an edit there is drift;
 *   3. blank padding is not content.
 *
 * Pure and idempotent: `extractArtifact(extractArtifact(t)) === extractArtifact(t)`,
 * so the digest of `extract(render(p))` is stable across re-extraction.
 */
export function extractArtifact(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    // A BOM is transport wherever an editor parked it — not just at byte 0, where
    // stripping it only once would make the projection non-idempotent.
    .split("\n")
    .map((line) => line.replace(/^\uFEFF+/, ""));

  const footer = lines.findLastIndex((line) => FOOTER.test(line));
  const limit = footer === -1 ? lines.length - 1 : footer;
  const header = lines.findLastIndex((line, index) => index <= limit && H1.test(line));

  // A terminus with no header above it cannot bound a region: the markers
  // disagree, so the whole text is the projection rather than an empty slice.
  const bounded = header !== -1;
  const from = bounded ? header : 0;
  const to = bounded || footer === -1 ? limit : lines.length - 1;

  const artifact = lines.slice(from, to + 1);
  let first = 0;
  let last = artifact.length - 1;
  while (first <= last && artifact[first]?.trim() === "") first += 1;
  while (last >= first && artifact[last]?.trim() === "") last -= 1;
  return artifact.slice(first, last + 1).join("\n");
}
