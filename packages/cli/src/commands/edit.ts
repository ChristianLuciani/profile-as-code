/**
 * pasco edit <contract-path> [--set <text> --check] — S1 of epic #247.
 *
 * S1 is READ-ONLY on purpose: it answers "what will the published text be?"
 * without touching a byte. The dogfood that opened the epic had to hash
 * `facts/` before/after and read a `pasco build` scrollback to answer the same
 * question; this command replaces both and carries zero write risk.
 *
 * The published answer is derived from the ARTIFACT, never from the addressed row
 * alone (review of PR #331, F1: they are frequently different — a paste
 * surface publishes exactly ONE bio by length priority, a renderer may not emit
 * the field at all, and an active variant (#238) supplies the whole body). The
 * artifact text comes from `artifact-render.ts`, the SAME decision tree `build`
 * uses, so `--check` cannot drift from what gets written (N1 of the round-2
 * review: a second copy silently skipped build's selection-error gate).
 *
 * The WRITE is S2 (#249) and its mechanism is the recorded decision of
 * 2026-10-21 (`main@647c510`): a byte-range splice over the ORIGINAL text (the
 * CST locates, it never re-serializes), block/multi-line scalars refused,
 * no-op = 0 + `noop: true`, temp file + `load()`/schema over a temp copy +
 * atomic rename. It consumes the LOCATED node this resolver exposes
 * (`EditTarget.locate` — owning file + FILE-relative path) and never re-derives
 * an address; `locate` exists ONLY when the address resolves to exactly one row,
 * and only for writable addresses.
 *
 * #435 adds the answer-engine surface (`identity.definition.<lang>`,
 * `faq[id=…,lang=…].q|.a`, `faq[id=…].source`) under the SAME resolution rules,
 * plus `--create <root>` — a SEPARATE operation that seeds a root the workspace
 * does not declare yet (`facts/faq.yaml`). The splice still never invents
 * bytes; creation has its own guard (`edit-write.ts`, `edit-seed.ts`).
 */

import type {
  BioLength,
  Lang,
  LoadedProfile,
  MediaAsset,
  Platform,
  PlatformProfile,
} from "@profile-as-code/core";
import {
  collectMedia,
  deployStatus,
  driftCheck,
  LoadError,
  load,
  PLATFORMS,
  SchemaValidationError,
  structuredData,
} from "@profile-as-code/core";
import {
  compileSlice,
  publishedBio,
  renderArtifact,
  selectionErrorMessage,
  selectionFindings,
} from "../artifact-render.js";
import { capCatalog } from "../check-catalog.js";
import type { EditAddress, EditListBlock } from "../contract.js";
import {
  bioAddress,
  definitionAddress,
  faqAddress,
  headlineAddress,
  LANGS,
  linkAddress,
  parseEditAddress,
  statementAddress,
  UsageError,
} from "../contract.js";
import { DEFAULT_CHECKS } from "../default-checks.js";
import { SEED_FAQ_ENTRIES, type SeedableRoot, seedTemplate } from "../edit-seed.js";
import {
  createRoot,
  inspectTarget,
  owningFile,
  previewCreate,
  StaleEditError,
  type WriteOutcome,
  WriteRefusedError,
  writeEdit,
} from "../edit-write.js";
import { EXIT } from "../exit.js";
import { type ApplicableLimit, applicableLimit, contractLimit, limitFindings } from "../limits.js";
import { line, report, warn } from "../output.js";
import { resolveVariantBody } from "../variant-store.js";
import type { Pascorc } from "../workspace.js";

export interface EditArgs {
  workspace: string;
  addressArg?: string;
  setArg?: string;
  check: boolean;
  /** #411: read-only discovery of the workspace's contract paths. */
  list?: boolean;
  /** #411: scope `--list` to one block (unset = every block). */
  listBlock?: EditListBlock;
  /** #435: seed a root the workspace does not declare yet (a DIFFERENT
   *  operation from the splice; never combined with an address). */
  createRoot?: SeedableRoot;
  pascorc: Pascorc;
}

/** Every address that can carry a value (links are read-only). */
type EditableAddress = Exclude<EditAddress, { kind: "link" }>;

/** A selector value the address grammar can express (`key=value`, comma-separated). */
const SELECTOR_UNSAFE = /[,\]=]|"/;

/** The address of a link row, with its `label` when the row carries an
 *  ADDRESSABLE one — the disambiguator a legal workspace needs when two links
 *  share a platform. A label the grammar cannot express is reported with the row
 *  instead of being printed as an address that would not parse. */
function rowLinkAddress(row: { platform?: string; label?: string }): string {
  if (row.platform === undefined) return "<no platform — not addressable>";
  if (!selectorExpressible(row.platform)) {
    return `<not addressable: platform ${JSON.stringify(row.platform)} cannot be expressed>`;
  }
  const label = row.label !== undefined && selectorExpressible(row.label) ? row.label : undefined;
  return linkAddress(row.platform, label);
}

function linkNote(row: { platform?: string; label?: string }): string | undefined {
  const parts: string[] = [];
  if (row.platform === undefined) parts.push("no platform — not addressable");
  else if (!selectorExpressible(row.platform)) {
    parts.push(
      `platform ${JSON.stringify(row.platform)} cannot be expressed as a selector (empty, padded, control character or \`, ] = "\`)`,
    );
  }
  if (row.label !== undefined && !selectorExpressible(row.label)) {
    parts.push(
      `label ${JSON.stringify(row.label)} cannot be expressed as a selector (empty, padded, control character or \`, ] = "\`)`,
    );
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/**
 * A resolved contract path.
 *
 * `locate` is S2's write handle and carries TWO paths on purpose: `path` is
 * FILE-relative (what a CST can resolve in `facts/<root>.yaml` — the file's
 * root is the block itself, e.g. a `bios.yaml` array, not `{bios: [...]}`), and
 * `profilePath` is the merged-profile path `applyEdit` uses. Conflating them was
 * a defect of the review's round 1 (N5 of round 2); a test pins both.
 */
export interface EditTarget {
  address: EditAddress;
  locate?: {
    file: string;
    path: (string | number)[];
    profilePath: (string | number)[];
  };
  /** Exactly one match: the current value. */
  current?: string;
  /** How many rows the address resolves to: 0 (absent), 1 (addressable),
   *  >1 (several rows share the address — the command refuses to choose). */
  matches: number;
  /** The matched rows, so an ambiguous address is reported with its rows. */
  rows: { address: string; value: string; note?: string }[];
  /** Concrete addresses this workspace has for the addressed block — printed
   *  when the address resolves to 0 rows, so it is never a dead end. */
  available: string[];
}

type FaqEntry = NonNullable<LoadedProfile["faq"]>[number];

/** The rows an address selects — THE addressability rule. Resolution and
 *  `--list` both call these, so the list cannot drift into a second match
 *  predicate (#411 review round 4, F3). */
function headlineHits(profile: LoadedProfile, platform: Platform, lang: Lang) {
  return profile.headlines
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.platform === platform && row.lang === lang);
}

function bioHits(profile: LoadedProfile, platform: Platform, lang: Lang, length: BioLength) {
  return profile.bios
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.platform === platform && row.lang === lang && row.length === length);
}

