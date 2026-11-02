/**
 * "Does this text assert a quantitative claim?" — ONE predicate, ONE home.
 *
 * `pasco post check` already warned on a numeric line with no `{{fact:…}}` /
 * `evidence:` marker; `pasco audit` needs the same question for a project
 * description or an `faq[]` answer. Two inline copies of the regex would let
 * "quantitative" mean two things in two commands, which is exactly the drift the
 * engine exists to prevent — so the predicate lives here and both callers
 * delegate. The callers keep their own CONTEXT rules (post skips lines that
 * already carry a marker; the audit asks about a structured row), because those
 * are different questions about the same predicate.
 *
 * Direction (a) of #437: a claim is a number that CARRIES a quantity marker —
 * currency/percent, a trailing `+` or magnitude suffix, or a unit word right
 * after it. A bare run of digits is not a claim: prose years (`Aug 2024`) and
 * ages (`76`) are facts about the subject, and flagging them leaves the author
 * no honest fix — a private fact either loses its truth or gets an invented
 * source.
 */

/** A number token: digits with inner thousands/decimal separators. Bounded on
 *  both sides (`{1,15}`) so a long digit run cannot backtrack: the predicate
 *  runs over untrusted page text (`discover` fetches it), and a quadratic
 *  pattern there is a hang, not a warning (#437 fresh pass, F2). A trailing
 *  separator is deliberately NOT part of it — `76, post-stroke` is a bare age. */
const NUMBER = String.raw`\d{1,15}(?:[.,]\d{1,15})*`;

/** A currency sign or percent sign that is ADJACENT to the number (`$2M`,
 *  `40%`, `₹500`). A stray `$` elsewhere in the line does not make the line a
 *  claim (#437 fresh pass, F3). */
const CURRENCY_OR_PERCENT = new RegExp(
  String.raw`(?:[$€£¥₹￥₽]|％)\s?${NUMBER}|${NUMBER}\s?(?:%|％)`,
  "u",
);

/** A number with an explicit magnitude marker: `800+`, `1.5k`, `2M`, `3bn`. */
const PLUS_OR_MAGNITUDE = new RegExp(String.raw`${NUMBER}\s?(?:\+|(?:bn|tn|[kmb])(?!\p{L}))`, "iu");

/** A number followed by a unit word — with or without a space (`36 tutors`,
 *  `100ms`, `10GB`). Any script's letters count (#437 fresh pass, F4). */
const NUMBER_THEN_WORD = new RegExp(String.raw`(?<![\w.])(${NUMBER})\s?(\p{L}+)`, "gu");

/** Words that turn `2024 the hub` into a date rather than "2024 + unit". A year
 *  followed by a noun (`2000 users`) is still a count — that distinction is the
 *  whole point (#437 fresh pass, F1). */
const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "in",
  "is",
  "it",
  "its",
  "may",
  "might",
  "must",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "should",
  "that",
  "the",
  "their",
  "these",
  "they",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
]);

/** Month names: `Aug 2024 edition` is a date, not "2024 + unit". */
const MONTH_BEFORE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*$/i;

/** A four-digit calendar year (1900–2099). */
function isCalendarYear(token: string): boolean {
  if (!/^\d{4}$/.test(token)) return false;
  const year = Number(token);
  return year >= 1900 && year <= 2099;
}

/**
 * True when the text asserts a quantitative claim — a number that carries a
 * quantity marker: a currency or percent sign next to it (`$2M`, `40%`), a
 * trailing `+` or magnitude suffix (`800+`, `1.5k`), or a unit word right after
 * it (`36 tutors`, `195 jurisdictions`, `100ms`).
 *
 * Deliberately conservative: a false negative (a missed WARN) is the safe
 * direction, a false positive costs the author a source they may not have.
 */
export function isQuantitativeClaim(text: string): boolean {
  if (!/\d/.test(text)) return false;
  if (CURRENCY_OR_PERCENT.test(text)) return true;
  if (PLUS_OR_MAGNITUDE.test(text)) return true;
  for (const match of text.matchAll(NUMBER_THEN_WORD)) {
    const token = match[1] ?? "";
    const word = (match[2] ?? "").toLowerCase();
    // `in 2024 the hub`: the year is followed by a function word, so it is a
    // date, not a measurement.
    if (isCalendarYear(token) && FUNCTION_WORDS.has(word)) continue;
    // `Aug 2024 edition`: a year right after a month name is a date.
    const before = text.slice(0, match.index).slice(-24);
    if (isCalendarYear(token) && MONTH_BEFORE.test(before)) continue;
    return true;
  }
  return false;
}
