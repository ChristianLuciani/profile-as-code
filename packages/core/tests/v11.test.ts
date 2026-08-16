/**
 * Schema v1.1 (additive — semver minor): every v1 workspace must still validate,
 * and the new forms must load + normalize. See schema/profile.schema.json
 * (v1.1 additions: role/org langMap, highlights string[] per lang, root
 * education + languages, publication.authors/url, identity.handle/timezone).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { load } from '../src/index.js';

/** Create a throwaway workspace with the given content files. */
function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pac-v11-'));
  const content = join(dir, 'content');
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(content, name), body, 'utf8');
  }
  return dir;
}

const IDENTITY = 'name: Elena Vasquez\n';

describe('schema v1.1 (additive)', () => {
  it('accepts v1 shapes unchanged (role/org string, highlights langMap-of-strings)', () => {
    const dir = makeWorkspace({
      'identity.yaml': IDENTITY,
      'experience.yaml': [
        '- role: Senior AI Engineer',
        '  org: Nimbus Labs',
        '  start: 2022-03-01',
        '  end: present',
        '  highlights:',
        '    en: Lead the sovereign inference stack.',
        '',
      ].join('\n'),
    });
    const profile = load(dir);
    expect(profile.experience[0]?.role).toBe('Senior AI Engineer');
    expect(profile.experience[0]?.highlights?.en).toBe('Lead the sovereign inference stack.');
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('accepts role/org as langMap + highlights as string[] (langMapList)', () => {
    const dir = makeWorkspace({
      'identity.yaml': IDENTITY,
      'experience.yaml': [
        '- role:',
        '    en: Strategic Systems Consultant',
        '    es: Consultor Estratégico de Sistemas',
        '  org:',
        '    en: USFQ — Quito, Ecuador',
        '    es: USFQ — Quito, Ecuador',
        '  start: 2019-01-01',
        '  end: 2024-12-01',
        '  highlights:',
        '    en:',
        '      - 800+ students per year',
        '      - 36 original laboratory guides',
        '    es:',
        '      - 800+ estudiantes anuales',
        '      - 36 guías de laboratorio originales',
        '',
      ].join('\n'),
    });
    const profile = load(dir);
    const item = profile.experience[0]!;
    expect(item.role).toEqual({ en: 'Strategic Systems Consultant', es: 'Consultor Estratégico de Sistemas' });
    expect(item.org).toEqual({ en: 'USFQ — Quito, Ecuador', es: 'USFQ — Quito, Ecuador' });
    expect(item.highlights?.en).toEqual(['800+ students per year', '36 original laboratory guides']);
    expect(item.highlights?.es).toEqual(['800+ estudiantes anuales', '36 guías de laboratorio originales']);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('rejects langMap with an unsupported key (key-guard still enforced on arrays)', () => {
    const dir = makeWorkspace({
      'identity.yaml': IDENTITY,
      'experience.yaml': [
        '- role: R',
        '  org: O',
        '  start: 2020-01-01',
        '  highlights:',
        '    en:',
        '      - One',
        '    de:',
        '      - Eins',
        '',
      ].join('\n'),
    });
    expect(() => load(dir)).toThrow(/unsupported language key 'de'/);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('accepts root education + languages and normalizes to empty arrays when absent', () => {
    const dir = makeWorkspace({
      'identity.yaml': IDENTITY,
      'education.yaml': [
        '- degree: B.Sc. in Physics',
        '  institution:',
        '    en: Central University of Venezuela',
        '    es: Universidad Central de Venezuela',
        '  field: Physics',
        '  start: 1997-01-01',
        '  end: 2003-12-01',
        '  note:',
        '    en: "Thesis: N-Dimensional Cosmological Models"',
        '    es: "Tesis: Modelos Cosmológicos N-Dimensionales"',
        '',
      ].join('\n'),
      'languages.yaml': [
        '- code: es',
        '  level: native',
        '- code: en',
        '  level: intermediate',
        '- code: fr',
        '  level: basic',
        '',
      ].join('\n'),
    });
    const profile = load(dir);
    expect(profile.education).toHaveLength(1);
    expect(profile.education[0]?.institution).toEqual({
      en: 'Central University of Venezuela',
      es: 'Universidad Central de Venezuela',
    });
    expect(profile.languages?.map((l) => `${l.code}:${l.level}`)).toEqual([
      'es:native',
      'en:intermediate',
      'fr:basic',
    ]);
    // normalizeProfile defaults absent collections to [] (identity-only workspace).
    const minimalDir = makeWorkspace({ 'identity.yaml': IDENTITY });
    const minimal = load(minimalDir);
    expect(minimal.education).toEqual([]);
    expect(minimal.languages).toEqual([]);
    try {
      rmSync(dir, { recursive: true, force: true });
      rmSync(minimalDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('accepts publication.authors/url without DOI (preprint / abstract)', () => {
    const dir = makeWorkspace({
      'identity.yaml': IDENTITY,
      'publications.yaml': [
        '- title: Hydrochars from Lignocellulosic Residues',
          '  venue: ResearchGate preprint',
          '  year: 2023',
          '  authors: Landázuri et al.',
          '  url: https://www.researchgate.net/publication/383276828',
          '  orcidId: 0000-0002-6955-5384',
          '',
      ].join('\n'),
    });
    const profile = load(dir);
    const pub = profile.publications[0]!;
    expect(pub.doi).toBeUndefined();
    expect(pub.url).toBe('https://www.researchgate.net/publication/383276828');
    expect(pub.authors).toBe('Landázuri et al.');
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('accepts identity.handle/timezone', () => {
    const dir = makeWorkspace({
      'identity.yaml': [
        'name: Elena Vasquez',
        'handle: elena_v',
        'timezone: America/Guayaquil',
        '',
      ].join('\n'),
    });
    const profile = load(dir);
    expect(profile.identity.handle).toBe('elena_v');
    expect(profile.identity.timezone).toBe('America/Guayaquil');
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });
});
