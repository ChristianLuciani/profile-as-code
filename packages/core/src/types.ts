/**
 * Public types of @profile-as-code/core.
 *
 * `Profile` is derived (z.infer) from the GENERATED Zod schema — which is in turn
 * generated from `schema/profile.schema.json` (D3). Types and contract never drift
 * from each other because both come from the same source.
 *
 * All root properties except `identity` are optional in the contract (a fresh user
 * may start with `identity.yaml` only). `load()` normalizes the parsed profile, so
 * `load()` returns `LoadedProfile` — the same object with the array properties
 * guaranteed to be defined (empty arrays when absent in the workspace).
 */

import type { profileSchema } from './generated/schema.zod.js';

/** The profile as defined by the contract (schema/profile.schema.json). */
export type Profile = import('zod').z.infer<typeof profileSchema>;

/** Normalized profile: array properties are always defined (empty when absent). */
export type LoadedProfile = Omit<Profile, 'bios' | 'headlines' | 'skills' | 'experience' | 'projects' | 'publications' | 'checks'> & {
  bios: NonNullable<Profile['bios']>;
  headlines: NonNullable<Profile['headlines']>;
  skills: NonNullable<Profile['skills']>;
  experience: NonNullable<Profile['experience']>;
  projects: NonNullable<Profile['projects']>;
  publications: NonNullable<Profile['publications']>;
  checks: NonNullable<Profile['checks']>;
};

export type Identity = NonNullable<Profile['identity']>;
export type Bio = NonNullable<Profile['bios']>[number];
export type Headline = NonNullable<Profile['headlines']>[number];
export type Skill = NonNullable<Profile['skills']>[number];
export type ExperienceItem = NonNullable<Profile['experience']>[number];
export type Project = NonNullable<Profile['projects']>[number];
export type Publication = NonNullable<Profile['publications']>[number];
export type ActiveEntry = NonNullable<Profile['active']>[string];

export type Lang = Bio['lang'];
export type Platform = Bio['platform'];
export type BioLength = Bio['length'];
export type LangMap = Record<Lang, string>;

/** The v1 platform set — mirrors the schema enum (never hand-maintained here). */
export const PLATFORMS: readonly Platform[] = [
  'github-readme',
  'linkedin',
  'upwork',
  'x',
  'researchgate',
  'substack',
] as const;

export const LANGS: readonly Lang[] = ['en', 'es', 'fr'] as const;

/** Every drift finding is a warning (D12): facts warn, schema fails. */
export interface Issue {
  /** Stable machine-readable code, e.g. `drift/date-range-inverted`. */
  code: string;
  /** Always `warn` in v1 (D12). Reserved so a future `error` severity can be added without breaking consumers. */
  severity: 'warn';
  /** Human-readable explanation in EN (docs convention, D8). */
  message: string;
  /** Dot-path into the profile where the problem lives, e.g. `experience[1]`. */
  path: string;
  /** Platform(s) involved, when the issue is cross-surface. */
  surfaces?: Platform[];
}

/** One scored, weighted GEO check (see `geoCheck`). */
export interface GeoCheck {
  code: string;
  label: string;
  /** 0..1 — 1 = fully satisfied. */
  score: number;
  /** 0..1 — share of the total score this check contributes. */
  weight: number;
  detail: string;
}

export interface GeoSection {
  label: string;
  detail: string;
  checks: GeoCheck[];
  /** 0..100 for this section alone. */
  score: number;
}

export interface StructuredDataReadiness {
  /** True when a schema.org `Person` JSON-LD can be emitted by the web renderer. */
  ready: boolean;
  /** Share of the considered Person fields that are populated (0..1). */
  completeness: number;
  fields: {
    name: boolean;
    sameAs: string[];
    image?: string;
    address?: string;
    jobTitle?: string;
    worksFor?: string;
  };
  /** Ready-to-embed JSON-LD (web renderer consumes it). */
  jsonLd?: {
    '@context': 'https://schema.org';
    '@type': 'Person';
    name: string;
    sameAs: string[];
    image?: string;
    address?: string;
    jobTitle?: string;
    worksFor?: string;
  };
}

export interface SemanticAssociationCoverage {
  /** The 3–5 anchors of positioning.geo.semanticAssociations. */
  anchors: string[];
  /** Anchors reinforced in at least one other surface (statement, skills, keywords, projects). */
  reinforced: string[];
  /** Anchors found nowhere else — they exist only in positioning.geo. */
  missing: string[];
  /** 0..1 — reinforced / total. */
  coverage: number;
}

export interface GeoReport {
  /** 0..100 — cross-cutting GEO readiness (report, not a gate; D7, §8). */
  score: number;
  sections: {
    factConsistency: GeoSection;
    /** Machine-readable schema.org Person readiness for the web renderer (M5). */
    structuredData: GeoSection & { readiness: StructuredDataReadiness };
    /** The 3–5 semantic anchors and how well they are reinforced across surfaces. */
    semanticAssociations: GeoSection & { anchors: SemanticAssociationCoverage };
    citability: GeoSection;
  };
  /** Flat list of every scored check (for `pac validate` output). */
  checks: GeoCheck[];
}

/** The language-aware slice a renderer consumes (SPEC §7, compile()). */
export interface PlatformProfile {
  platform: Platform;
  lang: Lang;
  /** Facts — passed through untouched from the profile. */
  identity: Identity;
  experience: ExperienceItem[];
  projects: Project[];
  publications: Publication[];
  skills: Skill[];
  /** Language-aware text, filtered by platform+lang. */
  bios: Bio[];
  headlines: Headline[];
  statement?: string;
  audiences: Record<string, string>;
  citationsGoal?: string;
  /** SEO set for this platform + GEO associations/claims. */
  keywords: { seo: string[]; geo: { associations?: string[]; claims?: string[] } };
  /** User checks targeting this platform (platform `all` included). */
  checks: NonNullable<Profile['checks']>;
  active?: ActiveEntry;
  /** Dot-paths of langMaps that fell back to `en` because `lang` was absent. */
  fallbacks: string[];
}
