#!/usr/bin/env node
/**
 * gen-zod.ts — regenerate `src/generated/schema.zod.ts` from `schema/profile.schema.json`.
 *
 * Contract source (D3): the JSON Schema in `schema/` is the single source of truth.
 * Zod is GENERATED from it and committed — never hand-written in parallel.
 *
 * Run (from packages/core):  pnpm gen:zod
 *
 * Why this script does more than a bare json-schema-to-zod call:
 *  - zod 4 is installed (dependabot bump): `zodVersion: 4` so records emit
 *    `z.record(z.string(), …)` — zod 4 dropped the 1-arg form (build regression
 *    when the zod bump landed without regenerating).
 *  - `json-schema-to-zod@2.8.1` does NOT resolve `$defs`/`$ref` (it emits `z.any()`
 *    for them), so we inline `#/$defs/*` references first.
 *  - It ignores `propertyNames`, so the langMap key restriction (en/es/fr only) and
 *    the required `en` key would be lost. We materialize `en` as a real property
 *    (keeps `required: ['en']` → `z.object({en}).catchall(...)`) and wrap every
 *    langMap occurrence with a `langMapKeys` superRefine that enforces the key enum.
 *  - It renders `oneOf` of disjoint primitives as a bloated `z.any().superRefine(...)`;
 *    for our only such node (`check.value`) `anyOf` is semantically equivalent and
 *    generates a clean `z.union([...])`, so we rewrite `oneOf` → `anyOf` when it is
 *    the sole keyword.
 *
 * The script fails loudly (non-zero exit) if any safety assertion fails, so a schema
 * change that breaks generation is caught in CI, not silently.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchemaToZod } from "json-schema-to-zod";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const SCHEMA_PATH = resolve(REPO_ROOT, "schema/profile.schema.json");
const OUT_DIR = resolve(HERE, "../src/generated");
const OUT_PATH = resolve(OUT_DIR, "schema.zod.ts");

type JsonNode = Record<string, unknown>;

/** Deep clone (defs are reused across refs; we must not mutate shared bodies). */
function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Recursively resolve `$ref: "#/$defs/<name>"` by inlining a clone of the def.
 * Fails on unknown defs or circular references (the schema has none, by contract).
 */
function inlineDefs(
  node: unknown,
  defs: Record<string, unknown>,
  seen: Set<string> = new Set(),
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => inlineDefs(item, defs, seen));
  }
  if (node !== null && typeof node === "object") {
    const obj = node as JsonNode;
    if (typeof obj.$ref === "string") {
      const match = /^#\/\$defs\/(.+)$/.exec(obj.$ref);
      if (!match)
        throw new Error(`gen-zod: unsupported $ref "${obj.$ref}" (only #/$defs/<name> is allowed)`);
      const name = match[1] as string;
      if (!(name in defs))
        throw new Error(`gen-zod: unknown $def "${name}" referenced by ${obj.$ref}`);
      if (seen.has(name))
        throw new Error(`gen-zod: circular $def "${name}" — inlining is not safe`);
      seen.add(name);
      const resolved = inlineDefs(clone(defs[name]), defs, seen);
      seen.delete(name);
      return resolved;
    }
    // `oneOf` of required-only alternatives ({ required: [..] } with no other
    // keyword) — a JSON Schema XOR over sibling properties. zod cannot express
    // "required without property" (renders z.any(), caught by the safety net
    // below), so the oneOf is dropped for the Zod shape and the XOR is re-checked
    // by core post-Zod (same fail-class precedent as the ledger's dropped
    // propertyNames: D12). The JSON Schema itself keeps the oneOf.
    if (
      "oneOf" in obj &&
      Array.isArray(obj.oneOf) &&
      (obj.oneOf as JsonNode[]).every(
        (alt) =>
          typeof alt === "object" &&
          alt !== null &&
          Object.keys(alt).length > 0 &&
          Object.keys(alt).every((k) => k === "required"),
      )
    ) {
      const { oneOf, ...rest } = obj;
      void oneOf;
      droppedRequiredOnlyOneOf += 1; // never silent — surfaced in the summary line. NOTE: counted per VISIT — the same def body is walked once directly in $defs and once per ref-site inlining, so the count can exceed the number of distinct oneOfs.
      return inlineDefs(rest, defs, seen);
    }
    // `oneOf` with no sibling keywords → `anyOf` (identical semantics for disjoint
    // primitive types; json-schema-to-zod emits a clean z.union for anyOf).
    if ("oneOf" in obj && !("anyOf" in obj) && Object.keys(obj).length === 1) {
      return inlineDefs({ anyOf: obj.oneOf }, defs, seen);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = inlineDefs(value, defs, seen);
    }
    return out;
  }
  return node;
}

/**
 * Shape for a langMap node that json-schema-to-zod renders as
 * `z.object({ "en": z.string() }).catchall(z.string())` — the `en` key then stays
 * REQUIRED (contract §11) and extra keys are strings. The key enum (en/es/fr) is
 * re-attached by the `langMapKeys` wrapper during post-processing.
 */
function toLangMapShape(): JsonNode {
  return {
    type: "object",
    properties: { en: { type: "string" } },
    required: ["en"],
    additionalProperties: { type: "string" },
  };
}