type LinkRow = NonNullable<LoadedProfile["identity"]["links"]>[number];

function linkHits(links: LinkRow[], platform: string, label?: string) {
  return (links ?? [])
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        row.platform === platform && (label === undefined || (row.label ?? "") === label),
    );
}

/** `faq[]` rows selected by their stable `id` (#435) — never by index (#435's
 *  repro: the array index is what `audit` prints, and reordering rows would
 *  silently retarget it). A duplicated id matches N rows, which the command
 *  refuses rather than choosing one. */
function faqHits(rows: FaqEntry[], id: string) {
  return rows.map((row, index) => ({ row, index })).filter(({ row }) => row.id === id);
}

/** The scalar a `faq[id=…]` address resolves to. `q`/`a` are langMaps; `source`
 *  is a plain URL. An empty string counts as ABSENT, like a statement (#84). */
function faqValue(row: FaqEntry, field: "q" | "a" | "source", lang?: Lang): string | undefined {
  if (field === "source")
    return row.source === undefined || row.source === "" ? undefined : row.source;
  const value = (row[field] as Record<string, string> | undefined)?.[lang as string];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Resolve a contract path against the loaded profile.
 *
 * The row index is the index in the WORKSPACE ARRAY: `load()` merges one root
 * property per file and never reorders, so it is also the index in the file.
 */
export function resolveEditTarget(
  profile: LoadedProfile,
  address: EditAddress,
  workspace: string,
): EditTarget {
  if (address.kind === "statement") {
    const statement: Record<string, string> = profile.positioning?.statement ?? {};
    const value = statement[address.lang];
    // An empty string counts as ABSENT: compile() treats "" as absent (#84).
    const present = typeof value === "string" && value !== "";
    // Only the contract's langs are addressable — a langMap catchall key (e.g.
    // "de") is schema-legal but never renders, so listing it would be a trap.
    const available = LANGS.filter(
      (lang) => typeof statement[lang] === "string" && statement[lang] !== "",
    ).map((lang) => statementAddress(lang as Lang));
    const file = owningFile(workspace, "positioning");
    return {
      address,
      ...(present && file !== undefined
        ? {
            locate: {
              file,
              path: ["statement", address.lang],
              profilePath: ["positioning", "statement", address.lang],
            },
          }
        : {}),
      ...(present ? { current: value } : {}),
      matches: present ? 1 : 0,
      rows: present ? [{ address: address.address, value }] : [],
      available,
    };
  }

  if (address.kind === "headline") {
    const hits = headlineHits(profile, address.platform, address.lang);
    const file = owningFile(workspace, "headlines");
    return {
      address,
      ...(hits.length === 1 && file !== undefined
        ? {
            locate: {
              file,
              path: [hits[0]?.index as number, "text"],
              profilePath: ["headlines", hits[0]?.index as number, "text"],
            },
          }
        : {}),
      ...(hits.length === 1 ? { current: hits[0]?.row.text as string } : {}),
      matches: hits.length,
      rows: hits.map(({ row }) => ({
        address: headlineAddress(row.platform, row.lang),
        value: row.text,
      })),
      available: [
        ...new Set(profile.headlines.map((row) => headlineAddress(row.platform, row.lang))),
      ],
    };
  }

  if (address.kind === "bio") {
    const hits = bioHits(profile, address.platform, address.lang, address.length);
    const file = owningFile(workspace, "bios");
    return {
      address,
      ...(hits.length === 1 && file !== undefined
        ? {
            locate: {
              file,
              path: [hits[0]?.index as number, "text"],
              profilePath: ["bios", hits[0]?.index as number, "text"],
            },
          }
        : {}),
      ...(hits.length === 1 ? { current: hits[0]?.row.text as string } : {}),
      matches: hits.length,
      rows: hits.map(({ row }) => ({
        address: bioAddress(row.platform, row.lang, row.length),
        value: row.text,
      })),
      available: [
        ...new Set(profile.bios.map((row) => bioAddress(row.platform, row.lang, row.length))),
      ],
    };
  }

  if (address.kind === "definition") {
    const definition: Record<string, string> = profile.identity.definition ?? {};
    const value = definition[address.lang];
    // Empty string counts as ABSENT, the same rule compile()/statement use (#84).
    const present = typeof value === "string" && value !== "";
    const available = LANGS.filter(
      (lang) => typeof definition[lang] === "string" && definition[lang] !== "",
    ).map((lang) => definitionAddress(lang as Lang));
    const file = owningFile(workspace, "identity");
    return {
      address,
      ...(present && file !== undefined
        ? {
            locate: {
              file,
              path: ["definition", address.lang],
              profilePath: ["identity", "definition", address.lang],
            },
          }
        : {}),
      ...(present ? { current: value } : {}),
      matches: present ? 1 : 0,
      rows: present ? [{ address: address.address, value }] : [],
      available,
    };
  }

  if (address.kind === "faq") {
    const rows = profile.faq ?? [];
    const hits = faqHits(rows, address.id);
    const file = owningFile(workspace, "faq");
    const first = hits[0];
    const value =
      hits.length === 1 && first !== undefined
        ? faqValue(first.row, address.field, address.lang)
        : undefined;
    // >1 row sharing the id is ambiguity even when the addressed value is absent
    // in one of them: `edit` refuses to choose a row first.
    const matches = hits.length > 1 ? hits.length : value === undefined ? 0 : 1;
    const available = [
      ...new Set(
        rows.flatMap((row) => {
          const out: string[] = [];
          for (const lang of LANGS) {
            if (faqValue(row, "q", lang as Lang) !== undefined) {
              out.push(faqAddress(row.id, "q", lang as Lang));
            }
            if (faqValue(row, "a", lang as Lang) !== undefined) {
              out.push(faqAddress(row.id, "a", lang as Lang));
            }
          }
          if (faqValue(row, "source", undefined) !== undefined) {
            out.push(faqAddress(row.id, "source"));
          }
          return out;
        }),
      ),
    ];
    const locateIndex = first?.index;
    return {
      address,
      ...(matches === 1 && file !== undefined && locateIndex !== undefined
        ? {
            locate: {
              file,
              path:
                address.field === "source"
                  ? [locateIndex, "source"]
                  : [locateIndex, address.field, address.lang as Lang],
              profilePath:
                address.field === "source"
                  ? ["faq", locateIndex, "source"]
                  : ["faq", locateIndex, address.field, address.lang as Lang],
            },
          }
        : {}),
      ...(matches === 1 ? { current: value } : {}),
      matches,
      rows:
        hits.length > 1
          ? hits.map(({ row }) => ({
              address: faqAddress(row.id, address.field, address.lang),
              value: faqValue(row, address.field, address.lang) ?? "",
            }))
          : matches === 1
            ? [{ address: address.address, value: value as string }]
            : [],
      available,
    };
  }

  const links = profile.identity.links ?? [];
  const hits = linkHits(links, address.platform, address.label);
  return {
    address,
    // Read-only address: no write handle is emitted (S2 must not grow a second
    // write path for the URL SSOT, §3).
    ...(hits.length === 1 ? { current: hits[0]?.row.url as string } : {}),
    matches: hits.length,
    rows: hits.map(({ row }) => ({
      address: rowLinkAddress(row) ?? "<not addressable>",
      value: row.url,
      ...(linkNote(row) === undefined ? {} : { note: linkNote(row) as string }),
    })),
    available: [
      ...new Set(
        links
          .map((row) => rowLinkAddress(row))
          .filter((candidate): candidate is string => candidate !== undefined),
      ),
    ],
  };
}

/** One addressable row of the read-only `--list` surface (#411). */
export interface EditAddressEntry {
  address: string;
  kind: EditAddress["kind"];
  /** Links are the one address the grammar marks read-only (URL SSOT, §3). */
  readOnly: boolean;
}

/** A selector value the grammar accepts as `key=value` WITHOUT changing it: not
 *  empty (an empty value is a usage error), already trimmed (the parser trims,
 *  so a padded value would resolve to a different row) and free of the
 *  delimiters. A row carrying one is reported, never printed (#411 review F2). */
function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x2028 || code === 0x2029) return true; // line/paragraph separators
  }
  return false;
}

