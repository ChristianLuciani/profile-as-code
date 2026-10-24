#!/usr/bin/env node
import { realpathSync } from "node:fs";
/**
 * Publishable-surface gate — issue #190.
 *
 * #189 marked the 11 bundle-only workspace packages `"private": true`, leaving
 * `@profile-as-code/cli` as the only publishable manifest. That invariant is
 * convention-only: npm's `libnpmpublish` throws `EPRIVATE` on a private
 * manifest and `pnpm -r publish` skips private packages, so today's surface is
 * safe — but a NEW workspace package (e.g. the planned `packages/server`, D20)
 * could be added without `private: true` and silently rejoin the
 * accidental-publish surface with every gate green. This gate makes the
 * convention mechanical, the same way `scripts/typecheck-gate` (#181) closed
 * the analogous "declared invariant without a gate" class.
 *
 * The rule (one direction, exactly the invariant #189 established):
 *
 *   every workspace manifest OUTSIDE the publishable allowlist declares
 *   `"private": true`.
 *
 * `DEFAULT_PUBLISHABLE` is the explicit allowlist of directories allowed to omit it —
 * today only the CLI. Adding a future intentional publisher is a reviewed
 * one-line edit here, never an accident. The allowlist is keyed by
 * workspace-relative DIRECTORY, not by manifest name (the D20/dep-gate
 * precedent: the directory is the subject, so a renamed package cannot dodge
 * the rule by wearing a different name).
 *
 * The gate VERIFIES, it never fixes: it does not touch `pnpm-workspace.yaml`
 * nor set `private` on any manifest.
 *
 * Zero dependencies, `node >=22` — like `scripts/schema-check` and the D20
 * gate it runs on a fresh checkout before any install, so a new package fails
 * CI before `pnpm install` even runs. The workspace walk is the dep-gate's
 * canonical one (`parseWorkspaceGlobs` + `expandGlob`, imported, never
 * re-implemented): two walkers that disagree on dotfile/symlink semantics
 * silently drop a package from one gate and not the other (the #165 F3
 * lesson). A workspace shape the gate cannot verify is an explicit failure
 * (E-GATE), never a silent pass.
 *
 * Scope: the subject is a WORKSPACE MEMBER — a directory matched by a
 * `pnpm-workspace.yaml` glob. A manifest sitting OUTSIDE the globs is not
 * reachable by `pnpm -r publish` and is deliberately out of scope here:
 * dep-gate refuses a non-member `packages/server` because its rule ARMS on that
 * fixed directory, while this gate has no fixed subject directory and checks
 * exactly the surface pnpm publishes — no more (fresh-context F2, #195).
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expandGlob, parseWorkspaceGlobs } from "../dep-gate/check.mjs";

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
class GateError extends Error {}

/**
 * The publishable surface: workspace-relative directories whose manifest is
 * ALLOWED to omit `"private": true`. It is the only place the publishable
 * surface is declared; a future intentional publisher is added here in a
 * reviewed diff (issue #190). Directory-keyed on purpose — the subject is the
 * location, not the manifest name (the D20 precedent).
 *
 * The five seam packages joined 2026-10-24 (#259 — decision recorded
 * 2026-10-21: the seam of contribution is published); the cli was the
 * allowlist's first (and, until that decision, only) member. Order of the
 * publish (core first) and the multi-package mechanism live in #301.
 */
const DEFAULT_PUBLISHABLE = [
  "packages/cli",
  "packages/core",
  "packages/markdown",
  "packages/paste",
  "packages/artifact",
  "packages/github",
];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Discover workspace package dirs via the dep-gate's canonical walker. */
async function workspaceDirs(root) {
  const workspaceFile = path.join(root, "pnpm-workspace.yaml");
  if (!(await exists(workspaceFile))) {
    throw new GateError(`no pnpm-workspace.yaml at ${path.resolve(root)}`);
  }
  let globs;
  try {
    globs = parseWorkspaceGlobs(await readFile(workspaceFile, "utf8"));
  } catch (error) {
    // The parser is dep-gate's (reused, self-tested there): by its contract
    // any throw is a shape it refuses to read. Translate the error class so
    // this gate's refusals stay one vocabulary (E-GATE).
    throw new GateError(`pnpm-workspace.yaml: ${error.message}`);
  }
  const entries = await Promise.all(globs.map((glob) => expandGlob(root, glob)));
  const dirs = [...new Set(entries.flat())].sort();
  if (dirs.length === 0) {
    throw new GateError(
      "the workspace globs match no package with a package.json — a gate that " +
        "checks nothing must not pass (wrong globs are a silent-pass channel)",
    );
  }
  return dirs;
}

