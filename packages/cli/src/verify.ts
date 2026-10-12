/**
 * `pasco status --verify [platform]` — the C1 live check (SPEC §19.5, issue #132).
 *
 * The engine's ONE network-touching path, opt-in by construction (never implicit
 * in `status`/`build`/`validate`/`check`), and `pasco`'s second ledger write
 * trigger after `--mark`. It lives in its own module because it owns a coherent
 * concern the report does not: resolve → validate → fetch → compare → write.
 *
 * Discipline, in order (all three are SPEC requirements, not conventions):
 *   1. resolve the artifact URL from the URL SSOT via the surface's declaration;
 *   2. validate its host against the surface's declared `fetchHosts` BEFORE any
 *      request — a URL outside the allowlist is `unverifiable: host-not-allowed`
 *      with NO request made (the workspace is untrusted input: templates are
 *      cloned from strangers, so an unvalidated `--verify` would be an SSRF
 *      primitive);
 *   3. one request per surface, sequential, no retries; a non-2xx or a transport
 *      failure is DATA (`unverifiable` + the honest reason), never an exception;
 *   4. write the ledger once, at the end.
 *
 * DECLARED reasons (`no-extractor`, `no-artifact-url`) are never written: §19.5
 * derives them at read time from the surface's capability, so a workspace needs
 * no ledger row per walled platform and the verdict cannot be pinned by a stale
 * write. Only an ATTEMPT (row 1 of the table) records evidence.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  attemptRecord,
  type CertificationState,
  certificationRollup,
  certificationVerdict,
  declaredReason,
  deployStatus,
  fetchFailureReason,
  type LedgerReport,
  type LoadedProfile,
  PLATFORMS,
  type SurfaceCapability,
  type SurfaceCertification,
  trackableUnits,
  type UnitStatus,
} from "@profile-as-code/core";
import { parseDocument, stringify } from "yaml";
import { capabilitiesOf } from "./capabilities.js";
import { certToken, type StatusArgs } from "./commands/status.js";
import { EXIT } from "./exit.js";
import { isJsonMode, line, report, section } from "./output.js";
import { filterReport, reportDataOf } from "./report-shape.js";

/**
 * The injected live-fetch seam (§19.5): `--verify` never reaches the network from
 * a test, and never from `core` (D20 — `pasco serve` acquires no network
 * capability). `status: 0` means the transport failed before a response existed;
 * any other status is the honest HTTP answer.
 */
export type FetchText = (url: string) => Promise<{ status: number; text?: string }>;

/** Dependencies the write paths need beyond `StatusArgs`. Production passes the
 *  HTTP driver (`index.ts`) and resolves the surface capabilities PER WORKSPACE
 *  from the loaded profile (§19.5 — `artifactUrl` reads the URL SSOT, so it can
 *  never be a static map); tests inject a stub registry and a scripted fetch. */
export interface StatusDeps {
  capabilities: Readonly<Record<string, SurfaceCapability>>;
  fetchText: FetchText;
}

/** The capability registry for a workspace: an injected one wins (the test
 *  seam), otherwise the per-workspace declaration `capabilitiesOf` derives from
 *  the URL SSOT. A surface with no declaration yields `no-extractor` in `core`. */
export const depsOf = (args: StatusArgs, profile: LoadedProfile): StatusDeps => ({
  capabilities: args.deps?.capabilities ?? capabilitiesOf(profile),
  fetchText: args.deps?.fetchText ?? (async () => ({ status: 0 })),
});

/** `content/deployments.yaml` of a workspace — the one ledger home. */
export function ledgerPathOf(workspace: string): string {
  return join(workspace, "content", "deployments.yaml");
}

/** Read the ledger as parsed YAML. Returns a failure envelope on invalid YAML —
 *  the write paths never persist over a file they could not read. */
export function readLedger(
  args: StatusArgs,
  kind: "mark" | "verify",
): { ledger: Record<string, Record<string, unknown>> } | { fail: number } {
  const ledgerPath = ledgerPathOf(args.workspace);
  let ledger: Record<string, Record<string, unknown>> = {};
  if (existsSync(ledgerPath)) {
    const doc = parseDocument(readFileSync(ledgerPath, "utf8"));
    if (doc.errors.length > 0) {
      return {
        fail: report("status", false, EXIT.FAIL, {
          error: {
            kind,
            message: `content/deployments.yaml: invalid YAML — ${doc.errors[0]?.message ?? "parse error"}`,
          },
        }),
      };
    }
    const node = doc.toJS({ maxAliasCount: 100 });
    if (node !== null && typeof node === "object")
      ledger = node as Record<string, Record<string, unknown>>;
  }
  return { ledger };
}

/** The §19.5 writer's primitive: mutate the parsed ledger object in place and
 *  persist it. Both write triggers (`--mark`, `--verify`) go through here. */
