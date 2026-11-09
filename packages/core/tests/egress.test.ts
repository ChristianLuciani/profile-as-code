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
  egressBaselineOf,
  egressManifest,
  load,
  newlyPublicUnits,
  parseEgressAudit,
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
    });
    expect(record.method).toBe("none");
    expect(record.reasons).toEqual([]);
  });

  it("the line is one JSONL record terminated by a newline", () => {
    const line = egressAuditLine(
      egressAuditRecord({
        at: "2026-11-09T12:00:00.000Z",
        operation: "build",
        manifest,
        reasons: [],
        keyId: null,
        baseline: "absent",
      }),
    );
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);
    expect((JSON.parse(line) as { digest: string }).digest).toBe(manifest.digest);
  });

  it("appending never rewrites: the parsed prefix is the previous log", () => {
    const first = egressAuditLine(
      egressAuditRecord({
        at: "2026-11-09T12:00:00.000Z",
        operation: "build",
        manifest,
        reasons: [],
        keyId: null,
        baseline: "absent",
      }),
    );
    const second = egressAuditLine(
      egressAuditRecord({
        at: "2026-11-09T12:00:01.000Z",
        operation: "export-profile",
        manifest,
        reasons: [],
        keyId: null,
        baseline: "recorded",
      }),
    );
    const log = `${first}${second}`;
    expect(log.startsWith(first)).toBe(true);
    const parsed = parseEgressAudit(log);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.records.map((record) => record.operation)).toEqual(["build", "export-profile"]);
  });

  it("a malformed line is REPORTED with its number, never repaired or dropped", () => {
    const good = egressAuditLine(
      egressAuditRecord({
        at: "2026-11-09T12:00:00.000Z",
        operation: "build",
        manifest,
        reasons: [],
        keyId: null,
        baseline: "absent",
      }),
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
