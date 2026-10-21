/**
 * pasco refine <platform> [--lang] [--variants N] [--choose <variantId>]
 *
 * PARTIAL — agent-driven refinement (D10/D11/D13): the CLI never calls an LLM and
 * never wires the hub. It emits the task template the executing agent works from,
 * and — with --choose — records the user's chosen variant in content/active.yaml.
 * The full variant flow (generate → user picks → commit active) lands with the
 * SOTA research + skills v1 session (SPEC §12 M3).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Lang, Platform } from "@profile-as-code/core";
import { compile, LoadError, load, SchemaValidationError } from "@profile-as-code/core";
import { parseDocument, stringify } from "yaml";
import { parseLang, parsePlatform, parseVariants, UsageError } from "../contract.js";
import { EXIT } from "../exit.js";
import { isJsonMode, line, report } from "../output.js";
import { skillFile } from "../skill-path.js";
import { hasVariantBody, isSafeVariantId, variantBodyPath } from "../variant-store.js";
import type { Pascorc } from "../workspace.js";
import { defaultsLang } from "../workspace.js";

export const REFINE_OWNER =
  "M3 SOTA research per platform → skills v1 + the full refine flow (SPEC §12/§16 M3); model-agnostic (D10/D11/D13)";

/**
 * Locate the platform skill (SPEC §16.1) relative to the CLI install
 * (repo dev flow: <repo>/skills/<platform>/SKILL.md). Returns undefined when
 * the skill is not installed (e.g. npm-installed CLI without skills shipped).
 */
function platformSkillPath(platform: string): string | undefined {
  return skillFile(platform, "SKILL.md");
}

export interface RefineArgs {
  workspace: string;
  platformArg?: string;
  langArg?: string;
  variantsArg?: string;
  choose?: string;
  pascorc: Pascorc;
}

