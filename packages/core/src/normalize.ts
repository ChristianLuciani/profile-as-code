/**
 * normalize.ts — the case- and accent-folding for the citation matcher
 * (SPEC §7.4, issue #291).
 *
 * One reader today: `cite-check` needs an accent-insensitive, word-bounded
 * matcher over text the workspace does not control. `geoCheck` keeps its bare
 * `toLowerCase()` comparisons **by decision** — its published score is a
 * separate contract (§8), and an accent-insensitive GEO check would be its own
 * SPEC change. The two sides may disagree about a folded name; that is
 * declared, not hidden, and the regression test pins the pre-PR reading.
 *
 * The fold is deliberately DUMB and deterministic (D19): NFKD, combining marks
 * dropped, lowercased, a few typographic characters mapped to ASCII. No locale,
 * no `Intl`, no network. It is lossy on purpose; `FoldedText` keeps the map back
 * to the ORIGINAL UTF-16 offsets so a caller can report a real span
 * (`cite-check`'s `spans[]`) instead of an offset into the folded copy.
 */

/** The folded string plus, per folded UTF-16 code unit, its original span. */
export interface FoldedText {
  /** The folded text every match runs over. */
  text: string;
  /** `starts[i]` — original offset where folded unit `i` begins. */
  starts: number[];
  /** `ends[i]` — original offset just past the source code point of `i`. */
  ends: number[];
}

/** Typographic characters with one deterministic ASCII reading (1:1, offset-safe). */
const SINGLE_CHAR_FOLD: Readonly<Record<string, string>> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u00A0": " ",
  "\u202F": " ",
  "\u3000": " ",
};

const COMBINING_MARK = /\p{M}/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Fold one code point: map the typographic variants, decompose (NFKD), drop the
 * combining marks, lowercase. A code point may fold to zero units (`\u0301`), one
 * (`é` → `e`) or several (`ﬁ` → `fi`) — the caller maps every emitted unit back
 * to the same source code point.
 */
function foldCodePoint(cp: string): string {
  const mapped = SINGLE_CHAR_FOLD[cp] ?? cp;
  let out = "";
  for (const ch of mapped.normalize("NFKD")) {
    if (COMBINING_MARK.test(ch)) continue;
    out += ch.toLowerCase();
  }
  return out;
}

/**
 * Fold `value` and keep the map back to the original offsets.
 *
 * Iteration is by CODE POINT (surrogate pairs stay one unit) and the map is per
 * emitted UTF-16 unit, so `starts`/`ends` are valid offsets into `value` even when
 * a fold expands one code point into two.
 */
export function foldForMatch(value: string): FoldedText {
  const starts: number[] = [];
  const ends: number[] = [];
  let text = "";
  let i = 0;
  while (i < value.length) {
    const cp = value.codePointAt(i);
    if (cp === undefined) break;
    const width = cp > 0xffff ? 2 : 1;
    for (const unit of foldCodePoint(String.fromCodePoint(cp))) {
      text += unit;
      starts.push(i);
      ends.push(i + width);
    }
    i += width;
  }
  return { text, starts, ends };
}

/** The folded text alone — the form every comparison uses. */
export function normalizeText(value: string): string {
  return foldForMatch(value).text;
}

function isWordChar(folded: string, index: number): boolean {
  const ch = folded[index];
  return ch !== undefined && WORD_CHAR.test(ch);
}

/** Word-bounded in FOLDED text: `pasco` does not match inside `pascoño`. */
export function isWordBounded(folded: string, start: number, end: number): boolean {
  return !isWordChar(folded, start - 1) && !isWordChar(folded, end);
}

/** One occurrence of a term, in ORIGINAL offsets. */
export interface TermOccurrence {
  start: number;
  end: number;
}

/**
 * Every word-bounded occurrence of `term` in `folded`, as original offsets.
 *
 * The term is folded with the same function, so a caller never pre-normalizes
 * (and never double-folds). Overlapping occurrences are all returned; the
 * caller decides what containment means for its contract.
 */
export function findTerm(folded: FoldedText, term: string): TermOccurrence[] {
  const needle = normalizeText(term);
  if (needle === "") return [];
  const out: TermOccurrence[] = [];
  let from = 0;
  for (;;) {
    const at = folded.text.indexOf(needle, from);
    if (at === -1) break;
    const end = at + needle.length;
    if (isWordBounded(folded.text, at, end)) {
      out.push({ start: folded.starts[at] ?? 0, end: folded.ends[end - 1] ?? 0 });
    }
    from = at + 1;
  }
  return out;
}

/**
 * Does `term` occur word-bounded inside the folded range `[from, to)`?
 * Used for sentence-scoped readings (does this sentence carry a qualifier?).
 */
export function termOccursIn(folded: FoldedText, term: string, from: number, to: number): boolean {
  const needle = normalizeText(term);
  if (needle === "") return false;
  const haystack = folded.text.slice(from, to);
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    const end = at + needle.length;
    if (isWordBounded(haystack, at, end)) return true;
    at = haystack.indexOf(needle, at + 1);
  }
  return false;
}
