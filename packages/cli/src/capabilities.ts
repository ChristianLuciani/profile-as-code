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
 * This module is the CLI's side of that seam. It is deliberately EMPTY in Lane A
 * (this PR): the extractor + fetch capability is Lane B (issue #212), which lands
 * those exports in `packages/renderers/github-readme` (and `github-org`). With no
 * declaration, `core` derives `unverifiable: no-extractor` for every surface
 * (§19.5 fifth row) — `--verify` still runs, still records its evidence, and
 * still refuses to pretend. Lane A is therefore NOT blocked on Lane B; the one
 * integration point is here.
 *
 * Integration (Lane B, one line per surface):
 *   `github-readme`: { extractor: extractArtifact, fetchHosts, artifactUrl }
 * registered under the platform slug, from the renderer's public exports.
 */

import type { SurfaceCapabilities, SurfaceCapability } from "@profile-as-code/core";

/** surface slug → declared capability. Empty until Lane B (#212) lands the
 *  extractor; a slug absent from this map declares nothing (honest degradation). */
export const SURFACE_CAPABILITIES: SurfaceCapabilities = {};

/** Test/driver seam: capabilities for one surface, or nothing when undeclared. */
export function capabilityOf(surface: string): SurfaceCapability | undefined {
  return SURFACE_CAPABILITIES[surface];
}
