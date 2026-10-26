/**
 * structured-data.ts — the entity's structured-data identity (SPEC §15.4, #103).
 *
 * ONE home for assembling the `schema.org` view of the entity: its canonical `@id`,
 * the `sameAs` set, and the entity fields. Consumers are `geoCheck` (readiness +
 * scoring) and every renderer (the emitted JSON-LD block) — neither re-derives it.
 *
 * Why this module exists: the `@id` requirement in SPEC §15.4 was never implemented
 * because structured-data identity had no owner, so `geo.ts` and both renderers each
 * assembled their own JSON-LD in parallel. The same failure the repo already solved for
 * `credentialLdEntries` (§18.9: "Single source for every emitter") — applied here.
 *
 * ── Vocabulary (a TRANSLATION LAYER, never standard vocabulary) ────────────────
 * `identity.links[].role` maps onto schema.org properties, which the standard does
 * NOT treat as interchangeable:
 *
 *   role: identity    → schema.org:url                (strong: "the page IS the entity")
 *   role: realization → schema.org:sameAs             (weak:   "indirectly indicates it")
 *   role: aggregator  → schema.org:mainEntityOfPage   (medium: aggregates references;
 *                        DECLARATIVE in v1.6 — no renderer emits it yet, M5 is the consumer)
 *
 * Absent `role` = `realization` → every pre-v1.6 workspace keeps VALIDATING unchanged
 * (additive, dev-methodology §3). Output is NOT unchanged: see SPEC §15.4 for the three
 * declared deltas. Sources: W3C WebSchemas/sameAs, schema.org datamodel.
 * Classification + provenance: `identeco-cifereca/glossary/naming.md`.
 */

import { byteOrder } from "./byte-order.js";
import { credentialLdEntries } from "./registry.js";
import type {
  EducationalOccupationalCredentialLd,
  Identity,
  Lang,
  LinkRole,
  Profile,
  StructuredDataReadiness,
} from "./types.js";
import { textOf } from "./types.js";

/** Default when a link carries no explicit role — keeps pre-v1.6 output unchanged. */
export const DEFAULT_LINK_ROLE: LinkRole = "realization";

/** The role a link plays, with the v1.6 default applied. */
export function linkRole(link: { role?: LinkRole }): LinkRole {
  return link.role ?? DEFAULT_LINK_ROLE;
}

/**
 * URLs of the links carrying a given role. The single accessor every consumer uses —
 * so `sameAs`, `@id` and the eligibility checks can never disagree about which link
 * plays which role.
 */
export function linksWithRole(identity: Identity | undefined, role: LinkRole): string[] {
  return (identity?.links ?? []).filter((l) => linkRole(l) === role).map((l) => l.url);
}

/**
 * The entity `@id` — the URL of the `role: identity` link.
 *
 * Absent when no link declares `role: identity`: the engine NEVER invents an identity
 * anchor (missing data is neutral, SPEC §8) — `geoCheck` reports the gap instead
 * (`geo/entity-id`).
 *
 * IMPORTANT (operator decision, 2026-09-24): an absent `@id` does NOT suppress the
 * JSON-LD. The block is still emitted when the entity has a name — it simply carries no
 * `@id`. Suppressing it would strip structured data from every pre-v1.6 workspace (which
 * declares no `role`), i.e. the feature would REMOVE signal that already worked. The
 * `@id` is the improvement; it is not a precondition for emitting the entity.
 *
 * **The user decides, not a heuristic.** When several links declare `role: identity`,
 * the FIRST one wins (declaration order). An earlier draft ranked "own domain over
 * social network" via a hostname pattern list; that was deleted — see the note in
 * `glossary/naming.md`'s sibling decision record. Ranking hosts means this module
 * carries a second, hand-maintained platform list (`PLATFORMS` is the canonical one,
 * D16) and makes a product judgement inside a regex. The user marks which link is their
 * entity; encoding *their* intent better than they can is not this engine's job. It is
 * self-correcting: reorder the links, or mark a different one.
 */
export function entityId(identity: Identity | undefined): string | undefined {
  return (identity?.links ?? []).find((l) => linkRole(l) === "identity")?.url;
}

/**
 * The `sameAs` set: `role: realization` links plus the claimed-handle URLs, deduped.
 *
 * Excludes `role: identity` (it is the `@id`, not an "also") and `role: aggregator`
 * (an aggregator indicates the entity only indirectly; including it would blur the
 * hierarchy the standard defines). For a brand the socialHandles matrix IS the canonical
 * surface set (§17.1), so claimed handles join.
 *
 * NOTE: `identity.email` is never here — a `mailto:` URI is not a reference page
 * (v1.5/#71); it maps to the `email` property instead.
 */
