/**
 * `pasco export profile [--json] [--now <iso8601>]` — the compiled profile for
 * programmatic consumers (SPEC §7.5, #348).
 *
 * What this file pins:
 *  - the EXACT bytes of the `--json` payload (a committed golden fixture, with
 *    only the run-dependent `source.commit` replaced by `<commit>`);
 *  - determinism: no clock and no network, so two runs are byte-identical and
 *    `generatedAt` is null unless `--now` pins it (verbatim);
 *  - the three defects of the consumer this replaces (#348 evidence): every list
 *    root present (education/languages/credentials/artifacts/faq), every
 *    `artifactRefs` id resolvable in `profile.artifacts[]`, and
 *    `publications[].url` emitted as declared;
 *  - the exit matrix: 1 load/schema or a malformed `--now`, 2 usage.
 *
 * The fixture is a full workspace (`packages/cli/tests/fixtures/export-profile/`)
 * derived from the core `complete` fixture plus the roots it lacked; it lives in
 * the git worktree, so `source.commit` is this repository's HEAD — which is why
 * the golden carries a placeholder for it instead of a sha that would change on
 * every commit.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "fixtures", "export-profile");
const GOLDEN = join(FIXTURE, "golden.json");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd?: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    timeout: 15_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-export-profile-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** The workspace's own commit — the one value the golden cannot pin. */
function fixtureCommit(): string {
  return execFileSync("git", ["-C", FIXTURE, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

interface Payload {
  contract: string;
  engine: { name: string; version: string };
  source: { commit: string | null; generatedAt: string | null };
  profile: Record<string, unknown> & {
    artifacts: { id?: string }[];
    projects: { artifactRefs?: string[] }[];
    publications: { url?: string; artifactRefs?: string[] }[];
  };
}

interface Envelope {
  command: string;
  ok: boolean;
  exitCode: number;
  data?: Payload;
  error?: { kind: string; message: string; violations?: { path: string; message: string }[] };
}

function exportProfile(args: string[] = [], cwd?: string): Envelope {
  const res = run(["export", "profile", "--json", "--workspace", FIXTURE, ...args], cwd);
  expect(res.code).toBe(0);
  return JSON.parse(res.stdout) as Envelope;
}

describe("pasco export profile — the payload", () => {
  it("emits the exact golden bytes (only the workspace commit is run-dependent)", () => {
    const res = run(["export", "profile", "--json", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    const commit = fixtureCommit();
    // The placeholder keeps the golden stable across commits while still pinning
    // every other byte, including key order and the 2-space indentation.
    expect(res.stdout).toBe(readFileSync(GOLDEN, "utf8").replace("<commit>", commit));
  });

  it("is byte-identical across runs and reads no clock", () => {
    const first = run(["export", "profile", "--json", "--workspace", FIXTURE]);
    const second = run(["export", "profile", "--json", "--workspace", FIXTURE]);
    expect(first.stdout).toBe(second.stdout);
    const payload = JSON.parse(first.stdout) as Envelope;
    expect(payload.data?.source.generatedAt).toBeNull();
    expect(payload.data?.source.commit).toBe(fixtureCommit());
  });

  it("pins generatedAt verbatim under --now and changes nothing else", () => {
    const withoutNow = exportProfile();
    const now = "2026-10-28T00:00:00-05:00";
    const withNow = exportProfile(["--now", now]);
    expect(withNow.data?.source.generatedAt).toBe(now);
    // Every other byte is the same: --now is the only clock-reading path.
    expect(withNow.data?.profile).toEqual(withoutNow.data?.profile);
    expect(withNow.data?.contract).toBe(withoutNow.data?.contract);
  });

  it("carries the contract, the engine and the standard envelope", () => {
    const envelope = exportProfile();
    expect(envelope.command).toBe("export profile");
    expect(envelope.ok).toBe(true);
    expect(envelope.exitCode).toBe(0);
    expect(envelope.data?.contract).toBe("1");
    expect(envelope.data?.engine.name).toBe("@profile-as-code/cli");
    expect(envelope.data?.engine.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("includes every schema root a consumer previously had to hardcode (#348)", () => {
    const profile = exportProfile().data?.profile;
    if (profile === undefined) throw new Error("no profile in the envelope");
    for (const root of [
      "identity",
      "positioning",
      "bios",
      "headlines",
      "skills",
      "experience",
      "education",
      "languages",
      "projects",
      "publications",
      "keywords",
      "deployments",
      "credentials",
      "artifacts",
      "faq",
    ]) {
      expect(Object.hasOwn(profile, root), `root ${root} is missing`).toBe(true);
    }
    // The four roots the CV consumer hardcoded to [] plus the answer surface:
    // list roots are ALWAYS arrays, never absent.
    for (const listRoot of [
      "education",
      "languages",
      "credentials",
      "artifacts",
      "faq",
      "press",
      "socialHandles",
      "checks",
    ]) {
      expect(Array.isArray(profile[listRoot]), `${listRoot} is not an array`).toBe(true);
    }
    expect(profile.education).toEqual(expect.any(Array));
    expect((profile.education as unknown[]).length).toBeGreaterThan(0);
    expect(profile.deployments).toEqual(expect.any(Object));
  });

  it("keeps artifactRefs as ids that resolve against profile.artifacts[]", () => {
    const profile = exportProfile().data?.profile;
    if (profile === undefined) throw new Error("no profile in the envelope");
    const artifactIds = new Set(profile.artifacts.map((artifact) => artifact.id));
    const refs = [
      ...profile.projects.flatMap((row) => row.artifactRefs ?? []),
      ...profile.publications.flatMap((row) => row.artifactRefs ?? []),
    ];
    // The fixture declares at least one ref, so the assertion cannot go vacuous.
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(artifactIds.has(ref), `artifactRefs id "${ref}" has no artifact`).toBe(true);
    }
  });

  it("respects publications[].url as declared (DOI does not replace it)", () => {
    const publications = exportProfile().data?.profile.publications ?? [];
    const row = publications.find((publication) => publication.url !== undefined);
    if (row === undefined) throw new Error("fixture declares no publication.url");
    expect(row.url).toBe("https://example.com/papers/sovereign-routing");
  });

  it("reports commit: null outside a git repository", () => {
    const dir = tempDir();
    cpSync(FIXTURE, dir, { recursive: true });
    const res = run(["export", "profile", "--json", "--workspace", dir]);
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout) as Envelope;
    expect(payload.data?.source.commit).toBeNull();
  });

  it("prints a human summary without --json", () => {
    const res = run(["export", "profile", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("compiled profile");
    expect(res.stdout).toContain("contract: 1");
    expect(res.stdout).toContain("use --json for the payload a consumer reads");
    // Human mode is not the contract: no JSON envelope on stdout.
    expect(() => JSON.parse(res.stdout)).toThrow();
  });
});

describe("pasco export profile — the exit matrix", () => {
  it("exits 1 with the error envelope when the workspace cannot load", () => {
    const dir = tempDir();
    const res = run(["export", "profile", "--json", "--workspace", dir]);
    expect(res.code).toBe(1);
    const envelope = JSON.parse(res.stdout) as Envelope;
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.kind).toBe("load");
  });

  it("exits 1 on a malformed --now (no clock guess)", () => {
    for (const now of ["tomorrow", "2026-10-28", "2026-13-01T00:00:00Z", ""]) {
      const res = run(["export", "profile", "--json", "--workspace", FIXTURE, "--now", now]);
      expect(res.code, `--now "${now}" should refuse`).toBe(1);
      const envelope = JSON.parse(res.stdout) as Envelope;
      expect(envelope.ok).toBe(false);
      expect(envelope.error?.kind).toBe("now");
    }
  });

  it("exits 2 for an unknown export subcommand and for ai-policy-only flags", () => {
    const unknown = run(["export", "compile", "--json", "--workspace", FIXTURE]);
    expect(unknown.code).toBe(2);
    for (const flag of [["--out", "dist"], ["--check"], ["--force"], ["--lang", "en"]]) {
      const res = run(["export", "profile", ...flag, "--workspace", FIXTURE]);
      expect(res.code, `${flag.join(" ")} should be a usage error`).toBe(2);
    }
  });
});
