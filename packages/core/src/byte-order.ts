/**
 * byte-order.ts — the ONE home of every text-order comparison in the engine
 * (D19 byte-parity, issue #305).
 *
 * The comparator is UTF-16 code UNITS — JS native `a < b` string order:
 * deterministic on every environment, ICU-free. It is NOT codepoint order on
 * the astral edge, and SPEC §15.3 names that choice exactly. A `localeCompare`
 * call-site would depend on the ICU build and can tie (`0`), leaking
 * environment-specific order through a stable sort — the class #257 fixed for
 * the featured slice and #305 closes workspace-wide.
 *
 * The discriminating probe (`apple` vs `APPLE`: ICU collation reads lowercase
 * first, code units read uppercase first) lives at
 * packages/core/tests/byte-order.test.ts.
 */
export function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
