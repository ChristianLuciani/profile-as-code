/**
 * Exit codes (CLI contract, documented in packages/cli/README.md):
 *   0 — ok (schema valid; drift warnings are still 0, D12)
 *   1 — schema failure or operational failure (workspace/load/git errors), and a
 *       data finding that BLOCKS the command (`edit`: the address does not
 *       resolve to exactly one row, or the edit does not change the artifact)
 *   2 — usage error (unknown command, unknown platform/lang, bad flags)
 */
export const EXIT = {
  OK: 0,
  FAIL: 1,
  USAGE: 2,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
