/**
 * D18 — per-entry deploy-status ledger (issue #37, SPEC §19).
 *
 * Behavior under test:
 *   - canonicalJson / hashUnit: stable across key order, insensitive to YAML
 *     formatting, and ledger metadata (id/origin) is stripped before hashing.
 *   - trackableUnits: every §19.2 unit is enumerated with its ledger key
 *     (root blocks, bios/headlines composite keys, skills, handles, rows with id);
 *     rows without id are untracked; origin defaults to user.
 *   - deployStatus: empty ledger → never everywhere, stale nowhere (acceptance);
 *     hash mismatch → stale; ledger key with no current unit → removed.
 *   - load() integrity (post-Zod, D12-fail class):
 *       duplicate id always fails · duplicate composite key fails only when
 *       addressed · bad surface / bad ledgerKey pattern fail · missing/ill-formed
 *       contentHash fails (Zod).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attemptRecord,
  attestedRecord,
  canonicalJson,
  certificationRollup,
  certificationVerdict,
  certifiedSurface,
  certifySurfaces,
  declaredReason,
  deployStatus,
  fetchFailureReason,
  hashUnit,
  load,
  SchemaValidationError,
  trackableUnits,
} from "../src/index.js";

const MINIMAL = new URL("./fixtures/minimal/", import.meta.url).pathname;

function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-ledger-"));
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(content, name), body, "utf8");
  }
  return dir;
}

const clean = (dir: string) => rmSync(dir, { recursive: true, force: true });

const IDENTITY = "name: Elena Vasquez\nlocation: Madrid, Spain\n";

describe("canonicalJson / hashUnit (D18 §19.1)", () => {
  it("is stable across insertion/key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 1 }),
    );
  });

  it("strips ledger metadata (id, origin) before hashing", () => {
    expect(hashUnit({ id: "exp-1", origin: "template", role: "X", org: "Y" })).toBe(
      hashUnit({ role: "X", org: "Y" }),
    );
  });

  it("hashes to 64 hex chars", () => {
    expect(hashUnit({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("trackableUnits (D18 §19.2)", () => {
  it("enumerates root blocks, bios, headlines, skills — and rows only when they carry an id", () => {
    const profile = load(MINIMAL);
    const units = trackableUnits(profile);
    const keys = units.map((u) => u.key);

    expect(keys).toContain("identity");
    expect(keys).toContain("positioning");
    expect(keys).toContain("keywords");
    expect(keys).toContain("bios:github-readme:en:long");
    expect(keys).toContain("bios:linkedin:es:medium");
    expect(keys).toContain("headlines:linkedin:en");
    expect(keys).toContain("skills:Model routing");
    // minimal fixture rows have no ids → they are untracked, not units
    expect(keys.filter((k) => k.startsWith("experience:"))).toEqual([]);
  });

  it("tracks rows with ids and reports origin", () => {
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "experience.yaml": [
        "- id: exp-nimbus",
        "  origin: template",
        "  role: Senior AI Engineer",
        "  org: Nimbus Labs",
        "  start: 2022-03-01",
      ].join("\n"),
    });
    try {
      const units = trackableUnits(load(dir));
      const exp = units.find((u) => u.key === "experience:exp-nimbus");
      expect(exp).toBeDefined();
      expect(exp?.origin).toBe("template");
      expect(units.find((u) => u.key === "identity")?.origin).toBe("user");
    } finally {
      clean(dir);
    }
  });

  it("tracks brand social handles by platform", () => {
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "flavor.yaml": "brand\n",
      "socialHandles.yaml": [
        "- platform: x",
        "  handle: topiapress",
        "  status: claimed",
        "- platform: instagram",
        "  handle: topiapress",
        "  status: pending",
      ].join("\n"),
    });
    try {
      const keys = trackableUnits(load(dir)).map((u) => u.key);
      expect(keys).toContain("socialHandles:x");
      expect(keys).toContain("socialHandles:instagram");
    } finally {
      clean(dir);
    }
  });
});

describe("deployStatus (D18 §19.3)", () => {
  it("fresh workspace: never everywhere, stale nowhere (acceptance #37)", () => {
    const report = deployStatus(load(MINIMAL));
    expect(report.units.length).toBeGreaterThan(0);
    expect(report.units.every((u) => u.state === "never")).toBe(true);
    expect(report.units.some((u) => u.state === "stale")).toBe(false);
    expect(report.removed).toEqual([]);
  });

  it("in-sync after a matching deploy record; stale when the SSOT changes after deploy", () => {
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "deployments.yaml": [
        "identity:",
        "  linkedin:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${hashUnit({ name: "Elena Vasquez", location: "Madrid, Spain" })}`,
        "    source: manual",
      ].join("\n"),
    });
    try {
      expect(deployStatus(load(dir)).units.find((u) => u.key === "identity")?.state).toBe(
        "in-sync",
      );

      writeFileSync(
        join(dir, "content", "identity.yaml"),
        IDENTITY.replace("Elena", "Elena V."),
        "utf8",
      );
      expect(deployStatus(load(dir)).units.find((u) => u.key === "identity")?.state).toBe("stale");
    } finally {
      clean(dir);
    }
  });

  it("reports ledger keys whose unit no longer exists as removed", () => {
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "deployments.yaml": [
        "experience:exp-gone:",
        "  linkedin:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${hashUnit({ role: "X" })}`,
        "    source: manual",
      ].join("\n"),
    });
    try {
      const report = deployStatus(load(dir));
      expect(report.removed.map((r) => r.key)).toEqual(["experience:exp-gone"]);
      expect(report.removed[0]?.surfaces).toEqual(["linkedin"]);
    } finally {
      clean(dir);
    }
  });

  it("lists rows without ids as untracked", () => {
    const report = deployStatus(load(MINIMAL));
    const blocks = report.untracked.map((u) => u.block).sort();
    // minimal fixture: 2 experience + 2 projects + 2 publications rows, none with ids
    expect(blocks).toEqual([
      "experience",
      "experience",
      "projects",
      "projects",
      "publications",
      "publications",
    ]);
  });
});

describe("load() ledger integrity (post-Zod, D12-fail)", () => {
  it("rejects duplicate ids within a block", () => {
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "experience.yaml": [
        "- id: exp-1",
        "  role: A",
        "  org: O",
        "  start: 2020-01-01",
        "- id: exp-1",
        "  role: B",
        "  org: O",
        "  start: 2021-01-01",
      ].join("\n"),
    });
    try {
      expect(() => load(dir)).toThrowError(SchemaValidationError);
      expect(() => load(dir)).toThrowError(/duplicate/i);
    } finally {
      clean(dir);
    }
  });

  it("allows duplicate composite keys when the ledger does not address them (additivity)", () => {
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "bios.yaml": [
        "- platform: linkedin",
        "  lang: en",
        "  length: medium",
        "  text: one",
        "- platform: linkedin",
        "  lang: en",
        "  length: medium",
        "  text: two",
      ].join("\n"),
    });
    try {
      expect(() => load(dir)).not.toThrow();
    } finally {
      clean(dir);
    }
  });

  it("rejects duplicate composite keys when the ledger addresses the ambiguous key", () => {
    const bio = { platform: "linkedin", lang: "en", length: "medium", text: "one" };
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "bios.yaml": [
        "- platform: linkedin",
        "  lang: en",
        "  length: medium",
        "  text: one",
        "- platform: linkedin",
        "  lang: en",
        "  length: medium",
        "  text: two",
      ].join("\n"),
      "deployments.yaml": [
        "bios:linkedin:en:medium:",
        "  linkedin:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${hashUnit(bio)}`,
        "    source: manual",
      ].join("\n"),
    });
    try {
      expect(() => load(dir)).toThrowError(/ambiguous/i);
    } finally {
      clean(dir);
    }
  });

  it("rejects an unknown surface (must be in the D16 enum)", () => {
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "deployments.yaml": [
        "identity:",
        "  myspace:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${hashUnit({ a: 1 })}`,
        "    source: manual",
      ].join("\n"),
    });
    try {
      expect(() => load(dir)).toThrowError(/myspace/i);
    } finally {
      clean(dir);
    }
  });

  it("rejects a ledger key outside the §19.2 key space", () => {
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "deployments.yaml": [
        "random-key:",
        "  linkedin:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${hashUnit({ a: 1 })}`,
        "    source: manual",
      ].join("\n"),
    });
    try {
      expect(() => load(dir)).toThrowError(/ledger key/i);
    } finally {
      clean(dir);
    }
  });

  it("rejects an ill-formed contentHash (Zod pattern)", () => {
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "deployments.yaml": [
        "identity:",
        "  linkedin:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        "    contentHash: not-a-hash",
        "    source: manual",
      ].join("\n"),
    });
    try {
      expect(() => load(dir)).toThrowError(SchemaValidationError);
    } finally {
      clean(dir);
    }
  });
});

/**
 * §19.5 (v1.10, issue #132) — dual certification, Lane A (core, offline).
 *
 * Behavior under test: the verdict table is TOTAL (five rows, including the two
 * `unverifiable` classes); certification and staleness are ORTHOGONAL
 * (`stale` + `verified` and `stale` + `out-of-band-drift`); the rollup is the
 * SPEC §19.5 ordering; a block-less record reads `attested`; DECLARED reasons are
 * derived at read time (no ledger row per walled platform).
 */
