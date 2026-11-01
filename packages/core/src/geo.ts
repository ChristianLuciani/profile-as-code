/**
 * geoCheck(profile, lang?) — GEO as a cross-cutting layer (D7, SPEC §8).
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
 *   4. citability         — verifiable claims get dropped by cite-aware systems:
 *                           publications resolvable via DOI/ORCID, projects with
 *                           verifiable evidence[] (§8) — and, since v1.10
 *                           (#289), the answer-engine citability codes over
 *                           `identity.definition` / `faq[]`, a freshness
 *                           signal (INFO), `sameAs` coverage and the honest
 *                           name-collision risk.
 *
 * Every check is weighted; overall score 0..100. Missing data is neutral for the
 * FACT checks (score 1); the readiness and citability checks — entity @id,
 * structured person, `sameAs` links, semantic anchors, and the v1.10 codes — can score 0 on
 * absence (the citability property IS the product a buyer pays for: no canonical
 * definition is a gap, not neutral silence). Both readings are declared per code
 * in §8 with their weights — a code never reweights silently.
 *
 * One code is NOT APPLICABLE instead of neutral (#399, §8): `geo/evidence-claims`
 * is excluded from the weighted mean while no project declares any `evidence[]`.
 * Its `score` is retained at 1 but no mean consumes it — `applicable: false` is
 * the contract — because a ratio of 0/1 made adding a project without evidence
 * LOWER the overall. The coverage question ("how much of the profile carries
 * sources") is §20's `evidence` item; once at least one evidence row is declared,
 * this code scores the ratio again.
 */

import { driftCheck } from "./drift.js";
import { linksWithRole, sameAsUrls, structuredData } from "./structured-data.js";
import type {
  GeoCheck,
  GeoReport,
  GeoSection,
  Lang,
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

// ── Citability v2 predicates (v1.10, issue #289) ────────────────────────────
// Each predicate reports ONLY what it can observe offline; a code with no
// observation produces no finding (name-collision is the honest one).

/** The `identity.definition` values (the citable sentence, per lang). */
function definitionEntries(profile: Profile): Array<[string, string]> {
  const def = profile.identity.definition;
  return def ? Object.entries(def).filter(([, v]) => v !== "") : [];
}

/** Date-bearing facts the freshness signal reads; the newest wins. */
function freshnessFacts(profile: Profile): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const [key, rows] of Object.entries(profile.deployments ?? {})) {
    for (const [surface, rec] of Object.entries(rows ?? {})) {
      facts[`${key}→${surface}`] = rec.deployedAt;
    }
  }
  for (const p of profile.press ?? []) {
    if (p.date) facts[`press:${(p.outlet ?? p.url ?? "?").toString().slice(0, 40)}`] = p.date;
  }
  for (const c of profile.credentials ?? []) {
    if (c.issued) facts[`credential:${c.title}`] = c.issued;
  }
  if ((profile.publications ?? []).length > 0) {
    // Year precision: the newest publication year compares at year granularity
    // (YYYY-12-31 is the LATEST the bare year can mean — the honest edge).
    const newestYear = Math.max(...(profile.publications ?? []).map((p) => p.year));
    facts["publications:newest-year"] = `${newestYear}-12-31`;
  }
  return facts;
}

/** The calendar 12-month window: a leap year shifts the honest edge, so a flat
 *  365-day constant would drift the claim "inside 12 months" (fresh-pass F4).
 *  Future-dated facts are excluded here — a fact claiming a date that has not
 *  happened (a typo) cannot evidence freshness; readFreshness reports it. */
function freshnessWindowStart(now: number = Date.now()): number {
  const windowStart = new Date(now);
  windowStart.setUTCMonth(windowStart.getUTCMonth() - 12);
  return windowStart.getTime();
}

/** One read of the freshness signal: the newest fact inside the window (the
 *  pass), the newest past-dated one outside it (the observable gap), and every
 *  future-dated fact (an anomaly, never a signal — F4). */
type FreshnessReading = {
  fresh?: { key: string; when: string };
  stale?: { key: string; when: string };
  future: Array<{ key: string; when: string }>;
};

function readFreshness(profile: Profile, now: number = Date.now()): FreshnessReading {
  const windowStart = freshnessWindowStart(now);
  const reading: FreshnessReading = { future: [] };
  for (const [key, when] of Object.entries(freshnessFacts(profile))) {
    const t = Date.parse(when);
    if (Number.isNaN(t)) continue;
    if (t > now) reading.future.push({ key, when });
    else if (t >= windowStart) {
      if (!reading.fresh || t > Date.parse(reading.fresh.when)) reading.fresh = { key, when };
    } else if (!reading.stale || t > Date.parse(reading.stale.when)) reading.stale = { key, when };
  }
  return reading;
}