export function sameAsUrls(profile: Profile): string[] {
  const identity = profile.identity;
  const claimed = (profile.socialHandles ?? [])
    .filter((h) => h.status === "claimed" && h.url !== undefined)
    .map((h) => h.url as string);

  // The `@id` is never an "also" (this module's own contract): a claimed handle can
  // legitimately duplicate the identity link's URL — e.g. `role: identity` on the X
  // profile AND a claimed `x` handle pointing at it — and it must not reappear in
  // `sameAs`. Excluded explicitly rather than assumed away (v1.6 review).
  const id = entityId(identity);

  return [...linksWithRole(identity, "realization"), ...claimed]
    .filter((url) => url !== id)
    .filter((url, index, all) => all.indexOf(url) === index);
}

/** The most recent role — the one a schema.org Person would call jobTitle/worksFor. */
function currentRole(profile: Profile): { jobTitle?: string; worksFor?: string } {
  const items = [...(profile.experience ?? [])];
  // Most recent first; the tie order is byte-order, not ICU (D19, #305) —
  // dates are digits, so the visible order is also locale-stable.
  const byStart = (a: (typeof items)[number], b: (typeof items)[number]) =>
    byteOrder(b.start, a.start);
  const current = items.filter((item) => item.end === "present").sort(byStart)[0];
  const latest = items.sort(byStart)[0];
  const pick = current ?? latest;
  return pick ? { jobTitle: textOf(pick.role), worksFor: pick.org } : {};
}

/** Public credentials → schema.org EducationalOccupationalCredential (§18.9, D17). */
function hasCredentialLd(profile: Profile): EducationalOccupationalCredentialLd[] | undefined {
  const entries = credentialLdEntries(profile.credentials ?? []);
  return entries.length > 0 ? entries : undefined;
}

/**
 * Assemble the entity's structured-data readiness AND its ready-to-embed JSON-LD.
 *
 * Single source for `@id` + `sameAs` + entity fields: `geoCheck` scores what this
 * returns, renderers emit `jsonLd` verbatim. No consumer re-derives.
 */
