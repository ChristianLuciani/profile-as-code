/**
 * The derived PUBLICATION-TRUTH line (#242) — one home for "is the thing we call
 * optimized actually the thing a user publishes?".
 *
 * The dogfood of 2026-10-19 found three green gates over a profile that was not
 * verified in the terms a user cares about: a green score over an unpublished
 * artifact, a green `check` over a field the platform truncates, and a declared
 * but ignored variant. Two artifacts existed in one contract with no invariant
 * tying them. This module IS that invariant, and it is **derived**: nothing it
 * reads is written back (SPEC §20 — never store the number; it would drift).
 *
 * Three orthogonal axes per surface, each with one owner:
 *
 *   sync      the ledger (§19) — `in-sync` | `stale` | `never`, never re-derived
 *             from the artifact (the two dimensions must not borrow evidence).
 *   artifact  the bytes on disk vs the SSOT's CURRENT render — `matches-SSOT` |
 *             `diverges` | `absent`. Offline: the comparison is `build`'s own
 *             output resolution (variant body → renderer/paste source). A §19.5
 *             `out-of-band-drift` record on the surface is contrary evidence and
 *             forces `diverges` — the one live fact this offline report may cite.
 *   limits    the offline MAX cap (#240, `limits.ts`) — `ok` | `over(cap)`. The
 *             token is literal: `min-chars` is a floor, so it stays `pasco
 *             check`'s finding. A cap whose declared value is not a number is a
 *             CATALOG warning carried in `findings` — `ok` about the text, never
 *             silent about the cap. The media bundle under `assets/` is out of
 *             scope (`pasco check`'s M8 surface); declared in SPEC §20.1.
 *
 * Deliberate v1 limits, declared rather than silently absent:
 *   - the artifact axis compares against a render at every lang the CONTRACT
 *     allows (§11: en/es/fr), workspace lang first. `pasco build --lang` can only
 *     produce one of those, so an artifact built for another lang still matches;
 *   - a build made with `--view <name>` reads `diverges` against the implicit
 *     per-platform view, for the same reason — the artifact is still compared to
 *     a render, never assumed equal;
 *   - the comparison ignores the ONE generated token whose input is the ledger
 *     itself — `Profile completeness: …` (SPEC §20: a derived view, never truth).
 *     Without that, recording a confirmation would change the number the artifact
 *     embeds and every confirmed surface would read `diverges` forever, which is
 *     noise about a label, not drift of a fact. Declared consequence: a stale
 *     displayed percentage alone is NOT reported as divergence;
 *   - LIVE drift is §19.5's `out-of-band-drift`, surfaced by `--verify`; this
 *     module never fetches (§19.5/D20: `status` stays offline).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Lang,
  LedgerReport,
  LoadedProfile,
  MediaAsset,
  Platform,
  SelectionPolicy,
} from "@profile-as-code/core";
import { collectMedia, compile, LANGS, PLATFORMS } from "@profile-as-code/core";
import { pasteSource } from "@profile-as-code/paste";
import { RENDERERS } from "./generated/renderers.gen.js";
import { type LimitFinding, limitFindings } from "./limits.js";
import { resolveVariantBody } from "./variant-store.js";
import {
  type CompletenessPolicyConfig,
  type SelectionPolicyConfig,
  sanitizeCompletenessPolicy,
  sanitizeSelectionPolicy,
} from "./workspace.js";

/** The ledger axis (§19), with `never` for "no record on this surface". */
export type SyncTruth = "in-sync" | "stale" | "never";

/** Does the artifact on disk match what the SSOT produces TODAY? */
export type ArtifactTruth = "matches-SSOT" | "diverges" | "absent";

/** Is any text on this surface over a declared maximum? (`limits.ts`, #240) */
export type LimitTruth = "ok" | "over(cap)";

/** Which comparison produced a non-matching `artifact`, so one token never
 *  conflates "my local bytes differ" with "the live page differs" (§19.5). */
export type ArtifactReason = "local-mismatch" | "live-drift" | "no-artifact";

/** One derived line. Never persisted; printed by `status` and folded into
 *  `--completeness` as COVERAGE (never as a new score). */
export interface PublicationTruth {
  surface: string;
  sync: SyncTruth;
  artifact: ArtifactTruth;
  /** Present iff `artifact !== "matches-SSOT"`. */
  artifactReason?: ArtifactReason;
  limits: LimitTruth;
  /** The rollup behind `sync`: how many units are recorded on this surface, and
   *  how many of those are stale. A consumer reads coverage instead of inferring
   *  it; `sync` alone cannot say how many units were never confirmed. */
  units: { recorded: number; stale: number };
  /** The `max-chars` rows plus any un-evaluable catalog row — empty when clean. */
  findings: LimitFinding[];
}

