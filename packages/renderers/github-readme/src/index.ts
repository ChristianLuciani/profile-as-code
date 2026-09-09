/**
 * Renderer `github-readme` (M2) — SPEC §15.
 *
 * Pure function of a PlatformProfile (compile() slice): same input → same bytes
 * (byte-stable, §15.1). No network, no AI, no randomness. Facts pass through
 * untouched from the SSOT; texts are the platform+lang slice with en-fallback
 * for langMaps (compile already filtered bios/headlines by exact lang).
 *
 * Output sections (§15.3): header (name + headline + identity badges) ·
 * statement · featured projects (ordered by github-readme skill weight) ·
 * publications (DOI-resolvable) · skills (weight order) · links (sameAs) ·
 * evidence registry (v1.4/D17/§18: credentials + artifacts, `public` only —
 * §18.5; `path` locators never emit a URL, §18.3 capability matrix) ·
 * JSON-LD Person (with hasCredential, §18.9) · generated footer with fact-count.
 */

import { credentialLdEntries, isPublicEntry } from '@profile-as-code/core';
import type { Artifact, Credential, Lang, PlatformProfile, Project, Skill } from '@profile-as-code/core';

export const deploySpec = 'git' as const;

export interface RenderResult {
  text: string;
  assets?: string[];
}

export interface RenderOptions {
  lang?: Lang;
}

/** Deterministic credential row: **Title** (kind) — issuer, years · [verify](url). */
function credentialLine(c: Credential): string {
  const years = c.issued !== undefined ? `, ${c.issued.slice(0, 4)}${c.expires !== undefined ? `–${c.expires.slice(0, 4)}` : ''}` : '';
  const verify = c.verifyUrl !== undefined ? ` · [verify](${c.verifyUrl})` : '';
  return `- **${c.title}** (${c.kind}) — ${c.issuer}${years}${verify}`;
}

/** Deterministic artifact row — capability matrix (§18.3): `url` locators link
 *  verbatim (URL SSOT); `path` locators NEVER emit a public URL (D14 — the work
 *  reaches public surfaces only via renderer assets/ output, M8). */
function artifactLine(a: Artifact, lang: Lang): string {
  const desc = pickText(a.description, lang);
  const license = a.license !== undefined ? ` · ${a.license}` : '';
  const link = a.locator.url !== undefined ? ` — [${hostname(a.locator.url)}](${a.locator.url})` : '';
  return `- **${a.title}** (${a.kind})${link}${license}${desc !== undefined ? ` — ${desc}` : ''}`;
}

