#!/usr/bin/env node
/**
 * Self-test for the gen-platforms gate (#154) — the `scripts/renderer-map`
 * idiom: prove the gate REFUSES every failure class it claims to close, and
 * that the projected bytes are exactly what the registry produces. A gate whose
 * tests cannot fail with the defect present is not a test.
 *
 * The trees are synthesized in a temp dir (with `yaml`, the generator's only
 * dependency) rather than committed as fixtures: the gate's subject IS the
 * registry contents, so near-identical fixture trees would assert nothing a
 * case name does not already say.
 *
 * Usage: node scripts/gen-platforms/test.mjs
 * Exit:  0 all cases pass · 1 any case fails
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as toYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN = join(HERE, "gen.mjs");
const OUT_REL = join("packages", "core", "src", "generated", "platforms.gen.ts");
const SPEC_REL = join("docs", "SPEC.md");
const README_REL = "README.md";

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

const PLATFORM = (over = {}) => ({
  origin: "extra",
  since: "v1",
  deploy: "manual",
  hosts: [],
  subdomain_hosts: [],
  handle_hosts: [],
  renderer: false,
  sources: ["SPEC §6 (D16)"],
  ...over,
});

/**
 * A synthetic repo root: workspace globs, the platform enum, a CLI manifest
 * declaring its renderer deps, one manifest per renderer, the registry, the two
 * marked docs and any fixture dirs. Every field is overridable so a case can
 * break exactly one thing. `platforms` is the complete registry map.
 */
