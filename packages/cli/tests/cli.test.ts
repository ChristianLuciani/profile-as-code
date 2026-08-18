/**
 * CLI-level tests: execute the BUILT binary (`node dist/index.js`) against the
 * core fixtures (reused, not duplicated) + a small invalid fixture.
 * Build first (`pnpm test` = build + vitest run), so dist/ is always current.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');
const FIXTURES = join(__dirname, 'fixtures');
const MINIMAL = join(__dirname, '..', '..', 'core', 'tests', 'fixtures', 'minimal');
const DRIFTING = join(__dirname, '..', '..', 'core', 'tests', 'fixtures', 'drifting');
const INVALID = join(FIXTURES, 'invalid');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd?: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd,
    timeout: 15_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function git(dir: string, args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pac-test-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A git repo with one release tagged and one change after it (for diff). */
function makeGitWorkspace(): string {
  const dir = tempDir();
  mkdirSync(join(dir, 'content'));
  writeFileSync(join(dir, 'content', 'identity.yaml'), 'name: Elena Vasquez\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test.test']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'initial release']);
  git(dir, ['tag', 'release-1.0']);
  writeFileSync(join(dir, 'content', 'identity.yaml'), 'name: Elena Vasquez\nlocation: Madrid\n');
  writeFileSync(join(dir, 'content', 'headlines.yaml'), '- platform: x\n  lang: en\n  text: New headline\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'update identity + x headline']);
  return dir;
}