/** The declared fail-conditions of `geo/canonical-definition` (§8): a value
 *  over the 160-char cap, or one that does not contain the entity name. The
 *  cap is ALSO schema-enforced (max 160, #288) — the geo rule repeats it as
 *  defense-in-depth for direct callers, the same reading as the faq floor. */
function definitionFailures(profile: Profile): string[] {
  const name = (profile.identity.name ?? "").toLowerCase();
  const out: string[] = [];
  for (const [lang, v] of definitionEntries(profile)) {
    if (v.length > 160) out.push(`definition[${lang}] exceeds 160 chars`);
    else if (name === "" || !v.toLowerCase().includes(name))
      out.push(`definition[${lang}] does not contain the entity name`);
  }
  return out;
}

/** The disambiguating qualifiers name-collision can observe offline (also read by
 *  `cite-check`'s one-word guard, #291 — one home for the declared list): the
 *  declared `location` and the declared `experience[].role` titles (v1.1: a
 *  string or a langMap — the issue's "(location/role)" wording). Nothing is
 *  invented: both count ONLY when declared. The `identity.links[]` roles
 *  (identity/realization/aggregator, v1.6) are a DIFFERENT kind of role and
 *  never count here. */
export function disambiguationQualifiers(profile: Profile): string[] {
  const out: string[] = [];
  const location = profile.identity.location;
  if (location) out.push(location);
  for (const item of profile.experience ?? []) {
    const role = item.role;
    if (typeof role === "string") out.push(role);
    else if (role) out.push(...Object.values(role));
  }
  return out.filter(Boolean);
}

/** The one-word risk, observed once: the same reading drives the score and the
 *  detail (they can never disagree). */
type NameCollisionObservation =
  | { kind: "multi-word" }
  | { kind: "no-definition" }
  | { kind: "unqualified" }
  | { kind: "qualified"; qualifier: string };

function nameCollisionObservation(profile: Profile): NameCollisionObservation {
  const name = profile.identity.name;
  if (!name || /\s/.test(name)) return { kind: "multi-word" };
  const entries = definitionEntries(profile);
  if (entries.length === 0) return { kind: "no-definition" };
  for (const qualifier of disambiguationQualifiers(profile)) {
    // Case-insensitive: the same rule the name containment applies — a
    // definition that mentions the qualifier in another case STILL says it.
    if (entries.some(([, v]) => v.toLowerCase().includes(qualifier.toLowerCase())))
      return { kind: "qualified", qualifier };
  }
  return { kind: "unqualified" };
}