/**
 * The artifact path `pasco build` writes for a surface (SPEC §15.5 + #239): a
 * renderer platform owns `profiles/<surface>/README.md`; a manual-paste surface
 * writes the one-row `profiles/<surface>.md`. ONE home — `build.ts`,
 * `artifactAnchor` and this module must agree on the path or the comparison is
 * meaningless.
 */
export function artifactPath(workspace: string, surface: string): string {
  return RENDERERS[surface] === undefined
    ? join(workspace, "profiles", `${surface}.md`)
    : join(workspace, "profiles", surface, "README.md");
}

/** The bytes `pasco build` last wrote for the surface, or `undefined`. */
function builtArtifact(workspace: string, surface: string): string | undefined {
  const path = artifactPath(workspace, surface);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** The surfaces that have an artifact on disk — `profiles/<s>/README.md` or
 *  `profiles/<s>.md`, filtered to the platform contract (D16). */
function publishedSurfaces(workspace: string): string[] {
  const dir = join(workspace, "profiles");
  if (!existsSync(dir)) return [];
  const known = new Set<string>(PLATFORMS);
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const surface = entry.isDirectory()
      ? existsSync(join(dir, entry.name, "README.md"))
        ? entry.name
        : undefined
      : entry.name.endsWith(".md")
        ? entry.name.slice(0, -".md".length)
        : undefined;
    if (surface !== undefined && known.has(surface)) out.push(surface);
  }
  return out;
}

/** The artifact renderer, memoized: `build` collects the media bundle once and
 *  this must too, or a multi-surface report re-hashes every asset per surface. */
export interface ArtifactResolver {
  /** The bytes `pasco build` last wrote for the surface, or `undefined`. */
  built(surface: string): string | undefined;
  /** The artifact the engine WOULD publish for the surface at `lang`. */
  render(surface: string, lang: Lang): string | undefined;
}

/**
 * Resolve artifacts exactly as `pasco build` does — variant body → renderer (or
 * the shared paste source for a manual surface) — with the workspace's
 * completeness and selection policy. Kept separate from the CLI command so the
 * ANCHOR (`--mark`) and the TRUTH line cannot drift into two render paths.
 */
export function createArtifactResolver(args: {
  workspace: string;
  profile: LoadedProfile;
  completenessPolicy?: CompletenessPolicyConfig;
  selectionPolicy?: SelectionPolicyConfig;
}): ArtifactResolver {
  let assets: readonly MediaAsset[] | undefined;
  const media = (): readonly MediaAsset[] =>
    (assets ??= collectMedia(args.profile, args.workspace).assets);
  const policy = sanitizeCompletenessPolicy(args.completenessPolicy);
  const selection = sanitizeSelectionPolicy(args.selectionPolicy) as SelectionPolicy | undefined;

  return {
    built: (surface) => builtArtifact(args.workspace, surface),
    render: (surface, lang) => {
      // `build` renders `github-org` for BRAND workspaces only (D15/§17). A person
      // workspace must never "match" bytes the engine would not produce.
      if (surface === "github-org" && args.profile.flavor !== "brand") return undefined;
      const renderer = RENDERERS[surface];
      // The implicit view is the platform itself — what a plain `pasco build`
      // resolves (#238 makes the variant body part of the artifact).
      const slice = compile(args.profile, surface as Platform, lang, {
        ...policy,
        ...(selection === undefined ? {} : { selection, view: surface }),
      });
      const variant = resolveVariantBody(args.workspace, slice);
      if (variant.text !== undefined) return variant.text;
      return renderer === undefined ? pasteSource(slice) : renderer(slice, media()).text;
    },
  };
}

/** The langs worth comparing against: the workspace lang first, then the rest of
 *  the contract's language enum (§11). `--lang` is validated against that same
 *  enum, so every artifact `pasco build` can write is covered — no false
 *  `diverges` for a legitimately built `es`/`fr` artifact. */
function candidateLangs(primary: Lang): Lang[] {
  return [primary, ...LANGS.filter((lang) => lang !== primary)];
}

