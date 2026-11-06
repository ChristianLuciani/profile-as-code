/**
 * Renderer `substack` (issue #483) — the Substack profile + publication paste
 * sheet. Substack has no public body-write API (SOTA-2026 §5): `deploy: manual`
 * is the declared contract (D9) and the artifact IS the field-by-field paste
 * source, so `pasco status --mark` records the deploy in the D18 ledger.
 *
 * One artifact, two identity-bearing bodies (SOTA-2026 §9): the profile header
 * (handle, display name, short bio) and the publication copy (name, short
 * description, cadence, canonical URL), plus the About body (the `long` bio)
 * and the SSOT link set. D1 keeps it ONE sheet: splitting profile/About would
 * need a sub-surface the engine does not model.
 *
 * Deterministic: same input → same bytes (SPEC §15.1). No network, no AI, no
 * randomness, no timestamp. Facts pass through untouched from the SSOT; bios
 * are already the platform+lang slice (`compile()` filters them EXACTLY — no
 * en fallback), while `newsletter.name`/`description` arrive as RAW langMaps and
 * are resolved with core's `textOf(..., p.lang)` (#415), which owns the
 * es→en fallback. Re-implementing that fallback here would be a second rule.
 *
 * `pasco build` UNBUILDS on the empty render (§15.1): a workspace with no
 * substack bio row AND no `newsletter` block leaves no artifact on disk.
 */

import type { PlatformProfile } from "@profile-as-code/core";
import { textOf } from "@profile-as-code/core";

/** SPEC §7 Renderer contract (`deploySpec: 'git' | 'api' | 'manual'`). Substack
 *  has no public write API for the profile body or the publication copy, so the
 *  deploy is a MANUAL paste and `pasco status --mark` records it (D18 ledger,
 *  `source: manual`). */
export const deploySpec = "manual" as const;

export interface RenderResult {
  text: string;
  assets?: string[];
}

/**
 * One `Field: value` line, or `undefined` when the SSOT carries no value. The
 * omission is deliberate (SOTA-2026 §9): a sheet with an empty field would ask
 * the operator to erase a placeholder at paste time, and a placeholder would
 * become a fact nobody declared.
 */
function field(label: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : `${label}: ${trimmed}`;
}

/**
 * The Substack handle, without the `@` the SSOT stores. A claimed substack
 * `socialHandles` row is the exact surface handle; `identity.handle` is the
 * generic primary handle and is the documented fallback (SOTA-2026 §7). The
 * leading `@` is stripped because the sheet prints it once (`Handle: @…`) and
 * the UI shows the handle without it.
 */
function handleOf(p: PlatformProfile): string | undefined {
  const claimed = p.socialHandles.find(
    (entry) =>
      entry.platform === "substack" && entry.status === "claimed" && entry.handle.trim() !== "",
  );
  const raw = claimed?.handle ?? p.identity.handle;
  if (raw === undefined) return undefined;
  const handle = raw.trim().replace(/^@+/, "");
  return handle === "" ? undefined : handle;
}

/**
 * Every URL from `identity.links` (the ONE URL home, SPEC §15.4), in
 * declaration order, on one line — the Substack profile edit screen has one
 * links field. No handle-derived URL, no newsletter URL duplication: those are
 * already their own lines when the SSOT declares them.
 */
function linksOf(p: PlatformProfile): string | undefined {
  const urls = (p.identity.links ?? []).map((link) => link.url.trim()).filter((url) => url !== "");
  return urls.length === 0 ? undefined : urls.join(" · ");
}

/**
 * Render the paste sheet from the compile() slice.
 *
 * A workspace with no substack bio row AND no `newsletter` block yields `""`
 * (unbuild, §15.1) — the sheet would carry only the derived header, which is
 * not a deployable artifact. Either body alone is enough: a publication can
 * exist without a curated bio, and a profile without a publication is the
 * pre-#483 shape.
 */
export function render(p: PlatformProfile): RenderResult {
  if (p.bios.length === 0 && p.newsletter === undefined) return { text: "" };

  const newsletter = p.newsletter;
  const handle = handleOf(p);
  const lines = [
    `# Substack — ${p.identity.name} (${p.lang})`,
    field("Handle", handle === undefined ? undefined : `@${handle}`),
    field("Display name", p.identity.name),
    field("Bio (profile)", p.bios.find((bio) => bio.length === "short")?.text),
    field("About", p.bios.find((bio) => bio.length === "long")?.text),
    field("Links", linksOf(p)),
    field("Publication", newsletter === undefined ? undefined : textOf(newsletter.name, p.lang)),
    field(
      "Short description",
      newsletter === undefined ? undefined : textOf(newsletter.description, p.lang),
    ),
    field("Cadence", newsletter?.cadence),
    field("Canonical", newsletter?.url),
  ].filter((line): line is string => line !== undefined);

  return { text: `${lines.join("\n")}\n` };
}
