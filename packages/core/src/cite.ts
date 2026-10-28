/**
 * cite.ts — the deterministic citation matcher (SPEC §7.4, issue #291).
 *
 * The engine answers ONE question about an answer-engine record: did this saved
 * answer cite this entity? It is a pure function over the SSOT and the answer
 * bytes — no network, no model, no clock (D19) — because the alternative
 * (substring matching) is why GEO reporting overreports, and the only fix is a
 * matcher that says exactly which text it matched, why, and when it refuses to
 * guess.
 *
 * The vocabulary is the workspace's DECLARED data, never world knowledge:
 *   name     identity.name
 *   alias    identity.orgName (the one declared alternate name the schema has)
 *   handle   identity.handle (its final token, '@' stripped) + socialHandles
 *            rows with status: claimed
 *   hosts    the role: identity URL and the sameAs set (structured-data.ts —
 *            one derivation, never a second)
 *   partial  a contiguous multi-token prefix of the name (low confidence)
 *
 * Normalization and word-boundary matching live in `normalize.ts` — the same
 * fold `geoCheck` reads, so the two sides cannot disagree about a name.
 *
 * Four guards make a text hit NOT a citation (`cited: false`): a shorter term
 * contained in a longer one, a hit inside a longer capitalised phrase the text
 * carries, a one-word name with no declared disambiguator in its sentence, and a
 * mention inside a contrast clause. Each reports its reason; `confidence: low`
 * is never citable downstream (declared in §7.4).
 */

import { byteOrder } from "./byte-order.js";
import { disambiguationQualifiers } from "./geo.js";
import { findTerm, foldForMatch, normalizeText, termOccursIn } from "./normalize.js";
import { entityId, sameAsUrls } from "./structured-data.js";
import type { Profile } from "./types.js";

/** The rung a span was matched by — one kind per ladder rung (SPEC §7.4). */
export type CiteSpanKind = "citation-url" | "name" | "alias" | "handle" | "partial";

/** The best surviving rung. `low` is never a citation in a downstream report. */
export type CiteConfidence = "high" | "medium" | "low";

/** One citation row of the runner's input contract. */
export interface CiteCitation {
  url: string;
  title?: string;
}

/**
 * One saved answer (the runner's contract, never produced here). The matcher
 * reads `answer` + `citations`; the rest is carried through for a report.
 */
export interface CiteAnswer {
  engine?: string | null;
  askedAt?: string | null;
  question?: string | null;
  answer: string;
  citations?: CiteCitation[];
}

/** A matched span: a character range in `answer`, or a citation pointer. */
export interface CiteSpan {
  /** Original offset (inclusive). 0 for a `citation-url` span (not in the text). */
  start: number;
  /** Original offset (exclusive). 0 for a `citation-url` span. */
  end: number;
  kind: CiteSpanKind;
  /** The citation URL — only on `citation-url` spans. */
  url?: string;
}

/** Per-answer result. Never aggregated by the engine (SPEC §7.4). */
export interface CiteMatch {
  cited: boolean;
  confidence: CiteConfidence;
  spans: CiteSpan[];
  reasons: string[];
}

/**
 * The vocabulary the matcher resolved from the workspace. Exposed in `--json`
 * so a report can say WHAT was matched without re-reading the SSOT.
 */
export interface CiteVocabulary {
  name: string;
  aliases: string[];
  handles: string[];
  partials: string[];
  hosts: string[];
}

/**
 * One declared citation target: a `@id`/sameAs URL reduced to the host + path
 * the citation rung compares, and which authority it carries (the reason).
 */
interface DeclaredTarget {
  host: string;
  /** Path of the declared URL, without a trailing slash (`""` for the root). */
  path: string;
  kind: "identity" | "sameAs";
}

interface Vocabulary {
  public: CiteVocabulary;
  targets: DeclaredTarget[];
  /** Disambiguating phrases (location, experience roles, other terms). */
  qualifiers: string[];
  /** Every normalized declared term — a capitalised run equal to one is not a competitor. */
  knownTerms: Set<string>;
}

const RUNG_ORDER: readonly CiteSpanKind[] = ["name", "alias", "handle", "partial"];

const RUNG_RANK: Readonly<Record<CiteSpanKind, number>> = {
  "citation-url": 0,
  name: 0,
  alias: 1,
  handle: 2,
  partial: 3,
};

const RUNG_REASON: Readonly<Record<CiteSpanKind, string>> = {
  "citation-url": "citation-url",
  name: "exact-name",
  alias: "alias",
  handle: "handle",
  partial: "partial",
};

