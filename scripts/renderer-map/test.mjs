#!/usr/bin/env node
/**
 * Self-test for the renderer-map gate (#165) — the `scripts/dep-gate` idiom:
 * prove the gate REFUSES every failure class it claims to close, and that the
 * projected bytes are exactly what the manifests produce. A gate whose tests
 * cannot fail with the defect present is not a test.
 *
 * The trees are synthesized in a temp dir rather than committed as fixtures: the
 * gate's subject IS the manifest contents, so eight near-identical fixture
 * `package.json` files would assert nothing a case name does not already say.
 *
 * Zero dependencies, node >=22 — runs on a fresh checkout before install.
 *
 * Usage: node scripts/renderer-map/test.mjs
 * Exit:  0 all cases pass · 1 any case fails
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = join(HERE, "gen.mjs");
const OUT_REL = join("packages", "cli", "src", "generated", "renderers.gen.ts");
const DEFAULT_ENUM = ["kofi", "github-readme", "patreon", "buymeacoffee"];

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

/**
 * A synthetic repo root: pnpm-workspace.yaml globs, the platform enum, a CLI
 * manifest declaring its renderer deps, and one manifest per renderer. Every
 * field is overridable so a case can break exactly one thing.
 * renderers: [{ dir, name, platform, deploySpec, assets, pasco, member }]
 */
