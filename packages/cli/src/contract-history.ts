/**
 * The profile contract's own minor history — what each schema minor ADDED, and
 * what that buys (issue #439, SPEC §7.6).
 *
 * `pasco doctor` already names the two versions (`engine 0.4.0 · schema v1.16 ·
 * requires engine >= 0.4.0 (met)`); it never says what changed between them. The
 * upgrade the issue observed (contract v1.9 → v1.15) moved six adoptable fields,
 * and finding them required reading the CHANGELOG, the schema description and the
 * geo report — a supervision session, not a command.
 *
 * **This table is a PROJECTION, never a second source.** `schema/profile.schema.json`
 * narrates every minor in its own `description` (`New in v1.10 (issue #288): …`)
 * and carries the installed version in `$id`; `packages/cli/tests/consumer-contract.test.ts`
 * pins this table to that narration — a schema bump that forgets a row, a row
 * that invents a minor, and a row that claims a field its minor never narrated
 * all fail `pnpm test`. The one thing that is NOT derivable is `buys`: the
 * narration says what was added, and this table says which surface consumes it.
 *
 * A minor that shipped no adoptable field (v1.11 never carried a narration
 * marker) simply has no row: the gap is the schema's, and the narration pin
 * makes the two agree on it.
 */

import type { EngineConfigSource } from "./engine-gate.js";

/** One contract minor: the fields it added and the surface they feed. */
export interface ContractMinor {
  /** `MAJOR.MINOR` exactly as the schema's `$id` spells it. */
  version: string;
  /** The contract paths the minor added — the things a workspace can adopt. */
  fields: readonly string[];
  /** Narration tokens that are NOT new fields, so the freshness pin can demand
   *  that EVERY field a minor's narration backticks is named above: a
   *  pre-existing field the minor only extends (`press`, `links`), a `$defs`
   *  reference (`url`), the name of a projection (`description`), or a note
   *  that deliberately did not change (`evidence`). Anything else the narration
   *  names must appear in `fields` — a row that under-reports fails `pnpm test`. */
  notFields?: readonly string[];
  /** One line: which score/report surface reads them ("what it buys"). */
  buys: string;
}

/**
 * Every narrated minor, oldest first. The narration is the authority on the SET;
 * `buys` is this table's own editorial line (a projection cannot invent it).
 */
export const CONTRACT_HISTORY: readonly ContractMinor[] = [
  {
    version: "1.1",
    fields: [
      "flavor",
      "socialHandles",
      "newsletter",
      "podcast",
      "press",
      "audiences",
      "identity.handle",
      "identity.timezone",
      "languages",
      "education",
      "highlights",
      "publication.authors",
      "publication.url",
    ],
    buys: "brand flavor (D15) and the invariant facts — org identity, handle/timezone, languages, education, per-language highlights, publication authors/url",
  },
  {
    version: "1.2",
    fields: ["platforms"],
    buys: "one platform enum for both flavors (43 platforms) — every renderer, check and paste surface resolves from it",
  },
  {
    version: "1.3",
    fields: ["deployments", "id", "origin"],
    buys: "the per-entry deploy ledger (D18) — `status` reports in-sync/stale/never per surface, and rows can be addressed by a stable id",
  },
  {
    version: "1.4",
    fields: ["credentials", "artifacts", "credentialId", "artifactId", "artifactRefs"],
    notFields: ["evidenceItem", "publications", "press", "evidence"],
    buys: "the evidence registry (D17) — attestations and works/media become pointer-first rows that publications and press can cite",
  },
  {
    version: "1.5",
    fields: ["identity.email"],
    notFields: ["links"],
    buys: "a contact email as a first-class fact (schema.org `email`, not a `mailto:` link the validator rejects)",
  },
  {
    version: "1.6",
    fields: ["identity.links[].role"],
    notFields: ["identity", "url"],
    buys: "the link ROLE (D17/§15.4) — the JSON-LD `@id` and `sameAs` are derived from a declared `identity` link instead of guessed",
  },
  {
    version: "1.7",
    fields: ["kofi"],
    buys: "the Ko-fi platform (creator-monetization family) — one more paste surface `build`/`check` resolve",
  },
  {
    version: "1.8",
    fields: ["buymeacoffee", "liberapay", "gumroad", "payhip"],
    buys: "four more creator-monetization platforms, all paste surfaces (no API deploy)",
  },
  {
    version: "1.9",
    fields: ["hotmart"],
    buys: "the Hotmart storefront platform, for the Spanish/Portuguese creator market",
  },
  {
    version: "1.10",
    fields: ["identity.definition", "faq[]", "faq[].q", "faq[].a", "faq[].source"],
    notFields: ["url", "description"],
    buys: "the answer-engine surface (#288) — a citable per-language definition plus a 3–20 row FAQ, projected into Person `description` and a `FAQPage` JSON-LD node by `entity`/`build`",
  },
  {
    version: "1.12",
    fields: ["projects[].artifactRefs"],
    notFields: ["projects", "url"],
    buys: "a project names the work behind it — published-vs-in-development is DERIVED from the artifacts (`visibility` + `locator.url`), never stored (§20.1)",
  },
  {
    version: "1.13",
    fields: ["identity.nationality"],
    buys: "nationality as a citable fact (schema.org `Person.nationality` → `Country`); outside the `ready` gate, so omitting it scores as before",
  },
  {
    version: "1.14",
    fields: ["publication.kind"],
    buys: "a closed publication classification — `peerReviewed` is derived from `kind == journal-article` instead of per-consumer venue-string heuristics",
  },
  {
    version: "1.15",
    fields: ["releases[]", "releases[].changedUnits", "releases[].surfaces"],
    notFields: ["kind"],
    buys: "the release EVENT and its fan-out (D23) — each release names the ledger units it changed and the presence surfaces it must reach",
  },
  {
    version: "1.16",
    fields: [
      "achievements[]",
      "achievements[].statement",
      "achievements[].kind",
      "achievements[].metric",
      "achievements[].refs",
      "achievements[].basis",
      "achievements[].visibility",
      "achievements[].target",
      "achievements[].value",
    ],
    buys: "the career impact log (D24) — `pasco achievements` reads measured/planned results with a derived status, instead of free-text highlights",
  },
];

