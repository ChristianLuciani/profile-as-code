/**
 * driftCheck(profile) — factual contradictions across surfaces, WARN semantics (D12).
 *
 * Drift NEVER throws and NEVER fails: it returns an Issue[] of warnings. Schema
 * violations are load()'s job (fail). Facts warn — users may legitimately have
 * different intents per platform, but they should SEE the contradiction (D12, §2).
 *
 * What is checked (deterministic, offline — no platform reads, no text mining):
 *
 *   drift/url-not-in-identity    project link with a platform host not canonicalized
 *                                in identity.links. Evidence[] sources and
 *                                identity.photo are exempt (citations/assets, not
 *                                identity surfaces).
 *   drift/duplicate-identity-link same URL listed twice in identity.links.
 *   drift/date-range-inverted     experience.start > experience.end (end is a date).
 *   drift/duplicate-experience    same role+org with different dates (the same job
 *                                written differently on two surfaces).
 *   drift/duplicate-headline      same platform+lang twice.
 *   drift/duplicate-bio           same platform+lang+length twice.
 *   drift/duplicate-project       same project name twice.
 *   drift/publication-conflict    same title with different year/venue.
 *   drift/publication-duplicate   exact same title+year+venue listed twice.
 *   drift/orcid-conflict          publications carry different ORCIDs.
 *   drift/orcid-mismatch          publication ORCID differs from the identity ORCID
 *                                (the one in identity.links, if any).
 *   drift/active-platform-unknown active key is not one of the 6 platform ids.
 *   drift/active-variant-missing  active entry has no curated bio/headline for its
 *                                platform+lang (the chosen variant has no base).
 *   drift/skill-conflict          same skill name with different levels.
 *   drift/duplicate-handle         same platform listed twice in socialHandles (brand).
 *   drift/handle-claimed-not-linked  a claimed handle has no url and no identity.links entry.
 *   drift/handle-host-mismatch     a handle's url host does not match the platform's hosts
 *                                (offline proxy of handle-consistency; live checks ship in skills).
 *
 * Out of scope for v1 (documented in the PR): free-text mining of bio/headline text
 * (year/date extraction from prose is too fragile), DOI resolvability (network —
 * renderers/skills later), the variants store (active.variantId points there;
 * we only validate the platform+lang base), and live handle reachability (network —
 * the github-org skill's checks.yaml runs `url-live`; drift is deterministic/offline).
 */

import { PLATFORMS } from './types.js';
import type { Bio, Issue, Platform, Profile } from './types.js';

/** Hosts that represent a person's/brand's platform presence. A URL on one of these that
 *  is not in identity.links is an uncanonicalized duplicate (the drift source the
 *  contract rule "URLs only from identity.links" targets). v1.1 adds the brand
 *  surfaces (github-org, bluesky, instagram, tiktok, youtube, spotify, reddit,
 *  mastodon, soundcloud); v1.2 (D16) adds the Postiz-parity set + ghost. The same
 *  host often serves content too (a YouTube demo video in projects.links) — drift
 *  is advisory (severity warn, D12), so over-warnings are safe. Open-ended instance
 *  networks (mastodon/lemmy/nostr beyond the curated entries) stay unflagged — drift
 *  never guesses hosts it can't verify. */
const PLATFORM_HOSTS: readonly string[] = [
  // v1 person
  'github.com',
  'linkedin.com',
  'upwork.com',
  'x.com',
  'twitter.com',
  'researchgate.net',
  'substack.com',
  // v1.1 brand (§17)
  'bsky.app',
  'bluesky.social',
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'open.spotify.com',
  'spotify.com',
  'reddit.com',
  'mastodon.social',
  'soundcloud.com',
  // v1.2 Postiz parity + operator extras (D16)
  'facebook.com',
  'pinterest.com',
  'dribbble.com',
  'medium.com',
  'dev.to',
  'hashnode.dev',
  'wordpress.com',
  't.me',
  'telegram.org',
  'twitch.tv',
  'kick.com',
  'vk.com',
  'warpcast.com',
  'farcaster.xyz',
  'lemmy.ml',
  'lemmy.world',
  'discord.com',
  'discord.gg',
  'slack.com',
  'skool.com',
  'whop.com',
  'business.google.com',
  'threads.net',
  'njump.me',
  'primal.net',
  'moltbook.com',
  'patreon.com',
  'ghost.io',
];

/** Profile URLs that live on SUBDOMAINS of a host (e.g. `user.substack.com`).
 *  Maps platform → the host whose subdomains are platform surfaces. */
