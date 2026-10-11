/**
 * @profile-as-code/core — validate · drift · geo · compile (M1).
 *
 * The contract source is `schema/profile.schema.json` (D3); Zod is generated
 * from it (packages/core/scripts/gen-zod.ts) and committed.
 */

export { compile } from "./compile.js";
export type {
  CompletenessCatalogItem,
  CompletenessItemResult,
  CompletenessPolicy,
  CompletenessReport,
  CompletenessSignal,
} from "./completeness.js";
export {
  COMPLETENESS_CATALOG,
  completeness,
  completenessLine,
  DEFAULT_COMPLETENESS_POLICY,
} from "./completeness.js";
export { driftCheck } from "./drift.js";
/** The creator-monetization paste set, projected from `platforms/registry.yaml`
 *  (#154) — the derived test enumeration, never a hand-extended list. */
export { PASTE_PLATFORMS } from "./generated/platforms.gen.js";
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
