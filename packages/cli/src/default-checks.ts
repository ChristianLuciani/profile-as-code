/**
 * The conservative, sourced cap catalog (#240).
 *
 * One home: `pasco init` writes `DEFAULT_CHECKS_YAML`; `pasco check` falls back
 * to the parsed `DEFAULT_CHECKS` when a workspace has no `content/checks.yaml`
 * (the dogfood workspace predates the catalog). Each note carries its source,
 * full date and provenance tier; `[?]` means curated/third-party, not the
 * platform's own documented limit.
 */

import type { LoadedProfile } from "@profile-as-code/core";
import { parse } from "yaml";

export const DEFAULT_CHECKS_YAML = `# checks.yaml — conservative offline char caps (#240).
# Every row carries its source, date and provenance tier in note; [?] means the
# number is curated/third-party, not the platform's own documented limit.
# The rule engine is offline: pasco check warns, it never fails (D12).
- id: github-readme-headline-max
  platform: github-readme
  rule: max-chars
  value: 280
  surface: headline
  note: "[?] editorial soft cap (skills/github-readme, SOTA-2026 §1, fetched 2026-10-05) — the README one-liner is read in ~30s."
- id: kofi-bio-max
  platform: kofi
  rule: max-chars
  value: 500
  surface: bio
  note: "[?] curated soft cap; Ko-fi documents no About limit (skills/kofi, SOTA-2026 §1, fetched 2026-10-05)."
- id: hotmart-bio-max
  platform: hotmart
  rule: max-chars
  value: 500
  surface: bio
  note: "[?] curated soft cap; Hotmart documents no profile-body limit (skills/hotmart, SOTA-2026 §6, fetched 2026-10-05)."
- id: upwork-title-max
  platform: upwork
  rule: max-chars
  value: 50
  surface: headline
  note: "[?] third-party guidance (snipework, 2026-03-08, https://snipework.com/blog/upwork-character-limits-2026) — confirm against Upwork's own docs before relying."
`;

export const DEFAULT_CHECKS = parse(DEFAULT_CHECKS_YAML) as LoadedProfile["checks"];
