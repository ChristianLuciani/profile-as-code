/**
 * `pasco preview` — see the data without publishing it (issue #282, SPEC §7.9).
 *
 * The artifact is the contract, not the hosting: ONE self-contained HTML file
 * that opens from `file://` with no server, no network and no JS. The issue's
 * design note is why: a single file has no base URL to resolve, so the class of
 * bug #279 hit (a page served at an arbitrary depth breaking every relative URL)
 * cannot occur, and there is nothing to compress before moving it.
 *
 * Two transports, one renderer (the issue's A/B):
 *   A. local, the default — `<workspace>/.pasco/preview/index.html`, then opened
 *      in the browser. Untracked as long as the workspace ignores `.pasco/`;
 *      `--out` warns when the destination falls inside a git work tree without
 *      an ignore entry.
 *   B. a CI artifact — the same command with `--out` (which never opens
 *      anything), uploaded by a workflow. That half lives in the workspace
 *      template, not in the engine (multi-tenant rule §9).
 *
 * What it composes and what it does NOT re-implement:
 *   - the text per platform is `renderArtifact` — the SAME decision tree `build`
 *     writes (active variant → renderer → paste source), so the preview cannot
 *     promise an artifact `build` refuses;
 *   - the check state is `buildCheckReport` — the SAME computation `pasco check`
 *     prints;
 *   - the gate is `preview/privacy.ts`.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, dirname as parentDir, relative, resolve } from "node:path";
import type { LoadedProfile, MediaAsset, Platform } from "@profile-as-code/core";
import {
  collectMedia,
  LoadError,
  load,
  PLATFORMS,
  SchemaValidationError,
} from "@profile-as-code/core";
import {
  compileSlice,
  renderArtifact,
  selectionErrorMessage,
  selectionFindings,
} from "../artifact-render.js";
import { parseLang } from "../contract.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report, section } from "../output.js";
import type { PreviewAsset, PreviewSection } from "../preview/document.js";
import { renderPreviewDocument } from "../preview/document.js";
import type { PreviewSource, PrivacyFinding } from "../preview/privacy.js";
import { PRIVACY_RULES, privacyFindings } from "../preview/privacy.js";
import { artifactPath } from "../publication.js";
import { ConfigError, defaultsLang, type Pascorc } from "../workspace.js";
import { buildCheckReport } from "./check.js";
import { resolveNow } from "./export-profile.js";

export interface PreviewArgs {
  workspace: string;
  pascorc: Pascorc;
  /** `--out <dir>` — write `<dir>/index.html`, never open anything (transport B). */
  outArg?: string;
  /** `--no-open` — write, do not open (the default opens transport A). */
  noOpen: boolean;
  langArg?: string;
  /** `--now <iso8601>` — pin the freshness stamp (no clock read; determinism). */
  nowArg?: string;
}

/** Image bytes the preview is willing to inline, per file and in total. */
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 8 * 1024 * 1024;

const MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
};

/**
 * `N facts` for the header — the non-empty scalar leaves of the normalized
 * profile (strings, numbers, booleans). Derived on every run, stored nowhere: a
 * count that lives in a file drifts from the data it counts (rule 8).
 */
export function countFacts(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return value.trim() === "" ? 0 : 1;
  if (typeof value === "number" || typeof value === "boolean") return 1;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countFacts(item), 0);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (sum, item) => sum + countFacts(item),
      0,
    );
  }
  return 0;
}

/** Every `content/**` file the workspace declares (the provenance set). */
function contentSources(workspace: string): PreviewSource[] {
  const root = join(workspace, "content");
  if (!existsSync(root)) return [];
  const out: PreviewSource[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(?:ya?ml|json)$/iu.test(name)) out.push({ role: "content", path });
    }
  };
  walk(root);
  return out;
}

/**
 * Inline the bundle entries the renderers reference. Only `origin: "workspace"`
 * media is a candidate — evidence-root bytes (`origin: "external"`) live outside
 * the workspace and the privacy gate refuses them by design (§18.6/D14).
 */