/**
 * The closed contrast lexicon (§7.4, declared limit): a mention inside a
 * comparison is not an assertion about the entity. EN · ES · PT, matched
 * case- and accent-insensitively as a phrase, only BEFORE the hit.
 */
const CONTRAST_MARKERS: readonly string[] = [
  "unlike",
  "contrary to",
  "as opposed to",
  "rather than",
  "instead of",
  "versus",
  "vs",
  "compared to",
  "a diferencia de",
  "en contraste con",
  "en lugar de",
  "em vez de",
  "ao contrário de",
  "diferentemente de",
];

/** Reason ordering in the output set (SPEC §7.4: a fixed order). */
const REASON_ORDER: readonly string[] = [
  "citation-url",
  "identity-domain",
  "sameAs-domain",
  "exact-name",
  "alias",
  "handle",
  "partial",
  "longer-name",
  "competing",
  "ambiguous-term",
  "no-qualifier",
  "contrast-context",
];

/** Host of a URL, lowercased and with a leading `www.` stripped. */
function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}

/** Citation host belongs to a declared host: equal, or a subdomain of it. */
function sameSite(citationHost: string, declaredHost: string): boolean {
  return citationHost === declaredHost || citationHost.endsWith(`.${declaredHost}`);
}

/** A declared URL's path, without a trailing slash (`""` for the root). */
function pathOf(url: string): string | undefined {
  try {
    return new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Does the cited URL point at the declared one? A shared host alone is not
 * enough: `github.com/someone-else` shares `github.com` with a declared
 * `github.com/elenavasquez`, and host-only matching would overreport exactly
 * the way substring matching does. A declared URL on the root claims the whole
 * host; a declared URL with a path claims that path and its descendants.
 */
function pathMatches(citationPath: string, declaredPath: string): boolean {
  if (declaredPath === "") return true;
  return citationPath === declaredPath || citationPath.startsWith(`${declaredPath}/`);
}

/**
 * The declared handle inside a free-text `identity.handle` ("X @cluciani_ve"):
 * its final whitespace-separated token, leading `@` stripped, trailing
 * punctuation trimmed. Nothing is parsed beyond that (declared limit).
 */
function parseDeclaredHandle(raw: string): string | undefined {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (last === undefined) return undefined;
  const cleaned = last.replace(/^@+/, "").replace(/[.,;:)\]}]+$/, "");
  return cleaned.length >= 2 ? cleaned : undefined;
}

/** Push `value` unless its normalized form is already present (order preserved). */
function pushUnique(out: string[], seen: Set<string>, value: string): void {
  const key = normalizeText(value);
  if (key === "" || seen.has(key)) return;
  seen.add(key);
  out.push(value);
}

/**
 * Resolve the workspace's declared citation vocabulary. One source per fact:
 * `sameAsUrls` and `entityId` are the structured-data set — never re-derived.
 */
function buildVocabulary(profile: Profile): Vocabulary {
  const identity = profile.identity;
  const name = identity.name.trim();

  const used = new Set<string>([normalizeText(name)]);
  const aliases: string[] = [];
  const orgName = identity.orgName?.trim();
  if (orgName !== undefined && orgName !== "") pushUnique(aliases, used, orgName);

  const handles: string[] = [];
  const handle = identity.handle?.trim();
  if (handle !== undefined && handle !== "") {
    const parsed = parseDeclaredHandle(handle);
    if (parsed !== undefined) pushUnique(handles, used, parsed);
  }
  for (const row of profile.socialHandles ?? []) {
    if (row.status !== "claimed") continue;
    pushUnique(handles, used, row.handle.trim());
  }

  const partials: string[] = [];
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) pushUnique(partials, used, tokens.slice(0, -1).join(" "));

  const targets: DeclaredTarget[] = [];
  const seenTargets = new Set<string>();
  const addTarget = (url: string | undefined, kind: DeclaredTarget["kind"]): void => {
    if (url === undefined) return;
    const host = hostOf(url);
    const path = pathOf(url);
    if (host === undefined || path === undefined) return;
    const key = `${host}${path}`;
    if (seenTargets.has(key)) return;
    seenTargets.add(key);
    targets.push({ host, path, kind });
  };
  // The entity's own page first: a citation of it is still a citation of the
  // entity, and the reason says which authority the target came from.
  addTarget(entityId(identity), "identity");
  for (const url of sameAsUrls(profile)) addTarget(url, "sameAs");

  const knownTerms = new Set<string>();
  for (const term of [name, ...aliases, ...handles]) {
    const key = normalizeText(term);
    if (key !== "") knownTerms.add(key);
  }

  // Qualifiers are declared, never inferred: the location and role titles
  // geoCheck's name-collision already reads (one home) plus the entity's other
  // declared terms.
  const qualifiers: string[] = [];
  const seenQualifiers = new Set<string>();
  for (const q of disambiguationQualifiers(profile)) pushUnique(qualifiers, seenQualifiers, q);
  for (const term of [name, ...aliases, ...handles]) pushUnique(qualifiers, seenQualifiers, term);

  return {
    public: {
      name,
      aliases,
      handles,
      partials,
      hosts: [...new Set(targets.map((t) => t.host))],
    },
    targets,
    qualifiers,
    knownTerms,
  };
}

