/**
 * geoCheck(profile) — GEO as a cross-cutting layer (D7, SPEC §8).
 *
 * Returns a GeoReport (never throws — it is a report, not a gate, schema/README):
 *   1. factConsistency    — an LLM triangulating LinkedIn vs GitHub vs … must find
 *                           the same dates/roles/papers. Proxied deterministically:
 *                           fact-contradiction count (from the drift catalog) +
 *                           platform coverage (bio + headline per targeted platform).
 *   2. structuredData     — schema.org `Person`/`sameAs` readiness for the web
 *                           renderer (M5): name + canonical links + optional
 *                           image/location/jobTitle/worksFor. `jsonLd` is emitted
 *                           ready to embed.
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

import { driftCheck } from './drift.js';
import { PLATFORMS, textOf } from './types.js';
import type {
  GeoCheck,
  GeoReport,
  GeoSection,
  Platform,
  Profile,
  SemanticAssociationCoverage,
  StructuredDataReadiness,
} from './types.js';

/** Drift codes that represent fact contradictions (feeding factConsistency). */
const CONFLICT_CODES = new Set([
  'drift/date-range-inverted',
  'drift/duplicate-experience',
  'drift/duplicate-headline',
  'drift/duplicate-bio',
  'drift/duplicate-project',
  'drift/publication-conflict',
  'drift/publication-duplicate',
  'drift/orcid-conflict',
  'drift/orcid-mismatch',
  'drift/skill-conflict',
  // brand handle matrix (v1.1/§17) — handle inconsistencies are fact
  // contradictions for a brand (an LLM triangulating surfaces must find the
  // same handle/URL set).
  'drift/duplicate-handle',
  'drift/handle-claimed-not-linked',
  'drift/handle-host-mismatch',
]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function langValues(langMap: Record<string, string> | undefined): string[] {
  return langMap ? Object.values(langMap) : [];
}

/** The most recent role — the one a schema.org Person would call jobTitle/worksFor. */
function currentRole(profile: Profile): { jobTitle?: string; worksFor?: string } {
  const items = [...(profile.experience ?? [])];
  const byStart = (a: (typeof items)[number], b: (typeof items)[number]) => b.start.localeCompare(a.start);
  const current = items.filter((item) => item.end === 'present').sort(byStart)[0];
  const latest = items.sort(byStart)[0];
  const pick = current ?? latest;
  return pick ? { jobTitle: textOf(pick.role), worksFor: pick.org } : {};
}

function structuredData(profile: Profile): StructuredDataReadiness {
  const identity = profile.identity;
  const isBrand = profile.flavor === 'brand';

  // sameAs: canonical identity.links + every claimed handle's URL (deduped). For a
  // brand the socialHandles matrix IS the canonical surface set (§17.1).
  const sameAs = [
    ...(identity.links ?? []).map((link) => link.url),
    ...(profile.socialHandles ?? [])
      .filter((h) => h.status === 'claimed' && h.url !== undefined)
      .map((h) => h.url as string),
  ].filter((url, index, all) => all.indexOf(url) === index);

  if (isBrand) {
    const slogan = identity.tagline?.en;
    const description = identity.mission?.en;
    const fields = {
      name: Boolean(identity.name),
      sameAs,
      ...(identity.logo ? { logo: identity.logo } : {}),
      ...(identity.established ? { foundingDate: identity.established } : {}),
      ...(slogan ? { slogan } : {}),
      ...(description ? { description } : {}),
      ...(identity.location ? { address: identity.location } : {}),
    };
    const considered = ['name', 'sameAs', 'logo', 'foundingDate', 'slogan', 'description', 'address'];
    const populated =
      1 + (sameAs.length > 0 ? 1 : 0) + (identity.logo ? 1 : 0) + (identity.established ? 1 : 0) + (slogan ? 1 : 0) + (description ? 1 : 0) + (identity.location ? 1 : 0);
    const ready = Boolean(identity.name) && sameAs.length > 0 && Boolean(identity.logo || description || identity.established);
    const jsonLd =
      identity.name && sameAs.length > 0
        ? {
            '@context': 'https://schema.org' as const,
            '@type': 'Organization' as const,
            name: identity.name,
            sameAs,
            ...(identity.logo ? { logo: identity.logo } : {}),
            ...(identity.established ? { foundingDate: identity.established } : {}),
            ...(slogan ? { slogan } : {}),
            ...(description ? { description } : {}),
            ...(identity.location ? { address: identity.location } : {}),
          }
        : undefined;
    return { entityType: 'Organization', ready, completeness: populated / considered.length, fields, ...(jsonLd ? { jsonLd } : {}) };
  }

  const role = currentRole(profile);
  const fields = {
    name: Boolean(identity.name),
    sameAs,
    ...(identity.photo ? { image: identity.photo } : {}),
    ...(identity.location ? { address: identity.location } : {}),
    ...(role.jobTitle ? { jobTitle: role.jobTitle } : {}),
    ...(role.worksFor ? { worksFor: role.worksFor } : {}),
  };
  const considered = ['name', 'sameAs', 'image', 'address', 'jobTitle', 'worksFor'];
  const populated = 1 + (sameAs.length > 0 ? 1 : 0) + (identity.photo ? 1 : 0) + (identity.location ? 1 : 0) + (role.jobTitle ? 1 : 0) + (role.worksFor ? 1 : 0);
  const ready = Boolean(identity.name) && sameAs.length > 0 && (Boolean(identity.photo) || Boolean(identity.location) || Boolean(role.jobTitle));
  const jsonLd = identity.name && sameAs.length > 0
    ? {
        '@context': 'https://schema.org' as const,
        '@type': 'Person' as const,
        name: identity.name,
        sameAs,
        ...(identity.photo ? { image: identity.photo } : {}),
        ...(identity.location ? { address: identity.location } : {}),
        ...(role.jobTitle ? { jobTitle: role.jobTitle } : {}),
        ...(role.worksFor ? { worksFor: role.worksFor } : {}),
      }
    : undefined;
  return { entityType: 'Person', ready, completeness: populated / considered.length, fields, ...(jsonLd ? { jsonLd } : {}) };
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
  const rawAnchors = (profile.positioning?.geo?.semanticAssociations ?? []).map((a) => a.trim()).filter(Boolean);
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
  return { anchors: rawAnchors, reinforced, missing, coverage: anchors.length === 0 ? 0 : reinforced.length / anchors.length };
}

export function geoCheck(profile: Profile): GeoReport {
  const identity = profile.identity;
  const conflicts = driftCheck(profile).filter((issue) => CONFLICT_CODES.has(issue.code));

  const targets = targetedPlatforms(profile);
  const targetsWithBio = [...targets].filter((platform) => (profile.bios ?? []).some((b) => b.platform === platform)).length;
  const targetsWithHeadline = [...targets].filter((platform) => (profile.headlines ?? []).some((h) => h.platform === platform)).length;
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
      code: 'geo/conflicts',
      label: 'No fact contradictions across surfaces',
      weight: 0.25,
      score: clamp01(1 - conflicts.length * 0.25),
      detail:
        conflicts.length === 0
          ? 'no fact contradictions detected'
          : `${conflicts.length} contradiction(s): ${[...new Set(conflicts.map((c) => c.code))].join(', ')}`,
    },
    {
      code: 'geo/platform-bio-coverage',
      label: 'Every targeted platform has a bio',
      weight: 0.12,
      score: targetCount === 0 ? 1 : targetsWithBio / targetCount,
      detail:
        targetCount === 0
          ? 'no platforms targeted yet'
          : `${targetsWithBio}/${targetCount} platforms with a bio (${[...targets].filter((p) => !(profile.bios ?? []).some((b) => b.platform === p)).join(', ') || 'all'} missing)`,
    },
    {
      code: 'geo/platform-headline-coverage',
      label: 'Every targeted platform has a headline',
      weight: 0.08,
      score: targetCount === 0 ? 1 : targetsWithHeadline / targetCount,
      detail:
        targetCount === 0
          ? 'no platforms targeted yet'
          : `${targetsWithHeadline}/${targetCount} platforms with a headline`,
    },
    {
      code: 'geo/sameas-links',
      label: 'Canonical identity links (schema.org sameAs)',
      weight: 0.15,
      score: clamp01((identity.links?.length ?? 0) / 5),
      detail: `${identity.links?.length ?? 0} canonical link(s) in identity.links (≥3 recommended for GEO citability)`,
    },
    {
      code: 'geo/structured-person',
      label: 'Entity fields beyond the minimum (photo/location/jobTitle — logo/description/foundingDate for brand)',
      weight: 0.1,
      score:
        profile.flavor === 'brand'
          ? (Number(Boolean(identity.logo)) + Number(Boolean(identity.mission)) + Number(Boolean(identity.established))) / 3
          : (Number(Boolean(identity.photo)) + Number(Boolean(identity.location)) + Number(Boolean(sd.fields.jobTitle))) / 3,
      detail:
        profile.flavor === 'brand'
          ? `logo: ${identity.logo ? 'yes' : 'no'} · description(mission): ${identity.mission ? 'yes' : 'no'} · foundingDate: ${identity.established ? 'yes' : 'no'}`
          : `photo: ${identity.photo ? 'yes' : 'no'} · location: ${identity.location ? 'yes' : 'no'} · jobTitle: ${sd.fields.jobTitle ? 'yes' : 'no'}`,
    },
    {
      code: 'geo/semantic-anchors',
      label: 'Semantic association anchors reinforced across surfaces',
      weight: 0.15,
      score: anchors.anchors.length === 0 ? 0 : anchors.reinforced.length / anchors.anchors.length,
      detail:
        anchors.anchors.length === 0
          ? 'no positioning.geo.semanticAssociations defined (3–5 anchors)'
          : `${anchors.reinforced.length}/${anchors.anchors.length} anchors reinforced; missing: ${anchors.missing.join(', ') || 'none'}`,
    },
    {
      code: 'geo/citable-publications',
      label: 'Publications resolvable via DOI/ORCID',
      weight: 0.05,
      score: publications.length === 0 ? 1 : citablePublications / publications.length,
      detail:
        publications.length === 0
          ? 'no publications'
          : `${citablePublications}/${publications.length} publications carry a DOI or ORCID`,
    },
    {
      code: 'geo/evidence-claims',
      label: 'Projects carry verifiable evidence[]',
      weight: 0.1,
      score: projects.length === 0 ? 1 : projectsWithEvidence / projects.length,
      detail:
        projects.length === 0
          ? 'no projects'
          : `${projectsWithEvidence}/${projects.length} projects with evidence; ${evidenceWithVerified}/${totalEvidence} evidence claims have a verified date`,
    },
  ];

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const score = Math.round((checks.reduce((sum, check) => sum + check.score * check.weight, 0) / totalWeight) * 100);

  const section = (label: string, detail: string, subset: GeoCheck[]): GeoSection => {
    const weight = subset.reduce((sum, check) => sum + check.weight, 0);
    const sectionScore = Math.round((subset.reduce((sum, check) => sum + check.score * check.weight, 0) / weight) * 100);
    return { label, detail, checks: subset, score: sectionScore };
  };

  const sections: GeoReport['sections'] = {
    factConsistency: section(
      'Fact consistency',
      'An LLM triangulating platforms must find the same dates/roles/papers.',
      checks.filter((c) => c.code.startsWith('geo/conflicts') || c.code.startsWith('geo/platform-')),
    ),
    structuredData: {
      ...section(
        'Structured-data readiness',
        `schema.org ${sd.entityType} JSON-LD ${sd.ready ? 'ready for the web renderer' : 'not ready (need name + ≥1 sameAs link)'}.`,
        checks.filter((c) => c.code.startsWith('geo/sameas') || c.code.startsWith('geo/structured')),
      ),
      readiness: sd,
    },
    semanticAssociations: {
      ...section(
        'Semantic associations',
        'The 3–5 anchors an LLM should associate with the person, reinforced across surfaces.',
        checks.filter((c) => c.code === 'geo/semantic-anchors'),
      ),
      anchors,
    },
    citability: section(
      'Citability',
      'Verifiable claims: resolvable DOIs/ORCIDs and evidence[] with sources.',
      checks.filter((c) => c.code.startsWith('geo/citable') || c.code.startsWith('geo/evidence')),
    ),
  };

  return { score, sections, checks };
}
