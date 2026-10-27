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

/** True when a text asserts a quantitative claim: a digit plus either a
 *  percent/dollar sign or a run of two or more digits. Deliberately conservative
 *  — prose years without a currency/percent marker are not treated as claims. */
export function isQuantitativeClaim(text: string): boolean {
  return /\d/.test(text) && /[%$]|\b\d{2,}\b/.test(text);
}
