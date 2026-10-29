/**
 * `pasco export profile [--json] [--now <iso8601>]` — the compiled profile for
 * programmatic consumers (SPEC §7.5, issue #348).
 *
 * The engine already exposes `build <platform>` (text slices per surface) and
 * `validate`, but no stable object a consumer can read without re-implementing
 * `load()` + `normalize()`. This command is that object:
 *
 *   { contract, engine, source: { commit, generatedAt }, profile: { …all roots… } }
 *
 * **One assembler, no CLI-local builder** (§15.4). `profile` is exactly what
 * `core.load()` returns — schema-validated, normalized, every list root
 * defined. The command adds only the envelope around it; it never rebuilds,
 * filters or re-derives a root. That is also why `compile(profile, platform)` is
 * NOT reused: it is the per-platform slice (`PlatformProfile`), a different
 * object for a different job.
 *
 * **Deterministic (SPEC §15.1 byte-parity, offline).** The command reads no
 * clock: `source.generatedAt` is `null` unless the caller pins it with
 * `--now <iso8601>`, whose value is emitted verbatim (the caller owns the
 * bytes). `source.commit` is the workspace's git `HEAD` (`null` when the
 * workspace is not inside a git repository or git is unavailable) — a stored
 * fact, not a runtime reading. Two runs over one workspace produce identical
 * bytes.
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
 *  A consumer refuses a version it does not know rather than guessing. */
export const PROFILE_EXPORT_SCHEMA_VERSION = "1";

/** The engine that produced the payload — the CLI package, not the workspace. */
export const PROFILE_EXPORT_ENGINE = "@profile-as-code/cli";

/** Where the profile came from. Both values are facts about the run, never
 *  clock readings: `generatedAt` is `null` without an explicit `--now`. */
export interface ProfileSource {
  commit: string | null;
  generatedAt: string | null;
}

/** The compiled profile payload — the `data` of the standard CLI envelope. */
export interface CompiledProfile {
  contract: typeof PROFILE_EXPORT_SCHEMA_VERSION;
  engine: { name: typeof PROFILE_EXPORT_ENGINE; version: string };
  source: ProfileSource;
  profile: LoadedProfile;
}

/** ISO 8601 date-time with an explicit offset (`Z` or ±hh:mm). The shape is
 *  asserted because `Date.parse` alone accepts date-only strings too. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Resolve `--now`. Absent → `null` (no clock read: the deterministic default).
 * Present → the value VERBATIM after asserting it is a real ISO 8601
 * date-time; normalizing it (`toISOString`) would change the bytes the caller
 * pinned.
 */
export function resolveNow(
  value: string | undefined,
): { ok: true; generatedAt: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, generatedAt: null };
  if (!ISO_DATETIME.test(value) || Number.isNaN(Date.parse(value))) return { ok: false };
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
export function compiledProfile(
  profile: LoadedProfile,
  source: ProfileSource,
  engineVersion: string,
): CompiledProfile {
  return {
    contract: PROFILE_EXPORT_SCHEMA_VERSION,
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

  const payload = compiledProfile(
    profile,
    { commit: workspaceCommit(args.workspace), generatedAt: now.generatedAt },
    args.engineVersion,
  );

  if (isJsonMode()) {
    return report("export profile", true, EXIT.OK, { data: payload });
  }

  section("compiled profile");
  line(`  contract: ${payload.contract}`);
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
  line("  (use --json for the payload a consumer reads)");

  return EXIT.OK;
}
