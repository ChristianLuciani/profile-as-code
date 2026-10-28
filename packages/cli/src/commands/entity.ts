/**
 * `pasco entity [--json | --jsonld [--out <file>] [--bare]]` — the entity
 * projection (SPEC §7.2, issue #287).
 *
 * `audit` is the diagnostic surface; this is the fix surface. A GEO engagement
 * starts with markup pasted into a site the engine does not render, so the same
 * schema.org entity the renderers embed is exposed as an artifact here.
 *
 * **One assembler, never two.** The entity and the JSON-LD come from
 * `core/src/structured-data.ts` — the single home for `@id`, `sameAs` and the
 * entity fields (§15.4). This command composes it; a CLI-local builder would
 * recreate the two-emitters drift class the module exists to prevent.
 *
 * `--json` is the D22-style view (frozen, schemaVersion-stamped): the entity
 * facts, the readiness `gaps`, and `jsonld: null` — the artifact has its own
 * mode. `--jsonld` emits the assembler's `jsonLd` verbatim, serialized as a
 * paste-ready `<script type="application/ld+json">` block (`--bare` = the bare
 * object). Offline and deterministic (D19): no network, no clock, no AI.
 *
 * Exit: 1 when `@id` is absent — the entity has no declared home, the same class
 * as the `check` matrix (#252 §S5) — 0 otherwise; 2 is a usage error (dispatcher).
 */

import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { Lang, LoadedProfile } from "@profile-as-code/core";
import {
  entityId,
  geoCheck,
  LoadError,
  load,
  SchemaValidationError,
  structuredData,
} from "@profile-as-code/core";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";
import type { Pascorc } from "../workspace.js";

/** The frozen contract version of the `--json` payload (SPEC §7.2). */
export const ENTITY_SCHEMA_VERSION = "1";

/** A readiness gap — the `geoCheck` code and detail, verbatim (no new vocabulary). */
export interface EntityGap {
  code: string;
  detail: string;
}

/**
 * The entity facts the projection exposes. `id` is the declared `@id` or `null`
 * — the engine NEVER invents one (#103). `type` is the assembler's entity type;
 * `name`/`sameAs` are its own values; `email` is `null` when undeclared.
 */
export interface EntitySummary {
  id: string | null;
  type: "Person" | "Organization";
  name: string;
  sameAs: string[];
  email: string | null;
}

export interface EntityReport {
  schemaVersion: typeof ENTITY_SCHEMA_VERSION;
  entity: EntitySummary;
  gaps: EntityGap[];
  /** Always null in `--json`: the artifact is emitted by `--jsonld` (§7.2). */
  jsonld: null;
}

/**
 * The `--json` view: the assembler's fields plus the structured-data gaps.
 *
 * `lang` is the SAME resolved language `--jsonld` uses. `geoCheck` assembles its
 * readiness with it, so a brand whose only `mission`/`tagline` value is `es`
 * cannot report `description`/`slogan` as missing in `--json` while `--jsonld`
 * emits them (review F1, SPEC §7.2).
 */
export function entityReport(profile: LoadedProfile, lang: Lang = "en"): EntityReport {
  const geo = geoCheck(profile, lang);
  const readiness = geo.sections.structuredData.readiness;
  // Gaps are a READING of geoCheck, never a second rule: the structured-data
  // section is the entity's readiness contract, and each check's detail already
  // names the situation. Score < 1 (not === 0) so a partially populated entity
  // (e.g. photo but no location) is reported, not hidden.
  const gaps = geo.sections.structuredData.checks
    .filter((check) => check.score < 1)
    .map((check) => ({ code: check.code, detail: check.detail }));

  return {
    schemaVersion: ENTITY_SCHEMA_VERSION,
    entity: {
      id: readiness.fields.id ?? null,
      type: readiness.entityType,
      name: profile.identity.name,
      sameAs: readiness.fields.sameAs,
      email: readiness.fields.email ?? null,
    },
    gaps,
    jsonld: null,
  };
}

/**
 * Serialize the assembler's `jsonLd` for an HTML surface. `<` is escaped as
 * `\u003c` so a URL cannot terminate the `<script>` element early; JSON parsers
 * decode it identically, so the round-trip is exact.
 */