export function geoCheck(profile: Profile, lang: Lang = "en"): GeoReport {
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

  // `lang` is the same resolution the caller uses for the emitted JSON-LD: the
  // entity projection passes `--lang`/`.pascorc defaults.lang` here so a gap and
  // the artifact can never disagree about a lang-aware brand field (issue #287
  // review F1). Every pre-existing caller keeps the default (`en`), unchanged.
  const sd = structuredData(profile, lang);
  const anchors = semanticAnchors(profile);

  const publications = profile.publications ?? [];
  const citablePublications = publications.filter((p) => p.doi || p.orcidId).length;
  const projects = profile.projects ?? [];
  const projectsWithEvidence = projects.filter((p) => (p.evidence ?? []).length > 0).length;
  // §8/#399: evidence is OPT-IN. Until at least one project declares a row, the
  // code has nothing to measure and is N/A (excluded), never a sentinel 1.
  const hasAnyEvidence = projectsWithEvidence > 0;
  const evidenceWithVerified = projects
    .flatMap((p) => p.evidence ?? [])
    .filter((e) => Boolean(e.verified)).length;
  const totalEvidence = projects.flatMap((p) => p.evidence ?? []).length;

  // ONE freshness read per report (r2 fresh-pass F2 of #321): the score and the
  // detail share it, so their window can never disagree across a boundary, and
  // `Date.now()` is sampled once.
  const freshness = readFreshness(profile);

  const checks: GeoCheck[] = [
    {
      code: "geo/conflicts",
      label: "No fact contradictions across surfaces",
      weight: 0.2,
      score: clamp01(1 - conflicts.length * 0.25),
      detail:
        conflicts.length === 0
          ? "no fact contradictions detected"
          : `${conflicts.length} contradiction(s): ${[...new Set(conflicts.map((c) => c.code))].join(", ")}`,
    },
    {
      code: "geo/platform-bio-coverage",
      label: "Every targeted platform has a bio",
      weight: 0.096,
      score: targetCount === 0 ? 1 : targetsWithBio / targetCount,
      detail:
        targetCount === 0
          ? "no platforms targeted yet"
          : `${targetsWithBio}/${targetCount} platforms with a bio (${[...targets].filter((p) => !(profile.bios ?? []).some((b) => b.platform === p)).join(", ") || "all"} missing)`,
    },
    {
      code: "geo/platform-headline-coverage",
      label: "Every targeted platform has a headline",
      weight: 0.064,
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
      weight: 0.04,
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
      weight: 0.12,
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
      weight: 0.04,
      // Read from sd.fields — structuredData is the single source of truth for
      // entity-field presence (issue #86, F1): Boolean(entity) on the raw object
      // credited `mission: {en: ""}` as present while structuredData (falsy en-read)
      // called it absent. Parity holds for every schema-valid populated value:
      // logo/established/photo are url/date-typed (non-empty), location is a plain
      // string where "" is falsy in both readings.
      //
      // The two branches are NOT symmetric on `description` (v1.10 review F3), and
      // that is deliberate: the brand set has always scored `description` because a
      // brand always has one (mission in v1.9, definition-or-mission now). The Person
      // `description` is v1.10-OPTIONAL, so adding it to the denominator would move
      // every pre-v1.10 person score (a pinned contract: `cite.test` pins the GEO
      // score) — an additive field must never shrink a published number. It is still
      // NAMED in the detail below and measured by the readiness completeness ratio.
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
          ? `logo: ${sd.fields.logo ? "yes" : "no"} · description(definition|mission): ${sd.fields.description ? "yes" : "no"} · foundingDate: ${sd.fields.foundingDate ? "yes" : "no"}`
          : `photo: ${sd.fields.image ? "yes" : "no"} · location: ${sd.fields.address ? "yes" : "no"} · jobTitle: ${sd.fields.jobTitle ? "yes" : "no"} · description(optional): ${sd.fields.description ? "yes" : "no"}`,
    },
    {
      code: "geo/semantic-anchors",
      label: "Semantic association anchors reinforced across surfaces",
      weight: 0.12,
      score: anchors.anchors.length === 0 ? 0 : anchors.reinforced.length / anchors.anchors.length,
      detail:
        anchors.anchors.length === 0
          ? "no positioning.geo.semanticAssociations defined (3–5 anchors)"
          : `${anchors.reinforced.length}/${anchors.anchors.length} anchors reinforced; missing: ${anchors.missing.join(", ") || "none"}`,
    },
    {
      code: "geo/citable-publications",
      label: "Publications resolvable via DOI/ORCID",
      weight: 0.04,
      score: publications.length === 0 ? 1 : citablePublications / publications.length,
      detail:
        publications.length === 0
          ? "no publications"
          : `${citablePublications}/${publications.length} publications carry a DOI or ORCID`,
    },
    {
      code: "geo/evidence-claims",
      label: "Projects carry verifiable evidence[]",
      weight: 0.08,
      // §8/#399 (option C): N/A while no project declares evidence. The declared
      // coverage signal lives in §20's completeness `evidence` item, so absence is
      // not subtracted twice. Once evidence is declared, the ratio is scored.
      applicable: hasAnyEvidence,
      score: hasAnyEvidence ? projectsWithEvidence / projects.length : 1,
      detail: !hasAnyEvidence
        ? "not applicable — no project declares evidence[]; evidence coverage is scored by profile completeness (SPEC §20)"
        : `${projectsWithEvidence}/${projects.length} projects with evidence; ${evidenceWithVerified}/${totalEvidence} evidence claims have a verified date`,
    },
    // ── Citability v2 (v1.10, issue #289) — the five codes §8's table declares.
    // The weights below take the 0.20 freed by the ×0.8 dilution of the nine
    // earlier checks; the weight table is the contract, never tuned silently.
    {
      code: "geo/canonical-definition",
      label: "Canonical definition an answer engine can quote",
      weight: 0.06,
      // WARN: the definition IS the citable fact — absent, name-less or over
      // the cap means the entity cannot be quoted verbatim: a citability gap
      // (not neutral). The score implements the §8 fail-conditions, not just
      // the prose — the fresh pass (F2) caught presence-only scoring.
      severity: "warn",
      score: (() => {
        if (definitionEntries(profile).length === 0) return 0;
        return definitionFailures(profile).length === 0 ? 1 : 0;
      })(),
      detail:
        definitionEntries(profile).length === 0
          ? "no identity.definition declared — the one sentence an answer engine can quote verbatim (v1.10, #288)"
          : definitionFailures(profile).join("; ") ||
            `${definitionEntries(profile).length} definition value(s) quoted with the entity name (≤160 chars)`,
    },
    {
      code: "geo/faq-coverage",
      label: "Citable answers: 3–20 Q&A pairs, unique q, sourced",
      weight: 0.06,
      // WARN: one rule that fails names itself; the check is all-or-nothing —
      // partial credit would score a signal the workspace does not emit.
      severity: "warn",
      score: (() => {
        const rows = profile.faq ?? [];
        if (rows.length < 3) return 0;
        const dup = new Set<string>();
        for (const row of rows) {
          for (const q of Object.values(row.q)) {
            if (dup.has(q)) return 0;
            dup.add(q);
          }
        }
        return rows.every((row) => Boolean(row.source)) ? 1 : 0;
      })(),
      detail: (() => {
        const rows = profile.faq ?? [];
        if (rows.length === 0)
          return "no faq[] — the workspace declares no answers (3–20 entries, #288)";
        if (rows.length === 1 || rows.length === 2)
          return `faq[] has ${rows.length} row(s) — below the 3-row floor`;
        const dupes: string[] = [];
        const seen = new Set<string>();
        for (const row of rows) {
          for (const q of Object.values(row.q)) {
            if (seen.has(q)) dupes.push(q.slice(0, 60));
            seen.add(q);
          }
        }
        if (dupes.length > 0)
          return `duplicate q (collapses into one answer surface): "${dupes[0]}"`;
        const unsourced = rows.filter((row) => !row.source).length;
        if (unsourced > 0)
          return `${unsourced}/${rows.length} answer row(s) without a source — an answer with no pointer is a claim (§8)`;
        return `${rows.length} sourced Q&A pair(s) with unique questions`;
      })(),
    },
    {
      code: "geo/freshness",
      label: "Freshness signal inside 12 months",
      weight: 0.03,
      // INFO, NEVER WARN (#289): a dormant profile is not a bad profile — the
      // absence of freshness degrades citability without changing the pass story.
      severity: "info",
      // Calendar 12-month window; future-dated facts cannot evidence freshness
      // (fresh-pass F4: a typo'd 2099 deploy used to score 1).
      score: freshness.fresh !== undefined ? 1 : 0,
      // The anomaly is reported whenever future-dated facts are OBSERVED (r2
      // fresh-pass F1 of #321) — fresh, failing or both — never only in the
      // failing case: §8's "reported as an anomaly" is unconditional.
      detail: (() => {
        const parts: string[] = [];
        if (freshness.fresh)
          parts.push(`${freshness.fresh.key} = ${freshness.fresh.when} (fresher than 12 months)`);
        if (freshness.future.length > 0) {
          const anomalies = freshness.future.map((f) => `${f.key} = ${f.when}`).join("; ");
          parts.push(
            `future-dated fact(s) cannot evidence freshness (an anomaly, not a signal): ${anomalies}`,
          );
        }
        if (parts.length > 0) return parts.join("; ");
        if (freshness.stale)
          return `${freshness.stale.key} = ${freshness.stale.when} (older than 12 months)`;
        return "no dateModified-bearing fact (deployments/press/credentials/publications years)";
      })(),
    },
    {
      code: "geo/sameas-coverage",
      label: "sameAs coverage: claimed handles resolved, ≥3 realization links",
      weight: 0.04,
      // WARN: the emitted set is measured all-or-nothing — a claimed handle
      // whose URL the assembler removed (the @id duplicate) is a resolveable
      // failure; counting partial would flatter a blocked set.
      severity: "warn",
      score: (() => {
        const realizations = linksWithRole(identity, "realization");
        if (realizations.length < 3) return 0;
        const emitted = sameAsUrls(profile);
        const claimed = (profile.socialHandles ?? [])
          .filter((h) => h.status === "claimed" && h.url !== undefined)
          .map((h) => h.url as string);
        return claimed.every((url) => emitted.includes(url)) ? 1 : 0;
      })(),
      detail: (() => {
        const realizations = linksWithRole(identity, "realization");
        if (realizations.length < 3) {
          return `${realizations.length} role: realization link(s) — below the 3 the emitted sameAs needs for citability`;
        }
        const emitted = sameAsUrls(profile);
        const missing = (profile.socialHandles ?? [])
          .filter(
            (h) =>
              h.status === "claimed" && h.url !== undefined && !emitted.includes(h.url as string),
          )
          .map((h) => `${h.platform}`);
        return missing.length > 0
          ? `claimed handle(s) not resolving into the sameAs set: ${missing.join(", ")} (their URL duplicates the @id?)`
          : `${emitted.length} URLs in the emitted sameAs set (handles resolved)`;
      })(),
    },
    {
      code: "geo/name-collision",
      label: "Disambiguation risk of a one-word identity",
      weight: 0.01,
      // INFO and NEVER a claim of collision: homonyms cannot be detected
      // offline — the predicate reports the risk it can SEE (a single-token
      // name with no qualifier to disambiguate it) and says exactly that.
      severity: "info",
      // The same observation drives the score and the detail (fresh-pass F3:
      // the advice must be able to flip the score — location OR role).
      score: (() => {
        const o = nameCollisionObservation(profile);
        return o.kind === "multi-word" || o.kind === "qualified" ? 1 : 0;
      })(),
      detail: (() => {
        const o = nameCollisionObservation(profile);
        switch (o.kind) {
          case "multi-word":
            return "multi-word identity — inherent disambiguation";
          case "no-definition":
            return "[?] one-word identity without a definition to disambiguate it";
          case "qualified":
            return `one-word identity disambiguated by the declared ${JSON.stringify(o.qualifier)} in its definition`;
          case "unqualified":
            return "one-word identity whose definition carries no disambiguating qualifier (location/role) — homonyms cannot be detected offline; declare one in the definition";
        }
      })(),
    },
  ];

  // §8/#399: an N/A code carries NO weight — it is excluded from the mean, and
  // its retained `score: 1` is never read. The check stays in `checks` (and its
  // section) with `applicable: false` so the reading is visible, never dropped.
  const scored = checks.filter((check) => check.applicable !== false);
  const totalWeight = scored.reduce((sum, check) => sum + check.weight, 0);
  const score = Math.round(
    (scored.reduce((sum, check) => sum + check.score * check.weight, 0) / totalWeight) * 100,
  );

  const section = (label: string, detail: string, subset: GeoCheck[]): GeoSection => {
    const applicable = subset.filter((check) => check.applicable !== false);
    const weight = applicable.reduce((sum, check) => sum + check.weight, 0);
    // An all-N/A section has no mean; 0 is the safe placeholder, not a score
    // (GeoSection carries no `applicable`). No section is all-N/A today — the
    // guard keeps the division total if one ever is.
    const sectionScore =
      weight === 0
        ? 0
        : Math.round(
            (applicable.reduce((sum, check) => sum + check.score * check.weight, 0) / weight) * 100,
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
        // #241: the @id gap is a user-facing fact, not a JSON-only field — name the missing
        // anchor and its weight in the same line the score prints.
        `schema.org ${sd.entityType} JSON-LD ${sd.ready ? "ready for the web renderer" : "not ready (need a name)"}.${
          sd.fields.id === undefined
            ? ` Missing canonical @id: declare a role: identity link on a page or profile (+${Math.round((checks.find((c) => c.code === "geo/entity-id")?.weight ?? 0.05) * 100)} overall).`
            : ""
        }`,
        checks.filter(
          (c) =>
            // Exact code, not the `geo/sameas` prefix: `geo/sameas-coverage`
            // (v1.10, #289) is a CITABILITY code — a prefix match here would
            // classify it twice and break the sections partition (the test
            // asserts it: sections are a partition of the checks).
            c.code === "geo/sameas-links" ||
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
      // The v1.10 framing (#289): citability is a DIFFERENT property from
      // consistency, and it is the one a buyer pays for — resolvable claims,
      // sourced answers, a freshness signal, and the honest one-word risk.
      "Verifiable claims: resolvable DOIs/ORCIDs, evidence[] with sources, sourced answers and the disambiguation risk.",
      checks.filter(
        (c) =>
          c.code.startsWith("geo/citable") ||
          c.code.startsWith("geo/evidence") ||
          c.code.startsWith("geo/canonical") ||
          c.code.startsWith("geo/faq") ||
          c.code.startsWith("geo/freshness") ||
          c.code.startsWith("geo/sameas-coverage") ||
          c.code.startsWith("geo/name-collision"),
      ),
    ),
  };

  return { score, sections, checks };
}
