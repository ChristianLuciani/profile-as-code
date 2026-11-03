/**
 * Discovery — a PROVISIONAL Profile built from public surfaces (SPEC §7.10,
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
 *
 * An observation does not have to come from the transport: `--observations`
 * (#412) turns the operator's hand-read rows into the same shape, so a walled
 * surface with no JSON-LD enters this assembly instead of a parallel one. The
 * source is declared per surface in the report (`via`), never inferred.
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
      "no surface declared an entity name: discovery reads only schema.org `Person`/`Organization` JSON-LD, which a GitHub profile (and a product/page node such as `SoftwareApplication`) does not carry — point it at a personal site or page that declares a `Person` or `Organization` node; a provisional profile needs at least `identity.name`, and nothing was invented",
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

/** Last path segments that are page navigation, not a handle (`/about`,
 *  `/blog`): accepting them turns an ordinary word into a subject token and
 *  makes the filter inert on exactly the surfaces #418 recommends. */
const NAVIGATION_SEGMENTS = new Set([
  "about",
  "articles",
  "blog",
  "careers",
  "categories",
  "category",
  "contact",
  "cv",
  "docs",
  "download",
  "downloads",
  "events",
  "faq",
  "feed",
  "help",
  "home",
  "index",
  "jobs",
  "login",
  "me",
  "news",
  "page",
  "pages",
  "portfolio",
  "posts",
  "pricing",
  "privacy",
  "profile",
  "projects",
  "resume",
  "rss",
  "search",
  "series",
  "signup",
  "site",
  "sitemap",
  "subscribe",
  "support",
  "t",
  "tag",
  "tags",
  "team",
  "terms",
  "topic",
  "topics",
  "work",
  "writing",
]);

/**
 * Lowercase particles of three or more characters that link name parts. As
 * prose words they would match any sentence ("van 40 medewerkers", "más de
 * 40"), so the DECLARED lowercase spelling is not a subject token. One- and
 * two-character lowercase words are covered by the length signal (`de`, `zu`,
 * `el`); a capitalized "Al" is a name word and is kept, and a short single-word
 * name (`Li`) is kept — the whole name is always a token.
 */
const NAME_PARTICLES = new Set([
  "bin",
  "das",
  "del",
  "den",
  "der",
  "des",
  "dos",
  "ibn",
  "las",
  "los",
  "ter",
  "van",
  "von",
]);

/**
 * Tokens that identify the profile's subject: the DECLARED name (whole and per
 * word) plus each surface's handle — the last path segment of the URL the
 * operator passed, e.g. `dev.to/ben` → `ben`. Links the page declares
 * (`sameAs`) are NOT handles: a repo slug on a linked project is not the
 * person. Discovery-specific by design — `isQuantitativeClaim` stays the
 * shared predicate with `post`/`audit`, which ask about the author's own text
 * and need no subject filter (#419).
 */
function subjectTokens(
  provisional: ProvisionalProfile,
  observations: readonly SurfaceObservation[],
): string[] {
  const name = provisional.profile.identity.name.trim();
  const tokens = new Set<string>([name]);
  for (const word of name.split(/\s+/).filter((item) => item !== "")) {
    // Lowercase only: a capitalized "Al" is a name word. Short lowercase words
    // are particles whatever the list says (`zu`, `el`, `te`), while the list
    // covers the three-plus ones (`van`, `dos`, `der`).
    if (word === word.toLowerCase() && (word.length < 3 || NAME_PARTICLES.has(word))) {
      continue;
    }
    tokens.add(word);
  }
  for (const url of observations.map((item) => item.url)) {
    let segment: string | undefined;
    try {
      segment = new URL(url).pathname
        .split("/")
        .filter((item) => item !== "")
        .pop();
    } catch {
      continue;
    }
    if (segment === undefined || /^\d+$/u.test(segment)) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      continue;
    }
    if (NAVIGATION_SEGMENTS.has(decoded.toLowerCase())) continue;
    tokens.add(decoded);
    // A lowercase handle is written capitalized in prose (`dev.to/ben` talks
    // about "Ben"); short tokens match case-sensitively, so carry both forms.
    if (decoded === decoded.toLowerCase() && decoded.length > 1) {
      tokens.add(decoded.charAt(0).toUpperCase() + decoded.slice(1));
    }
  }
  return [...tokens];
}

/** Unicode-aware word boundaries: `\b` is ASCII-only in JavaScript, so a name
 *  ending in `é`/`ñ` would never match with it. */
const TOKEN_START = "(?<![\\p{L}\\p{N}_])";
const TOKEN_END = "(?![\\p{L}\\p{N}_])";

/** Bare `I` is case-sensitive on purpose: under `/i` the abbreviation "i.e."
 *  would make any sentence first-person. The boundaries are Unicode-aware for
 *  the same reason as the token matcher (`Iñaki` is not the pronoun). */
const FIRST_PERSON_PRONOUN = new RegExp(`${TOKEN_START}I${TOKEN_END}`, "u");
const FIRST_PERSON_CONTRACTION = new RegExp(`${TOKEN_START}[Ii]['’](?:m|ve|d|ll)${TOKEN_END}`, "u");
const FIRST_PERSON_POSSESSIVE = new RegExp(`${TOKEN_START}(?:my|me|mine|myself)${TOKEN_END}`, "iu");

