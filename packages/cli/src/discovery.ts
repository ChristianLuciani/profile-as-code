/**
 * Discovery — a PROVISIONAL Profile built from public surfaces (SPEC §7.2,
 * issue #329), so `pasco audit`'s checks can run for a prospect who has no
 * workspace yet.
 *
 * Two halves, deliberately separated:
 *
 *   - `provisionalProfile` is PURE: observations in, provisional profile +
 *     per-fact provenance out. No network, no clock (the caller supplies
 *     `retrieved`), no AI. Only facts a surface itself declares are read —
 *     schema.org JSON-LD (`Person`/`Organization`) and the page's links — never
 *     prose mining (the same line drift draws: free-text year extraction is too
 *     fragile to put in a contract).
 *   - `discoveryFindings` composes the checks that already exist: `driftCheck`
 *     over the provisional profile (a prospect who wrote two different start
 *     dates on two surfaces is exactly `drift/duplicate-experience`) plus the two
 *     classes discovery owns — a link the pass could not resolve (`dangling-ref`)
 *     and a numeric claim with no source on the surface (`unsourced-claim`, the
 *     ONE predicate in `claims.ts`).
 *
 * The result is NOT a workspace and is NEVER written: no `content/`, no ledger,
 * no `pasco` state. That is why it is a distinct type instead of a schema
 * version: the provisional shape borrows the Profile geometry so the engine's
 * checks run unchanged, but it is not the persisted contract (D3) and must not
 * become one by accident.
 *
 * Facts are not deduplicated ACROSS surfaces on purpose: `driftCheck` can only
 * see a disagreement it is given, so one row per surface is what makes the
 * contradiction observable. Within one surface, identical facts collapse.
 */

import {
  driftCheck,
  type LoadedProfile,
  normalizeProfile,
  type Profile,
  validateProfile,
} from "@profile-as-code/core";
import { isQuantitativeClaim } from "./claims.js";
import { type AuditFinding, DRIFT_CLASS, factRef, finding, ordered } from "./commands/audit.js";

/** One surface as the transport saw it. `jsonLd` is already parsed; `text` is
 *  the visible text (for the claim rule); `links` are absolute http(s) URLs. */
export interface SurfaceObservation {
  /** Stable label of the origin surface — the hostname without `www.` (e.g. `linkedin.com`). */
  surface: string;
  url: string;
  /** ISO 8601, supplied by the caller: the pure layer never reads a clock. */
  retrieved: string;
  jsonLd: readonly unknown[];
  text: string;
  links: readonly string[];
}

/** What the pass knows about a surface it could NOT read. Never an exception:
 *  a walled or failed surface is data (§19.5 discipline). */
export interface SurfaceUnread {
  url: string;
  surface: string;
  reason: "host-not-allowed" | "network-error" | `http-${number}`;
}

export interface ProvenanceRecord {
  surface: string;
  url: string;
  retrieved: string;
  /** Always false: no human confirmed these facts (C2 `--mark` never ran). */
  attested: false;
}

export interface ProvisionalProfile {
  /** Profile-shaped and schema-valid, so `driftCheck`/`geoCheck` run unchanged. */
  profile: LoadedProfile;
  /** factRef → where the fact came from, `attested: false` on every entry. */
  provenance: Record<string, ProvenanceRecord>;
  /** Facts the extractor looked for and did not find (never defaulted). */
  absent: string[];
}

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

/** The one JSON-LD node type discovery reads. */
function isEntityNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => item === "Person" || item === "Organization");
}

function flattenJsonLd(
  value: unknown,
  out: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
    return out;
  }
  if (typeof value !== "object" || value === null) return out;
  const record = value as Record<string, unknown>;
  if (isEntityNode(record)) out.push(record);
  const graph = record["@graph"];
  if (graph !== undefined) flattenJsonLd(graph, out);
  return out;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function names(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter((item) => item !== "");
  if (Array.isArray(value)) return value.flatMap(names);
  if (typeof value === "object" && value !== null) {
    const name = asString((value as Record<string, unknown>).name);
    return name === undefined ? [] : [name];
  }
  return [];
}

/** `YYYY`, `YYYY-MM` and `YYYY-MM-DD` are all schema-legal dates; the schema
 *  wants `YYYY-MM-DD`, so month/year precision becomes the first of the month. */