export function persistLedger(
  args: StatusArgs,
  ledger: Record<string, Record<string, unknown>>,
): void {
  writeFileSync(ledgerPathOf(args.workspace), stringify(ledger), "utf8");
}

/** §19.5: the digest the CALLER computes (the renderer never hashes) — SHA-256
 *  hex of the extractor's output. */
export function digestOf(artifact: string): string {
  return createHash("sha256").update(artifact, "utf8").digest("hex");
}

/** One `(ledgerKey, surface)` verification outcome. `write: false` means the
 *  surface's certification is a DECLARATION this pass cannot change — a walled
 *  surface is not written to, because §19.5 derives its reason at read time. */
interface SurfaceVerdict {
  surface: string;
  certification: SurfaceCertification;
  fetched: boolean;
  write: boolean;
}

export async function verifyStatus(args: StatusArgs, profile: LoadedProfile): Promise<number> {
  const deps = depsOf(args, profile);
  if (args.platformArg !== undefined && !PLATFORMS.includes(args.platformArg as never)) {
    return report("status", false, EXIT.USAGE, {
      error: {
        kind: "usage",
        message: `surface "${args.platformArg}" is not in the platform set (D16)`,
      },
    });
  }

  // `profile.deployments` IS the ledger the report reads: `load()` already parsed
  // and Zod-validated the file (invalid YAML → LoadError, bad shape → D12), so a
  // second parse would only hand back an equal-but-different object — and the
  // verdict would then be derived from a copy that never saw the writes.
  const ledger = profile.deployments;

  // Collect the verification subjects first: every RECORDED (ledgerKey, surface)
  // pair, deterministic order. A `never` surface is not one — there is nothing
  // deployed to check, and verifying it would invent a deploy.
  const subjects: { key: string; surface: string; existing: Record<string, unknown> }[] = [];
  for (const unit of trackableUnits(profile)) {
    const surfacesOfUnit = ledger[unit.key];
    if (surfacesOfUnit === undefined) continue;
    for (const surface of Object.keys(surfacesOfUnit).sort()) {
      if (args.platformArg !== undefined && surface !== args.platformArg) continue;
      subjects.push({
        key: unit.key,
        surface,
        existing: surfacesOfUnit[surface] as Record<string, unknown>,
      });
    }
  }

  // Sequential by construction: ONE awaited request per subject, no retries and
  // no backoff games (§19.5 fetch discipline). The loop cannot be parallelized
  // without breaking that rule.
  const verdicts: { key: string; verdict: SurfaceVerdict }[] = [];
  let requests = 0;
  for (const subject of subjects) {
    const verdict = await verifySurface(
      subject.surface,
      subject.existing,
      deps.capabilities[subject.surface],
      deps.fetchText,
    );
    if (verdict.fetched) requests += 1;
    if (verdict.write) {
      const surfacesOfUnit = ledger[subject.key];
      if (surfacesOfUnit !== undefined) {
        // The union `Profile["deployments"]` infers is the GENERATED Zod shape; our
        // `SurfaceCertification` is the engine's OWN contract view of the same data
        // (the schema is the serializer — D3). The runtime objects are identical.
        surfacesOfUnit[subject.surface] = {
          ...subject.existing,
          certification: verdict.certification,
        } as never;
      }
    }
    verdicts.push({ key: subject.key, verdict });
  }

  // Only an ATTEMPT changes the ledger. A declared rung and a refused host leave
  // it untouched: neither produced evidence, and writing their reason would pin a
  // read-time derivation into the file. Creating an empty `deployments.yaml` as a
  // side effect of a read would also be a surprise — the ledger file means "data
  // pasco owns", not "a file that exists".
  if (verdicts.some((v) => v.verdict.write)) persistLedger(args, ledger);
  return finishVerify(args, profile, verdicts, requests);
}

/** The report half of `--verify`, run once the (already written) ledger is the
 *  source of truth. Reuses the status report shape so a consumer sees ONE payload
 *  across `status --json` and `status --verify --json`. */
