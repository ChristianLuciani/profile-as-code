import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile, load, PLATFORMS } from '../src/index.js';
import type { Platform } from '../src/index.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const minimal = () => load(fixture('minimal'));

describe('compile(profile, platform, lang)', () => {
  it('accepts every platform in the schema enum (incl. patreon)', () => {
    const platforms: readonly Platform[] = [
      'github-readme',
      'linkedin',
      'upwork',
      'x',
      'researchgate',
      'substack',
      'patreon',
    ];
    for (const p of platforms) {
      expect(() => compile(minimal(), p, 'en')).not.toThrow();
    }
  });

  it('PLATFORMS mirrors the schema enum (single source of truth guard)', () => {
    // Regression guard for the duplication fix: packages/core/src/types.ts PLATFORMS
    // must never drift from schema/profile.schema.json $defs.platform.enum.
    const schema = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../schema/profile.schema.json', import.meta.url)), 'utf8'),
    ) as { $defs: { platform: { enum: string[] } } };
    expect([...PLATFORMS].sort()).toEqual([...schema.$defs.platform.enum].sort());
  });

  it('slices bios and headlines by platform+lang', () => {
    const compiled = compile(minimal(), 'linkedin', 'en');

    expect(compiled.bios).toHaveLength(1);
    expect(compiled.bios[0]?.text).toContain('Senior AI engineer');
    expect(compiled.headlines).toHaveLength(1);
    expect(compiled.headlines[0]?.text).toContain('Senior AI Engineer');
  });

  it('returns the language-aware text for es, falling back to en where es is absent', () => {
    const compiled = compile(minimal(), 'linkedin', 'es');

    expect(compiled.bios[0]?.lang).toBe('es');
    expect(compiled.statement).toContain('Ingeniera de IA'); // es exists
    expect(compiled.audiences.recruiter).toContain('Ingeniera senior'); // es exists
    // academia has no es → falls back to en and is recorded
    expect(compiled.audiences.academia).toContain('generative-engine optimization');
    expect(compiled.fallbacks).toContain('positioning.audiences.academia');
  });

  it('falls back entirely to en for an untranslated lang and records every path', () => {
    const compiled = compile(minimal(), 'linkedin', 'fr');

    expect(compiled.statement).toContain('AI engineer building');
    expect(compiled.fallbacks).toEqual(
      expect.arrayContaining([
        'positioning.statement',
        'positioning.audiences.recruiter',
        'positioning.audiences.academia',
        'positioning.geo.citationsGoal',
      ]),
    );
  });

  it('passes facts through untouched (same values as the source profile)', () => {
    const profile = minimal();
    const compiled = compile(profile, 'github-readme', 'en');

    expect(compiled.identity).toEqual(profile.identity);
    expect(compiled.experience).toEqual(profile.experience);
    expect(compiled.projects).toEqual(profile.projects);
    expect(compiled.publications).toEqual(profile.publications);
    expect(compiled.skills).toEqual(profile.skills);
  });

  it('filters user checks to the platform (plus platform "all")', () => {
    const compiled = compile(minimal(), 'github-readme', 'en');
    expect(compiled.checks.map((c) => c.id)).toEqual(['gh-bio-max', 'geo-anchors']);

    const x = compile(minimal(), 'x', 'en');
    expect(x.checks.map((c) => c.id)).toEqual(['x-bio-short', 'geo-anchors']);
  });

  it('carries the active variant for the platform', () => {
    const compiled = compile(minimal(), 'linkedin', 'en');
    expect(compiled.active?.variantId).toBe('li-en-2025-01');
    expect(compile(minimal(), 'x', 'en').active).toBeUndefined();
  });

  it('exposes per-platform SEO keywords and GEO keywords', () => {
    const compiled = compile(minimal(), 'github-readme', 'en');
    expect(compiled.keywords.seo).toEqual(['sovereign AI', 'ML platform engineer']);
    expect(compiled.keywords.geo?.associations).toContain('sovereign AI');

    const substack = compile(minimal(), 'substack', 'en');
    expect(substack.keywords.seo).toEqual([]); // no seo set for substack
  });

  it('throws a TypeError for platforms/languages outside the contract enum', () => {
    expect(() => compile(minimal(), 'myspace' as Platform, 'en')).toThrow(TypeError);
    expect(() => compile(minimal(), 'linkedin', 'de' as never)).toThrow(TypeError);
  });

  it('returns empty slices for a platform with no curated content (valid, not an error)', () => {
    const compiled = compile(minimal(), 'researchgate', 'en');
    expect(compiled.bios).toEqual([]);
    expect(compiled.headlines).toEqual([]);
    expect(compiled.identity.name).toBe('Elena Vasquez');
  });
});
