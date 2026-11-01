/**
 * `pasco presence` and `pasco release plan` — the D23 surfaces (SPEC §22,
 * issue #262).
 *
 * `presence` is the DAILY board (operator decision 2026-10-28, option B): every
 * surface the workspace's releases have addressed, at its newest release, with
 * the ledger-derived state. `release plan` hangs off it as the launch view: one
 * release's ordered fan-out, the per-kind factual spine, and which surfaces
 * still owe the release.
 *
 * Both are DERIVED from `core/src/presence.ts` — this module only prints. The
 * copy per channel lives in `skills/` (D23 item 4 / rule 7); the base text is the
 * release row's factual spine, never announcement prose. Offline and
 * deterministic (D19): no network, no clock, no AI.
 *
 * Exit: 0 a successful read · 1 the workspace does not load, declares no
 * releases, names an unknown release id or a surface the registry does not know ·
 * 2 usage (dispatcher).
 */

import type { LoadedProfile, PresenceBoard, ReleasePlan } from "@profile-as-code/core";
import {
  LoadError,
  load,
  PresenceError,
  presenceBoard,
  releasePlan,
  SchemaValidationError,
} from "@profile-as-code/core";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";

/** The frozen contract version of both `--json` payloads. */
export const PRESENCE_SCHEMA_VERSION = "1";

export interface PresenceArgs {
  workspace: string;
}

export interface ReleasePlanArgs {
  workspace: string;
  /** Release id; absent = the newest release. */
  releaseArg?: string;
}

function loadOrReport(
  command: string,
  workspace: string,
): { profile: LoadedProfile } | { fail: number } {
  try {
    return { profile: load(workspace) };
  } catch (err) {
    if (err instanceof SchemaValidationError || err instanceof LoadError) {
      return {
        fail: report(command, false, EXIT.FAIL, {
          error: {
            kind: "load",
            message: err.message,
            ...(err instanceof SchemaValidationError ? { violations: [...err.issues] } : {}),
          },
        }),
      };
    }
    throw err;
  }
}

function presenceFail(command: string, err: unknown): number {
  if (err instanceof PresenceError) {
    return report(command, false, EXIT.FAIL, { error: { kind: "presence", message: err.message } });
  }
  throw err;
}

/** Machine payload: the contract version + the board, nothing renamed. */
export function presencePayload(board: PresenceBoard): {
  schemaVersion: string;
  releases: number;
  latest: PresenceBoard["latest"];
  counts: PresenceBoard["counts"];
  surfaces: PresenceBoard["surfaces"];
} {
  return {
    schemaVersion: PRESENCE_SCHEMA_VERSION,
    releases: board.releases,
    latest: board.latest,
    counts: board.counts,
    surfaces: board.surfaces,
  };
}

/** Machine payload for one release: the release row, surfaces, base text. */
export function releasePlanPayload(plan: ReleasePlan): {
  schemaVersion: string;
  release: ReleasePlan["release"];
  surfaces: ReleasePlan["surfaces"];
  baseText: ReleasePlan["baseText"];
} {
  return {
    schemaVersion: PRESENCE_SCHEMA_VERSION,
    release: plan.release,
    surfaces: plan.surfaces,
    baseText: plan.baseText,
  };
}

const KIND_ORDER = ["repo-meta", "profile", "distribution"] as const;

export function runPresence(args: PresenceArgs): number {
  const loaded = loadOrReport("presence", args.workspace);
  if ("fail" in loaded) return loaded.fail;
  let board: PresenceBoard;
  try {
    board = presenceBoard(loaded.profile);
  } catch (err) {
    return presenceFail("presence", err);
  }
  if (isJsonMode()) {
    return report("presence", true, EXIT.OK, { data: presencePayload(board) });
  }
  const latest =
    board.latest === null
      ? "no releases"
      : `latest v${board.latest.version} (${board.latest.date})`;
  section(`Presence — ${board.releases} release(s) · ${latest}`);
  line("KIND            SURFACE               STATE     RELEASE");
  for (const row of board.surfaces) {
    line(
      `${row.kind.padEnd(15)} ${row.surface.padEnd(21)} ${row.state.padEnd(9)} ${row.releaseId}`,
    );
  }
  line("");
  line(
    `in-sync: ${board.counts["in-sync"]} · stale: ${board.counts.stale} · never: ${board.counts.never}`,
  );
  line(
    "Copy per channel lives in the shipped skills (D23); this board derives from releases[] + the ledger.",
  );
  return EXIT.OK;
}

export function runReleasePlan(args: ReleasePlanArgs): number {
  const loaded = loadOrReport("release plan", args.workspace);
  if ("fail" in loaded) return loaded.fail;
  let plan: ReleasePlan;
  try {
    plan = releasePlan(loaded.profile, args.releaseArg);
  } catch (err) {
    return presenceFail("release plan", err);
  }
  if (isJsonMode()) {
    return report("release plan", true, EXIT.OK, { data: releasePlanPayload(plan) });
  }
  section(
    `Release plan v${plan.release.version} (${plan.release.date}) · ${plan.release.id} — ${plan.release.summary}`,
  );
  line("ORDER  KIND            SURFACE               STATE");
  plan.surfaces.forEach((row, index) => {
    const order = String(index + 1).padStart(5);
    line(`${order}  ${row.kind.padEnd(15)} ${row.surface.padEnd(21)} ${row.state}`);
    // Two distinct causes, named as what they are (#408): a key that resolves
    // to no SSOT unit IS a defect in the release row; a valid unit with no
    // record on this surface is a pending fan-out, and the row is correct —
    // telling the operator to "fix the release row" there sends them to edit a
    // correct datum.
    for (const unknown of row.unknownUnits) {
      line(`       ↳ changedUnit "${unknown}" is not an SSOT unit — fix the release row`);
    }
    for (const missing of row.missingUnits) {
      line(
        `       ↳ changedUnit "${missing}" has no deploy record on this surface yet — pending fan-out`,
      );
    }
  });
  section("Base text (factual spine; the copy per kind lives in the shipped skills)");
  for (const kind of KIND_ORDER) {
    const text = plan.baseText.find((entry) => entry.kind === kind);
    if (text !== undefined) line(`[${kind}] ${text.text}`);
  }
  return EXIT.OK;
}
