/**
 * geoCheck(profile) — GEO as a cross-cutting layer (D7, SPEC §8).
 *
 * Returns a GeoReport (never throws — it is a report, not a gate, schema/README):
 *   1. factConsistency    — an LLM triangulating LinkedIn vs GitHub vs … must find
 *                           the same dates/roles/papers. Proxied deterministically:
 *                           fact-contradiction count (from the drift catalog) +
 *                           platform coverage (bio + headline per targeted platform).
 *   2. structuredData     — schema.org `Person`/`Organization` readiness (M5):
 *                           name + canonical `@id` + `sameAs` + optional entity
 *                           fields. Assembly lives in `structured-data.ts` (the one
 *                           home); this module only SCORES what it returns.
 *   3. semanticAssociations — the 3–5 anchors of positioning.geo.semanticAssociations
 *                           and whether each is reinforced across surfaces (statement,
 *                           citationsGoal, skills geoKeywords/keywords, keywords.geo,
 *                           project keywords/descriptions). Coverage = reinforced / total.
 *   4. citability         — publications resolvable via DOI/ORCID and projects with
 *                           verifiable evidence[] — the "unverifiable claims get
 *                           dropped" anti-pattern (§8).
 *
 * Every check is weighted; overall score 0..100. Missing data is neutral (score 1
 * for that check): a sparse profile is not penalized for what it does not claim.
 */

import { driftCheck } from "./drift.js";
import { linksWithRole, structuredData } from "./structured-data.js";
import type {
  GeoCheck,
  GeoReport,
  GeoSection,
  Platform,
  Profile,
  SemanticAssociationCoverage,
} from "./types.js";
import { PLATFORMS } from "./types.js";

