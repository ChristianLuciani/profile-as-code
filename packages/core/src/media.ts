/**
 * media.ts — the M8 media pipeline (D17/D19, §18.3–§18.7): byte-stable asset
 * bundling from `path` locators into the renderer `assets/` output.
 *
 * Pointer-first transport (D14 applied to media): the workspace declares
 * pointers; the engine never owns the binaries. In-workspace `media/…` files
 * are copied — byte-for-byte — into the renderer output `assets/` dir with a
 * sha256 recorded at compile (the `assets/manifest.json` the build writes).
 * External files resolve under `PASCO_EVIDENCE_ROOT` (env, or the gitignored
 * `.pasco/local.toml` override — per-machine state, never committed): they
 * bundle locally but are CI-degradable by design (§18.3).
 *
 * Severities (§18.8 conventions): an in-workspace SSOT violation (missing or
 * unsafe file, declared-checksum mismatch) is an ERROR — `pasco check` fails;
 * per-machine external state (missing evidence root, symlink escape without a
 * declared checksum, oversize) is a WARN — visible, CI-degradable, never
 * silently dropped.
 *
 * Naming discipline (§18.1): this is the MEDIA transport, not "evidence".
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { RegistryFinding } from './registry.js';
import { isPublicEntry } from './registry.js';
import type { Artifact, Profile } from './types.js';

/** One bundled asset: the compile record of a `path`-locator artifact (§18.6). */
export interface MediaAsset {
  /** Registry id of the artifact — the stable, collision-free target key. */
  artifactId: string;
  /** Deploy-relative target inside the platform output dir: `assets/<id>/<basename>`. */
  target: string;
  /** Absolute source path on THIS machine — never emitted into a render (D14). */
  source: string;
  /** sha256 hex of the bundled bytes (recorded at compile, byte-stable). */
  sha256: string;
  bytes: number;
  /** Where the bytes came from: workspace `media/` or the per-machine evidence root. */
  origin: 'workspace' | 'external';
}

/** The compile result: what to bundle + what to report. Deterministic (sorted by id). */
export interface MediaBundle {
  assets: MediaAsset[];
  findings: RegistryFinding[];
}

export interface CollectMediaOptions {
  /** Oversize warn threshold (§18.6: warn > 50 MB, GitHub hard limit 100 MB). Default 50 MB. */
  maxBytes?: number;
  /** Explicit evidence root (test seam / embedders). Otherwise: env `PASCO_EVIDENCE_ROOT` > `.pasco/local.toml`. */
  evidenceRoot?: string;
}

/** §18.6 size guidance — the default threshold is a SPEC value, not a guess. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Pure target derivation (§18.3): `assets/<id>/<basename>`. Per-artifact dirs
 * make targets collision-free (ids are core-checked unique) and reviewable in
 * deploy-repo diffs. The renderer and the build MUST derive the same target —
 * this function is the single source.
 */
export function artifactAssetTarget(locatorPath: string, artifactId: string): string {
  const base = locatorPath.replace(/\/+$/, '').split('/').pop() ?? '';
  return base === '' ? `assets/${artifactId}` : `assets/${artifactId}/${base}`;
}

/** Resolved locator: where the bytes are, and whether they live in the workspace. */
interface ResolvedLocator {
  origin: 'workspace' | 'external';
  /** Absolute path the locator resolves to (not guaranteed to exist). */
  absolute: string;
  /** The locator is safe (inside its base dir) — false means an error finding. */
  safe: boolean;
}

