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

export function parseVariants(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
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
 */
export type EditAddress =
  | { kind: "statement"; lang: Lang; address: string }
  | { kind: "headline"; platform: Platform; lang: Lang; address: string }
  | { kind: "bio"; platform: Platform; lang: Lang; length: BioLength; address: string }
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

/**
 * The blocks `pasco edit --list` can scope to (#411). They are the four
 * addressable contract roots, in the order the list prints them.
 */
export const EDIT_LIST_BLOCKS = ["positioning", "headlines", "bios", "identity.links"] as const;
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
