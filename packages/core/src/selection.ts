/**
 * Fact selection per rendered profile — D22 (SPEC §21).
 *
 * A **view** is a named projection of the workspace: a target platform, a
 * language, and a selection. The engine adapts three things per surface and they
 * are orthogonal — `lang` adapts TEXT, `refine` adapts STORYTELLING, a view
 * selects WHICH FACTS. The first two never change what a fact says; this module
 * must not either, and that is the whole contract:
 *
 *   SUBSET-ONLY. Selection REMOVES entries. It never edits, renames, reorders by
 *   value or re-derives one. A rendered profile is a sub-conjunction of the
 *   SSOT's facts, and removing a conjunct cannot introduce a contradiction
 *   between the ones that remain — which is what Goal 2/3 and §15.4 constrain.
 *   The cost is COVERAGE, never consistency, and §21.4 makes it warn.
 *
 *   ORDER IS NARRATIVE, NOT A FACT (#458). A view may also declare `orderKeys`
 *   (`.pascorc`) to pin the entries it already emits into a presentation order.
 *   That is not a re-sort by value: it never adds, removes or rewrites an entry,
 *   the SSOT keeps no order, and the remaining entries keep the renderer's own
 *   comparator. Same class as a headline: two surfaces may legitimately disagree
 *   on what goes first.
 *
 * The policy lives in workspace config (`.pascorc` → `selection`), never in the
 * SSOT: the data stays platform-agnostic (§9/D14) and a new platform never forces
 * an edit to every entry. That is §20's pattern — compute in the engine, store
 * only the policy — applied to a second axis.
 *
 * Pure, deterministic, offline: same profile + same policy ⇒ same output.
 * Iteration follows the SSOT's declaration order (never a map's order), unless a
 * view pins `orderKeys`; byte-stability (§15.1) is a property of the output, not
 * of the runtime.
 */

import type { Lang, Platform, Profile } from "./types.js";

/** The blocks a view may select from (§21.3 rule 3). Singleton blocks —
 *  `identity`, `positioning`, `keywords` — are deliberately NOT selectable. */
export const SELECTION_BLOCKS = [
  "experience",
  "projects",
  "publications",
  "education",
  "press",
  "credentials",
  "artifacts",
  "skills",
] as const;

export type SelectionBlock = (typeof SELECTION_BLOCKS)[number];

/**
 * Blocks whose entries carry `tags` in the schema TODAY. Phase 1 (§21.7) is
 * schema-free, and `artifacts[].tags` is the only one §18.9 ever declared — it
 * was validated and then ignored by every renderer until this module reads it.
 *
 * Phase 2 makes the six entry blocks tag-capable; THIS SET is the switch, so the
 * `mode: "tags"` semantics extend without touching the resolver.
 */
const TAG_CAPABLE: ReadonlySet<SelectionBlock> = new Set<SelectionBlock>(["artifacts"]);

export type SelectionMode = "all" | "tags";

/** One view's rule (§21.2). Every field is optional: `{}` means "no filtering". */
export interface ViewRule {
  /** The basis: every entry, or only entries carrying one of `tags`. */
  mode?: SelectionMode;
  /** Allowlist — meaningful with `mode: "tags"`. */
  tags?: readonly string[];
  /** Deny by tag, applied in EVERY mode. */
  excludeTags?: readonly string[];
  /** Deny by §19.2 key (`experience:<id>`, `projects:<id>`, `skills:<name>`, …). */
  excludeKeys?: readonly string[];
  /** Narrative order by §19.2 key (#458): within each block, the keys this view
   *  emits come first in this declared order; the rest keep the renderer's
   *  comparator (or the SSOT order when the renderer does not sort). Ordering is
   *  PRESENTATION, never a fact: the SSOT carries no order. A key the view does
   *  not emit warns (`selection/order-key-unknown`) rather than no-op'ing
   *  silently. */
  orderKeys?: readonly string[];
  /** Optional target, so `--view <name>` alone resolves platform + lang. */
  platform?: Platform;
  lang?: Lang;
}

