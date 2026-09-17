import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { geoCheck, load } from '../src/index.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('geoCheck(profile)', () => {
  it('produces a weighted report with a 0..100 score for the minimal fixture', () => {
    const profile = load(fixture('minimal'));
    const report = geoCheck(profile);

    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.checks).toHaveLength(8);

    // weights add up to 1
    const totalWeight = report.checks.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 5);

    // sections partition the checks
    const flat = Object.values(report.sections).flatMap((s) => s.checks);
    expect(flat).toHaveLength(report.checks.length);
  });

  it('scores fact consistency from conflicts + platform coverage (substack has a headline but no bio)', () => {
    const report = geoCheck(load(fixture('minimal')));
    const section = report.sections.factConsistency;

    expect(section.score).toBeGreaterThanOrEqual(90); // no contradictions; bio coverage 4/5
    const bioCoverage = report.checks.find((c) => c.code === 'geo/platform-bio-coverage');
    expect(bioCoverage?.score).toBeCloseTo(4 / 5, 5);
    expect(bioCoverage?.detail).toContain('substack');
  });

  it('exposes machine-readable schema.org Person readiness for the web renderer', () => {
    const report = geoCheck(load(fixture('minimal')));
    const { readiness } = report.sections.structuredData;

    expect(readiness.ready).toBe(true);
    // name + sameAs + image + address + jobTitle + worksFor = 6 of 7 (v1.5 counts
    // identity.email in the completeness denominator — issue #71; the fixture has none).
    expect(readiness.completeness).toBeCloseTo(6 / 7, 5);
    expect(readiness.fields.name).toBe(true);
    expect(readiness.fields.sameAs).toHaveLength(5);
    expect(readiness.fields.jobTitle).toBe('Senior AI Engineer');
    expect(readiness.fields.worksFor).toBe('Nimbus Labs');
    expect(readiness.fields.address).toBe('Madrid, Spain');

    expect(readiness.jsonLd?.['@type']).toBe('Person');
    expect(readiness.jsonLd?.sameAs).toContain('https://github.com/elenavasquez');
    expect(readiness.jsonLd?.jobTitle).toBe('Senior AI Engineer');
  });

  it('emits schema.org email on Person JSON-LD (v1.5, issue #71) and counts it toward completeness', () => {
    const profile = load(fixture('minimal'));
    profile.identity.email = 'elena@example.com';
    const { readiness } = geoCheck(profile).sections.structuredData;

    expect(readiness.completeness).toBe(1); // … + email = 7/7
    expect(readiness.fields.email).toBe('elena@example.com');
    expect(readiness.jsonLd?.['email']).toBe('elena@example.com');
    // sameAs stays page-URLs-only: the mailto: href is output-only (renderer), never sameAs.
    expect(readiness.jsonLd?.sameAs).not.toContain('mailto:elena@example.com');
  });

  it('reports semantic-association anchors with per-anchor reinforcement', () => {
    const report = geoCheck(load(fixture('minimal')));
    const { anchors } = report.sections.semanticAssociations;
    const check = report.checks.find((c) => c.code === 'geo/semantic-anchors');

    expect(anchors.anchors).toHaveLength(3);
    expect(anchors.missing).toEqual([]);
    expect(anchors.coverage).toBe(1);
    expect(check?.score).toBe(1);
    expect(check?.detail).toContain('3/3 anchors reinforced');
  });

  it('drops the anchor score to 0 when no positioning.geo anchors exist', () => {
    const profile = load(fixture('minimal'));
    const bare = { identity: profile.identity };
    const report = geoCheck(bare);

    const check = report.checks.find((c) => c.code === 'geo/semantic-anchors');
    expect(check?.score).toBe(0);
    expect(check?.detail).toContain('no positioning.geo.semanticAssociations defined');
    expect(report.sections.semanticAssociations.anchors.coverage).toBe(0);
  });

  it('scores citability from DOI/ORCID and evidence[]', () => {
    const report = geoCheck(load(fixture('minimal')));
    const pubs = report.checks.find((c) => c.code === 'geo/citable-publications');
    const evidence = report.checks.find((c) => c.code === 'geo/evidence-claims');

    expect(pubs?.score).toBe(1); // 2/2 publications carry a DOI
    expect(evidence?.score).toBe(0.5); // 1/2 projects carry evidence
  });

  it('flags contradictions in the drifting fixture (report, not a gate)', () => {
    const minimal = geoCheck(load(fixture('minimal')));
    const drifting = geoCheck(load(fixture('drifting')));
    const conflicts = drifting.checks.find((c) => c.code === 'geo/conflicts');

    expect(conflicts?.score).toBeLessThan(1);
    expect(conflicts?.detail).toContain('contradiction(s)');
    expect(drifting.score).toBeLessThan(minimal.score);
  });

  it('is neutral (not penalizing) on missing data', () => {
    const profile = load(fixture('minimal'));
    const bare = { identity: profile.identity };
    const report = geoCheck(bare);

    expect(report.checks.find((c) => c.code === 'geo/citable-publications')?.score).toBe(1);
    expect(report.checks.find((c) => c.code === 'geo/evidence-claims')?.score).toBe(1);
    expect(report.checks.find((c) => c.code === 'geo/platform-bio-coverage')?.score).toBe(1);
  });

  it('empty location counts as absent in the entity-fields check (empty=absent sweep, issue #86)', () => {
    const profile = load(fixture('minimal'));
    profile.identity.location = '';
    const report = geoCheck(profile);
    const check = report.checks.find((c) => c.code === 'geo/structured-person');

    expect(report.sections.structuredData.readiness.fields.address).toBeUndefined();
    expect(check?.detail).toContain('location: no');
  });

  it('empty-string langMap role counts as absent in the entity-fields check (textOf parity, issue #86)', () => {
    const profile = load(fixture('minimal'));
    (profile.experience[0] as { role: unknown }).role = { en: '' };
    const report = geoCheck(profile);
    const check = report.checks.find((c) => c.code === 'geo/structured-person');

    expect(report.sections.structuredData.readiness.fields.jobTitle).toBeUndefined();
    expect(check?.detail).toContain('jobTitle: no');
  });
});
