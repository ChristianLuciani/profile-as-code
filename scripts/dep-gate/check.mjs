#!/usr/bin/env node
/**
 * D20 dependency gate — SPEC §5 (issue #98).
 *
 * Enforces the `pasco serve` scope rule with the same shape CI already uses
 * for D3 (generated-Zod freshness): assert a structural property of the
 * workspace, fail on drift.
 *
 *   Rule A — the package at `packages/server` (the DIRECTORY is the subject,
 *     whatever its manifest name) may declare only the `core` package among
 *     its RUNTIME dependencies (`dependencies`, `peerDependencies`,
 *     `optionalDependencies`, `bundledDependencies`); `devDependencies` are
 *     not runtime.
 *   Rule B — nothing in `core`'s dependency graph may reach the server
 *     package, through any dependency class (all classes, transitively): the
 *     arrow is one-directional.
 *
 * The rule arms on the directory: if `packages/server/package.json` exists
 * but is not a workspace member of the current globs, or a `/server`-named
 * package lives elsewhere, the gate refuses (E-GATE) — a moved or renamed
 * server can never silently skip the rule. Renaming the server package AND
 * relocating it at once is outside the gate's vocabulary by design; that is
 * a reviewable, SPEC-gated decision (D20), not a routine commit.
 *
 * Range masquerade is refused at the seams (verified evasion channel): a
 * dependency key that names a workspace package must use the `workspace:`
 * protocol, and a `file:`/`link:`/`portal:` range resolving inside any
 * workspace package's directory is refused — both would deliver the real
 * server (or core) content through a foreign key while every name
 * comparison passes. Third-party `npm:` aliases stay legal on foreign keys.
 *
 * Zero dependencies, `node >=22` — like `scripts/schema-check`, it runs on a
 * fresh checkout before any install. Workspace packages are discovered from
 * `pnpm-workspace.yaml` (the same globs pnpm uses), never hardcoded. A yaml
 * shape or workspace structure the gate cannot verify is an explicit failure
 * (E-GATE), never a silent pass.
 */
import { realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const RUNTIME_CLASSES = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
];
const ALL_CLASSES = [...RUNTIME_CLASSES, "devDependencies"];

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
class GateError extends Error {}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse the `packages:` globs out of pnpm-workspace.yaml. Minimal subset
 * parser: top-level keys, block list items; anything else (inline flow
 * lists, quoted values, anchor extensions) is an explicit error.
 */
export function parseWorkspaceGlobs(source) {
  const globs = [];
  let inPackages = false;
  for (const rawLine of source.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (/^- /.test(line)) {
      if (!inPackages) continue;
      const globValue = line.slice(2).trim();
      if (globValue.includes('"')) {
        // Quoting is refused only where the gate parses (glob values) —
        // quotes elsewhere in the file belong to structures the gate does
        // not read.
        throw new GateError(`unsupported workspace glob quoting: ${globValue}`);
      }
      globs.push(validateGlob(globValue));
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (keyMatch) {
      if (inPackages && /^[ \t]/.test(rawLine)) {
        // pnpm's `packages` field is a flat list of globs; a nested key under
        // it is a shape the gate cannot verify — refusing beats misreading
        // (a silently switched section would drop workspace members from
        // discovery, a false-pass channel for Rule B).
        throw new GateError(
          `unsupported pnpm-workspace.yaml nested key inside 'packages': ${rawLine.trim()}`,
        );
      }
      if (inPackages && keyMatch[2].trim().length > 0) {
        throw new GateError(`unsupported pnpm-workspace.yaml value under a top-level key: ${line}`);
      }
      inPackages = keyMatch[1] === "packages";
      continue;
    }
    if (inPackages) {
      throw new GateError(`unsupported pnpm-workspace.yaml line: ${rawLine.trim()}`);
    }
  }
  if (globs.length === 0) {
    throw new GateError("pnpm-workspace.yaml declares no 'packages' globs");
  }
  return globs;
}

/** Globs handled: one segment at a time; '*' matches exactly one plain segment. */
function validateGlob(glob) {
  if (glob.includes("**") || /[?[\]{}!\\]/.test(glob)) {
    throw new GateError(`unsupported workspace glob (only single '*' segments): ${glob}`);
  }
  return glob.split("/").map((segment) => {
    if (segment === "*") return segment;
    if (segment.includes("*")) {
      throw new GateError(
        `unsupported workspace glob segment (partial '*' not supported): ${segment}`,
      );
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(segment) || segment === "." || segment === "..") {
      throw new GateError(`unsupported workspace glob segment: ${segment}`);
    }
    return segment;
  });
}

async function expandGlob(root, segments) {
  let current = [root];
  for (const segment of segments) {
    const next = [];
    for (const dir of current) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        // stat() follows symlinked directories — pnpm expands workspace globs
        // through them too, so a skipped symlink here would be a discovery
        // skew (a silent-pass channel).
        const isDir = await stat(path.join(dir, entry.name))
          .then((stats) => stats.isDirectory())
          .catch(() => false);
        if (!isDir) continue;
        if (segment === "*" || entry.name === segment) {
          next.push(path.join(dir, entry.name));
        }
      }
    }
    current = next;
  }
  const hit = [];
  for (const dir of current) {
    if (await exists(path.join(dir, "package.json"))) hit.push(dir);
  }
  return hit;
}

