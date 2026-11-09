/**
 * D28 egress authorization at the CLI (SPEC §7.11, issue #503 slice S503a).
 *
 * What this file pins, end to end against the BUILT binary:
 *  - `export profile --all` is refused (exit 1) without `--confirm`, prints the
 *    exact manifest digest and writes NOTHING — no payload, no audit line, no
 *    baseline;
 *  - the matching digest authorizes it, and the audit log carries operation ·
 *    digest · keyId (`null`) · timestamp, one JSONL line per egress;
 *  - a private → public flip is detected against the last recorded egress:
 *    `build` refuses, the refusal is not a bypass (nothing recorded), and a
 *    confirmed re-run records the act before writing the artifacts;
 *  - the log is APPEND-ONLY at the byte level: a later egress never rewrites an
 *    earlier line;
 *  - the first egress of a workspace (no baseline) is recorded as `absent` — the
 *    declared S503a limit, tested as behavior instead of claimed in prose.
 *
 * Every test works on a temp COPY of the committed export-profile fixture (the
 * CLI writes `.pasco/egress/` into the workspace it is given).
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { egressManifest, load, parseEgressAudit } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "fixtures", "export-profile");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 20_000 });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-egress-"));
  tempDirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  // The fixture is committed as a workspace; drop any egress state a previous
  // test run left behind so every case starts from a known "no baseline".
  rmSync(join(dir, ".pasco"), { recursive: true, force: true });
  return dir;
}

/** The digest the CLI will compute for a workspace — the contract is core's. */
function digestOf(ws: string, scope: "public" | "all"): string {
  return egressManifest(load(ws), scope).digest;
}

