/**
 * #215 — the Lane A ↔ Lane B integration, end to end and offline: the
 * `capabilitiesOf(profile)` registry (Lane B's extractor wired into the CLI) plus
 * the `--mark` anchor, exercised against the §19.5 verdict table with a fetch
 * injected (NO test in this repo touches the network).
 *
 * What these tests pin, and why each one is worth its bytes:
 *   - the registry resolves `artifactUrl` PER WORKSPACE from the URL SSOT (the one
 *     thing a static map could never do), and declares the honest `null` rung when
 *     the workspace names no GitHub surface;
 *   - `--mark` records the anchor, and that anchor IS the digest of the artifact
 *     `pasco build` writes — not of an approximation. That is the claim §19.5
 *     rests on: re-rendering differently would read as permanent drift;
 *   - the table's rows 3/4/5 fire from a REAL record: same projection → `verified`,
 *     edited projection → `out-of-band-drift: live-mismatch`, no anchor →
 *     `unverifiable: unattributed`;
 *   - the allowlist still refuses before the socket, with the same extractor the
 *     real registry hands over.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "@profile-as-code/core";
import { extractArtifact } from "@profile-as-code/renderers-github-readme";
import { afterAll, describe, expect, it } from "vitest";
import { capabilitiesOf } from "../src/capabilities.js";
import { runBuild } from "../src/commands/build.js";
import { runStatus } from "../src/commands/status.js";
import { setJsonMode } from "../src/output.js";
import type { FetchText, StatusDeps } from "../src/verify.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-anchor-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const GITHUB_URL = "https://github.com/elenavasquez";
/** The URL §19.5 derives from the SSOT above (`owner/owner` repo, `HEAD`). */
const ARTIFACT_URL = "https://raw.githubusercontent.com/elenavasquez/elenavasquez/HEAD/README.md";

/** A real one-surface workspace: identity + a headline, on `github-readme`.
 *  `withGithubLink: false` models a workspace that names no GitHub surface. */
