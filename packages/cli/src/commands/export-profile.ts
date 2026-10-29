/**
 * `pasco export profile [--json] [--now <iso8601>]` — the normalized profile for
 * programmatic consumers (SPEC §7.5, issue #348).
 *
 * The engine already exposes `build <platform>` (text slices per surface) and
 * `validate`, but no stable object a consumer can read without re-implementing
 * `load()` + `normalize()`. This command is that object:
 *
 *   { schemaVersion, engine, source: { commit, generatedAt }, profile }
 *
 * **One assembler, no CLI-local builder** (§15.4). `profile` is exactly what
 * `core.load()` returns — schema-validated and normalized. The promise is
 * precise: **every root the workspace declares, plus every list root defaulted to
 * `[]`**; an optional OBJECT root (`newsletter`, `podcast`, `audiences`, `active`)
 * appears only when the workspace declares it, because there is no valid empty
 * value for it (`$defs` requires `platform`+`url`, `title`,
 * `lang`+`variantId`+`chosenAt`) and inventing `{}` would fail the contract
 * (D12). The command adds only the envelope around that object; it never
 * rebuilds, filters or re-derives a root. That is also why
 * `compile(profile, platform)` is NOT reused: it is the per-platform slice
 * (`PlatformProfile`), a different object for a different job.
 *
 * **Deterministic (SPEC §15.1 byte-parity, offline).** The command reads no
 * clock: `source.generatedAt` is `null` unless the caller pins it with
 * `--now <iso8601>`, whose value is emitted verbatim (the caller owns the bytes)
 * only after a real-calendar check. `source.commit` is the workspace's git
 * `HEAD` (`null` when the workspace is not inside a git repository or git is
 * unavailable) — a stored fact, not a runtime reading. Two runs over one
 * workspace produce identical bytes.
 *
 * Exit: 0 ok · 1 the workspace fails to load (schema/ledger/registry — D12) or
 * `--now` is malformed · 2 usage (dispatcher).
 */

import { execFileSync } from "node:child_process";
import type { LoadedProfile } from "@profile-as-code/core";
import { LoadError, load, SchemaValidationError } from "@profile-as-code/core";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";

/** The frozen contract version of the `export profile` payload (SPEC §7.5).
 *  A consumer refuses a version it does not know rather than guessing — the
 *  `schemaVersion` key §7.1/§7.2/§7.3 already use. */
export const PROFILE_EXPORT_SCHEMA_VERSION = "1";

/** The engine that produced the payload — the CLI package, not the workspace. */
export const PROFILE_EXPORT_ENGINE = "@profile-as-code/cli";

/** Where the profile came from. Both values are facts about the run, never
 *  clock readings: `generatedAt` is `null` without an explicit `--now`. */
export interface ProfileSource {
  commit: string | null;
  generatedAt: string | null;
}

/** The exported payload — the `data` of the standard CLI envelope. */
export interface ProfileExport {
  schemaVersion: typeof PROFILE_EXPORT_SCHEMA_VERSION;
  engine: { name: typeof PROFILE_EXPORT_ENGINE; version: string };
  source: ProfileSource;
  profile: LoadedProfile;
}

/** ISO 8601 date-time with an explicit offset (`Z` or ±hh:mm). The components
 *  are captured so they can be checked against the real calendar below. */
