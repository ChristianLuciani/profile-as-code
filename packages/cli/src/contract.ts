/**
 * Platform/lang/flavor parsing + the `pasco edit` contract-path grammar —
 * mirrors the contract enums (core exports PLATFORMS; lang enum is en/es/fr per
 * D8/§11; flavor is person|brand per D15). Usage errors are exit code 2.
 */

import type { BioLength, Flavor, Lang, Platform } from "@profile-as-code/core";
import { PLATFORMS } from "@profile-as-code/core";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const LANGS: readonly string[] = ["en", "es", "fr"] as const;
const FLAVORS: readonly string[] = ["person", "brand"] as const;

export function parsePlatform(value: string): Platform {
  if ((PLATFORMS as readonly string[]).includes(value)) return value as Platform;
  throw new UsageError(`unknown platform "${value}" (allowed: ${PLATFORMS.join(", ")})`);
}

export function parseLang(value: string): Lang {
  if (LANGS.includes(value)) return value as Lang;
  throw new UsageError(`unknown language "${value}" (allowed: ${LANGS.join(", ")})`);
}

export function parseFlavor(value: string): Flavor {
  if ((FLAVORS as readonly string[]).includes(value)) return value as Flavor;
  throw new UsageError(`unknown flavor "${value}" (allowed: ${FLAVORS.join(", ")})`);
}

/** The CLI's default variant count: 3. One home for the number the scaffolded
 *  `.pascorc` seeds (`init.ts`), the cookbook examples show (`--variants 3`) and
 *  the `.pascorc` fallback below rests on. SPEC §7 and the usage rows print
 *  `[--variants N]` without a default, so no doc is cited as saying more than it
 *  does. */
export const DEFAULT_VARIANTS = 3;

export function parseVariants(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    // The fallback is `.pascorc`'s `defaults.variants`: USER DATA the reader does
    // not validate (`readWorkspacePascorc` passes the JSON through). Trusting it
    // let `0` reach the published template as "Write 0 variant(s)" and a
    // non-number made the example list collapse (`#415` fresh pass, root cause).
    // An unusable fallback is not a usage error — the user asked for nothing —
    // so the documented default wins, at the ONE place both callers pass through.
    return Number.isInteger(fallback) && fallback >= 1 ? fallback : DEFAULT_VARIANTS;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new UsageError(`--variants must be a positive integer (got "${value}")`);
  return n;
}

/** `$defs.bio.length` — the third bio selector, validated here so a typo is a
 *  usage error (exit 2) instead of a silent 0-row resolution. */
const BIO_LENGTHS: readonly string[] = ["short", "medium", "long"] as const;

/**
 * A `pasco edit` contract path (epic #247, S1). Address by CONTRACT PATH, never
 * by line/offset: the resolver walks the loaded profile and the schema stays the
 * only authority on what a field is (D3/D12).
 *
 * S1 addressable (the four in the issue; S2 adds the write, no new field):
 *   positioning.statement.<lang>
 *   headlines[platform=<p>,lang=<l>].text
 *   bios[platform=<p>,lang=<l>,length=<len>].text
 *   identity.links[platform=<p>].url               (read-only)
 *
 * #435 adds the answer-engine surface (#288) with the SAME rules:
 *   identity.definition.<lang>
 *   faq[id=<slug>,lang=<l>].q | .a
 *   faq[id=<slug>].source
 *
 * `q`/`a` are langMaps (EN required by the schema), so the language is a
 * REQUIRED selector: the writer replaces one scalar, and a whole langMap is not
 * a scalar. `source` is a scalar URL, so it carries no `lang` selector.
 */
export type EditAddress =
  | { kind: "statement"; lang: Lang; address: string }
  | { kind: "headline"; platform: Platform; lang: Lang; address: string }
  | { kind: "bio"; platform: Platform; lang: Lang; length: BioLength; address: string }
  | { kind: "definition"; lang: Lang; address: string }
  /** One `faq[]` row, selected by its stable `id` (§19.2) — never by index. */
  | { kind: "faq"; id: string; field: "q" | "a" | "source"; lang?: Lang; address: string }
  /** `identity.links` rows carry a free-form `platform` string (the schema does
   *  not constrain it to the platform enum), so it is kept verbatim. `label` is
   *  the optional disambiguator a legal workspace needs when two links share a
   *  platform (review of #331: the schema allows it, and the drift code
   *  only flags the SAME url twice). */
  | { kind: "link"; platform: string; label?: string; address: string };

export function headlineAddress(platform: Platform, lang: Lang): string {
  return `headlines[platform=${platform},lang=${lang}].text`;
}