function makeTree({ renderers, enumPlatforms = DEFAULT_ENUM, dependencies, stray }) {
  const root = mkdtempSync(join(tmpdir(), "renderer-map-"));
  write(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n  - packages/renderers/*\n");
  write(
    root,
    join("schema", "profile.schema.json"),
    JSON.stringify({ $defs: { platform: { enum: enumPlatforms } } }, null, 2),
  );
  const deps = { ...(dependencies ?? {}) };
  for (const r of renderers) {
    if (r.member !== false) deps[r.name] = "workspace:*";
  }
  write(
    root,
    join("packages", "cli", "package.json"),
    JSON.stringify({ name: "@profile-as-code/cli", devDependencies: deps }, null, 2),
  );
  for (const r of renderers) {
    const manifest = { name: r.name, version: "0.1.0" };
    if (r.pasco !== false) {
      manifest.pasco = r.pasco ?? {
        ...(r.platform !== undefined ? { platform: r.platform } : {}),
        ...(r.deploySpec !== undefined ? { deploySpec: r.deploySpec } : {}),
        ...(r.assets !== undefined ? { assets: r.assets } : {}),
      };
    }
    write(
      root,
      join("packages", "renderers", r.dir, "package.json"),
      JSON.stringify(manifest, null, 2),
    );
  }
  if (stray) {
    write(
      root,
      join("packages", stray.dir, "package.json"),
      JSON.stringify({ name: stray.name, pasco: stray.pasco }, null, 2),
    );
  }
  return root;
}

function run(root, args = []) {
  const res = spawnSync(process.execPath, [GEN, "--root", root, ...args], { encoding: "utf8" });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const KOFI = {
  dir: "kofi",
  name: "@profile-as-code/renderers-kofi",
  platform: "kofi",
  deploySpec: "manual",
};
const README = {
  dir: "github-readme",
  name: "@profile-as-code/renderers-github-readme",
  platform: "github-readme",
  deploySpec: "git",
  assets: true,
};

const roots = [];
function tree(spec) {
  const root = makeTree(spec);
  roots.push(root);
  return root;
}

try {
  // ── projection ────────────────────────────────────────────────────────────
  {
    const root = tree({ renderers: [KOFI, README] });
    const generated = run(root);
    check("valid tree generates", generated.code === 0, generated.out.trim());
    const committed = readFileSync(join(root, OUT_REL), "utf8");
    check(
      "generates the manifest platforms as map keys",
      committed.includes(
        '"github-readme": (slice, assets) => renderGithubReadme(slice, { assets }),',
      ) && committed.includes("kofi: (slice) => renderKofi(slice),"),
      committed,
    );
    check(
      "generates the deploySpec view from the manifests",
      committed.includes('"github-readme": "git",') && committed.includes('kofi: "manual",'),
      committed,
    );
    check(
      "imports only the packages named by the manifests",
      committed.includes('from "@profile-as-code/renderers-kofi"') &&
        committed.includes('from "@profile-as-code/renderers-github-readme"'),
      committed,
    );
    const inSync = run(root, ["--check"]);
    check("--check passes on the fresh projection", inSync.code === 0, inSync.out.trim());
    // Deterministic: same manifests → same bytes.
    const again = run(root);
    check(
      "regeneration is byte-stable",
      again.code === 0 && readFileSync(join(root, OUT_REL), "utf8") === committed,
    );
  }

  // ── freshness (the D3 drift shape) ────────────────────────────────────────
  {
    const root = tree({ renderers: [KOFI, README] });
    run(root);
    const manifestPath = join(root, "packages", "renderers", "kofi", "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.pasco.platform = "patreon";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const stale = run(root, ["--check"]);
    check(
      "--check refuses a manifest edited without regeneration",
      stale.code === 1,
      stale.out.trim(),
    );
    check("staleness names the fix", stale.out.includes("pnpm gen:renderers"), stale.out.trim());
  }

  // ── refusals: the classes the issue names ─────────────────────────────────
  {
    const root = tree({ renderers: [{ ...KOFI, pasco: false }] });
    const res = run(root);
    check(
      "renderer without a platform refuses loudly",
      res.code === 1 && res.out.includes("never skipped"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ renderers: [{ ...KOFI, platform: "myspace" }] });
    const res = run(root);
    check(
      "platform outside the schema enum refuses",
      res.code === 1 && res.out.includes("$defs.platform.enum"),
      res.out.trim(),
    );
  }
  {
    const root = tree({
      renderers: [KOFI, { ...README, platform: "kofi" }],
    });
    const res = run(root);
    check(
      "duplicate platform refuses (one-to-one)",
      res.code === 1 && res.out.includes("one-to-one"),
      res.out.trim(),
    );
  }
  {
    // #165 review F4: two platforms whose Pascal forms collide would emit the
    // same import binding twice — refuse at the source, not in tsc. (Case-only
    // differences do NOT collide: JS identifiers are case-sensitive.)
    const root = tree({
      renderers: [
        { ...KOFI, platform: "github-readme" },
        { ...README, platform: "github--readme" },
      ],
      enumPlatforms: [...DEFAULT_ENUM, "github--readme"],
    });
    const res = run(root);
    check(
      "import-identifier collision refuses",
      res.code === 1 && res.out.includes("both project to the import"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ renderers: [{ ...KOFI, deploySpec: "ftp" }] });
    const res = run(root);
    check(
      "deploySpec outside the SPEC §7 union refuses",
      res.code === 1 && res.out.includes("pasco.deploySpec"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ renderers: [{ ...KOFI, assets: "yes" }] });
    const res = run(root);
    check(
      "non-boolean pasco.assets refuses",
      res.code === 1 && res.out.includes("pasco.assets"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ renderers: [KOFI], dependencies: {} });
    const manifestPath = join(root, "packages", "cli", "package.json");
    writeFileSync(manifestPath, JSON.stringify({ name: "@profile-as-code/cli" }, null, 2));
    const res = run(root);
    check(
      "renderer missing from the CLI manifest refuses",
      res.code === 1 && res.out.includes("would not resolve"),
      res.out.trim(),
    );
  }
  {
    const root = tree({
      renderers: [KOFI],
      stray: {
        dir: "renderers-moved",
        name: "@profile-as-code/renderers-moved",
        pasco: { platform: "patreon", deploySpec: "manual" },
      },
    });
    const res = run(root);
    check(
      "renderer outside the layout refuses (no silent escape)",
      res.code === 1 && res.out.includes("outside"),
      res.out.trim(),
    );
  }
  {
    // A manifest under packages/renderers/ that the workspace globs do not
    // match: the projection cannot reach it, so the gate must not pretend it can.
    const root = tree({ renderers: [KOFI] });
    write(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n  - packages/renderers/kofi\n");
    write(
      root,
      join("packages", "renderers", "orphan", "package.json"),
      JSON.stringify(
        {
          name: "@profile-as-code/renderers-orphan",
          pasco: { platform: "patreon", deploySpec: "manual" },
        },
        null,
        2,
      ),
    );
    const res = run(root);
    check(
      "renderer that is not a workspace member refuses",
      res.code === 1 && res.out.includes("not a workspace member"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ renderers: [], enumPlatforms: DEFAULT_ENUM });
    const res = run(root);
    check("no renderers at all refuses", res.code === 1, res.out.trim());
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

for (const failure of failures) console.log(`FAIL: ${failure}`);
console.log(`renderer-map self-test: ${passed}/${passed + failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
