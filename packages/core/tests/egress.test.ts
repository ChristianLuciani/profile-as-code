/**
 * D28 egress authorization — the CONTRACT (SPEC §7.11, issue #503 slice S503a).
 *
 * What this file pins:
 *  - the manifest names every row the scope discloses, addressed on the SSOT
 *    (`block:id`, `block[index]` for a row without one) and never on the
 *    filtered projection — filtering shifts indices, so a projection key would
 *    make every surviving row look new;
 *  - the digest is deterministic and covers the payload, so a visibility flip or
 *    a text edit changes it while the run metadata cannot;
 *  - private → public is a TRANSITION against the recorded baseline, and `null`
 *    (no baseline) detects nothing — the declared S503a limit;
 *  - the audit record carries operation · digest · keyId (`null` until S503b) ·
 *    timestamp, and the parser reports a malformed line instead of repairing or
 *    dropping it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  disclosureUnits,
  EGRESS_BLOCKS,
  EGRESS_MANIFEST_VERSION,
  egressAuditLine,
  egressAuditRecord,
  egressBaselineHash,
  egressBaselineOf,
  egressLineHash,
  egressManifest,
  egressSeal,
  load,
  newlyPublicUnits,
  parseEgressAudit,
  verifyEgressState,
} from "../src/index.js";
import type { LoadedProfile } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACHIEVEMENTS = join(__dirname, "fixtures", "achievements");

/** The committed fixture: mixed visibility across the five gated blocks. */
function fixture(): LoadedProfile {
  return load(ACHIEVEMENTS);
}

function keysOf(profile: LoadedProfile, scope: "public" | "all"): string[] {
  return egressManifest(profile, scope).units.map((unit) => unit.key);
}

describe("egress manifest — what leaves, and how it is addressed", () => {
  it("names the five gated blocks in one declared set", () => {
    // The four migration blocks + achievements (the field is required there):
    // a block added to VISIBILITY_BLOCKS without appearing here would be a
    // silent egress hole, so the set is asserted, not assumed.
    expect([...EGRESS_BLOCKS]).toEqual([
      "credentials",
      "artifacts",
      "projects",
      "experience",
      "achievements",
    ]);
  });

  it("the public manifest is the public rows only", () => {
    const publicKeys = keysOf(fixture(), "public");
    expect(publicKeys).toContain("credentials:cred-aws");
    expect(publicKeys).toContain("achievements:ach-tutors");
    expect(publicKeys).not.toContain("credentials:cred-internal");
    expect(publicKeys).not.toContain("achievements:ach-reconcile-time");
  });

  it("the --all manifest is every row of the gated blocks, private included", () => {
    const all = keysOf(fixture(), "all");
    expect(all).toContain("credentials:cred-aws");
    expect(all).toContain("credentials:cred-internal");
    expect(all).toContain("achievements:ach-reconcile-time");
    expect(all.length).toBeGreaterThan(keysOf(fixture(), "public").length);
  });

  it("a row without an id is addressed at its SSOT index, not its filtered one", () => {
    const profile = fixture();
    // index 0 is PRIVATE, index 1 is public: a key derived from the projection
    // would call the public row `projects[0]` and rename it whenever the private
    // sibling is removed.
    profile.projects = [
      { name: "shadowed-private" } as LoadedProfile["projects"][number],
      { name: "public-no-id", visibility: "public" } as LoadedProfile["projects"][number],
    ];
    const projectsOf = (scope: "public" | "all") =>
      disclosureUnits(profile, scope).filter((unit) => unit.block === "projects");
    const publicUnits = projectsOf("public");
    expect(publicUnits.map((unit) => unit.key)).toEqual(["projects[1]"]);
    expect(publicUnits[0]?.index).toBe(1);
    expect(projectsOf("all").map((unit) => unit.key)).toEqual(["projects[0]", "projects[1]"]);
  });

  it("is deterministic, scope-specific and payload-specific", () => {
    const first = egressManifest(fixture(), "public");
    const second = egressManifest(fixture(), "public");
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(egressManifest(fixture(), "all").digest).not.toBe(first.digest);

    const edited = fixture();
    edited.identity.definition = { en: "a different definition" };
    expect(egressManifest(edited, "public").digest).not.toBe(first.digest);
  });

  it("flipping a row to public changes the digest (the payload changed)", () => {
    const before = egressManifest(fixture(), "public");
    const flipped = fixture();
    const row = flipped.credentials.find((credential) => credential.id === "cred-internal");
    if (row === undefined) throw new Error("fixture lost cred-internal");
    row.visibility = "public";
    const after = egressManifest(flipped, "public");
    expect(after.units.map((unit) => unit.key)).toContain("credentials:cred-internal");
    expect(after.digest).not.toBe(before.digest);
  });
});