async function readManifest(dir) {
  const manifestPath = path.join(dir, "package.json");
  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new GateError(`unreadable ${manifestPath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GateError(`unparseable ${manifestPath}: ${error.message}`);
  }
}

/** Render an observed `private` value for the violation message (`undefined` → "absent"). */
function describe(value) {
  return value === undefined ? "absent" : JSON.stringify(value);
}

/**
 * Run the gate against a workspace root. Returns `{ status, messages }` — the
 * verdict the self-test asserts on. `options.publishable` overrides the
 * allowlist (an array of workspace-relative dirs); the CLI never passes it —
 * it is the seam the self-test uses to prove the allowlist is what exempts a
 * publisher, not a hardcoded path.
 */
export async function check(root, options = {}) {
  const publishable = new Set(options.publishable ?? DEFAULT_PUBLISHABLE);
  const context = [`publishable gate — workspace: ${path.resolve(root)}`];
  try {
    const dirs = await workspaceDirs(root);
    context.push(`workspace packages: ${dirs.length}`);
    context.push(`publishable allowlist: ${[...publishable].sort().join(", ") || "(none)"}`);
    const violations = [];
    for (const dir of dirs) {
      const relDir = path.relative(path.resolve(root), dir).split(path.sep).join("/");
      const manifest = await readManifest(dir);
      if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
        // A manifest that PARSES as JSON but is not an object (`null`, an array,
        // a bare string/number) has no `name`/`private` to read — refuse it with
        // the gate's own E-GATE vocabulary instead of crashing on a property
        // access (fresh-context reconcile NIT on #195, hardened here).
        throw new GateError(
          `'${relDir}/package.json' is not a JSON object (found: ${describe(manifest)}) — ` +
            "the gate cannot read a manifest of this shape",
        );
      }
      const name =
        typeof manifest.name === "string" && manifest.name.length > 0 ? manifest.name : null;
      if (name === null) {
        throw new GateError(`package at ${relDir} has no name — the gate cannot report it`);
      }
      if (publishable.has(relDir)) continue;
      if (manifest.private !== true) {
        violations.push(
          `'${relDir}' (${name}) does not declare "private": true ` +
            `(found: ${describe(manifest.private)}) — a workspace manifest outside the ` +
            "publishable allowlist would silently join the accidental-publish surface (#190)",
        );
      }
    }
    if (violations.length > 0) {
      return { status: "fail", messages: [...context, ...violations] };
    }
    return {
      status: "pass",
      messages: [
        ...context,
        'every workspace manifest outside the publishable allowlist declares "private": true',
      ],
    };
  } catch (error) {
    if (error instanceof GateError) {
      return { status: "fail", messages: [...context, `E-GATE: ${error.message}`] };
    }
    throw error;
  }
}

async function main() {
  const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
  const root = process.argv[2] ?? defaultRoot;
  const result = await check(root);
  for (const message of result.messages) console.log(message);
  console.log(`publishable gate: ${result.status.toUpperCase()}`);
  process.exit(result.status === "pass" ? 0 : 1);
}

/**
 * Direct-execution guard. `import.meta.url` is the REALPATH of this module
 * while `process.argv[1]` is whatever path invoked it — on a machine where the
 * invocation path crosses a symlink (/tmp on macOS), comparing them as-is
 * never matches and the CLI silently no-ops (no output, exit 0 — a fail-open;
 * the dep-gate premerge F2 repro). Realpath the invocation path first.
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
