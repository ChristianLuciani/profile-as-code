/**
 * pasco skills:install <agent>
 *
 * STUB — per-platform skills (D5/D6) are authored in skills-studio and projected
 * to each harness by the studio's `bin/project.sh` (AGOS). The CLI only prints
 * the projection command; the projection itself is the studio's job, not the
 * CLI's (and not implemented in M1).
 */

import { UsageError } from '../contract.js';
import { EXIT } from '../exit.js';
import { isJsonMode, line, report } from '../output.js';

export const SKILLS_OWNER =
  'M3 SOTA research per platform → skills v1 authored in skills-studio, projected via AGOS bin/project.sh';

const AGENTS = ['pi', 'claude', 'aionui', 'opencode'] as const;

export interface SkillsInstallArgs {
  agent?: string;
}

export function runSkillsInstall(args: SkillsInstallArgs): number {
  if (args.agent === undefined) {
    throw new UsageError(`usage: pasco skills:install <agent> (${AGENTS.join(' | ')})`);
  }
  if (!(AGENTS as readonly string[]).includes(args.agent)) {
    throw new UsageError(`unknown agent "${args.agent}" (allowed: ${AGENTS.join(', ')})`);
  }

  const projection = `cd <skills-studio> && bin/project.sh ${args.agent}`;

  if (isJsonMode()) {
    return report('skills:install', true, EXIT.OK, {
      data: { agent: args.agent, implemented: false, projection, ownedBy: SKILLS_OWNER },
    });
  }

  line('pasco skills:install: STUB — projection is the skills-studio job (AGOS), not the CLI');
  line(`  run: ${projection}`);
  line('  profile-as-code platform skills (per-platform living knowledge, D5/D6) land with M3 research.');
  return EXIT.OK;
}