export interface SelectionPolicy {
  /** Applied to any view without its own rule; absent ⇒ no filtering. */
  default?: ViewRule;
  views?: Readonly<Record<string, ViewRule>>;
}

export type OmissionReason = "excluded-by-key" | "excluded-by-tag" | "not-tagged";

export interface SelectionOmission {
  block: SelectionBlock;
  /** §19.2 key when the entry is addressable; otherwise `<block>[<index>]`. */
  key: string;
  /** Human label for the report (id, if absent the title/name). */
  label: string;
  reason: OmissionReason;
}

export type SelectionFindingCode =
  | "selection/unknown-key"
  | "selection/unknown-tag"
  | "selection/order-key-unknown"
  | "selection/empty-facts"
  | "selection/anchor-omitted"
  | "selection/omits-facts";

export interface SelectionFinding {
  code: SelectionFindingCode;
  severity: "error" | "warn";
  message: string;
}

export interface SelectionReport {
  view: string;
  platform: Platform;
  lang: Lang;
  mode: SelectionMode;
  /** Count of entries EMITTED per block (the report's positive half). */
  selected: Record<SelectionBlock, number>;
  /** Every entry the view removed, with its reason (§21.4). */
  omitted: SelectionOmission[];
  /** Per-block declared order actually applied (#458), in declared key order.
   *  Empty when the view declares no `orderKeys`, so a policy without the field
   *  reports exactly what it reported before it existed. `pasco status
   *  --selection` prints it and a sorting renderer re-applies it. */
  ordered: Partial<Record<SelectionBlock, string[]>>;
  findings: SelectionFinding[];
}

export interface SelectionResult {
  /** The filtered profile — the ONLY thing a renderer may see. */
  profile: Profile;
  report: SelectionReport;
}

type Entry = Record<string, unknown>;

function entriesOf(profile: Profile, block: SelectionBlock): Entry[] {
  const raw = (profile as Record<string, unknown>)[block];
  return Array.isArray(raw) ? (raw as Entry[]) : [];
}

/** §19.2 key: `skills:<name>` (the natural key) or `<block>:<id>`. */
function keyOf(block: SelectionBlock, entry: Entry): string | undefined {
  if (block === "skills" && typeof entry.name === "string" && entry.name !== "") {
    return `skills:${entry.name}`;
  }
  if (typeof entry.id === "string" && entry.id !== "") return `${block}:${entry.id}`;
  return undefined;
}

function labelOf(block: SelectionBlock, entry: Entry, index: number): string {
  for (const field of ["id", "name", "title"] as const) {
    const value = entry[field];
    if (typeof value === "string" && value !== "") return value;
  }
  return `${block}[${index}]`;
}

function tagsOf(entry: Entry): string[] {
  const raw = entry.tags;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
}

const intersects = (a: readonly string[], b: ReadonlySet<string>): boolean =>
  a.some((value) => b.has(value));

/**
 * Resolve the rule for a view: the declared view, else `default`, else `{}`
 * (no filtering). An undeclared view with no default is NOT an error when it is
 * the implicit platform view (`pasco build linkedin`) — that is the
 * compatibility path: no policy ⇒ byte-identical output.
 */
export function resolveView(policy: SelectionPolicy | undefined, view: string): ViewRule {
  if (policy === undefined) return {};
  return policy.views?.[view] ?? policy.default ?? {};
}

/** The declared `orderKeys` that are actual strings, first occurrence winning
 *  (a repeated key is one instruction, not two positions). Core never throws on
 *  malformed config — the CLI validates the types before it gets here (§21.2);
 *  anything else would make `pasco validate` unable to show the user the file. */
