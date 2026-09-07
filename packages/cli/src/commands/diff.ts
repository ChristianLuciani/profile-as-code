/**
 * pasco diff — what changed since the last release (git-based → CHANGELOG hint,
 * SPEC §7). Release marker = the latest tag matching `release-*` (configurable
 * in .pascorc diff.tagPattern). No release tag → diff against the first commit.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative } from 'node:path';
import { EXIT } from '../exit.js';
import { isJsonMode, line, report, section } from '../output.js';
import type { Pascorc } from '../workspace.js';

interface GitOk {
  ok: true;
  out: string;
}
interface GitFail {
  ok: false;
  err: string;
}
type GitResult = GitOk | GitFail;

function git(root: string, args: string[]): GitResult {
  try {
    const out = execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message: string };
    const message = typeof e.stderr === 'string' ? e.stderr.trim() : e.message;
    return { ok: false, err: message || 'git failed' };
  }
}

const lines = (r: GitResult): string[] => (r.ok ? r.out.trim().split('\n').filter(Boolean) : []);

/** Root properties that, when changed, affect deployed profile text/facts. */
const TEXT_OR_FACT_ROOTS = new Set([
  'bios',
  'headlines',
  'identity',
  'experience',
  'projects',
  'publications',
  'positioning',
  'skills',
  'keywords',
]);

export interface DiffArgs {
  workspace: string;
  pascorc: Pascorc;
}

export function runDiff(args: DiffArgs): number {
  const rootRes = git(args.workspace, ['rev-parse', '--show-toplevel']);
  if (!rootRes.ok) {
    return report('diff', false, EXIT.FAIL, {
      error: {
        kind: 'git',
        message: `${args.workspace} is not inside a git repository — pasco diff is git-based (release markers = tags)`,
      },
    });
  }
  const root = rootRes.out.trim();

  const tagPattern = args.pascorc.diff?.tagPattern ?? 'release-*';
  const tags = lines(git(root, ['tag', '-l', '--sort=-creatordate', tagPattern]));
  const tag = tags[0] ?? null;

  let base = '';
  if (tag !== null) {
    const resolved = git(root, ['rev-parse', `${tag}^{commit}`]);
    if (resolved.ok) base = resolved.out.trim();
  }
  if (base === '') {
    const rootCommit = lines(git(root, ['rev-list', '--max-parents=0', 'HEAD']))[0];
    if (rootCommit === undefined) {
      return report('diff', false, EXIT.FAIL, {
        error: { kind: 'git', message: `cannot determine a diff base in ${root}` },
      });
    }
    base = rootCommit;
  }

  const head = git(root, ['rev-parse', 'HEAD']);
  if (!head.ok) {
    return report('diff', false, EXIT.FAIL, { error: { kind: 'git', message: head.err } });
  }
  const headSha = head.out.trim();

  const commits = lines(git(root, ['log', '--format=%H%x1f%s', `${base}..HEAD`])).map((entry) => {
    const sep = entry.indexOf('\u001f');
    return sep === -1 ? { hash: entry, subject: '' } : { hash: entry.slice(0, sep), subject: entry.slice(sep + 1) };
  });

  const rootReal = realpathSync(root);
  const wsReal = realpathSync(args.workspace);
  const wsRel = relative(rootReal, wsReal);
  const wsPrefix = wsRel === '' ? '' : `${wsRel}/`;
  const allFiles = lines(git(root, ['diff', '--name-only', `${base}..HEAD`]));
  const files = allFiles
    .filter((p) => (wsPrefix === '' ? true : p.startsWith(wsPrefix)))
    .map((p) => (wsPrefix === '' ? p : p.slice(wsPrefix.length)))
    .map((p) => ({
      path: p,
      root: p.replace(/^content\//, '').replace(/\.ya?ml$/, ''),
    }));

  const changedRoots = new Set(files.map((f) => f.root).filter(Boolean));
  let hint = '';
  if (changedRoots.size > 0) {
    if ([...changedRoots].some((r) => TEXT_OR_FACT_ROOTS.has(r))) {
      hint = 'texts or facts changed — re-verify deployed profiles (re-paste per platform playbook)';
    } else if (changedRoots.has('active')) {
      hint = 'variant selection changed — candidate for CHANGELOG';
    } else if (changedRoots.has('checks')) {
      hint = 'check catalog changed — re-run pasco check before deploying';
    }
  }

  if (isJsonMode()) {
    return report('diff', true, EXIT.OK, {
      data: {
        workspace: args.workspace,
        repoRoot: root,
        base,
        head: headSha,
        tag,
        hasChanges: commits.length > 0 || files.length > 0,
        commits,
        files,
        hint,
      },
    });
  }

  section(`diff since ${tag !== null ? `release tag '${tag}'` : 'first commit (no release tag found)'}`);
  if (commits.length === 0 && files.length === 0) {
    line('  no changes');
  } else {
    for (const c of commits) line(`  ${c.hash.slice(0, 8)} ${c.subject}`);
    if (files.length > 0) {
      line('  files changed:');
      for (const f of files) line(`    ${f.path} → root: ${f.root}`);
    }
    if (hint !== '') line(`  hint: ${hint}`);
    line('  → CHANGELOG candidate: add a dated entry and note which platforms need re-paste');
  }

  return EXIT.OK;
}
