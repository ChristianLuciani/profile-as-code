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
 * The command writes NOTHING: no `content/`, no ledger, no artifact. `wrote:
 * false` is part of the report so the invariant is visible, and a test asserts
 * the workspace is byte-identical after a run.
 *
 * The extraction/assembly/class logic is pure and lives in `../discovery.ts`.
 */

import { PLATFORM_HOSTS } from "@profile-as-code/core";
import {
  DiscoveryError,
  discoveryFindings,
  provisionalProfile,
  type SurfaceObservation,
  type SurfaceUnread,
  type UnresolvedLink,
} from "../discovery.js";
import { EXIT } from "../exit.js";
import { httpFetchText } from "../fetch-http.js";
import { isJsonMode, line, report, section } from "../output.js";
import type { FetchText } from "../verify.js";

/** The frozen `--json` contract version of this command. */
export const DISCOVER_SCHEMA_VERSION = "1";

/** A surface not read because its URL could not be parsed at all. */
export type UnreadReason = SurfaceUnread["reason"] | "invalid-url";

export interface DiscoverSurface {
  url: string;
  surface: string;
  status: number;
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

/** Visible text only: script/style/tags removed, whitespace collapsed. */
function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
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
  const observations: SurfaceObservation[] = [];
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
    surfaces.push({ url, surface, status: response.status });
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
  // capped so a link-heavy page never becomes one.
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
}

export async function runDiscover(args: DiscoverCommandArgs): Promise<number> {
  let result: DiscoverResult;
  try {
    result = await discover(args);
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
  for (const surface of result.surfaces) line(`  read ${surface.surface} — ${surface.url}`);
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