function asDate(value: unknown): string | undefined {
  const text = asString(value);
  if (text === undefined) return undefined;
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text);
  if (match === null) return undefined;
  return `${match[1]}-${match[2] ?? "01"}-${match[3] ?? "01"}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

interface WorksForRow {
  org: string;
  start?: string;
  end?: string;
}

function worksForRows(node: Record<string, unknown>): WorksForRow[] {
  const raw = node.worksFor;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const rows: WorksForRow[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      rows.push({ org: item });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    // schema.org `OrganizationRole`: the employer is nested under `worksFor`.
    const nested = record.worksFor;
    const org = names(nested)[0] ?? names(record)[0];
    if (org === undefined) continue;
    rows.push({ org, start: asDate(record.startDate), end: asDate(record.endDate) });
  }
  return rows;
}

/**
 * Build the provisional profile from what the surfaces declared.
 *
 * One experience row per (surface, org) that carries a start date: the row keeps
 * the surface in its id, so provenance is addressable and a cross-surface date
 * disagreement survives into `driftCheck` instead of being averaged away.
 */
export function provisionalProfile(
  observations: readonly SurfaceObservation[],
): ProvisionalProfile {
  const provenance: Record<string, ProvenanceRecord> = {};
  const absent = new Set<string>();
  const experience: NonNullable<Profile["experience"]> = [];
  const links: NonNullable<NonNullable<Profile["identity"]>["links"]> = [];
  const seenLinks = new Set<string>();
  let name: string | undefined;
  let nameSource: SurfaceObservation | undefined;
  let profileUrl: string | undefined;

  const record = (ref: string, observation: SurfaceObservation): void => {
    provenance[ref] = {
      surface: observation.surface,
      url: observation.url,
      retrieved: observation.retrieved,
      attested: false,
    };
  };

  for (const observation of observations) {
    const nodes = flattenJsonLd(observation.jsonLd);
    const node = nodes[0];
    if (node === undefined) continue;

    if (name === undefined) {
      // DECLARED, never inferred: a page title is not the entity's name. If no
      // surface declares one, the command refuses (see the throw below).
      name = asString(node.name);
      if (name !== undefined) nameSource = observation;
    }
    profileUrl ??= httpUrl(observation.url);

    for (const url of names(node.sameAs)
      .map(httpUrl)
      .filter((item) => item !== undefined)) {
      if (seenLinks.has(url)) continue;
      seenLinks.add(url);
      links.push({ role: "realization", url });
      record(`identity.links[${links.length - 1}]`, observation);
    }

    const role = asString(node.jobTitle);
    if (role === undefined) continue;
    for (const row of worksForRows(node)) {
      if (row.start === undefined) continue;
      const id = slug(`${observation.surface}-${row.org}`);
      if (id === "" || experience.some((item) => item.id === id)) continue;
      experience.push({
        id,
        role,
        org: row.org,
        start: row.start,
        ...(row.end !== undefined ? { end: row.end } : {}),
      });
      record(`experience[${id}]`, observation);
    }
  }

  if (name === undefined) {
    throw new DiscoveryError(
      "no surface declared an entity name (schema.org JSON-LD `Person`/`Organization`) — a provisional profile needs at least `identity.name`; nothing was invented",
    );
  }
  if (nameSource !== undefined) record("identity.name", nameSource);
  if (profileUrl !== undefined && !seenLinks.has(profileUrl)) {
    links.push({ role: "identity", url: profileUrl });
    record(`identity.links[${links.length - 1}]`, observations[0] as SurfaceObservation);
  }
  if (links.length === 0) absent.add("identity.links");
  if (experience.length === 0) absent.add("experience");

  const profile: Profile = {
    identity: { name, ...(links.length > 0 ? { links } : {}) },
    ...(experience.length > 0 ? { experience } : {}),
  };

  return {
    profile: normalizeProfile(validateProfile(profile)),
    provenance,
    absent: [...absent].sort(),
  };
}

/** Rows that share a role+org key (the same key `driftCheck` groups by). */
function duplicatedExperience(profile: LoadedProfile): { id?: string }[] {
  const groups = new Map<string, { id?: string }[]>();
  for (const row of profile.experience) {
    const key = `${typeof row.role === "string" ? row.role : row.role.en}/${row.org}`.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].filter((rows) => rows.length > 1).flat();
}

/** Classes the SURFACES own (the drift side comes from `driftCheck`). */
export interface UnresolvedLink {
  surface: string;
  url: string;
  /** 404/410 only: the pointer was answered and is gone. Every other non-2xx is
   *  a failed probe (rate limit, transport, server error), never evidence that
   *  the reader would hit a dead link. */
  status: 404 | 410;
}

/**
 * Findings over the provisional profile. Reuses the audit's class contract —
 * same three classes, same fixed severities, same deterministic order — so a
 * prospect's report reads like a workspace audit.
 */
export function discoveryFindings(
  provisional: ProvisionalProfile,
  observations: readonly SurfaceObservation[],
  unresolved: readonly UnresolvedLink[] = [],
): AuditFinding[] {
  const { profile, provenance } = provisional;
  const findings: AuditFinding[] = [];

  const provenanceOf = (ref: string): string => {
    const record = provenance[ref];
    return record === undefined ? ref : `${record.surface} (${record.url})`;
  };

  for (const issue of driftCheck(profile)) {
    const mapped = Object.hasOwn(DRIFT_CLASS, issue.code)
      ? DRIFT_CLASS[issue.code]
      : "contradiction";
    if (mapped === null || mapped === undefined) continue;
    const ref = factRef(profile, issue.path);
    // A cross-surface conflict must cite EVERY surface that asserted it, not
    // just the first row driftCheck happens to address: otherwise the reader
    // cannot go check both claims.
    const cited =
      issue.code === "drift/duplicate-experience"
        ? duplicatedExperience(profile)
            .map((row) => provenanceOf(`experience[${row.id}]`))
            .join(" · ")
        : provenanceOf(ref);
    const suffix = cited === ref || cited === "" ? "" : ` — asserted by ${cited}`;
    findings.push(finding(mapped, ref, `${issue.code} — ${issue.message}${suffix}`));
  }

  for (const link of unresolved) {
    findings.push(
      finding(
        "dangling-ref",
        `links[${link.surface}]`,
        `${link.url} did not resolve (status ${link.status}) — a pointer a reader would hit and not find`,
      ),
    );
  }

  for (const observation of observations) {
    for (const sentence of observation.text.split(/(?<=[.!?])\s+|\n/)) {
      const text = sentence.trim();
      if (!isQuantitativeClaim(text)) continue;
      if (/source:|evidence:|https?:\/\//i.test(text)) continue;
      findings.push(
        finding(
          "unsourced-claim",
          `surface[${observation.surface}].text`,
          `${observation.surface} asserts a quantitative claim with no source on the surface: "${text.slice(0, 160)}"`,
        ),
      );
    }
  }

  return ordered(findings);
}