/** Deterministic badge map: platform → shield.io style + display name. */
const BADGE: Record<string, { color: string; logo: string; label: string }> = {
  github: { color: '181717', logo: 'github', label: 'GitHub' },
  linkedin: { color: '0A66C2', logo: 'linkedin', label: 'LinkedIn' },
  x: { color: '000000', logo: 'X', label: 'X' },
  orcid: { color: 'A6CE39', logo: 'orcid', label: 'ORCID' },
  substack: { color: 'FF6719', logo: 'substack', label: 'Substack' },
  researchgate: { color: '00CCBB', logo: 'researchgate', label: 'ResearchGate' },
  scholar: { color: '4285F4', logo: 'googlescholar', label: 'Scholar' },
  website: { color: '111111', logo: 'github', label: 'Website' },
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

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

/** github-readme weight of a skill (missing → 0). */
function skillWeight(s: Skill): number {
  return s.platformWeights?.['github-readme'] ?? 0;
}

/**
 * Featured-project ordering (SPEC §15.3): the best github-readme skill weight
 * among skills sharing at least one keyword OR geoKeyword with the project
 * (geoKeywords = the GEO match surface, D7). Deterministic: weight desc,
 * then name asc.
 */
function projectWeight(p: Project, skills: readonly Skill[]): number {
  const pk = new Set((p.keywords ?? []).map((k) => k.toLowerCase().trim()));
  if (pk.size === 0) return 0;
  let best = 0;
  for (const s of skills) {
    const sk = new Set([...(s.keywords ?? []), ...(s.geoKeywords ?? [])].map((k) => k.toLowerCase().trim()));
    if ([...pk].some((k) => sk.has(k))) best = Math.max(best, skillWeight(s));
  }
  return best;
}

export function render(p: PlatformProfile, opts: RenderOptions = {}): RenderResult {
  const lang = opts.lang ?? p.lang;
  const out: string[] = [];

  // 1. Header — name, headline (exact lang; compile already filtered), badges.
  out.push(`# ${p.identity.name}`);
  const headline = p.headlines.find((h) => h.lang === lang);
  if (headline !== undefined) out.push('', `### ${headline.text}`);

  // Badges: ONE per platform, in identity.links order — the canonical profile
  // links first (project/repo links share the github platform but are not
  // badges; they live in Projects/Links sections).
  const seenBadge = new Set<string>();
  const badges: string[] = [];
  for (const l of p.identity.links ?? []) {
    if (l.platform === undefined) continue;
    if (seenBadge.has(l.platform)) continue;
    const b = BADGE[l.platform];
    if (b === undefined) continue;
    seenBadge.add(l.platform);
    badges.push(`[![${b.label}](https://img.shields.io/badge/${b.label}-${hostname(l.url)}-${b.color}?style=flat&logo=${b.logo}&logoColor=white)](${l.url})`);
  }
  if (badges.length > 0) out.push('', badges.join(' '));

  // 2. Statement.
  if (p.statement !== undefined) out.push('', `**${p.statement}**`);

  // 3. Featured projects — top 6 by weight (§15.3), all if fewer.
  const projects = [...p.projects].sort(
    (a, b) => projectWeight(b, p.skills) - projectWeight(a, p.skills) || a.name.localeCompare(b.name),
  );
  if (projects.length > 0) {
    out.push('', '## Projects');
    for (const project of projects.slice(0, 6)) {
      const desc = pickText(project.description, lang);
      out.push('', `- **${project.name}** · \`${project.status}\`${desc !== undefined ? ` — ${desc}` : ''}`);
      for (const link of project.links ?? []) out.push(`  - [${hostnamePath(link)}](${link})`);
      for (const ev of project.evidence ?? []) {
        const claim = pickText(ev.claim, lang);
        if (claim !== undefined) out.push(`  - Evidence: ${claim} ([source](${ev.source}))`);
      }
    }
  }

  // 4. Publications — DOI/ORCID-resolvable (the GEO anchor).
  if (p.publications.length > 0) {
    out.push('', '## Publications');
    for (const pub of p.publications) {
      const doi = pub.doi !== undefined ? ` [DOI: ${pub.doi}](https://doi.org/${pub.doi})` : '';
      out.push('', `- **${pub.title}** — ${pub.venue}, ${pub.year}.${doi}`);
    }
  }

  // 5. Skills — weight order for this platform.
  const skills = [...p.skills].sort((a, b) => skillWeight(b) - skillWeight(a) || a.name.localeCompare(b.name));
  if (skills.length > 0) {
    out.push('', '## Skills');
    for (const s of skills) {
      const keywords = (s.keywords ?? []).join(', ');
      out.push('', `- **${s.name}** (${s.level})${keywords !== '' ? `: ${keywords}` : ''}`);
    }
  }

  // 6. Evidence registry (v1.4/D17/§18) — public entries only (§18.5), compact.
  const credentials = (p.credentials ?? []).filter(isPublicEntry);
  const artifacts = (p.artifacts ?? []).filter(isPublicEntry);
  if (credentials.length > 0) {
    out.push('', '## Credentials');
    for (const c of credentials) out.push('', credentialLine(c));
  }
  if (artifacts.length > 0) {
    out.push('', '## Artifacts');
    for (const a of artifacts) out.push('', artifactLine(a, lang));
  }

  // 7. Links (sameAs) + JSON-LD Person (with hasCredential, §18.9).
  out.push('', '## Links');
  for (const l of p.identity.links ?? []) out.push('', `- [${l.label}](${l.url})`);

  const publicCredentials = credentialLdEntries(credentials);
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: p.identity.name,
  };
  if (p.identity.photo !== undefined) jsonLd.image = p.identity.photo;
  if (p.identity.location !== undefined) jsonLd.address = p.identity.location;
  jsonLd.sameAs = (p.identity.links ?? []).map((l) => l.url);
  if (publicCredentials.length > 0) jsonLd.hasCredential = publicCredentials;
  out.push('', '<!-- JSON-LD (schema.org Person) -->', '```json', JSON.stringify(jsonLd, null, 2), '```');

  // 8. Footer — deterministic marker + fact count (for diff/CI assertions, §15.3).
  out.push(
    '',
    `<!-- generated by profile-as-code pasco build github-readme · ${plural(projects.length, 'project')} · ${plural(p.publications.length, 'publication')} -->`,
  );

  return { text: out.join('\n') + '\n' };
}