function finishVerify(
  args: StatusArgs,
  profile: LoadedProfile,
  verdicts: { key: string; verdict: SurfaceVerdict }[],
  requests: number,
): number {
  const filtered = filterReport(deployStatus(profile), args.platformArg);

  // DECLARED and REFUSED outcomes are not written to the ledger (neither is an
  // event), so the read above would report the record's previous state and hide
  // what this pass just established. Overlay them for THIS output: the pass states
  // its own conclusion, and the file keeps only durable evidence.
  const derived = new Map<string, Map<string, SurfaceCertification>>();
  for (const { key, verdict } of verdicts) {
    if (verdict.write) continue;
    const surfaces = derived.get(key) ?? new Map<string, SurfaceCertification>();
    surfaces.set(verdict.surface, verdict.certification);
    derived.set(key, surfaces);
  }
  const withDerived: LedgerReport = {
    ...filtered,
    units: filtered.units.map((unit): UnitStatus => {
      const overlay = derived.get(unit.key);
      if (overlay === undefined) return unit;
      const surfaces = {
        ...(unit.certification?.surfaces ?? {}),
        ...Object.fromEntries(overlay),
      };
      const rollup = certificationRollup(surfaces);
      return {
        ...unit,
        certification: {
          state: rollup.state,
          surfaces,
          ...(rollup.reason !== undefined ? { reason: rollup.reason } : {}),
        },
      };
    }),
  };

  if (isJsonMode()) {
    return report("status", true, EXIT.OK, { data: reportDataOf(withDerived, args) });
  }

  section(
    `verified — ${requests} fetch(es) for ${verdicts.length} record(s)${args.platformArg !== undefined ? ` (surface: ${args.platformArg})` : ""}`,
  );
  for (const { key, verdict } of verdicts) {
    line(`  ${key} → ${verdict.surface}: ${certToken(verdict.certification)}`);
  }
  if (verdicts.length === 0) {
    line("  nothing to verify — no ledger record on the requested surface(s)");
  }
  line(
    "  certification compares the LIVE digest against the stored anchor; a record with no anchor is unverifiable: unattributed",
  );
  line(
    "  the ledger file was written — committing content/deployments.yaml is the operator's (D2)",
  );
  return EXIT.OK;
}

/**
 * One `(ledgerKey, surface)` verification: allowlist → fetch → extract → digest →
 * verdict. Every failure path is a VALUE, never a throw. `fetched` distinguishes an
 * attempt (a request left the process) from a declaration (nothing happened);
 * `write` is false for declarations — §19.5 derives their reason at read time.
 */
async function verifySurface(
  surface: string,
  existing: Record<string, unknown>,
  capability: SurfaceCapability | undefined,
  fetchText: FetchText,
): Promise<SurfaceVerdict> {
  const stored = existing.certification as SurfaceCertification | undefined;

  // §19.5 declared absence: no honest check is possible. NOT written — a walled
  // surface needs no ledger row, and a declaration is not an event: the pass
  // states it in its own output and the ledger keeps only durable evidence.
  const declared = declaredReason(capability);
  if (declared !== undefined) {
    return {
      surface,
      certification: { state: "unverifiable", reason: declared },
      fetched: false,
      write: false,
    };
  }
  const extractor = capability?.extractor as (text: string) => string;
  const url = capability?.artifactUrl as string;

  // BEFORE any request: the workspace is untrusted input, so a crafted URL must
  // not be able to aim an opt-in `--verify` at an arbitrary or internal host.
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return {
      surface,
      certification: { state: "unverifiable", reason: "no-artifact-url" },
      fetched: false,
      write: false,
    };
  }
  if (!(capability?.fetchHosts ?? []).includes(host)) {
    // NO request left the process, so the record carries NO fetch evidence: a
    // `method: fetch` + `fetchedAt` here would be durable false evidence. The
    // reason alone is the honest, complete statement (the refused URL is in the
    // session log and in the surface's declared allowlist).
    return {
      surface,
      certification: { state: "unverifiable", reason: "host-not-allowed" },
      fetched: false,
      write: false,
    };
  }

  const fetchedAt = new Date().toISOString();
  const response = await fetchText(url);
  const evidence = {
    ...(stored?.artifactHash !== undefined ? { artifactHash: stored.artifactHash } : {}),
    fetchedAt,
    evidenceUrl: url,
  };

  // Row 1 of the §19.5 table: the attempt did not complete. The reason is the
  // pass's knowledge (the caller owns the request); `core` never invents it.
  if (response.status < 200 || response.status >= 300) {
    return {
      surface,
      certification: attemptRecord(
        { state: "unverifiable", reason: fetchFailureReason(response.status) },
        evidence,
      ),
      fetched: true,
      write: true,
    };
  }

  // Rows 3/4/5: the C1 comparison is `liveHash` ↔ `artifactHash` — NEVER against
  // a freshly re-rendered artifact. An extractor that throws yields no digest
  // (row 5), never a fabricated comparison.
  let digest: string | undefined;
  if (response.text !== undefined) {
    try {
      digest = digestOf(extractor(response.text));
    } catch {
      digest = undefined;
    }
  }
  const verdict: { state: CertificationState; reason?: string } = certificationVerdict(
    { certification: stored },
    { status: response.status, ...(digest !== undefined ? { digest } : {}) },
  );
  return {
    surface,
    certification: attemptRecord(verdict, {
      ...evidence,
      ...(digest !== undefined ? { liveHash: digest } : {}),
    }),
    fetched: true,
    write: true,
  };
}
