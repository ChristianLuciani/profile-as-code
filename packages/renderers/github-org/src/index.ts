/**
 * Renderer `github-org` (M6, brand flavor) — SPEC §17.
 *
 * Deterministic org README for a brand workspace (`flavor: brand`): same input →
 * same bytes. No network, no AI, no randomness. Facts pass through untouched from
 * the SSOT; texts are the platform+lang slice with en-fallback (compile already
 * filtered bios/headlines by exact lang; brand langMaps fall back to en here).
 *
 * Output sections: header (org name + tagline + mission) · social handles
 * (claimed matrix, one badge per platform) · newsletter · podcast · press ·
 * audiences (reader profile) · every link (visible list) · JSON-LD Organization
 * assembled by core (`structured-data.ts`: `@id` from the `role: identity` link,
 * `sameAs` from the `role: realization` links + claimed handles — v1.6/#103) ·
 * generated footer with fact-count.
 */

import type { Lang, PlatformProfile } from "@profile-as-code/core";
import { mdHref, mdText } from "@profile-as-code/markdown";

export const deploySpec = "git" as const;

/**
 * §19.5 live-verification capability (issue #212) — the ONE integration point
 * with the CLI: `pasco status --verify` consumes the renderer's declaration and
 * nothing else crosses the seam (`extractArtifact` · `fetchHosts` ·
 * `artifactUrl`). Declared with the artifact's producer (D5, AGENTS.md rule 7);
 * the projection itself is the shared `@profile-as-code/artifact` bound here to
 * this surface's footer (#216).
 */
export { artifactUrl, extractArtifact, fetchHosts } from "./artifact.js";

export interface RenderResult {
  text: string;
  assets?: string[];
}

export interface RenderOptions {
  lang?: Lang;
}

/** Deterministic badge map for brand handle platforms → shield.io style + name. */
const BADGE: Record<string, { color: string; logo: string; label: string }> = {
  github: { color: "181717", logo: "github", label: "GitHub" },
  "github-org": { color: "181717", logo: "github", label: "GitHub" },
  x: { color: "000000", logo: "X", label: "X" },
  bluesky: { color: "0285FF", logo: "bluesky", label: "Bluesky" },
  substack: { color: "FF6719", logo: "substack", label: "Substack" },
  instagram: { color: "E4405F", logo: "instagram", label: "Instagram" },
  tiktok: { color: "000000", logo: "tiktok", label: "TikTok" },
  youtube: { color: "FF0000", logo: "youtube", label: "YouTube" },
  spotify: { color: "1DB954", logo: "spotify", label: "Spotify" },
  reddit: { color: "FF4500", logo: "reddit", label: "Reddit" },
  mastodon: { color: "6364FF", logo: "mastodon", label: "Mastodon" },
  soundcloud: { color: "FF3300", logo: "soundcloud", label: "SoundCloud" },
  website: { color: "111111", logo: "internetarchive", label: "Website" },
};