describe("private → public — a transition against the recorded baseline", () => {
  it("no baseline detects nothing (the declared S503a limit)", () => {
    expect(newlyPublicUnits(egressManifest(fixture(), "public"), null)).toEqual([]);
  });

  it("reports exactly the units public now that were not public before", () => {
    const profile = fixture();
    const manifest = egressManifest(profile, "public");
    const before = egressBaselineOf(egressManifest(profile, "public"), "2026-11-09T00:00:00.000Z");
    // Remove one public unit from the recorded baseline: it is the one that
    // "became public" since that egress.
    const dropped = manifest.units[0]?.key;
    if (dropped === undefined) throw new Error("fixture has no public unit");
    const stale = { ...before, publicUnits: before.publicUnits.filter((key) => key !== dropped) };
    expect(newlyPublicUnits(manifest, stale).map((unit) => unit.key)).toEqual([dropped]);
  });

  it("a baseline equal to the manifest has no transition (a second run is not privileged)", () => {
    const manifest = egressManifest(fixture(), "public");
    const baseline = egressBaselineOf(manifest, "2026-11-09T00:00:00.000Z");
    expect(newlyPublicUnits(manifest, baseline)).toEqual([]);
  });

  it("the baseline is built from the PUBLIC manifest only (—all publishes nothing)", () => {
    const all = egressManifest(fixture(), "all");
    expect(() => egressBaselineOf(all, "2026-11-09T00:00:00.000Z")).toThrow(/public manifest/);
  });

  it("a delete + insert at the same id-less position is NOT detected (the declared limit)", () => {
    // Pinned as a LIMIT, not a promise: the index address is only as stable as
    // the block's order. An id-addressed row has no such hole — the public
    // manifest keeps every id-addressed key of this fixture.
    type Project = LoadedProfile["projects"][number];
    const before = fixture();
    before.projects = [{ name: "old-public", visibility: "public" } as Project];
    const baseline = egressBaselineOf(egressManifest(before, "public"), "2026-11-09T00:00:00.000Z");

    const after = fixture();
    after.projects = [{ name: "new-public", visibility: "public" } as Project];
    const manifest = egressManifest(after, "public");

    // Same key, different row, different payload: the gate cannot tell, and it
    // says so in SPEC §7.11 instead of claiming it never happens.
    expect(manifest.units.map((unit) => unit.key)).toContain("projects[0]");
    expect(newlyPublicUnits(manifest, baseline)).toEqual([]);
    expect(manifest.digest).not.toBe(baseline.digest);
  });
});