describe("§19.5 certificationVerdict — the five-row total table", () => {
  const anchor = "a".repeat(64);
  const other = "b".repeat(64);
  const empty = {};

  it("row 1 — a non-2xx fetch is unverifiable and core does not invent the reason", () => {
    expect(certificationVerdict(empty, { status: 403 })).toEqual({ state: "unverifiable" });
    expect(fetchFailureReason(403)).toBe("http-403");
    expect(fetchFailureReason(429)).toBe("http-429");
    expect(fetchFailureReason(0)).toBe("network-error");
    expect(fetchFailureReason(500)).toBe("http-500");
  });

  it("row 2 — no attempt (null live) is unverifiable, with no invented reason", () => {
    expect(
      certificationVerdict({ certification: { state: "attested", artifactHash: anchor } }, null),
    ).toEqual({ state: "unverifiable" });
  });

  it("row 3 — ok + anchor present + equal → verified", () => {
    const record = { certification: { state: "attested" as const, artifactHash: anchor } };
    expect(certificationVerdict(record, { status: 200, digest: anchor })).toEqual({
      state: "verified",
    });
  });

  it("row 4 — ok + anchor present + different → out-of-band-drift: live-mismatch", () => {
    const record = { certification: { state: "attested" as const, artifactHash: anchor } };
    expect(certificationVerdict(record, { status: 200, digest: other })).toEqual({
      state: "out-of-band-drift",
      reason: "live-mismatch",
    });
  });

  it("row 5 — ok + anchor absent → unverifiable: unattributed (observable, not judgeable)", () => {
    expect(
      certificationVerdict(
        { certification: { state: "attested" } },
        { status: 200, digest: other },
      ),
    ).toEqual({ state: "unverifiable", reason: "unattributed" });
    // A 2xx with no digest cannot judge either — same honest class.
    expect(
      certificationVerdict(
        { certification: { state: "attested", artifactHash: anchor } },
        { status: 200 },
      ),
    ).toEqual({
      state: "unverifiable",
      reason: "unattributed",
    });
  });
});

