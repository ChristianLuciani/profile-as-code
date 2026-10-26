/**
 * The artifact DECISION TREE, one home: active variant (#238) → renderer →
 * shared paste source (#150). `build` writes the resulting text; `edit --check`
 * previews it. Two callers, one rule — the premerge review of #331 (N1/N9)
 * measured what a second copy costs: `edit` missed build's selection-error gate
 * and could print a "published" surface that `build` refuses to write.
 */

import type { MediaAsset, PlatformProfile } from "@profile-as-code/core";
import { PASTE_LENGTH_PRIORITY, pasteSource } from "@profile-as-code/paste";
import { RENDERERS } from "./generated/renderers.gen.js";
import { resolveVariantBody } from "./variant-store.js";

export interface RenderedArtifact {
  text: string;
  source: "variant" | "renderer" | "paste";
  variantId?: string;
  /** Non-fatal workspace finding from the variant store (`build` warns). */
  warning?: string;
  /** Deploy-relative asset targets the renderer references (M8/§18.6); empty for
   *  variant and paste artifacts, which reference no bundle entries. */
  assets?: readonly string[];
}

/** Which bio the shared paste source publishes, or `undefined` when it has none. */
export function publishedBio(slice: PlatformProfile) {
  for (const length of PASTE_LENGTH_PRIORITY) {
    const row = slice.bios.find((bio) => bio.length === length);
    if (row !== undefined) return row;
  }
  return undefined;
}

export function renderArtifact(
  slice: PlatformProfile,
  workspace: string,
  assets: readonly MediaAsset[],
): RenderedArtifact {
  const variant = resolveVariantBody(workspace, slice);
  const warning = variant.warning === undefined ? {} : { warning: variant.warning };
  if (variant.text !== undefined && variant.id !== undefined) {
    return { text: variant.text, source: "variant", variantId: variant.id, ...warning };
  }
  const renderer = RENDERERS[slice.platform];
  if (renderer === undefined) return { text: pasteSource(slice), source: "paste", ...warning };
  const result = renderer(slice, assets);
  return { text: result.text, source: "renderer", assets: result.assets ?? [], ...warning };
}