const PLATFORM_SUBDOMAIN_HOSTS: Record<string, readonly string[]> = {
  substack: ['substack.com'],
  ghost: ['ghost.io'],
  hashnode: ['hashnode.dev'],
  medium: ['medium.com'],
};

/** Expected URL hosts per brand handle platform — the offline handle-consistency
 *  proxy (`drift/handle-host-mismatch`). Live reachability is the skill's job
 *  (`url-live` in checks.yaml), not drift's. */
const HANDLE_HOSTS: Record<string, readonly string[]> = {
  github: ['github.com'],
  'github-org': ['github.com'],
  x: ['x.com', 'twitter.com'],
  bluesky: ['bsky.app', 'bluesky.social'],
  substack: ['substack.com'],
  patreon: ['patreon.com'],
  instagram: ['instagram.com'],
  'instagram-standalone': ['instagram.com'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com'],
  spotify: ['open.spotify.com', 'spotify.com'],
  reddit: ['reddit.com'],
  mastodon: ['mastodon.social'],
  soundcloud: ['soundcloud.com'],
  facebook: ['facebook.com'],
  'linkedin-page': ['linkedin.com'],
  warpcast: ['warpcast.com', 'farcaster.xyz'],
  lemmy: ['lemmy.ml', 'lemmy.world'],
  discord: ['discord.com', 'discord.gg'],
  slack: ['slack.com'],
  skool: ['skool.com'],
  whop: ['whop.com'],
  pinterest: ['pinterest.com'],
  dribbble: ['dribbble.com'],
  medium: ['medium.com'],
  devto: ['dev.to'],
  hashnode: ['hashnode.dev'],
  wordpress: ['wordpress.com'],
  gmb: ['business.google.com'],
  twitch: ['twitch.tv'],
  threads: ['threads.net'],
  telegram: ['t.me', 'telegram.org'],
  nostr: ['njump.me', 'primal.net', 'iris.to'],
  vk: ['vk.com'],
  kick: ['kick.com'],
  moltbook: ['moltbook.com'],
  ghost: ['ghost.io'],
  // listmonk is self-hosted — no canonical host, any URL allowed (handled by
  // hostMatchesPlatform: unknown key → true).
};

/** True when `host` is a valid host for `platform`'s handle URLs (or the platform
 *  has no registered hosts — then any URL is allowed). Some platforms host profiles
 *  on subdomains (`user.substack.com`, `blog.ghost.io`) — PLATFORM_SUBDOMAIN_HOSTS. */
function hostMatchesPlatform(platform: string, host: string): boolean {
  const hosts = HANDLE_HOSTS[platform];
  if (hosts === undefined) return true;
  if (hosts.includes(host)) return true;
  const subdomainHosts = PLATFORM_SUBDOMAIN_HOSTS[platform];
  if (subdomainHosts?.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  return false;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** Normalize a URL for membership comparison (trailing slashes are not content). */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function isPlatformSurface(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (PLATFORM_HOSTS.includes(host)) return true;
  return Object.values(PLATFORM_SUBDOMAIN_HOSTS)
    .flat()
    .some((h) => host.endsWith(`.${h}`));
}

function warn(code: string, message: string, path: string, surfaces?: Platform[]): Issue {
  return { code, severity: 'warn', message, path, ...(surfaces ? { surfaces } : {}) };
}

const ORCID_PATH = /^\/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\/?$/;

function identityOrcid(profile: Profile): string | undefined {
  for (const link of profile.identity.links ?? []) {
    const host = hostOf(link.url);
    if (host !== 'orcid.org') continue;
    const match = ORCID_PATH.exec(new URL(link.url).pathname);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Map from a normalized key to the index list of entries sharing it. */
function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const key = keyOf(item);
    const bucket = groups.get(key) ?? [];
    bucket.push(index);
    groups.set(key, bucket);
  });
  return groups;
}

export function driftCheck(profile: Profile): Issue[] {
  const issues: Issue[] = [];
  const identity = profile.identity;
  const identityUrls = new Set((identity.links ?? []).map((link) => normalizeUrl(link.url)));
  const push = (issue: Issue) => issues.push(issue);

  // --- identity.links ---------------------------------------------------------
  const links = identity.links ?? [];
  const linkGroups = groupBy(links, (link) => normalizeUrl(link.url));
  for (const [url, indices] of linkGroups) {
    if (indices.length > 1) {
      push(
        warn(
          'drift/duplicate-identity-link',
          `identity.links lists "${url}" ${indices.length} times (indices ${indices.join(', ')})`,
          `identity.links[${indices[0]}]`,
        ),
      );
    }
  }

  // --- projects[].links ⊆ identity.links (canonicalization rule) --------------
  for (const [projectIndex, project] of (profile.projects ?? []).entries()) {
    for (const [linkIndex, url] of (project.links ?? []).entries()) {
      if (isPlatformSurface(url) && !identityUrls.has(normalizeUrl(url))) {
        push(
          warn(
            'drift/url-not-in-identity',
            `URL "${url}" lives on a platform host but is not in identity.links — add it there (contract rule: URLs only from identity.links)`,
            `projects[${projectIndex}].links[${linkIndex}]`,
          ),
        );
      }
    }
  }

  // --- socialHandles: brand handle matrix (v1.1/§17) --------------------------
  // Offline, deterministic — live reachability ships in the github-org skill's
  // checks.yaml (`url-live`), not here (drift is a pure function of the SSOT).
  const handles = profile.socialHandles ?? [];
  if (handles.length > 0) {
    const handleGroups = groupBy(handles, (h) => h.platform);
    for (const [platform, indices] of handleGroups) {
      if (indices.length > 1) {
        push(
          warn(
            'drift/duplicate-handle',
            `socialHandles lists ${indices.length} rows for platform "${platform}" (indices ${indices.join(', ')}) — one row per platform, the handle matrix is the SSOT`,
            `socialHandles[${indices[0]}]`,
          ),
        );
      }
    }
    for (const [index, handle] of handles.entries()) {
      if (handle.status !== 'claimed') continue;
      // A claimed surface must resolve: either the matrix row carries the URL, or
      // identity.links has a URL whose host matches the platform and whose path
      // contains the handle (offline proxy — live reachability is the skill's job).
      const hasOwnUrl = handle.url !== undefined;
      const resolvedElsewhere = (identity.links ?? []).some((link) => {
        const host = hostOf(link.url);
        if (host === undefined || !hostMatchesPlatform(handle.platform, host)) return false;
        const path = new URL(link.url).pathname.toLowerCase();
        const handleLower = handle.handle.toLowerCase().replace(/^@/, '');
        return handleLower.length > 0 && path.includes(handleLower);
      });
      if (!hasOwnUrl && !resolvedElsewhere) {
        push(
          warn(
            'drift/handle-claimed-not-linked',
            `claimed handle @${handle.handle} (${handle.platform}) has no url and no matching identity.links entry — a claimed surface must resolve (handle-claimed rule)`,
            `socialHandles[${index}]`,
          ),
        );
      }
      if (hasOwnUrl && handle.url !== undefined) {
        const host = hostOf(handle.url);
        if (host !== undefined && !hostMatchesPlatform(handle.platform, host)) {
          push(
            warn(
              'drift/handle-host-mismatch',
              `handle @${handle.handle} (${handle.platform}) points at ${host}, expected ${HANDLE_HOSTS[handle.platform]?.join(' or ') ?? 'any'} — handle-consistent violation (offline proxy)`,
              `socialHandles[${index}].url`,
            ),
          );
        }
      }
    }
  }

  // --- experience: start > end, duplicate roles --------------------------------
  const experience = profile.experience ?? [];
  for (const [index, item] of experience.entries()) {
    if (item.end && item.end !== 'present' && item.start > item.end) {
      push(
        warn(
          'drift/date-range-inverted',
          `start (${item.start}) is after end (${item.end}) for "${item.role}" at ${item.org}`,
          `experience[${index}]`,
        ),
      );
    }
  }
  const expGroups = groupBy(experience, (item) => `${item.role.toLowerCase()} @ ${item.org.toLowerCase()}`);
  for (const [key, indices] of expGroups) {
    if (indices.length < 2) continue;
    const dates = indices.map((i) => `${experience[i]?.start}–${experience[i]?.end ?? '?'}`);
    if (new Set(dates).size > 1) {
      push(
        warn(
          'drift/duplicate-experience',
          `the role "${key}" appears ${indices.length} times with different dates (${dates.join('; ')}) — same fact written differently across surfaces`,
          `experience[${indices[0]}]`,
        ),
      );
    }
  }

  // --- bios / headlines: duplicate platform+lang entries -----------------------
  const bios = profile.bios ?? [];
  const bioGroups = groupBy(bios, (b: Bio) => `${b.platform}/${b.lang}/${b.length}`);
  for (const [key, indices] of bioGroups) {
    if (indices.length > 1) {
      push(
        warn(
          'drift/duplicate-bio',
          `more than one bio for ${key} (indices ${indices.join(', ')}) — which one is live?`,
          `bios[${indices[0]}]`,
        ),
      );
    }
  }
  const headlines = profile.headlines ?? [];
  const headlineGroups = groupBy(headlines, (h) => `${h.platform}/${h.lang}`);
  for (const [key, indices] of headlineGroups) {
    if (indices.length > 1) {
      push(
        warn(
          'drift/duplicate-headline',
          `more than one headline for ${key} (indices ${indices.join(', ')})`,
          `headlines[${indices[0]}]`,
        ),
      );
    }
  }

  // --- projects: duplicate names ----------------------------------------------
  const projects = profile.projects ?? [];
  const projectGroups = groupBy(projects, (p) => p.name.toLowerCase());
  for (const [name, indices] of projectGroups) {
    if (indices.length > 1) {
      push(
        warn(
          'drift/duplicate-project',
          `project "${name}" appears ${indices.length} times (indices ${indices.join(', ')})`,
          `projects[${indices[0]}]`,
        ),
      );
    }
  }

  // --- publications: conflicts + duplicates + ORCID ----------------------------
  const publications = profile.publications ?? [];
  const pubGroups = groupBy(publications, (p) => p.title.toLowerCase());
  for (const [title, indices] of pubGroups) {
    if (indices.length < 2) continue;
    const fingerprints = indices.map((i) => {
      const p = publications[i];
      return `${p?.year}/${p?.venue}`;
    });
    if (new Set(fingerprints).size > 1) {
      push(
        warn(
          'drift/publication-conflict',
          `publication "${title}" appears ${indices.length} times with different year/venue (${fingerprints.join('; ')})`,
          `publications[${indices[0]}]`,
        ),
      );
    } else {
      push(
        warn(
          'drift/publication-duplicate',
          `publication "${title}" (${fingerprints[0]}) is listed ${indices.length} times`,
          `publications[${indices[0]}]`,
        ),
      );
    }
  }
  const orcids = new Set<string>();
  for (const pub of publications) if (pub.orcidId) orcids.add(pub.orcidId);
  if (orcids.size > 1) {
    push(
      warn(
        'drift/orcid-conflict',
        `publications use different ORCIDs (${[...orcids].join(', ')}) — an LLM triangulating surfaces finds two people`,
        'publications',
        [...PLATFORMS],
      ),
    );
  }
  const identityOrcidId = identityOrcid(profile);
  if (identityOrcidId) {
    for (const [index, pub] of publications.entries()) {
      if (pub.orcidId && pub.orcidId !== identityOrcidId) {
        push(
          warn(
            'drift/orcid-mismatch',
            `publication[${index}] ORCID ${pub.orcidId} differs from the identity ORCID ${identityOrcidId} (identity.links)`,
            `publications[${index}]`,
          ),
        );
      }
    }
  }

  // --- skills: same name, different level -------------------------------------
  const skills = profile.skills ?? [];
  const skillGroups = groupBy(skills, (s) => s.name.toLowerCase());
  for (const [name, indices] of skillGroups) {
    if (indices.length < 2) continue;
    const levels = new Set(indices.map((i) => skills[i]?.level).filter(Boolean));
    if (levels.size > 1) {
      push(
        warn(
          'drift/skill-conflict',
          `skill "${name}" appears with different levels (${[...levels].join(', ')})`,
          `skills[${indices[0]}]`,
        ),
      );
    }
  }

  // --- active: platform known + curated base exists ----------------------------
  const active = profile.active ?? {};
  for (const [platformKey, entry] of Object.entries(active)) {
    if (!(PLATFORMS as readonly string[]).includes(platformKey)) {
      push(
        warn(
          'drift/active-platform-unknown',
          `active["${platformKey}"] is not one of the platform ids (${PLATFORMS.join(', ')})`,
          `active["${platformKey}"]`,
        ),
      );
      continue;
    }
    const platform = platformKey as Platform;
    const hasBase =
      bios.some((b) => b.platform === platform && b.lang === entry.lang) ||
      headlines.some((h) => h.platform === platform && h.lang === entry.lang);
    if (!hasBase) {
      push(
        warn(
          'drift/active-variant-missing',
          `active["${platform}"] (variant "${entry.variantId}", ${entry.lang}) has no curated bio/headline for ${platform}/${entry.lang}`,
          `active["${platform}"]`,
          [platform],
        ),
      );
    }
  }

  return issues;
}