function declaredOrderOf(rule: ViewRule): string[] {
  const raw = rule.orderKeys;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of raw) {
    if (typeof key !== "string" || key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Stable partition of one block's survivors: the declared keys first, in their
 *  declared order, then everything else in SSOT order. Ungraded entries never
 *  change relative position, so the no-`orderKeys` output is untouched. */
function orderSurvivors(
  block: SelectionBlock,
  survivors: Entry[],
  positions: ReadonlyMap<string, number>,
): Entry[] {
  const decorated = survivors.map((entry, index) => ({
    entry,
    index,
    position: positions.get(keyOf(block, entry) ?? ""),
  }));
  decorated.sort((a, b) => {
    if (a.position !== undefined && b.position !== undefined) {
      return a.position - b.position || a.index - b.index;
    }
    if (a.position !== undefined) return -1;
    if (b.position !== undefined) return 1;
    return a.index - b.index;
  });
  return decorated.map((row) => row.entry);
}

/**
 * Re-apply a view's declared order over a renderer's OWN comparator (#458).
 *
 * A renderer that sorts a block (`github-readme` sorts the featured projects by
 * status and the skills by weight) would otherwise destroy the order
 * `selectFacts` resolved. It calls this instead: the keys the view pinned come
 * first in declared order, and the rest keep the caller's comparator — the
 * precedence is implemented ONCE, here, never per adapter. With no pinned keys
 * the result is exactly `[...entries].sort(compare)`, so a policy without
 * `orderKeys` stays byte-identical.
 */
export function orderedForSurface<T>(
  entries: readonly T[],
  block: SelectionBlock,
  orderedKeys: readonly string[] | undefined,
  compare: (a: T, b: T) => number,
): T[] {
  if (orderedKeys === undefined || orderedKeys.length === 0) return [...entries].sort(compare);
  // Index-addressed, never identity-addressed: the YAML loader preserves aliases
  // (`&row` / `*row`), so two array slots can share ONE object. Keying by
  // identity would then drop the second slot from the surface — selection may
  // reorder, never lose an entry (D22 subset rule).
  const indexByKey = new Map<string, number>();
  entries.forEach((entry, index) => {
    const key = keyOf(block, entry as Entry);
    if (key !== undefined && !indexByKey.has(key)) indexByKey.set(key, index);
  });
  const rankByIndex = new Map<number, number>();
  orderedKeys.forEach((key, rank) => {
    const index = indexByKey.get(key);
    if (index !== undefined && !rankByIndex.has(index)) rankByIndex.set(index, rank);
  });
  if (rankByIndex.size === 0) return [...entries].sort(compare);
  const pinned = [...rankByIndex.entries()]
    .sort(([aIndex, aRank], [bIndex, bRank]) => aRank - bRank || aIndex - bIndex)
    .map(([index]) => entries[index] as T);
  const rest = entries.filter((_, index) => !rankByIndex.has(index));
  rest.sort(compare);
  return [...pinned, ...rest];
}

/**
 * Apply a view's selection to a profile (D22, §21).
 *
 * @param platform/lang reported back so `pasco status --selection` needs no
 *   second resolution pass; they do not influence the filtering itself.
 * @throws never — malformed config is reported as findings, and the CALLER
 *   decides (the CLI fails on `severity: "error"`). A silently-throwing core
 *   would make `pasco validate` unable to show the user what is wrong.
 */
export function selectFacts(
  profile: Profile,
  view: string,
  platform: Platform,
  lang: Lang,
  policy?: SelectionPolicy,
): SelectionResult {
  const rule = resolveView(policy, view);
  const mode: SelectionMode = rule.mode ?? "all";
  const excludeKeys = new Set(rule.excludeKeys ?? []);
  const excludeTags = new Set(rule.excludeTags ?? []);
  const includeTags = new Set(rule.tags ?? []);
  // #458: the declared narrative order, grouped by the block its key names.
  // A key with no `:` (or an unknown prefix) addresses nothing and falls to the
  // unknown-key warning below — never a silent no-op.
  const declaredOrder = declaredOrderOf(rule);
  const positionsByBlock = new Map<SelectionBlock, Map<string, number>>();
  declaredOrder.forEach((key, index) => {
    const block = key.split(":")[0] as SelectionBlock;
    if (!(SELECTION_BLOCKS as readonly string[]).includes(block)) return;
    let positions = positionsByBlock.get(block);
    if (positions === undefined) {
      positions = new Map<string, number>();
      positionsByBlock.set(block, positions);
    }
    if (!positions.has(key)) positions.set(key, index);
  });

  const selected: Record<SelectionBlock, number> = {
    experience: 0,
    projects: 0,
    publications: 0,
    education: 0,
    press: 0,
    credentials: 0,
    artifacts: 0,
    skills: 0,
  };
  const omitted: SelectionOmission[] = [];
  const kept = new Map<SelectionBlock, Entry[]>();
  const keptRefs: { block: SelectionBlock; entry: Entry }[] = [];
  const omittedRefs: { block: SelectionBlock; entry: Entry }[] = [];
  const allKeys = new Set<string>();
  const allTags = new Set<string>();
  let totalEntries = 0;

  for (const block of SELECTION_BLOCKS) {
    const entries = entriesOf(profile, block);
    totalEntries += entries.length;
    const survivors: Entry[] = [];

    entries.forEach((entry, index) => {
      const key = keyOf(block, entry);
      if (key !== undefined) allKeys.add(key);
      const tags = tagsOf(entry);
      for (const tag of tags) allTags.add(tag);

      // §21.3 rule 1: exclusion wins, in every mode.
      if (key !== undefined && excludeKeys.has(key)) {
        omitted.push({
          block,
          key,
          label: labelOf(block, entry, index),
          reason: "excluded-by-key",
        });
        omittedRefs.push({ block, entry });
        return;
      }
      if (TAG_CAPABLE.has(block)) {
        if (intersects(tags, excludeTags)) {
          omitted.push({
            block,
            key: key ?? `${block}[${index}]`,
            label: labelOf(block, entry, index),
            reason: "excluded-by-tag",
          });
          omittedRefs.push({ block, entry });
          return;
        }
        // §21.3 rule 5: `mode: "tags"` is an explicit allowlist — an untagged
        // entry is not selected. Phase 1 limitation (§21.7): blocks without tag
        // support pass through, addressed only by `excludeKeys`.
        if (mode === "tags" && !intersects(tags, includeTags)) {
          omitted.push({
            block,
            key: key ?? `${block}[${index}]`,
            label: labelOf(block, entry, index),
            reason: "not-tagged",
          });
          omittedRefs.push({ block, entry });
          return;
        }
      }
      survivors.push(entry);
      keptRefs.push({ block, entry });
    });

    const positions = positionsByBlock.get(block);
    const orderedSurvivors =
      positions === undefined ? survivors : orderSurvivors(block, survivors, positions);
    kept.set(block, orderedSurvivors);
    selected[block] = orderedSurvivors.length;
  }

  // ── findings ───────────────────────────────────────────────────────────────
  const findings: SelectionFinding[] = [];

  // #458: resolve the order that was ACTUALLY applied. A key is applied only if
  // this view emits it; an absent/excluded/untagged key, an unknown block prefix
  // or a typo warns instead of becoming a silent no-op (the same discipline as
  // `selection/omits-facts`: a statement the surface cannot honour is told).
  const emittedKeys = new Set<string>();
  for (const block of SELECTION_BLOCKS) {
    for (const entry of kept.get(block) ?? []) {
      const key = keyOf(block, entry);
      if (key !== undefined) emittedKeys.add(key);
    }
  }
  const ordered: Partial<Record<SelectionBlock, string[]>> = {};
  const warnedOrderKeys = new Set<string>();
  for (const key of declaredOrder) {
    if (!emittedKeys.has(key)) {
      if (!warnedOrderKeys.has(key)) {
        warnedOrderKeys.add(key);
        findings.push({
          code: "selection/order-key-unknown",
          severity: "warn",
          message: `view "${view}" orders "${key}", which the view does not emit — check the §19.2 key (a typo, or the entry is excluded / not tagged by this view)`,
        });
      }
      continue;
    }
    const block = key.split(":")[0] as SelectionBlock;
    let list = ordered[block];
    if (list === undefined) {
      list = [];
      ordered[block] = list;
    }
    list.push(key);
  }

  // G6 (error): an addressed key that resolves to nothing is an unsatisfied
  // instruction — the §19.2 "addressed ⇒ resolvable" rule. A typo must fail
  // loudly rather than silently omit (or fail to omit) a fact.
  for (const key of excludeKeys) {
    if (!allKeys.has(key)) {
      findings.push({
        code: "selection/unknown-key",
        severity: "error",
        message: `view "${view}" excludes "${key}", which addresses no entry — check the §19.2 key (an entry needs an "id" to be addressable)`,
      });
    }
  }
  for (const tag of new Set([...includeTags, ...excludeTags])) {
    if (!allTags.has(tag)) {
      findings.push({
        code: "selection/unknown-tag",
        severity: "warn",
        message: `view "${view}" names tag "${tag}", which no ${[...TAG_CAPABLE].join("/")} entry carries`,
      });
    }
  }

  // §21.4 / G1 amendment: the default direction of a profile is PUBLISH, so
  // anything that removes a fact owes the user a statement. This is the warn
  // the operator asked for, and it fires on ANY omission — not only on the
  // anchor case below.
  if (omitted.length > 0) {
    const shown = omitted
      .slice(0, 5)
      .map((o) => `${o.key} (${o.reason})`)
      .join(", ");
    const more = omitted.length > 5 ? ` and ${omitted.length - 5} more` : "";
    findings.push({
      code: "selection/omits-facts",
      severity: "warn",
      message: `view "${view}" omits ${omitted.length} entr${omitted.length === 1 ? "y" : "ies"}: ${shown}${more} — subset-only by design (D22); run \`pasco status --selection ${view}\` for the full report`,
    });
  }

  if (totalEntries > 0 && keptRefs.length === 0) {
    findings.push({
      code: "selection/empty-facts",
      severity: "warn",
      message: `view "${view}" selects ZERO entries while the workspace has ${totalEntries} — check its mode/tags`,
    });
  }

  // §21.5: a GEO anchor reinforced only by what this view dropped. The coverage
  // cost is real (an LLM citing this surface will not see it), so it is named.
  const anchors = profile.positioning?.geo?.semanticAssociations ?? [];
  for (const anchor of anchors) {
    const needle = anchor.toLowerCase();
    const haystack = (refs: { block: SelectionBlock; entry: Entry }[]): boolean =>
      refs.some((r) => JSON.stringify(r.entry).toLowerCase().includes(needle));
    if (!haystack(keptRefs) && haystack(omittedRefs)) {
      findings.push({
        code: "selection/anchor-omitted",
        severity: "warn",
        message: `GEO anchor "${anchor}" is reinforced only by entries view "${view}" omits — it does not reach this surface`,
      });
    }
  }

  // ── the filtered profile (subset-only, order preserved) ───────────────────
  const filtered: Profile = { ...profile };
  for (const block of SELECTION_BLOCKS) {
    // Leave an absent block absent: adding `[]` where the SSOT had no block
    // would be a shape change, and selection is not allowed to alter shape.
    if ((profile as Record<string, unknown>)[block] === undefined) continue;
    (filtered as Record<string, unknown>)[block] = kept.get(block) ?? [];
  }

  return {
    profile: filtered,
    report: { view, platform, lang, mode, selected, omitted, ordered, findings },
  };
}
