/**
 * The chosen-variant body store (#238).
 *
 * `active` (D11) records the choice; the body is workspace input beside the
 * generated output, at `profiles/<platform>/variants/<id>.md`. The skill's
 * playbook defines that file as a COMPLETE platform artifact (a full README for
 * github-readme), not a prose fragment: `pasco build` writes it verbatim as the
 * platform artifact when the active variant matches the build lang. One home
 * for the id/path/read rules, shared by `build` and `status`.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PlatformProfile } from "@profile-as-code/core";

const SAFE_VARIANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A variant id is a single, traversal-free path segment. */
export function isSafeVariantId(id: string): boolean {
  return SAFE_VARIANT_ID.test(id) && !id.includes("..");
}

export function variantBodyPath(workspace: string, platform: string, variantId: string): string {
  return join(workspace, "profiles", platform, "variants", `${variantId}.md`);
}

/** A body exists, is a regular file, and is non-empty. A directory or an empty
 *  file is NOT a body — `validate` and `build` must agree on that. */
export function hasVariantBody(workspace: string, platform: string, variantId: string): boolean {
  if (!isSafeVariantId(variantId)) return false;
  try {
    const path = variantBodyPath(workspace, platform, variantId);
    if (!statSync(path).isFile()) return false;
    return readFileSync(path, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

export interface VariantBody {
  id?: string;
  text?: string;
  warning?: string;
}

/**
 * Resolve the active body for a slice. The body is a complete artifact and is
 * returned verbatim; the caller writes it instead of the deterministic render.
 * Missing/empty/mismatched bodies fall back to the deterministic render.
 */
export function resolveVariantBody(workspace: string, slice: PlatformProfile): VariantBody {
  const active = slice.active;
  if (active === undefined) return {};
  const id = active.variantId;
  if (!isSafeVariantId(id)) {
    return {
      warning: `active variant id ${JSON.stringify(id)} is not a safe path segment — deterministic fallback`,
    };
  }
  if (active.lang !== slice.lang) {
    return {
      warning: `active variant ${id} is for ${active.lang}, building ${slice.lang} — deterministic fallback`,
    };
  }
  const path = variantBodyPath(workspace, slice.platform, id);
  try {
    if (!statSync(path).isFile()) {
      return {
        warning: `active variant ${id} at ${path} is not a regular file — deterministic fallback`,
      };
    }
    const text = readFileSync(path, "utf8");
    if (text.trim() === "") {
      return { warning: `active variant ${id} is empty at ${path} — deterministic fallback` };
    }
    return { id, text };
  } catch {
    return { warning: `active variant ${id} has no body at ${path} — deterministic fallback` };
  }
}
