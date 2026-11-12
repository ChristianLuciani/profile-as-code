/**
 * pasco init [dir] [--flavor person|brand] — scaffold a workspace skeleton
 * (SPEC §9): facts/ YAML files, README.md, .pascorc. Minimal but
 * `pasco validate`-clean (exit 0).
 *
 * Two flavors (D15/§17):
 *   - person (default): individual professional identity (identity.yaml + a
 *     couple of optional blocks).
 *   - brand: commercial/brand identity — org identity variant + the brand
 *     blocks (socialHandles matrix, newsletter, podcast, press, audiences)
 *     seeded from the operator's brand-handles matrix pattern.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Flavor } from "@profile-as-code/core";
import { FACTS_DIR, PROFILE_SCHEMA_VERSION } from "@profile-as-code/core";
import { DEFAULT_CHECKS_YAML } from "../default-checks.js";
import { engineFloorFor } from "../engine-gate.js";
import { EXIT } from "../exit.js";
import { line, report, section } from "../output.js";
import { CLI_VERSION } from "../version.js";
import { WORKSPACE_NAME } from "../workspace.js";

const FLAVOR_BRAND_TEMPLATE = `# ${WORKSPACE_NAME} brand workspace — facts/ flavor (D15/§17)
# The file value IS the root value: a bare scalar (file name = root property).
brand
`;

const IDENTITY_TEMPLATE = `# ${WORKSPACE_NAME} workspace — facts/ identity (contract: schema/profile.schema.json)
# Only "name" is required. Comments are examples — uncomment and adapt.
name: Your Name
# location: City, Country
# photo: https://example.com/you.jpg
# links:            # canonical URLs — renderers read URLs ONLY from here (drift rule)
#   - platform: github
#     label: GitHub
#     url: https://github.com/you
#   - platform: linkedin
#     label: LinkedIn
#     url: https://linkedin.com/in/you
`;

const BRAND_IDENTITY_TEMPLATE = `# ${WORKSPACE_NAME} brand workspace — facts/ identity (contract: schema/profile.schema.json)
# Brand flavor (D15/§17): name is the display name; orgName is the legal name
# when it differs. mission/tagline are langMaps (EN required).
name: Your Brand
# orgName: Your Brand Legal
# logo: https://brand.example/logo.png
# established: 2026-01-01
# mission:
#   en: What the brand does and why it matters.
# tagline:
#   en: One-line promise.
# brandVoice:
#   tone:
#     en: editorial, rigorous
#   values: [clarity, evidence]
#   avoid: [hype, doom-scrolling]
# links:            # canonical URLs — renderers read URLs ONLY from here (drift rule)
#   - platform: website
#     label: Website
#     url: https://brand.example
#   - platform: x
#     label: X
#     url: https://x.com/yourbrand
`;

const BRAND_SOCIAL_HANDLES_TEMPLATE = `# ${WORKSPACE_NAME} brand workspace — facts/ socialHandles (handle matrix, §17)
# One row per platform: handle + claim status. A claimed handle should carry a
# url (or match identity.links) — drift rules handle-claimed / handle-consistent.
# Seed: your brand-handles availability sweep.
# - platform: x
#   handle: yourbrand
#   status: claimed
#   url: https://x.com/yourbrand
# - platform: bluesky
#   handle: yourbrand
#   status: pending
`;

const BRAND_NEWSLETTER_TEMPLATE = `# ${WORKSPACE_NAME} brand workspace — facts/ newsletter (§17)
# platform: substack | ghost. url is required.
# platform: substack
# url: https://yourbrand.substack.com
# name:
#   en: Your Brand
# cadence: monthly
`;

const BRAND_PODCAST_TEMPLATE = `# ${WORKSPACE_NAME} brand workspace — facts/ podcast (§17)
# title is a langMap and required; status: planned | live.
# title:
#   en: Your Brand Radio
# status: planned
`;

const BRAND_PRESS_TEMPLATE = `# ${WORKSPACE_NAME} brand workspace — facts/ press (§17)
# Media mentions: outlet, headline (langMap), resolvable URL, date.
# - outlet: Example Gazette
#   title:
#     en: Your Brand launches
#   url: https://example.com/your-brand-launch
#   date: 2026-01-01
`;

const BRAND_AUDIENCES_TEMPLATE = `# ${WORKSPACE_NAME} brand workspace — facts/ audiences (§17)
# Reader profiles (not recruiters): audience name → per-lang angle.
# readers:
#   en: High-epistemic readers who want constructive futures.
`;

const README_TEMPLATE = `# ${WORKSPACE_NAME}

Per-user workspace for [profile-as-code](https://github.com/ChristianLuciani/profile-as-code).
Your professional facts live here as text-first YAML (SPEC §2.1); the engine validates,
checks drift and renders per-platform texts. Facts are your own — this workspace is
private by default and never leaves your control (D14: integration by configured path).

## The cycle

\`\`\`sh
pasco init <dir>        scaffold a workspace (facts/, README.md, .pascorc)
edit facts/*.yaml       the single source of truth — edit these, not profiles/
pasco validate          schema + drift + geo (warnings)
pasco build [platform]  write the per-platform artifacts
\`\`\`

## Files

Three grains, one per area — nothing nests one inside another:
\`facts/\` is identity, \`profiles/\` is generated output (its \`variants/\` subdir is input),
\`posts/\` is the stream.

- \`facts/*.yaml\` — identity facts, the SSOT (file name = root property; the contract is described in the [schema documentation](https://github.com/ChristianLuciani/profile-as-code/blob/main/schema/README.md))
- \`profiles/\` — generated outputs (created by pasco build; committed: they ARE the deploy artifacts)
- \`profiles/<platform>/variants/\` — chosen variant bodies (INPUT, #238; preserved by build)
- \`posts/\` — the stream, created by \`pasco post\` (#264): seeds + per-channel projections; never identity facts
- \`.pascorc\` — workspace config (defaults)

## Skills

The platform playbooks ship with \`pasco\`, outside this workspace. Run this from
the workspace root when you need to know what to write for a channel:
\`pasco skills:export .pasco-skills\` copies them in; each channel lands under
\`.pasco-skills/<platform>/\`, where you can read its guidance.
The copy is disposable: add it to .gitignore if you do not want it committed
(re-running needs \`--force\`).

## Workflow

\`\`\`sh
pasco validate          # schema (fail) + drift/geo (warn) — D12
pasco build github-readme --lang en   # deterministic base texts
pasco refine github-readme --variants 3   # agent-driven variants (template + --choose; full flow M3)
\`\`\`

See the [CLI reference](https://github.com/ChristianLuciani/profile-as-code/tree/main/packages/cli#readme) for the full command reference, including what \`check\` compares against \`facts/\`, the order \`build\` chooses an artifact, and where the per-platform character caps come from.
`;

const BRAND_README_TEMPLATE = `# ${WORKSPACE_NAME}

Brand workspace for [profile-as-code](https://github.com/ChristianLuciani/profile-as-code)
(flavor: brand, D15/§17). The brand's facts — identity, handle matrix, newsletter,
podcast, press, audiences — live here as text-first YAML; the engine validates,
checks drift and renders brand surfaces. Private by default (D14: configured path).

## The cycle

\`\`\`sh
pasco init <dir>        scaffold a workspace (facts/, README.md, .pascorc)
edit facts/*.yaml       the single source of truth — edit these, not profiles/
pasco validate          schema + drift + geo (warnings)
pasco build [platform]  write the per-platform artifacts
\`\`\`

## Files

Three grains, one per area — nothing nests one inside another:
\`facts/\` is identity, \`profiles/\` is generated output (its \`variants/\` subdir is input),
\`posts/\` is the stream.

- \`facts/*.yaml\` — the brand profile, identity facts (file name = root property; the contract is described in the [schema documentation](https://github.com/ChristianLuciani/profile-as-code/blob/main/schema/README.md))
- \`profiles/\` — generated outputs (github-org README is the first deploy artifact; pasco build also writes manual-paste files)
- \`profiles/<platform>/variants/\` — chosen variant bodies (INPUT, #238; preserved by build)
- \`posts/\` — the stream, created by \`pasco post\` (#264): seeds + per-channel projections; never identity facts
- \`.pascorc\` — workspace config (defaults)

## Skills

The platform playbooks ship with \`pasco\`, outside this workspace. Run this from
the workspace root when you need to know what to write for a channel:
\`pasco skills:export .pasco-skills\` copies them in; each channel lands under
\`.pasco-skills/<platform>/\`, where you can read its guidance.
The copy is disposable: add it to .gitignore if you do not want it committed
(re-running needs \`--force\`).

## Workflow

\`\`\`sh
pasco validate                # schema (fail) + drift/geo (warn) — D12
pasco check                   # handle-matrix rules (handle-claimed / handle-consistent)
pasco build github-org --lang en   # org README (git deploy)
\`\`\`

See the [CLI reference](https://github.com/ChristianLuciani/profile-as-code/tree/main/packages/cli#readme) for the full command reference, including what \`check\` compares against \`facts/\`, the order \`build\` chooses an artifact, and where the per-platform character caps come from.
`;

/**
 * The scaffolded `.pascorc` — JSON, not YAML. Two floors are written at BIRTH:
 *  - `engine` (#434) equals the installed CLI version, so "absent" is
 *    unreachable for a workspace born from this scaffold. A hand-written floor
 *    can be forgotten, typed wrong, or left behind by the upgrade that changed
 *    the contract; a birth-time declaration cannot.
 *  - `contract` (#439) equals the profile contract this build validates. It is
 *    what `pasco doctor --contract-delta` diffs against after an upgrade, so the
 *    workspace can say WHICH minors it has not adopted; without it that question
 *    has no floor and the delta is unanswerable (doctor reports `absent`).
 *    Always written: the schema version is exact even for a pre-release build.
 */