function hostnamePath(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

function pickText(map: Record<string, string> | undefined, lang: Lang): string | undefined {
  if (map === undefined) return undefined;
  // Issue #84 (option (a) ratified): empty-string values count as ABSENT at
  // both lookup levels — a lang-specific "" falls back to en, an empty en is
  // no text. Byte-parity: populated workspaces unchanged.
  return map[lang] || map.en || undefined;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function render(p: PlatformProfile, opts: RenderOptions = {}): RenderResult {
  const lang = opts.lang ?? p.lang;
  // The structured data was assembled by `compile()` at its OWN lang, so an override here
  // would desync it from the header (v1.6 review, F2). No in-repo caller overrides, but a
  // silent mismatch is worse than a loud one: say it once, where the override happens.
  if (opts.lang !== undefined && opts.lang !== p.lang && p.structuredData?.jsonLd !== undefined) {
    console.warn(
      `render: opts.lang="${opts.lang}" overrides the compiled lang "${p.lang}" — the JSON-LD was built at "${p.lang}" and will not follow. Re-compile with the target lang for structured data to match.`,
    );
  }
  const out: string[] = [];

  // 1. Header — org name (H1), tagline, mission.
  out.push(`# ${p.identity.name}`);
  const tagline = pickText(p.identity.tagline, lang);
  if (tagline !== undefined) out.push("", `> ${tagline}`);
  const mission = pickText(p.identity.mission, lang);
  if (mission !== undefined) out.push("", `**${mission}**`);
  if (p.identity.logo !== undefined) out.push("", `![logo](${mdHref(p.identity.logo)})`);

  // 2. Social handles — ONE badge per claimed handle platform, in matrix order.
  //    The matrix (socialHandles) IS the canonical surface set for a brand (§17.1);
  //    pending handles are not deployed surfaces yet.
  const claimed = p.socialHandles.filter((h) => h.status === "claimed" && h.url !== undefined);
  if (claimed.length > 0) {
    const badges: string[] = [];
    const seen = new Set<string>();
    for (const h of claimed) {
      if (h.url === undefined || seen.has(h.platform)) continue;
      seen.add(h.platform);
      const b = BADGE[h.platform];
      if (b === undefined) continue;
      // Both destinations are CommonMark: the inner shields.io image src (the
      // brand URL's path is interpolated into it) and the outer handle href
      // (issue #75 — same class as #73).
      const badgeUrl = `https://img.shields.io/badge/${b.label}-${hostnamePath(h.url)}-${b.color}?style=flat&logo=${b.logo}&logoColor=white`;
      badges.push(`[![${b.label}](${mdHref(badgeUrl)})](${mdHref(h.url)})`);
    }
    if (badges.length > 0) out.push("", badges.join(" "));
  }

  // 3. Newsletter (Substack/Ghost) — the brand's own surface.
  if (p.newsletter !== undefined) {
    out.push("", "## Newsletter");
    const name = pickText(p.newsletter.name, lang);
    const desc = pickText(p.newsletter.description, lang);
    // Issue #86 (F2, plain-string empty = absent): cadence has no minLength in the
    // schema and "" interpolated raw produced a trailing ` · ` separator. Exact
    // empty-string rule (no trim — whitespace-only stays data), byte-parity for
    // populated cadences.
    const cadence = p.newsletter.cadence ? ` · ${p.newsletter.cadence}` : "";
    out.push(
      "",
      `- **${name ?? hostnamePath(p.newsletter.url)}** ([${mdText(hostnamePath(p.newsletter.url))}](${mdHref(p.newsletter.url)}))${cadence}`,
    );
    if (desc !== undefined) out.push(`  - ${desc}`);
  }

  // 4. Podcast (Spotify/RSS).
  if (p.podcast !== undefined) {
    out.push("", "## Podcast");
    const title = pickText(p.podcast.title, lang) ?? "(untitled)";
    const desc = pickText(p.podcast.description, lang);
    const status = p.podcast.status !== undefined ? ` · \`${p.podcast.status}\`` : "";
    out.push("", `- **${title}**${status}`);
    if (p.podcast.url !== undefined)
      out.push(`  - [${mdText(hostnamePath(p.podcast.url))}](${mdHref(p.podcast.url)})`);
    if (p.podcast.rss !== undefined)
      out.push(`  - RSS: [${mdText(hostnamePath(p.podcast.rss))}](${mdHref(p.podcast.rss)})`);
    if (desc !== undefined) out.push(`  - ${desc}`);
  }

  // 5. Press — media mentions (dated, resolvable = verifiable claims, §8).
  if (p.press.length > 0) {
    out.push("", "## Press");
    for (const item of p.press) {
      const outlet =
        typeof item.outlet === "string" ? item.outlet : (pickText(item.outlet, lang) ?? "?");
      const title = pickText(item.title, lang) ?? "?";
      out.push("", `- **${title}** — ${outlet}, ${item.date}. ([link](${mdHref(item.url)}))`);
    }
  }

  // 6. Audiences — reader profile (brand), not recruiter.
  const audienceEntries = Object.entries(p.brandAudiences);
  if (audienceEntries.length > 0) {
    out.push("", "## For readers");
    for (const [name, angle] of audienceEntries) out.push("", `- **${name}**: ${angle}`);
  }

  // 7. Links (every channel, for humans) + JSON-LD Organization (from core).
  // Contact email (v1.5, issue #71): a fact, output-only — links[] stays
  // page-URLs-only (a mailto: URI is never here). Emitted first.
  // NB: this is the VISIBLE list (all links); `sameAs` in the structured data is a
  // narrower set — only role: realization — resolved by core (v1.6/#103).
  const visibleLinks = [
    ...(p.identity.links ?? []).map((l) => l.url),
    ...claimed.map((h) => h.url as string),
  ].filter((url, index, all) => all.indexOf(url) === index);
  if (visibleLinks.length > 0 || p.identity.email !== undefined) {
    const rows: string[] = [];
    if (p.identity.email !== undefined) rows.push(`- mailto:${p.identity.email}`);
    rows.push(...visibleLinks.map((url) => `- ${url}`));
    out.push("", "## Links", ...rows);
  }

  // The entity's structured data comes from core (v1.6/#103) — this renderer NEVER
  // re-derives `@id`/`sameAs` (SPEC §15.4; the §18.9 credentialLdEntries precedent).
  // Note the two sets are now DIFFERENT and both are correct: the visible Links
  // section above lists every channel (a human wants them all), while `sameAs`
  // carries only `role: realization` links — including an aggregator there would
  // blur the hierarchy schema.org defines.
  // `structuredData` is REQUIRED on PlatformProfile, but a hand-built slice (the documented
  // seam) may omit it: guard the whole chain, not just `jsonLd`, so a partial slice renders
  // without structured data instead of throwing.
  if (p.structuredData?.jsonLd !== undefined) {
    out.push(
      "",
      "<!-- JSON-LD (schema.org Organization) -->",
      "```json",
      JSON.stringify(p.structuredData.jsonLd, null, 2),
      "```",
    );
  }

  // 8. Footer — deterministic marker + fact count (for diff/CI assertions, §15.3).
  const pendingCount = p.socialHandles.filter((h) => h.status === "pending").length;
  out.push(
    "",
    `<!-- generated by profile-as-code pasco build github-org · ${plural(claimed.length, "claimed surface")} · ${pendingCount} pending · ${plural(p.press.length, "press mention")} -->`,
  );

  return { text: `${out.join("\n")}\n` };
}