describe('surface', () => {
  it('prints version', () => {
    const r = run(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/pac \d+\.\d+\.\d+/);
  });

  it('prints help', () => {
    const r = run(['--help']);
    expect(r.code).toBe(0);
    for (const cmd of ['init', 'validate', 'build', 'diff', 'refine', 'check', 'skills:install']) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it('exit 2 on unknown command', () => {
    const r = run(['frobnicate']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown command');
  });

  it('exit 2 on unknown flag', () => {
    const r = run(['validate', '--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('usage');
  });
});

describe('pac validate (D12: fail on schema, warn on drift)', () => {
  it('exits 0 on a clean workspace', () => {
    const r = run(['validate', '--workspace', MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('valid');
    expect(r.stdout).toContain('no drift warnings');
  });

  it('exits 0 but warns on drift', () => {
    const r = run(['validate', '--workspace', DRIFTING]);
    expect(r.code).toBe(0); // D12: facts warn
    expect(r.stdout).toContain('warn: [');
  });

  it('exits 1 on schema violation', () => {
    const r = run(['validate', '--workspace', INVALID]);
    expect(r.code).toBe(1);
    // zod 4 wording (post-dependabot bump); the path `identity` is stable across zod versions
    expect(r.stderr).toContain('identity');
    expect(r.stderr).toMatch(/invalid input|required/i);
  });

  it('--json is machine-readable: clean workspace', () => {
    const r = run(['validate', '--json', '--workspace', MINIMAL]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      ok: boolean;
      exitCode: number;
      data: { schema: string; drift: unknown[]; geo: { score: number } };
    };
    expect(data.ok).toBe(true);
    expect(data.exitCode).toBe(0);
    expect(data.data.schema).toBe('valid');
    expect(data.data.drift).toEqual([]);
    expect(data.data.geo.score).toBeGreaterThanOrEqual(0);
    expect(data.data.geo.score).toBeLessThanOrEqual(100);
  });

  it('--json carries violations on schema failure', () => {
    const r = run(['validate', '--json', '--workspace', INVALID]);
    expect(r.code).toBe(1);
    const data = JSON.parse(r.stdout) as { ok: boolean; error: { kind: string; violations: { path: string }[] } };
    expect(data.ok).toBe(false);
    expect(data.error.kind).toBe('schema');
    expect(data.error.violations.some((v) => v.path === 'identity')).toBe(true);
  });
});

describe('pac build (compile slices)', () => {
  it('renders base texts for one platform+lang and writes the deploy artifact', () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    const r = run(['build', 'github-readme', '--workspace', ws]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('[github-readme]');
    expect(r.stdout).toContain('Sovereign AI infrastructure engineer'); // headline
    expect(r.stdout).toContain('Sovereign AI infra'); // short bio
    expect(r.stdout).toContain('deploy artifacts written');
    const artifact = join(ws, 'profiles', 'github-readme', 'README.md');
    expect(existsSync(artifact)).toBe(true);
    expect(readFileSync(artifact, 'utf8')).toContain('# Elena Vasquez');
    expect(readFileSync(artifact, 'utf8')).toContain('generated by profile-as-code pac build github-readme');
  });

  it('filters by lang', () => {
    const r = run(['build', 'linkedin', '--lang', 'es', '--workspace', MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Ingeniera Senior de IA · Infraestructura Soberana de IA'); // es headline
    expect(r.stdout).not.toContain('Senior AI Engineer · Sovereign AI Infrastructure'); // en headline
  });

  it('builds all platforms when none given', () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    const r = run(['build', '--json', '--workspace', ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as { data: { platforms: { platform: string }[]; written: { platform: string; path: string }[] } };
    expect(data.data.platforms.map((p) => p.platform)).toEqual([
      'github-readme',
      'linkedin',
      'upwork',
      'x',
      'researchgate',
      'substack',
      'patreon',
    ]);
    // only renderer platforms write artifacts (github-readme in M2)
    expect(data.data.written.map((w) => w.platform)).toEqual(['github-readme']);
  });

  it('exit 2 on unknown platform', () => {
    const r = run(['build', 'bogus', '--workspace', MINIMAL]);
    expect(r.code).toBe(2);
  });

  it('exit 1 when the workspace violates the schema', () => {
    const r = run(['build', '--workspace', INVALID]);
    expect(r.code).toBe(1);
  });
});

describe('pac diff (git-based, release tags)', () => {
  it('lists commits and changed content files since the release tag', () => {
    const ws = makeGitWorkspace();
    const r = run(['diff', '--workspace', ws]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("release tag 'release-1.0'");
    expect(r.stdout).toContain('content/identity.yaml');
    expect(r.stdout).toContain('content/headlines.yaml');
    expect(r.stdout).toContain('re-verify deployed profiles');
  });

  it('--json reports files and hint', () => {
    const ws = makeGitWorkspace();
    const r = run(['diff', '--json', '--workspace', ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { tag: string | null; files: { path: string; root: string }[]; hint: string; hasChanges: boolean };
    };
    expect(data.data.tag).toBe('release-1.0');
    expect(data.data.hasChanges).toBe(true);
    expect(data.data.files).toHaveLength(2);
    expect(data.data.files.map((f) => f.root).sort()).toEqual(['headlines', 'identity']);
    expect(data.data.hint).toContain('re-verify deployed profiles');
  });

  it('exit 1 on a workspace outside any git repo', () => {
    const dir = tempDir();
    const r = run(['diff', '--workspace', dir]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('git');
  });
});

describe('pac init (scaffold)', () => {
  it('scaffolds a workspace that pac validate accepts', () => {
    const dir = join(tempDir(), 'ws');
    const r = run(['init', dir]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, 'content', 'identity.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
    expect(existsSync(join(dir, '.pacrc'))).toBe(true);
    const v = run(['validate', '--workspace', dir]);
    expect(v.code).toBe(0);
    expect(v.stdout).toContain('valid');
  });

  it('refuses to overwrite an existing content/', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'content'));
    const r = run(['init', dir]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('already exists');
  });
});

describe('pac refine (stub: template + record)', () => {
  it('emits the agent task (no LLM call) pointing at the platform skill', () => {
    const r = run(['refine', 'linkedin', '--variants', '2', '--workspace', MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('agent task');
    expect(r.stdout).toContain('Platform: linkedin');
    expect(r.stdout).toContain('Skill (communicative strategy — READ IT FIRST)');
    expect(r.stdout).toContain('Facts');
    expect(r.stdout).toContain('--choose <variantId>');
  });

  it('records the chosen variant in content/active.yaml and stays valid', () => {
    const ws = join(tempDir(), 'ws');
    copyFixture(MINIMAL, ws);
    const r = run(['refine', 'linkedin', '--lang', 'es', '--choose', 'li-es-x', '--workspace', ws]);
    expect(r.code).toBe(0);
    const active = readFileSync(join(ws, 'content', 'active.yaml'), 'utf8');
    expect(active).toContain('li-es-x');
    expect(active).toContain('lang: es');
    const v = run(['validate', '--workspace', ws]);
    expect(v.code).toBe(0);
  });

  it('exit 2 without a platform', () => {
    const r = run(['refine', '--workspace', MINIMAL]);
    expect(r.code).toBe(2);
  });
});

describe('pac check (stub) + pac skills:install (stub)', () => {
  it('lists the user checks from the schema-validated catalog', () => {
    const r = run(['check', 'github-readme', '--workspace', MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('STUB');
    expect(r.stdout).toContain('gh-bio-max');
    expect(r.stdout).toContain('geo-consistent');
    expect(r.stdout).toContain('platform=all'); // union semantics: all applies to every platform
  });

  it('check --json reports implemented:false + owner', () => {
    const r = run(['check', '--json', '--workspace', MINIMAL]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as { data: { implemented: boolean; checks: unknown[]; ownedBy: string } };
    expect(data.data.implemented).toBe(false);
    expect(data.data.checks).toHaveLength(3);
    expect(data.data.ownedBy).toContain('M3');
  });

  it('skills:install prints the skills-studio projection command', () => {
    const r = run(['skills:install', 'pi']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('bin/project.sh pi');
  });

  it('skills:install exit 2 on unknown agent', () => {
    const r = run(['skills:install', 'cobol']);
    expect(r.code).toBe(2);
  });
});

describe('workspace resolution (D14: .pacrc → configured path)', () => {
  it('resolves the workspace from .pacrc', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.pacrc'), JSON.stringify({ workspace: MINIMAL }));
    const r = run(['validate'], dir); // cwd = dir with .pacrc
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('valid');
  });

  it('resolves a RELATIVE .pacrc workspace against the .pacrc dir (regression: dirname, not file path)', () => {
    // Fixture workspace copied into a temp dir; .pacrc at its root uses the
    // documented `"workspace": "."` form (workspace root itself).
    const dir = tempDir();
    copyFixture(MINIMAL, dir);
    writeFileSync(join(dir, '.pacrc'), JSON.stringify({ workspace: '.' }));
    const r = run(['validate'], dir); // cwd = dir with .pacrc
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('valid');
    expect(r.stdout).not.toContain('no content/');
  });

  it('--workspace flag wins over .pacrc', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.pacrc'), JSON.stringify({ workspace: '/nonexistent' }));
    const r = run(['validate', '--workspace', MINIMAL], dir);
    expect(r.code).toBe(0);
  });
});

/** Recursive copy of a fixture workspace into a temp dir (tests mutate it). */
function copyFixture(from: string, to: string): void {
  execFileSync('cp', ['-R', from + '/.', to + '/']);
}
