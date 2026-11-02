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
 */

/** A number token: digits with inner thousands/decimal separators. A trailing
 *  separator is deliberately NOT part of it — `76, post-stroke` is a bare age,
 *  not a count with a unit. */
const NUMBER = String.raw`\d+(?:[.,]\d+)*`;

/** Currency or percent: their presence makes ANY digit a claim (`$2M`, `40%`). */
const CURRENCY_OR_PERCENT = /[$€£¥%]/;

/** A number with an explicit magnitude marker: `800+`, `1.5k`, `2M`, `3bn`. */
const PLUS_OR_MAGNITUDE = new RegExp(String.raw`${NUMBER}\s*(?:\+|(?:bn|tn|[kmb])\b)`, "i");

/** A number directly followed by a word — a unit (`36 tutors`, `12 years`). */
const NUMBER_THEN_WORD = new RegExp(String.raw`(?<![\w.])(${NUMBER})\s+[A-Za-z]`, "g");

/** A four-digit calendar year (1900–2099) is a DATE, not a count: `in 2024 the
 *  hub` must not read as "2024" + unit. A year with an explicit marker
 *  (`$2024`, `2024%`) is still caught by the marker rules above. */
function isCalendarYear(token: string): boolean {
  if (!/^\d{4}$/.test(token)) return false;
  const year = Number(token);
  return year >= 1900 && year <= 2099;
}

/**
 * True when the text asserts a quantitative claim — a number that carries a
 * quantity marker: a currency or percent sign (`$2M`, `40%`), a trailing `+` or
 * magnitude suffix (`800+`, `1.5k`), or a unit word right after the number
 * (`36 tutors`, `195 jurisdictions`).
 *
 * A bare run of digits is NOT a claim on its own: prose years (`Aug 2024`) and
 * ages (`76`) are facts about the subject, not measurements, and flagging them
 * gives the author no honest fix — a private fact either loses its truth or
 * gets an invented source (#437). A standalone four-digit calendar year stays a
 * date even when a word follows it.
 *
 * Deliberately conservative: a false negative (a missed WARN) is the safe
 * direction, a false positive costs the author a source they may not have.
 */
export function isQuantitativeClaim(text: string): boolean {
  if (!/\d/.test(text)) return false;
  if (CURRENCY_OR_PERCENT.test(text)) return true;
  if (PLUS_OR_MAGNITUDE.test(text)) return true;
  for (const match of text.matchAll(NUMBER_THEN_WORD)) {
    if (!isCalendarYear(match[1] ?? "")) return true;
  }
  return false;
}