describe("§19.5 certificationRollup — the SPEC ordering", () => {
  const verified = {
    state: "verified" as const,
    method: "fetch" as const,
    liveHash: "a".repeat(64),
  };
  const attested = { state: "attested" as const };
  const unverifiable = { state: "unverifiable" as const, reason: "http-403" };
  const drift = { state: "out-of-band-drift" as const, reason: "live-mismatch" };

  it("verified ⇔ every surface is verified", () => {
    expect(certificationRollup({ a: verified, b: verified })).toEqual({ state: "verified" });
  });

  it("attested when all surfaces are verified|attested with at least one attested", () => {
    expect(certificationRollup({ a: verified, b: attested })).toEqual({ state: "attested" });
    expect(certificationRollup({ a: attested, b: attested })).toEqual({ state: "attested" });
  });

  it("otherwise the most severe non-confirmed state, drift before unverifiable", () => {
    expect(certificationRollup({ a: verified, b: drift, c: unverifiable })).toEqual({
      state: "out-of-band-drift",
      reason: "live-mismatch",
    });
    expect(certificationRollup({ a: attested, b: unverifiable })).toEqual({
      state: "unverifiable",
      reason: "http-403",
    });
  });

  it("names the leading non-confirmed surface deterministically (sorted keys)", () => {
    const rollup = certificationRollup({
      c: { state: "unverifiable", reason: "http-403" },
      b: { state: "unverifiable", reason: "network-error" },
    });
    expect(rollup).toEqual({ state: "unverifiable", reason: "network-error" }); // b sorts first
  });
});

