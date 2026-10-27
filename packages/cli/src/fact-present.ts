/**
 * `fact-present` — the surface's facts must be the SSOT's facts (SPEC §7, #283).
 *
 * The rule the ledger recorded as missing (`PROP-017 §Risks F2`): without it the
 * consistency class of `pasco audit` cannot fail and the differentiator is a style
 * guide. It is offline and deterministic — no network, no clock, no AI.
 *
 * WHAT it compares: the artifact `pasco build` last wrote against the render the
 * SSOT produces TODAY, through `createArtifactResolver` — the same resolver §20.1's
 * artifact axis uses, so there is one render path, not two. The comparison is
 * **symmetric** (a fact the surface adds and a fact it omits are both findings) and
 * it ends with the same question §20.1 asks at file granularity: when the two
 * projected texts differ beyond the fact tokens, that is a finding too. Without the
 * symmetric leg, `pasco status` could report `diverges` while `pasco audit` read
 * clean over the same bytes — two commands disagreeing about one artifact.
 *
 * FACT TOKENS and their classes (SPEC §7.1):
 *   URL     in the surface, not in the render  → `dangling-ref`  (does not resolve)
 *           in the render, not in the surface  → `contradiction` (surface omits it)
 *   DATE    either direction                    → `contradiction`
 *   NUMBER  either direction                    → `contradiction`
 *   TEXT    differs with no token to attribute  → `contradiction`
 *
 * `unsourced-claim` is NOT produced here: "a claim with no evidence" is a question
 * about `evidence[]`/`source`, not about a numeric token. A surface that asserts a
 * different number asserts an incompatible fact — a contradiction.
 *
 * In `pasco check` every finding is WARN: facts warn, schema fails (D12). The class
 * is carried for the consumer that grades it (the audit), never graded here.
 *
 * Declared v1 limits (stated, never silently absent):
 *   - the scope is the surfaces the profile TARGETS (bios · headlines · active ·
 *     keywords.seo · socialHandles) **that also DECLARE the premise** in their
 *     catalog (workspace `content/checks.yaml` ∪ the shipped
 *     `skills/<platform>/checks.yaml`) — the rule never runs a premise nobody
 *     declared (#283/F6). A declared surface with no artifact is reported in
 *     `notRun`; a declared set that is empty is itself reported (`declared: []`),
 *     so "measured nothing" is never indistinguishable from "found nothing";
 *   - the engine-owned region only, via `projectArtifact` (§19.5) — chrome a user
 *     adds around it is outside the artifact and is not judged;
 *   - the artifact is compared at every contract lang (§11) and the render with the
 *     fewest findings wins, so a legitimately built `es`/`fr` artifact is not
 *     reported as drifted;
 *   - VIEW-BLIND: the render is the implicit per-platform view. An artifact written
 *     by `pasco build --view <name>` is legitimately different and is reported
 *     against the implicit view — the same declared consequence §20.1's artifact
 *     axis carries, because neither command may guess which view produced the bytes;
 *   - the ledger is not a fact source: no finding derives from
 *     `content/deployments.yaml` (it is still loaded as part of the workspace).
 */

import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { projectArtifact } from "@profile-as-code/artifact";
import type { Lang, LoadedProfile, Platform } from "@profile-as-code/core";
import { PLATFORMS } from "@profile-as-code/core";
import {
  artifactPath,
  candidateLangs,
  createArtifactResolver,
  factIdentity,
} from "./publication.js";
import { type CatalogState, catalogState, declaredSurfaces } from "./skill-checks.js";
import { defaultsLang, type Pascorc } from "./workspace.js";

/** The audit's fixed failure classes (SPEC §7.1) — owned by the contract, not by
 *  this rule: `fact-present` only says which class a token difference belongs to. */
export type FactFindingClass = "dangling-ref" | "contradiction" | "unsourced-claim";

/** Stable machine-readable codes (one per difference kind and direction). */
export type FactPresentCode =
  | "fact-present/url-not-in-ssot"
  | "fact-present/url-missing-from-surface"
  | "fact-present/date-not-in-ssot"
  | "fact-present/date-missing-from-surface"
  | "fact-present/number-not-in-ssot"
  | "fact-present/number-missing-from-surface"
  | "fact-present/text-not-in-ssot";

export interface FactPresentFinding {
  code: FactPresentCode;
  /** Always `warn` (D12): the audit re-grades by class; `check` never fails on a fact. */
  severity: "warn";
  class: FactFindingClass;
  /** Workspace-relative path of the artifact the finding is about. */
  path: string;
  message: string;
}