/** Drift codes that represent fact contradictions (feeding factConsistency). */
const CONFLICT_CODES = new Set([
  "drift/date-range-inverted",
  "drift/duplicate-experience",
  "drift/duplicate-headline",
  "drift/duplicate-bio",
  "drift/duplicate-project",
  "drift/publication-conflict",
  "drift/publication-duplicate",
  "drift/orcid-conflict",
  "drift/orcid-mismatch",
  "drift/skill-conflict",
  // brand handle matrix (v1.1/§17) — handle inconsistencies are fact
  // contradictions for a brand (an LLM triangulating surfaces must find the
  // same handle/URL set).
  "drift/duplicate-handle",
  "drift/handle-claimed-not-linked",
  "drift/handle-host-mismatch",
]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function langValues(langMap: Record<string, string> | undefined): string[] {
  // Issue #86 (empty=absent, #84 rule): an empty-string value can never match an
  // anchor ("".includes of a non-empty anchor is false) — filtered so the
  // reinforcement haystack carries no degenerate values for future predicates.
  // No trim (the rule is the exact empty string; whitespace-only stays data).
  return langMap ? Object.values(langMap).filter((v) => v !== "") : [];
}

/** Which platforms the user targets (has any curated surface for). */
function targetedPlatforms(profile: Profile): Set<Platform> {
  const targets = new Set<Platform>();
  for (const b of profile.bios ?? []) targets.add(b.platform);
  for (const h of profile.headlines ?? []) targets.add(h.platform);
  for (const key of Object.keys(profile.active ?? {})) {
    if ((PLATFORMS as readonly string[]).includes(key)) {
      targets.add(key as Platform);
    }
  }
  for (const key of Object.keys(profile.keywords?.seo ?? {})) targets.add(key as Platform);
  return targets;
}

function semanticAnchors(profile: Profile): SemanticAssociationCoverage {
  const rawAnchors = (profile.positioning?.geo?.semanticAssociations ?? [])
    .map((a) => a.trim())
    .filter(Boolean);
  const anchors = rawAnchors.map((a) => a.toLowerCase());
  if (anchors.length === 0) return { anchors: [], reinforced: [], missing: [], coverage: 0 };

  const haystack: string[] = [
    ...langValues(profile.positioning?.statement),
    ...langValues(profile.positioning?.geo?.citationsGoal),
    ...(profile.keywords?.geo?.associations ?? []),
    ...(profile.keywords?.geo?.claims ?? []),
  ];
  for (const skill of profile.skills ?? []) {
    haystack.push(...(skill.geoKeywords ?? []), ...(skill.keywords ?? []));
  }
  for (const project of profile.projects ?? []) {
    haystack.push(...(project.keywords ?? []), ...langValues(project.description));
  }
  const normalized = haystack.map((text) => text.trim().toLowerCase());

  const reinforced: string[] = [];
  const missing: string[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (!anchor) continue;
    if (normalized.some((text) => text.includes(anchor))) reinforced.push(rawAnchors[i] ?? anchor);
    else missing.push(rawAnchors[i] ?? anchor);
  }
  return {
    anchors: rawAnchors,
    reinforced,
    missing,
    coverage: anchors.length === 0 ? 0 : reinforced.length / anchors.length,
  };
}

/**
 * Why there is no `@id`, in the operator's terms (#103): report the gap and its next
 * action, never invent an anchor. Three cases, and each needs a DIFFERENT message —
 * telling a user who marked an aggregator that they "declared nothing" would be false.
 *
 *   1. nothing declared            → no `role: identity` link at all
 *   2. declared an aggregator only → non-eligible: an aggregator aggregates references
 *                                    to the entity, it does not describe it (schema.org:url
 *                                    is reserved for "the page is in some sense 'his'")
 *   3. declared a realization only → the mirror of case 2: same non-eligibility, different
 *                                    reason (a realization indicates the entity indirectly)
 */
function identityAuthorityDetail(profile: Profile): string {
  const identity = profile.identity;
  const declared = linksWithRole(identity, "identity");
  if (declared.length > 0) {
    // Unreachable by construction (`entityId` returns the first declared link's url, and
    // `url` is required). The break is loud in CODE, never in the user's report: `detail`
    // stays a plain gap message, and an invariant failure surfaces via the thrown guard
    // below rather than by telling a user to "report this" (v1.6 review, twice flagged).
    return "no @id resolved for this profile's declared role: identity link";
  }

  const aggregators = linksWithRole(identity, "aggregator");
  if (aggregators.length > 0) {
    return `no role: identity link — ${aggregators.length} aggregator link(s) declared (${aggregators.join(", ")}) are NOT eligible for @id: an aggregator lists references to the entity, it does not describe it. Mark your own page (or profile) role: identity instead.`;
  }

  const realizations = linksWithRole(identity, "realization");
  if (realizations.length > 0) {
    return `no role: identity link — all ${realizations.length} link(s) are role: realization (they indicate the entity, not are it). Mark the one that represents you role: identity to make the entity citable.`;
  }

  return "no links declared — add the page that represents this entity with role: identity to make it citable";
}

export function geoCheck(profile: Profile): GeoReport {
  const identity = profile.identity;
  const conflicts = driftCheck(profile).filter((issue) => CONFLICT_CODES.has(issue.code));

  const targets = targetedPlatforms(profile);
  const targetsWithBio = [...targets].filter((platform) =>
    (profile.bios ?? []).some((b) => b.platform === platform),
  ).length;
  const targetsWithHeadline = [...targets].filter((platform) =>
    (profile.headlines ?? []).some((h) => h.platform === platform),
  ).length;
  const targetCount = targets.size;

  const sd = structuredData(profile);
  const anchors = semanticAnchors(profile);

  const publications = profile.publications ?? [];
  const citablePublications = publications.filter((p) => p.doi || p.orcidId).length;
  const projects = profile.projects ?? [];
  const projectsWithEvidence = projects.filter((p) => (p.evidence ?? []).length > 0).length;
  const evidenceWithVerified = projects
    .flatMap((p) => p.evidence ?? [])
    .filter((e) => Boolean(e.verified)).length;
  const totalEvidence = projects.flatMap((p) => p.evidence ?? []).length;

  const checks: GeoCheck[] = [
    {
      code: "geo/conflicts",
      label: "No fact contradictions across surfaces",
      weight: 0.25,
      score: clamp01(1 - conflicts.length * 0.25),
      detail:
        conflicts.length === 0
          ? "no fact contradictions detected"
          : `${conflicts.length} contradiction(s): ${[...new Set(conflicts.map((c) => c.code))].join(", ")}`,
    },
    {
      code: "geo/platform-bio-coverage",
      label: "Every targeted platform has a bio",
      weight: 0.12,
      score: targetCount === 0 ? 1 : targetsWithBio / targetCount,
      detail:
        targetCount === 0
          ? "no platforms targeted yet"
          : `${targetsWithBio}/${targetCount} platforms with a bio (${[...targets].filter((p) => !(profile.bios ?? []).some((b) => b.platform === p)).join(", ") || "all"} missing)`,
    },
    {
      code: "geo/platform-headline-coverage",
      label: "Every targeted platform has a headline",
      weight: 0.08,
      score: targetCount === 0 ? 1 : targetsWithHeadline / targetCount,
      detail:
        targetCount === 0
          ? "no platforms targeted yet"
          : `${targetsWithHeadline}/${targetCount} platforms with a headline`,
    },
    {
      code: "geo/entity-id",
      label: "Canonical entity identifier (schema.org @id)",
      // Shares the entity-identity budget with `geo/structured-person` below: both score
      // the SAME thing (the entity's own structured data), so the pair totals the 0.10
      // that field-check alone used to carry. Weights sum to 1 by contract — the test
      // asserts it, and a new check must pay for itself out of an existing budget.
      weight: 0.05,
      // SPEC §15.4 / #103: the `@id` comes from the `role: identity` link and is never
      // invented. Absent = the profile declares no canonical realization, never silently
      // satisfied by a heuristic.
      //
      // HONEST ACCOUNTING (v1.6 review): this check is NOT score-neutral. Every workspace
      // that does not yet declare `role: identity` loses up to 5 points (weight 0.05) —
      // the largest single v1.6 delta. It is a *reported gap*, not a regression: the `@id`
      // was never emitted before, so nothing that worked stopped working. But it does mean
      // upgrading moves the GEO score, and a user comparing before/after deserves to know.
      score: sd.fields.id !== undefined ? 1 : 0,
      detail:
        sd.fields.id !== undefined
          ? `@id = ${sd.fields.id} (from the role: identity link)`
          : identityAuthorityDetail(profile),
    },
    {
      code: "geo/sameas-links",
      label: "Canonical identity links (schema.org sameAs)",
      weight: 0.15,
      // Counts `role: realization` links — the ones that actually become `sameAs`.
      // Counting identity/aggregator links here would credit a profile whose sameAs
      // set is empty, i.e. score a signal it does not emit.
      //
      // The rationale applies in BOTH directions (v1.6 review, F9): it counts only
      // `links[]`, while the emitted `sameAs` also carries claimed `socialHandles[].url`.
      // A profile can therefore reach 5/5 here with fewer than 5 emitted URLs (or score
      // under 5 with more) — this check measures the SSOT-declared realization set, not
      // the JSON-LD array. Kept as-is deliberately: handles are a brand-flavor construct
      // (§17.1) and counting them would make a person and a brand score differently for
      // the same citability. Documented rather than silently asymmetric.
      score: clamp01(linksWithRole(identity, "realization").length / 5),
      detail: `${linksWithRole(identity, "realization").length} link(s) with role: realization in identity.links (≥3 recommended for GEO citability)`,
    },
    {
      code: "geo/structured-person",
      label:
        "Entity fields beyond the minimum (photo/location/jobTitle — logo/description/foundingDate for brand)",
      // Paired with `geo/entity-id` above: the two together carry the entity-identity
      // budget that this check alone held before v1.6 (#103).
      weight: 0.05,
      // Read from sd.fields — structuredData is the single source of truth for
      // entity-field presence (issue #86, F1): Boolean(entity) on the raw object
      // credited `mission: {en: ""}` as present while structuredData (falsy en-read)
      // called it absent. Parity holds for every schema-valid populated value:
      // logo/established/photo are url/date-typed (non-empty), location is a plain
      // string where "" is falsy in both readings.
      score:
        profile.flavor === "brand"
          ? (Number(Boolean(sd.fields.logo)) +
              Number(Boolean(sd.fields.description)) +
              Number(Boolean(sd.fields.foundingDate))) /
            3
          : (Number(Boolean(sd.fields.image)) +
              Number(Boolean(sd.fields.address)) +
              Number(Boolean(sd.fields.jobTitle))) /
            3,
      detail:
        profile.flavor === "brand"
          ? `logo: ${sd.fields.logo ? "yes" : "no"} · description(mission): ${sd.fields.description ? "yes" : "no"} · foundingDate: ${sd.fields.foundingDate ? "yes" : "no"}`
          : `photo: ${sd.fields.image ? "yes" : "no"} · location: ${sd.fields.address ? "yes" : "no"} · jobTitle: ${sd.fields.jobTitle ? "yes" : "no"}`,
    },
    {
      code: "geo/semantic-anchors",
      label: "Semantic association anchors reinforced across surfaces",
      weight: 0.15,
      score: anchors.anchors.length === 0 ? 0 : anchors.reinforced.length / anchors.anchors.length,
      detail:
        anchors.anchors.length === 0
          ? "no positioning.geo.semanticAssociations defined (3–5 anchors)"
          : `${anchors.reinforced.length}/${anchors.anchors.length} anchors reinforced; missing: ${anchors.missing.join(", ") || "none"}`,
    },
    {
      code: "geo/citable-publications",
      label: "Publications resolvable via DOI/ORCID",
      weight: 0.05,
      score: publications.length === 0 ? 1 : citablePublications / publications.length,
      detail:
        publications.length === 0
          ? "no publications"
          : `${citablePublications}/${publications.length} publications carry a DOI or ORCID`,
    },
    {
      code: "geo/evidence-claims",
      label: "Projects carry verifiable evidence[]",
      weight: 0.1,
      score: projects.length === 0 ? 1 : projectsWithEvidence / projects.length,
      detail:
        projects.length === 0
          ? "no projects"
          : `${projectsWithEvidence}/${projects.length} projects with evidence; ${evidenceWithVerified}/${totalEvidence} evidence claims have a verified date`,
    },
  ];

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const score = Math.round(
    (checks.reduce((sum, check) => sum + check.score * check.weight, 0) / totalWeight) * 100,
  );

  const section = (label: string, detail: string, subset: GeoCheck[]): GeoSection => {
    const weight = subset.reduce((sum, check) => sum + check.weight, 0);
    const sectionScore = Math.round(
      (subset.reduce((sum, check) => sum + check.score * check.weight, 0) / weight) * 100,
    );
    return { label, detail, checks: subset, score: sectionScore };
  };

  const sections: GeoReport["sections"] = {
    factConsistency: section(
      "Fact consistency",
      "An LLM triangulating platforms must find the same dates/roles/papers.",
      checks.filter(
        (c) => c.code.startsWith("geo/conflicts") || c.code.startsWith("geo/platform-"),
      ),
    ),
    structuredData: {
      ...section(
        "Structured-data readiness",
        // Mirrors `ready = Boolean(name)` exactly (structured-data.ts). The old string still
        // claimed "need name + ≥1 sameAs link" — the predicate it no longer uses, i.e. the
        // same contradiction as the `ready` bug, one line away from its own fix.
        `schema.org ${sd.entityType} JSON-LD ${sd.ready ? "ready for the web renderer" : "not ready (need a name)"}.`,
        checks.filter(
          (c) =>
            c.code.startsWith("geo/sameas") ||
            c.code.startsWith("geo/structured") ||
            c.code === "geo/entity-id",
        ),
      ),
      readiness: sd,
    },
    semanticAssociations: {
      ...section(
        "Semantic associations",
        "The 3–5 anchors an LLM should associate with the person, reinforced across surfaces.",
        checks.filter((c) => c.code === "geo/semantic-anchors"),
      ),
      anchors,
    },
    citability: section(
      "Citability",
      "Verifiable claims: resolvable DOIs/ORCIDs and evidence[] with sources.",
      checks.filter((c) => c.code.startsWith("geo/citable") || c.code.startsWith("geo/evidence")),
    ),
  };

  return { score, sections, checks };
}