describe("§19.5 certifiedSurface / certifySurfaces — declared vs recorded vs attested", () => {
  it("a stored block IS the answer: an attempt reason survives the read (durable evidence)", () => {
    expect(certifiedSurface({ state: "unverifiable", reason: "http-403" })).toEqual({
      state: "unverifiable",
      reason: "http-403",
    });
    // A record is read-only here: the store is the story of the event it observed.
    expect(certifiedSurface({ state: "unverifiable", reason: "http-500" })).toEqual({
      state: "unverifiable",
      reason: "http-500",
    });
  });

  it("a record with NO block reads attested — the human --mark, never judged", () => {
    expect(certifiedSurface(undefined)).toEqual({ state: "attested" });
  });

  it("confirmed states pass through verbatim", () => {
    const anchor = "a".repeat(64);
    expect(certifiedSurface({ state: "attested", artifactHash: anchor })).toEqual({
      state: "attested",
      artifactHash: anchor,
    });
    expect(certifiedSurface({ state: "verified", artifactHash: anchor })).toEqual({
      state: "verified",
      artifactHash: anchor,
    });
    expect(certifiedSurface({ state: "out-of-band-drift", reason: "live-mismatch" })).toEqual({
      state: "out-of-band-drift",
      reason: "live-mismatch",
    });
  });

  it("declaredReason: the ladder rungs outrank the URL question (review F4)", () => {
    const base = { extractor: (t: string) => t, artifactUrl: "https://x/y" as string | null };
    expect(declaredReason(undefined)).toBe("no-extractor");
    expect(declaredReason({ artifactUrl: "https://x/y" })).toBe("no-extractor");
    expect(declaredReason({ ...base, artifactUrl: null })).toBe("no-artifact-url");
    // §19.5 rungs 2 and 3 are expressible — ko-fi's measured 403 needs `walled`.
    expect(declaredReason({ ...base, rung: "walled" })).toBe("walled");
    expect(declaredReason({ ...base, rung: "walled-con-api" })).toBe("walled-con-api");
    expect(declaredReason({ ...base, rung: "fetchable" })).toBeUndefined();
    expect(declaredReason(base)).toBeUndefined();
  });

  it("certifySurfaces: units with no ledger record have null certification", () => {
    const report = certifySurfaces(load(MINIMAL));
    expect(Object.values(report).every((c) => c === null)).toBe(true);
  });
});

