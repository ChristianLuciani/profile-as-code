/**
 * The platform↔renderer association has ONE data home (#165): the `pasco` block
 * of each renderer's own `package.json`. Two things can drift from it, and this
 * gate closes both:
 *
 *  1. the generated projection (`src/generated/renderers.gen.ts`) — its
 *     freshness is asserted mechanically by `scripts/renderer-map/gen.mjs
 *     --check` in CI; here it is asserted to be exactly the manifests' set,
 *     with no platform invented or dropped in between;
 *  2. each renderer module's own `deploySpec` export (SPEC §7, declared in its
 *     code) — the manifest field would otherwise be a silent second home.
 *
 * The renderer set is discovered from the layout, never hand-listed: a new
 * renderer joins this gate by existing (the loud half — a renderer without a
 * `pasco.platform` — is `scripts/renderer-map/gen.mjs`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS } from "@profile-as-code/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { RENDERER_DEPLOY_SPECS, RENDERERS } from "../src/generated/renderers.gen.js";

const RENDERERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "renderers");
const REGISTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "platforms",
  "registry.yaml",
);

interface RegistryEntry {
  status: string;
  deploy?: string;
  renderer?: boolean;
}

const registry = (
  parse(readFileSync(REGISTRY, "utf8")) as { platforms: Record<string, RegistryEntry> }
).platforms;

interface RendererManifest {
  dir: string;
  name: string;
  pasco: { platform: string; deploySpec: string; assets?: boolean };
}

/** A renderer is a directory with a manifest — the same subject the generator
 *  arms on (`rendererDirs`), so a stray non-package directory under
 *  `packages/renderers/` cannot crash this suite at import time (review F1).
 *  The read follows a symlinked directory (`statSync`) and skips dotfiles, the
 *  way `rendererDirs` does: a `Dirent` check would hide a renderer the generator
 *  projects from the very oracle that validates it (#176, review F2). */
const manifests: RendererManifest[] = readdirSync(RENDERERS_DIR, { withFileTypes: true })
  .filter((entry) => !entry.name.startsWith("."))
  .filter((entry) => {
    try {
      return statSync(join(RENDERERS_DIR, entry.name)).isDirectory();
    } catch {
      return false;
    }
  })
  .filter((entry) => existsSync(join(RENDERERS_DIR, entry.name, "package.json")))
  .map((entry) => {
    const manifest = JSON.parse(
      readFileSync(join(RENDERERS_DIR, entry.name, "package.json"), "utf8"),
    ) as { name: string; pasco?: RendererManifest["pasco"] };
    return {
      dir: entry.name,
      name: manifest.name,
      pasco: manifest.pasco as RendererManifest["pasco"],
    };
  });

describe("renderer map — one data home (#165)", () => {
  it("every renderer directory declares the platform field", () => {
    expect(manifests.length).toBeGreaterThan(0);
    for (const { dir, pasco } of manifests) {
      expect(pasco, `${dir} declares no pasco block`).toBeDefined();
    }
  });

  it("every declared platform is in the schema enum (core PLATFORMS)", () => {
    for (const { dir, pasco } of manifests) {
      expect(PLATFORMS as readonly string[], `${dir} → ${pasco.platform}`).toContain(
        pasco.platform,
      );
    }
  });

  it("the generated map is exactly the manifests' platforms", () => {
    const declared = manifests.map((m) => m.pasco.platform).sort();
    expect(Object.keys(RENDERERS).sort()).toEqual(declared);
    expect(Object.keys(RENDERER_DEPLOY_SPECS).sort()).toEqual(declared);
  });

  it("every mapped platform exposes a render function", () => {
    for (const platform of Object.keys(RENDERERS)) {
      expect(typeof RENDERERS[platform], platform).toBe("function");
    }
  });

  it("each renderer module's own deploySpec matches the manifest field", async () => {
    for (const { name, pasco } of manifests) {
      const module = (await import(name)) as { deploySpec?: unknown };
      expect(module.deploySpec, `${name}: module vs manifest`).toBe(pasco.deploySpec);
      expect(RENDERER_DEPLOY_SPECS[pasco.platform], `${name}: projection`).toBe(module.deploySpec);
    }
  });

  // F1 of the fresh review: `pasco.assets` decides the generated call SHAPE, so a
  // manifest flag that disagrees with the module would drop the media bundle with
  // every gate green (the generator cannot import a module). The declaration is
  // the module's own export — code, reviewable — and this assertion is the gate.
  it("asset consumption is declared in the module exactly where the manifest claims it", async () => {
    for (const { name, pasco } of manifests) {
      const module = (await import(name)) as { consumesAssets?: unknown };
      expect(module.consumesAssets ?? false, `${name}: module vs manifest pasco.assets`).toBe(
        pasco.assets === true,
      );
    }
  });

  // The reverse half of the #165 gate: the registry DECLARES `renderer` and
  // `deploy`, so the projection must agree with it in both directions — a
  // `renderer: true` with no map entry (or a map entry the registry calls
  // `false`) is the same drift, and a renderer whose declared deploy spec
  // differs from the registry's `deploy` breaks the D9 contract. `gen-platforms
  // --check` asserts the same pair in CI; this is the local `pnpm test` signal.
  it("the registry's renderer flag and deploy spec agree with the map (#165/D9)", () => {
    const members = Object.entries(registry).filter(([, entry]) => entry.status === "member");
    expect(members.length).toBeGreaterThan(0);
    for (const [slug, entry] of members) {
      expect(entry.renderer, `${slug}.renderer`).toBe(RENDERERS[slug] !== undefined);
      if (entry.renderer === true) {
        expect(entry.deploy, `${slug}.deploy`).toBe(RENDERER_DEPLOY_SPECS[slug]);
      }
    }
  });
});