function isFirstPerson(text: string): boolean {
  return (
    FIRST_PERSON_PRONOUN.test(text) ||
    FIRST_PERSON_CONTRACTION.test(text) ||
    FIRST_PERSON_POSSESSIVE.test(text)
  );
}

/** True when the sentence is about the entity: it names it (or its handle), or
 *  it is first-person — the page is the profile's own surface. A third party's
 *  counter ("Jane has 10,000 followers") is not the profile's claim.
 *
 *  Tokens of four characters or fewer match CASE-SENSITIVELY: a short declared
 *  word ("Will") or handle ("ben") is also an ordinary lowercase word, and
 *  matching "will" in any sentence would make the filter inert. The declared
 *  spelling is what a claim about the entity uses (`Will shipped…`, `Li…`). */
function isAboutEntity(text: string, tokens: readonly string[]): boolean {
  if (isFirstPerson(text)) return true;
  return tokens.some((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = token.length <= 4 ? "u" : "iu";
    return new RegExp(`${TOKEN_START}${escaped}${TOKEN_END}`, flags).test(text);
  });
}

/**
 * The role+org key `driftCheck` groups experience rows by.
 */
function experienceKey(row: LoadedProfile["experience"][number]): string {
  const role = typeof row.role === "string" ? row.role : row.role.en;
  return `${role}/${row.org}`.toLowerCase();
}

/**
 * ONLY the rows that share the conflicting row's key. Returning every duplicated
 * group would name an unrelated (and agreeing) role as "asserted by" this
 * conflict — a false attribution, worse than no citation.
 */
function conflictRows(profile: LoadedProfile, path: string): { id?: string }[] {
  const match = /^experience\[(\d+)\]/.exec(path);
  const index = match?.[1];
  if (index === undefined) return [];
  const row = profile.experience[Number(index)];
  if (row === undefined) return [];
  const key = experienceKey(row);
  return profile.experience.filter((item) => experienceKey(item) === key);
}

/** Classes the SURFACES own (the drift side comes from `driftCheck`). */
export interface UnresolvedLink {
  surface: string;
  /** Position of this probe within its surface (0-based), so two dead links on
   *  one surface are two distinguishable findings. */
  index: number;
  url: string;
  /** 404/410 only: the pointer was answered and is gone. Every other non-2xx is
   *  a failed probe (rate limit, transport, server error), never evidence that
   *  the reader would hit a dead link. */
  status: 404 | 410;
}

/** The entity name one observation DECLARES (never inferred from a page title).
 *  Exported because the manual-input path needs the same rule to explain its
 *  refusal before the provisional layer's JSON-LD-specific message would. */
export function declaredName(observation: SurfaceObservation): string | undefined {
  const node = flattenJsonLd(observation.jsonLd)[0];
  return node === undefined ? undefined : asString(node.name);
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
        ? conflictRows(profile, issue.path)
            .map((row) => provenanceOf(`experience[${row.id}]`))
            .join(" · ")
        : provenanceOf(ref);
    const suffix = cited === ref || cited === "" ? "" : ` — asserted by ${cited}`;
    findings.push(finding(mapped, ref, `${issue.code} — ${issue.message}${suffix}`));
  }

  // The name is the one datum a prospect's surfaces usually DO repeat, and the
  // provisional profile can hold only one `identity.name` (the first
  // declaration). Without this rule the second declaration would be dropped in
  // silence — and the disagreement IS the finding (SPEC §7.10, #412).
  const declared = observations.flatMap((observation) => {
    const name = declaredName(observation);
    return name === undefined ? [] : [{ name, observation }];
  });
  const normalizedNames = new Set(
    declared.map((item) => item.name.normalize("NFC").toLowerCase().replace(/\s+/gu, " ")),
  );
  if (normalizedNames.size > 1) {
    const where =
      new Set(declared.map((item) => item.observation.surface)).size > 1
        ? "across surfaces"
        : "on one surface";
    findings.push(
      finding(
        "contradiction",
        "identity.name",
        `identity.name is declared differently ${where}: ${declared
          .map(({ name, observation }) => `"${name}" — ${observation.surface} (${observation.url})`)
          .join(" · ")}`,
      ),
    );
  }

  for (const link of unresolved) {
    findings.push(
      finding(
        "dangling-ref",
        `links[${link.surface}][${link.index}]`,
        `${link.url} did not resolve (status ${link.status}) — a pointer a reader would hit and not find`,
      ),
    );
  }

  const subjects = subjectTokens(provisional, observations);
  const seenSentences = new Set<string>();
  for (const observation of observations) {
    for (const [index, sentence] of observation.text.split(/(?<=[.!?])\s+|\n/).entries()) {
      const text = sentence.trim();
      if (!isQuantitativeClaim(text)) continue;
      if (/source:|evidence:|https?:\/\//i.test(text)) continue;
      // Only claims about the entity: the whole-page text also carries the
      // host's chrome (badges, counters, the copyright footer), which is not a
      // claim about the person (#419). The same sentence on two surfaces is one
      // finding.
      if (!isAboutEntity(text, subjects)) continue;
      const key = text.toLowerCase();
      if (seenSentences.has(key)) continue;
      seenSentences.add(key);
      findings.push(
        finding(
          "unsourced-claim",
          `surface[${observation.surface}].text[${index}]`,
          `${observation.surface} asserts a quantitative claim with no source on the surface: "${text.slice(0, 160)}"`,
        ),
      );
    }
  }

  return ordered(findings);
}