function inlineAssets(bundle: readonly MediaAsset[]): {
  assets: PreviewAsset[];
  sources: PreviewSource[];
  omitted: { target: string; reason: string }[];
} {
  const assets: PreviewAsset[] = [];
  const sources: PreviewSource[] = [];
  const omitted: { target: string; reason: string }[] = [];
  let total = 0;
  for (const asset of [...bundle].sort((a, b) => a.target.localeCompare(b.target))) {
    const extension = asset.source.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME[extension];
    if (asset.origin !== "workspace") {
      omitted.push({
        target: asset.target,
        reason:
          "media outside the workspace (evidence root) — a preview never embeds per-machine bytes",
      });
      continue;
    }
    if (mime === undefined) {
      omitted.push({
        target: asset.target,
        reason: `not an embeddable image type (.${extension})`,
      });
      continue;
    }
    if (asset.bytes > MAX_ASSET_BYTES) {
      omitted.push({
        target: asset.target,
        reason: `larger than ${MAX_ASSET_BYTES} bytes — a preview stays one small file`,
      });
      continue;
    }
    if (total + asset.bytes > MAX_TOTAL_ASSET_BYTES) {
      omitted.push({
        target: asset.target,
        reason: `would exceed the ${MAX_TOTAL_ASSET_BYTES}-byte budget`,
      });
      continue;
    }
    if (!existsSync(asset.source)) {
      omitted.push({ target: asset.target, reason: "source file is gone" });
      continue;
    }
    const bytes = readFileSync(asset.source);
    total += bytes.byteLength;
    assets.push({
      target: asset.target,
      dataUri: `data:${mime};base64,${bytes.toString("base64")}`,
      bytes: bytes.byteLength,
    });
    sources.push({ role: "asset", path: asset.source });
  }
  return { assets, sources, omitted };
}

/** Make a machine path workspace-relative so the document carries no absolute path. */
function relativize(value: string, workspace: string): string {
  const root = resolve(workspace);
  return value
    .split(root)
    .join(".")
    .replace(/\/{2,}/gu, "/");
}

/**
 * Is `path` inside a git work tree that does NOT ignore it? The default output
 * lives in `<workspace>/.pasco/`, which the template's `.gitignore` covers; an
 * explicit `--out` inside a repository may not be — and a preview committed by
 * accident is exactly the leak this command exists to avoid.
 */