export function bioAddress(platform: Platform, lang: Lang, length: BioLength): string {
  return `bios[platform=${platform},lang=${lang},length=${length}].text`;
}

export function definitionAddress(lang: Lang): string {
  return `identity.definition.${lang}`;
}

/** The address of one `faq[]` row field. `q`/`a` carry the lang they address
 *  (they are langMaps); `source` is a plain URL scalar and takes none. */
export function faqAddress(id: string, field: "q" | "a" | "source", lang?: Lang): string {
  if (field === "source") return `faq[id=${id}].source`;
  return `faq[id=${id},lang=${lang}].${field}`;
}

/** `$defs/entryId` (schema v1.3, §19.2): the stable slug a `faq[]` row is
 *  addressed by. A malformed selector can never resolve to a row, so it is a
 *  usage error that lists the shape instead of a confusing 0-row read. */
const ENTRY_ID = /^[a-z0-9][a-z0-9._:-]*$/;

function parseEntryId(block: string, value: string): string {
  if (!ENTRY_ID.test(value)) {
    throw new UsageError(
      `${block}: id ${JSON.stringify(value)} is not a valid entry id (the schema's $defs/entryId: ^[a-z0-9][a-z0-9._:-]*$) — valid addresses:\n${editAddressTable()}`,
    );
  }
  return value;
}

export function linkAddress(platform: string, label?: string): string {
  return label === undefined
    ? `identity.links[platform=${platform}].url`
    : `identity.links[platform=${platform},label=${label}].url`;
}

/** The statement row address. It has no selector grammar, so it used to be
 *  spelled inline by the resolver — and `--list` (#411) must not grow a second
 *  spelling: both call this. */
export function statementAddress(lang: Lang): string {
  return `positioning.statement.${lang}`;
}

/** The blocks `pasco edit --list` can scope to (#411, extended by #435). They
 *  are the addressable contract roots, in the order the list prints them. */
export const EDIT_LIST_BLOCKS = [
  "positioning",
  "headlines",
  "bios",
  "identity.definition",
  "identity.links",
  "faq",
] as const;
export type EditListBlock = (typeof EDIT_LIST_BLOCKS)[number];

export function parseEditListBlock(value: string): EditListBlock {
  if ((EDIT_LIST_BLOCKS as readonly string[]).includes(value)) return value as EditListBlock;
  throw new UsageError(
    `unknown block "${value}" — --list scopes to one of: ${EDIT_LIST_BLOCKS.join(" | ")}`,
  );
}

/** The grammar, printed verbatim on a usage error — the caller must never have
 *  to guess a shape (S1 acceptance: an unknown address LISTS the valid ones). */
export function editAddressTable(): string {
  return [
    `  positioning.statement.<lang>                       lang: ${LANGS.join("|")}`,
    `  headlines[platform=<p>,lang=<l>].text              platform: <schema platform id, §6> · lang: ${LANGS.join("|")}`,
    `  bios[platform=<p>,lang=<l>,length=<len>].text      length: ${BIO_LENGTHS.join("|")}`,
    `  identity.definition.<lang>                         lang: ${LANGS.join("|")} (the canonical per-language sentence)`,
    `  faq[id=<slug>,lang=<l>].q | .a                     lang: ${LANGS.join("|")} (q/a are langMaps, so lang is required)`,
    `  faq[id=<slug>].source                              the optional http(s) pointer backing the answer`,
    `  identity.links[platform=<p>,label=<l>].url         (read-only; label optional — disambiguates two links on one platform)`,
  ].join("\n");
}

/** Order-insensitive `key=value` selectors inside `block[...]`. */
function parseSelectors(
  block: string,
  raw: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, string> {
  const allowed = [...required, ...optional];
  const selectors: Record<string, string> = {};
  const parts = raw.split(",");
  if (parts.length === 1 && parts[0]?.trim() === "") {
    throw new UsageError(
      `${block} needs selectors ${required.join("+")} — valid addresses:\n${editAddressTable()}`,
    );
  }
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) {
      throw new UsageError(
        `${block}: selector "${part.trim()}" is not key=value (expected ${allowed.join("+")}) — valid addresses:\n${editAddressTable()}`,
      );
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (value === "") {
      throw new UsageError(
        `${block}: selector "${key}" has an empty value — valid addresses:\n${editAddressTable()}`,
      );
    }
    if (!allowed.includes(key)) {
      throw new UsageError(
        `${block}: unknown selector "${key}" (allowed: ${allowed.join(", ")}) — valid addresses:\n${editAddressTable()}`,
      );
    }
    if (key in selectors) {
      throw new UsageError(
        `${block}: selector "${key}" given twice — valid addresses:\n${editAddressTable()}`,
      );
    }
    selectors[key] = value;
  }
  for (const key of required) {
    if (!(key in selectors)) {
      throw new UsageError(
        `${block}: missing selector "${key}" (expected ${required.join("+")}) — valid addresses:\n${editAddressTable()}`,
      );
    }
  }
  return selectors;
}

