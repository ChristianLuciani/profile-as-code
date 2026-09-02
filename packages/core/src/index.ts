/**
 * @profile-as-code/core — validate · drift · geo · compile (M1).
 *
 * The contract source is `schema/profile.schema.json` (D3); Zod is generated
 * from it (packages/core/scripts/gen-zod.ts) and committed.
 */

export { load, validateProfile, normalizeProfile, LoadError, SchemaValidationError } from './load.js';
export { driftCheck } from './drift.js';
export { geoCheck } from './geo.js';
export { compile } from './compile.js';
export { PLATFORMS, LANGS } from './types.js';
export type {
  Profile,
  LoadedProfile,
  Flavor,
  Identity,
  Bio,
  Headline,
  Skill,
  ExperienceItem,
  Project,
  Publication,
  SocialHandle,
  Newsletter,
  Podcast,
  PressItem,
  BrandVoice,
  ActiveEntry,
  Lang,
  Platform,
  BioLength,
  LangMap,
  Issue,
  GeoCheck,
  GeoSection,
  GeoReport,
  StructuredDataReadiness,
  SemanticAssociationCoverage,
  PlatformProfile,
} from './types.js';