function makeTree({
  platforms,
  enumPlatforms,
  postiz = { count: 0, source: "[OFICIAL] test" },
  families = {},
  renderers = [],
  fixtures = [],
  specMarker = true,
  readmeMarker = true,
}) {
  const root = mkdtempSync(join(tmpdir(), "gen-platforms-"));
  write(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n  - packages/renderers/*\n");
  write(
    root,
    join("schema", "profile.schema.json"),
    JSON.stringify({ $defs: { platform: { enum: enumPlatforms } } }, null, 2),
  );
  const deps = {};
  for (const r of renderers) deps[r.name] = "workspace:*";
  write(
    root,
    join("packages", "cli", "package.json"),
    JSON.stringify({ name: "@profile-as-code/cli", devDependencies: deps }, null, 2),
  );
  for (const r of renderers) {
    write(
      root,
      join("packages", "renderers", r.dir, "package.json"),
      JSON.stringify(
        { name: r.name, pasco: { platform: r.platform, deploySpec: r.deploySpec } },
        null,
        2,
      ),
    );
  }
  write(
    root,
    join("platforms", "registry.yaml"),
    toYaml({ version: 1, postiz, families, platforms }),
  );
  write(
    root,
    SPEC_REL,
    specMarker ? "# SPEC\n\n<!-- gen:platform-families -->\n<!-- /gen -->\n" : "# SPEC\n",
  );
  write(
    root,
    README_REL,
    readmeMarker ? "# README\n\n<!-- gen:platform-status -->\n<!-- /gen -->\n" : "# README\n",
  );
  for (const fixture of fixtures) {
    write(root, join("packages", "core", "tests", "fixtures", fixture, ".keep"), "");
  }
  return root;
}

function run(root, args = []) {
  const res = spawnSync(process.execPath, [GEN, "--root", root, ...args], { encoding: "utf8" });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const roots = [];
function tree(spec) {
  const root = makeTree(spec);
  roots.push(root);
  return root;
}

// A minimal, self-consistent tree: alpha is a creator-monetization paste
// platform with a renderer + fixture; beta is a Postiz member without one.
const BASE_ENUM = ["alpha", "beta"];
const BASE_FAMILIES = {
  "creator-monetization": {
    display: "Creator monetization",
    purpose: "pays",
    backlog: [{ name: "gofundme", note: "deferred" }],
  },
};
const BASE_PLATFORMS = {
  alpha: PLATFORM({
    family: "creator-monetization",
    since: "v1.8",
    hosts: ["alpha.com"],
    handle_hosts: ["alpha.com"],
    renderer: true,
    fixture: "alpha-ws",
  }),
  beta: PLATFORM({
    origin: "postiz",
    since: "v1.2",
    hosts: ["beta.com"],
    handle_hosts: ["beta.com"],
    renderer: false,
  }),
};
const BASE_POSTIZ = { count: 1, source: "[OFICIAL] test" };
const ALPHA_RENDERER = {
  dir: "alpha",
  name: "@profile-as-code/renderers-alpha",
  platform: "alpha",
  deploySpec: "manual",
};
const BASE_TREE = {
  platforms: BASE_PLATFORMS,
  enumPlatforms: BASE_ENUM,
  postiz: BASE_POSTIZ,
  families: BASE_FAMILIES,
  renderers: [ALPHA_RENDERER],
  fixtures: ["alpha-ws"],
};

try {
  // ── projection ────────────────────────────────────────────────────────────
  {
    const root = tree(BASE_TREE);
    const generated = run(root);
    check("valid tree generates", generated.code === 0, generated.out.trim());
    const module = readFileSync(join(root, OUT_REL), "utf8");
    check("emits the slug list in enum order", module.includes('  "alpha",\n  "beta",'), module);
    check(
      "emits the host maps",
      module.includes('"alpha.com",') && module.includes('beta: ["beta.com"],'),
      module,
    );
    check(
      "emits the paste enumeration from the family + version",
      module.includes('{ platform: "alpha", host: "alpha.com" },'),
      module,
    );
    check(
      "emits the fixture projection",
      module.includes('{ platform: "alpha", fixture: "alpha-ws" },'),
      module,
    );
    const spec = readFileSync(join(root, SPEC_REL), "utf8");
    check("fills the SPEC count arithmetic", spec.includes("1 = 1 extras; 1 + 1 = **2**."), spec);
    check(
      "fills the SPEC family table",
      spec.includes(
        "| `creator-monetization` | Creator monetization | pays | `alpha` | `gofundme` (deferred) |",
      ),
      spec,
    );
    const readme = readFileSync(join(root, README_REL), "utf8");
    check(
      "fills the README block",
      readme.includes("**2** (1 Postiz + 1 operator extras)"),
      readme,
    );
    const inSync = run(root, ["--check"]);
    check("--check passes on the fresh projection", inSync.code === 0, inSync.out.trim());
    const again = run(root);
    check(
      "regeneration is byte-stable",
      again.code === 0 && readFileSync(join(root, OUT_REL), "utf8") === module,
    );
  }

  // ── freshness (the D3 drift shape) ────────────────────────────────────────
  {
    const root = tree(BASE_TREE);
    run(root);
    const registry = JSON.parse(JSON.stringify(BASE_PLATFORMS));
    registry.alpha.hosts = ["alpha.com", "alpha.example"];
    write(
      root,
      join("platforms", "registry.yaml"),
      toYaml({ version: 1, postiz: BASE_POSTIZ, families: BASE_FAMILIES, platforms: registry }),
    );
    const stale = run(root, ["--check"]);
    check(
      "--check refuses a registry edited without regeneration",
      stale.code === 1,
      stale.out.trim(),
    );
    check("staleness names the fix", stale.out.includes("pnpm gen:platforms"), stale.out.trim());
  }

  // ── refusals: registry ↔ enum ─────────────────────────────────────────────
  {
    const root = tree({
      ...BASE_TREE,
      platforms: { ...BASE_PLATFORMS, gamma: PLATFORM({ hosts: ["gamma.com"] }) },
    });
    const res = run(root);
    check(
      "registry slug outside the enum refuses",
      res.code === 1 && res.out.includes("registry slugs outside the enum: gamma"),
      res.out.trim(),
    );
  }
  {
    const root = tree({
      ...BASE_TREE,
      platforms: { alpha: BASE_PLATFORMS.alpha },
      postiz: { count: 0, source: "x" },
    });
    const res = run(root);
    check(
      "enum member with no registry entry refuses",
      res.code === 1 && res.out.includes("enum members without a registry entry: beta"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ ...BASE_TREE, postiz: { count: 2, source: "x" } });
    const res = run(root);
    check(
      "postiz.count mismatch refuses",
      res.code === 1 && res.out.includes("postiz.count is 2 but 1 entries"),
      res.out.trim(),
    );
  }

  // ── refusals: the reverse renderer assert ─────────────────────────────────
  {
    const root = tree({
      ...BASE_TREE,
      platforms: { ...BASE_PLATFORMS, beta: { ...BASE_PLATFORMS.beta, renderer: true } },
    });
    const res = run(root);
    check(
      "renderer: true without a manifest refuses",
      res.code === 1 && res.out.includes("no renderer manifest declares"),
      res.out.trim(),
    );
  }
  {
    const root = tree({
      ...BASE_TREE,
      platforms: { ...BASE_PLATFORMS, alpha: { ...BASE_PLATFORMS.alpha, renderer: false } },
    });
    const res = run(root);
    check(
      "renderer: false contradicting a manifest refuses",
      res.code === 1 && res.out.includes("declares renderer: false but"),
      res.out.trim(),
    );
  }
  {
    const root = tree({
      ...BASE_TREE,
      renderers: [{ ...ALPHA_RENDERER, deploySpec: "git" }],
    });
    const res = run(root);
    check(
      "registry deploy != renderer deploySpec refuses",
      res.code === 1 && res.out.includes("D9 must agree"),
      res.out.trim(),
    );
  }
  {
    const root = tree({
      ...BASE_TREE,
      platforms: {
        ...BASE_PLATFORMS,
        alpha: { ...BASE_PLATFORMS.alpha, fixture: "missing-fixture" },
      },
    });
    const res = run(root);
    check(
      "a declared fixture that does not exist refuses",
      res.code === 1 && res.out.includes('fixture "missing-fixture" does not exist'),
      res.out.trim(),
    );
  }
  {
    const root = tree({
      ...BASE_TREE,
      platforms: {
        ...BASE_PLATFORMS,
        alpha: { ...BASE_PLATFORMS.alpha, fixture: undefined },
      },
    });
    const res = run(root);
    check(
      "a manual renderer platform with no fixture refuses",
      res.code === 1 && res.out.includes("declares no fixture"),
      res.out.trim(),
    );
  }

  // ── refusals: docs markers ────────────────────────────────────────────────
  {
    const root = tree({ ...BASE_TREE, specMarker: false });
    const res = run(root);
    check(
      "a missing SPEC marker refuses",
      res.code === 1 && res.out.includes("missing <!-- gen:platform-families --> marker"),
      res.out.trim(),
    );
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

for (const failure of failures) console.log(`FAIL: ${failure}`);
console.log(`gen-platforms self-test: ${passed}/${passed + failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