/** Dependency names declared under `depClass` (objects map name→range; arrays list names). */
function depNames(manifest, depClass) {
  const value = manifest[depClass];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : Object.keys(value);
}

async function collectWorkspace(root) {
  const workspaceFile = path.join(root, "pnpm-workspace.yaml");
  if (!(await exists(workspaceFile))) {
    throw new GateError(`no pnpm-workspace.yaml at ${path.resolve(root)}`);
  }
  const globs = parseWorkspaceGlobs(await readFile(workspaceFile, "utf8"));
  const entries = await Promise.all(globs.map((glob) => expandGlob(root, glob)));
  const dirs = [...new Set(entries.flat())].sort();
  const packages = new Map();
  for (const dir of dirs) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    } catch (error) {
      throw new GateError(`unreadable package.json at ${dir}: ${error.message}`);
    }
    const name = manifest.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new GateError(`package at ${dir} has no name`);
    }
    if (packages.has(name)) {
      throw new GateError(`duplicate workspace package name: ${name}`);
    }
    const relDir = path.relative(path.resolve(root), dir).split(path.sep).join("/");
    packages.set(name, { name, dir, relDir, manifest });
  }
  // Range resolution guard. Name-keyed rules (A and B) only see dependency
  // KEYS; a range that resolves to a workspace package through a foreign key
  // (file:/link:/portal: into the workspace) or that replaces a workspace
  // package through the registry (a non-workspace: range on a workspace-named
  // key) delivers real workspace content while every name comparison passes —
  // a verified evasion channel, refused at the seam.
  const workspaceNames = new Set(packages.keys());
  const workspaceAbsDirs = [...packages.values()].map((pkg) => path.resolve(pkg.dir));
  for (const pkg of packages.values()) {
    for (const depClass of ALL_CLASSES) {
      const value = pkg.manifest[depClass];
      // arrays (bundledDependencies) list bare names — ranges can only hide
      // in the mapped classes.
      if (value === undefined || value === null || Array.isArray(value)) continue;
      for (const [depName, range] of Object.entries(value)) {
        if (typeof range !== "string") continue;
        if (workspaceNames.has(depName)) {
          if (!range.startsWith("workspace:")) {
            throw new GateError(
              `dependency on workspace package '${depName}' in '${pkg.relDir}' under ` +
                `${depClass} declares range '${range}' — a workspace-named dependency must use ` +
                "the workspace: protocol; a registry or local range would deliver a different " +
                "package masquerading as the workspace one",
            );
          }
          continue;
        }
        const protocol = range.match(/^(file|link|portal):/);
        if (!protocol) continue;
        const target = path.resolve(pkg.dir, range.slice(protocol[0].length));
        const smuggledInto = workspaceAbsDirs.find(
          (workspaceDir) => target === workspaceDir || target.startsWith(workspaceDir + path.sep),
        );
        if (smuggledInto) {
          throw new GateError(
            `'${depName}: ${range}' in '${pkg.relDir}' under ${depClass} resolves inside a ` +
              "workspace package's directory — a local-path range aliasing workspace content " +
              "under a foreign key is an evasion channel (SPEC-gated decision required)",
          );
        }
      }
    }
  }
  return packages;
}

const pkgBaseName = (name) => name.split("/").pop();

/**
 * Identify `core` (exactly one workspace package named .../core) and the
 * server package — the rule's subject is the DIRECTORY `packages/server`,
 * whatever its manifest name (SPEC §5 D20, issue #98 acceptance). A
 * `/server`-named package living elsewhere is an explicit gate error so the
 * rule can never be silently skipped by a moved package.
 */
