/**
 * `pasco discover <url>...` — a provisional Profile from public surfaces
 * (SPEC §7.10, issue #329).
 *
 * This module owns the TRANSPORT, and only the transport: allowlist check BEFORE
 * any request, one sequential request per surface, no retries, no credentials, no
 * cookies, no browser automation, redirects refused. The rules are §19.5's
 * (the engine's one network path); the driver is the same `httpFetchText`, so
 * there is one HTTP discipline in the engine, not two.
 *
 * The allowlist is CLOSED: the platform hosts projected from
 * `platforms/registry.yaml` (the one metadata home, #154) plus whatever the
 * operator explicitly declares with `--allow-host`. A URL outside it produces
 * `host-not-allowed` and NO request leaves the process — a prospect's URL is
 * untrusted input, and an unvalidated fetch would be an SSRF primitive (the same
 * reason `status --verify` validates first).
 *
 * The command writes NOTHING: no `facts/`, no ledger, no artifact. `wrote:
 * false` is part of the report so the invariant is visible, and a test asserts
 * the workspace is byte-identical after a run.
 *
 * The extraction/assembly/class logic is pure and lives in `../discovery.ts`.
 *
 * `--observations` adds rows the OPERATOR read by hand (`../observations.ts`,
 * SPEC §7.10, #412): they make NO request — a row's URL is a provenance label a
 * reader can open, never a fetch target — and they enter the same assembly, so
 * the allowlist and its request budget still govern only the transport.
 */

import { PLATFORM_HOSTS } from "@profile-as-code/core";
import {
  DiscoveryError,
  declaredName,
  discoveryFindings,
  provisionalProfile,
  type SurfaceObservation,
  type SurfaceUnread,
  type UnresolvedLink,
} from "../discovery.js";
import { EXIT } from "../exit.js";
import { httpFetchText } from "../fetch-http.js";
import { loadObservations } from "../observations.js";
import { isJsonMode, line, report, section } from "../output.js";
import type { FetchText } from "../verify.js";

/** The frozen `--json` contract version of this command. **v2 (#412)**: a
 *  surface entry gained `via` and its `status` became nullable for a manual row,
 *  so a shape change is declared instead of shipped under v1 (§7.5's rule). */
export const DISCOVER_SCHEMA_VERSION = "2";

/** A surface not read because its URL could not be parsed at all. */
export type UnreadReason = SurfaceUnread["reason"] | "invalid-url";

/** How a surface's facts entered the run: read by the transport, or declared by
 *  the operator in `--observations` (a label, never a fetch; SPEC §7.10, #412). */
export type SurfaceVia = "fetch" | "manual";

export interface DiscoverSurface {
  url: string;
  surface: string;
  /** The HTTP status of the read; `null` for a manual observation (no request
   *  was made, so there is no status to report — never a made-up 200). */
  status: number | null;
  via: SurfaceVia;
}

export interface DiscoverResult {
  schemaVersion: string;
  surfaces: DiscoverSurface[];
  unchecked: { url: string; surface: string; reason: UnreadReason }[];
  provisional: ReturnType<typeof provisionalProfile>;
  findings: ReturnType<typeof discoveryFindings>;
  wrote: false;
}