export function jsonLdScript(jsonLd: object): string {
  const json = JSON.stringify(jsonLd, null, 2).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

/** `--bare`: the same object as raw JSON (no script tag, no HTML escaping). */
export function jsonLdBare(jsonLd: object): string {
  return JSON.stringify(jsonLd, null, 2);
}

export interface EntityArgs {
  workspace: string;
  pascorc: Pascorc;
  /** `--jsonld` instead of the `--json`/human view. */
  jsonld: boolean;
  /** `--bare` (only with `--jsonld`): the object, not the `<script>` block. */
  bare: boolean;
  /** `--out <file>` (only with `--jsonld`): write the artifact instead of stdout. */
  out?: string;
  /** `--force` (only with `--out`): replace an existing file. */
  force: boolean;
  /** Resolved language for the assembler; dispatcher applies `.pascorc` default. */
  lang: Lang;
}

function loadProfile(
  workspace: string,
): { profile: LoadedProfile; error?: never } | { profile?: never; error: number } {
  try {
    return { profile: load(workspace) };
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return {
        error: report("entity", false, EXIT.FAIL, {
          error: {
            kind: "schema",
            message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
            violations: [...err.issues],
          },
        }),
      };
    }
    if (err instanceof LoadError) {
      return {
        error: report("entity", false, EXIT.FAIL, {
          error: { kind: "load", message: err.message },
        }),
      };
    }
    throw err;
  }
}

/**
 * Write the artifact atomically (temp file + rename in the destination directory)
 * and never truncate an existing file unless `--force` was passed: a typo in
 * `--out` must not eat the workspace's SSOT, and a failure produces an error
 * envelope instead of an uncaught stack (review F4).
 */
function writeArtifact(path: string, content: string, force: boolean): string | undefined {
  if (!force && existsSync(path)) {
    return `refusing to overwrite "${path}" — it already exists (pass --force to replace it)`;
  }
  const temp = `${path}.${process.pid}.pasco-tmp`;
  try {
    writeFileSync(temp, content, "utf8");
    renameSync(temp, path);
    return undefined;
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {
      // The temp file may not exist — nothing to clean up.
    }
    return `cannot write "${path}": ${(err as Error).message}`;
  }
}

export function runEntity(args: EntityArgs): number {
  const loaded = loadProfile(args.workspace);
  if (loaded.profile === undefined) return loaded.error;
  const profile = loaded.profile;

  const hasId = entityId(profile.identity) !== undefined;
  const exitCode = hasId ? EXIT.OK : EXIT.FAIL;

  if (args.jsonld) {
    const view = structuredData(profile, args.lang);
    if (view.jsonLd === undefined) {
      return report("entity", false, EXIT.FAIL, {
        error: {
          kind: "empty",
          message:
            "the entity has no name, so there is no JSON-LD to emit (identity.name is required by the schema)",
        },
      });
    }
    const artifact = args.bare ? jsonLdBare(view.jsonLd) : jsonLdScript(view.jsonLd);
    if (args.out !== undefined) {
      const failure = writeArtifact(args.out, `${artifact}\n`, args.force);
      if (failure !== undefined) {
        return report("entity", false, EXIT.FAIL, {
          error: { kind: "write", message: failure },
        });
      }
      process.stdout.write(`wrote ${args.out}\n`);
    } else {
      process.stdout.write(`${artifact}\n`);
    }
    return exitCode;
  }

  const view = entityReport(profile, args.lang);
  if (isJsonMode()) {
    return report("entity", hasId, exitCode, { data: view });
  }

  section(`entity — the schema.org projection (${view.entity.type})`);
  line(
    `  @id:    ${
      view.entity.id ??
      "(absent — declare a link with role: identity; the engine never invents one)"
    }`,
  );
  line(`  name:   ${view.entity.name}`);
  line(`  email:  ${view.entity.email ?? "(not declared)"}`);
  line(`  sameAs: ${view.entity.sameAs.length} URL(s)`);
  for (const url of view.entity.sameAs) line(`    - ${url}`);
  line(`  gaps:   ${view.gaps.length}`);
  for (const gap of view.gaps) {
    line(`    ${gap.code} — ${gap.detail}`);
  }
  line(
    hasId
      ? "  jsonld: available — run `pasco entity --jsonld` for the paste-ready block"
      : "  jsonld: emitted without @id (the block is still valid; the anchor is the gap)",
  );
  line(
    `pasco entity: ${view.gaps.length} gap(s) — ${hasId ? "canonical @id present" : "no canonical @id"} — exit ${exitCode}`,
  );
  return exitCode;
}