export function structuredData(profile: Profile, lang: Lang = "en"): StructuredDataReadiness {
  const identity = profile.identity;
  const isBrand = profile.flavor === "brand";
  const credentialsLd = hasCredentialLd(profile);
  const sameAs = sameAsUrls(profile);
  const entityIdValue = entityId(identity);

  if (isBrand) {
    // Lang-aware (v1.6 review fix): the OLD github-org passed `lang` to pickText, so
    // slogan/description followed the rendered language. Making this en-only silently
    // regressed every es/fr brand workspace — the `@id` work is not a licence to drop it.
    // Empty = absent (issue #84/#86): `||` falls through at BOTH levels, and the readiness
    // entity-field check below reads these same values, so there is one accessor rule.
    const slogan = identity.tagline?.[lang] || identity.tagline?.en || undefined;
    const description = identity.mission?.[lang] || identity.mission?.en || undefined;
    // NB: `lang` is the COMPILE-time language. A renderer that overrides `opts.lang`
    // cannot make the JSON-LD follow (it is assembled here, not there) — see the
    // silent-divergence guard in both renderers.
    const fields = {
      name: Boolean(identity.name),
      sameAs,
      ...(entityIdValue !== undefined ? { id: entityIdValue } : {}),
      ...(identity.email !== undefined ? { email: identity.email } : {}),
      ...(identity.logo ? { logo: identity.logo } : {}),
      ...(identity.established ? { foundingDate: identity.established } : {}),
      ...(slogan ? { slogan } : {}),
      ...(description ? { description } : {}),
      ...(identity.location ? { address: identity.location } : {}),
    };
    const considered = [
      "name",
      "sameAs",
      "email",
      "logo",
      "foundingDate",
      "slogan",
      "description",
      "address",
    ];
    const populated =
      1 +
      (sameAs.length > 0 ? 1 : 0) +
      (identity.email !== undefined ? 1 : 0) +
      (identity.logo ? 1 : 0) +
      (identity.established ? 1 : 0) +
      (slogan ? 1 : 0) +
      (description ? 1 : 0) +
      (identity.location ? 1 : 0);
    // `ready` = the JSON-LD CAN be emitted, and that is exactly what the emission path
    // does: `identity.name` alone gates the block (Option A). It must NOT require `@id`
    // or `sameAs` — a missing anchor or an empty sameAs is a GEO gap (`geo/entity-id`,
    // `geo/sameas-links`), not an emission blocker. Requiring them here would let M5
    // suppress a block the SPEC mandates emitting (v1.6 review, F4).
    const ready = Boolean(identity.name);
    // Key order mirrors the pre-v1.6 github-org emission exactly (name → email → logo →
    // foundingDate → slogan → description → sameAs → hasCredential), so a workspace that
    // declares no `role` keeps this key ORDER (the v1.6 deltas are the field set, not the
    // shape); `@id` slots in after `@type` when
    // present. Byte-stability is a contract (§15.1) — this order is not aesthetic.
    // Annotated so the declared `jsonLd` interface is actually enforced: without
    // it the object is built unannotated and spread into the return literal, so
    // excess/missing keys were never checked (a key emitted here but undeclared
    // in `StructuredDataReadiness` passed typecheck silently — premerge #186 F3).
    const jsonLd: StructuredDataReadiness["jsonLd"] = identity.name
      ? {
          "@context": "https://schema.org" as const,
          "@type": "Organization" as const,
          ...(entityIdValue !== undefined ? { "@id": entityIdValue } : {}),
          name: identity.name,
          ...(identity.email !== undefined ? { email: identity.email } : {}),
          ...(identity.logo ? { logo: identity.logo } : {}),
          ...(identity.established ? { foundingDate: identity.established } : {}),
          ...(slogan ? { slogan } : {}),
          ...(description ? { description } : {}),
          sameAs,
          ...(credentialsLd ? { hasCredential: credentialsLd } : {}),
        }
      : undefined;
    return {
      entityType: "Organization",
      ready,
      completeness: populated / considered.length,
      fields,
      ...(jsonLd ? { jsonLd } : {}),
    };
  }

  const role = currentRole(profile);
  const fields = {
    name: Boolean(identity.name),
    sameAs,
    ...(entityIdValue !== undefined ? { id: entityIdValue } : {}),
    ...(identity.email !== undefined ? { email: identity.email } : {}),
    ...(identity.photo ? { image: identity.photo } : {}),
    ...(identity.location ? { address: identity.location } : {}),
    // v1.11 (#334): informational only — NOT in `considered`/`populated`, so an
    // absent nationality leaves the completeness ratio (and every pre-v1.11 score)
    // untouched. It is optional, never a `ready` gate.
    ...(identity.nationality !== undefined ? { nationality: identity.nationality } : {}),
    ...(role.jobTitle ? { jobTitle: role.jobTitle } : {}),
    ...(role.worksFor ? { worksFor: role.worksFor } : {}),
  };
  const considered = ["name", "sameAs", "email", "image", "address", "jobTitle", "worksFor"];
  const populated =
    1 +
    (sameAs.length > 0 ? 1 : 0) +
    (identity.email !== undefined ? 1 : 0) +
    (identity.photo ? 1 : 0) +
    (identity.location ? 1 : 0) +
    (role.jobTitle ? 1 : 0) +
    (role.worksFor ? 1 : 0);
  // Same rule as the brand branch: `name` gates emission, nothing else (Option A).
  const ready = Boolean(identity.name);
  // Key order mirrors the pre-v1.6 github-readme emission (name → email → image →
  // address → sameAs → hasCredential) with `@id` after `@type` when present, so a
  // workspace that declares no `role` keeps this key ORDER. `jobTitle`/`worksFor`
  // are the fields the OLD renderer silently dropped while geo.ts computed them — the
  // divergence this module removes; they now follow `address`.
  const jsonLd: StructuredDataReadiness["jsonLd"] = identity.name
    ? {
        "@context": "https://schema.org" as const,
        "@type": "Person" as const,
        ...(entityIdValue !== undefined ? { "@id": entityIdValue } : {}),
        name: identity.name,
        ...(identity.email !== undefined ? { email: identity.email } : {}),
        ...(identity.photo ? { image: identity.photo } : {}),
        ...(identity.location ? { address: identity.location } : {}),
        // v1.11 (#334): schema.org `nationality` is a PERSON property — a brand has
        // no nationality, so the Organization branch never emits it. The value is the
        // alpha-2 code itself, not a name: `Country.identifier`, per the issue.
        ...(identity.nationality !== undefined
          ? {
              nationality: {
                "@type": "Country" as const,
                identifier: identity.nationality,
              },
            }
          : {}),
        ...(role.jobTitle ? { jobTitle: role.jobTitle } : {}),
        ...(role.worksFor ? { worksFor: role.worksFor } : {}),
        sameAs,
        ...(credentialsLd ? { hasCredential: credentialsLd } : {}),
      }
    : undefined;
  return {
    entityType: "Person",
    ready,
    completeness: populated / considered.length,
    fields,
    ...(jsonLd ? { jsonLd } : {}),
  };
}