export interface DiscoverOptions {
  urls: readonly string[];
  /** ISO 8601. Supplied by the caller so the pure layer never reads a clock;
   *  tests pin it. */
  retrieved?: string;
  /** Injected in tests (§19.5 determinism). Defaults to the engine's driver. */
  fetchText?: FetchText;
  /** Extra hosts the OPERATOR declares, in addition to the registry's. */
  allowHosts?: readonly string[];
  /** Rows the operator read by hand (`--observations`, SPEC §7.10). Already
   *  parsed into the transport's own observation shape; they make NO request and
   *  are assembled FIRST, so the declared identity name wins when both sources
   *  carry one. */
  manualObservations?: readonly SurfaceObservation[];
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function httpUrl(raw: string, base?: string): string | undefined {
  try {
    const url = new URL(raw, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function jsonLdOf(html: string): unknown[] {
  const nodes: unknown[] = [];
  const pattern =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const body = match[1];
    if (body === undefined) continue;
    try {
      nodes.push(JSON.parse(body.trim()));
    } catch {
      // A malformed block is not a discovery failure: the page's other blocks
      // (and its links) still carry facts. It is simply not evidence.
    }
  }
  return nodes;
}

/** Visible text only: script/style/tags removed. Block boundaries become line
 *  breaks (never a space): the title must not merge into the first body
 *  sentence, or the page's own name turns chrome into a claim (#419). A
 *  newline in the HTML SOURCE is prose wrapping, not a boundary — it is
 *  collapsed BEFORE the markers are injected, or a wrapped sentence is split
 *  and its subject lost. */
function textOf(html: string): string {
  const collapsed = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/\s+/g, " ");
  const withBreaks = collapsed
    .replace(
      /<\/(?:p|div|li|h[1-6]|title|header|footer|section|article|tr|td|th|main|nav)\s*>/gi,
      "\n",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeEntities(withBreaks)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
  return lines.join("\n");
}

function linksOf(html: string, base: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const resolved = httpUrl(decodeEntities(raw), base);
    if (resolved === undefined || seen.has(resolved)) continue;
    seen.add(resolved);
    links.push(resolved);
  }
  return links;
}

function keyOf(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Read the declared surfaces. Sequential by contract; a surface that cannot be
 * read is DATA (`unchecked`), never an exception.
 */
export async function discover(options: DiscoverOptions): Promise<DiscoverResult> {
  const fetchText = options.fetchText ?? httpFetchText;
  const retrieved = options.retrieved ?? new Date().toISOString();
  const allowed = new Set(
    [...PLATFORM_HOSTS, ...(options.allowHosts ?? [])].map((host) =>
      host.toLowerCase().replace(/^www\./, ""),
    ),
  );

  const surfaces: DiscoverSurface[] = [];
  const manual = options.manualObservations ?? [];
  // Manual rows enter FIRST (they are the operator's own reading of the surface
  // and carry the declared name when the machine-read surfaces carry none), and
  // they add their surfaces to the report with `via: "manual"` and NO status —
  // no request was made, and a fabricated 200 would be a claim, not a reading.
  const observations: SurfaceObservation[] = [...manual];
  const seenManual = new Set<string>();
  for (const observation of manual) {
    const key = `${observation.surface}\u0000${observation.url}`;
    if (seenManual.has(key)) continue;
    seenManual.add(key);
    surfaces.push({
      url: observation.url,
      surface: observation.surface,
      status: null,
      via: "manual",
    });
  }
  const unchecked: DiscoverResult["unchecked"] = [];

  for (const raw of options.urls) {
    const url = httpUrl(raw);
    const host = url === undefined ? undefined : hostOf(url);
    const surface = host ?? raw;
    if (url === undefined || host === undefined) {
      unchecked.push({ url: raw, surface, reason: "invalid-url" });
      continue;
    }
    if (!allowed.has(host)) {
      // NO request leaves the process (SPEC §19.5 rule 2).
      unchecked.push({ url, surface, reason: "host-not-allowed" });
      continue;
    }

    const response = await fetchText(url);
    if (response.status < 200 || response.status >= 300) {
      unchecked.push({
        url,
        surface,
        reason: response.status === 0 ? "network-error" : `http-${response.status}`,
      });
      continue;
    }

    const html = response.text ?? "";
    surfaces.push({ url, surface, status: response.status, via: "fetch" });
    observations.push({
      surface,
      url,
      retrieved,
      jsonLd: jsonLdOf(html),
      text: textOf(html),
      links: linksOf(html, url),
    });
  }

  if (observations.length === 0) {
    const reasons = [...new Set(unchecked.map((item) => item.reason))].join(", ");
    throw new DiscoveryError(
      `no surface could be read (${reasons}) — nothing to discover; the report is not an empty profile`,
    );
  }

  // A pointer that does not resolve: only links on the surface's OWN host are
  // followed (a stranger's host is outside the allowlist and would be a crawl),
  // capped so a link-heavy page never becomes one. Manual rows carry no links,
  // so this pass is over what the transport read.
  const unresolved: UnresolvedLink[] = [];
  for (const observation of observations) {
    const own = hostOf(observation.url);
    const candidates = observation.links
      .filter((link) => hostOf(link) === own && keyOf(link) !== keyOf(observation.url))
      .slice(0, 5);
    for (const [index, link] of candidates.entries()) {
      const response = await fetchText(link);
      if (response.status >= 200 && response.status < 300) continue;
      // A rate limit, a transport failure or a 5xx is NOT a dangling pointer:
      // it is a probe that did not complete, and grading it FAIL would let a
      // stranger's 429 block our exit code. Only "answered and gone" counts.
      if (response.status !== 404 && response.status !== 410) continue;
      unresolved.push({
        surface: observation.surface,
        index,
        url: link,
        status: response.status,
      });
    }
  }

  // A manual run that declares no name gets the refusal in its own terms: the
  // assembly's message names schema.org JSON-LD, which is not what the operator
  // supplied (a hand-read row). Name is still mandatory and still never invented.
  if (manual.length > 0 && !observations.some((item) => declaredName(item) !== undefined)) {
    throw new DiscoveryError(
      "observations: no row declares `name` (field: name) and no machine-read surface declared one either — a provisional profile needs identity.name, and nothing is invented; add a row with field: name",
    );
  }

  const provisional = provisionalProfile(observations);
  return {
    schemaVersion: DISCOVER_SCHEMA_VERSION,
    surfaces,
    unchecked,
    provisional,
    findings: discoveryFindings(provisional, observations, unresolved),
    wrote: false,
  };
}

export interface DiscoverCommandArgs {
  urls: readonly string[];
  allowHosts?: readonly string[];
  retrieved?: string;
  fetchText?: FetchText;
  /** `--observations <file>`: the operator's hand-read rows (SPEC §7.10). */
  observationsPath?: string;
}

export async function runDiscover(args: DiscoverCommandArgs): Promise<number> {
  let result: DiscoverResult;
  try {
    // A malformed, unreadable or empty file refuses through the same discovery
    // error envelope: the input is data, not a flag mistake.
    const manualObservations =
      args.observationsPath === undefined ? undefined : loadObservations(args.observationsPath);
    result = await discover({
      urls: args.urls,
      ...(args.allowHosts !== undefined ? { allowHosts: args.allowHosts } : {}),
      ...(args.retrieved !== undefined ? { retrieved: args.retrieved } : {}),
      ...(args.fetchText !== undefined ? { fetchText: args.fetchText } : {}),
      ...(manualObservations !== undefined ? { manualObservations } : {}),
    });
  } catch (err) {
    if (err instanceof DiscoveryError) {
      return report("discover", false, EXIT.FAIL, {
        error: { kind: "discovery", message: err.message },
      });
    }
    throw err;
  }

  const failures = result.findings.filter((item) => item.severity === "FAIL").length;
  const exitCode = failures > 0 ? EXIT.FAIL : EXIT.OK;

  if (isJsonMode()) {
    return report("discover", failures === 0, exitCode, { data: result });
  }

  section("discover — a provisional profile (nothing written, every fact unattested)");
  for (const surface of result.surfaces) {
    line(
      surface.via === "manual"
        ? `  observed ${surface.surface} — ${surface.url} (manual, no request)`
        : `  read ${surface.surface} — ${surface.url}`,
    );
  }
  for (const item of result.unchecked) line(`  NOT read ${item.surface} — ${item.reason}`);
  line(`  facts: ${Object.keys(result.provisional.provenance).length} with provenance`);
  line(`  absent (not discovered, never defaulted): ${result.provisional.absent.join(", ")}`);
  if (result.findings.length === 0) {
    line("  no findings");
  } else {
    for (const item of result.findings) {
      line(`  ${item.severity} ${item.class} ${item.path}`);
      line(`    ${item.detail}`);
    }
  }
  const warnings = result.findings.length - failures;
  line(
    `pasco discover: ${result.findings.length} finding(s) — ${failures} FAIL · ${warnings} WARN — exit ${exitCode} · wrote nothing`,
  );
  return exitCode;
}
