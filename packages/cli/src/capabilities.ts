/**
 * Live-verification capabilities, per surface (SPEC §19.5, issue #132).
 *
 * `pasco status --verify` can only check a surface whose renderer adapter
 * DECLARES how: an `extractArtifact` (platform chrome → the artifact projection
 * the engine owns), a `fetchHosts` allowlist, and an `artifactUrl` derived from
 * the URL SSOT (§15.4/§18.4). Those three live with the artifact's PRODUCER — the
 * renderer adapter (one home, D5); the CLI consumes that declaration and never
 * re-derives it.
 *
 * This module is the CLI's side of that seam, and the ONE integration point
 * between the CLI (Lane A) and the extractors (Lane B, #212): it re-exports the
 * three public exports of each adapter and resolves `artifactUrl` per workspace.
 *
 * PER WORKSPACE, not a static map: `artifactUrl(profile)` reads the URL SSOT
 * (`identity.links`, `socialHandles`), so one derived URL can never be reused
 * across workspaces — the URL names THIS workspace's owner. A surface whose URL
 * the SSOT does not declare is still declared (the extractor exists), with
 * `artifactUrl: null`: that is `core`'s honest `no-artifact-url` rung (§19.5
 * second row), never a guessed URL. A surface absent from the map declares
 * nothing at all — `no-extractor`, the fifth row.
 */

import type { Profile, SurfaceCapabilities, SurfaceCapability } from "@profile-as-code/core";
import {
  artifactUrl as orgArtifactUrl,
  extractArtifact as orgExtractArtifact,
  fetchHosts as orgFetchHosts,
} from "@profile-as-code/renderers-github-org";
import {
  artifactUrl as readmeArtifactUrl,
  extractArtifact as readmeExtractArtifact,
  fetchHosts as readmeFetchHosts,
} from "@profile-as-code/renderers-github-readme";

/** The two surfaces whose producer declares the §19.5 capability today. Each is
 *  registered under its platform slug (D16) — the same key the ledger, the
 *  generated renderer map and `PLATFORMS` use. */
export function capabilitiesOf(profile: Profile): SurfaceCapabilities {
  return {
    "github-readme": {
      extractor: readmeExtractArtifact,
      fetchHosts: readmeFetchHosts,
      artifactUrl: readmeArtifactUrl(profile),
    },
    "github-org": {
      extractor: orgExtractArtifact,
      fetchHosts: orgFetchHosts,
      artifactUrl: orgArtifactUrl(profile),
    },
  };
}

/** Test/driver seam: capabilities for one surface, or nothing when undeclared. */
export function capabilityOf(profile: Profile, surface: string): SurfaceCapability | undefined {
  return capabilitiesOf(profile)[surface];
}