export function identify(packages) {
  const coreLike = [...packages.values()].filter(
    (candidate) => pkgBaseName(candidate.name) === "core",
  );
  if (coreLike.length !== 1) {
    throw new GateError(
      `expected exactly one workspace package named .../core, found: ` +
        (coreLike.map((candidate) => candidate.name).join(", ") || "none"),
    );
  }
  const serverLike = [...packages.values()].filter(
    (candidate) => pkgBaseName(candidate.name) === "server",
  );
  for (const candidate of serverLike) {
    if (candidate.relDir !== "packages/server") {
      throw new GateError(
        `package '${candidate.name}' ends in /server but lives at '${candidate.relDir}' — ` +
          "the D20 gate applies to 'packages/server' and refuses an unknown server location",
      );
    }
  }
  const server =
    [...packages.values()].find((candidate) => candidate.relDir === "packages/server") ?? null;
  return { core: coreLike[0], server };
}

/** Rule A: every runtime dependency declared by `packages/server` must be core. */
export function ruleA(core, server) {
  if (!server) {
    return {
      messages: [
        "Rule A: vacuous — no 'packages/server' in the workspace yet; the gate " +
          "arms itself the moment the package lands (SPEC §5 D20).",
      ],
      violations: [],
    };
  }
  const violations = [];
  for (const depClass of RUNTIME_CLASSES) {
    const value = server.manifest[depClass] ?? {};
    for (const [name, range] of Object.entries(
      Array.isArray(value) ? Object.fromEntries(value.map((n) => [n, "(bundled)"])) : value,
    )) {
      if (name !== core.name) {
        violations.push(
          `Rule A: 'packages/server' declares '${name}: ${range}' under ${depClass} — ` +
            `D20 allows only '${core.name}' among its runtime dependencies`,
        );
      }
    }
  }
  return { messages: [], violations };
}

/** Rule B: nothing in core's dependency graph (any class, transitively) may reach server. */
export function ruleB(workspace, core, server) {
  const serverName = server === null ? null : server.name;
  const hits = [];
  const visited = new Set([core.name]);
  const queue = [{ name: core.name, manifest: core.manifest, chain: [core.name] }];
  while (queue.length > 0) {
    const current = queue.shift();
    const edges = new Set();
    for (const depClass of ALL_CLASSES) {
      for (const depName of depNames(current.manifest, depClass)) {
        edges.add(depName);
      }
    }
    for (const depName of edges) {
      const chain = [...current.chain, depName];
      if (depName === serverName) {
        hits.push(chain);
        continue;
      }
      if (visited.has(depName)) continue;
      const next = workspace.get(depName);
      if (!next) continue;
      visited.add(depName);
      queue.push({ name: depName, manifest: next.manifest, chain });
    }
  }
  const violations = hits.map(
    (chain) =>
      `Rule B: '${chain.join("' -> '")}' — nothing in core's dependency graph ` +
      "may reach 'packages/server'",
  );
  return { messages: [], violations };
}

/**
 * Run the gate against a workspace root. Returns `{ status, messages }`;
 * `status` is "pass" or "fail" — the verdict the self-test asserts on.
 */
export async function check(root) {
  const context = [`D20 gate — workspace: ${path.resolve(root)}`];
  try {
    const packages = await collectWorkspace(root);
    context.push(`workspace packages: ${[...packages.keys()].join(", ")}`);
    const { core, server } = identify(packages);
    if (server === null && (await exists(path.join(root, "packages", "server", "package.json")))) {
      throw new GateError(
        "'packages/server/package.json' exists on disk but is not a member of the " +
          "current workspace globs — the D20 gate refuses a server location it cannot verify",
      );
    }
    const a = ruleA(core, server);
    const b = ruleB(packages, core, server);
    const violations = [...a.violations, ...b.violations];
    if (violations.length > 0) {
      return {
        status: "fail",
        messages: [...context, ...a.messages, ...b.messages, ...violations],
      };
    }
    return { status: "pass", messages: [...context, ...a.messages, ...b.messages] };
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
  console.log(`D20 gate: ${result.status.toUpperCase()}`);
  process.exit(result.status === "pass" ? 0 : 1);
}

/**
 * Direct-execution guard. `import.meta.url` is the REALPATH of this module;
 * `process.argv[1]` is whatever path invoked it — on a machine where the
 * invocation path crosses a symlink (/tmp is one on macOS), comparing the
 * two as-is never matches and the CLI silently no-ops (no output, exit 0 —
 * a fail-open). Realpath the invocation path before comparing.
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
