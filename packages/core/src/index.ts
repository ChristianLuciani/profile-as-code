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
export type {
  CiteAnswer,
  CiteCitation,
  CiteConfidence,
  CiteMatch,
  CiteSpan,
  CiteSpanKind,
  CiteVocabulary,
} from "./cite.js";
/**
 * The deterministic citation matcher over saved answer-engine answers
 * (SPEC §7.4, #291) — pure, offline, no model. `citeVocabulary` is the declared
 * vocabulary it resolves; `citeMatch` is the per-answer result.
 */
export { citationHost, citeMatch, citeVocabulary } from "./cite.js";
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
/**
 * The AI crawler policy, projected from the `ai:` block of
 * `platforms/registry.yaml` (#290) — `pasco export ai-policy` renders it and
 * never keeps a UA list of its own.
 */
export type { AiCrawler, AiCrawlerFamily } from "./generated/ai-policy.gen.js";
export {
  AI_CRAWLERS,
  AI_POLICY_AS_OF,
  AI_POLICY_STANCE,
  AI_POLICY_VERSION,
} from "./generated/ai-policy.gen.js";
export type { SurfaceKind } from "./generated/platforms.gen.js";
/** The creator-monetization paste set, projected from `platforms/registry.yaml`
 *  (#154) — the derived test enumeration, never a hand-extended list. */
export { PASTE_PLATFORMS, PLATFORM_KINDS } from "./generated/platforms.gen.js";
/** The profile-contract version this build validates — generated from the schema
 *  `$id` (D3, issue #348); `pasco doctor` reports it. */
export { PROFILE_SCHEMA_VERSION } from "./generated/schema.zod.js";
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
export type { FoldedText, TermOccurrence } from "./normalize.js";
/**
 * The ONE case- and accent-folding every engine comparison uses (SPEC §8,
 * #291) — shared by `geoCheck` and `cite-check`, never re-implemented.
 */
export { findTerm, foldForMatch, isWordBounded, normalizeText, termOccursIn } from "./normalize.js";
/** D23 (issue #262): the presence board and the release fan-out — both DERIVED
 *  from releases[] + the §19 ledger, with no second state model. */
export type {
  BaseText,
  PresenceBoard,
  PresenceRow,
  PresenceState,
  Release,
  ReleasePlan,
  ReleaseSurface,
} from "./presence.js";
export { PresenceError, presenceBoard, releasePlan, selectRelease } from "./presence.js";
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
