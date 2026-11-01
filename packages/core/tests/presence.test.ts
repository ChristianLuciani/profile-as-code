/**
 * D23 — the presence surface and the release fan-out (issue #262, SPEC §22).
 *
 * Behavior under test:
 *   - releases[] is additive: the `minimal` fixture (no releases) still loads and
 *     reads an empty list; the `releases` fixture declares two releases.
 *   - releasePlan(): the latest release is chosen by date (then id); surfaces are
 *     ordered repo-meta → profile → distribution, then slug; state is the §19
 *     ledger vocabulary derived from the release's changedUnits (in-sync / stale
 *     / never — a non-profile surface has no ledger record ⇒ never); base text is
 *     the per-kind factual spine, one entry per kind present.
 *   - presenceBoard(): one row per surface at the NEWEST release that declares
 *     it, with counts.
 *   - partial coverage is never in-sync (F1): a changed unit with no record on
 *     the surface makes it `never` and lands in `missingUnits`;
 *   - the two causes stay apart (#408): a valid unit with no record is a pending
 *     fan-out (`missingUnits`), a key that resolves to no SSOT unit is a defect
 *     in the release row (`unknownUnits`) — neither is reported as the other;
 *   - the refusals: no releases, an unknown release id, duplicate release ids,
 *     duplicate surfaces and a surface the registry does not know (a typo must
 *     not silently build a plan).
 */

import { describe, expect, it } from "vitest";
import { load, PresenceError, presenceBoard, releasePlan, selectRelease } from "../src/index.js";

const MINIMAL = new URL("./fixtures/minimal/", import.meta.url).pathname;
const RELEASES = new URL("./fixtures/releases/", import.meta.url).pathname;

describe("releases[] — additive contract", () => {
  it("a workspace without releases reads an empty list (pre-v1.15 stays valid)", () => {
    const profile = load(MINIMAL);
    expect(profile.releases).toEqual([]);
  });

  it("selectRelease defaults to the newest by date, then id", () => {
    const profile = load(RELEASES);
    expect(profile.releases).toHaveLength(2);
    expect(selectRelease(profile).id).toBe("v0-3-0");
    expect(selectRelease(profile, "v0-2-0").version).toBe("0.2.0");
  });
});