/** The public vocabulary of a workspace (the `entity` block of `--json`). */
export function citeVocabulary(profile: Profile): CiteVocabulary {
  return buildVocabulary(profile).public;
}

/** A sentence's `[start, end)` bounds around one offset, in the original text. */
function sentenceBounds(text: string, index: number): { start: number; end: number } {
  const breaks = new Set([".", "!", "?", ";", "\n", "\u2026"]);
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (breaks.has(text[i] ?? "")) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i++) {
    if (breaks.has(text[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * The longer capitalised phrase the occurrence sits inside — the text's own
 * competing reading (`DA SEO` → `DA SEO Digital`). Expansion is by adjacent
 * tokens that start with an uppercase letter; it stops at punctuation, so
 * `Pasco, WA` does not expand.
 */
function capitalRun(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  const TOKEN_CHAR = /[\p{L}\p{N}'\u2019-]/u;
  const UPPER = /^\p{Lu}/u;
  let runStart = start;
  let runEnd = end;

  for (;;) {
    if (text[runEnd] !== " ") break;
    const first = runEnd + 1;
    if (!UPPER.test(text[first] ?? "")) break;
    let tokenEnd = first;
    while (tokenEnd < text.length && TOKEN_CHAR.test(text[tokenEnd] ?? "")) tokenEnd++;
    runEnd = tokenEnd;
  }

  for (;;) {
    if (runStart === 0 || text[runStart - 1] !== " ") break;
    const tokenEnd = runStart - 1;
    let tokenStart = tokenEnd;
    while (tokenStart > 0 && TOKEN_CHAR.test(text[tokenStart - 1] ?? "")) tokenStart--;
    // A capital that only opens a sentence ("Follow daseo") is not a longer
    // proper noun; expanding over it would manufacture a competitor.
    if (isSentenceInitial(text, tokenStart)) break;
    const token = text.slice(tokenStart, tokenEnd);
    if (token === "" || !UPPER.test(token)) break;
    runStart = tokenStart;
  }

  return runStart === start && runEnd === end ? undefined : { start: runStart, end: runEnd };
}

/** Is the token at `index` the first word of its sentence? */
function isSentenceInitial(text: string, index: number): boolean {
  const breaks = new Set([".", "!", "?", ";", "\n", "\u2026"]);
  let i = index - 1;
  while (i >= 0 && (text[i] === " " || text[i] === '""' || text[i] === "'")) i--;
  return i < 0 || breaks.has(text[i] ?? "");
}

/** One surviving (or guarded) text hit, before the public projection. */
interface TextHit {
  span: CiteSpan;
  kind: Exclude<CiteSpanKind, "citation-url">;
  term: string;
  reasons: string[];
  cited: boolean;
}

/**
 * Match one saved answer against the workspace's declared entity (SPEC §7.4).
 * Pure: the same profile + answer bytes always produce the same result.
 */
export function citeMatch(profile: Profile, answer: CiteAnswer): CiteMatch {
  const vocab = buildVocabulary(profile);
  const text = answer.answer;
  const folded = foldForMatch(text);
  const reasons: string[] = [];

  // 1. Citation rung: a saved citation on a declared host needs no text match —
  //    "cited without naming" is exactly this case.
  const citationSpans: CiteSpan[] = [];
  const seenUrls = new Set<string>();
  for (const citation of answer.citations ?? []) {
    const host = hostOf(citation.url);
    const path = pathOf(citation.url);
    if (host === undefined || path === undefined) continue;
    const declared = vocab.targets.find(
      (target) => sameSite(host, target.host) && pathMatches(path, target.path),
    );
    if (declared === undefined) continue;
    if (!seenUrls.has(citation.url)) {
      seenUrls.add(citation.url);
      citationSpans.push({ start: 0, end: 0, kind: "citation-url", url: citation.url });
    }
    reasons.push(
      "citation-url",
      declared.kind === "identity" ? "identity-domain" : "sameAs-domain",
    );
  }

  // 2. Text rungs: every word-bounded occurrence of every declared term.
  const raw: TextHit[] = [];
  const termLists: Record<Exclude<CiteSpanKind, "citation-url">, string[]> = {
    name: [vocab.public.name],
    alias: vocab.public.aliases,
    handle: vocab.public.handles,
    partial: vocab.public.partials,
  };
  for (const kind of RUNG_ORDER) {
    const list = termLists[kind as Exclude<CiteSpanKind, "citation-url">];
    for (const term of list) {
      for (const occurrence of findTerm(folded, term)) {
        raw.push({
          span: { start: occurrence.start, end: occurrence.end, kind },
          kind: kind as Exclude<CiteSpanKind, "citation-url">,
          term,
          reasons: [RUNG_REASON[kind]],
          cited: true,
        });
      }
    }
  }

  // 3. Containment: the longer declared term wins; the shorter keeps its reason
  //    but is not a second hit ("DA SEO" inside "DA SEO Digital").
  const ordered = [...raw].sort(
    (a, b) =>
      b.span.end - b.span.start - (a.span.end - a.span.start) ||
      RUNG_RANK[a.kind] - RUNG_RANK[b.kind] ||
      a.span.start - b.span.start ||
      a.span.end - b.span.end,
  );
  const kept: TextHit[] = [];
  for (const hit of ordered) {
    const container = kept.find(
      (k) =>
        k.span.start <= hit.span.start &&
        k.span.end >= hit.span.end &&
        (k.span.end - k.span.start > hit.span.end - hit.span.start ||
          (k.span.start === hit.span.start && k.span.end === hit.span.end)),
    );
    if (container !== undefined) {
      reasons.push(`longer-name:${container.term}`);
      continue;
    }
    kept.push(hit);
  }

  // 4. Guards — each one says why a hit is NOT a citation.
  for (const hit of kept) {
    const sentence = sentenceBounds(text, hit.span.start);
    const before = foldForMatch(text.slice(sentence.start, hit.span.start));
    const sentenceText = foldForMatch(text.slice(sentence.start, sentence.end));

    const contrast = CONTRAST_MARKERS.find((marker) =>
      termOccursIn(before, marker, 0, before.text.length),
    );
    if (contrast !== undefined) {
      hit.reasons.push("contrast-context");
      hit.cited = false;
    }

    const run = capitalRun(text, hit.span.start, hit.span.end);
    if (run !== undefined) {
      const phrase = text.slice(run.start, run.end);
      if (!vocab.knownTerms.has(normalizeText(phrase))) {
        hit.reasons.push(`competing:${phrase}`);
        hit.cited = false;
      }
    }

    const singleWord = !/\s/.test(hit.term.trim());
    if (singleWord && hit.kind !== "handle") {
      const qualified = vocab.qualifiers.some(
        (qualifier) =>
          normalizeText(qualifier) !== normalizeText(hit.term) &&
          termOccursIn(sentenceText, qualifier, 0, sentenceText.text.length),
      );
      if (!qualified) {
        hit.reasons.push(`ambiguous-term:${normalizeText(hit.term)}`, "no-qualifier");
        hit.cited = false;
      }
    }
  }

  // 5. Project: citations first, then text spans by position; reasons as a set
  //    in the fixed contract order.
  const textSpans = [...kept]
    .sort(
      (a, b) =>
        a.span.start - b.span.start || a.span.end - b.span.end || a.kind.localeCompare(b.kind),
    )
    .map((hit) => hit.span);

  for (const hit of kept) reasons.push(...hit.reasons);

  const citedHits = kept.filter((hit) => hit.cited);
  const cited = citationSpans.length > 0 || citedHits.length > 0;
  let confidence: CiteConfidence = "low";
  if (citationSpans.length > 0 || citedHits.some((hit) => hit.kind === "name")) confidence = "high";
  else if (citedHits.some((hit) => hit.kind === "alias" || hit.kind === "handle")) {
    confidence = "medium";
  }

  return {
    cited,
    confidence,
    spans: [...citationSpans, ...textSpans],
    reasons: orderReasons(reasons),
  };
}

/** De-duplicate and order the reason set as the contract declares. */
function orderReasons(reasons: string[]): string[] {
  const rank = (reason: string): number => {
    const index = REASON_ORDER.findIndex(
      (head) => reason === head || reason.startsWith(`${head}:`),
    );
    return index === -1 ? REASON_ORDER.length : index;
  };
  return [...new Set(reasons)].sort((a, b) => rank(a) - rank(b) || byteOrder(a, b));
}

/** Exported for tests: the declared host of a URL under the matcher's rule. */
export function citationHost(url: string): string | undefined {
  return hostOf(url);
}
