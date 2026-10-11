/**
 * completeness(profile, policy) — the profile-completeness checklist (issue #102).
 *
 * The engine computes; the workspace stores only the POLICY (weights, target,
 * expected langs) and a GENERATED view — never the percentage (a derived number
 * that would drift). Same contract as `geoCheck` (SPEC §7): pure, deterministic,
 * offline, no network.
 *
 * Five signals, each an already-present engine fact (the set ratified 2026-10-07):
 *
 *   presence     blocks vs the flavor's expected set (flavor + top-level props)
 *   langCoverage en/es/fr coverage of every langMap (load/schema)
 *   geoAnchors   semantic associations reinforced elsewhere (geoCheck's surface)
 *   evidence     claims that carry a source + registry entries (`evidenceItem`)
 *   deployment   share of trackable units with a ledger record (`ledger`)
 *
 * Policy is parameterized (dev-methodology §3): a user says "my target is the
 * GitHub milestone set, not everything" by dropping an item (weight 0) — a
 * parameter, never a code path. No weights are hardcoded outside the catalog.
 */

import { trackableUnits } from "./ledger.js";
import type { LoadedProfile } from "./types.js";

/** One scored signal the engine can compute. */
export type CompletenessSignal =
  | "presence"
  | "langCoverage"
  | "geoAnchors"
  | "evidence"
  | "deployment";

/** A catalog entry: the engine-owned definition of one completeness item. */
export interface CompletenessCatalogItem {
  id: CompletenessSignal;
  label: string;
  /** The profile block(s) this item draws on — the issue's "source" column. */
  block: string;
  /** The shipped, documented default weight (normalized when the score is computed). */
  weight: number;
}

/**
 * The item catalog — the engine's knowledge of what "complete" can mean.
 * `weight` here is the DEFAULT policy's weight; a policy overrides per id.
 */
export const COMPLETENESS_CATALOG: readonly CompletenessCatalogItem[] = [
  { id: "presence", label: "Required blocks present", block: "profile", weight: 0.3 },
  { id: "langCoverage", label: "Language coverage (en/es/fr)", block: "langMaps", weight: 0.15 },
  { id: "geoAnchors", label: "GEO semantic anchors", block: "positioning.geo", weight: 0.15 },
  { id: "evidence", label: "Claims carry evidence", block: "projects.evidence", weight: 0.15 },
  { id: "deployment", label: "Deployed to a surface", block: "deployments", weight: 0.25 },
] as const;

/** The policy: what a workspace is being measured against. */
export interface CompletenessPolicy {
  /** Name of the milestone this policy targets (informational, e.g. `github-milestone`). */
  target?: string;
  /** Languages text coverage is measured in (default: en/es/fr). */
  langs?: readonly string[];
  /** Per-item weight override; weight 0 removes the item from the score. */
  items?: readonly { id: string; weight: number }[];
}

/** One computed item: a score in 0..1, its weight, and a short EN detail. */
export interface CompletenessItemResult {
  id: string;
  label: string;
  block: string;
  score: number;
  weight: number;
  satisfied: boolean;
  detail: string;
}

export interface CompletenessReport {
  /** 0..100, weighted mean of the item scores (one decimal, byte-stable). */
  percent: number;
  /** Items with score 1 — the numerator of the `11/18` surface. */
  satisfied: number;
  /** Items considered by the policy (weight > 0). */
  total: number;
  target: string;
  items: CompletenessItemResult[];
}

/** The shipped, documented default (overridable per workspace via `.pascorc`). */
export const DEFAULT_COMPLETENESS_POLICY: CompletenessPolicy = {
  target: "profile-complete",
  langs: ["en", "es", "fr"],
};

/** A langMap value as it reaches core after normalization. */
type LangMap = Record<string, string>;

/** True when a schema `string | langMap | langMapList` field is a plain langMap
 *  (string keys with string values) — langMapList (arrays) is not text coverage. */
function isLangMap(v: unknown): v is LangMap {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === "string");
}

