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

/** A number token: digits with inner thousands/decimal separators. Every
 *  quantifier is bounded — digits per group AND the number of groups — because
 *  the predicate runs over untrusted page text (`discover` fetches it) and an
 *  open-ended repetition is a hang, not a warning (#437 fresh passes, F1/F2).
 *  A trailing separator is deliberately NOT part of it: `76, post-stroke` is a
 *  bare age. */
const NUMBER = String.raw`\d{1,18}(?:[.,]\d{1,18}){0,5}`;

/** A currency sign or percent sign that is ADJACENT to the number (`$2M`,
 *  `40%`, `₹500`). A stray `$` elsewhere in the line does not make the line a
 *  claim (#437 fresh pass, F3). */
const CURRENCY_OR_PERCENT = new RegExp(
  String.raw`(?:[$€£¥₹￥₽]|％)\s?${NUMBER}|${NUMBER}\s?(?:%|％)`,
  "u",
);

/** A number with an explicit magnitude marker: `800+`, `1.5k`, `2M`, `3bn`. */
const PLUS_OR_MAGNITUDE = new RegExp(String.raw`${NUMBER}\s?(?:\+|(?:bn|tn|[kmb])(?!\p{L}))`, "iu");

/** A number followed by a word — with or without a space (`36 tutors`,
 *  `100ms`, `10GB`). Any script's letters count (#437 fresh pass, F4). The
 *  separator is captured so a single digit glued to letters (`5G`, `3D`, `2FA`)
 *  stays a technology name, not a count. */
const NUMBER_THEN_WORD = new RegExp(String.raw`(?<![\w.])(${NUMBER})(\s?)(\p{L}+)`, "gu");

/** A year is a DATE when a month name (optionally with a day) precedes it —
 *  `Aug 2024`, `August 25, 2024` — or when a date preposition does — `in 2024`,
 *  `since 2024`. Otherwise a four-digit token followed by a noun is a count:
 *  `2000 users` (#437 fresh passes, F1/F2/F3). */
const MONTH_OR_PREPOSITION_BEFORE =
  /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(?:\d{1,2},?\s*)?|(?:in|on|since|by|until|during|from)\s+)$/i;

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
    const separator = match[2] ?? "";
    // `5G networks`, `3D printing`, `2FA enabled`: a single digit glued to
    // letters names a technology, not a measurement.
    if (separator === "" && token.length === 1) continue;
    // `Aug 2024`, `in 2024 the hub`: a dated year is not a count.
    if (isCalendarYear(token)) {
      const before = text.slice(0, match.index);
      if (MONTH_OR_PREPOSITION_BEFORE.test(before)) continue;
    }
    return true;
  }
  return false;
}
