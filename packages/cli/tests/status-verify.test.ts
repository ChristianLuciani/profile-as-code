/**
 * `pasco status --verify` — the C1 live check (SPEC §19.5, v1.10, issue #132).
 *
 * These tests drive the MODULE (not the built binary) because §19.5 requires the
 * fetch to be injected: NO test in this repo touches the network. The scripted
 * fetch also pins the honest degradation ladder (403 / 429 / transport failure)
 * and the allowlist refusal — with an assertion on whether a request happened at
 * all, which is the point of validating the host BEFORE fetching.
 *
 * `--json` additivity is asserted separately: the staleness keys a pre-v1.10
 * consumer reads must be byte-for-byte what they always were.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashUnit, type SurfaceCapabilities } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { runStatus } from "../src/commands/status.js";
import { setJsonMode } from "../src/output.js";
import type { FetchText, StatusDeps } from "../src/verify.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-verify-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = "name: Elena Vasquez\nlocation: Madrid, Spain\n";
const ARTIFACT = "# Elena Vasquez\n\nverified artifact body\n";
const FETCH_URL =
  "https://raw.githubusercontent.com/ChristianLuciani/ChristianLuciani/main/README.md";
const HOSTS = ["raw.githubusercontent.com"];

/** A one-surface workspace: `identity` recorded on `github-readme`. */
function workspace(recordLines: string[] = []): string {
  const dir = tempDir();
  mkdirSync(join(dir, "content"));
  writeFileSync(join(dir, "content", "identity.yaml"), IDENTITY, "utf8");
  writeFileSync(
    join(dir, "content", "headlines.yaml"),
    "- platform: github-readme\n  lang: en\n  text: Verified headline\n",
    "utf8",
  );
  const hash = hashUnit({ name: "Elena Vasquez", location: "Madrid, Spain" });
  writeFileSync(
    join(dir, "content", "deployments.yaml"),
    [
      "identity:",
      "  github-readme:",
      "    deployedAt: 2026-09-08T10:00:00Z",
      `    contentHash: ${hash}`,
      "    source: manual",
      ...recordLines,
    ].join("\n"),
    "utf8",
  );
  return dir;
}

/** The extractor Lane B ships: platform chrome out, digest-able projection back. */
const extractor = (text: string): string => `${text.trim()}\n`;

function capability(overrides: Partial<{ fetchHosts: string[]; artifactUrl: string | null }> = {}) {
  return {
    extractor,
    fetchHosts: HOSTS,
    artifactUrl: FETCH_URL,
    ...overrides,
  };
}

interface Scripted {
  fetch: FetchText;
  calls: string[];
}

function scriptedFetch(
  responses: Record<
    string,
    { status: number; text?: string } | (() => { status: number; text?: string })
  >,
): Scripted {
  const calls: string[] = [];
  const fetch: FetchText = async (url: string) => {
    calls.push(url);
    const response = responses[url];
    if (response === undefined) throw new Error(`unscripted fetch: ${url}`);
    return typeof response === "function" ? response() : response;
  };
  return { fetch, calls };
}

function deps(capabilities: SurfaceCapabilities, fetch: FetchText): Partial<StatusDeps> {
  return { capabilities, fetchText: fetch };
}

interface JsonEnvelope {
  ok: boolean;
  data: {
    units: {
      key: string;
      state: string;
      surfaces: Record<string, string>;
      certification: null | {
        state: string;
        reason?: string;
        surfaces: Record<
          string,
          { state: string; reason?: string; artifactHash?: string; liveHash?: string }
        >;
      };
    }[];
  };
}

/** Capture the JSON envelope `report()` writes to stdout. */
async function verifyJson(
  args: Parameters<typeof runStatus>[0],
): Promise<{ code: number; data: JsonEnvelope["data"] }> {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  setJsonMode(true);
  let code: number;
  try {
    code = await runStatus(args);
  } finally {
    process.stdout.write = original;
    setJsonMode(false);
  }
  return { code, data: (JSON.parse(out) as JsonEnvelope).data };
}

