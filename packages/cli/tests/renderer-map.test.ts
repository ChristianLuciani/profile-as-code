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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS } from "@profile-as-code/core";
import { describe, expect, it } from "vitest";
import { RENDERER_DEPLOY_SPECS, RENDERERS } from "../src/generated/renderers.gen.js";

const RENDERERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "renderers");

interface RendererManifest {
  dir: string;
  name: string;
  pasco: { platform: string; deploySpec: string; assets?: boolean };
}

/** A renderer is a directory with a manifest — the same subject the generator
 *  arms on (`rendererDirs`), so a stray non-package directory under
 *  `packages/renderers/` cannot crash this suite at import time (review F1). */
const manifests: RendererManifest[] = readdirSync(RENDERERS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
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
});
