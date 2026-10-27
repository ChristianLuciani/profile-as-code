/**
 * `fact-present` — the surface's facts must be the SSOT's facts (SPEC §7, #283).
 *
 * The rule the ledger recorded as missing (`PROP-017 §Risks F2`): without it the
 * consistency class of `pasco audit` cannot fail and the differentiator is a style
 * guide. It is offline and deterministic — no network, no clock, no AI.
 *
 * WHAT it compares: the FACT TOKENS of the artifact `pasco build` last wrote
 * against the fact tokens of the render the SSOT produces TODAY. Both sides come
 * from `createArtifactResolver` — the same resolver §20.1's artifact axis uses, so
 * there is one render path, not two. `factIdentity` drops the one generated token
 * whose input is the ledger (the completeness percentage): it is a view of
 * coverage, not a fact, and a `--mark` must not read as a contradiction.
 *
 * THREE token kinds, one audit class each (SPEC §7.1):
 *   URL     a pointer in the surface that the render does not carry
 *           → `dangling-ref` (FAIL in `pasco audit`) — it does not resolve.
 *   DATE    an ISO date the render does not carry
 *           → `contradiction` (FAIL) — the surface asserts a datum the SSOT does not.
 *   NUMBER  any other numeric token the render does not carry
 *           → `unsourced-claim` (WARN) — a quantitative claim with no evidence.
 *
 * In `pasco check` all three are WARN: facts warn, schema fails (D12). The class
 * is carried for the consumer that grades it (the audit), never graded here.
 *
 * Declared v1 limits (stated, never silently absent):
 *   - only a surface with a built artifact is examined; no artifact = the rule did
 *     NOT run (reported as `notRun`), never a silent OK;
 *   - the engine-owned region only, via `projectArtifact` (§19.5) — chrome a user
 *     adds around it is outside the artifact and is not judged;
 *   - the artifact is compared at every contract lang (§11) and the render with the
 *     fewest findings wins, so a legitimately built `es`/`fr` artifact is not
 *     reported as drifted;
 *   - the ledger is not a fact source: no finding derives from `content/deployments.yaml`
 *     (it is still loaded as part of the workspace).
 */

import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { projectArtifact } from "@profile-as-code/artifact";
import type { Lang, LoadedProfile, Platform } from "@profile-as-code/core";
import {
  artifactPath,
  candidateLangs,
  createArtifactResolver,
  factIdentity,
  publishedSurfaces,
} from "./publication.js";
import { defaultsLang, type Pascorc } from "./workspace.js";

/** The audit's fixed failure classes (SPEC §7.1) — owned by the contract, not by
 *  this rule: `fact-present` only says which class a token difference belongs to. */
export type FactFindingClass = "dangling-ref" | "contradiction" | "unsourced-claim";

/** Stable machine-readable codes (one per token kind). */
export type FactPresentCode =
  | "fact-present/url-not-in-ssot"
  | "fact-present/date-not-in-ssot"
  | "fact-present/unsourced-claim";

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
  /** Surfaces actually compared (an artifact existed and the workspace renders it). */
  checked: string[];
  /** In-scope surfaces the rule could not run on — no artifact on disk, or no
   *  renderer for this workspace flavor. Never folded into "OK". */
  notRun: string[];
  findings: FactPresentFinding[];
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

/** Every token in `built` that `expected` does not carry, one finding per token. */
function compareTokens(
  built: FactTokens,
  expected: FactTokens,
  path: string,
  surface: string,
): FactPresentFinding[] {
  const findings: FactPresentFinding[] = [];
  for (const url of built.urls) {
    if (expected.urls.has(url)) continue;
    findings.push({
      code: "fact-present/url-not-in-ssot",
      severity: "warn",
      class: "dangling-ref",
      path,
      message: `${surface}: the surface links to ${url}, which the SSOT render does not carry — a pointer that does not resolve in the current view`,
    });
  }
  for (const date of built.dates) {
    if (expected.dates.has(date)) continue;
    findings.push({
      code: "fact-present/date-not-in-ssot",
      severity: "warn",
      class: "contradiction",
      path,
      message: `${surface}: the surface asserts ${date}, which the SSOT render does not carry — two surfaces disagree on one fact`,
    });
  }
  // A date's digits are already reported above: skip a number that is the year of
  // a reported date, so one stale date is one finding, not two.
  const reportedYears = new Set([...built.dates].map((date) => date.slice(0, 4)));
  for (const number of built.numbers) {
    if (expected.numbers.has(number)) continue;
    if (reportedYears.has(number)) continue;
    findings.push({
      code: "fact-present/unsourced-claim",
      severity: "warn",
      class: "unsourced-claim",
      path,
      message: `${surface}: the surface asserts the number ${number}, which no SSOT render carries — a quantitative claim with no evidence behind it`,
    });
  }
  return findings;
}

/**
 * Run `fact-present` for one platform (or every surface with a built artifact).
 * Pure over the workspace bytes: no write, no network, no clock.
 */
export function factPresentFindings(args: {
  workspace: string;
  profile: LoadedProfile;
  platform?: Platform;
  pascorc: Pascorc;
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
  const scope: string[] =
    args.platform !== undefined ? [args.platform] : publishedSurfaces(args.workspace);

  const checked: string[] = [];
  const notRun: string[] = [];
  const findings: FactPresentFinding[] = [];

  for (const surface of scope) {
    const built = existsSync(artifactPath(args.workspace, surface))
      ? readFileSync(artifactPath(args.workspace, surface), "utf8")
      : undefined;
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
    const builtTokens = tokensOf(projectArtifact(built, surface));
    const path = relativePath(args.workspace, surface);
    // Every declared lang is a legitimate build target (§11): grade the artifact
    // against the render that disagrees with it least, not against an assumed one.
    let best: FactPresentFinding[] | undefined;
    for (const render of renders) {
      const candidate = compareTokens(
        builtTokens,
        tokensOf(projectArtifact(render, surface)),
        path,
        surface,
      );
      if (best === undefined || candidate.length < best.length) best = candidate;
      if (best.length === 0) break;
    }
    findings.push(...(best ?? []));
  }

  return { checked, notRun, findings };
}

/** True when a text asserts a quantitative claim — the same conservative predicate
 *  `pasco post check` uses (a digit plus a percent/dollar sign or a 2+ digit run).
 *  One predicate, so "quantitative" cannot mean two things in two commands. */
export function isQuantitativeClaim(text: string): boolean {
  return /\d/.test(text) && /[%$]|\b\d{2,}\b/.test(text);
}