export interface FactPresentReport {
  /** Whether this package ships a skills tree at all (#253): `not-shipped` means the
   *  catalog cannot declare anything — a bundle state, never "the premise is absent". */
  catalog: CatalogState;
  /** Surfaces whose catalog declares the `fact-present` premise (workspace rows ∪
   *  the shipped skill catalog). Empty = the premise is not declared anywhere, so
   *  the rule had nothing to run on BY CONTRACT — the distinction the payload must
   *  carry, so "not declared" is never read as "clean". */
  declared: string[];
  /** Declared surfaces actually compared (an artifact existed and the workspace
   *  renders it). */
  checked: string[];
  /** Declared surfaces the rule could not run on — no artifact on disk, or no
   *  renderer for this workspace flavor. Never folded into "OK". */
  notRun: string[];
  findings: FactPresentFinding[];
}

/**
 * The surfaces the profile TARGETS: the platform rows the user curates a surface
 * for. `pasco build` writes an artifact for exactly these (a platform with no row
 * has nothing to build), so deriving scope from them — instead of from the files
 * that already exist — is what makes "not built yet" expressible.
 */
export function targetedSurfaces(profile: LoadedProfile): string[] {
  const surfaces = new Set<string>();
  for (const bio of profile.bios ?? []) surfaces.add(bio.platform);
  for (const headline of profile.headlines ?? []) surfaces.add(headline.platform);
  for (const key of Object.keys(profile.active ?? {})) surfaces.add(key);
  for (const key of Object.keys(profile.keywords?.seo ?? {})) surfaces.add(key);
  for (const handle of profile.socialHandles ?? []) surfaces.add(handle.platform);
  return [...surfaces]
    .filter((surface) => (PLATFORMS as readonly string[]).includes(surface))
    .sort();
}

/**
 * Token scan — ONE pass so a URL's digits are never re-read as a number and a date
 * is never re-read as three numbers. Alternation order is the classification.
 */
