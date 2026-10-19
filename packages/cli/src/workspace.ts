/**
 * Workspace resolution (D14): `pasco` reads a profile-data workspace by
 * CONFIGURED PATH, never by copying or owning user data.
 *
 * Resolution order:
 *   1. `--workspace <path>` flag (explicit, wins).
 *   2. `.pascorc` found in the current directory — `workspace` field, resolved
 *      relative to the `.pascorc` file (so a .pascorc at the workspace root with
 *      `"workspace": "."` means the workspace root itself).
 *   3. The current directory.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The workspace product name (SPEC §9 terminology) — the SSOT repo a user
 * owns with their professional facts. Single source for every user-facing
 * string that names the workspace (init templates, help text) — never
 * hardcoded per file.
 */
export const WORKSPACE_NAME = "profile-data";

export interface PascorcDefaults {
  lang?: "en" | "es" | "fr";
  variants?: number;
}

/**
 * Issue #102: the completeness policy — what the workspace is measured
 * against. Config, not code (dev-methodology §3): the engine owns the catalog,
 * the workspace owns the target/weights/langs. This is a STRUCTURAL mirror of
 * core's `CompletenessPolicy` (the CLI package must not reach into core types
 * at config-parse time); `status.ts` passes it straight to `completeness()`.
 */
export interface CompletenessPolicyConfig {
  target?: string;
  langs?: readonly string[];
  items?: readonly { id: string; weight: number }[];
}

/**
 * D22/§21: the fact-selection policy — what each VIEW emits. A structural mirror
 * of core's `SelectionPolicy` (same reason as the completeness config above: the
 * CLI validates config before it reaches the engine). Strings are kept raw here;
 * `build`/`status` validate `platform`/`lang` against the contract enums, because
 * a typo there must fail as a config error, not silently resolve to nothing.
 */
export interface SelectionRuleConfig {
  mode?: "all" | "tags";
  tags?: readonly string[];
  excludeTags?: readonly string[];
  excludeKeys?: readonly string[];
  platform?: string;
  lang?: string;
}

export interface SelectionPolicyConfig {
  default?: SelectionRuleConfig;
  views?: Readonly<Record<string, SelectionRuleConfig>>;
}

export interface Pascorc {
  /** Workspace path relative to the .pascorc file location. */
  workspace?: string;
  defaults?: PascorcDefaults;
  diff?: { tagPattern?: string };
  /** Issue #102: completeness policy (weights/target/langs) — optional. */
  completeness?: CompletenessPolicyConfig;
  /** D22/§21: fact selection per view — optional; absent ⇒ byte-identical output. */
  selection?: SelectionPolicyConfig;
}

/**
 * Normalize a `.pascorc` completeness policy before it reaches core (review of
 * #205, F5): a non-finite weight is a config typo that would otherwise flow into
 * the arithmetic and render `NaN%` on a green-looking run. A malformed weight is
 * DROPPED — the item falls back to the shipped default — never coerced to 0/NaN.
 * Both `status --completeness` and `build` (which compiles the artifact with the
 * same policy) go through here, so the two surfaces cannot diverge.
 */
export function sanitizeCompletenessPolicy(raw: CompletenessPolicyConfig | undefined): {
  target?: string;
  langs?: readonly string[];
  items?: readonly { id: string; weight: number }[];
} {
  if (raw === undefined) return {};
  const items = (raw.items ?? []).filter(
    (i): i is { id: string; weight: number } =>
      typeof i?.id === "string" && i.id !== "" && Number.isFinite(i.weight),
  );
  const langs = (raw.langs ?? []).filter((l): l is string => typeof l === "string" && l !== "");
  return {
    ...(typeof raw.target === "string" ? { target: raw.target } : {}),
    ...(langs.length > 0 ? { langs } : {}),
    ...(items.length > 0 ? { items } : {}),
  };
}

/**
 * Normalize `.pascorc` `selection` before it reaches core (same discipline as
 * `sanitizeCompletenessPolicy`, review of #205 F5): every malformed piece is
 * DROPPED rather than coerced, so a typo cannot become "omit everything" or
 * "omit nothing" by accident. Returns `undefined` when nothing survives — which
 * keeps the no-policy ⇒ byte-identical guarantee intact for a broken config that
 * happened to contain no usable rule.
 */
