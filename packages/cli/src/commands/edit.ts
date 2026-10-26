/**
 * pasco edit <contract-path> [--set <text> --check] — S1 of epic #247.
 *
 * S1 is READ-ONLY on purpose: it answers "what will the published text be?"
 * without touching a byte. The dogfood that opened the epic had to hash
 * `content/` before/after and read a `pasco build` scrollback to answer the same
 * question; this command replaces both and carries zero write risk.
 *
 * The published answer is derived from the ARTIFACT, never from the addressed row
 * alone (premerge review of PR #331, F1: they are frequently different — a paste
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
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { LoadedProfile, MediaAsset, Platform, PlatformProfile } from "@profile-as-code/core";
import {
  collectMedia,
  LoadError,
  load,
  PLATFORMS,
  SchemaValidationError,
} from "@profile-as-code/core";
import {
  compileSlice,
  publishedBio,
  renderArtifact,
  selectionErrorMessage,
  selectionFindings,
} from "../artifact-render.js";
import type { EditAddress } from "../contract.js";
import {
  bioAddress,
  headlineAddress,
  LANGS,
  linkAddress,
  parseEditAddress,
  UsageError,
} from "../contract.js";
import {
  inspectTarget,
  StaleEditError,
  type WriteOutcome,
  WriteRefusedError,
  writeEdit,
} from "../edit-write.js";
import { EXIT } from "../exit.js";
import { line, report } from "../output.js";
import type { Pascorc } from "../workspace.js";

export interface EditArgs {
  workspace: string;
  addressArg?: string;
  setArg?: string;
  check: boolean;
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
  const platform = row.platform ?? "<no platform>";
  const addressable = row.label !== undefined && !SELECTOR_UNSAFE.test(row.label);
  return linkAddress(platform, addressable ? row.label : undefined);
}

function linkNote(row: { platform?: string; label?: string }): string | undefined {
  const parts: string[] = [];
  if (row.platform === undefined) parts.push("no platform — not addressable");
  else if (SELECTOR_UNSAFE.test(row.platform)) {
    parts.push(
      `platform ${JSON.stringify(row.platform)} contains a character the address grammar cannot express`,
    );
  }
  if (row.label !== undefined && SELECTOR_UNSAFE.test(row.label)) {
    parts.push(
      `label ${JSON.stringify(row.label)} contains a character the address grammar cannot express`,
    );
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/**
 * A resolved contract path.
 *
 * `locate` is S2's write handle and carries TWO paths on purpose: `path` is
 * FILE-relative (what a CST can resolve in `content/<root>.yaml` — the file's
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

/**
 * The content file that owns a root property. The file NAME is the root property
 * (schema/README.md) and `load()` matches the extension case-insensitively, so
 * this scans the directory instead of guessing: a default like
 * `content/headlines.yaml` would point S2 at a file that may not exist while
 * `content/headlines.YAML` owns the block (premerge review of #331, F4).
 */
function owningFile(workspace: string, root: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(join(workspace, "content"));
  } catch {
    return undefined;
  }
  const match = entries.filter((name) => new RegExp(`^${root}\\.ya?ml$`, "i").test(name)).sort()[0];
  return match === undefined ? undefined : `content/${match}`;
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
    ).map((lang) => `positioning.statement.${lang}`);
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
    const hits = profile.headlines
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.platform === address.platform && row.lang === address.lang);
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
    const hits = profile.bios
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          row.platform === address.platform &&
          row.lang === address.lang &&
          row.length === address.length,
      );
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

  const links = profile.identity.links ?? [];
  const hits = links
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        row.platform === address.platform &&
        (address.label === undefined || (row.label ?? "") === address.label),
    );
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
  return "no rendered artifact carries this statement — only renderers that emit it can publish it";
}

/** The published surface of one edit: the artifact lines that change, per
 *  platform, or the reason none do (or the selection error `build` would refuse). */
interface Published {
  changes: { platform: string; before: string; after: string }[];
  reason?: string;
  error?: string;
}

function publishedByEdit(
  before: LoadedProfile,
  after: LoadedProfile,
  address: EditableAddress,
  workspace: string,
  pascorc: Pascorc,
): Published {
  const media = collectMedia(before, workspace);
  const platforms: Platform[] = address.kind === "statement" ? [...PLATFORMS] : [address.platform];
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

/** Human scope label of an address: which artifact(s) carry it. */
function scopeLabel(address: EditAddress): string {
  if (address.kind === "statement") return "every rendered platform";
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

  if (args.addressArg === undefined) {
    throw new UsageError("usage: pasco edit <contract-path> [--set <text> --check]");
  }
  const address = parseEditAddress(args.addressArg);

  // Read-only address: the grammar says so, and S2 must not grow a second write
  // path for links (identity.yaml carries the URL SSOT — §3).
  if (address.kind === "link" && args.setArg !== undefined) {
    throw new UsageError(
      `${address.address} is read-only — links live in content/identity.yaml (the URL SSOT, §3)`,
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
  if (target.matches === 1) {
    line(`current:  ${target.current}`);
    if (proposed !== undefined) {
      line(`proposed: ${proposed}`);
      if (noopValue) {
        line("(noop) the proposed value is identical to the current one — nothing was written");
      } else if (outcome !== undefined) {
        line(outcome.noop ? "(noop) the file already held this value" : "written: yes");
        line("validates: yes");
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
      line("(edit does not create rows: the field must already exist in the schema and the file)");
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
          : "several rows share this address";
    line(`resolves to ${target.matches} rows — ${kind}; edit refuses to choose`);
    target.rows.forEach((row, index) => {
      line(
        `  ${index + 1}. ${row.address} = ${row.value}${row.note === undefined ? "" : `  (${row.note})`}`,
      );
    });
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
      warnings: published.error === undefined ? [] : [published.error],
    },
  });
}