const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_OFFSET = /(?:Z|[+-](\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Resolve `--now`. Absent → `null` (no clock read: the deterministic default).
 * Present → the value VERBATIM after a strict check; normalizing it
 * (`toISOString`) would change the bytes the caller pinned.
 *
 * The check is calendar-strict on purpose: `Date.parse` NORMALIZES an impossible
 * date (`2026-02-31T00:00:00Z`, `T24:00:00Z`), so a regex plus `Date.parse`
 * alone would bless a `generatedAt` that claims an instant which does not exist.
 * Seconds `60` (a leap second) are refused too: the payload states a wall-clock
 * instant and this engine carries no leap-second context.
 */
export function resolveNow(
  value: string | undefined,
): { ok: true; generatedAt: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, generatedAt: null };
  const match = ISO_DATETIME.exec(value);
  if (match === null) return { ok: false };
  const [year, month, day, hour, minute, second] = match.slice(1);
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  if (mo < 1 || mo > 12) return { ok: false };
  const maxDay = mo === 2 && isLeapYear(y) ? 29 : (DAYS_IN_MONTH[mo - 1] ?? 0);
  if (d < 1 || d > maxDay) return { ok: false };
  if (h > 23 || mi > 59 || s > 59) return { ok: false };
  const offset = ISO_OFFSET.exec(value);
  if (offset !== null && offset[1] !== undefined) {
    if (Number(offset[1]) > 23 || Number(offset[2]) > 59) return { ok: false };
  }
  // Belt and braces: the runtime must also accept what the calendar check passed.
  if (Number.isNaN(Date.parse(value))) return { ok: false };
  return { ok: true, generatedAt: value };
}

/**
 * The workspace commit — `git rev-parse HEAD` from the workspace directory, so
 * a workspace that lives inside a larger repository records that repository's
 * commit. `null` is the honest answer outside a git repository (or without
 * git): the payload never invents a source it does not have.
 */
export function workspaceCommit(workspace: string): string | null {
  try {
    const out = execFileSync("git", ["-C", workspace, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** Assemble the payload around the loaded profile. Pure: every input is passed
 *  in, so the bytes are a function of the workspace and the caller's flags. */
export function profileExport(
  profile: LoadedProfile,
  source: ProfileSource,
  engineVersion: string,
): ProfileExport {
  return {
    schemaVersion: PROFILE_EXPORT_SCHEMA_VERSION,
    engine: { name: PROFILE_EXPORT_ENGINE, version: engineVersion },
    source,
    profile,
  };
}

export interface ExportProfileArgs {
  workspace: string;
  /** `--now <iso8601>`: the caller-pinned timestamp; absent reads no clock. */
  nowArg?: string;
  /** The installed CLI version, resolved by the dispatcher from package.json. */
  engineVersion: string;
}

/** Human summary: the payload is the contract, this is the readable view. */
function describeRoot(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "entry" : "entries"}`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).length;
    return `${keys} ${keys === 1 ? "key" : "keys"}`;
  }
  return typeof value;
}

export function runExportProfile(args: ExportProfileArgs): number {
  const now = resolveNow(args.nowArg);
  if (!now.ok) {
    return report("export profile", false, EXIT.FAIL, {
      error: {
        kind: "now",
        message: `--now "${args.nowArg ?? ""}" is not a valid ISO 8601 date-time (expected e.g. 2026-10-28T00:00:00Z)`,
      },
    });
  }

  let profile: LoadedProfile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report("export profile", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report("export profile", false, EXIT.FAIL, {
        error: { kind: "load", message: err.message },
      });
    }
    throw err;
  }

  const payload = profileExport(
    profile,
    { commit: workspaceCommit(args.workspace), generatedAt: now.generatedAt },
    args.engineVersion,
  );

  if (isJsonMode()) {
    return report("export profile", true, EXIT.OK, { data: payload });
  }

  section("normalized profile");
  line(`  schemaVersion: ${payload.schemaVersion}`);
  line(`  engine: ${payload.engine.name} ${payload.engine.version}`);
  line(
    `  source: commit ${payload.source.commit ?? "(not a git repository)"} · generatedAt ${
      payload.source.generatedAt ?? "(not read — pass --now <iso8601>)"
    }`,
  );

  section("roots");
  for (const [root, value] of Object.entries(payload.profile)) {
    line(`  ${root}: ${describeRoot(value)}`);
  }
  line("  (roots the workspace does not declare are absent; list roots default to [])");
  line("  (use --json for the payload a consumer reads)");

  return EXIT.OK;
}