/**
 * The artifact's FACT identity: its bytes minus the one generated token whose own
 * input is the ledger — `Profile completeness: <pct> — <n>/<m>` (SPEC §20: the
 * percentage is derived and must never be stored as truth). The token is a VIEW
 * of coverage, so a `--mark` moves it without moving a single fact; comparing the
 * raw bytes would report every confirmed surface as `diverges` for the rest of
 * its life.
 */
const GENERATED_COMPLETENESS = /^Profile completeness: -?\d+(?:\.\d+)?% — \d+\/\d+$/;

function factIdentity(text: string): string {
  return text
    .split("\n")
    .filter((line) => !GENERATED_COMPLETENESS.test(line))
    .join("\n");
}

/**
 * The artifact axis: `absent` when there is nothing on disk (never a silent
 * `matches-SSOT`), otherwise fact-identity equality against a render — at any
 * lang the profile declares, so a legitimately built `es` artifact is not called
 * divergent.
 */
function artifactTruth(
  resolver: ArtifactResolver,
  surface: string,
  langs: readonly Lang[],
): ArtifactTruth {
  const built = resolver.built(surface);
  if (built === undefined) return "absent";
  const identity = factIdentity(built);
  for (const lang of langs) {
    const render = resolver.render(surface, lang);
    if (render !== undefined && factIdentity(render) === identity) return "matches-SSOT";
  }
  return "diverges";
}

/** Surfaces whose §19.5 evidence CONTRADICTS the ledger — `out-of-band-drift` is
 *  not a strength of confirmation and cannot be read as a match. */
function driftingSurfaces(reportData: LedgerReport): Set<string> {
  const drifting = new Set<string>();
  for (const unit of reportData.units) {
    for (const [surface, cert] of Object.entries(unit.certification?.surfaces ?? {})) {
      if (cert.state === "out-of-band-drift") drifting.add(surface);
    }
  }
  return drifting;
}

/** Per-surface staleness rollup from the §19 report: any stale RECORDED unit →
 *  `stale`, plus the coverage behind it (`recorded`/`stale`). A surface absent
 *  from the ledger is `never` — absence is not `stale`; units with no record are
 *  not `in-sync` either, and are listed `never` by the unit table. */
function ledgerSurfaces(
  reportData: LedgerReport,
): Record<string, { state: "in-sync" | "stale"; recorded: number; stale: number }> {
  const out: Record<string, { state: "in-sync" | "stale"; recorded: number; stale: number }> = {};
  for (const unit of reportData.units) {
    for (const [surface, state] of Object.entries(unit.surfaces)) {
      const entry = out[surface] ?? { state: "in-sync" as const, recorded: 0, stale: 0 };
      entry.recorded += 1;
      if (state === "stale") {
        entry.state = "stale";
        entry.stale += 1;
      }
      out[surface] = entry;
    }
  }
  return out;
}

/** True for a finding about a ROW (a text over its cap), false for a finding
 *  about the CATALOG (a cap that could not be evaluated). */
function isRowFinding(finding: LimitFinding): boolean {
  return finding.path.startsWith("headlines:") || finding.path.startsWith("bios:");
}

/**
 * Split the executor's output for this axis: only `max-chars` row findings can
 * mean `over(cap)` (a cap is an upper bound; `min-chars` is a floor and stays
 * `pasco check`'s), while a CATALOG warning is kept in `findings` so an
 * un-evaluable cap is never a silent `ok` — the exact pass §20.1 forbids.
 */
function axisFindings(findings: readonly LimitFinding[]): LimitFinding[] {
  return findings.filter((finding) => !isRowFinding(finding) || finding.code === "max-chars");
}

/**
 * Derive one line per surface "in play" — a surface with a ledger record or an
 * artifact on disk. A surface with neither is not invented: it is exactly the
 * "nothing was ever published here" case the unit report already covers as
 * `never`, and a 20-line table of empty platforms would bury the one that matters.
 */