/**
 * Parse a contract path into a typed address. Malformed/unknown addresses are
 * USAGE errors (exit 2) that list the grammar for the block — never a silent
 * no-op (S1 acceptance). A well-formed address that resolves to 0 rows is a
 * data finding, not a usage error (see `commands/edit.ts`).
 */
export function parseEditAddress(raw: string): EditAddress {
  const text = raw.trim();
  if (text === "") {
    throw new UsageError(`empty address — valid addresses:\n${editAddressTable()}`);
  }

  const statement = /^positioning\.statement\.([A-Za-z0-9_-]+)$/.exec(text);
  if (statement !== null) {
    const lang = parseLang(statement[1] as string);
    return { kind: "statement", lang, address: statementAddress(lang) };
  }

  // #435: the canonical per-language definition lives in identity.yaml.
  const definition = /^identity\.definition\.([A-Za-z0-9_-]+)$/.exec(text);
  if (definition !== null) {
    const lang = parseLang(definition[1] as string);
    return { kind: "definition", lang, address: definitionAddress(lang) };
  }

  // #435: one faq[] row field. q/a are langMaps (EN required by the schema), so
  // they take a REQUIRED lang selector; source is a plain URL scalar.
  const faq = /^faq\[([^\]]*)\]\.([A-Za-z]+)$/.exec(text);
  if (faq !== null) {
    const field = faq[2] as string;
    if (field !== "q" && field !== "a" && field !== "source") {
      throw new UsageError(
        `faq[..].${field} is not addressable — the fields are faq[id=<slug>,lang=<l>].q | .a and faq[id=<slug>].source`,
      );
    }
    if (field === "source") {
      const s = parseSelectors("faq", faq[1] as string, ["id"]);
      const id = parseEntryId("faq", s.id as string);
      return { kind: "faq", id, field, address: faqAddress(id, "source") };
    }
    const s = parseSelectors("faq", faq[1] as string, ["id", "lang"]);
    const id = parseEntryId("faq", s.id as string);
    const lang = parseLang(s.lang as string);
    return { kind: "faq", id, field, lang, address: faqAddress(id, field, lang) };
  }

  const addressed = /^(headlines|bios|identity\.links)\[([^\]]*)\]\.([A-Za-z]+)$/.exec(text);
  if (addressed !== null) {
    const block = addressed[1] as "headlines" | "bios" | "identity.links";
    const field = addressed[3] as string;

    if (block === "headlines") {
      if (field !== "text") {
        throw new UsageError(
          `headlines[..].${field} is not addressable — the writable field is headlines[platform=<p>,lang=<l>].text`,
        );
      }
      const s = parseSelectors(block, addressed[2] as string, ["platform", "lang"]);
      const platform = parsePlatform(s.platform as string);
      const lang = parseLang(s.lang as string);
      return { kind: "headline", platform, lang, address: headlineAddress(platform, lang) };
    }

    if (block === "bios") {
      if (field !== "text") {
        throw new UsageError(
          `bios[..].${field} is not addressable — the writable field is bios[platform=<p>,lang=<l>,length=<len>].text`,
        );
      }
      const s = parseSelectors(block, addressed[2] as string, ["platform", "lang", "length"]);
      const platform = parsePlatform(s.platform as string);
      const lang = parseLang(s.lang as string);
      const length = s.length as string;
      if (!BIO_LENGTHS.includes(length)) {
        throw new UsageError(`unknown bio length "${length}" (allowed: ${BIO_LENGTHS.join(", ")})`);
      }
      return {
        kind: "bio",
        platform,
        lang,
        length: length as BioLength,
        address: bioAddress(platform, lang, length as BioLength),
      };
    }

    if (field !== "url") {
      throw new UsageError(
        `identity.links[..].${field} is not addressable — the only link field is identity.links[platform=<p>,label=<l>].url (read-only)`,
      );
    }
    const s = parseSelectors(block, addressed[2] as string, ["platform"], ["label"]);
    return {
      kind: "link",
      platform: s.platform as string,
      ...(s.label === undefined ? {} : { label: s.label }),
      address: linkAddress(s.platform as string, s.label),
    };
  }

  // A known block with a malformed shape still prints the grammar (the caller
  // is close); anything else prints the same table, which is the full contract.
  throw new UsageError(`unknown address "${text}" — valid addresses:\n${editAddressTable()}`);
}