function workspace(withGithubLink = true): string {
  const dir = tempDir();
  mkdirSync(join(dir, "content"));
  writeFileSync(
    join(dir, "content", "identity.yaml"),
    [
      "name: Elena Vasquez",
      "location: Madrid, Spain",
      ...(withGithubLink
        ? ["links:", "  - platform: github", "    label: GitHub", `    url: ${GITHUB_URL}`]
        : []),
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(dir, "content", "headlines.yaml"),
    "- platform: github-readme\n  lang: en\n  text: Verified headline\n",
    "utf8",
  );
  return dir;
}

/** `pasco build` for one surface — writes `profiles/<surface>/README.md`, the
 *  exact bytes the operator pastes and `--mark` anchors (§15.5). */
function build(ws: string): string {
  const code = runBuild({
    workspace: ws,
    platformArg: "github-readme",
    pascorc: { defaults: { lang: "en" } },
  });
  expect(code).toBe(0);
  return readFileSync(join(ws, "profiles", "github-readme", "README.md"), "utf8");
}

const ledgerOf = (ws: string): string =>
  readFileSync(join(ws, "content", "deployments.yaml"), "utf8");

const digest = (artifact: string): string =>
  createHash("sha256").update(artifact, "utf8").digest("hex");

/** Capture the JSON envelope `report()` writes to stdout. */
async function capture(args: Parameters<typeof runStatus>[0]): Promise<{
  code: number;
  data: Record<string, unknown>;
}> {
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
  return { code, data: (JSON.parse(out) as { data: Record<string, unknown> }).data };
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

const deps = (fetch: FetchText): Partial<StatusDeps> => ({ fetchText: fetch });

const markedAnchor = (data: Record<string, unknown>): string | undefined =>
  (data.certification as { artifactHash?: string } | undefined)?.artifactHash;

/** One unit's certification from a `--verify --json` payload — the shape every
 *  row of the table below reads (one cast, one place). */
interface JsonUnit {
  key: string;
  certification: {
    state: string;
    surfaces: Record<string, { state: string; reason?: string; liveHash?: string }>;
  };
}
const unitOf = (data: Record<string, unknown>, key: string): JsonUnit | undefined =>
  (data.units as unknown as JsonUnit[]).find((u) => u.key === key);

describe("#215 capabilitiesOf — per workspace, derived from the URL SSOT", () => {
  it("resolves artifactUrl for the workspace's own owner, and the host is in the declared allowlist", () => {
    const caps = capabilitiesOf(load(workspace()));
    const readme = caps["github-readme"];
    expect(readme?.artifactUrl).toBe(ARTIFACT_URL);
    // The declaration is coherent with itself: the URL the pass would fetch is on
    // a host the SAME declaration allows (§19.5 — validated before the socket).
    expect(readme?.fetchHosts).toContain(new URL(readme?.artifactUrl as string).host);
    expect(typeof readme?.extractor).toBe("function");
  });

  it("declares no-artifact-url (artifactUrl null) when the workspace names no GitHub surface", () => {
    const caps = capabilitiesOf(load(workspace(false)));
    // The extractor still exists — the honest rung is `no-artifact-url`, NOT the
    // lie `no-extractor`. `github-org` cannot derive one either.
    expect(caps["github-readme"]?.artifactUrl).toBeNull();
    expect(caps["github-org"]?.artifactUrl).toBeNull();
    expect(typeof caps["github-readme"]?.extractor).toBe("function");
  });
});

describe("#215 --mark — the anchor is the digest of what `pasco build` wrote", () => {
  it("records artifactHash = SHA-256(extractArtifact(built artifact)) and state attested", async () => {
    const ws = workspace();
    const built = build(ws);
    const { code, data } = await capture({
      workspace: ws,
      markKey: "identity",
      platformArg: "github-readme",
      lang: "en",
    });

    expect(code).toBe(0);
    const anchor = markedAnchor(data);
    expect(anchor).toMatch(/^[a-f0-9]{64}$/);
    // The whole point: the anchor and the built artifact agree byte-for-byte
    // after extraction. A divergence here would make every later `--verify` read
    // `out-of-band-drift` on an untouched surface.
    expect(anchor).toBe(digest(extractArtifact(built)));
    expect(ledgerOf(ws)).toContain(`artifactHash: ${anchor}`);
    expect(ledgerOf(ws)).toContain("state: attested");
  });

  it("records attested with NO anchor on a surface with no extractor (declared forward-only limit)", async () => {
    const ws = workspace();
    const { data } = await capture({
      workspace: ws,
      markKey: "identity",
      platformArg: "linkedin",
      lang: "en",
    });
    expect(markedAnchor(data)).toBeUndefined();
    // `linkedin` is absent from the registry → no-extractor. Nothing is guessed.
    expect(ledgerOf(ws)).not.toContain("artifactHash:");
  });
});

describe("#215 --verify — the §19.5 table, from a real anchor, with the fetch injected", () => {
  it("row 3: the live projection equals the anchor → verified", async () => {
    const ws = workspace();
    const built = build(ws);
    const { data: marked } = await capture({
      workspace: ws,
      markKey: "identity",
      platformArg: "github-readme",
      lang: "en",
    });
    const anchor = markedAnchor(marked);
    const { fetch, calls } = scriptedFetch({ [ARTIFACT_URL]: { status: 200, text: built } });

    const { code, data } = await capture({
      workspace: ws,
      verify: true,
      deps: deps(fetch),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([ARTIFACT_URL]); // one request, on the derived URL
    const unit = unitOf(data, "identity");
    expect(unit?.certification.state).toBe("verified");
    expect(unit?.certification.surfaces["github-readme"]?.state).toBe("verified");
    expect(unit?.certification.surfaces["github-readme"]?.liveHash).toBe(anchor);
    expect(ledgerOf(ws)).toContain(`liveHash: ${anchor}`);
    expect(ledgerOf(ws)).toContain(`artifactHash: ${anchor}`); // anchor untouched
  });

  it("row 4: an edited live projection → out-of-band-drift: live-mismatch", async () => {
    const ws = workspace();
    const built = build(ws);
    await capture({
      workspace: ws,
      markKey: "identity",
      platformArg: "github-readme",
      lang: "en",
    });
    // Inside the engine-owned region: an out-of-band edit the anchor must catch.
    const edited = built.replace("### Verified headline", "### Edited out of band");
    expect(edited).not.toBe(built);
    const { fetch } = scriptedFetch({ [ARTIFACT_URL]: { status: 200, text: edited } });

    const { data } = await capture({ workspace: ws, verify: true, deps: deps(fetch) });
    const unit = unitOf(data, "identity");

    expect(unit?.certification.state).toBe("out-of-band-drift");
    expect(unit?.certification.surfaces["github-readme"]).toMatchObject({
      state: "out-of-band-drift",
      reason: "live-mismatch",
    });
    expect(ledgerOf(ws)).toContain("reason: live-mismatch");
  });

  it("row 5: an anchor-less record is observed but not judged → unverifiable: unattributed", async () => {
    const ws = workspace();
    const built = build(ws);
    // A pre-v1.10 / un-renderable confirmation: a record with no anchor at all.
    writeFileSync(
      join(ws, "content", "deployments.yaml"),
      [
        "identity:",
        "  github-readme:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${"a".repeat(64)}`,
        "    source: manual",
        "",
      ].join("\n"),
      "utf8",
    );
    const { fetch, calls } = scriptedFetch({ [ARTIFACT_URL]: { status: 200, text: built } });

    const { data } = await capture({ workspace: ws, verify: true, deps: deps(fetch) });
    const unit = unitOf(data, "identity");

    expect(calls).toEqual([ARTIFACT_URL]); // it WAS observed
    expect(unit?.certification.state).toBe("unverifiable");
    expect(unit?.certification.surfaces["github-readme"]).toMatchObject({
      state: "unverifiable",
      reason: "unattributed",
    });
    expect(ledgerOf(ws)).toContain("reason: unattributed");
  });

  it("the allowlist fires BEFORE the socket, with the real extractor in hand", async () => {
    const ws = workspace();
    build(ws);
    await capture({
      workspace: ws,
      markKey: "identity",
      platformArg: "github-readme",
      lang: "en",
    });
    const { fetch, calls } = scriptedFetch({}); // any request would throw: unscripted
    const real = capabilitiesOf(load(ws))["github-readme"];
    const { data } = await capture({
      workspace: ws,
      verify: true,
      deps: {
        // Same extractor/allowlist the registry declares; only the URL is hostile.
        capabilities: {
          "github-readme": { ...real, artifactUrl: "http://169.254.169.254/latest/meta-data/" },
        },
        fetchText: fetch,
      },
    });

    expect(calls).toEqual([]); // the SSRF primitive is refused before the socket
    const unit = unitOf(data, "identity");
    expect(unit?.certification.surfaces["github-readme"]).toMatchObject({
      state: "unverifiable",
      reason: "host-not-allowed",
    });
    // A refused host is a declaration, not an event: no fetch evidence is written.
    expect(ledgerOf(ws)).not.toContain("host-not-allowed");
  });
});

describe("#215 --verify — a workspace that names no GitHub surface", () => {
  it("declares no-artifact-url and never requests", async () => {
    const ws = workspace(false);
    await capture({
      workspace: ws,
      markKey: "identity",
      platformArg: "github-readme",
      lang: "en",
    });
    const { fetch, calls } = scriptedFetch({});
    const { data } = await capture({ workspace: ws, verify: true, deps: deps(fetch) });
    const unit = unitOf(data, "identity");

    expect(calls).toEqual([]);
    // No anchor was recorded: the URL gate (`declaredReason`) refuses to attest a
    // surface `--verify` could never judge, so the pass reads the DECLARED rung —
    // the honest floor for a workspace with no GitHub surface.
    expect(ledgerOf(ws)).not.toContain("artifactHash:");
    expect(unit?.certification.surfaces["github-readme"]).toMatchObject({
      state: "unverifiable",
      reason: "no-artifact-url",
    });
  });
});