/** The accepted floor grammar: exactly `MAJOR.MINOR`, digits only. */
const CONTRACT_VERSION = /^(\d+)\.(\d+)$/;

/** Parse a contract version (`1.10`) — `null` when it is not `MAJOR.MINOR`. */
export function parseContractVersion(value: string): { major: number; minor: number } | null {
  const match = CONTRACT_VERSION.exec(value.trim());
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** Negative when `a < b`, zero when equal, positive when `a > b`; `null` when
 *  either value does not parse. Numeric on both components: `1.10` is newer
 *  than `1.9`, which a string comparison gets wrong. */
export function compareContractVersions(a: string, b: string): number | null {
  const left = parseContractVersion(a);
  const right = parseContractVersion(b);
  if (left === null || right === null) return null;
  return left.major * 1000 + left.minor - (right.major * 1000 + right.minor);
}

/** The rows a workspace at `floor` has not been told about: strictly newer than
 *  the floor and not newer than the installed contract. `[]` when the two are
 *  equal, when the floor is ahead, or when either value does not parse. */
export function contractDelta(floor: string, installed: string): ContractMinor[] {
  const ahead = compareContractVersions(installed, floor);
  if (ahead === null || ahead <= 0) return [];
  return CONTRACT_HISTORY.filter((minor) => {
    const newerThanFloor = compareContractVersions(minor.version, floor);
    const notNewerThanInstalled = compareContractVersions(minor.version, installed);
    return (
      newerThanFloor !== null &&
      notNewerThanInstalled !== null &&
      newerThanFloor > 0 &&
      notNewerThanInstalled <= 0
    );
  });
}

/** The one token that names the premise the delta stands on (mirrors the
 *  `DoctorRequirementState` discipline: `absent` is a state, not a pass). */
export type ContractFloorState = "delta" | "none" | "ahead" | "absent" | "INVALID";

/** `doctor --contract-delta`'s report block (additive to §7.6's `DoctorReport`). */
export interface ContractDeltaReport {
  floor: string | null;
  installed: string;
  state: ContractFloorState;
  /** Only on `INVALID`: the malformed declaration and the accepted grammar. */
  problem?: string;
  /** Only when a `.pascorc` declares the floor: the file that produced it. */
  source?: string;
  rows: ContractMinor[];
}

export interface ContractFloor {
  declared: string | null;
  problem?: string;
  source?: string;
}

/**
 * Resolve `.pascorc.contract` across every config the workspace resolution
 * consulted. A malformed declaration WINS (it is refused, never coerced) —
 * otherwise the LOWEST floor wins: the delta is the question "what did I miss",
 * so the most inclusive answer is the honest one, and the opposite of the
 * engine gate's "strictest wins" for the same reason.
 */
export function evaluateContractFloor(sources: readonly EngineConfigSource[]): ContractFloor {
  let lowest: { value: string; source?: string } | null = null;
  for (const source of sources) {
    const declared = source.pascorc.contract;
    if (declared === undefined) continue;
    if (typeof declared !== "string" || parseContractVersion(declared) === null) {
      return {
        declared: null,
        problem: `\`.pascorc\` field "contract" must be a contract version written as MAJOR.MINOR (e.g. "1.16"); got ${JSON.stringify(declared)}${source.pascorcPath === undefined ? "" : ` in ${source.pascorcPath}`}`,
        ...(source.pascorcPath === undefined ? {} : { source: source.pascorcPath }),
      };
    }
    const normalized = `${parseContractVersion(declared)?.major}.${parseContractVersion(declared)?.minor}`;
    if (lowest === null || (compareContractVersions(normalized, lowest.value) ?? 0) < 0) {
      lowest = {
        value: normalized,
        ...(source.pascorcPath === undefined ? {} : { source: source.pascorcPath }),
      };
    }
  }
  if (lowest === null) return { declared: null };
  return {
    declared: lowest.value,
    ...(lowest.source === undefined ? {} : { source: lowest.source }),
  };
}

/** Compose the report `doctor --contract-delta` prints and `--json` carries. */
export function evaluateContractDelta(
  sources: readonly EngineConfigSource[],
  installed: string,
): ContractDeltaReport {
  const floor = evaluateContractFloor(sources);
  const base = {
    floor: floor.declared,
    installed,
    ...(floor.problem === undefined ? {} : { problem: floor.problem }),
    ...(floor.source === undefined ? {} : { source: floor.source }),
  };
  if (floor.problem !== undefined) return { ...base, state: "INVALID", rows: [] };
  if (floor.declared === null) return { ...base, state: "absent", rows: [] };
  const compared = compareContractVersions(floor.declared, installed);
  if (compared === null || compared > 0) return { ...base, state: "ahead", rows: [] };
  if (compared === 0) return { ...base, state: "none", rows: [] };
  return { ...base, state: "delta", rows: contractDelta(floor.declared, installed) };
}
