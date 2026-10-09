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
  canonicalJson,
  deployStatus,
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