const ledgerOf = (ws: string): string =>
  readFileSync(join(ws, "content", "deployments.yaml"), "utf8");

describe("§19.5 pasco status --verify — the fetch ladder (no network: fetch is injected)", () => {
  it("anchored + equal digest → verified, and the anchor is preserved byte-for-byte", async () => {
    const ws = workspace([
      "    certification:",
      "      state: attested",
      `      artifactHash: ${"a".repeat(64)}`,
    ]);
    const { fetch, calls } = scriptedFetch({
      [FETCH_URL]: { status: 200, text: ARTIFACT },
    });
    // The anchor must be the digest of the SAME extraction the fetch produces,
    // otherwise this would be drift — prime the file with it.
    const { createHash } = await import("node:crypto");
    const anchor = createHash("sha256").update(extractor(ARTIFACT), "utf8").digest("hex");
    writeFileSync(
      join(ws, "content", "deployments.yaml"),
      ledgerOf(ws).replace(/artifactHash: [a-f0-9]{64}/, `artifactHash: ${anchor}`),
      "utf8",
    );

    const { code, data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([FETCH_URL]); // exactly one request
    const unit = data.units.find((u) => u.key === "identity");
    expect(unit?.surfaces["github-readme"]).toBe("in-sync"); // staleness untouched
    expect(unit?.certification?.state).toBe("verified");
    const surface = unit?.certification?.surfaces["github-readme"];
    expect(surface?.state).toBe("verified");
    expect(surface?.liveHash).toBe(anchor);
    expect(ledgerOf(ws)).toContain(`liveHash: ${anchor}`);
    expect(ledgerOf(ws)).toContain(`artifactHash: ${anchor}`); // anchor unchanged
  });

  it("anchored + different digest → out-of-band-drift: live-mismatch (orthogonal to staleness)", async () => {
    const ws = workspace([
      "    certification:",
      "      state: attested",
      `      artifactHash: ${"a".repeat(64)}`,
    ]);
    const { fetch } = scriptedFetch({ [FETCH_URL]: { status: 200, text: ARTIFACT } });

    const { data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });

    const unit = data.units.find((u) => u.key === "identity");
    expect(unit?.surfaces["github-readme"]).toBe("in-sync");
    expect(unit?.certification?.state).toBe("out-of-band-drift");
    expect(unit?.certification?.surfaces["github-readme"]?.reason).toBe("live-mismatch");
    expect(ledgerOf(ws)).toContain("reason: live-mismatch");
  });

  it("no anchor (pre-v1.10 record) → unverifiable: unattributed, recorded with the fetch evidence", async () => {
    const ws = workspace();
    const { fetch, calls } = scriptedFetch({ [FETCH_URL]: { status: 200, text: ARTIFACT } });

    const { data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });

    expect(calls).toEqual([FETCH_URL]); // observed, not judged — but it WAS observed
    const unit = data.units.find((u) => u.key === "identity");
    expect(unit?.certification).toMatchObject({
      state: "unverifiable",
      surfaces: { "github-readme": { state: "unverifiable", reason: "unattributed" } },
    });
    expect(ledgerOf(ws)).toContain("reason: unattributed");
    expect(ledgerOf(ws)).toContain(`evidenceUrl: ${FETCH_URL}`);
  });

  it("403 (the measured ko-fi degradation): recorded as evidence, re-derived as row 5, never an exception", async () => {
    const ws = workspace();
    const { fetch } = scriptedFetch({ [FETCH_URL]: { status: 403 } });

    const { code, data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });

    expect(code).toBe(0); // network failures are DATA, never a broken report
    expect(
      data.units.find((u) => u.key === "identity")?.certification?.surfaces["github-readme"],
    ).toMatchObject({ state: "unverifiable", reason: "unattributed" });
    // …while the ledger keeps the ATTEMPT as durable evidence.
    expect(ledgerOf(ws)).toContain("reason: http-403");
  });

  it("429 → unverifiable: http-429 (one request, no retry, no backoff)", async () => {
    const ws = workspace();
    const { fetch, calls } = scriptedFetch({ [FETCH_URL]: { status: 429 } });

    const { data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });

    expect(calls).toEqual([FETCH_URL]); // exactly one — a retry would be a second
    expect(
      data.units.find((u) => u.key === "identity")?.certification?.surfaces["github-readme"],
    ).toMatchObject({ state: "unverifiable", reason: "unattributed" });
    expect(ledgerOf(ws)).toContain("reason: http-429");
  });

  it("transport failure → unverifiable: network-error, recorded", async () => {
    const ws = workspace();
    const fetch: FetchText = async () => ({ status: 0 });

    const { data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });

    expect(
      data.units.find((u) => u.key === "identity")?.certification?.surfaces["github-readme"],
    ).toMatchObject({ state: "unverifiable", reason: "unattributed" });
    expect(ledgerOf(ws)).toContain("reason: network-error");
  });
});

