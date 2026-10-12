/**
 * The default live-fetch driver for `pasco status --verify` (SPEC §19.5).
 *
 * Discipline the SPEC fixes, enforced here and nowhere else:
 *   - ONE request per surface per pass, sequential (the caller loops), no
 *     retries and no backoff: `--verify` is a verification, not a crawler, and
 *     the pass must never amplify into traffic a platform can read as abuse;
 *   - a non-2xx response is NOT an error — it is data (`unverifiable` with the
 *     honest reason), so this function resolves a status, it does not throw;
 *   - no cookies, no credentials, no browser automation, no Cloudflare games, no
 *     user-agent spoofing (a browser UA here would be a lie about the client).
 *
 * Tests never reach this module: the fetch is injected (§19.5 determinism).
 */

import type { FetchText } from "./verify.js";

/** The engine's own C1 read-back. Honest UA (`pasco-verify`), bounded by the
 *  caller's allowlist check BEFORE this ever runs. */
export const httpFetchText: FetchText = async (url) => {
  try {
    const response = await fetch(url, {
      // F7: following a redirect would let the FINAL hop leave the declared
      // allowlist the caller validated BEFORE this request — `raw.githubusercontent`
      // serving a redirect is also a signal something is off. A 3xx then lands in
      // the pass's honest `http-<code>` bucket like any other non-2xx.
      redirect: "error",
      headers: {
        "user-agent": "pasco-verify (+https://github.com/ChristianLuciani/profile-as-code)",
      },
    });
    // `text()` degrades to "" rather than throwing on a truncated body — a 2xx
    // with no readable artifact then yields the honest `unattributed` verdict.
    return { status: response.status, text: await response.text() };
  } catch {
    // Transport failure: no response existed. `0` is the caller's signal to
    // record `network-error` — never a thrown exception that breaks the report.
    return { status: 0 };
  }
};
