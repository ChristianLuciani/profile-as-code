/**
 * `pasco presence` / `pasco release plan` — the D23 CLI contract (issue #262,
 * SPEC §22).
 *
 * The command is exercised through the BUILT binary (the cli.test.ts pattern):
 * the envelope shape, the ordering, the derived state and the refusals are the
 * contract. The fixture is the core `releases` workspace, reused not duplicated.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const RELEASES = join(__dirname, "..", "..", "core", "tests", "fixtures", "releases");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 15_000 });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

interface Envelope {
  command: string;
  ok: boolean;
  exitCode: number;
  data?: Record<string, unknown>;
  error?: { kind: string; message: string };
}

function json(result: RunResult): Envelope {
  return JSON.parse(result.stdout) as Envelope;
}

describe("pasco presence", () => {
  it("--json emits the board with the frozen schemaVersion", () => {
    const result = run(["presence", "--json", "--workspace", RELEASES]);
    expect(result.code).toBe(0);
    const envelope = json(result);
    expect(envelope.command).toBe("presence");
    expect(envelope.data?.schemaVersion).toBe("1");
    expect(envelope.data?.releases).toBe(2);
    expect(envelope.data?.counts).toEqual({ "in-sync": 1, stale: 1, never: 3 });
    const surfaces = envelope.data?.surfaces as { surface: string; releaseId: string }[];
    expect(surfaces.map((row) => row.surface)).toContain("github-repo-meta");
    expect(surfaces.find((row) => row.surface === "x")?.releaseId).toBe("v0-2-0");
  });

  it("the human board names kind, surface, state and release", () => {
    const result = run(["presence", "--workspace", RELEASES]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Presence — 2 release(s) · latest v0.3.0 (2026-10-28)");
    expect(result.stdout).toMatch(/repo-meta\s+github-repo-meta\s+never\s+v0-3-0/);
    expect(result.stdout).toContain("in-sync: 1 · stale: 1 · never: 3");
  });

  it("renders an EMPTY board (exit 0) when the workspace has no releases yet", () => {
    const result = run(["presence", "--json", "--workspace", MINIMAL]);
    expect(result.code).toBe(0);
    const envelope = json(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.data?.latest).toBeNull();
    expect(envelope.data?.surfaces).toEqual([]);
    expect(envelope.data?.counts).toEqual({ "in-sync": 0, stale: 0, never: 0 });
  });
});

describe("pasco release plan", () => {
  it("--json emits the ordered fan-out and the per-kind base text", () => {
    const result = run(["release", "plan", "--json", "--workspace", RELEASES]);
    expect(result.code).toBe(0);
    const envelope = json(result);
    expect(envelope.command).toBe("release plan");
    expect(envelope.data?.schemaVersion).toBe("1");
    const release = envelope.data?.release as { id: string; version: string };
    expect(release).toMatchObject({ id: "v0-3-0", version: "0.3.0" });
    const surfaces = envelope.data?.surfaces as { surface: string; state: string }[];
    expect(surfaces.map((row) => row.surface)).toEqual([
      "github-repo-meta",
      "github-readme",
      "linkedin",
      "hacker-news",
    ]);
    expect(surfaces.find((row) => row.surface === "linkedin")?.state).toBe("stale");
    const baseText = envelope.data?.baseText as { kind: string; text: string }[];
    expect(baseText.map((entry) => entry.kind)).toEqual(["repo-meta", "profile", "distribution"]);
  });

  it("addresses a release by id", () => {
    const result = run(["release", "plan", "v0-2-0", "--json", "--workspace", RELEASES]);
    expect(result.code).toBe(0);
    const envelope = json(result);
    const release = (envelope.data as { release: { version: string } }).release;
    expect(release.version).toBe("0.2.0");
  });

  it("fails on an unknown release id with the known list", () => {
    const result = run(["release", "plan", "nope", "--json", "--workspace", RELEASES]);
    expect(result.code).toBe(1);
    expect(json(result).error?.message).toContain("known releases: v0-3-0, v0-2-0");
  });

  it("treats any subcommand other than plan as usage", () => {
    const result = run(["release", "publish", "--workspace", RELEASES]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("pasco release plan");
  });

  it("the human plan prints the order and the base text", () => {
    const result = run(["release", "plan", "--workspace", RELEASES]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Release plan v0.3.0 (2026-10-28) · v0-3-0");
    expect(result.stdout).toMatch(/1\s+repo-meta\s+github-repo-meta\s+never/);
    expect(result.stdout).toContain("[distribution] Announcement: v0.3.0");
  });

  it("calls a valid changedUnit without a deploy record a pending fan-out, never 'not an SSOT unit' (#408)", () => {
    const result = run(["release", "plan", "--workspace", RELEASES]);
    expect(result.code).toBe(0);
    // `identity` IS an SSOT unit: github-repo-meta and hacker-news simply have no
    // record in `deployments` — the repro of #408. The plan must not send the
    // operator to fix a row that is correct.
    expect(result.stdout).not.toContain("is not an SSOT unit");
    expect(result.stdout).toContain(
      'changedUnit "identity" has no deploy record on this surface yet — pending fan-out',
    );
  });

  it("still reports a key that resolves to no SSOT unit as a row defect (#408)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-408-"));
    try {
      cpSync(RELEASES, dir, { recursive: true });
      const file = join(dir, "content", "releases.yaml");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(
          "changedUnits: [identity]",
          "changedUnits: [identity, publications:gone]",
        ),
      );
      const result = run(["release", "plan", "--workspace", dir]);
      expect(result.code).toBe(0);
      // The bad key IS a defect in the row → named as one…
      expect(result.stdout).toContain(
        'changedUnit "publications:gone" is not an SSOT unit — fix the release row',
      );
      // …while the valid unit without a record stays a fan-out, not an error.
      expect(result.stdout).toContain(
        'changedUnit "identity" has no deploy record on this surface yet — pending fan-out',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