function selectorExpressible(value: string): boolean {
  return (
    value !== "" && value === value.trim() && !hasControlChar(value) && !SELECTOR_UNSAFE.test(value)
  );
}

/**
 * Every addressable row of the loaded workspace, in block order
 * (`positioning` → `headlines` → `bios` → `identity.links`), each address built
 * by the SAME constructor `resolveEditTarget` uses — no second grammar (#411).
 *
 * "Addressable" means the address resolves to EXACTLY one row, the same bar
 * `edit` enforces: a duplicate headline/bio and a label-less link on a platform
 * it shares with another link match N>1 rows (the command refuses to choose
 * them), so they are reported as warnings, never printed as a usable path. A
 * platform the grammar cannot express (empty, padded, control char, or `, ] = "`)
 * is a warning; an inexpressible LABEL is dropped and the row is listed by its
 * platform when that resolves to one row.
 */
export function listEditAddresses(
  profile: LoadedProfile,
  block?: EditListBlock,
): { addresses: EditAddressEntry[]; warnings: string[] } {
  const addresses: EditAddressEntry[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const scoped = (candidate: EditListBlock): boolean => block === undefined || block === candidate;
  const warnOnce = (message: string): void => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const add = (
    address: string,
    kind: EditAddress["kind"],
    matches: number,
    readOnly = false,
  ): void => {
    if (seen.has(address)) return;
    seen.add(address);
    if (matches !== 1) {
      warnOnce(
        `${address} resolves to ${matches} rows — several rows share it and edit refuses to choose; not listed`,
      );
      return;
    }
    addresses.push({ address, kind, readOnly });
  };

  if (scoped("positioning")) {
    const statement: Record<string, string> = profile.positioning?.statement ?? {};
    for (const lang of LANGS) {
      // Empty string is ABSENT to compile() (#84) — listing it would be a trap.
      if (typeof statement[lang] === "string" && statement[lang] !== "") {
        add(statementAddress(lang as Lang), "statement", 1);
      }
    }
  }

  if (scoped("headlines")) {
    const counts = new Map<string, number>();
    for (const row of profile.headlines) {
      const address = headlineAddress(row.platform, row.lang);
      counts.set(address, (counts.get(address) ?? 0) + 1);
    }
    for (const row of profile.headlines) {
      const address = headlineAddress(row.platform, row.lang);
      add(address, "headline", counts.get(address) ?? 0);
    }
  }

  if (scoped("bios")) {
    const counts = new Map<string, number>();
    for (const row of profile.bios) {
      const address = bioAddress(row.platform, row.lang, row.length);
      counts.set(address, (counts.get(address) ?? 0) + 1);
    }
    for (const row of profile.bios) {
      const address = bioAddress(row.platform, row.lang, row.length);
      add(address, "bio", counts.get(address) ?? 0);
    }
  }

  if (scoped("identity.definition")) {
    const definition: Record<string, string> = profile.identity.definition ?? {};
    for (const lang of LANGS) {
      // Empty string is ABSENT to compile() (#84) — listing it would be a trap.
      if (typeof definition[lang] === "string" && definition[lang] !== "") {
        add(definitionAddress(lang as Lang), "definition", 1);
      }
    }
  }

  if (scoped("identity.links")) {
    const links = profile.identity.links ?? [];
    links.forEach((row, index) => {
      const where = `identity.links[${index}]`;
      if (row.platform === undefined) {
        warnOnce(`${where} has no platform — not addressable, not listed`);
        return;
      }
      if (!selectorExpressible(row.platform)) {
        warnOnce(
          `${where}: platform ${JSON.stringify(row.platform)} cannot be expressed as a selector (empty, padded, control character, or carrying a comma, bracket, equals sign or quote) — not listed`,
        );
        return;
      }
      // A label the grammar cannot express is not a reason to drop the row:
      // fall back to the platform-only address whenever THAT resolves to one row
      // (the address `edit` accepts and a 0-row read advertises).
      const label =
        row.label !== undefined && selectorExpressible(row.label) ? row.label : undefined;
      const matches = linkHits(links, row.platform, label).length;
      add(linkAddress(row.platform, label), "link", matches, true);
      if (row.label !== undefined && label === undefined && matches === 1) {
        warnOnce(
          `${where}: label ${JSON.stringify(row.label)} cannot be expressed as a selector (empty, padded, or carrying a comma, bracket, equals sign, quote or control character) — listed by its platform only`,
        );
      }
    });
  }

  if (scoped("faq")) {
    const rows = profile.faq ?? [];
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    for (const row of rows) {
      const matches = counts.get(row.id) ?? 0;
      for (const lang of LANGS) {
        if (faqValue(row, "q", lang as Lang) !== undefined) {
          add(faqAddress(row.id, "q", lang as Lang), "faq", matches);
        }
        if (faqValue(row, "a", lang as Lang) !== undefined) {
          add(faqAddress(row.id, "a", lang as Lang), "faq", matches);
        }
      }
      if (faqValue(row, "source", undefined) !== undefined) {
        add(faqAddress(row.id, "source"), "faq", matches);
      }
    }
  }

  return { addresses, warnings };
}

/** Apply the proposal to an in-memory copy. S1 never writes it anywhere; the
 *  point is that `--check` renders the SAME profile the write will. */
export function applyEdit(
  profile: LoadedProfile,
  target: EditTarget & { locate: NonNullable<EditTarget["locate"]> },
  value: string,
): LoadedProfile {
  const copy = structuredClone(profile) as LoadedProfile;
  const path = target.locate.profilePath;
  let cursor: unknown = copy;
  for (const key of path.slice(0, -1)) {
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  const last = path[path.length - 1] as string | number;
  (cursor as Record<string | number, unknown>)[last] = value;
  return copy;
}

/** A rendered artifact, plus the slice it came from (needed to explain a miss). */
interface ArtifactView {
  text: string;
  source: "variant" | "renderer" | "paste";
  variantId?: string;
  slice: PlatformProfile;
}

/** The artifact view of an already-compiled slice (the compile and its selection
 *  gate live in `artifact-render.ts`, shared with `build`). */
function viewOf(
  slice: PlatformProfile,
  workspace: string,
  assets: readonly MediaAsset[],
): ArtifactView {
  return { ...renderArtifact(slice, workspace, assets), slice };
}

/** The contiguous lines that differ between two artifacts (common prefix and
 *  suffix trimmed): the published text an edit produces, without a diff
 *  dependency and without the surrounding artifact. */
function changedRegion(
  before: string,
  after: string,
): { before: string; after: string } | undefined {
  if (before === after) return undefined;
  const b = before.split("\n");
  const a = after.split("\n");
  let prefix = 0;
  while (prefix < b.length && prefix < a.length && b[prefix] === a[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < b.length - prefix &&
    suffix < a.length - prefix &&
    b[b.length - 1 - suffix] === a[a.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    before: b.slice(prefix, b.length - suffix).join("\n"),
    after: a.slice(prefix, a.length - suffix).join("\n"),
  };
}

/** Why an edit does not change the artifact — named, never guessed. */
function explainMiss(artifact: ArtifactView, address: EditableAddress, platform: Platform): string {
  if (artifact.source === "variant") {
    return `an active variant${artifact.variantId === undefined ? "" : ` (#238, ${artifact.variantId})`} supplies the ${platform} artifact body — the SSOT text does not reach it`;
  }
  if (artifact.text === "") {
    return `the ${platform} artifact is empty for this lang (no bio row) — \`pasco build ${platform}\` writes nothing`;
  }
  if (address.kind === "bio") {
    const published =
      artifact.source === "paste"
        ? publishedBio(artifact.slice)
        : artifact.slice.bios.find((row) => artifact.text.includes(row.text));
    if (published !== undefined) {
      return `the ${platform} artifact publishes the \`${published.length}\` bio — the addressed \`${address.length}\` row is never emitted`;
    }
    return `the ${platform} renderer does not emit a bio from this row`;
  }
  if (address.kind === "headline") {
    if (artifact.source === "paste") {
      return `the ${platform} artifact is the paste source (one bio, verbatim) — it carries no headline`;
    }
    return `the ${platform} renderer does not emit this headline`;
  }
  if (address.kind === "definition") {
    return `the ${platform} artifact embeds no entity JSON-LD — only a renderer that emits it publishes identity.definition`;
  }
  return "no rendered artifact carries this statement — only renderers that emit it can publish it";
}

/** The published surface of one edit: the artifact lines that change, per
 *  platform, or the reason none do (or the selection error `build` would refuse). */
interface Published {
  changes: { platform: string; before: string; after: string }[];
  reason?: string;
  error?: string;
}

/** Pretty JSON — the preview's text form of the entity projection. `<` is
 *  escaped exactly as `entity`'s script serializer escapes it (`jsonLdScript`,
 *  `commands/entity.ts`), so the previewed bytes are the published bytes and a
 *  URL cannot terminate the `<script>` early (#435 fresh pass, F3). */
function jsonText(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

function publishedByEdit(
  before: LoadedProfile,
  after: LoadedProfile,
  address: EditableAddress,
  workspace: string,
  pascorc: Pascorc,
): Published {
  // #435: `faq[]` has no `pasco build` artifact — its published surface is the
  // `FAQPage` node `pasco entity --jsonld` emits (#360), from the same assembler
  // (`structuredData`, never a second emitter). Preview THAT, so `--check` is
  // meaningful for the field the issue is about.
  if (address.kind === "faq") {
    const lang = address.lang ?? "en";
    const oldNode = jsonText(structuredData(before, lang).faqJsonLd);
    const newNode = jsonText(structuredData(after, lang).faqJsonLd);
    const region = changedRegion(oldNode, newNode);
    if (region !== undefined) {
      return { changes: [{ platform: "entity", ...region }] };
    }
    return {
      changes: [],
      reason:
        "faq[] reaches the FAQPage node of `pasco entity --jsonld` (#360), and this edit does not change that node's bytes",
    };
  }
  const media = collectMedia(before, workspace);
  const platforms: Platform[] =
    address.kind === "statement" || address.kind === "definition"
      ? [...PLATFORMS]
      : [address.platform];
  // `build`'s selection gate runs over ITS slice set: a bare `pasco build`
  // compiles every platform (the brand-only surface included) and refuses on any
  // per-view error. The preview must refuse identically even when the addressed
  // platform is fine — otherwise it promises an artifact `build` will not write
  // (round-3 review, F1).
  const beforeSlices = new Map<Platform, PlatformProfile>();
  for (const platform of PLATFORMS) {
    beforeSlices.set(platform, compileSlice(before, platform, address.lang, pascorc));
  }
  const findings = selectionFindings([...beforeSlices.values()]);
  if (findings.some((finding) => finding.severity === "error")) {
    return { changes: [], error: selectionErrorMessage(findings) };
  }
  const changes: Published["changes"] = [];
  let reason: string | undefined;
  for (const platform of platforms) {
    if (platform === "github-org" && before.flavor !== "brand") {
      reason ??= `the ${platform} artifact is not rendered for this workspace (§17: brand-only surface)`;
      continue;
    }
    const a = viewOf(beforeSlices.get(platform) as PlatformProfile, workspace, media.assets);
    const b = viewOf(compileSlice(after, platform, address.lang, pascorc), workspace, media.assets);
    const region = changedRegion(a.text, b.text);
    if (region !== undefined) changes.push({ platform, ...region });
    else reason ??= explainMiss(a, address, platform);
  }
  return changes.length > 0 ? { changes } : { changes: [], reason };
}

function failLoad(err: unknown): number {
  if (err instanceof SchemaValidationError) {
    return report("edit", false, EXIT.FAIL, {
      error: {
        kind: "schema",
        message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
        violations: [...err.issues],
      },
    });
  }
  if (err instanceof LoadError) {
    return report("edit", false, EXIT.FAIL, { error: { kind: "load", message: err.message } });
  }
  throw err;
}

/** The §19.2 ledger key of the unit an address edits — `deployStatus` reads the
 *  ledger by this key, so the report and `pasco status` cannot disagree. `faq`
 *  is a root block with NO §19 unit (faq rows are not tracked), so it returns
 *  `undefined`: the report says nothing rather than naming a fabricated unit. */
function ledgerKeyOf(address: EditableAddress): string | undefined {
  if (address.kind === "statement") return "positioning";
  if (address.kind === "definition") return "identity";
  if (address.kind === "faq") return undefined;
  if (address.kind === "bio") {
    return `bios:${address.platform}:${address.lang}:${address.length}`;
  }
  return `headlines:${address.platform}:${address.lang}`;
}

/** The §19 state of the unit an address edits. `deployStatus` is the authority;
 *  its `surfaces` only lists RECORDED surfaces (`in-sync|stale`), so the unit's
 *  `state` carries the `never` rollup (a core SyncState has no per-surface
 *  never — the acceptance's "no record reads never" is the rollup's answer). */
interface LedgerImpact {
  key: string;
  state: string;
  surfaces: Record<string, string>;
}

function ledgerImpact(profile: LoadedProfile, address: EditableAddress): LedgerImpact | undefined {
  const key = ledgerKeyOf(address);
  if (key === undefined) return undefined; // `faq[]` has no §19 unit
  const unit = deployStatus(profile).units.find((candidate) => candidate.key === key);
  return { key, state: unit?.state ?? "never", surfaces: unit?.surfaces ?? {} };
}

/** The text-limit pre-flight of one row (#251): the catalog's own cap, with its
 *  cited source, or `undefined` when the catalog has none (never a guessed
 *  number — evidence rule). WARN, not a block (D12) — except the #435 contract
 *  caps, which the schema ENFORCES (`enforced` says so in the report). */
interface LimitPreflight {
  limit?: ApplicableLimit;
  length: number;
  over: boolean;
  /** True when the contract itself enforces the cap (a schema maxLength): the
   *  value previews, but the write would be refused by validation (D12). */
  enforced?: boolean;
}

/** The human label of the value a cap applies to. */
function limitScope(address: EditAddress): string {
  if (address.kind === "link") return "link";
  if (address.kind === "definition") return "definition";
  if (address.kind === "faq")
    return address.field === "source" ? "faq source" : `faq ${address.field}`;
  return address.kind === "bio" ? "bio" : "headline";
}

function limitPreflight(
  profile: LoadedProfile,
  address: EditableAddress,
  text: string,
): LimitPreflight | undefined {
  if (address.kind === "statement" || (address.kind === "faq" && address.field === "source")) {
    return undefined; // no published text cap on a statement or a URL
  }
  const length = [...text].length;
  if (address.kind === "definition" || address.kind === "faq") {
    const limit = contractLimit(
      address.kind === "definition" ? "definition" : address.field === "q" ? "faq.q" : "faq.a",
    );
    return { limit, length, over: length > limit.cap, enforced: true };
  }
  const surface = address.kind === "bio" ? "bio" : "headline";
  const checks = capCatalog(profile, DEFAULT_CHECKS);
  const limit = applicableLimit(checks, address.platform, surface);
  return {
    ...(limit === undefined ? {} : { limit }),
    length,
    over: limit !== undefined && length > limit.cap,
  };
}

/** A statement renders on every platform that has a row in its language; an
 *  active #238 variant on any of them supplies that artifact wholesale, so the
 *  edit does not reach it — name the variants (the human path already does). */
function statementVariantWarnings(
  profile: LoadedProfile,
  workspace: string,
  pascorc: Pascorc,
  lang: string,
): string[] {
  const out: string[] = [];
  const platforms = new Set(
    [...(profile.bios ?? []), ...(profile.headlines ?? [])]
      .filter((row) => row.lang === lang)
      .map((row) => row.platform),
  );
  for (const platform of [...platforms].sort()) {
    const slice = compileSlice(profile, platform, lang as "en" | "es" | "fr", pascorc);
    const variant = resolveVariantBody(workspace, slice);
    if (variant.text !== undefined && variant.id !== undefined) {
      out.push(
        `an active variant (#238, ${variant.id}) supplies the ${platform} artifact body — this statement does not reach it`,
      );
    }
  }
  return out;
}

/** Non-blocking findings of one run: a selection error the write proceeded
 *  through, an over-cap value, and a catalog row the executor cannot read. */
function warningsForEdit(
  published: Published,
  preflight: LimitPreflight | undefined,
  profile: LoadedProfile,
  address: EditAddress,
  workspace: string,
  pascorc: Pascorc,
): string[] {
  const out: string[] = [];
  if (published.error !== undefined) out.push(published.error);
  if (address.kind === "statement") {
    out.push(...statementVariantWarnings(profile, workspace, pascorc, address.lang));
  }
  if (preflight?.limit !== undefined && preflight.over) {
    out.push(
      preflight.enforced === true
        ? `${preflight.length} chars is over the contract cap ${preflight.limit.cap} — the schema refuses the write (D12): shorten it first (${preflight.limit.source})`
        : `${preflight.length} chars is over the published cap ${preflight.limit.cap} (${preflight.limit.source})`,
    );
  }
  if (address.kind === "headline" || address.kind === "bio") {
    const checks = capCatalog(profile, DEFAULT_CHECKS);
    for (const finding of limitFindings(profile, checks, address.platform)) {
      if (finding.message.includes("non-numeric")) out.push(finding.message);
    }
  }
  return out;
}

/** Human scope label of an address: which artifact(s) carry it. */
function scopeLabel(address: EditAddress): string {
  if (address.kind === "statement") return "every rendered platform";
  if (address.kind === "definition") return "every artifact that embeds the entity JSON-LD";
  if (address.kind === "faq") return "the entity FAQPage (`pasco entity --jsonld`, #360)";
  if (address.kind === "link") return "verbatim — the URL SSOT (§3)";
  return `${address.platform}/${address.lang}`;
}

export function runEdit(args: EditArgs): number {
  let profile: LoadedProfile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    return failLoad(err);
  }

  // #435: `--create` is a DIFFERENT operation — it seeds a root the workspace
  // does not declare yet. It never resolves an address or touches the splice.
  if (args.createRoot !== undefined) return runCreate(args);

  // #411: discovery is a READ-ONLY mode — it never resolves a target, locates a
  // CST node or touches the edit lock. Same constructors as resolution: the list
  // is what the address grammar actually accepts in this workspace.
  if (args.list === true) {
    const listed = listEditAddresses(profile, args.listBlock);
    line("addresses:");
    for (const entry of listed.addresses) {
      line(`${entry.address}${entry.readOnly ? "  (read-only)" : ""}`);
    }
    for (const warning of listed.warnings) warn(warning);
    return report("edit", true, EXIT.OK, {
      data: { addresses: listed.addresses, warnings: listed.warnings },
    });
  }

  if (args.addressArg === undefined) {
    throw new UsageError("usage: pasco edit <contract-path> [--set <text> --check]");
  }
  const address = parseEditAddress(args.addressArg);

  // Read-only address: the grammar says so, and S2 must not grow a second write
  // path for links (identity.yaml carries the URL SSOT — §3).
  if (address.kind === "link" && args.setArg !== undefined) {
    throw new UsageError(
      `${address.address} is read-only — links live in facts/identity.yaml (the URL SSOT, §3)`,
    );
  }
  if (args.check && args.setArg === undefined) {
    throw new UsageError(
      "--check previews a proposed value — add --set <text> (without it, the read already prints the current value)",
    );
  }
  if (args.setArg === "") {
    throw new UsageError(
      '--set text must not be empty: compile() treats "" as absent (#84), so it could never render',
    );
  }
  if (args.setArg !== undefined && /[\r\n]/.test(args.setArg)) {
    throw new UsageError(
      "--set with a line break is refused: the writer (#249) handles single-line scalars only (block scalars are refused: they would change the line count)",
    );
  }

  const target = resolveEditTarget(profile, address, args.workspace);
  const proposed = args.setArg;
  const writing = proposed !== undefined && !args.check;
  const noopValue = proposed !== undefined && proposed === target.current;

  let ok = target.matches === 1;
  let published: Published = { changes: [] };
  let outcome: WriteOutcome | undefined;
  // S3 (#250): the edit's impact on what was already published — DERIVED from
  // core's §19 ledger (`deployStatus`), never stored (SPEC §20). `drift` is
  // ALWAYS measured (a read reports the current profile's count; a 0 that was
  // never computed is a fabricated number — round-1 review of #335, F1).
  let impact: LedgerImpact | undefined;
  let drift = driftCheck(profile).length;
  if (address.kind !== "link" && target.matches === 1) impact = ledgerImpact(profile, address);
  const preflight =
    address.kind !== "link" && target.matches === 1
      ? limitPreflight(profile, address, proposed ?? (target.current as string))
      : undefined;
  // #238 guard: an active variant supplies the whole artifact body, so the SSOT
  // text this edit changes is NOT what gets published on that platform. Name the
  // variant — never silently edit a field the renderer ignores.
  let activeVariant: string | undefined;
  if ((address.kind === "headline" || address.kind === "bio") && target.matches === 1) {
    const slice = compileSlice(profile, address.platform, address.lang, args.pascorc);
    const variant = resolveVariantBody(args.workspace, slice);
    if (variant.text !== undefined && variant.id !== undefined) activeVariant = variant.id;
  }

  if (proposed !== undefined && !noopValue && address.kind !== "link") {
    const located = target.locate;
    if (target.matches !== 1) {
      ok = false; // 0 rows / ambiguous: nothing to preview and nothing to write
    } else if (located === undefined) {
      // A resolved row always has an owning file; if the handle is missing the
      // honest answer is "no preview, no write", never a guess.
      ok = false;
      published = {
        changes: [],
        reason:
          "no owning content file for this block — the write handle is unavailable (the splice cannot run)",
      };
    } else {
      // Eligibility + staleness FIRST: the preview and the write must refuse the
      // same shapes (F1) and neither may act on a file that moved since `load()`.
      try {
        inspectTarget({ workspace: args.workspace, target: located, expect: target.current });
      } catch (err) {
        if (err instanceof UsageError) throw err;
        if (err instanceof StaleEditError || err instanceof WriteRefusedError) {
          return report("edit", false, EXIT.FAIL, {
            error: {
              kind: err instanceof StaleEditError ? "stale" : "refused",
              message: err.message,
            },
          });
        }
        throw err;
      }
      const applied = applyEdit(profile, { ...target, locate: located }, proposed);
      impact = ledgerImpact(applied, address);
      drift = driftCheck(applied).length;
      published = publishedByEdit(profile, applied, address, args.workspace, args.pascorc);
      if (published.error !== undefined && !writing) {
        return report("edit", false, EXIT.FAIL, {
          error: {
            kind: "selection",
            message: `${published.error} (pasco build refuses to write this workspace)`,
          },
        });
      }
      if (writing) {
        try {
          outcome = writeEdit({
            workspace: args.workspace,
            target: located,
            value: proposed,
            expect: target.current,
          });
          ok = true;
        } catch (err) {
          if (err instanceof UsageError) throw err;
          if (err instanceof StaleEditError || err instanceof WriteRefusedError) {
            return report("edit", false, EXIT.FAIL, {
              error: {
                kind: err instanceof StaleEditError ? "stale" : "refused",
                message: err.message,
              },
            });
          }
          if (err instanceof SchemaValidationError || err instanceof LoadError) {
            return report("edit", false, EXIT.FAIL, {
              error: {
                kind: err instanceof SchemaValidationError ? "schema" : "load",
                message: err.message,
                ...(err instanceof SchemaValidationError ? { violations: [...err.issues] } : {}),
              },
            });
          }
          throw err;
        }
      } else {
        ok = published.changes.length > 0;
      }
    }
  }

  line(`address:  ${target.address.address}`);
  if (writing && outcome !== undefined) line(`file:     ${outcome.file}`);
  if (activeVariant !== undefined && (address.kind === "headline" || address.kind === "bio")) {
    line(
      `variant:  ${activeVariant} is active for ${address.platform} — the artifact renders the variant body (pasco refine --choose), not this text`,
    );
  }
  if (target.matches === 1) {
    line(`current:  ${target.current}`);
    if (proposed !== undefined) {
      line(`proposed: ${proposed}`);
      if (noopValue) {
        line("(noop) the proposed value is identical to the current one — nothing was written");
      } else if (outcome !== undefined) {
        line(outcome.noop ? "(noop) the file already held this value" : "written: yes");
        line(`validates: yes (schema; drift ${drift})`);
      }

      if (published.changes.length > 0) {
        const lang = "lang" in address ? `/${address.lang}` : "";
        for (const change of published.changes) {
          line(`published (${change.platform}${lang} — the artifact lines this edit changes):`);
          for (const oldLine of change.before.split("\n")) line(`  - ${oldLine}`);
          for (const newLine of change.after.split("\n")) line(`  + ${newLine}`);
        }
        if (published.changes.length > 1) {
          line(`published in: ${published.changes.map((change) => change.platform).join(", ")}`);
        }
      } else if (outcome !== undefined) {
        // Written but not published: legitimate (the SSOT may carry a row no
        // artifact emits) — the caller must know it, not be blocked by it.
        line(
          `published (${scopeLabel(address)}): this edit does not change the artifact \`pasco build\` writes`,
        );
        if (published.reason !== undefined) line(`  why: ${published.reason}`);
      } else if (published.reason !== undefined) {
        line(
          `published (${scopeLabel(address)}): no change — the artifact \`pasco build\` writes is byte-identical before and after`,
        );
        line(`  why: ${published.reason}`);
      }
    }
  } else if (target.matches === 0) {
    line("resolves to 0 rows — no current value");
    if (proposed !== undefined) {
      line(`proposed: ${proposed}`);
      line(
        "(edit does not create rows: the field must already exist in the schema and the file; --create seeds a root the workspace does not declare yet)",
      );
    }
    if (target.available.length > 0) {
      line("available:");
      for (const candidate of target.available) line(`  ${candidate}`);
    }
  } else {
    const kind =
      address.kind === "bio"
        ? "a duplicate row is drift/duplicate-bio"
        : address.kind === "link"
          ? "several links share this platform — add label=<…> (not a drift finding: drift flags the same URL twice)"
          : address.kind === "faq"
            ? "several faq rows share this id — fix the duplicate id first"
            : "several rows share this address";
    line(`resolves to ${target.matches} rows — ${kind}; edit refuses to choose`);
    target.rows.forEach((row, index) => {
      line(
        `  ${index + 1}. ${row.address} = ${row.value}${row.note === undefined ? "" : `  (${row.note})`}`,
      );
    });
  }

  if (preflight !== undefined) {
    const scope = limitScope(address);
    if (preflight.limit === undefined) {
      line(
        `limits: ${preflight.length} chars — cap unknown (no sourced max-chars for this ${scope} in the catalog: the workspace's facts/checks.yaml or the caps shipped with pasco)`,
      );
    } else {
      const over = preflight.over ? " — OVER" : " — ok";
      line(
        `limits: ${preflight.length} chars vs cap ${preflight.limit.cap}${preflight.limit.checkId === undefined ? "" : ` (${preflight.limit.checkId})`}${over} — ${preflight.limit.source}`,
      );
      if (preflight.over) {
        warn(
          preflight.enforced === true
            ? `${scope} is ${preflight.length} chars, over the contract cap ${preflight.limit.cap} — the schema refuses the write (D12); shorten it (${preflight.limit.source})`
            : `${scope} is ${preflight.length} chars, over the published cap ${preflight.limit.cap} — the platform may truncate it (${preflight.limit.source})`,
        );
      }
    }
  }

  if (impact !== undefined) {
    // The ledger tracks the SSOT UNIT, the published block tracks the ARTIFACT:
    // an edit can invalidate a recorded surface while no artifact changes (a
    // headline on a paste-only surface) — two axes, both true (review of #335, F7).
    line(
      `surface impact (${impact.key} — §19 ledger, derived per run, never stored; the SSOT unit, not the artifact):`,
    );
    const surfaces = Object.entries(impact.surfaces).sort(([a], [b]) => (a < b ? -1 : 1));
    if (surfaces.length === 0) {
      line("  never — no ledger record for this unit (state: never)");
    } else {
      for (const [surface, state] of surfaces) {
        // True on a read/noop too: the record's hash differs from the unit's
        // CURRENT contentHash (no claim that an edit just ran) — review F/N2.
        line(
          `  ${surface} → ${state}${state === "stale" ? " (the record's hash differs from the unit's current contentHash)" : " (the record's hash still matches)"}`,
        );
      }
    }
    line(`  drift: ${drift}`);
  }

  if (published.error !== undefined && writing) {
    line(`warning: ${published.error} (pasco build refuses to render this workspace)`);
  }

  const rendered =
    published.changes.length === 0
      ? null
      : published.changes.map((change) => change.after).join("\n");

  return report("edit", ok, ok ? EXIT.OK : EXIT.FAIL, {
    data: {
      address: target.address.address,
      current: target.matches === 1 ? target.current : null,
      proposed: proposed ?? null,
      rendered,
      ok,
      noop: outcome === undefined ? noopValue : outcome.noop,
      written: outcome !== undefined && !outcome.noop,
      warnings: warningsForEdit(
        published,
        preflight,
        profile,
        address,
        args.workspace,
        args.pascorc,
      ),
      stale: impact?.surfaces ?? {},
      state: impact?.state ?? null,
      drift,
      limit:
        preflight?.limit === undefined
          ? null
          : {
              cap: preflight.limit.cap,
              source: preflight.limit.source,
              tier: preflight.limit.tier,
            },
      over: preflight?.over ?? false,
      variant: activeVariant ?? null,
      reason: published.reason ?? null,
    },
  });
}

/** One seed limit measured before writing: the contract cap and the longest
 *  value the template holds for it. */
interface SeedLimit {
  field: "q" | "a";
  cap: number;
  length: number;
  over: boolean;
  source: string;
}

/** The cap pre-flight of a seed (#435): the same contract caps `--set` uses,
 *  measured over the template's own values. Over-cap is impossible for the
 *  shipped template (a test pins it), and it would be a schema FAILURE anyway —
 *  the point is that creation runs the SAME pre-flight, not a weaker one. */
function seedLimits(root: SeedableRoot): SeedLimit[] {
  if (root !== "faq") return []; // exhaustive over SeedableRoot (one today)
  const limits: SeedLimit[] = [];
  for (const field of ["q", "a"] as const) {
    const limit = contractLimit(field === "q" ? "faq.q" : "faq.a");
    const length = Math.max(...SEED_FAQ_ENTRIES.map((entry) => [...entry[field]].length));
    limits.push({
      field,
      cap: limit.cap,
      length,
      over: length > limit.cap,
      source: limit.source,
    });
  }
  return limits;
}

/**
 * `pasco edit --create <root>` (#435) — a SEPARATE operation from the splice:
 * it seeds a root the workspace does not declare yet, refuses an existing root
 * (idempotent), validates the result through the same `load()` gate and runs
 * the same cap pre-flight. `--check` previews it (validates, writes nothing).
 */
function runCreate(args: EditArgs): number {
  const root = args.createRoot as SeedableRoot;
  const text = seedTemplate(root);
  const limits = seedLimits(root);
  const preview = args.check;
  const seedLabel =
    root === "faq"
      ? `${SEED_FAQ_ENTRIES.length} pairs (the schema minimum) — replace every <placeholder>`
      : "template";

  let file: string;
  try {
    file = preview
      ? previewCreate({ workspace: args.workspace, root, text }).file
      : createRoot({ workspace: args.workspace, root, text }).file;
  } catch (err) {
    if (err instanceof WriteRefusedError || err instanceof StaleEditError) {
      return report("edit", false, EXIT.FAIL, {
        error: {
          kind: err instanceof StaleEditError ? "stale" : "refused",
          message: err.message,
        },
      });
    }
    if (err instanceof SchemaValidationError || err instanceof LoadError) {
      return report("edit", false, EXIT.FAIL, {
        error: {
          kind: err instanceof SchemaValidationError ? "schema" : "load",
          message: err.message,
          ...(err instanceof SchemaValidationError ? { violations: [...err.issues] } : {}),
        },
      });
    }
    throw err;
  }

  line(`root:     ${root}`);
  line(`file:     ${file}`);
  line(`seed:     ${seedLabel}`);
  if (limits.length > 0) {
    for (const limit of limits) {
      line(
        `limits:   ${limit.field} ${limit.length}/${limit.cap}${limit.over ? " — OVER" : " — ok"} — ${limit.source}`,
      );
      if (limit.over) {
        warn(
          `${limit.field} is ${limit.length} chars, over the contract cap ${limit.cap} — the schema refuses the write (D12); shorten it (${limit.source})`,
        );
      }
    }
  }
  line(
    preview
      ? "would create: yes (--check: validated, nothing was written)"
      : "written:  yes (validated by load()+schema over a temp copy, then written)",
  );
  if (preview) {
    // The seed IS the preview: `--check` promises to show what would be created,
    // and a label ("N pairs") is not the template (#435 fresh pass, F2).
    line("--- seed (nothing was written) ---");
    for (const seedLine of text.trimEnd().split("\n")) line(`  ${seedLine}`);
  }
  line("validates: yes (schema)");

  return report("edit", true, EXIT.OK, {
    data: {
      mode: "create",
      root,
      file,
      created: !preview,
      preview,
      seed: seedLabel,
      // The machine contract carries the template too: a label is not a preview
      // (#451 fresh pass 2, F2).
      ...(preview ? { template: text } : {}),
      limits: limits.map((limit) => ({
        field: limit.field,
        cap: limit.cap,
        length: limit.length,
        over: limit.over,
        source: limit.source,
      })),
      warnings: [],
    },
  });
}
