/**
 * compile(profile, platform, lang) — the language-aware slice a renderer consumes
 * (SPEC §7). Facts (identity, experience, projects, publications, skills) pass
 * through UNTOUCHED — they are language-independent and identical on every
 * platform (that is what makes them GEO-citable). Only text (bios, headlines,
 * statement, audiences, citationsGoal) is filtered by platform+lang, falling back
 * to `en` when the requested lang is absent (EN is always required by the schema).
 *
 * The platform set is the single `PLATFORMS` const from types.js (mirror of the
 * schema enum) — never duplicated here.
 */

import type { Lang, Platform, PlatformProfile, Profile } from './types.js';
import { PLATFORMS } from './types.js';

const LANG_IDS: readonly string[] = ['en', 'es', 'fr'] as const;

/**
 * Compile a PlatformProfile for one platform and language.
 *
 * @throws TypeError — `platform`/`lang` not in the contract enum (a renderer bug,
 *   not a user-data problem).
 */
export function compile(profile: Profile, platform: Platform, lang: Lang = 'en'): PlatformProfile {
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    throw new TypeError(`compile: unknown platform "${String(platform)}" (allowed: ${PLATFORMS.join(', ')})`);
  }
  if (!(LANG_IDS as readonly string[]).includes(lang)) {
    throw new TypeError(`compile: unknown language "${String(lang)}" (allowed: ${LANG_IDS.join(', ')})`);
  }

  const fallbacks: string[] = [];

  const langText = (langMap: Record<string, string> | undefined, path: string): string | undefined => {
    const direct = langMap?.[lang];
    if (direct !== undefined) return direct;
    const en = langMap?.en;
    if (en !== undefined) {
      fallbacks.push(path);
      return en;
    }
    return undefined;
  };

  const positioning = profile.positioning;
  const audiences: Record<string, string> = {};
  for (const [name, map] of Object.entries(positioning?.audiences ?? {})) {
    const text = langText(map, `positioning.audiences.${name}`);
    if (text !== undefined) audiences[name] = text;
  }

  // Brand blocks (v1.1/§17): text is lang-filtered (falling back to en), facts
  // (urls, dates, status) pass through untouched.
  const brandAudiences: Record<string, string> = {};
  for (const [name, map] of Object.entries(profile.audiences ?? {})) {
    const text = langText(map, `audiences.${name}`);
    if (text !== undefined) brandAudiences[name] = text;
  }

  const platformChecks = (profile.checks ?? []).filter((c) => c.platform === 'all' || c.platform === platform);

  return {
    platform,
    lang,
    flavor: profile.flavor ?? 'person',
    // facts — untouched
    identity: profile.identity,
    experience: profile.experience ?? [],
    projects: profile.projects ?? [],
    publications: profile.publications ?? [],
    skills: profile.skills ?? [],
    socialHandles: profile.socialHandles ?? [],
    newsletter: profile.newsletter,
    podcast: profile.podcast,
    press: profile.press ?? [],
    brandAudiences,
    // language-aware text
    bios: (profile.bios ?? []).filter((b) => b.platform === platform && b.lang === lang),
    headlines: (profile.headlines ?? []).filter((h) => h.platform === platform && h.lang === lang),
    statement: langText(positioning?.statement, 'positioning.statement'),
    audiences,
    citationsGoal: langText(positioning?.geo?.citationsGoal, 'positioning.geo.citationsGoal'),
    keywords: {
      seo: profile.keywords?.seo?.[platform] ?? [],
      geo: profile.keywords?.geo ?? {},
    },
    checks: platformChecks,
    ...(profile.active?.[platform] ? { active: profile.active[platform] } : {}),
    fallbacks,
  };
}