describe("the integrity chain — the line and its memory are bound (#520)", () => {
  const manifest = egressManifest(fixture(), "public");

  it("the seal binds the line and the baseline to each other, and to prev", () => {
    const first = egressSeal({
      at: "2026-11-12T00:00:00.000Z",
      operation: "export-profile",
      manifest,
      publicManifest: manifest,
      reasons: [],
      keyId: null,
      baseline: "absent",
      prev: null,
    });
    expect(first.record.prev).toBeNull();
    expect(first.baseline.logTail).toBe(first.record.hash);
    const { logTail: _logTail, ...content } = first.baseline;
    expect(first.record.baselineHash).toBe(egressBaselineHash(content));
    const { hash: _hash, baselineHash: _baselineHash, ...core } = first.record;
    expect(first.record.hash).toBe(egressLineHash(core));

    // The second egress links to the first line's hash.
    const second = egressSeal({
      at: "2026-11-12T00:00:01.000Z",
      operation: "build",
      manifest,
      publicManifest: manifest,
      reasons: [],
      keyId: null,
      baseline: "recorded",
      prev: first.record.hash,
    });
    expect(second.record.prev).toBe(first.record.hash);
    expect(second.baseline.logTail).toBe(second.record.hash);
  });

  it("the hash rules are exact: content-sensitive, deterministic, exclusions honored", () => {
    const core = {
      version: EGRESS_MANIFEST_VERSION,
      at: "2026-11-12T00:00:00.000Z",
      operation: "build" as const,
      scope: "public" as const,
      digest: manifest.digest,
      units: 3,
      keyId: null,
      method: "none" as const,
      reasons: [],
      baseline: "absent" as const,
      prev: null,
    };
    expect(egressLineHash(core)).toBe(egressLineHash({ ...core }));
    expect(egressLineHash(core)).not.toBe(egressLineHash({ ...core, units: 4 }));
    // baselineHash is EXCLUDED from the line hash: editing the binding the line
    // records does not move the chain link — the CONTENT binding catches it.
    const sealed = egressSeal({
      at: core.at,
      operation: "build",
      manifest,
      publicManifest: manifest,
      reasons: [],
      keyId: null,
      baseline: "absent",
      prev: null,
    });
    const retampered = { ...sealed.record, baselineHash: `sha256:${"0".repeat(64)}` };
    const { hash: _h, baselineHash: _b, ...retamperedCore } = retampered;
    expect(egressLineHash(retamperedCore)).toBe(sealed.record.hash);
    // logTail is EXCLUDED from the baseline hash for the same reason.
    const { logTail: _lt, ...content } = sealed.baseline;
    expect(egressBaselineHash(content)).toBe(sealed.record.baselineHash);
  });

  it("the seal always records the PUBLIC manifest in the baseline (--all publishes nothing)", () => {
    const all = egressManifest(fixture(), "all");
    const sealed = egressSeal({
      at: "2026-11-12T00:00:00.000Z",
      operation: "export-profile",
      manifest: all,
      publicManifest: manifest,
      reasons: ["full-export"],
      keyId: null,
      baseline: "absent",
      prev: null,
    });
    expect(sealed.record.digest).toBe(all.digest);
    expect(sealed.baseline.digest).toBe(manifest.digest);
  });

  it("verifyEgressState — the honest pair is `recorded`; both files missing is `absent`", () => {
    const sealed = egressSeal({
      at: "2026-11-12T00:00:00.000Z",
      operation: "export-profile",
      manifest,
      publicManifest: manifest,
      reasons: [],
      keyId: null,
      baseline: "absent",
      prev: null,
    });
    const log = `${egressAuditLine(sealed.record)}`;
    const baseline = `${JSON.stringify(sealed.baseline, null, 2)}\n`;
    expect(verifyEgressState(null, null)).toEqual({
      state: "absent",
      baseline: null,
      tailHash: null,
    });
    const ok = verifyEgressState(log, baseline);
    expect(ok.state).toBe("recorded");
    expect(ok.baseline).toEqual(sealed.baseline);
    expect(ok.tailHash).toBe(sealed.record.hash);
  });

  it("verifyEgressState — every tamper reads as `unreadable` with the exact problem", () => {
    const sealed = egressSeal({
      at: "2026-11-12T00:00:00.000Z",
      operation: "export-profile",
      manifest,
      publicManifest: manifest,
      reasons: [],
      keyId: null,
      baseline: "absent",
      prev: null,
    });
    const log = egressAuditLine(sealed.record);
    const baseline = `${JSON.stringify(sealed.baseline, null, 2)}\n`;
    const unreadable = (logText: string | null, baselineText: string | null, pattern: RegExp) => {
      const read = verifyEgressState(logText, baselineText);
      expect(read.state).toBe("unreadable");
      expect(read.baseline).toBeNull();
      expect(read.problem).toMatch(pattern);
    };

    unreadable(log, null, /missing while .*audit\.log has 1 record/);
    unreadable(null, baseline, /baseline\.json exists but .*audit\.log does not/);
    unreadable("", baseline, /is empty but/);
    unreadable(`${log}garbage\n`, baseline, /line 2/);
    const edited = JSON.parse(log) as Record<string, unknown>;
    edited.operation = "post-export";
    unreadable(`${JSON.stringify(edited)}\n`, baseline, /line 1: hash does not recompute/);
    // a stale logTail: the baseline binds to a line that is no longer the tail
    const second = egressSeal({
      at: "2026-11-12T00:00:01.000Z",
      operation: "build",
      manifest,
      publicManifest: manifest,
      reasons: [],
      keyId: null,
      baseline: "recorded",
      prev: sealed.record.hash,
    });
    unreadable(
      `${log}${egressAuditLine(second.record)}`,
      baseline,
      /binds to .* the log's tail is/,
    );
    // a cache edited behind the producing line's back
    const tamperedBaseline = {
      ...sealed.baseline,
      publicUnits: [...sealed.baseline.publicUnits, "projects:backdoor"],
    };
    unreadable(
      log,
      `${JSON.stringify(tamperedBaseline)}\n`,
      /does not match the line that produced it/,
    );
    // a chain with no genesis
    const noGenesis = { ...sealed.record, prev: `sha256:${"1".repeat(64)}` };
    const { hash: _h, baselineHash: _b, ...noGenesisCore } = noGenesis;
    const resignedNoGenesis = { ...noGenesis, hash: egressLineHash(noGenesisCore) };
    unreadable(egressAuditLine(resignedNoGenesis), baseline, /no chain genesis/);
  });

  it("verifyEgressState — an old segment's break is tolerated after a re-arm genesis", () => {
    const broken = egressSeal({
      at: "2026-11-12T00:00:00.000Z",
      operation: "export-profile",
      manifest,
      publicManifest: manifest,
      reasons: [],
      keyId: null,
      baseline: "absent",
      prev: null,
    });
    const falsified = { ...broken.record, operation: "post-export" as const };
    const rearm = egressSeal({
      at: "2026-11-12T00:00:01.000Z",
      operation: "build",
      manifest,
      publicManifest: manifest,
      reasons: ["baseline-unreadable"],
      keyId: null,
      baseline: "unreadable",
      prev: null,
    });
    const log = `${egressAuditLine(falsified)}${egressAuditLine(rearm.record)}`;
    const baseline = `${JSON.stringify(rearm.baseline, null, 2)}\n`;
    const read = verifyEgressState(log, baseline);
    expect(read.state).toBe("recorded");
    expect(read.tailHash).toBe(rearm.record.hash);
  });

  it("verifyEgressState — a v1 (pre-chain) state is unreadable, never clean", () => {
    const v1Log = `${JSON.stringify({
      version: 1,
      at: "2026-11-01T00:00:00.000Z",
      operation: "export-profile",
      scope: "public",
      digest: manifest.digest,
      units: 2,
      keyId: null,
      method: "none",
      reasons: [],
      baseline: "absent",
    })}\n`;
    const v1Baseline = `${JSON.stringify({
      version: 1,
      at: "2026-11-01T00:00:00.000Z",
      digest: manifest.digest,
      publicUnits: ["projects:alpha"],
    })}\n`;
    const read = verifyEgressState(v1Log, v1Baseline);
    expect(read.state).toBe("unreadable");
    expect(read.problem).toMatch(/version|prev|baselineHash|hash/);
  });
});