function contains(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Resolution rules (§18.6): a `media/…` path is workspace-relative (the SSOT);
 * any other path resolves under the evidence root — env tier first, then the
 * gitignored `.pasco/local.toml` override. Absolute locators never escape:
 * containment is checked against the resolved base.
 */
function resolveEvidenceRoot(workspaceRoot: string, opts: CollectMediaOptions): string | undefined {
  if (opts.evidenceRoot !== undefined) return opts.evidenceRoot;
  const env = process.env.PASCO_EVIDENCE_ROOT;
  if (env !== undefined && env.trim() !== '') return env.trim();
  const tomlPath = join(workspaceRoot, '.pasco', 'local.toml');
  if (!existsSync(tomlPath)) return undefined;
  const text = readFileSync(tomlPath, 'utf8');
  const match = text.match(/^\s*evidence_root\s*=\s*(?:"([^"]+)"|'([^']+)')\s*$/m);
  if (match === null) return undefined;
  const raw = (match[1] ?? match[2] ?? '').trim();
  if (raw === '') return undefined;
  return raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw;
}

function resolveLocator(
  artifact: Artifact,
  workspaceRoot: string,
  evidenceRoot: string | undefined,
): ResolvedLocator & { base?: string } {
  const path = artifact.locator.path ?? '';
  if (path.startsWith('media/')) {
    const base = resolve(workspaceRoot);
    const absolute = resolve(base, path);
    return { origin: 'workspace', absolute, safe: contains(base, absolute), base };
  }
  if (evidenceRoot === undefined) {
    return { origin: 'external', absolute: '', safe: true };
  }
  const base = resolve(evidenceRoot);
  const absolute = resolve(base, path);
  return { origin: 'external', absolute, safe: contains(base, absolute), base };
}

function finding(code: string, severity: RegistryFinding['severity'], path: string, message: string): RegistryFinding {
  return { code, severity, path, message };
}

/**
 * Collect the media bundle for a profile (§18.6): public `path`-locator
 * artifacts → sha256 + bytes + target, with findings for every machine-state
 * deviation. Offline and deterministic given the machine state; the bundle is
 * sorted by artifactId so the manifest the build writes is byte-stable.
 */
export function collectMedia(profile: Profile, workspaceRoot: string, opts: CollectMediaOptions = {}): MediaBundle {
  const assets: MediaAsset[] = [];
  const findings: RegistryFinding[] = [];
  const evidenceRoot = resolveEvidenceRoot(workspaceRoot, opts);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  for (const [index, artifact] of (profile.artifacts ?? []).entries()) {
    const path = `artifacts[${index}]`;
    if (artifact.locator?.path === undefined) continue; // url locators: SSOT URL, live-link check (M3/M4)
    if (!isPublicEntry(artifact)) continue; // §18.5: private/unlisted never leave the workspace

    if (artifact.id === undefined) {
      findings.push(finding(
        'check/media-unbundled-no-id',
        'warn',
        path,
        `path-locator artifact "${artifact.title}" has no id — bundling needs a stable target (assets/<id>/<basename>); add an id to travel via renderer assets/`,
      ));
      continue;
    }

    const locator = resolveLocator(artifact, workspaceRoot, evidenceRoot);
    if (locator.origin === 'external' && evidenceRoot === undefined) {
      findings.push(finding(
        'check/media-external-missing',
        'warn',
        `${path}.locator.path`,
        `external locator "${artifact.locator.path}" has no PASCO_EVIDENCE_ROOT on this machine (env, or gitignored .pasco/local.toml) — bundles locally only, CI-degradable (§18.3)`,
      ));
      continue;
    }
    if (!locator.safe) {
      findings.push(finding(
        'check/media-path-unsafe',
        'error',
        `${path}.locator.path`,
        `resolved path escapes its base (workspace ${locator.origin === 'workspace' ? 'root' : 'evidence root'}) — locator "${artifact.locator.path}" must stay inside it`,
      ));
      continue;
    }

    if (!existsSync(locator.absolute)) {
      findings.push(finding(
        locator.origin === 'workspace' ? 'check/media-missing-workspace' : 'check/media-external-missing',
        locator.origin === 'workspace' ? 'error' : 'warn',
        `${path}.locator.path`,
        locator.origin === 'workspace'
          ? `in-workspace media "${artifact.locator.path}" is missing — the workspace is the SSOT (D14); restore the file or fix the locator`
          : `external media "${artifact.locator.path}" not found under the evidence root on this machine — local-only (§18.3)`,
      ));
      continue;
    }
    if (!statSync(locator.absolute).isFile()) {
      findings.push(finding(
        'check/media-not-a-file',
        'error',
        `${path}.locator.path`,
        `locator "${artifact.locator.path}" resolves to a directory, not a file`,
      ));
      continue;
    }

    // §18.7: a workspace file reached through a symlink outside the workspace is
    // per-machine state — WARN unless the SSOT declares a checksum (integrity covered).
    if (locator.origin === 'workspace' && lstatSync(locator.absolute).isSymbolicLink()) {
      const real = realpathSync(locator.absolute);
      if (!contains(resolve(workspaceRoot), real) && artifact.checksum === undefined) {
        findings.push(finding(
          'check/media-symlink-external',
          'warn',
          `${path}.locator.path`,
          `"${artifact.locator.path}" is a symlink outside the workspace and carries no declared checksum — symlink/stow is a power-user convenience (§18.7), declare the sha256 to make it verifiable`,
        ));
      }
    }

    const bytes = readFileSync(locator.absolute);
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    if (artifact.checksum !== undefined && artifact.checksum !== `sha256:${sha256}`) {
      findings.push(finding(
        'check/media-checksum-mismatch',
        'error',
        `${path}.checksum`,
        `declared checksum does not match the bytes on disk for "${artifact.id}" — the SSOT promises different bytes (immutable artifacts only, §18.6)`,
      ));
      continue; // the mismatching asset is NOT bundled
    }

    if (bytes.length > maxBytes) {
      findings.push(finding(
        'check/media-oversize',
        'warn',
        `${path}.locator.path`,
        `"${artifact.locator.path}" is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB (limit ${Math.round(maxBytes / (1024 * 1024))} MB) — consider git-lfs or external hosting + url locator (§18.6)`,
      ));
    }

    assets.push({
      artifactId: artifact.id,
      target: artifactAssetTarget(artifact.locator.path, artifact.id),
      source: locator.absolute,
      sha256,
      bytes: bytes.length,
      origin: locator.origin,
    });
  }

  assets.sort((a, b) => (a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0));
  return { assets, findings };
}

/**
 * Deterministic manifest body for one platform output (§18.6): the compile
 * record of what was bundled — no timestamps, fixed key order, stable layout.
 * The build writes this as `assets/manifest.json` (byte-stable deploy output).
 */
export interface ManifestEntry {
  id: string;
  target: string;
  sha256: string;
  bytes: number;
  origin: MediaAsset['origin'];
}

export function mediaManifest(platform: string, lang: string, assets: readonly MediaAsset[]): {
  version: 1;
  platform: string;
  lang: string;
  assets: ManifestEntry[];
} {
  return {
    version: 1,
    platform,
    lang,
    assets: assets.map((a) => ({ id: a.artifactId, target: a.target, sha256: a.sha256, bytes: a.bytes, origin: a.origin })),
  };
}
