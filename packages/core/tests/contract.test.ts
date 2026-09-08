/**
 * Contract tests for the platform set (D16, issue #30): Postiz parity + operator
 * extras. Guards the single-source discipline the schema documents:
 *   - core `PLATFORMS` mirrors the schema enum (the two must never drift)
 *   - PLATFORMS has no duplicates
 *   - behavior: new platform hosts are recognized by drift (patreon regression,
 *     ghost subdomains) and accepted by load (checks + bios on new platforms)
 */

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATFORMS, driftCheck, load } from '../src/index.js';

const SCHEMA = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../schema/profile.schema.json', import.meta.url)),
    'utf8',
  ),
) as { $defs: { platform: { enum: string[] }; check: { properties: { platform: { enum: string[] } } } } };

function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pasco-contract-'));
  const content = join(dir, 'content');
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(content, name), body, 'utf8');
  }
  return dir;
}

const clean = (dir: string) => rmSync(dir, { recursive: true, force: true });

describe('platform set contract (D16)', () => {
  it('PLATFORMS mirrors the schema enum exactly', () => {
    expect([...PLATFORMS]).toEqual(SCHEMA.$defs.platform.enum);
  });

  it('PLATFORMS has no duplicates', () => {
    expect(new Set(PLATFORMS).size).toBe(PLATFORMS.length);
  });

  it('check.platform enum == ["all", ...platform] (schema dedup contract)', () => {
    expect(SCHEMA.$defs.check.properties.platform.enum).toEqual(['all', ...SCHEMA.$defs.platform.enum]);
  });
});

describe('drift recognizes the new platforms (Postiz parity + extras)', () => {
  // identity.links only holds the website — every platform-host project link is
  // an uncanonicalized duplicate and must warn.
  const makeProfile = () =>
    makeWorkspace({
      'identity.yaml': `name: Test
location: Test City
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      'projects.yaml': `- name: Demo
  links:
    - https://patreon.com/testcreator
    - https://blog.ghost.io/hello-world
    - https://twitch.tv/teststreamer
    - https://moltbook.com/u/test
`,
    });

  it('warns on platform-host URLs missing from identity.links (patreon regression)', () => {
    const dir = makeProfile();
    try {
      const issues = driftCheck(load(dir));
      const codes = issues.map((i) => i.code);
      expect(codes).toContain('drift/url-not-in-identity');
      // patreon.com specifically (was missing from PLATFORM_HOSTS before D16)
      expect(issues.some((i) => i.path === 'projects[0].links[0]')).toBe(true);
    } finally {
      clean(dir);
    }
  });

  it('treats ghost subdomains as platform surfaces (v1.2 operator extra)', () => {
    const dir = makeProfile();
    try {
      const issues = driftCheck(load(dir));
      expect(issues.some((i) => i.code === 'drift/url-not-in-identity' && i.path === 'projects[0].links[1]')).toBe(true);
    } finally {
      clean(dir);
    }
  });

  it('treats twitch and moltbook as platform surfaces (Postiz parity)', () => {
    const dir = makeProfile();
    try {
      const issues = driftCheck(load(dir));
      const paths = issues.filter((i) => i.code === 'drift/url-not-in-identity').map((i) => i.path);
      expect(paths).toContain('projects[0].links[2]'); // twitch.tv
      expect(paths).toContain('projects[0].links[3]'); // moltbook.com
    } finally {
      clean(dir);
    }
  });

  it('does not warn for open-ended instance hosts (mastodon beyond curated)', () => {
    const dir = makeWorkspace({
      'identity.yaml': `name: Test
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      'projects.yaml': `- name: Demo
  links:
    - https://fosstodon.org/@someone
`,
    });
    try {
      const issues = driftCheck(load(dir));
      expect(issues.some((i) => i.code === 'drift/url-not-in-identity' && i.path.includes('projects'))).toBe(false);
    } finally {
      clean(dir);
    }
  });
});

describe('load accepts new platforms (schema parity end-to-end)', () => {
  it('validates bios/checks using v1.2 platforms (ghost, devto, linkedin-page)', () => {
    const dir = makeWorkspace({
      'identity.yaml': `name: Test
links:
  - platform: website
    label: Site
    url: https://example.org
`,
      'bios.yaml': `- platform: ghost
  lang: en
  length: short
  text: Ghost bio for the v1.2 set.
- platform: devto
  lang: en
  length: medium
  text: Dev.to bio for the Postiz-parity set.
`,
      'checks.yaml': `- platform: linkedin-page
  rule: max-chars
  value: 200
`,
    });
    try {
      const profile = load(dir);
      expect(profile.bios?.map((b) => b.platform)).toEqual(['ghost', 'devto']);
      expect(profile.checks?.[0]?.platform).toBe('linkedin-page');
    } finally {
      clean(dir);
    }
  });
});
