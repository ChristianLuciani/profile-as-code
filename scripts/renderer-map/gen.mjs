#!/usr/bin/env node
/**
 * renderer-map gate — the platform↔renderer association has ONE data home (#165).
 *
 * Before this gate the association lived only as the hand-maintained `RENDERERS`
 * map in `packages/cli/src/commands/build.ts`: eight static imports plus one line
 * per platform, forever, with nothing to cross-check them against. The data home
 * is now the `pasco` block of each renderer's own `package.json` — the field sits
 * next to the code it describes and is greppable in review (ADR-lite of #165,
 * route (a), ratified by the operator 2026-10-07):
 *
 *   "pasco": { "platform": "kofi", "deploySpec": "manual" }
 *
 *   * `platform`    — the SPEC §7 renderer id; must be in the schema enum
 *                     (`$defs.platform.enum`, the contract), and one-to-one.
 *   * `deploySpec`  — SPEC §7 union (`git` | `api` | `manual`).
 *   * `assets: true`— the renderer consumes the media bundle (`opts.assets`,
 *                     M8/§18.6); the generator emits the matching call shape.
 *
 * This script PROJECTS that field into the CLI's compiled map
 * (`packages/cli/src/generated/renderers.gen.ts`, committed), and refuses —
 * never skips — the failure classes the issue names:
 *
 *   E-GATE  a directory under `packages/renderers/` without a `pasco.platform`
 *           ("a renderer without a resolvable platform fails loudly in build/CI,
 *           never silently skipped");
 *   E-GATE  a platform outside the schema enum, or declared by two renderers;
 *   E-GATE  a renderer that is not a workspace member, or a workspace member
 *           OUTSIDE the renderer layout declaring `pasco.platform` (a moved
 *           renderer must not fall out of the projection while it is still a
 *           workspace member — the D20 precedent, `scripts/dep-gate/check.mjs`,
 *           refuses the same shape; a directory moved outside the workspace
 *           globs leaves this gate's subject, and the CLI's static import stops
 *           resolving, which the build catches);
 *   E-GATE  a renderer the CLI does not depend on (the generated static import
 *           would not resolve on a fresh install);
 *   --check stale projection (a manifest edited without `pnpm gen:renderers`).
 *
 * The workspace-glob parser is REUSED, not re-implemented: it is exported by
 * `scripts/dep-gate/check.mjs` and self-tested there (`test.mjs`). Zero
 * dependencies, node >=22 — like `scripts/schema-check` and the D20 gate it runs
 * on a fresh checkout before any install. A shape this script cannot verify is
 * an explicit failure, never a silent pass.
 *
 * Usage:  node scripts/renderer-map/gen.mjs [--root DIR] [--check]
 *         pnpm gen:renderers            # write the projection
 * Exit:   0 written/in sync · 1 E-GATE refusal (reason on stdout)
 */
import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expandGlob, parseWorkspaceGlobs } from "../dep-gate/check.mjs";

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
class GateError extends Error {}

const OUT_REL = path.join("packages", "cli", "src", "generated", "renderers.gen.ts");
const RENDERERS_REL = path.join("packages", "renderers");
const CLI_MANIFEST_REL = path.join("packages", "cli", "package.json");
const SCHEMA_REL = path.join("schema", "profile.schema.json");
const WORKSPACE_REL = "pnpm-workspace.yaml";
/**
 * SPEC §7 `deploySpec: 'git' | 'api' | 'manual'` (manual → playbook + checks).
 *
 * ADR-lite (#176): SPEC §7 prose IS the home of this union — this constant
 * mirrors it and is not a second source of truth. A fourth value means editing
 * SPEC §7 *and* this constant; the schema is deliberately not the home, because
 * it models workspace data, not `package.json` metadata. The gate that catches a
 * renderer module disagreeing with its manifest is the module↔manifest parity
 * test (`packages/cli/tests/renderer-map.test.ts`); an out-of-union value is
 * refused here by the check above. */
const DEPLOY_SPECS = ["git", "api", "manual"];
/** D23 (issue #262): the `surface.kind` axis. A renderer may DECLARE the kind it
 *  emits (`pasco.surface`); gen-platforms refuses a disagreement with the
 *  registry, so a repo-metadata emitter can never masquerade as kind: profile. */
