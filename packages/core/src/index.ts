/**
 * @profile-as-code/core — validate · drift · geo · compile (M1).
 *
 * The contract source is `schema/profile.schema.json` (D3); Zod is generated
 * from it (packages/core/scripts/gen-zod.ts) and committed.
 */

/** The ONE home of every text-order comparison (D19 byte-parity, #305) —
 *  UTF-16 code units, ICU-free; every engine sort that breaks ties by string
 *  delegates here. */
export { byteOrder } from "./byte-order.js";
export type { CompilePolicy } from "./compile.js";
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
  CertificationRollup,
  CertificationState,
  DeclaredUnverifiable,
  LedgerIssue,
  LedgerReport,
  Origin,
  SurfaceCapabilities,
  SurfaceCapability,
  SurfaceCertification,
  SyncState,
  TrackableUnit,
  UnitKind,
  UnitStatus,
} from "./ledger.js";
export {
  attemptRecord,
  attestedRecord,
  canonicalJson,
  certificationRollup,
  certificationVerdict,
  certifiedSurface,
  certifySurfaces,
  checkLedgerIntegrity,
  declaredReason,
  deployStatus,
  fetchFailureReason,
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
export type {
  OmissionReason,
  SelectionBlock,
  SelectionFinding,
  SelectionFindingCode,
  SelectionMode,
  SelectionOmission,
  SelectionPolicy,
  SelectionReport,
  SelectionResult,
  ViewRule,
} from "./selection.js";
export {
  resolveView,
  SELECTION_BLOCKS,
  selectFacts,
} from "./selection.js";
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