describe("the audit record — operation · digest · keyId · timestamp", () => {
  const manifest = egressManifest(fixture(), "public");

  it("records the four D28 fields, the key ABSENCE and the method that authorized it", () => {
    const record = egressAuditRecord({
      at: "2026-11-09T12:00:00.000Z",
      operation: "build",
      manifest,
      reasons: ["private-to-public"],
      keyId: null,
      baseline: "recorded",
      prev: null,
    });
    expect(record.version).toBe(EGRESS_MANIFEST_VERSION);
    expect(record.at).toBe("2026-11-09T12:00:00.000Z");
    expect(record.operation).toBe("build");
    expect(record.digest).toBe(manifest.digest);
    expect(record.keyId).toBeNull(); // no key exists in S503a — never a fake id
    expect(record.method).toBe("digest-confirm");
    expect(record.reasons).toEqual(["private-to-public"]);
    expect(record.baseline).toBe("recorded");
  });

  it("an unprivileged egress is recorded as `none`, with no reasons", () => {
    const record = egressAuditRecord({
      at: "2026-11-09T12:00:00.000Z",
      operation: "export-profile",
      manifest,
      reasons: [],
      keyId: null,
      baseline: "absent",
      prev: null,
    });
    expect(record.method).toBe("none");
    expect(record.reasons).toEqual([]);
  });

  it("the line is one JSONL record terminated by a newline", () => {
    const line = egressAuditLine(
      egressSeal({
        at: "2026-11-09T12:00:00.000Z",
        operation: "build",
        manifest,
        publicManifest: manifest,
        reasons: [],
        keyId: null,
        baseline: "absent",
        prev: null,
      }).record,
    );
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);
    expect((JSON.parse(line) as { digest: string }).digest).toBe(manifest.digest);
  });

  it("appending never rewrites: the parsed prefix is the previous log", () => {
    const first = egressAuditLine(
      egressSeal({
        at: "2026-11-09T12:00:00.000Z",
        operation: "build",
        manifest,
        publicManifest: manifest,
        reasons: [],
        keyId: null,
        baseline: "absent",
        prev: null,
      }).record,
    );
    const second = egressAuditLine(
      egressSeal({
        at: "2026-11-09T12:00:01.000Z",
        operation: "export-profile",
        manifest,
        publicManifest: manifest,
        reasons: [],
        keyId: null,
        baseline: "recorded",
        prev: parseEgressAudit(first).records[0]?.hash ?? null,
      }).record,
    );
    const log = `${first}${second}`;
    expect(log.startsWith(first)).toBe(true);
    const parsed = parseEgressAudit(log);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.records.map((record) => record.operation)).toEqual(["build", "export-profile"]);
  });

  it("a malformed line is REPORTED with its number, never repaired or dropped", () => {
    const good = egressAuditLine(
      egressSeal({
        at: "2026-11-09T12:00:00.000Z",
        operation: "build",
        manifest,
        publicManifest: manifest,
        reasons: [],
        keyId: null,
        baseline: "absent",
        prev: null,
      }).record,
    );
    const parsed = parseEgressAudit(`${good}not json\n{"version":1}\n`);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.malformed.map((bad) => bad.line)).toEqual([2, 3]);
    expect(parsed.malformed[1]?.reason).toMatch(/missing\/invalid/);
  });

  it("the trailing newline is not a record and not an error", () => {
    expect(parseEgressAudit("")).toEqual({ records: [], malformed: [] });
    expect(parseEgressAudit("\n\n")).toEqual({ records: [], malformed: [] });
  });
});

describe("the fixture is read, never mutated", () => {
  it("load() of the committed fixture is unchanged on disk", () => {
    // A guard for the test itself: `fixture()` LOADS a fresh copy on every call,
    // so a test that mutates a row cannot leak into the next one (or the repo).
    expect(readFileSync(join(ACHIEVEMENTS, "content", "credentials.yaml"), "utf8")).toContain(
      "visibility: private",
    );
  });
});
