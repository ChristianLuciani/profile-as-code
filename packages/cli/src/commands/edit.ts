/**
 * pasco edit <contract-path> [--set <text>] --check — S1 of epic #247.
 *
 * S1 is READ-ONLY on purpose: it answers "what will the published text be?"
 * without touching a byte. The dogfood that opened the epic had to hash
 * `content/` before/after and read a `pasco build` scrollback to answer the
 * same question; this command replaces both and carries zero write risk.
 *
 * The WRITE lands with S2 (#249), whose recorded decision (2026-10-21,
 * `main@647c510`) fixes the coupling: S2 consumes the LOCATED node this
 * resolver exposes (`EditTarget.locate` — file + path), never re-derives
 * addresses. So `--set` without `--check` is refused until the write exists —
 * pretending to write would be worse than not having the command.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LoadedProfile, Platform } from "@profile-as-code/core";
import {
  compile,
  LoadError,
  load,
  PLATFORMS,
  SchemaValidationError,
  type SelectionPolicy,
} from "@profile-as-code/core";
import type { EditAddress } from "../contract.js";
import {
  bioAddress,
  headlineAddress,
  linkAddress,
  parseEditAddress,
  UsageError,
} from "../contract.js";
import { EXIT } from "../exit.js";
import { line, report } from "../output.js";
import type { Pascorc } from "../workspace.js";
import { sanitizeSelectionPolicy } from "../workspace.js";

export interface EditArgs {
  workspace: string;
  addressArg?: string;
  setArg?: string;
  check: boolean;
  pascorc: Pascorc;
}

/** A resolved contract path. */
export interface EditTarget {
  address: EditAddress;
  /** Where the value lives in the workspace — the handle S2's comment-preserving
   *  write consumes (range splice: the CST locates the node at this path). */
  locate: { file: string; path: (string | number)[] };
  /** Exactly one match: the current value. */
  current?: string;
  /** How many rows the address resolves to: 0 (absent), 1 (addressable),
   *  >1 (a duplicate row — drift/duplicate-bio; the command refuses to choose). */
  matches: number;
  /** The matched rows, so an ambiguous address is reported with its rows. */
  rows: { address: string; value: string }[];
  /** Concrete addresses this workspace has for the addressed block — printed
   *  when the address resolves to 0 rows, so it is never a dead end. */
  available: string[];
}

/** The content file that owns a root property: the file NAME is the root
 *  property (schema/README.md), and both extensions are legal. */
function contentFile(workspace: string, root: string): string {
  for (const ext of ["yaml", "yml"]) {
    const candidate = `content/${root}.${ext}`;
    if (existsSync(join(workspace, candidate))) return candidate;
  }
  return `content/${root}.yaml`;
}

/**
 * Resolve a contract path against the loaded profile.
 *
 * Every returned target carries `locate`: the row index is the index in the
 * WORKSPACE ARRAY (load() merges one root property per file and never reorders),
 * so S2 can splice that scalar in the original text without a second lookup.
 */