function outIsUnignoredInRepo(dir: string, file: string): boolean {
  // The destination may not exist yet (git refuses a missing `-C`), so the
  // question is asked of its nearest EXISTING ancestor — the same work tree.
  let probe = resolve(dir);
  while (!existsSync(probe) && parentDir(probe) !== probe) probe = parentDir(probe);
  const inRepo = spawnSync("git", ["-C", probe, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  if (inRepo.status !== 0 || inRepo.stdout.trim() !== "true") return false;
  const ignored = spawnSync("git", ["-C", probe, "check-ignore", "-q", "--", file], {
    encoding: "utf8",
  });
  return ignored.status !== 0;
}

/** Open the file with the platform opener; a failure is reported, never fatal. */
function openFile(file: string): boolean {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [file]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", file]]
        : ["xdg-open", [file]];
  const result = spawnSync(command, args as string[], { stdio: "ignore", timeout: 10_000 });
  return result.status === 0;
}

/**
 * `--now` goes through the SAME calendar-strict resolver `export profile` uses
 * (`resolveNow`): `Date.parse` normalizes `2026-02-30` and `T24:00:00` into a
 * different instant, which would stamp a date that does not exist (fresh review
 * of #354, F3 — one validator, two commands, never a weaker second copy).
 */
function parseNow(value: string): string {
  const resolved = resolveNow(value);
  if (!resolved.ok || resolved.generatedAt === null) {
    throw new ConfigError(
      `--now "${value}" is not a real ISO 8601 instant (expected 2026-10-29T12:00:00Z)`,
    );
  }
  return resolved.generatedAt;
}

export function runPreview(args: PreviewArgs): number {
  let profile: LoadedProfile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report("preview", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report("preview", false, EXIT.FAIL, { error: { kind: "load", message: err.message } });
    }
    throw err;
  }

  const lang = parseLang(defaultsLang(args.pascorc, args.langArg));
  const generatedAt = args.nowArg === undefined ? new Date().toISOString() : parseNow(args.nowArg);

  // One gate with `build`: a selection error means build refuses to write this
  // surface, so a preview that renders it would promise an artifact that does
  // not exist (§21.4 / the #331 lesson: one decision tree, two callers).
  const platforms = PLATFORMS.filter(
    (platform) => platform !== "github-org" || profile.flavor === "brand",
  ) as readonly Platform[];
  const slices = platforms.map((platform) => compileSlice(profile, platform, lang, args.pascorc));
  const findings = selectionFindings([...slices]);
  if (findings.some((finding) => finding.severity === "error")) {
    return report("preview", false, EXIT.FAIL, {
      error: { kind: "selection", message: selectionErrorMessage(findings) },
      data: { selection: findings },
    });
  }

  const bundle = collectMedia(profile, args.workspace);
  const inlined = inlineAssets(bundle.assets);
  const warnings: string[] = [];

  const surfaces: PreviewSection[] = [];
  for (const slice of slices) {
    const rendered = renderArtifact(slice, args.workspace, bundle.assets);
    const notes: string[] = [];
    if (rendered.warning !== undefined) notes.push(relativize(rendered.warning, args.workspace));
    if (rendered.source === "variant" && rendered.variantId !== undefined) {
      notes.push(
        `the body is the active variant "${rendered.variantId}", written verbatim by build`,
      );
    }
    const empty = rendered.text.trim() === "";
    if (empty) {
      notes.push(
        "no artifact for this platform and language — build removes the platform output (a manual-paste surface with no bio row is not published)",
      );
    }
    const artifact = artifactPath(args.workspace, slice.platform);
    surfaces.push({
      id: slice.platform,
      title: slice.platform,
      origin:
        rendered.source === "variant"
          ? `variant ${rendered.variantId ?? ""}`.trim()
          : rendered.source,
      artifact: empty ? null : relative(args.workspace, artifact),
      markdown: rendered.text,
      notes,
    });
  }

  // "Por plataforma" is satisfied by the surfaces this language PUBLISHES; the
  // rest are listed with the reason (an empty frame per surface is noise, a
  // silent omission is worse — see `renderUnpublished`).
  const sections = surfaces.filter((s) => s.markdown.trim() !== "");
  const unpublished = surfaces
    .filter((s) => s.markdown.trim() === "")
    .map((s) => ({ id: s.id, reason: s.notes[0] ?? "no artifact for this platform and language" }));

  // The check state the issue asks for ("when it exists"): the same report
  // `pasco check` prints, with every path made workspace-relative so the
  // document passes its own absolute-path rule.
  const checks = buildCheckReport({
    workspace: args.workspace,
    profile,
    pascorc: args.pascorc,
    // The pinned date governs the clock-keyed rules too, so the page cannot say
    // "generated 2026-01-01" beside "expired 2026-06-01" (round-2 F1).
    today: generatedAt.slice(0, 10),
  });
  const checkFindings = [
    ...checks.registry,
    ...checks.media,
    ...checks.limits,
    ...checks.factPresent.findings,
  ].map((finding) => ({
    severity: finding.severity,
    code: finding.code,
    message: relativize(finding.message, args.workspace),
    path: relativize(finding.path, args.workspace),
  }));
  for (const finding of checks.factPresent.notRun) {
    warnings.push(
      `fact-present not run for ${finding}: no artifact on disk or no renderer for the flavor`,
    );
  }

  // Output location FIRST: `--out <dir>` (transport B) or
  // `<workspace>/.pasco/preview` (transport A, outside the versioned tree when
  // the workspace ignores it). Resolving it before the render means the warning
  // travels in the page's own notes and not only in the terminal (review F7).
  const outDir =
    args.outArg === undefined
      ? join(args.workspace, ".pasco", "preview")
      : resolve(process.cwd(), args.outArg);
  const file = join(outDir, "index.html");
  if (outIsUnignoredInRepo(outDir, file)) {
    warnings.push(
      `--out lands inside a git work tree and is not ignored — commit only if you mean to publish it (add "${relative(resolve(args.workspace), file)}" to .gitignore)`,
    );
  }

  const facts = countFacts(profile);
  const html = renderPreviewDocument({
    title: `profile preview — ${basename(resolve(args.workspace))}`,
    generatedAt,
    lang,
    facts,
    engine: "pasco",
    workspaceName: basename(resolve(args.workspace)),
    sections,
    unpublished,
    assets: inlined.assets,
    omitted: inlined.omitted,
    checks: checkFindings,
    limits: checks.checks.map((row) => ({
      platform: row.platform,
      rule: row.rule,
      value: JSON.stringify(row.value),
    })),
    warnings,
  });

  // The gate runs BEFORE the write: a refused preview leaves no file behind, so
  // the operator never finds a leaking artifact on disk to clean up.
  const sources: PreviewSource[] = [
    ...contentSources(args.workspace),
    ...(existsSync(join(args.workspace, ".pascorc"))
      ? [{ role: "config" as const, path: join(args.workspace, ".pascorc") }]
      : []),
    ...inlined.sources,
  ];
  const privacy: PrivacyFinding[] = privacyFindings({
    html,
    sources,
    workspace: args.workspace,
  });

  if (privacy.length > 0) {
    return report("preview", false, EXIT.FAIL, {
      data: {
        written: false,
        path: null,
        generatedAt,
        lang,
        facts,
        sections: sections.map((s) => ({ platform: s.id, empty: s.markdown.trim() === "" })),
        privacy: { rules: [...PRIVACY_RULES], findings: privacy },
        warnings,
      },
      error: {
        kind: "privacy",
        message: `${privacy.length} privacy finding(s) — the preview was not written (it must not carry what the gate refused): ${privacy.map((f) => `${f.rule} (${f.detail})`).join("; ")}`,
      },
    });
  }

  try {
    mkdirSync(outDir, { recursive: true });
    const temp = `${file}.tmp-${process.pid}`;
    writeFileSync(temp, html, "utf8");
    renameSync(temp, file);
  } catch (err) {
    if (existsSync(`${file}.tmp-${process.pid}`)) {
      rmSync(`${file}.tmp-${process.pid}`, { force: true });
    }
    return report("preview", false, EXIT.FAIL, {
      error: { kind: "write", message: (err as Error).message },
    });
  }

  const bytes = Buffer.byteLength(html, "utf8");
  const shouldOpen = args.outArg === undefined && !args.noOpen;
  const opened = shouldOpen ? openFile(file) : false;
  if (shouldOpen && !opened) {
    warnings.push("could not open a browser — open the file path above yourself");
  }

  if (isJsonMode()) {
    return report("preview", true, EXIT.OK, {
      data: {
        written: true,
        path: file,
        bytes,
        generatedAt,
        lang,
        facts,
        sections: sections.map((s) => ({
          platform: s.id,
          origin: s.origin,
          artifact: s.artifact,
          chars: s.markdown.length,
          empty: s.markdown.trim() === "",
        })),
        assets: { embedded: inlined.assets.length, omitted: inlined.omitted },
        checks: { findings: checkFindings.length },
        privacy: { rules: [...PRIVACY_RULES], findings: [] },
        opened,
        warnings,
      },
    });
  }

  line(
    `preview: ${file} (${(bytes / 1024).toFixed(1)} KiB · ${sections.length} surface(s) · ${facts} facts · lang ${lang})`,
  );
  section("surfaces");
  for (const s of sections) {
    const state = s.markdown.trim() === "" ? "no artifact" : `${s.markdown.length} chars`;
    line(`  ${s.id.padEnd(16)} ${s.origin.padEnd(9)} ${s.artifact ?? "—"} · ${state}`);
  }
  if (inlined.assets.length > 0 || inlined.omitted.length > 0) {
    section(`assets: ${inlined.assets.length} embedded · ${inlined.omitted.length} left out`);
    for (const omitted of inlined.omitted)
      line(`  not embedded: ${omitted.target} — ${omitted.reason}`);
  }
  if (unpublished.length > 0) {
    line(
      `  ${unpublished.length} declared surface(s) not published for lang ${lang} (listed in the page as "not published")`,
    );
  }
  section(`privacy gate: ${PRIVACY_RULES.length} rules · 0 findings`);
  for (const warning of warnings) line(`  warn: ${warning}`);
  line(
    `  one self-contained file: no script, no external asset, no server — open it with a browser, or upload it as a CI artifact (transport B)`,
  );
  return EXIT.OK;
}