describe("§19.5 --verify — the allowlist is checked BEFORE any request", () => {
  it("a URL outside fetchHosts is host-not-allowed with NO request made", async () => {
    const ws = workspace([
      "    certification:",
      "      state: attested",
      `      artifactHash: ${"a".repeat(64)}`,
    ]);
    const { fetch, calls } = scriptedFetch({}); // any request would throw: unscripted
    const evil = capability({ artifactUrl: "http://169.254.169.254/latest/meta-data/" });

    const { code, data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": evil }, fetch),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([]); // the SSRF primitive is refused before the socket
    expect(
      data.units.find((u) => u.key === "identity")?.certification?.surfaces["github-readme"],
    ).toMatchObject({ state: "unverifiable", reason: "unattributed" });
    // The refusal is what the ledger records (auditable), with the URL that WOULD
    // have been fetched.
    expect(ledgerOf(ws)).toContain("reason: host-not-allowed");
    expect(ledgerOf(ws)).toContain("evidenceUrl: http://169.254.169.254/latest/meta-data/");
  });

  it("an extractor with no derivable URL → unverifiable: no-artifact-url, no request", async () => {
    const ws = workspace();
    const { fetch, calls } = scriptedFetch({});

    const { data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability({ artifactUrl: null }) }, fetch),
    });

    expect(calls).toEqual([]);
    expect(
      data.units.find((u) => u.key === "identity")?.certification?.surfaces["github-readme"],
    ).toMatchObject({ state: "unverifiable", reason: "no-artifact-url" });
    // Declared reasons are never pinned either.
    expect(ledgerOf(ws)).not.toContain("no-artifact-url");
  });

  it("a surface with no extractor → unverifiable: no-extractor, no request", async () => {
    const ws = workspace();
    const { fetch, calls } = scriptedFetch({});

    const { data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": { artifactUrl: FETCH_URL } }, fetch),
    });

    expect(calls).toEqual([]);
    expect(
      data.units.find((u) => u.key === "identity")?.certification?.surfaces["github-readme"],
    ).toMatchObject({ state: "unverifiable", reason: "no-extractor" });
  });
});

describe("§19.5 --verify — promotion is in place and preserves the deploy basis", () => {
  it("attested → verified leaves deployedAt/contentHash/source/artifactHash byte-identical", async () => {
    const ws = workspace([
      "    certification:",
      "      state: attested",
      `      artifactHash: ${"a".repeat(64)}`,
    ]);
    const before = ledgerOf(ws);
    const { createHash } = await import("node:crypto");
    const anchor = createHash("sha256").update(extractor(ARTIFACT), "utf8").digest("hex");
    writeFileSync(
      join(ws, "content", "deployments.yaml"),
      before.replace(/artifactHash: [a-f0-9]{64}/, `artifactHash: ${anchor}`),
      "utf8",
    );
    const primed = ledgerOf(ws);
    const preserved = primed
      .split("\n")
      .filter((l) => /deployedAt|contentHash|source|artifactHash/.test(l));

    const { fetch } = scriptedFetch({ [FETCH_URL]: { status: 200, text: ARTIFACT } });
    await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });

    const after = ledgerOf(ws);
    // The same record was updated in place: its deploy basis survived verbatim.
    for (const line of preserved) expect(after).toContain(line);
    expect(after).toContain("state: verified");
    expect(after).not.toContain("state: attested");
  });
});