/** Every langMap reachable from the loaded profile, with its dot-path. */
function langMaps(profile: LoadedProfile): { path: string; map: LangMap }[] {
  const out: { path: string; map: LangMap }[] = [];
  const push = (path: string, map: unknown): void => {
    if (map !== undefined && isLangMap(map)) out.push({ path, map });
  };
  for (const [i, e] of (profile.experience ?? []).entries()) {
    push(`experience[${i}].highlights`, e.highlights);
  }
  for (const [i, p] of (profile.projects ?? []).entries()) {
    push(`projects[${i}].description`, p.description);
  }
  for (const [i, e] of (profile.education ?? []).entries()) {
    if (e.degree !== undefined && typeof e.degree !== "string")
      push(`education[${i}].degree`, e.degree);
    if (e.field !== undefined && typeof e.field !== "string")
      push(`education[${i}].field`, e.field);
  }
  for (const [i, p] of (profile.press ?? []).entries()) {
    if (typeof p.title !== "string") push(`press[${i}].title`, p.title);
    if (p.outlet !== undefined && typeof p.outlet !== "string")
      push(`press[${i}].outlet`, p.outlet);
  }
  for (const [i, p] of (profile.publications ?? []).entries()) {
    if (typeof p.title !== "string") push(`publications[${i}].title`, p.title);
    if (typeof p.venue !== "string") push(`publications[${i}].venue`, p.venue);
  }
  push("positioning.statement", profile.positioning?.statement);
  for (const [name, map] of Object.entries(profile.positioning?.audiences ?? {})) {
    push(`positioning.audiences.${name}`, map);
  }
  for (const [name, map] of Object.entries(profile.audiences ?? {})) {
    push(`audiences.${name}`, map);
  }
  push("positioning.geo.citationsGoal", profile.positioning?.geo?.citationsGoal);
  push("newsletter.name", profile.newsletter?.name);
  push("newsletter.description", profile.newsletter?.description);
  push("podcast.title", profile.podcast?.title);
  push("podcast.description", profile.podcast?.description);
  return out;
}

/** True when a collection has at least one item. */
function anyOf(v: readonly unknown[] | undefined): boolean {
  return (v?.length ?? 0) > 0;
}

/**
 * Presence means "carries content", not "the key exists". `schema` requires
 * nothing inside `positioning`/`keywords`, so `positioning: {}` and `keywords: {}`
 * are VALID workspaces — and counting them as present would hand two free points
 * to a profile that supplied nothing (the exact "green with no direction" failure
 * this feature exists to fix). `identity` was already guarded by `name`; these two
 * get the same treatment (review of #205, finding 1).
 */
function hasPositioning(profile: LoadedProfile): boolean {
  return (
    profile.positioning?.statement !== undefined ||
    anyOf(Object.keys(profile.positioning?.audiences ?? {}))
  );
}

function hasKeywords(profile: LoadedProfile): boolean {
  const kw = profile.keywords;
  if (kw === undefined) return false;
  return anyOf(Object.keys(kw.seo ?? {})) || anyOf(kw.geo?.associations) || anyOf(kw.geo?.claims);
}

/** The blocks a flavor is expected to carry (absent → not satisfied). */
function presenceChecks(profile: LoadedProfile): { label: string; present: boolean }[] {
  const brand = profile.flavor === "brand";
  return [
    { label: "identity", present: (profile.identity?.name ?? "").length > 0 },
    { label: "positioning", present: hasPositioning(profile) },
    { label: "bios", present: anyOf(profile.bios) },
    { label: "headlines", present: anyOf(profile.headlines) },
    { label: "experience", present: anyOf(profile.experience) },
    { label: "projects", present: anyOf(profile.projects) },
    { label: "skills", present: anyOf(profile.skills) },
    { label: "publications", present: anyOf(profile.publications) },
    { label: "keywords", present: hasKeywords(profile) },
    // Flavor-specific surface: brand expects its handle matrix; person expects education.
    brand
      ? { label: "socialHandles", present: anyOf(profile.socialHandles) }
      : { label: "education", present: anyOf(profile.education) },
  ];
}

function presenceScore(profile: LoadedProfile): { score: number; detail: string } {
  const checks = presenceChecks(profile);
  const present = checks.filter((c) => c.present);
  const missing = checks.filter((c) => !c.present).map((c) => c.label);
  return {
    score: present.length / checks.length,
    detail:
      missing.length === 0
        ? `${present.length}/${checks.length} blocks present`
        : `${present.length}/${checks.length} blocks present — missing: ${missing.join(", ")}`,
  };
}

function langCoverageScore(
  profile: LoadedProfile,
  langs: readonly string[],
): { score: number; detail: string } {
  const maps = langMaps(profile).map((m) => m.map);
  if (maps.length === 0) return { score: 0, detail: "no language maps to measure" };
  const covers = (map: LangMap, lang: string): boolean => (map[lang] ?? "").trim() !== "";
  const avg =
    maps.reduce(
      (sum, m) => sum + langs.filter((l) => covers(m, l)).length / Math.max(1, langs.length),
      0,
    ) / maps.length;
  const full = maps.filter((m) => langs.every((l) => covers(m, l))).length;
  return {
    score: avg,
    detail: `${full}/${maps.length} texts cover ${langs.join("/")}`,
  };
}