/** Same idea for langMapList (v1.1): values are string arrays instead of strings. */
function toLangMapListShape(): JsonNode {
  return {
    type: "object",
    properties: { en: { type: "array", items: { type: "string" } } },
    required: ["en"],
    additionalProperties: { type: "array", items: { type: "string" } },
  };
}

// ---------------------------------------------------------------------------

const raw = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as JsonNode & {
  $defs?: Record<string, unknown>;
};

const defs = raw.$defs ?? {};
if (!defs.langMap) throw new Error("gen-zod: $defs.langMap missing from schema");
defs.langMap = toLangMapShape();
if (!defs.langMapList) throw new Error("gen-zod: $defs.langMapList missing from schema (v1.1)");
defs.langMapList = toLangMapListShape();

// The platform list is codegen-owned as a VALUE too (issue #152): the generated
// module exports the ids as a const tuple so `types.ts` derives `Platform` /
// `PLATFORMS` from it instead of mirroring the enum by hand. It is read from the
// SAME `$defs.platform` the Zod enum is generated from — the JSON Schema stays
// the single hand-authored home; every other list is generated or derived.
const platformDef = defs.platform as JsonNode | undefined;
if (!platformDef || !Array.isArray(platformDef.enum) || platformDef.enum.length === 0) {
  throw new Error("gen-zod: $defs.platform.enum missing (or empty) from schema");
}
const platformValues = (platformDef.enum as unknown[]).map((value) => {
  if (typeof value !== "string") {
    throw new Error(
      `gen-zod: $defs.platform.enum has a non-string entry: ${JSON.stringify(value)}`,
    );
  }
  return value;
});

let droppedRequiredOnlyOneOf = 0;
const inlined = inlineDefs(raw, defs) as JsonNode;
const generated = jsonSchemaToZod(inlined, { module: "esm", name: "profileSchema", zodVersion: 4 });

// Safety nets — a schema change that silently breaks generation must fail CI.
if (generated.includes("z.any()")) {
  throw new Error(
    "gen-zod: generated output contains z.any() — a $ref or keyword was not resolved",
  );
}

const LANG_MAP_EXPR = 'z.object({ "en": z.string() }).catchall(z.string())';
const langMapCount = generated.split(LANG_MAP_EXPR).length - 1;
if (langMapCount === 0) {
  throw new Error(
    `gen-zod: no langMap expression found — expected at least one "${LANG_MAP_EXPR}"`,
  );
}
const LANG_MAP_LIST_EXPR = 'z.object({ "en": z.array(z.string()) }).catchall(z.array(z.string()))';
const langMapListCount = generated.split(LANG_MAP_LIST_EXPR).length - 1;
if (langMapListCount === 0) {
  throw new Error(
    `gen-zod: no langMapList expression found — expected at least one "${LANG_MAP_LIST_EXPR}" (v1.1)`,
  );
}
const withKeyGuard = generated
  .split(LANG_MAP_EXPR)
  .join(`langMapKeys(${LANG_MAP_EXPR})`)
  .split(LANG_MAP_LIST_EXPR)
  .join(`langMapKeys(${LANG_MAP_LIST_EXPR})`);

const FOOTER = `
/* ---------------------------------------------------------------------------
 * Generated helper — contract fidelity (D3).
 * JSON Schema \`propertyNames: { enum: [en, es, fr] }\` has no Zod equivalent, so
 * every langMap occurrence is wrapped with a superRefine enforcing the key enum.
 * ------------------------------------------------------------------------- */
const LANG_KEYS = ['en', 'es', 'fr'] as const;

function langMapKeys<S extends z.ZodTypeAny>(schema: S) {
  return schema.superRefine((value, ctx) => {
    if (typeof value !== 'object' || value === null) return;
    for (const key of Object.keys(value)) {
      if (!(LANG_KEYS as readonly string[]).includes(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: \`unsupported language key '\${key}' (allowed: en, es, fr)\`,
        });
      }
    }
  });
}
`;

const BANNER = `/**
 * AUTO-GENERATED from schema/profile.schema.json — DO NOT EDIT BY HAND.
 * Contract source (D3): JSON Schema 2020-12 -> Zod.
 * Regenerate with: pnpm gen:zod (packages/core/scripts/gen-zod.ts).
 */

`;

/** Platform ids as a value (issue #152): `types.ts` derives `Platform`/`PLATFORMS`
 *  from this const, so the enum has exactly one hand-authored home (the schema). */
const PLATFORM_VALUES_BLOCK = `
/** Platform ids in schema order — generated from \`$defs.platform.enum\` (D3/D16). */
export const PLATFORM_VALUES = [${platformValues.map((value) => JSON.stringify(value)).join(", ")}] as const;
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, `${BANNER}${withKeyGuard}${PLATFORM_VALUES_BLOCK}${FOOTER}`, "utf8");
console.log(
  `gen-zod: wrote ${OUT_PATH} (${langMapCount} langMap key-guards applied, ` +
    `${platformValues.length} platform values exported)` +
    (droppedRequiredOnlyOneOf > 0
      ? ` — ${droppedRequiredOnlyOneOf} required-only oneOf occurrence(s) dropped from Zod (the XOR must be re-checked in core post-Zod — D12 fail class; the JSON Schema keeps it)`
      : ""),
);