export function sanitizeSelectionPolicy(raw: SelectionPolicyConfig | undefined):
  | {
      default?: SelectionRuleConfig;
      views?: Record<string, SelectionRuleConfig>;
    }
  | undefined {
  if (raw === undefined) return undefined;
  const strings = (v: unknown): readonly string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const kept = v.filter((x): x is string => typeof x === "string" && x !== "");
    return kept.length > 0 ? kept : undefined;
  };
  const rule = (r: SelectionRuleConfig | undefined): SelectionRuleConfig | undefined => {
    if (r === undefined) return undefined;
    const mode = r.mode === "all" || r.mode === "tags" ? r.mode : undefined;
    const tags = strings(r.tags);
    const excludeTags = strings(r.excludeTags);
    const excludeKeys = strings(r.excludeKeys);
    const platform = typeof r.platform === "string" && r.platform !== "" ? r.platform : undefined;
    const lang = typeof r.lang === "string" && r.lang !== "" ? r.lang : undefined;
    if (
      mode === undefined &&
      tags === undefined &&
      excludeTags === undefined &&
      excludeKeys === undefined &&
      platform === undefined &&
      lang === undefined
    ) {
      return undefined;
    }
    return {
      ...(mode === undefined ? {} : { mode }),
      ...(tags === undefined ? {} : { tags }),
      ...(excludeTags === undefined ? {} : { excludeTags }),
      ...(excludeKeys === undefined ? {} : { excludeKeys }),
      ...(platform === undefined ? {} : { platform }),
      ...(lang === undefined ? {} : { lang }),
    };
  };
  const views: Record<string, SelectionRuleConfig> = {};
  for (const [name, r] of Object.entries(raw.views ?? {})) {
    const clean = rule(r);
    if (clean !== undefined) views[name] = clean;
  }
  const def = rule(raw.default);
  if (def === undefined && Object.keys(views).length === 0) return undefined;
  return {
    ...(def === undefined ? {} : { default: def }),
    ...(Object.keys(views).length > 0 ? { views } : {}),
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function readPascorc(dir: string): { pascorc: Pascorc; pascorcPath: string } | null {
  const pascorcPath = join(dir, ".pascorc");
  if (!existsSync(pascorcPath)) {
    // Migration guard (issue #38, sota-review round 2): a legacy `.pacrc` would be
    // silently ignored — its `workspace` path and defaults would vanish. Make the
    // stale state self-announcing instead of silent (poka-yoke).
    const legacy = join(dir, ".pacrc");
    if (existsSync(legacy)) {
      throw new ConfigError(
        `legacy .pacrc found at ${legacy} — rename it to .pascorc (the bin was renamed pac → pasco; issue #38)`,
      );
    }
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(pascorcPath, "utf8");
  } catch (err) {
    throw new ConfigError(`cannot read ${pascorcPath}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${pascorcPath}: invalid JSON in .pascorc`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${pascorcPath}: .pascorc must be a JSON object`);
  }
  return { pascorc: parsed as Pascorc, pascorcPath };
}

/**
 * Resolve the workspace path for a command.
 *
 * @param cwd    process.cwd()
 * @param flag   the `--workspace` value, if given (resolved against cwd)
 */
export function resolveWorkspace(cwd: string, flag?: string): string {
  if (flag !== undefined) return resolve(cwd, flag);

  const found = readPascorc(cwd);
  if (found !== null && found.pascorc.workspace !== undefined) {
    // Relative to the DIRECTORY that holds the .pascorc file (dirname), so a
    // workspace in another directory works and `"workspace": "."` at the
    // workspace root resolves to the workspace root itself.
    return resolve(dirname(found.pascorcPath), found.pascorc.workspace);
  }
  return cwd;
}

/** Read .pascorc for the resolved workspace (defaults, diff config). Never throws when no
 *  config file exists; throws with a migration hint when a legacy `.pacrc` is present. */
export function readWorkspacePascorc(workspace: string): Pascorc {
  const found = readPascorc(workspace);
  return found?.pascorc ?? {};
}

export function defaultsLang(pascorc: Pascorc, requested?: string): "en" | "es" | "fr" {
  if (requested !== undefined) return requested as "en" | "es" | "fr";
  return pascorc.defaults?.lang ?? "en";
}
