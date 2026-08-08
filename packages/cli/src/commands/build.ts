/**
 * pac build [platform] [--lang] — deterministic base texts per platform+lang
 * (SPEC §7 `pac build`). Pure compile() slices; no AI, no renderer yet (renderers
 * land in M2/M4). Renders for ALL platforms when no platform is given.
 */

import { compile, load, LoadError, PLATFORMS, SchemaValidationError } from '@profile-as-code/core';
import type { PlatformProfile } from '@profile-as-code/core';
import { parseLang, parsePlatform } from '../contract.js';
import { EXIT } from '../exit.js';
import { isJsonMode, line, report, section } from '../output.js';
import type { Pacrc } from '../workspace.js';
import { defaultsLang } from '../workspace.js';

export interface BuildArgs {
  workspace: string;
  platformArg?: string;
  langArg?: string;
  pacrc: Pacrc;
}

export function runBuild(args: BuildArgs): number {
  let profile;
  try {
    profile = load(args.workspace);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return report('build', false, EXIT.FAIL, {
        error: {
          kind: 'schema',
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report('build', false, EXIT.FAIL, { error: { kind: 'load', message: err.message } });
    }
    throw err;
  }

  const platforms = args.platformArg !== undefined ? [parsePlatform(args.platformArg)] : [...PLATFORMS];
  const lang = parseLang(defaultsLang(args.pacrc, args.langArg));

  const slices: PlatformProfile[] = platforms.map((p) => compile(profile, p, lang));

  if (isJsonMode()) {
    return report('build', true, EXIT.OK, {
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
      },
    });
  }

  section(`base texts (lang: ${lang})`);
  for (const s of slices) {
    line(`\n[${s.platform}]`);
    if (s.statement !== undefined) line(`  statement: ${s.statement}`);
    if (s.active !== undefined) line(`  active: ${s.active.variantId} (chosen ${s.active.chosenAt})`);
    for (const b of s.bios) line(`  bio (${b.length}): ${b.text}`);
    for (const h of s.headlines) line(`  headline: ${h.text}`);
    if (s.bios.length === 0 && s.headlines.length === 0) line('  (no texts for this platform+lang)');
    if (s.fallbacks.length > 0) line(`  (${s.fallbacks.length} text(s) fell back to en)`);
  }

  return EXIT.OK;
}
