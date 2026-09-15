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
 * audiences (reader profile) · links + JSON-LD Organization (sameAs = identity
 * links + claimed handle urls, §17.1) · generated footer with fact-count.
 */

import { credentialLdEntries, type Lang, type PlatformProfile } from '@profile-as-code/core';

export const deploySpec = 'git' as const;

export interface RenderResult {
  text: string;
  assets?: string[];
}

export interface RenderOptions {
  lang?: Lang;
}

/** Deterministic badge map for brand handle platforms → shield.io style + name. */
const BADGE: Record<string, { color: string; logo: string; label: string }> = {
  github: { color: '181717', logo: 'github', label: 'GitHub' },
  'github-org': { color: '181717', logo: 'github', label: 'GitHub' },
  x: { color: '000000', logo: 'X', label: 'X' },
  bluesky: { color: '0285FF', logo: 'bluesky', label: 'Bluesky' },
  substack: { color: 'FF6719', logo: 'substack', label: 'Substack' },
  instagram: { color: 'E4405F', logo: 'instagram', label: 'Instagram' },
  tiktok: { color: '000000', logo: 'tiktok', label: 'TikTok' },
  youtube: { color: 'FF0000', logo: 'youtube', label: 'YouTube' },
  spotify: { color: '1DB954', logo: 'spotify', label: 'Spotify' },
  reddit: { color: 'FF4500', logo: 'reddit', label: 'Reddit' },
  mastodon: { color: '6364FF', logo: 'mastodon', label: 'Mastodon' },
  soundcloud: { color: 'FF3300', logo: 'soundcloud', label: 'SoundCloud' },
  website: { color: '111111', logo: 'internetarchive', label: 'Website' },
};

function hostnamePath(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

function pickText(map: Record<string, string> | undefined, lang: Lang): string | undefined {
  if (map === undefined) return undefined;
  return map[lang] ?? map.en;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function render(p: PlatformProfile, opts: RenderOptions = {}): RenderResult {
  const lang = opts.lang ?? p.lang;
  const out: string[] = [];

  // 1. Header — org name (H1), tagline, mission.
  out.push(`# ${p.identity.name}`);
  const tagline = pickText(p.identity.tagline, lang);
  if (tagline !== undefined) out.push('', `> ${tagline}`);
  const mission = pickText(p.identity.mission, lang);
  if (mission !== undefined) out.push('', `**${mission}**`);
  if (p.identity.logo !== undefined) out.push('', `![logo](${p.identity.logo})`);

  // 2. Social handles — ONE badge per claimed handle platform, in matrix order.
  //    The matrix (socialHandles) IS the canonical surface set for a brand (§17.1);
  //    pending handles are not deployed surfaces yet.
  const claimed = p.socialHandles.filter((h) => h.status === 'claimed' && h.url !== undefined);
  if (claimed.length > 0) {
    const badges: string[] = [];
    const seen = new Set<string>();
    for (const h of claimed) {
      if (h.url === undefined || seen.has(h.platform)) continue;
      seen.add(h.platform);
      const b = BADGE[h.platform];
      if (b === undefined) continue;
      badges.push(`[![${b.label}](https://img.shields.io/badge/${b.label}-${hostnamePath(h.url)}-${b.color}?style=flat&logo=${b.logo}&logoColor=white)](${h.url})`);
    }
    if (badges.length > 0) out.push('', badges.join(' '));
  }

  // 3. Newsletter (Substack/Ghost) — the brand's own surface.
  if (p.newsletter !== undefined) {
    out.push('', '## Newsletter');
    const name = pickText(p.newsletter.name, lang);
    const desc = pickText(p.newsletter.description, lang);
    out.push('', `- **${name ?? hostnamePath(p.newsletter.url)}** ([${hostnamePath(p.newsletter.url)}](${p.newsletter.url}))${p.newsletter.cadence !== undefined ? ` · ${p.newsletter.cadence}` : ''}`);
    if (desc !== undefined) out.push(`  - ${desc}`);
  }

  // 4. Podcast (Spotify/RSS).
  if (p.podcast !== undefined) {
    out.push('', '## Podcast');
    const title = pickText(p.podcast.title, lang) ?? '(untitled)';
    const desc = pickText(p.podcast.description, lang);
    const status = p.podcast.status !== undefined ? ` · \`${p.podcast.status}\`` : '';
    out.push('', `- **${title}**${status}`);
    if (p.podcast.url !== undefined) out.push(`  - [${hostnamePath(p.podcast.url)}](${p.podcast.url})`);
    if (p.podcast.rss !== undefined) out.push(`  - RSS: [${hostnamePath(p.podcast.rss)}](${p.podcast.rss})`);
    if (desc !== undefined) out.push(`  - ${desc}`);
  }

  // 5. Press — media mentions (dated, resolvable = verifiable claims, §8).
  if (p.press.length > 0) {
    out.push('', '## Press');
    for (const item of p.press) {
      const outlet = typeof item.outlet === 'string' ? item.outlet : pickText(item.outlet, lang) ?? '?';
      const title = pickText(item.title, lang) ?? '?';
      out.push('', `- **${title}** — ${outlet}, ${item.date}. ([link](${item.url}))`);
    }
  }

  // 6. Audiences — reader profile (brand), not recruiter.
  const audienceEntries = Object.entries(p.brandAudiences);
  if (audienceEntries.length > 0) {
    out.push('', '## For readers');
    for (const [name, angle] of audienceEntries) out.push('', `- **${name}**: ${angle}`);
  }

  // 7. Links (sameAs) + JSON-LD Organization.
  // Contact email (v1.5, issue #71): a fact, output-only — links[] stays
  // page-URLs-only (sameAs never carries a mailto: URI). Emitted first.
  const sameAs = [
    ...(p.identity.links ?? []).map((l) => l.url),
    ...claimed.map((h) => h.url as string),
  ].filter((url, index, all) => all.indexOf(url) === index);
  if (sameAs.length > 0 || p.identity.email !== undefined) {
    const rows: string[] = [];
    if (p.identity.email !== undefined) rows.push(`- mailto:${p.identity.email}`);
    rows.push(...sameAs.map((url) => `- ${url}`));
    out.push('', '## Links', ...rows);
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: p.identity.name,
  };
  if (p.identity.email !== undefined) jsonLd.email = p.identity.email;
  if (p.identity.logo !== undefined) jsonLd.logo = p.identity.logo;
  if (p.identity.established !== undefined) jsonLd.foundingDate = p.identity.established;
  if (tagline !== undefined) jsonLd.slogan = tagline;
  if (mission !== undefined) jsonLd.description = mission;
  jsonLd.sameAs = sameAs;
  // §18.9 (D17): the brand flavor gets the same GEO payoff — Organization surfaces
  // carry hasCredential too (ISO certifications, awards). credentialLdEntries
  // filters internally (§18.5 — public only); absent → the key is not emitted.
  const publicCredentials = credentialLdEntries(p.credentials ?? []);
  if (publicCredentials.length > 0) jsonLd.hasCredential = publicCredentials;
  out.push('', '<!-- JSON-LD (schema.org Organization) -->', '```json', JSON.stringify(jsonLd, null, 2), '```');

  // 8. Footer — deterministic marker + fact count (for diff/CI assertions, §15.3).
  const pendingCount = p.socialHandles.filter((h) => h.status === 'pending').length;
  out.push(
    '',
    `<!-- generated by profile-as-code pasco build github-org · ${plural(claimed.length, 'claimed surface')} · ${pendingCount} pending · ${plural(p.press.length, 'press mention')} -->`,
  );

  return { text: out.join('\n') + '\n' };
}