function loadProfile(workspace: string): ReturnType<typeof load> | number {
  try {
    return load(workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report("refine", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report("refine", false, EXIT.FAIL, { error: { kind: "load", message: err.message } });
    }
    throw err;
  }
}

function recordVariant(
  workspace: string,
  platform: Platform,
  lang: Lang,
  variantId: string,
): { chosenAt: string } {
  const activePath = join(workspace, "content", "active.yaml");
  let active: Record<string, unknown> = {};
  if (existsSync(activePath)) {
    const doc = parseDocument(readFileSync(activePath, "utf8"));
    if (doc.errors.length > 0) {
      throw new Error(
        `content/active.yaml: invalid YAML — ${doc.errors[0]?.message ?? "parse error"}`,
      );
    }
    const node = doc.toJS({ maxAliasCount: 100 });
    if (node !== null && node !== undefined) {
      if (typeof node !== "object" || Array.isArray(node)) {
        throw new Error("content/active.yaml must contain a mapping (platform → variant entry)");
      }
      active = node as Record<string, unknown>;
    }
  }
  const chosenAt = new Date().toISOString();
  active[platform] = { lang, variantId, chosenAt };
  writeFileSync(activePath, stringify(active));
  return { chosenAt };
}

export function runRefine(args: RefineArgs): number {
  if (args.platformArg === undefined) {
    throw new UsageError(
      "usage: pasco refine <platform> [--lang <l>] [--variants N] [--choose <variantId>]",
    );
  }
  const platform = parsePlatform(args.platformArg);
  const lang = parseLang(defaultsLang(args.pascorc, args.langArg));
  const variants = parseVariants(args.variantsArg, args.pascorc.defaults?.variants ?? 3);
  if (args.choose !== undefined && !isSafeVariantId(args.choose)) {
    throw new UsageError(
      "--choose <variantId> must be a safe id (letters, digits, dot, underscore, dash; no slash or '..')",
    );
  }

  const loaded = loadProfile(args.workspace);
  if (typeof loaded === "number") return loaded;
  const profile = loaded;

  if (args.choose !== undefined) {
    let chosenAt: string;
    try {
      chosenAt = recordVariant(args.workspace, platform, lang, args.choose).chosenAt;
    } catch (err) {
      return report("refine", false, EXIT.FAIL, {
        error: { kind: "load", message: (err as Error).message },
      });
    }
    const variantFile = variantBodyPath(args.workspace, platform, args.choose);
    const hasBody = hasVariantBody(args.workspace, platform, args.choose);
    if (isJsonMode()) {
      return report("refine", true, EXIT.OK, {
        data: {
          mode: "recorded",
          platform,
          lang,
          variantId: args.choose,
          chosenAt,
          workspace: args.workspace,
          variantFile,
          hasBody,
        },
      });
    }
    line(
      `recorded active[${platform}] = { lang: ${lang}, variantId: ${args.choose}, chosenAt: ${chosenAt} } (content/active.yaml)`,
    );
    if (!hasBody) {
      line(
        `  warning: no variant body at ${variantFile} — pasco build will render the deterministic text until it exists`,
      );
    }
    return EXIT.OK;
  }

  const slice = compile(profile, platform, lang);
  const identity = slice.identity;
  const links = (identity.links ?? []).map((l) => `${l.platform ?? "?"}:${l.url}`).join(", ");
  const experience = slice.experience
    .map((e) => `${e.role} @ ${e.org} (${e.start}–${e.end ?? "present"})`)
    .join(" | ");
  const projects = slice.projects.map((p) => p.name).join(", ");
  const publications = slice.publications.map((p) => p.title).join(" | ");
  const anchors = slice.keywords.geo.associations?.join(", ") ?? "";
  const skillPath = platformSkillPath(platform);

  const template = [
    `# pasco refine — agent task (agent-driven: D10/D11/D13; no LLM call, no hub)`,
    `Write ${variants} variant(s) of the ${platform} profile in ${lang} — in PROSE, per the platform skill.`,
    ``,
    `Platform: ${platform}`,
    `Language: ${lang}`,
    `Skill (communicative strategy — READ IT FIRST): ${skillPath ?? "(not installed — fall back to the deterministic renderer output)"}`,
    `Research (dated sources): ${skillPath === undefined ? "—" : skillPath.replace(/SKILL\.md$/, "research/SOTA-2026.md")}`,
    `Variant id convention: ${platform.replace(/[^a-z]/g, "")}-${lang}-<n> (e.g. gh-en-1, gh-en-2, gh-en-3).`,
    ``,
    `Facts (language-independent — MUST stay byte-identical across variants and platforms):`,
    `  name: ${identity.name}`,
    `  location: ${identity.location ?? "—"}`,
    `  links: ${links || "—"}`,
    `  experience: ${experience || "—"}`,
    `  projects: ${projects || "—"}`,
    `  publications: ${publications || "—"}`,
    ``,
    `Existing ${platform} texts (base to vary):`,
    `  bios: ${slice.bios.map((b) => `[${b.length}] ${b.text}`).join(" | ") || "—"}`,
    `  headlines: ${slice.headlines.map((h) => h.text).join(" | ") || "—"}`,
    `  active variant: ${slice.active?.variantId ?? "—"}`,
    ``,
    `GEO anchors to reinforce (semantic associations): ${anchors || "—"}`,
    ``,
    `Constraints:`,
    `  - Facts never change (D4) — only storytelling/angles vary.`,
    `  - Every text langMap must include 'en' (contract requirement) and the requested lang.`,
    `  - Never invent URLs, DOIs or numbers — evidence claims stay untouched.`,
    `  - Platform-specific limits come from the platform skill (SPEC §16) + checks.yaml.`,
    ``,
    `Workflow: read the skill → produce the ${variants} variant(s) → the user picks one → save its body to`,
    `  profiles/${platform}/variants/<variantId>.md (one text block), then record it:`,
    `  pasco refine ${platform} --lang ${lang} --choose <variantId>`,
    ``,
  ].join("\n");

  if (isJsonMode()) {
    return report("refine", true, EXIT.OK, {
      data: { mode: "template", platform, lang, variants, template, ownedBy: REFINE_OWNER },
    });
  }
  process.stdout.write(template);
  return EXIT.OK;
}
