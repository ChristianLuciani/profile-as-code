/**
 * Live-verification capability of the `github-org` surface (brand flavor,
 * SPEC §17) — SPEC §19.5 (issue #132; Lane B #212; one home #216/#224).
 *
 * Same class as `github-readme`: `github-org` publishes a README the engine owns,
 * so the surface declares an artifact projection, a fetch allowlist and the URL
 * of the live artifact. They are declared here, with the producer (one home — D5,
 * AGENTS.md rule 7), never in `core` (D20) or the CLI.
 *
 * Neither shared half is surface knowledge. The PROJECTION is shared: the §15.3
 * bound and the transport normalization live once in `@profile-as-code/artifact`
 * (#216) and this adapter DELEGATES, binding only its own generated footer. The
 * OWNER RESOLUTION is GitHub knowledge shared with the `github-readme` sibling and
 * lives once in `@profile-as-code/github` (#224) — both copies had received the
 * same review fixes (F2/F5), so a fix landing in one file would have left the two
 * surfaces deriving different owners for one workspace. What stays genuinely
 * per-surface, and is declared here: which platforms can name this surface, the
 * URL template and the fetch allowlist.
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
 * The workspace is untrusted input, so the pass validates the derived URL's host
 * against this list BEFORE any request. v1 reads the raw README back, which is
 * served from the raw host — not the `github.com` deploy host of
 * `platforms/registry.yaml`.
 */
export const fetchHosts: readonly string[] = ["raw.githubusercontent.com"];

/** The link platforms that can name THIS surface. `identity.links[].platform` is
 *  a free string (the schema does not tie it to `$defs/platform`), so the
 *  fixture convention `github` plus this surface's own slug are matched by name —
 *  and a SIBLING surface's slug is not: a `github-readme` page link names the
 *  personal profile README repo, and accepting it would derive an org URL that is
 *  certainly wrong (a permanent `unverifiable` recorded as evidence). */
const GITHUB_LINK_PLATFORMS = new Set(["github", "github-org"]);

/** Resolve the org from the URL SSOT (§15.4/§18.4) — never from a new
 *  hand-maintained field. The rule (links first, claimed handles second, the slug
 *  shape, the `orgs/` route) lives ONCE, in `@profile-as-code/github` (#224), where
 *  its rationale and its regressions are recorded; what this line binds is the one
 *  per-surface input it takes, this surface's platform set. Exported so the shared
 *  conformance body can prove the binding instead of trusting it. */
export const githubOwner = createGithubOwnerResolver({
  surface: "github-org",
  linkPlatforms: GITHUB_LINK_PLATFORMS,
});

/**
 * §19.5: the URL of the artifact this surface publishes, derived from the URL
 * SSOT. A GitHub org's profile README lives in the org's `.github` repo at
 * `profile/README.md`, on the org's default branch — `HEAD` resolves that branch,
 * so no branch is hand-maintained (SPEC §19.5: "never a new hand-maintained
 * field"; measured 2026-10-12: `raw.githubusercontent.com/nodejs/.github/HEAD/
 * profile/README.md` → 200 [BENCHMARK]).
 *
 * `null` when the workspace declares no GitHub org surface: that is the declared
 * `no-artifact-url` rung, never an error (§19.5 row 2) — and never a request.
 */
export function artifactUrl(profile: Profile): string | null {
  const org = githubOwner(profile);
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