describe("releasePlan — the ordered fan-out", () => {
  it("orders repo-meta → profile → distribution, then slug", () => {
    const plan = releasePlan(load(RELEASES));
    expect(plan.surfaces.map((row) => row.surface)).toEqual([
      "github-repo-meta",
      "github-readme",
      "linkedin",
      "hacker-news",
    ]);
    expect(plan.surfaces.map((row) => row.kind)).toEqual([
      "repo-meta",
      "profile",
      "profile",
      "distribution",
    ]);
  });

  it("derives its state from the §19 ledger, never a second model", () => {
    const plan = releasePlan(load(RELEASES));
    const state = (surface: string) => plan.surfaces.find((row) => row.surface === surface)?.state;
    // The fixture's github-readme record carries the identity unit's CURRENT hash.
    expect(state("github-readme")).toBe("in-sync");
    // linkedin's record predates the unit → stale.
    expect(state("linkedin")).toBe("stale");
    // No ledger record for a repo-meta/distribution surface → never (honest v1).
    expect(state("github-repo-meta")).toBe("never");
    expect(state("hacker-news")).toBe("never");
  });

  it("emits one base-text spine per kind present, in fan-out order", () => {
    const plan = releasePlan(load(RELEASES));
    expect(plan.baseText.map((entry) => entry.kind)).toEqual([
      "repo-meta",
      "profile",
      "distribution",
    ]);
    for (const entry of plan.baseText) {
      expect(entry.text).toContain("v0.3.0 (2026-10-28)");
      expect(entry.text).toContain("Presence surfaces: release plan");
    }
    expect(plan.baseText[0]?.text.startsWith("What shipped:")).toBe(true);
    expect(plan.baseText[2]?.text.startsWith("Announcement:")).toBe(true);
  });

  it("a changed unit with no record makes the surface never, not partial in-sync (F1)", () => {
    const profile = load(RELEASES);
    // github-readme has a record for `identity` only; the bio unit has none.
    profile.releases[0]!.changedUnits = ["identity", "bios:github-readme:en:long"];
    const plan = releasePlan(profile);
    const readme = plan.surfaces.find((row) => row.surface === "github-readme");
    expect(readme?.state).toBe("never");
    // `bios:github-readme:en:long` IS an SSOT unit, so this is a pending
    // fan-out — never the release row being wrong (#408).
    expect(readme?.missingUnits).toEqual(["bios:github-readme:en:long"]);
    expect(readme?.unknownUnits).toEqual([]);
    // The surface still carries the identity record — coverage is partial, which
    // is exactly why it must not read in-sync.
    expect(plan.surfaces.find((row) => row.surface === "linkedin")?.state).toBe("never");
  });

  it("keeps a pending fan-out and a non-SSOT key in separate lists (#408)", () => {
    const profile = load(RELEASES);
    profile.releases[0]!.changedUnits = [
      "identity",
      "bios:github-readme:en:long",
      "publications:gone",
    ];
    const readme = releasePlan(profile).surfaces.find((row) => row.surface === "github-readme");
    expect(readme?.state).toBe("never");
    // Valid unit, no deploy record on this surface → fan-out pendiente.
    expect(readme?.missingUnits).toEqual(["bios:github-readme:en:long"]);
    // No SSOT unit behind the key → the row itself is wrong.
    expect(readme?.unknownUnits).toEqual(["publications:gone"]);
  });

  it("refuses duplicate release ids instead of silently returning the first", () => {
    const profile = load(RELEASES);
    profile.releases.push({ ...profile.releases[0]! });
    expect(() => releasePlan(profile)).toThrow(/release id "v0-3-0" is declared more than once/);
    expect(() => presenceBoard(profile)).toThrow(/release ids must be unique/);
  });

  it("refuses duplicate surfaces inside a release", () => {
    const profile = load(RELEASES);
    profile.releases[0]!.surfaces.push("github-readme");
    expect(() => releasePlan(profile)).toThrow(
      /release "v0-3-0" declares surface "github-readme" more than once/,
    );
    expect(() => presenceBoard(profile)).toThrow(/surfaces must be unique/);
  });

  it("refuses a surface the registry does not know (a typo is not a kind)", () => {
    const profile = load(RELEASES);
    profile.releases[0]!.surfaces.push("not-a-surface");
    expect(() => releasePlan(profile)).toThrow(/surface "not-a-surface" is not declared/);
    expect(() => presenceBoard(profile)).toThrow(/is not declared in platforms\/registry.yaml/);
  });

  it("is deterministic: two reads produce identical bytes", () => {
    const profile = load(RELEASES);
    expect(JSON.stringify(releasePlan(profile))).toBe(JSON.stringify(releasePlan(profile)));
  });

  it("refuses an unknown release id and names the known ones", () => {
    expect(() => releasePlan(load(RELEASES), "v9-9-9")).toThrow(PresenceError);
    expect(() => releasePlan(load(RELEASES), "v9-9-9")).toThrow(/v0-3-0, v0-2-0/);
  });

  it("refuses a workspace with no releases", () => {
    expect(() => releasePlan(load(MINIMAL))).toThrow(/no releases\[\]/);
  });
});

describe("presenceBoard — the daily board", () => {
  it("shows each surface at the NEWEST release that declares it", () => {
    const board = presenceBoard(load(RELEASES));
    const row = (surface: string) => board.surfaces.find((entry) => entry.surface === surface);
    expect(row("github-readme")?.releaseId).toBe("v0-3-0");
    // x was addressed by the OLDER release only; the board keeps its reading.
    expect(row("x")?.releaseId).toBe("v0-2-0");
    expect(row("x")?.state).toBe("never");
  });

  it("counts the three §19 states", () => {
    const board = presenceBoard(load(RELEASES));
    expect(board.releases).toBe(2);
    expect(board.latest).toEqual({ id: "v0-3-0", version: "0.3.0", date: "2026-10-28" });
    expect(board.counts).toEqual({ "in-sync": 1, stale: 1, never: 3 });
  });

  it("returns a null latest and no rows for a workspace with no releases", () => {
    const board = presenceBoard(load(MINIMAL));
    expect(board.latest).toBeNull();
    expect(board.surfaces).toEqual([]);
    expect(board.counts).toEqual({ "in-sync": 0, stale: 0, never: 0 });
  });
});
