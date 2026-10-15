/**
 * Live-verification capability of the `github-readme` surface — SPEC §19.5
 * (issue #132; Lane B #212; one home #216/#224).
 *
 * `pasco status --verify` may only JUDGE a surface whose producer declares how:
 * an artifact projection to compare, the host(s) the pass may request, and the
 * URL of the live artifact. The three are declared here, with the artifact's
 * producer (one home — D5, AGENTS.md rule 7), never in `core` (platform-specific,
 * D20: `pasco serve` acquires no network capability) and never in the CLI (which
 * consumes the declaration).
 *
 * Neither shared half is surface knowledge. The PROJECTION belongs to every
 * markdown artifact the engine renders, so the §15.3 bound and the transport
 * normalization live once in `@profile-as-code/artifact` (#216). The OWNER
 * RESOLUTION belongs to GitHub and is shared with the `github-org` sibling, so it
 * lives once in `@profile-as-code/github` (#224): the two copies had already
 * received the same review fixes (F2, the reserved `orgs/` route; F5, the slug
 * shape), so the next fix landing in one file would have left the other surface
 * deriving a DIFFERENT owner — and the owner is what the `evidenceUrl` and the
 * fetched artifact are derived from. What stays genuinely per-surface, and is
 * declared here: which platforms can name this surface, the URL template and the
 * fetch allowlist.
 *
 * Pure, offline, deterministic: no network, no clock, no randomness, no AI. The
 * CALLER hashes — the digest is SHA-256 of `extractArtifact`'s bytes and the
 * renderer never hashes (§19.5).
 */

import { createArtifactExtractor } from "@profile-as-code/artifact";
import type { Profile } from "@profile-as-code/core";
import { createGithubOwnerResolver } from "@profile-as-code/github";

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

/** The link platforms that can name THIS surface. `identity.links[].platform` is
 *  a free string (the schema does not tie it to `$defs/platform`), so the
 *  fixture convention `github` plus this surface's own slug are matched by name —
 *  and a SIBLING surface's slug is not: a `github-org` page link cannot name the
 *  personal profile README repo, and accepting it would derive a URL that is
 *  certainly wrong (a permanent `unverifiable` recorded as evidence). */
const GITHUB_LINK_PLATFORMS = new Set(["github", "github-readme"]);

/** Resolve the GitHub owner from the URL SSOT (§15.4/§18.4) — never from a new
 *  hand-maintained field. The rule (links first, claimed handles second, the slug
 *  shape, the `orgs/` route) lives ONCE, in `@profile-as-code/github` (#224), where
 *  its rationale and its regressions are recorded; what this line binds is the one
 *  per-surface input it takes, this surface's platform set. Exported so the shared
 *  conformance body can prove the binding instead of trusting it. */
export const githubOwner = createGithubOwnerResolver({
  surface: "github-readme",
  linkPlatforms: GITHUB_LINK_PLATFORMS,
});

/**
 * §19.5: the URL of the artifact this surface publishes, derived from the URL
 * SSOT. The GitHub profile README lives in the repo named exactly like its owner,
 * on the owner's default branch — `HEAD` resolves that branch, so no branch is
 * hand-maintained (SPEC §19.5: "never a new hand-maintained field").
 *
 * `null` when the workspace declares no GitHub surface: that is the declared
 * `no-artifact-url` rung, never an error (§19.5 row 2) — and never a request.
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