function geoAnchorsScore(profile: LoadedProfile): { score: number; detail: string } {
  const anchors = profile.positioning?.geo?.semanticAssociations ?? [];
  if (anchors.length === 0) return { score: 0, detail: "no semantic associations declared" };
  const normal = (s: string): string => s.trim().toLowerCase();
  const reinforced = new Set<string>();
  for (const kw of profile.keywords?.geo?.associations ?? []) reinforced.add(normal(kw));
  for (const s of profile.skills ?? []) {
    for (const kw of s.geoKeywords ?? []) reinforced.add(normal(kw));
    for (const kw of s.keywords ?? []) reinforced.add(normal(kw));
  }
  for (const p of profile.projects ?? []) {
    for (const kw of p.keywords ?? []) reinforced.add(normal(kw));
  }
  const hit = anchors.filter((a) => reinforced.has(normal(a))).length;
  return {
    score: (hit / anchors.length) ** 2,
    detail: `${hit}/${anchors.length} anchors reinforced elsewhere`,
  };
}

function evidenceScore(profile: LoadedProfile): { score: number; detail: string } {
  const projects = profile.projects ?? [];
  const withEvidence = projects.filter((p) => (p.evidence ?? []).length > 0);
  const sourced = withEvidence.filter((p) =>
    (p.evidence ?? []).some((c) => (c.source ?? "").trim() !== ""),
  ).length;
  const claimsOK = projects.length === 0 ? 0 : sourced / projects.length;
  const hasRegistry = (profile.credentials ?? []).length + (profile.artifacts ?? []).length > 0;
  // Two real axes of the item, weights summing to 1 so a fully-sourced profile
  // with a registry reaches 1 and an empty one reaches 0 — no unconditional base
  // (review of #205, finding 2: `0/0 → 0.1` was a green-looking absent signal).
  const score = 0.7 * claimsOK + 0.3 * (hasRegistry ? 1 : 0);
  return {
    score: Math.min(1, score),
    detail: `${sourced}/${projects.length} projects carry sourced evidence · registry ${hasRegistry ? "present" : "empty"}`,
  };
}

function deploymentScore(profile: LoadedProfile): { score: number; detail: string } {
  const units = trackableUnits(profile);
  if (units.length === 0) return { score: 0, detail: "no trackable units yet" };
  const deployed = units.filter(
    (u) => Object.keys(profile.deployments[u.key] ?? {}).length > 0,
  ).length;
  return { score: deployed / units.length, detail: `${deployed}/${units.length} units deployed` };
}

/**
 * Compute the profile's completeness against a policy.
 *
 * @param profile a `load()`ed (normalized) profile — array blocks are defined.
 * @param policy  weights/target/langs; omitted ⇒ {@link DEFAULT_COMPLETENESS_POLICY}.
 */
export function completeness(
  profile: LoadedProfile,
  policy: CompletenessPolicy = DEFAULT_COMPLETENESS_POLICY,
): CompletenessReport {
  const target = policy.target ?? DEFAULT_COMPLETENESS_POLICY.target ?? "";
  const langs = policy.langs ?? DEFAULT_COMPLETENESS_POLICY.langs ?? ["en"];
  const overrides = new Map((policy.items ?? []).map((i) => [i.id, i.weight]));

  const scored: Record<
    CompletenessSignal,
    (p: LoadedProfile) => { score: number; detail: string }
  > = {
    presence: presenceScore,
    langCoverage: (p) => langCoverageScore(p, langs),
    geoAnchors: geoAnchorsScore,
    evidence: evidenceScore,
    deployment: deploymentScore,
  };

  const items: CompletenessItemResult[] = [];
  for (const entry of COMPLETENESS_CATALOG) {
    const weight = overrides.get(entry.id) ?? entry.weight;
    if (weight <= 0) continue; // policy drops the item: not part of the percentage
    const { score, detail } = scored[entry.id](profile);
    const clamped = Math.max(0, Math.min(1, score));
    items.push({
      id: entry.id,
      label: entry.label,
      block: entry.block,
      score: clamped,
      weight,
      satisfied: clamped === 1,
      detail,
    });
  }

  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  const earned = items.reduce((sum, i) => sum + i.score * i.weight, 0);
  const raw = totalWeight === 0 ? 0 : (earned / totalWeight) * 100;
  return {
    // One decimal: the number is a VIEW of the weighted items, and rounding it
    // here makes the rendered surface byte-stable for the same profile.
    percent: Math.round(raw * 10) / 10,
    satisfied: items.filter((i) => i.satisfied).length,
    total: items.length,
    target,
    items,
  };
}

/** `62.5% — 3/5` — the deterministic one-liner the CLI and the renderer share. */
export function completenessLine(report: CompletenessReport): string {
  return `${report.percent}% — ${report.satisfied}/${report.total}`;
}
