/**
 * The workspace-side reconciliation of `driftCheck` (#238) — ONE home.
 *
 * A variant-only surface (#238) is backed by the chosen body in the variants
 * store; the core drift check cannot see workspace files, so it reports
 * `drift/active-variant-missing` for a surface that IS backed. `validate` filters
 * that code when `hasVariantBody` says the body exists, and `audit` composes the
 * same answer: an audit that skipped the filter would FAIL a workspace
 * `validate` calls healthy, which is the one thing the two commands must not
 * disagree on.
 *
 * Not re-implemented per caller: the reconciliation is a rule (which codes the
 * workspace can resolve), so a second copy would drift the moment the variant
 * store grows another shape.
 */

import type { Issue, LoadedProfile } from "@profile-as-code/core";
import { driftCheck } from "@profile-as-code/core";
import { hasVariantBody } from "./variant-store.js";

/** `driftCheck(profile)` with the variant-store reconciliation `validate` applies. */
export function reconciledDrift(workspace: string, profile: LoadedProfile): Issue[] {
  return driftCheck(profile).filter((issue) => {
    if (issue.code !== "drift/active-variant-missing") return true;
    const platform = issue.surfaces?.[0];
    if (platform === undefined) return true;
    const active = profile.active?.[platform];
    if (active === undefined) return true;
    return !hasVariantBody(workspace, platform, active.variantId);
  });
}