export const SURFACE_KINDS = ["profile", "repo-meta", "distribution"];

const rel = (root, target) => path.relative(root, target) || ".";

async function isFile(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

async function readJson(target, what) {
  let source;
  try {
    source = await readFile(target, "utf8");
  } catch (error) {
    throw new GateError(`cannot read ${what} (${target}): ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new GateError(`${what} is not valid JSON (${target}): ${error.message}`);
  }
}

/** `$defs.platform.enum` — the hand-authored contract (D3/D16), never re-listed. */
async function schemaPlatforms(root) {
  const schema = await readJson(path.join(root, SCHEMA_REL), "the profile schema");
  const values = schema?.$defs?.platform?.enum;
  if (!Array.isArray(values) || values.length === 0 || values.some((v) => typeof v !== "string")) {
    throw new GateError(
      `${SCHEMA_REL}: $defs.platform.enum is not a non-empty string array — the platform contract is unreadable`,
    );
  }
  return values;
}

/** Expand the `packages:` globs — dep-gate's walk, reused (never a second
 *  walker: two implementations that disagree on dotfile or symlink semantics
 *  would silently drop a package from one gate and not the other). */
async function expandGlobs(root, globs) {
  const found = new Set();
  for (const segments of globs) {
    for (const dir of await expandGlob(root, segments)) found.add(dir);
  }
  return [...found].sort();
}

/** Direct children of `packages/renderers/` that carry a manifest.
 *
 *  A symlinked directory is followed via `stat`, the way `expandGlob` (dep-gate)
 *  reads the workspace globs. The two reads must agree: rule 1 refuses a renderer
 *  directory that is not a workspace member, so a symlink skipped here but
 *  matched there would be neither projected nor refused — a silent-pass channel
 *  (review NIT on #165, deferred to #176). */
async function rendererDirs(root) {
  const renderersRoot = path.join(root, RENDERERS_REL);
  let entries;
  try {
    entries = await readdir(renderersRoot, { withFileTypes: true });
  } catch (error) {
    throw new GateError(`cannot read ${RENDERERS_REL}/ (${error.message})`);
  }
  const dirs = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const dir = path.join(renderersRoot, entry.name);
    const isDir = await stat(dir)
      .then((stats) => stats.isDirectory())
      .catch(() => false);
    if (!isDir) continue;
    if (await isFile(path.join(dir, "package.json"))) dirs.push(dir);
  }
  return dirs.sort();
}

/**
 * Resolve the renderer set from the manifests. Returns entries sorted by
 * platform: `{ platform, deploySpec, assets, name, where }`.
 */
export async function collectRenderers(root) {
  const platforms = await schemaPlatforms(root);
  const workspaceSource = await readFile(path.join(root, WORKSPACE_REL), "utf8").catch((error) => {
    throw new GateError(`cannot read ${WORKSPACE_REL}: ${error.message}`);
  });
  let globs;
  try {
    globs = parseWorkspaceGlobs(workspaceSource);
  } catch (error) {
    // The parser is dep-gate's (reused, self-tested there): by its contract any
    // throw is a shape it refuses to read — never a silent pass. Translate the
    // error class so this gate's refusals stay one vocabulary (E-GATE).
    throw new GateError(`${WORKSPACE_REL}: ${error.message}`);
  }
  const members = await expandGlobs(root, globs);
  const renderersRoot = path.join(root, RENDERERS_REL);

  // Rule 1 — the layout is the subject (D20 precedent): every directory with a
  // manifest under packages/renderers/ is a renderer, whether or not it is a
  // workspace member, and it must declare its platform.
  for (const dir of await rendererDirs(root)) {
    if (!members.includes(dir)) {
      throw new GateError(
        `${rel(root, dir)} is not a workspace member (${WORKSPACE_REL} globs) — the projection cannot reach it`,
      );
    }
  }
  // Rule 2 — a renderer relocated outside the layout must not slip past the
  // projection: the declaration is the registration, wherever it lives.
  const subjects = [];
  for (const dir of members) {
    const inside = dir === renderersRoot || dir.startsWith(`${renderersRoot}${path.sep}`);
    if (inside) {
      subjects.push(dir);
      continue;
    }
    const manifest = await readJson(path.join(dir, "package.json"), "a workspace manifest");
    if (manifest?.pasco?.platform !== undefined) {
      throw new GateError(
        `${rel(root, dir)} declares pasco.platform outside ${RENDERERS_REL}/ — move the renderer into the layout`,
      );
    }
  }
  if (subjects.length === 0) {
    throw new GateError(`no renderer packages found under ${RENDERERS_REL}/`);
  }

  const entries = [];
  const byPlatform = new Map();
  for (const dir of subjects) {
    const where = rel(root, dir);
    const manifest = await readJson(path.join(dir, "package.json"), `${where}/package.json`);
    if (typeof manifest?.name !== "string" || manifest.name.length === 0) {
      throw new GateError(`${where}/package.json declares no package name`);
    }
    const pasco = manifest.pasco;
    if (pasco === undefined || pasco === null || typeof pasco !== "object") {
      throw new GateError(
        `${where} declares no "pasco" block — a renderer without a resolvable platform fails loudly, it is never skipped`,
      );
    }
    if (typeof pasco.platform !== "string" || pasco.platform.length === 0) {
      throw new GateError(`${where}: pasco.platform must be a non-empty string`);
    }
    if (!platforms.includes(pasco.platform)) {
      throw new GateError(
        `${where}: pasco.platform "${pasco.platform}" is not in ${SCHEMA_REL} $defs.platform.enum (the contract)`,
      );
    }
    if (byPlatform.has(pasco.platform)) {
      throw new GateError(
        `platform "${pasco.platform}" is declared by ${where} and ${byPlatform.get(pasco.platform)} — the association must be one-to-one`,
      );
    }
    byPlatform.set(pasco.platform, where);
    if (typeof pasco.deploySpec !== "string" || !DEPLOY_SPECS.includes(pasco.deploySpec)) {
      throw new GateError(
        `${where}: pasco.deploySpec must be one of ${DEPLOY_SPECS.join(" | ")} (SPEC §7)`,
      );
    }
    if (pasco.assets !== undefined && typeof pasco.assets !== "boolean") {
      throw new GateError(`${where}: pasco.assets must be a boolean when present`);
    }
    if (pasco.surface !== undefined && !SURFACE_KINDS.includes(pasco.surface)) {
      throw new GateError(
        `${where}: pasco.surface must be one of ${SURFACE_KINDS.join(" | ")} when present (D23)`,
      );
    }
    entries.push({
      platform: pasco.platform,
      deploySpec: pasco.deploySpec,
      // Absent = `profile`: the pre-D23 manifests keep their meaning.
      surface: pasco.surface ?? "profile",
      assets: pasco.assets === true,
      name: manifest.name,
      where,
    });
  }

  // The projection emits static imports: the CLI must declare each package, or
  // the generated module would not resolve on a fresh install.
  const cli = await readJson(path.join(root, CLI_MANIFEST_REL), "the CLI manifest");
  const declared = new Set([
    ...Object.keys(cli?.dependencies ?? {}),
    ...Object.keys(cli?.devDependencies ?? {}),
  ]);
  for (const entry of entries) {
    if (!declared.has(entry.name)) {
      throw new GateError(
        `${CLI_MANIFEST_REL} does not declare ${entry.name} — the generated import would not resolve`,
      );
    }
  }

  // The projection names each import after its platform (`render<Pascal>`):
  // two platforms whose Pascal forms collide (`github-readme` vs `githubreadme`)
  // would emit the same binding twice — a broken generated module that only
  // `tsc`/`tsup` would report, far from here. Refuse it at the source.
  const byIdentifier = new Map();
  for (const entry of entries) {
    const alias = `render${pascal(entry.platform)}`;
    if (byIdentifier.has(alias)) {
      throw new GateError(
        `platforms "${byIdentifier.get(alias)}" and "${entry.platform}" both project to the import ${alias} — rename one`,
      );
    }
    byIdentifier.set(alias, entry.platform);
  }

  entries.sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0));
  return entries;
}

/** `github-readme` → `GithubReadme` — deterministic; collisions refused above. */
function pascal(platform) {
  return platform
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

const identifier = (value) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
const key = (value) => (identifier(value) ? value : JSON.stringify(value));

/**
 * The projection. Deterministic: entries sorted by platform, one static import
 * per package (the only place the CLI names a renderer module), and the call
 * shape derived from `pasco.assets` — a new renderer changes this file only
 * through its own manifest.
 */
export function renderModule(entries) {
  const imports = entries
    .map((e) => `import { render as render${pascal(e.platform)} } from "${e.name}";`)
    .join("\n");
  const table = entries
    .map((e) =>
      e.assets
        ? `  ${key(e.platform)}: (slice, assets) => render${pascal(e.platform)}(slice, { assets }),`
        : `  ${key(e.platform)}: (slice) => render${pascal(e.platform)}(slice),`,
    )
    .join("\n");
  const deploySpecs = entries
    .map((e) => `  ${key(e.platform)}: ${JSON.stringify(e.deploySpec)},`)
    .join("\n");
  return `/**
 * GENERATED by scripts/renderer-map/gen.mjs — DO NOT EDIT BY HAND (#165).
 *
 * The platform↔renderer association has exactly one data home: the \`pasco\`
 * block of each renderer's package.json. Run \`pnpm gen:renderers\` after
 * changing one; CI asserts this file is in sync with the manifests, that every
 * declared platform is in the schema enum, and that the renderers' own
 * \`deploySpec\` export agrees (\`packages/cli/tests/renderer-map.test.ts\`).
 * The static imports below are the ONLY place the workspace modules are named.
 */
import type { MediaAsset, PlatformProfile } from "@profile-as-code/core";
${imports}

export type RendererFn = (
  slice: PlatformProfile,
  assets: readonly MediaAsset[],
) => { text: string; assets?: string[] };

/** SPEC §7 \`deploySpec\` — projected from \`pasco.deploySpec\` (the data home). */
export type DeploySpec = ${DEPLOY_SPECS.map((d) => JSON.stringify(d)).join(" | ")};

/** platform → renderer. An absent platform simply has no renderer (M4). */
export const RENDERERS: Partial<Record<string, RendererFn>> = {
${table}
};

/** SPEC §7 \`deploySpec\`, projected from the same data home. This is the
 *  DECLARED-CONTRACT view — \`build.ts\` does not read it (the deploy spec is a
 *  property of the renderer, not of a build step); it exists so a consumer or
 *  gate can read the declared contract without importing every adapter, and
 *  \`tests/renderer-map.test.ts\` asserts it against each module's own export. */
export const RENDERER_DEPLOY_SPECS: Partial<Record<string, DeploySpec>> = {
${deploySpecs}
};
`;
}

/** First divergence between the committed projection and the manifests'. */
function firstDifference(committed, generated) {
  const a = committed.split("\n");
  const b = generated.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}: committed ${JSON.stringify(a[i] ?? "<eof>")} vs manifests ${JSON.stringify(b[i] ?? "<eof>")}`;
    }
  }
  return "no line differs";
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const rootIndex = argv.indexOf("--root");
  const root =
    rootIndex === -1
      ? fileURLToPath(new URL("../../", import.meta.url))
      : path.resolve(argv[rootIndex + 1] ?? "");
  const out = path.join(root, OUT_REL);
  try {
    const entries = await collectRenderers(root);
    const generated = renderModule(entries);
    if (check) {
      const committed = await readFile(out, "utf8").catch(() => null);
      if (committed !== generated) {
        console.log(
          `E-GATE: ${rel(root, out)} is stale against the manifests — run \`pnpm gen:renderers\` ` +
            `(${committed === null ? "missing file" : firstDifference(committed, generated)})`,
        );
        console.log("renderer map: FAIL");
        process.exit(1);
      }
      console.log(`renderer map: in sync (${entries.length} renderer(s) from their manifests)`);
      return;
    }
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, generated);
    console.log(`renderer map: wrote ${rel(root, out)} (${entries.length} renderer(s))`);
  } catch (error) {
    if (error instanceof GateError) {
      console.log(`E-GATE: ${error.message}`);
      console.log("renderer map: FAIL");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Direct-execution guard (the dep-gate idiom): `import.meta.url` is the REALPATH
 * of this module while `process.argv[1]` is whatever path invoked it — on a
 * machine where the invocation crosses a symlink (/tmp is one on macOS) the two
 * never match as-is and the CLI silently no-ops (a fail-open).
 */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // unresolvable path — compare as-is rather than fail closed on a probe
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isMain()) {
  await main();
}
