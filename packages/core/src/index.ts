/**
 * @profile-as-code/core — validate · drift · geo · compile (M1).
 *
 * The contract source is `schema/profile.schema.json` (D3); Zod is generated
 * from it (packages/core/scripts/gen-zod.ts) and committed.
 */

export { compile } from "./compile.js";
export { driftCheck } from "./drift.js";
export { geoCheck } from "./geo.js";
export type {
  LedgerIssue,
  LedgerReport,
  Origin,
  SyncState,
  TrackableUnit,
  UnitKind,
  UnitStatus,
} from "./ledger.js";
export {
  canonicalJson,
  checkLedgerIntegrity,
  deployStatus,
  hashUnit,
  LEDGER_KEY_PATTERN,
  trackableUnits,
  untrackedRows,
} from "./ledger.js";
export {
  LoadError,
  load,
  normalizeProfile,
  SchemaValidationError,
  validateProfile,
} from "./load.js";
export type { CollectMediaOptions, ManifestEntry, MediaAsset, MediaBundle } from "./media.js";
export { artifactAssetTarget, collectMedia, DEFAULT_MAX_BYTES, mediaManifest } from "./media.js";
export { pasteSource } from "./paste-source.js";
export type { RegistryFinding, RegistryIssue } from "./registry.js";
export {
  checkRegistryIntegrity,
  credentialLdEntries,
  isPublicEntry,
  registryCheck,
} from "./registry.js";
export {
  DEFAULT_LINK_ROLE,
  entityId,
  linkRole,
  linksWithRole,
  sameAsUrls,
  structuredData,
} from "./structured-data.js";
export type {
  ActiveEntry,
  Artifact,
  Bio,
  BioLength,
  BrandVoice,
  Credential,
  DeploymentRecord,
  Deployments,
  EducationalOccupationalCredentialLd,
  ExperienceItem,
  Flavor,
  GeoCheck,
  GeoReport,
  GeoSection,
  Headline,
  Identity,
  Issue,
  Lang,
  LangMap,
  LinkRole,
  LoadedProfile,
  Newsletter,
  Platform,
  PlatformProfile,
  Podcast,
  PressItem,
  Profile,
  Project,
  Publication,
  SemanticAssociationCoverage,
  Skill,
  SocialHandle,
  StructuredDataReadiness,
} from "./types.js";
export { LANGS, PLATFORMS } from "./types.js";
