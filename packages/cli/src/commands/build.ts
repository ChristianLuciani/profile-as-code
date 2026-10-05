/**
 * pasco build [platform] [--lang] — deterministic base texts per platform+lang
 * (SPEC §7 `pasco build`) + rendered deploy artifacts (SPEC §15). Pure compile()
 * slices; no AI. Platforms WITH a renderer also write the rendered artifact to
 * profiles/<platform>/README.md (deploy spec: git for GitHub surfaces, paste
 * for kofi — the artifact IS the paste source, D9); platforms without a
 * renderer print their slices (renderers land in M4).
 */

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LoadedProfile, MediaAsset, PlatformProfile } from "@profile-as-code/core";
import {
  collectMedia,
  compile,
  LoadError,
  load,
  mediaManifest,
  PLATFORMS,
  SchemaValidationError,
} from "@profile-as-code/core";
import { render as renderGithubOrg } from "@profile-as-code/renderers-github-org";
import { render as renderGithubReadme } from "@profile-as-code/renderers-github-readme";
import { render as renderKofi } from "@profile-as-code/renderers-kofi";
import { parseLang, parsePlatform } from "../contract.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";
import type { Pascorc } from "../workspace.js";
import { defaultsLang } from "../workspace.js";

/** Platforms with an implemented renderer (M2: github-readme; M6: github-org;
 *  v1.7 #130: kofi — paste platform, D9 artifact = the paste source).
 *  M8 (§18.6): renderers receive the media bundle and declare the deploy-relative
 *  targets they reference — the build copies exactly those bytes (checksummed). */
const RENDERERS: Partial<
  Record<
    string,
    (slice: PlatformProfile, assets: readonly MediaAsset[]) => { text: string; assets?: string[] }
  >
> = {
  "github-readme": (slice, assets) => renderGithubReadme(slice, { assets }),
  "github-org": (slice) => renderGithubOrg(slice),
  kofi: (slice) => renderKofi(slice),
};

export interface BuildArgs {
  workspace: string;
  platformArg?: string;
  langArg?: string;
  pascorc: Pascorc;
}

export function runBuild(args: BuildArgs): number {
  let profile: LoadedProfile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report("build", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report("build", false, EXIT.FAIL, { error: { kind: "load", message: err.message } });
    }
    throw err;
  }

  const platforms =
    args.platformArg !== undefined ? [parsePlatform(args.platformArg)] : [...PLATFORMS];
  const lang = parseLang(defaultsLang(args.pascorc, args.langArg));

  const slices: PlatformProfile[] = platforms.map((p) => compile(profile, p, lang));

  // Renderer platforms: write the deploy artifact (SPEC §15.5 — profiles/ ARE the deploy artifacts).
  // github-org is a brand surface (D15/§17) — only rendered for brand workspaces.
  // M8 (§18.6 media transport): collect the bundle ONCE — public path-locator
  // artifacts, sha256 + bytes recorded at compile, deterministic (sorted). The
  // renderer decides WHICH targets its text references; the build copies exactly
  // those bytes into profiles/<platform>/assets/ (the deploy surface). Findings
  // are machine-state facts — build proceeds, `pasco check` is the gate.
  const bundle = collectMedia(profile, args.workspace);

  const written: { platform: string; path: string; assets?: number }[] = [];
  for (const s of slices) {
    const renderer = RENDERERS[s.platform];
    if (renderer === undefined) continue;
    if (s.platform === "github-org" && profile.flavor !== "brand") continue;
    const result = renderer(s, bundle.assets);
    // v1.7 (#130): an empty artifact is not a deploy artifact — a paste
    // platform (kofi) yields "" when no bios row exists for platform+lang
    // (compile filters exactly). This keeps `pasco build` from littering every
    // workspace with an empty profiles/<platform>/README.md per new renderer.
    // MUST run BEFORE the mkdir: an empty render leaves NO directory either —
    // profiles/ stays untouched for platforms the workspace has no texts for.
    if (result.text === "") continue;
    const dir = join(args.workspace, "profiles", s.platform);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "README.md");
    writeFileSync(path, result.text);

    // assets/ IS part of the platform output (Q9/D19 — one dir per platform,
    // no shared content-addressed store): rebuild it clean so the output dir
    // stays a pure function of the workspace (no stale drift, §15.1).
    let bundled = 0;
    const referenced = result.assets ?? [];
    if (referenced.length > 0) {
      const assetsDir = join(dir, "assets");
      rmSync(assetsDir, { recursive: true, force: true });
      const byTarget = new Map(bundle.assets.map((a) => [a.target, a] as const));
      const copied = referenced.map((target) => {
        const asset = byTarget.get(target);
        if (asset === undefined) {
          throw new Error(
            `renderer "${s.platform}" declared asset "${target}" without a bundle entry — renderers may only reference collectMedia() targets (M8 contract)`,
          );
        }
        const dest = join(assetsDir, ...asset.target.split("/").slice(1));
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(asset.source, dest);
        return asset;
      });
      writeFileSync(
        join(assetsDir, "manifest.json"),
        `${JSON.stringify(mediaManifest(s.platform, s.lang, copied), null, 2)}\n`,
      );
      bundled = copied.length;
    }
    written.push({ platform: s.platform, path, ...(bundled > 0 ? { assets: bundled } : {}) });
  }

  if (isJsonMode()) {
    return report("build", true, EXIT.OK, {
      data: {
        workspace: args.workspace,
        lang,
        platforms: slices.map((s) => ({
          platform: s.platform,
          lang: s.lang,
          statement: s.statement,
          audiences: s.audiences,
          bios: s.bios,
          headlines: s.headlines,
          seoKeywords: s.keywords.seo,
          active: s.active,
          fallbacks: s.fallbacks,
        })),
        written,
        media: bundle.findings,
      },
    });
  }

  section(`base texts (lang: ${lang})`);
  for (const s of slices) {
    line(`\n[${s.platform}]`);
    if (s.statement !== undefined) line(`  statement: ${s.statement}`);
    if (s.active !== undefined)
      line(`  active: ${s.active.variantId} (chosen ${s.active.chosenAt})`);
    for (const b of s.bios) line(`  bio (${b.length}): ${b.text}`);
    for (const h of s.headlines) line(`  headline: ${h.text}`);
    if (s.bios.length === 0 && s.headlines.length === 0)
      line("  (no texts for this platform+lang)");
    if (s.fallbacks.length > 0) line(`  (${s.fallbacks.length} text(s) fell back to en)`);
  }
  if (written.length > 0) {
    section("deploy artifacts written");
    for (const w of written)
      line(`  ${w.path}${w.assets !== undefined ? ` (+${w.assets} asset(s) in assets/)` : ""}`);
  }
  if (bundle.findings.length > 0) {
    section(`media pipeline (M8/§18.6): ${bundle.findings.length} finding(s)`);
    for (const f of bundle.findings) line(`  ${f.severity}: [${f.code}] ${f.message} (${f.path})`);
  }

  return EXIT.OK;
}
