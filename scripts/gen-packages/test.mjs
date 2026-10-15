#!/usr/bin/env node
/**
 * Self-test for the gen-packages gate (#226) — the `scripts/gen-platforms`
 * idiom: prove the gate REFUSES every failure class it claims to close, and that
 * a consistent tree passes. A gate whose tests cannot fail with the defect
 * present is not a test.
 *
 * The trees are synthesized in a temp dir rather than committed as fixtures: the
 * gate's subject IS the workspace globs × the `AGENTS.md` Map, so a fixture tree
 * would assert nothing a case name does not already say. Each case breaks
 * exactly one thing.
 *
 * Usage: node scripts/gen-packages/test.mjs
 * Exit:  0 all cases pass · 1 any case fails
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = join(HERE, "gen.mjs");

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function write(root, rel, content) {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

const ROWS = {
  core: "| `packages/core/` | Engine | vitest |",
  cli: "| `packages/cli/` | CLI | x |",
  renderers: "| `packages/renderers/` | Adapters | seam |",
};

/**
 * A synthetic repo root: the workspace globs, one `package.json` per package
 * directory, and an `AGENTS.md` whose Map lists `mapRows`. `dirs` are extra
 * directories written WITHOUT a manifest (they must not count as packages).
 */
function makeTree({
  packages = ["core", "cli"],
  renderers = [],
  mapRows = [],
  dirs = [],
  map = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "gen-packages-"));
  write(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n  - packages/renderers/*\n");
  for (const pkg of packages) {
    write(root, join("packages", pkg, "package.json"), JSON.stringify({ name: `@x/${pkg}` }));
  }
  for (const pkg of renderers) {
    write(
      root,
      join("packages", "renderers", pkg, "package.json"),
      JSON.stringify({ name: `@x/renderers-${pkg}` }),
    );
  }
  for (const dir of dirs) write(root, join(dir, ".keep"), "");
  const table = map
    ? `# AGENTS.md\n\n## Map\n\n| Where | What | Notes |\n|---|---|---|\n| \`docs/SPEC.md\` | contract | read first |\n${mapRows.join("\n")}\n`
    : `# AGENTS.md\n\nno map here\n`;
  write(root, "AGENTS.md", table);
  return root;
}

const roots = [];
function tree(spec) {
  const root = makeTree(spec);
  roots.push(root);
  return root;
}

function run(root, args = []) {
  const res = spawnSync(process.execPath, [GEN, "--root", root, ...args], { encoding: "utf8" });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

// A minimal consistent tree: core + cli named directly, two renderer packages
// covered by the aggregate `packages/renderers/` row.
const BASE = {
  packages: ["core", "cli"],
  renderers: ["kofi", "gumroad"],
  mapRows: [ROWS.core, ROWS.cli, ROWS.renderers],
};

try {
  // ── the passing shape ─────────────────────────────────────────────────────
  {
    const root = tree(BASE);
    const res = run(root, ["--check"]);
    check("a consistent tree passes --check", res.code === 0, res.out.trim());
    check(
      "the verdict names the derived package count",
      res.out.includes("4 workspace package(s) covered by the AGENTS.md Map"),
      res.out.trim(),
    );
    const report = run(root);
    check(
      "the default mode prints the derived inventory",
      report.code === 0 &&
        report.out.includes("packages/renderers/kofi (covered by a directory row)"),
      report.out.trim(),
    );
    // The aggregate row is not a package: `packages/renderers` carries no
    // manifest, so it must not appear in the derived inventory.
    check(
      "packages/renderers itself is not counted as a package",
      !/^ {2}packages\/renderers$/m.test(report.out),
      report.out.trim(),
    );
  }
  {
    // Per-child rows work as well as the aggregate row.
    const root = tree({
      ...BASE,
      mapRows: [
        ROWS.core,
        ROWS.cli,
        "| `packages/renderers/kofi/` | x | y |",
        "| `packages/renderers/gumroad/` | x | y |",
      ],
    });
    const res = run(root, ["--check"]);
    check("per-child renderer rows pass too", res.code === 0, res.out.trim());
  }

  // ── the #216 shape: an omitted package ────────────────────────────────────
  {
    const root = tree({ ...BASE, packages: ["core", "cli", "artifact"] });
    const res = run(root, ["--check"]);
    check(
      "an omitted package refuses (the #216 shape)",
      res.code === 1 &&
        res.out.includes("omits 1 workspace package(s)") &&
        res.out.includes("packages/artifact"),
      res.out.trim(),
    );
  }

  // ── a listed package that does not exist ──────────────────────────────────
  {
    const root = tree({ ...BASE, mapRows: [...BASE.mapRows, "| `packages/ghost/` | x | y |"] });
    const res = run(root, ["--check"]);
    check(
      "a Map row naming a nonexistent package refuses",
      res.code === 1 && res.out.includes("packages/ghost"),
      res.out.trim(),
    );
  }
  {
    // A directory that exists but holds no manifest and no packages below it is
    // not a workspace package — the row claims one that the workspace excludes.
    const root = tree({
      ...BASE,
      dirs: [join("packages", "server")],
      mapRows: [...BASE.mapRows, "| `packages/server/` | x | y |"],
    });
    const res = run(root, ["--check"]);
    check(
      "a Map row naming a manifest-less directory refuses",
      res.code === 1 &&
        res.out.includes("not workspace packages") &&
        res.out.includes("packages/server"),
      res.out.trim(),
    );
  }

  // ── the degenerate escape hatch ───────────────────────────────────────────
  {
    const root = tree({ ...BASE, mapRows: ["| `packages/` | root | x |"] });
    const res = run(root, ["--check"]);
    check(
      "a single `packages` root row refuses (it would verify nothing)",
      res.code === 1 && res.out.includes("a row for the package root verifies nothing"),
      res.out.trim(),
    );
  }

  // ── unreadable subjects ───────────────────────────────────────────────────
  {
    const root = tree({ ...BASE, mapRows: [] });
    const res = run(root, ["--check"]);
    check(
      "a Map with no package rows refuses",
      res.code === 1 && res.out.includes("lists no `packages/…` package"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ ...BASE, map: false });
    const res = run(root, ["--check"]);
    check(
      "a missing ## Map section refuses",
      res.code === 1 && res.out.includes('missing the "## Map" section'),
      res.out.trim(),
    );
  }
  {
    const root = tree(BASE);
    write(root, "pnpm-workspace.yaml", "packages:\n  - packages/**\n");
    const res = run(root, ["--check"]);
    check(
      "a workspace glob the walker refuses is an E-GATE, never a silent pass",
      res.code === 1 && res.out.includes("E-GATE:") && res.out.includes("glob"),
      res.out.trim(),
    );
  }

  // ── provenance: the walker is dep-gate's (one walker, two gates) ──────────
  {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(HERE, "gen.mjs"), "utf8"),
    );
    check(
      "the gate reuses dep-gate's parser + walker (no second walker)",
      source.includes('from "../dep-gate/check.mjs"') &&
        source.includes("parseWorkspaceGlobs") &&
        source.includes("expandGlob"),
    );
    // The derived set must come from the walk, never from a hand-kept list. The
    // comments legitimately NAME the #216 example, so only executable lines are
    // scanned for a literal package name.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\/.*$/gm, "");
    check(
      "the gate hardcodes no package name",
      !/["'`]packages\/(core|cli|markdown|paste|artifact|renderers)\b/.test(code),
      code.match(/["'`]packages\/[^"'`]*/g)?.join(", ") ?? "",
    );
  }

  // ── symlinked invocation must still run (fail-open guard, dep-gate idiom) ──
  {
    const root = tree(BASE);
    const linkedDir = mkdtempSync(join(tmpdir(), "gen-packages-link-"));
    roots.push(linkedDir);
    const via = join(linkedDir, "gen.mjs");
    symlinkSync(GEN, via, "file");
    const res = spawnSync(process.execPath, [via, "--root", root, "--check"], {
      encoding: "utf8",
    });
    check(
      "the gate runs through a symlinked path (no silent no-op)",
      res.status === 0 && res.stdout.includes("gen-packages: in sync"),
      `status=${res.status} ${res.stdout}${res.stderr}`,
    );
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

for (const failure of failures) console.log(`FAIL: ${failure}`);
console.log(`gen-packages self-test: ${passed}/${passed + failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