export function pascorcTemplate(engineVersion: string, contractVersion: string): string {
  const floor = engineFloorFor(engineVersion);
  // A pre-release build declares no ENGINE floor (see `engineFloorFor`): the
  // scaffold must never pin a version the published engine cannot satisfy.
  const engine = floor === null ? "" : `  "engine": "${floor}",\n`;
  return `{
  "workspace": ".",
${engine}  "contract": "${contractVersion}",
  "defaults": { "lang": "en", "variants": 3 },
  "diff": { "tagPattern": "release-*" }
}
`;
}

export interface InitArgs {
  cwd: string;
  dir?: string;
  flavor?: Flavor;
}

const BRAND_FILES: Record<string, string> = {
  "identity.yaml": BRAND_IDENTITY_TEMPLATE,
  "socialHandles.yaml": BRAND_SOCIAL_HANDLES_TEMPLATE,
  "newsletter.yaml": BRAND_NEWSLETTER_TEMPLATE,
  "podcast.yaml": BRAND_PODCAST_TEMPLATE,
  "press.yaml": BRAND_PRESS_TEMPLATE,
  "audiences.yaml": BRAND_AUDIENCES_TEMPLATE,
  "flavor.yaml": FLAVOR_BRAND_TEMPLATE,
};

/** `pasco init [dir] [--flavor person|brand]` — scaffold into <dir> (default: cwd). Refuses to overwrite. */
export function runInit(args: InitArgs): number {
  const dir = resolve(args.cwd, args.dir ?? ".");
  const contentDir = join(dir, FACTS_DIR);
  const brand = args.flavor === "brand";

  if (existsSync(contentDir)) {
    return report("init", false, EXIT.FAIL, {
      error: { kind: "exists", message: `refusing to scaffold: ${contentDir} already exists` },
    });
  }

  const files = brand
    ? { ...BRAND_FILES, "checks.yaml": DEFAULT_CHECKS_YAML }
    : { "identity.yaml": IDENTITY_TEMPLATE, "checks.yaml": DEFAULT_CHECKS_YAML };

  const targets: { path: string; content: string }[] = [
    ...Object.entries(files).map(([name, content]) => ({ path: join(contentDir, name), content })),
    { path: join(dir, "README.md"), content: brand ? BRAND_README_TEMPLATE : README_TEMPLATE },
    { path: join(dir, ".pascorc"), content: pascorcTemplate(CLI_VERSION, PROFILE_SCHEMA_VERSION) },
  ];
  for (const t of targets) {
    if (existsSync(t.path)) {
      return report("init", false, EXIT.FAIL, {
        error: { kind: "exists", message: `refusing to overwrite existing file: ${t.path}` },
      });
    }
  }

  mkdirSync(contentDir, { recursive: true });
  for (const t of targets) writeFileSync(t.path, t.content);

  section(`scaffolded ${WORKSPACE_NAME} workspace (flavor: ${brand ? "brand" : "person"})`);
  for (const t of targets) line(`  created ${t.path}`);
  line(
    brand
      ? "  next: pasco validate && pasco check && pasco build github-org --lang en"
      : "  next: pasco validate && pasco build github-readme --lang en",
  );

  return report("init", true, EXIT.OK, {
    data: {
      workspace: dir,
      flavor: brand ? "brand" : "person",
      created: targets.map((t) => t.path),
    },
  });
}