export function publicationTruth(args: {
  workspace: string;
  profile: LoadedProfile;
  reportData: LedgerReport;
  /** The workspace's check rows (`content/checks.yaml` ∪ the shipped catalog). */
  checks: LoadedProfile["checks"];
  lang: Lang;
  completenessPolicy?: CompletenessPolicyConfig;
  selectionPolicy?: SelectionPolicyConfig;
}): PublicationTruth[] {
  const resolver = createArtifactResolver({
    workspace: args.workspace,
    profile: args.profile,
    completenessPolicy: args.completenessPolicy,
    selectionPolicy: args.selectionPolicy,
  });
  const ledger = ledgerSurfaces(args.reportData);
  const drifting = driftingSurfaces(args.reportData);
  const surfaces = [...new Set([...Object.keys(ledger), ...publishedSurfaces(args.workspace)])]
    .filter((s) => (PLATFORMS as readonly string[]).includes(s))
    .sort();
  const langs = candidateLangs(args.lang);

  return surfaces.map((surface) => {
    const ledgerEntry = ledger[surface];
    const findings = axisFindings(limitFindings(args.profile, args.checks, surface as Platform));
    // The artifact axis: local bytes vs the SSOT, with §19.5 contrary evidence
    // outranking `absent` — the live page contradicts the ledger, and that is the
    // stronger fact. `artifactReason` says which comparison produced it.
    const local = artifactTruth(resolver, surface, langs);
    const drifted = drifting.has(surface);
    const artifact: ArtifactTruth =
      drifted || local === "diverges" ? "diverges" : local === "absent" ? "absent" : "matches-SSOT";
    const artifactReason: ArtifactReason | undefined =
      artifact === "matches-SSOT"
        ? undefined
        : drifted
          ? "live-drift"
          : local === "absent"
            ? "no-artifact"
            : "local-mismatch";
    return {
      surface,
      sync: ledgerEntry?.state ?? "never",
      artifact,
      ...(artifactReason === undefined ? {} : { artifactReason }),
      limits: findings.some((f) => isRowFinding(f)) ? "over(cap)" : "ok",
      units: { recorded: ledgerEntry?.recorded ?? 0, stale: ledgerEntry?.stale ?? 0 },
      findings,
    };
  });
}

/** The `StatusArgs` shape this adapter needs — structural, so `publication.ts`
 *  never imports the command module (no cycle) and `--verify` can share it. */
export interface PublicationCaller {
  workspace: string;
  platformArg?: string;
  lang?: Lang;
  completenessPolicy?: CompletenessPolicyConfig;
  selectionPolicy?: SelectionPolicyConfig;
}

/** Derive the truth for a CLI caller: applies the shipped cap catalog when the
 *  workspace predates one (#255) and honors a `--platform` report filter. ONE
 *  adapter so `status` and `status --verify` cannot assemble it differently. */
export function publicationOfCaller(
  args: PublicationCaller,
  profile: LoadedProfile,
  reportData: LedgerReport,
  defaultChecks: LoadedProfile["checks"],
): PublicationTruth[] {
  const checks = profile.checks.length > 0 ? profile.checks : defaultChecks;
  return publicationTruth({
    workspace: args.workspace,
    profile,
    reportData,
    checks,
    lang: args.lang ?? "en",
    completenessPolicy: args.completenessPolicy,
    selectionPolicy: args.selectionPolicy,
  }).filter((t) => args.platformArg === undefined || t.surface === args.platformArg);
}

/** `1/2 surfaces match the SSOT · 1 over cap` — the coverage phrase shared by
 *  `--completeness`, the generated CHECKLIST and the text report. */
export function publicationCoverageLine(publication: readonly PublicationTruth[]): string {
  const total = publication.length;
  const matching = publication.filter((t) => t.artifact === "matches-SSOT").length;
  const over = publication.filter((t) => t.limits === "over(cap)").length;
  const diverging = publication.filter((t) => t.artifact === "diverges").length;
  const absent = publication.filter((t) => t.artifact === "absent").length;
  const noun = total === 1 ? "surface" : "surfaces";
  const verb = total === 1 ? "matches" : "match";
  return [
    `${matching}/${total} ${noun} ${verb} the SSOT`,
    `${over} over cap`,
    ...(diverging > 0 ? [`${diverging} diverged`] : []),
    ...(absent > 0 ? [`${absent} absent`] : []),
  ].join(" · ");
}

/** The coverage phrase, or the honest empty state — `0/0` would read as a score. */
export function publicationCoverageOrNone(publication: readonly PublicationTruth[]): string {
  return publication.length === 0
    ? "no surface published yet"
    : publicationCoverageLine(publication);
}

/** The three-axis line, exactly as the contract prints it, plus the coverage
 *  behind `sync` — the human line must not overstate it either (premerge #256
 *  round 2, M4). */
export function publicationLine(truth: PublicationTruth): string {
  return `${truth.surface}: ${truth.sync} · artifact: ${truth.artifact} · limits: ${truth.limits} · units: ${truth.units.recorded} recorded${truth.units.stale > 0 ? ` (${truth.units.stale} stale)` : ""}`;
}
