/**
 * pac init — scaffold a user-brand-data workspace skeleton (SPEC §9): content/
 * YAML files, README.md, .pacrc. Minimal but `pac validate`-clean (exit 0).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXIT } from '../exit.js';
import { line, report, section } from '../output.js';

const IDENTITY_TEMPLATE = `# user-brand-data workspace — content/ identity (contract: schema/profile.schema.json)
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

const README_TEMPLATE = `# user-brand-data

Per-user workspace for [profile-as-code](https://github.com/ChristianLuciani/profile-as-code).
Your professional facts live here as text-first YAML (SPEC §2.1); the engine validates,
checks drift and renders per-platform texts. Facts are your own — this workspace is
private by default and never leaves your control (D14: integration by configured path).

## Files

- \`content/*.yaml\` — the profile (file name = root property, see schema/README.md)
- \`profiles/\` — generated outputs (created by renderers; committed: they ARE the deploy artifacts)
- \`.pacrc\` — workspace config (defaults)

## Workflow

\`\`\`sh
pac validate          # schema (fail) + drift/geo (warn) — D12
pac build github-readme --lang en   # deterministic base texts
pac refine github-readme --variants 3   # agent-driven variants (stub in M1)
\`\`\`

See packages/cli/README.md for the full command reference.
`;

const PACRC_TEMPLATE = `{
  "workspace": ".",
  "defaults": { "lang": "en", "variants": 3 },
  "diff": { "tagPattern": "release-*" }
}
`;

export interface InitArgs {
  cwd: string;
  dir?: string;
}

/** `pac init [dir]` — scaffold into <dir> (default: cwd). Refuses to overwrite. */
export function runInit(args: InitArgs): number {
  const dir = resolve(args.cwd, args.dir ?? '.');
  const contentDir = join(dir, 'content');

  if (existsSync(contentDir)) {
    return report('init', false, EXIT.FAIL, {
      error: { kind: 'exists', message: `refusing to scaffold: ${contentDir} already exists` },
    });
  }

  const targets: { path: string; content: string }[] = [
    { path: join(contentDir, 'identity.yaml'), content: IDENTITY_TEMPLATE },
    { path: join(dir, 'README.md'), content: README_TEMPLATE },
    { path: join(dir, '.pacrc'), content: PACRC_TEMPLATE },
  ];
  for (const t of targets) {
    if (existsSync(t.path)) {
      return report('init', false, EXIT.FAIL, {
        error: { kind: 'exists', message: `refusing to overwrite existing file: ${t.path}` },
      });
    }
  }

  mkdirSync(contentDir, { recursive: true });
  for (const t of targets) writeFileSync(t.path, t.content);

  section('scaffolded user-brand-data workspace');
  for (const t of targets) line(`  created ${t.path}`);
  line('  next: pac validate && pac build github-readme --lang en');

  return report('init', true, EXIT.OK, {
    data: { workspace: dir, created: targets.map((t) => t.path) },
  });
}