describe("§19.5 deployStatus — additive certification, staleness untouched", () => {
  it("a fresh workspace has every unit never AND certification null", () => {
    const report = deployStatus(load(MINIMAL));
    expect(report.units.every((u) => u.state === "never")).toBe(true);
    expect(report.units.every((u) => u.certification === null)).toBe(true);
  });

  it("a block-less record reads attested (the --mark), whether or not the surface is capable", () => {
    const hash = hashUnit({ name: "Elena Vasquez", location: "Madrid, Spain" });
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "deployments.yaml": [
        "identity:",
        "  linkedin:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${hash}`,
        "    source: manual",
      ].join("\n"),
    });
    try {
      expect(
        deployStatus(load(dir)).units.find((u) => u.key === "identity")?.certification,
      ).toEqual({ state: "attested", surfaces: { linkedin: { state: "attested" } } });
    } finally {
      clean(dir);
    }
  });

  it("orthogonality: stale + verified and stale + out-of-band-drift are both expressible", () => {
    const staleHash = hashUnit({ name: "OLD" }); // deliberately not the current unit hash
    const anchor = "c".repeat(64);
    const mk = (certification: string[]): string =>
      [
        "identity:",
        "  github-readme:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${staleHash}`,
        "    source: manual",
        ...certification,
      ].join("\n");
    const verifiedDir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "deployments.yaml": mk([
        "    certification:",
        "      state: verified",
        `      artifactHash: ${anchor}`,
        "      method: fetch",
        "      fetchedAt: 2026-10-12T10:00:00Z",
        `      liveHash: ${anchor}`,
        "      evidenceUrl: https://raw.githubusercontent.com/x/y",
      ]),
    });
    const driftDir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "deployments.yaml": mk([
        "    certification:",
        "      state: out-of-band-drift",
        "      reason: live-mismatch",
        `      artifactHash: ${anchor}`,
        `      liveHash: ${"d".repeat(64)}`,
        "      method: fetch",
        "      fetchedAt: 2026-10-12T10:00:00Z",
        "      evidenceUrl: https://raw.githubusercontent.com/x/y",
      ]),
    });
    try {
      const a = deployStatus(load(verifiedDir)).units.find((u) => u.key === "identity");
      expect(a?.state).toBe("stale");
      expect(a?.certification?.state).toBe("verified");

      const b = deployStatus(load(driftDir)).units.find((u) => u.key === "identity");
      expect(b?.state).toBe("stale");
      expect(b?.certification?.state).toBe("out-of-band-drift");
    } finally {
      clean(verifiedDir);
      clean(driftDir);
    }
  });

  it("an attempt reason is durable: it is read back, evidence and all (no re-derivation)", () => {
    const hash = hashUnit({ name: "Elena Vasquez", location: "Madrid, Spain" });
    const anchor = "b".repeat(64);
    const dir = makeWorkspace({
      "identity.yaml": IDENTITY,
      "deployments.yaml": [
        "identity:",
        "  github-readme:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${hash}`,
        "    source: manual",
        "    certification:",
        "      state: unverifiable",
        "      reason: http-500",
        `      artifactHash: ${anchor}`,
        "      method: fetch",
        "      fetchedAt: 2026-10-12T10:00:00Z",
        "      evidenceUrl: https://raw.githubusercontent.com/x/y",
      ].join("\n"),
    });
    try {
      const surface = deployStatus(load(dir)).units.find((u) => u.key === "identity")?.certification
        ?.surfaces["github-readme"];
      // F3: row 1 stays row 1 — an unrelated later capability must not turn the
      // record's event into `unattributed`.
      expect(surface).toEqual({
        state: "unverifiable",
        reason: "http-500",
        artifactHash: anchor,
        method: "fetch",
        fetchedAt: "2026-10-12T10:00:00Z",
        evidenceUrl: "https://raw.githubusercontent.com/x/y",
      });
    } finally {
      clean(dir);
    }
  });
});

