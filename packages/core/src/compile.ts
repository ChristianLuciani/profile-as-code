/**
 * compile(profile, platform, lang) — the language-aware slice a renderer consumes
 * (SPEC §7). Facts (identity, experience, projects, publications, skills) pass
 * through UNTOUCHED — they are language-independent and identical on every
 * platform (that is what makes them GEO-citable). Only text (bios, headlines,
 * statement, audiences, citationsGoal) is filtered by platform+lang, falling back
 * to `en` when the requested lang is absent (EN is always required by the schema).
 *
 * The platform set is the single `PLATFORMS` const from types.js (generated from
 * the schema enum) — never duplicated here.
 */

import { type CompletenessPolicy, completeness } from "./completeness.js";
import { normalizeProfile } from "./load.js";
import { type SelectionPolicy, selectFacts } from "./selection.js";
import { structuredData } from "./structured-data.js";
import type { Lang, Platform, PlatformProfile, Profile } from "./types.js";
import { PLATFORMS } from "./types.js";

const LANG_IDS: readonly string[] = ["en", "es", "fr"] as const;

/**
 * D22/§21: the compile policy — the completeness policy it always took, plus the
 * optional selection policy. ADDITIVE: `CompletenessPolicy` callers keep
 * compiling unchanged, and a policy without `selection` produces a slice
 * byte-identical to before this feature existed (the compatibility guarantee,
 * asserted by a golden test).
 */
export type CompilePolicy = CompletenessPolicy & {
  selection?: SelectionPolicy;
  /** D22/§21: the view NAME to resolve (a declared view may target a platform
   *  other than its own name, e.g. `--view film` → `github-readme`). Defaults to
   *  the platform, which is the implicit view (`pasco build linkedin`). */
  view?: string;
};

/**
 * Compile a PlatformProfile for one platform and language.
 *
 * @param policy the workspace compile policy (issue #102 + D22): the completeness
 *   policy, and optionally the fact-selection policy. The CLI passes `.pascorc`'s
 *   so the artifact carries the SAME number the workspace reports and the SAME
 *   view it resolved; omitted ⇒ no selection, shipped completeness default.
 * @throws TypeError — `platform`/`lang` not in the contract enum (a renderer bug,
 *   not a user-data problem).
 */
export function compile(
  profile: Profile,
  platform: Platform,
  lang: Lang = "en",
  policy?: CompilePolicy,
): PlatformProfile {
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    throw new TypeError(
      `compile: unknown platform "${String(platform)}" (allowed: ${PLATFORMS.join(", ")})`,
    );
  }
  if (!(LANG_IDS as readonly string[]).includes(lang)) {
    throw new TypeError(
      `compile: unknown language "${String(lang)}" (allowed: ${LANG_IDS.join(", ")})`,
    );
  }

  const fallbacks: string[] = [];

  const langText = (
    langMap: Record<string, string> | undefined,
    path: string,
  ): string | undefined => {
    // Issue #84 (option (a) ratified): an empty-string value counts as ABSENT —
    // nobody can display "" and a populated workspace is byte-identical; only
    // previously-degenerate output changes. `|| undefined` (not just `??`) so
    // emptiness falls through at BOTH lookup levels (lang-specific and en).
    const direct = langMap?.[lang] || undefined;
    if (direct !== undefined) return direct;
    const en = langMap?.en || undefined;
    if (en !== undefined) {
      fallbacks.push(path);
      return en;
    }
    return undefined;
  };

  const positioning = profile.positioning;
  const audiences: Record<string, string> = {};
  for (const [name, map] of Object.entries(positioning?.audiences ?? {})) {
    const text = langText(map, `positioning.audiences.${name}`);
    if (text !== undefined) audiences[name] = text;
  }

  // Brand blocks (v1.1/§17): text is lang-filtered (falling back to en), facts
  // (urls, dates, status) pass through untouched.
  const brandAudiences: Record<string, string> = {};
  for (const [name, map] of Object.entries(profile.audiences ?? {})) {
    const text = langText(map, `audiences.${name}`);
    if (text !== undefined) brandAudiences[name] = text;
  }

  const platformChecks = (profile.checks ?? []).filter(
    (c) => c.platform === "all" || c.platform === platform,
  );

  // D22/§21 — the view. `facts` is what renderers may see; `profile` (unfiltered)
  // is what completeness scores. The split is the contract, not an accident:
  //   - structuredData is built from the FILTERED profile, or the JSON-LD would
  //     claim entities the render never shows;
  //   - completeness stays on the UNFILTERED profile, because §20 scores the
  //     WORKSPACE, not a view (hiding half the SSOT must not lower the number).
  const selection =
    policy?.selection === undefined
      ? undefined
      : selectFacts(profile, policy.view ?? platform, platform, lang, policy.selection);
  const facts = selection?.profile ?? profile;

  return {
    platform,
    lang,
    flavor: profile.flavor ?? "person",
    // facts — untouched
    identity: facts.identity,
    experience: facts.experience ?? [],
    projects: facts.projects ?? [],
    publications: facts.publications ?? [],
    skills: facts.skills ?? [],
    socialHandles: profile.socialHandles ?? [],
    newsletter: profile.newsletter,
    podcast: profile.podcast,
    press: profile.press ?? [],
    brandAudiences,
    // language-aware text
    bios: (profile.bios ?? []).filter((b) => b.platform === platform && b.lang === lang),
    headlines: (profile.headlines ?? []).filter((h) => h.platform === platform && h.lang === lang),
    statement: langText(positioning?.statement, "positioning.statement"),
    audiences,
    citationsGoal: langText(positioning?.geo?.citationsGoal, "positioning.geo.citationsGoal"),
    keywords: {
      seo: profile.keywords?.seo?.[platform] ?? [],
      geo: profile.keywords?.geo ?? {},
    },
    checks: platformChecks,
    // Evidence registry (v1.4/D17, §18) — facts, pass through untouched.
    credentials: facts.credentials ?? [],
    artifacts: facts.artifacts ?? [],
    ...(profile.active?.[platform] ? { active: profile.active[platform] } : {}),
    // v1.6 (#103): entity structured-data identity — assembled ONCE here, so no
    // renderer re-derives `@id`/`sameAs` (SPEC §15.4, the §18.9 precedent).
    structuredData: structuredData(facts, lang),
    // Issue #102: the completeness report travels WITH the slice (like
    // structuredData) so a renderer emits the number verbatim and never
    // recomputes it. `policy` is the workspace's `.pascorc` policy when the CLI
    // passes it, so the artifact and `pasco status --completeness` agree
    // (review of #205, finding 3); omitted ⇒ the shipped default.
    completeness: completeness(normalizeProfile(profile), policy),
    ...(selection === undefined ? {} : { selection: selection.report }),
    fallbacks,
  };
}