export function resolveEditTarget(
  profile: LoadedProfile,
  address: EditAddress,
  workspace: string,
): EditTarget {
  if (address.kind === "statement") {
    const statement: Record<string, string> = profile.positioning?.statement ?? {};
    const value = statement[address.lang];
    // An empty string counts as ABSENT (compile() treats "" as absent, #84).
    const present = typeof value === "string" && value !== "";
    const available = Object.keys(statement).map((lang) => `positioning.statement.${lang}`);
    return {
      address,
      locate: {
        file: contentFile(workspace, "positioning"),
        path: ["positioning", "statement", address.lang],
      },
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
    return {
      address,
      locate: {
        file: contentFile(workspace, "headlines"),
        path: ["headlines", hits[0]?.index ?? 0, "text"],
      },
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
    return {
      address,
      locate: {
        file: contentFile(workspace, "bios"),
        path: ["bios", hits[0]?.index ?? 0, "text"],
      },
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
    .filter(({ row }) => row.platform === address.platform);
  return {
    address,
    locate: {
      file: contentFile(workspace, "identity"),
      path: ["identity", "links", hits[0]?.index ?? 0, "url"],
    },
    ...(hits.length === 1 ? { current: hits[0]?.row.url as string } : {}),
    matches: hits.length,
    rows: hits.map(({ row }) => ({
      address: linkAddress(row.platform ?? "<none>"),
      value: row.url,
    })),
    // A link without `platform` is not addressable by this grammar — it is
    // listed as unaddressable rather than hidden.
    available: links.map((row) => linkAddress(row.platform ?? "<no platform — not addressable>")),
  };
}

/** Apply the proposal to an in-memory copy. S1 never writes it anywhere; the
 *  point is that `--check` runs the SAME path the write will (S2's guarantee
 *  that "what would change" cannot drift from "what changes"). */
export function applyEdit(
  profile: LoadedProfile,
  target: EditTarget,
  value: string,
): LoadedProfile {
  // structuredClone on a validated profile: plain JSON-shaped data, no cycles.
  const copy = structuredClone(profile) as LoadedProfile;
  const path = target.locate.path;
  let cursor: unknown = copy;
  for (const key of path.slice(0, -1)) {
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  const last = path[path.length - 1] as string | number;
  (cursor as Record<string | number, unknown>)[last] = value;
  return copy;
}

/**
 * The rendered text — what `pasco build` would publish for the addressed value.
 *
 * A platform-scoped address is read back from the SAME `compile()` slice the
 * renderer consumes (so lang fallback, platform filtering and the D22 selection
 * view are the artifact's, not a second model). A lang-only address (the
 * statement) is carried verbatim by every platform slice; the slices are
 * required to AGREE, and disagreement is reported instead of picking one.
 */
function renderEdit(
  profile: LoadedProfile,
  target: EditTarget,
  pascorc: Pascorc,
): { rendered?: string; reason?: string } {
  // Same casting seam as `build` (workspace.ts validates shape, the core type
  // carries the platform enum): one policy reader, two commands.
  const selection = sanitizeSelectionPolicy(pascorc.selection) as SelectionPolicy | undefined;
  const policyFor = (platform: Platform) =>
    selection === undefined ? undefined : { selection, view: platform };
  const address = target.address;

  if (address.kind === "link") {
    // A link is a FACT, not text: the renderers (JSON-LD sameAs/url) carry the
    // URL verbatim, so there is no platform slice to read it back from.
    const row = profile.identity.links?.find((link) => link.platform === address.platform);
    if (row === undefined) return { reason: "the link row disappeared after the rewrite" };
    return { rendered: row.url };
  }

  if (address.kind === "headline" || address.kind === "bio") {
    const slice = compile(profile, address.platform, address.lang, policyFor(address.platform));
    const rows =
      address.kind === "headline"
        ? slice.headlines
        : slice.bios.filter((row) => row.length === address.length);
    const rendered = rows[0]?.text;
    if (rendered === undefined) {
      return {
        reason: `the compiled ${address.platform}/${address.lang} slice does not carry the row — the D22 selection view may omit it`,
      };
    }
    return { rendered };
  }

  const values = new Set<string>();
  for (const platform of PLATFORMS) {
    const slice = compile(profile, platform, address.lang, policyFor(platform));
    if (slice.statement !== undefined) values.add(slice.statement);
  }
  if (values.size === 0) {
    return { reason: `no compiled platform slice carries positioning.statement.${address.lang}` };
  }
  if (values.size > 1) {
    return {
      reason:
        "platform slices disagree on the statement — the workspace is not byte-stable; that is a finding, not an edit",
    };
  }
  return { rendered: [...values][0] as string };
}

/** Where the rendered value came from, for the human report. */
function renderedSource(target: EditTarget): string {
  if (target.address.kind === "statement") {
    return `every platform slice, ${target.address.lang}`;
  }
  if (target.address.kind === "link") {
    return "verbatim — the URL SSOT (§3)";
  }
  return `${target.address.platform}/${target.address.lang}`;
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

export function runEdit(args: EditArgs): number {
  let profile: LoadedProfile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    return failLoad(err);
  }

  if (args.addressArg === undefined) {
    throw new UsageError("usage: pasco edit <contract-path> [--set <text>] --check");
  }
  const address = parseEditAddress(args.addressArg);

  // Read-only address: the grammar says so, and S2 must not grow a second write
  // path for links (identity.yaml carries the URL SSOT — §3).
  if (address.kind === "link" && args.setArg !== undefined) {
    throw new UsageError(
      `${address.address} is read-only — links live in content/identity.yaml (the URL SSOT, §3)`,
    );
  }
  if (args.setArg !== undefined && !args.check) {
    throw new UsageError(
      `pasco edit writes nothing yet (S1, #248): add --check to see old → new and the rendered text; the comment-preserving write lands with S2 (#249)`,
    );
  }
  if (args.setArg === "") {
    throw new UsageError("--set text must not be empty (schema minLength 1)");
  }

  const target = resolveEditTarget(profile, address, args.workspace);
  const proposed = args.setArg;
  let ok = target.matches === 1;
  let rendered: string | undefined;
  let reason: string | undefined;

  if (target.matches === 1) {
    const applied = applyEdit(profile, target, proposed ?? (target.current as string));
    const result = renderEdit(applied, target, args.pascorc);
    rendered = result.rendered;
    reason = result.reason;
    if (rendered === undefined) ok = false;
  }
  // 0 rows / >1 rows are data findings, reported below with the rows (or the
  // addresses the workspace does have); `reason` is reserved for a resolved
  // address whose value the compiled artifact cannot carry.

  line(`address:  ${target.address.address}`);
  if (target.matches === 1) {
    line(`current:  ${target.current}`);
    if (proposed !== undefined) {
      line(`proposed: ${proposed}`);
      if (proposed === target.current) {
        line(
          "(no change: the proposed value is identical to the current one — the write records noop: true)",
        );
      }
    }
    if (rendered !== undefined) {
      line(`rendered (${renderedSource(target)}): ${rendered}`);
    }
  } else if (target.matches === 0) {
    line("resolves to 0 rows — nothing to show");
    if (target.available.length > 0) {
      line("available:");
      for (const candidate of target.available) line(`  ${candidate}`);
    }
  } else {
    line(
      `resolves to ${target.matches} rows — ambiguous (a duplicate row is drift/duplicate-bio); edit refuses to choose`,
    );
    target.rows.forEach((row, index) => {
      line(`  ${index + 1}. ${row.address} = ${row.value}`);
    });
  }
  if (!ok && target.matches === 1 && reason !== undefined) line(`not ok: ${reason}`);

  return report("edit", ok, ok ? EXIT.OK : EXIT.FAIL, {
    data: {
      address: target.address.address,
      current: target.matches === 1 ? target.current : null,
      proposed: proposed ?? null,
      rendered: rendered ?? null,
      ok,
    },
  });
}