describe("§19.5 record shapes the pass writes (attemptRecord / attestedRecord)", () => {
  const anchor = "e".repeat(64);
  const live = "f".repeat(64);

  it("verified records the fetch evidence and keeps the anchor", () => {
    expect(
      attemptRecord(
        { state: "verified" },
        {
          artifactHash: anchor,
          liveHash: anchor,
          fetchedAt: "2026-10-12T10:00:00.000Z",
          evidenceUrl: "https://raw.githubusercontent.com/x/y",
        },
      ),
    ).toEqual({
      state: "verified",
      artifactHash: anchor,
      method: "fetch",
      fetchedAt: "2026-10-12T10:00:00.000Z",
      liveHash: anchor,
      evidenceUrl: "https://raw.githubusercontent.com/x/y",
    });
  });

  it("an attempted failure records the evidence WITHOUT digests (a comparison here would lie)", () => {
    const record = attemptRecord(
      { state: "unverifiable", reason: "http-403" },
      { fetchedAt: "2026-10-12T10:00:00.000Z", evidenceUrl: "https://ko-fi.com/x" },
    );
    expect(record).toEqual({
      state: "unverifiable",
      reason: "http-403",
      method: "fetch",
      fetchedAt: "2026-10-12T10:00:00.000Z",
      evidenceUrl: "https://ko-fi.com/x",
    });
    expect(record.artifactHash).toBeUndefined();
    expect(record.liveHash).toBeUndefined();
  });

  it("drift records both digests — the contradiction is auditable", () => {
    expect(
      attemptRecord(
        { state: "out-of-band-drift", reason: "live-mismatch" },
        {
          artifactHash: anchor,
          liveHash: live,
          fetchedAt: "2026-10-12T10:00:00.000Z",
          evidenceUrl: "https://raw.githubusercontent.com/x/y",
        },
      ),
    ).toEqual({
      state: "out-of-band-drift",
      reason: "live-mismatch",
      artifactHash: anchor,
      liveHash: live,
      method: "fetch",
      fetchedAt: "2026-10-12T10:00:00.000Z",
      evidenceUrl: "https://raw.githubusercontent.com/x/y",
    });
  });

  it("--mark records attested + the anchor, and no anchor when the surface cannot render one", () => {
    expect(attestedRecord(anchor)).toEqual({ state: "attested", artifactHash: anchor });
    expect(attestedRecord(undefined)).toEqual({ state: "attested" });
  });
});

describe("§19.5 schema contract — the certification block is load-validated (D12)", () => {
  const record = (certification: string[]): Record<string, string> => ({
    "identity.yaml": IDENTITY,
    "deployments.yaml": [
      "identity:",
      "  linkedin:",
      "    deployedAt: 2026-09-08T10:00:00Z",
      `    contentHash: ${hashUnit({ name: "Elena Vasquez", location: "Madrid, Spain" })}`,
      "    source: manual",
      ...certification,
    ].join("\n"),
  });

  it("accepts every state of the block (additive: pre-v1.10 workspaces keep validating)", () => {
    const dir = makeWorkspace(record(["    certification:", "      state: attested"]));
    try {
      expect(load(dir).deployments.identity?.linkedin?.certification).toEqual({
        state: "attested",
      });
    } finally {
      clean(dir);
    }
  });

  it("rejects an `unverifiable` with no reason (the reason is required BY STATE)", () => {
    const dir = makeWorkspace(record(["    certification:", "      state: unverifiable"]));
    try {
      expect(() => load(dir)).toThrow(SchemaValidationError);
    } finally {
      clean(dir);
    }
  });

  it("rejects a `verified` that borrows a negative reason, and an `attested` with a liveHash", () => {
    const borrowed = makeWorkspace(
      record([
        "    certification:",
        "      state: verified",
        `      artifactHash: ${"a".repeat(64)}`,
        "      method: fetch",
        "      fetchedAt: 2026-10-12T10:00:00Z",
        `      liveHash: ${"b".repeat(64)}`,
        "      reason: live-mismatch",
      ]),
    );
    const attestedDigest = makeWorkspace(
      record(["    certification:", "      state: attested", `      liveHash: ${"b".repeat(64)}`]),
    );
    try {
      expect(() => load(borrowed)).toThrow(SchemaValidationError);
      expect(() => load(attestedDigest)).toThrow(SchemaValidationError);
    } finally {
      clean(borrowed);
      clean(attestedDigest);
    }
  });
});