describe("§19.5 --verify — write-path conflicts and the JSON contract", () => {
  it("--verify + --mark, --write-checklist and --completeness are refused (exit 2), never silently ignored", async () => {
    const ws = workspace();
    const { fetch } = scriptedFetch({});
    const base = { workspace: ws, verify: true, deps: deps({}, fetch) };
    for (const conflict of [
      { markKey: "identity", platformArg: "github-readme" },
      { writeChecklist: true },
      { completeness: true },
    ]) {
      const { code } = await verifyJson({ ...base, ...conflict });
      expect(code).toBe(2);
    }
  });

  it("--json stays ADDITIVE: the staleness keys keep their exact shape; certification is the new sibling", async () => {
    const ws = workspace();
    const { fetch } = scriptedFetch({ [FETCH_URL]: { status: 403 } });
    const { data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });
    const unit = data.units.find((u) => u.key === "identity") as Record<string, unknown>;

    // Pre-v1.10 consumer view: these keys and values are what they always were.
    expect(unit.state).toBe("in-sync");
    expect(unit.surfaces).toEqual({ "github-readme": "in-sync" });
    expect(unit.key).toBe("identity");
    expect(unit.kind).toBe("root");
    expect(typeof unit.hash).toBe("string");
    // …and the new dimension rides beside them.
    expect(unit.certification).toBeTruthy();
  });

  it("a stored attempt does NOT pin the verdict: re-reading derives the current answer", async () => {
    const ws = workspace([
      "    certification:",
      "      state: unverifiable",
      "      reason: http-403",
      "      method: fetch",
      "      fetchedAt: 2026-10-12T10:00:00Z",
      `      evidenceUrl: ${FETCH_URL}`,
    ]);
    // A capability can APPEAR later (Lane B lands the extractor): the file still
    // says http-403, but the honest answer for a fetchable, anchor-less record is
    // row 5 — the declaration/ability is judged at read time, not the snapshot.
    const { fetch } = scriptedFetch({ [FETCH_URL]: { status: 403 } });
    const { data } = await verifyJson({
      workspace: ws,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });
    const surface = data.units.find((u) => u.key === "identity")?.certification?.surfaces[
      "github-readme"
    ];
    // Still no anchor → row 5, not the stored 403 and not a silent `verified`.
    expect(surface).toMatchObject({ state: "unverifiable", reason: "unattributed" });
    expect(ledgerOf(ws)).toContain("reason: http-403"); // the fresh attempt
  });

  it("a `never` surface is not verified: nothing is deployed, so no request is made", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "content"));
    writeFileSync(join(dir, "content", "identity.yaml"), IDENTITY, "utf8");
    const { fetch, calls } = scriptedFetch({});

    const { code, data } = await verifyJson({
      workspace: dir,
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(data.units.every((u) => u.certification === null)).toBe(true);
    expect(existsSync(join(dir, "content", "deployments.yaml"))).toBe(false);
  });

  it("--verify <platform> filters: another recorded surface is left untouched", async () => {
    const ws = workspace();
    const hash = hashUnit({ name: "Elena Vasquez", location: "Madrid, Spain" });
    writeFileSync(
      join(ws, "content", "deployments.yaml"),
      [
        "identity:",
        "  github-readme:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${hash}`,
        "    source: manual",
        "  linkedin:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${hash}`,
        "    source: manual",
        "    certification:",
        "      state: unverifiable",
        "      reason: walled",
      ].join("\n"),
      "utf8",
    );
    const { fetch, calls } = scriptedFetch({ [FETCH_URL]: { status: 403 } });

    await verifyJson({
      workspace: ws,
      platformArg: "github-readme",
      verify: true,
      deps: deps({ "github-readme": capability() }, fetch),
    });

    expect(calls).toEqual([FETCH_URL]);
    const ledger = ledgerOf(ws);
    expect(ledger).toContain("reason: http-403"); // the verified surface
    expect(ledger).toContain("reason: walled"); // the untouched one
    expect(ledger).toContain("linkedin:");
  });
});