function auditRaw(ws: string): string {
  const path = join(ws, ".pasco", "egress", "audit.log");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function audit(ws: string): ReturnType<typeof parseEgressAudit> {
  return parseEgressAudit(auditRaw(ws));
}

function flipFirstProjectPublic(ws: string): void {
  const path = join(ws, "content", "projects.yaml");
  const text = readFileSync(path, "utf8");
  const flipped = text.replace("  status: active\n", "  status: active\n  visibility: public\n");
  expect(flipped).not.toBe(text);
  writeFileSync(path, flipped);
}

interface Envelope {
  ok: boolean;
  exitCode: number;
  data?: {
    egress?: {
      refused?: boolean;
      code?: string;
      scope?: string;
      digest?: string;
      reasons?: string[];
      transitions?: string[];
      keyId?: string | null;
      audit?: string;
    };
    scope?: string;
  };
  error?: { kind: string; message: string; hint?: string; violations?: { path: string }[] };
}

describe("export profile --all — a privileged egress", () => {
  it("refuses without --confirm, names the digest and writes nothing", () => {
    const ws = workspace();
    const r = run(["export", "profile", "--json", "--all", "--workspace", ws]);
    expect(r.code).toBe(1);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.ok).toBe(false);
    expect(envelope.exitCode).toBe(1);
    expect(envelope.error?.kind).toBe("egress");
    expect(envelope.data?.egress?.refused).toBe(true);
    expect(envelope.data?.egress?.code).toBe("confirmation-required");
    expect(envelope.data?.egress?.digest).toBe(digestOf(ws, "all"));
    expect(envelope.data?.egress?.reasons).toEqual(["full-export"]);
    expect(envelope.data?.egress?.keyId).toBeNull();
    // Nothing was written: no payload in data, no state on disk, no audit line.
    expect(envelope.data?.scope).toBeUndefined();
    expect(existsSync(join(ws, ".pasco"))).toBe(false);
  });

  it("the matching digest authorizes it and records the four D28 fields", () => {
    const ws = workspace();
    const digest = digestOf(ws, "all");
    const r = run(["export", "profile", "--json", "--all", "--confirm", digest, "--workspace", ws]);
    expect(r.code).toBe(0);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.ok).toBe(true);

    const log = audit(ws);
    expect(log.malformed).toEqual([]);
    expect(log.records).toHaveLength(1);
    const [record] = log.records;
    expect(record?.operation).toBe("export-profile");
    expect(record?.scope).toBe("all");
    expect(record?.digest).toBe(digest);
    expect(record?.keyId).toBeNull();
    expect(record?.method).toBe("digest-confirm");
    expect(record?.reasons).toEqual(["full-export"]);
    expect(Number.isNaN(Date.parse(record?.at ?? ""))).toBe(false);
  });

  it("a stale --confirm is refused (the workspace changed since the digest)", () => {
    const ws = workspace();
    const r = run([
      "export",
      "profile",
      "--json",
      "--all",
      "--confirm",
      `sha256:${"0".repeat(64)}`,
      "--workspace",
      ws,
    ]);
    expect(r.code).toBe(1);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.data?.egress?.code).toBe("confirm-mismatch");
    expect(envelope.error?.message).toMatch(/does not match this manifest/);
    expect(existsSync(join(ws, ".pasco"))).toBe(false);
  });

  it("the default public export needs no authorization and is still recorded", () => {
    const ws = workspace();
    const r = run(["export", "profile", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const log = audit(ws);
    expect(log.records).toHaveLength(1);
    expect(log.records[0]?.scope).toBe("public");
    expect(log.records[0]?.method).toBe("none");
    expect(log.records[0]?.reasons).toEqual([]);
    expect(log.records[0]?.baseline).toBe("absent"); // first egress: no baseline
  });

  it("--confirm is refused on export ai-policy (it has no egress manifest)", () => {
    const r = run(["export", "ai-policy", "--check", "--confirm", "sha256:abc"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--confirm only applies to export profile");
  });
});

describe("private → public — the transition gate on build", () => {
  it("refuses when a row became public since the last recorded egress", () => {
    const ws = workspace();
    // Establish the baseline: the fixture's projects are private (D27 default).
    expect(run(["export", "profile", "--json", "--workspace", ws]).code).toBe(0);
    const before = auditRaw(ws);
    flipFirstProjectPublic(ws);

    const r = run(["build", "github-readme", "--json", "--workspace", ws]);
    expect(r.code).toBe(1);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.error?.kind).toBe("egress");
    expect(envelope.data?.egress?.reasons).toEqual(["private-to-public"]);
    expect(envelope.data?.egress?.transitions).toEqual(["projects:sovereign-hub"]);
    expect(envelope.error?.violations?.map((violation) => violation.path)).toContain(
      "projects:sovereign-hub",
    );
    // A refusal is not a bypass: no artifact, and the log is byte-identical.
    expect(existsSync(join(ws, "profiles"))).toBe(false);
    expect(auditRaw(ws)).toBe(before);
  });

  it("the confirmed re-run records the act before writing, and the next run is not privileged", () => {
    const ws = workspace();
    expect(run(["export", "profile", "--json", "--workspace", ws]).code).toBe(0);
    flipFirstProjectPublic(ws);
    const firstLine = auditRaw(ws);
    const digest = digestOf(ws, "public");

    const confirmed = run([
      "build",
      "github-readme",
      "--json",
      "--confirm",
      digest,
      "--workspace",
      ws,
    ]);
    expect(confirmed.code).toBe(0);
    expect(existsSync(join(ws, "profiles", "github-readme", "README.md"))).toBe(true);

    const after = audit(ws);
    expect(after.malformed).toEqual([]);
    expect(after.records).toHaveLength(2);
    expect(after.records[1]?.operation).toBe("build");
    expect(after.records[1]?.reasons).toEqual(["private-to-public"]);
    expect(after.records[1]?.baseline).toBe("recorded");
    // Append-only at the byte level: the earlier line survives untouched.
    expect(auditRaw(ws).startsWith(firstLine)).toBe(true);

    // The baseline moved: the same manifest is no longer a transition.
    const again = run(["build", "github-readme", "--json", "--workspace", ws]);
    expect(again.code).toBe(0);
    const envelope = JSON.parse(again.stdout) as Envelope;
    expect(envelope.data?.egress?.reasons).toEqual([]);
    expect(audit(ws).records).toHaveLength(3);
  });

  it("the first egress of a workspace has no baseline to compare (recorded as `absent`)", () => {
    const ws = workspace();
    flipFirstProjectPublic(ws);
    // No prior egress: the flip is indistinguishable from the initial state —
    // the declared S503a limit, on the record instead of implied.
    const r = run(["build", "github-readme", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.data?.egress?.reasons).toEqual([]);
    expect(audit(ws).records[0]?.baseline).toBe("absent");
  });

  it("the export path is gated too, not only build", () => {
    const ws = workspace();
    expect(run(["export", "profile", "--json", "--workspace", ws]).code).toBe(0);
    flipFirstProjectPublic(ws);
    const r = run(["export", "profile", "--json", "--workspace", ws]);
    expect(r.code).toBe(1);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.data?.egress?.reasons).toEqual(["private-to-public"]);
    expect(envelope.data?.egress?.transitions).toEqual(["projects:sovereign-hub"]);
    expect(audit(ws).records).toHaveLength(1); // the refusal recorded nothing
  });
});

describe("state the gate cannot trust is never treated as clean", () => {
  it("an unreadable baseline makes the run privileged instead of skipping the check", () => {
    const ws = workspace();
    expect(run(["export", "profile", "--json", "--workspace", ws]).code).toBe(0);
    writeFileSync(join(ws, ".pasco", "egress", "baseline.json"), "{not json");
    const digest = digestOf(ws, "public");

    const refused = run(["export", "profile", "--json", "--workspace", ws]);
    expect(refused.code).toBe(1);
    const envelope = JSON.parse(refused.stdout) as Envelope;
    expect(envelope.data?.egress?.code).toBe("confirmation-required");
    expect(envelope.data?.egress?.reasons).toEqual(["baseline-unreadable"]);
    expect(envelope.error?.violations?.map((violation) => violation.path)).toContain(
      ".pasco/egress/baseline.json",
    );

    // Confirming the whole manifest is the only way through, and the line keeps
    // saying the comparison could not run.
    const confirmed = run(["export", "profile", "--json", "--confirm", digest, "--workspace", ws]);
    expect(confirmed.code).toBe(0);
    const records = audit(ws).records;
    expect(records).toHaveLength(2);
    expect(records[1]?.method).toBe("digest-confirm");
    expect(records[1]?.reasons).toEqual(["baseline-unreadable"]);
    expect(records[1]?.baseline).toBe("unreadable");
  });

  it("an unrecordable egress is refused, and the refusal says so", () => {
    const ws = workspace();
    // `.pasco/egress` is a FILE: the audit append cannot create the directory.
    writeFileSync(join(ws, ".pasco"), "");
    const r = run(["export", "profile", "--json", "--workspace", ws]);
    expect(r.code).toBe(1);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.data?.egress?.code).toBe("audit-failed");
    expect(envelope.error?.message).toMatch(/could not be recorded/);
    expect(existsSync(join(ws, "profiles"))).toBe(false);
  });

  it("a recorded authorization whose baseline cannot move is refused with its own code", () => {
    const ws = workspace();
    expect(run(["export", "profile", "--json", "--workspace", ws]).code).toBe(0);
    // A directory where the baseline file should be: the atomic rename cannot land.
    rmSync(join(ws, ".pasco", "egress", "baseline.json"), { force: true });
    mkdirSync(join(ws, ".pasco", "egress", "baseline.json"));
    const r = run([
      "export",
      "profile",
      "--json",
      "--confirm",
      digestOf(ws, "public"),
      "--workspace",
      ws,
    ]);
    expect(r.code).toBe(1);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.data?.egress?.code).toBe("baseline-failed");
    expect(envelope.error?.message).toMatch(/recorded .* but the baseline could not move/);
    // The authorization line IS there — the refusal says so instead of pretending
    // nothing happened, and the baseline stays where it was.
    expect(audit(ws).records).toHaveLength(2);
  });
});