const TOKEN = /(https?:\/\/[^\s)<>"'`\]]+)|(\b\d{4}-\d{2}-\d{2}\b)|(\b\d[\d,]*(?:\.\d+)?\b)/g;

/** Trailing prose punctuation is not part of a URL token. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

interface FactTokens {
  urls: Set<string>;
  dates: Set<string>;
  numbers: Set<string>;
}

function tokensOf(text: string): FactTokens {
  const urls = new Set<string>();
  const dates = new Set<string>();
  const numbers = new Set<string>();
  for (const match of factIdentity(text).matchAll(TOKEN)) {
    const url = match[1];
    const date = match[2];
    const number = match[3];
    if (url !== undefined) {
      urls.add(url.replace(TRAILING_PUNCTUATION, "").replace(/\/+$/, ""));
    } else if (date !== undefined) {
      dates.add(date);
    } else if (number !== undefined) {
      numbers.add(number);
    }
  }
  return { urls, dates, numbers };
}

function relativePath(workspace: string, surface: string): string {
  return relative(workspace, artifactPath(workspace, surface)).split("\\").join("/");
}

function urlFinding(
  code: "fact-present/url-not-in-ssot" | "fact-present/url-missing-from-surface",
  path: string,
  message: string,
): FactPresentFinding {
  return {
    code,
    severity: "warn",
    class: code === "fact-present/url-not-in-ssot" ? "dangling-ref" : "contradiction",
    path,
    message,
  };
}

function factFinding(
  code: Exclude<
    FactPresentCode,
    "fact-present/url-not-in-ssot" | "fact-present/url-missing-from-surface"
  >,
  path: string,
  message: string,
): FactPresentFinding {
  return { code, severity: "warn", class: "contradiction", path, message };
}

/** Every fact difference between the surface and one render — both directions. */
function compareTokens(
  built: FactTokens,
  expected: FactTokens,
  path: string,
  surface: string,
): FactPresentFinding[] {
  const findings: FactPresentFinding[] = [];

  for (const url of built.urls) {
    if (expected.urls.has(url)) continue;
    findings.push(
      urlFinding(
        "fact-present/url-not-in-ssot",
        path,
        `${surface}: the surface links to ${url}, which the SSOT render does not carry — a pointer that does not resolve in the current view`,
      ),
    );
  }
  for (const url of expected.urls) {
    if (built.urls.has(url)) continue;
    findings.push(
      urlFinding(
        "fact-present/url-missing-from-surface",
        path,
        `${surface}: the surface omits ${url}, which the SSOT render carries — the surface's facts disagree with the SSOT`,
      ),
    );
  }

  for (const date of built.dates) {
    if (expected.dates.has(date)) continue;
    findings.push(
      factFinding(
        "fact-present/date-not-in-ssot",
        path,
        `${surface}: the surface asserts ${date}, which the SSOT render does not carry — two surfaces disagree on one fact`,
      ),
    );
  }
  for (const date of expected.dates) {
    if (built.dates.has(date)) continue;
    findings.push(
      factFinding(
        "fact-present/date-missing-from-surface",
        path,
        `${surface}: the surface omits ${date}, which the SSOT render carries — the surface's facts disagree with the SSOT`,
      ),
    );
  }

  // A date's digits are already reported above: skip a number that is the year of
  // a date on EITHER side, so one stale date is one finding per direction, not three.
  const dateYears = new Set([...built.dates, ...expected.dates].map((date) => date.slice(0, 4)));
  for (const number of built.numbers) {
    if (expected.numbers.has(number) || dateYears.has(number)) continue;
    findings.push(
      factFinding(
        "fact-present/number-not-in-ssot",
        path,
        `${surface}: the surface asserts the number ${number}, which the SSOT render does not carry — the surfaces disagree on a quantitative fact`,
      ),
    );
  }
  for (const number of expected.numbers) {
    if (built.numbers.has(number) || dateYears.has(number)) continue;
    findings.push(
      factFinding(
        "fact-present/number-missing-from-surface",
        path,
        `${surface}: the surface omits the number ${number}, which the SSOT render carries — the surfaces disagree on a quantitative fact`,
      ),
    );
  }

  return findings;
}

/** The whole-file question §20.1 asks, at this rule's granularity: the projected
 *  texts differ beyond every token above, so the difference is prose the fact scan
 *  cannot attribute — still the surface disagreeing with the SSOT. */
function textFinding(path: string, surface: string): FactPresentFinding {
  return factFinding(
    "fact-present/text-not-in-ssot",
    path,
    `${surface}: the surface differs from the SSOT render in text no fact token explains — the artifact is stale or hand-edited (run pasco build)`,
  );
}

/**
 * Run `fact-present` for one platform (or every surface the profile targets).
 * Pure over the workspace bytes: no write, no network, no clock.
 */
export function factPresentFindings(args: {
  workspace: string;
  profile: LoadedProfile;
  platform?: Platform;
  pascorc: Pascorc;
  /** The workspace's schema-validated check rows — the user half of the catalog. */
  checks: LoadedProfile["checks"];
}): FactPresentReport {
  const resolver = createArtifactResolver({
    workspace: args.workspace,
    profile: args.profile,
    ...(args.pascorc.completeness === undefined
      ? {}
      : { completenessPolicy: args.pascorc.completeness }),
    ...(args.pascorc.selection === undefined ? {} : { selectionPolicy: args.pascorc.selection }),
  });
  const langs = candidateLangs(defaultsLang(args.pascorc) as Lang);
  const candidates: string[] =
    args.platform !== undefined ? [args.platform] : targetedSurfaces(args.profile);
  // The catalog decides WHICH surfaces this premise runs on (#283/F6): a surface
  // that never declared `fact-present` is not measured, and neither is one the
  // user's `content/checks.yaml` does not name when the skill ships no catalog.
  const declared = declaredSurfaces("fact-present", candidates, args.checks);

  const checked: string[] = [];
  const notRun: string[] = [];
  const findings: FactPresentFinding[] = [];

  for (const surface of declared) {
    const artifact = artifactPath(args.workspace, surface);
    const built = existsSync(artifact) ? readFileSync(artifact, "utf8") : undefined;
    // A surface with no artifact — or one this workspace/flavor would never render
    // (`github-org` on a person) — did not run. Absence is not a pass.
    const renders = langs
      .map((lang) => resolver.render(surface, lang))
      .filter((text): text is string => text !== undefined);
    if (built === undefined || renders.length === 0) {
      notRun.push(surface);
      continue;
    }
    checked.push(surface);
    const path = relativePath(args.workspace, surface);
    const builtText = projectArtifact(built, surface);
    const builtTokens = tokensOf(builtText);
    const builtIdentity = factIdentity(builtText);

    // Every declared lang is a legitimate build target (§11): grade the artifact
    // against the render that disagrees with it least, not against an assumed one.
    let best: FactPresentFinding[] | undefined;
    let matched = false;
    for (const render of renders) {
      const renderText = projectArtifact(render, surface);
      const candidate = compareTokens(builtTokens, tokensOf(renderText), path, surface);
      const identical = builtIdentity === factIdentity(renderText);
      if (candidate.length === 0 && identical) {
        matched = true;
        best = [];
        break;
      }
      // A text difference with no token to name is ONE finding, counted like one so
      // the per-lang comparison stays fair.
      const graded = candidate.length > 0 ? candidate : [textFinding(path, surface)];
      if (best === undefined || graded.length < best.length) best = graded;
    }
    if (!matched) findings.push(...(best ?? [textFinding(path, surface)]));
  }

  return { catalog: catalogState(), declared, checked, notRun, findings };
}
