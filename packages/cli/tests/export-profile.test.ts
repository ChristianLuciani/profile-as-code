/**
 * `pasco export profile [--json] [--now <iso8601>]` — the normalized profile for
 * programmatic consumers (SPEC §7.5, #348).
 *
 * What this file pins:
 *  - the EXACT bytes of the `--json` payload (a committed golden fixture, with
 *    only the two release/run-dependent values replaced: `source.commit` →
 *    `<commit>` and `engine.version` → `<version>`);
 *  - determinism: no clock and no network, so two runs are byte-identical and
 *    `generatedAt` is null unless `--now` pins it (verbatim, calendar-checked);
 *  - the shape promise, MECHANICALLY: the root set comes from
 *    `schema/profile.schema.json`, so a new schema root cannot slip through a
 *    hand-written list — every declared root is present, every list root is an
 *    array (`[]` when undeclared), and an optional object root appears only when
 *    the workspace declares it;
 *  - the three defects of the consumer this replaces (#348 evidence): the roots
 *    it hardcoded, `artifactRefs` ids resolvable in `profile.artifacts[]`, and
 *    `publications[].url` emitted as declared;
 *  - the exit matrix: 1 load/schema or a malformed/impossible `--now`, 2 usage.
 *
 * The fixture is a full workspace (`packages/cli/tests/fixtures/export-profile/`);
 * it lives in the git worktree, so `source.commit` is this repository's HEAD —
 * which is why the golden carries a placeholder for it instead of a sha that
 * would change on every commit. `<version>` is a placeholder for the same reason
 * one step removed: the CLI version moves on every release, and a golden that
 * hard-coded it would break on a routine bump with no regeneration path.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const REPO_ROOT = join(__dirname, "..", "..", "..");
const FIXTURE = join(__dirname, "fixtures", "export-profile");
const GOLDEN = join(FIXTURE, "golden.json");
const SCHEMA = join(REPO_ROOT, "schema", "profile.schema.json");

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

/** A copy of the fixture workspace a test may mutate. */
function workspaceCopy(): string {
  const dir = tempDir();
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

/** The workspace's own commit — the one value the golden cannot pin. */
function fixtureCommit(): string {
  return execFileSync("git", ["-C", FIXTURE, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

/** The installed CLI version, read from the manifest the CLI itself reads. */
function cliVersion(): string {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

interface SchemaRoots {
  properties: Record<string, { type?: string }>;
}

interface Profile {
  artifacts: { id?: string }[];
  projects: { artifactRefs?: string[] }[];
  publications: { url?: string; artifactRefs?: string[] }[];
  [root: string]: unknown;
}

interface Payload {
  schemaVersion: string;
  engine: { name: string; version: string };
  source: { commit: string | null; generatedAt: string | null };
  profile: Profile;
}

interface Envelope {
  command: string;
  ok: boolean;
  exitCode: number;
  data?: Payload;
  error?: { kind: string; message: string; violations?: { path: string; message: string }[] };
}

function exportProfile(args: string[] = [], workspace = FIXTURE): Envelope {
  const res = run(["export", "profile", "--json", "--workspace", workspace, ...args]);
  expect(res.code).toBe(0);
  return JSON.parse(res.stdout) as Envelope;
}

describe("pasco export profile — the payload", () => {
  it("emits the exact golden bytes (only the commit and the CLI version are substituted)", () => {
    const res = run(["export", "profile", "--json", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    // The placeholders keep the golden stable across commits and releases while
    // still pinning every other byte, including key order and the 2-space indent.
    const expected = readFileSync(GOLDEN, "utf8")
      .replace("<commit>", fixtureCommit())
      .replace("<version>", cliVersion());
    expect(res.stdout).toBe(expected);
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
    expect(withNow.data?.schemaVersion).toBe(withoutNow.data?.schemaVersion);
  });

  it("carries the schemaVersion, the engine and the standard envelope", () => {
    const envelope = exportProfile();
    expect(envelope.command).toBe("export profile");
    expect(envelope.ok).toBe(true);
    expect(envelope.exitCode).toBe(0);
    expect(envelope.data?.schemaVersion).toBe("1");
    expect(envelope.data?.engine.name).toBe("@profile-as-code/cli");
    // The engine version is the manifest's, not a literal the payload invents.
    expect(envelope.data?.engine.version).toBe(cliVersion());
  });

  it("carries every declared root and every list root, derived from the schema", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as SchemaRoots;
    const roots = Object.keys(schema.properties);
    expect(roots.length).toBeGreaterThan(0);
    // `load()` maps one content file to the root of the same name
    // (schema/README.md: "the file NAME is the root property"), so the fixture's
    // declared roots are derivable — no hand list to drift from the contract.
    const declared = new Set(
      readdirSync(join(FIXTURE, "content"))
        .filter((file) => /\.ya?ml$/i.test(file))
        .map((file) => file.replace(/\.ya?ml$/i, "")),
    );
    const listRoots = roots.filter((root) => schema.properties[root]?.type === "array");
    // Normalized defaults that are not list roots: the flavor (D15) and the
    // deploy ledger record (D18), both established by `normalizeProfile()`.
    const defaultedNonList = new Set(["flavor", "deployments"]);
    const alwaysPresent = new Set([...listRoots, ...defaultedNonList]);

    const profile = exportProfile().data?.profile;
    if (profile === undefined) throw new Error("no profile in the envelope");
    const emitted = new Set(Object.keys(profile));

    // 1. The payload never invents a key the schema does not declare.
    for (const key of emitted) expect(roots, `"${key}" is not a schema root`).toContain(key);
    // 2. Every root the workspace declares is present.
    for (const root of declared) {
      expect(emitted.has(root), `declared root "${root}" is missing`).toBe(true);
    }
    // 3. Every list root is present — an array, and empty when undeclared.
    for (const root of listRoots) {
      expect(emitted.has(root), `list root "${root}" is missing`).toBe(true);
      expect(Array.isArray(profile[root]), `list root "${root}" is not an array`).toBe(true);
      if (!declared.has(root)) expect(profile[root], `"${root}" should default to []`).toEqual([]);
    }
    // 4. An optional OBJECT root appears ONLY when declared: no valid empty value
    //    exists for it (the $defs require fields), so the payload must not invent
    //    one — and must not drop a declared one either.
    for (const root of roots) {
      if (alwaysPresent.has(root)) continue;
      expect(emitted.has(root), `optional root "${root}" presence`).toBe(declared.has(root));
    }

    // The invariant above is what covers the optionals the fixture omits; pin two
    // of them as declared-checked examples so a silent "emit {}" regression in
    // normalizeProfile is not read as success.
    expect(declared).not.toContain("newsletter");
    expect(declared).not.toContain("podcast");
    expect(emitted.has("newsletter")).toBe(false);
    expect(emitted.has("podcast")).toBe(false);
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
    const dir = workspaceCopy();
    const res = run(["export", "profile", "--json", "--workspace", dir]);
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout) as Envelope;
    expect(payload.data?.source.commit).toBeNull();
  });

  it("prints a human summary without --json", () => {
    const res = run(["export", "profile", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("normalized profile");
    expect(res.stdout).toContain("schemaVersion: 1");
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

  it("exits 1 with kind schema when a load-level refinement fails (dangling artifactRefs)", () => {
    const dir = workspaceCopy();
    const projectsPath = join(dir, "content", "projects.yaml");
    const body = readFileSync(projectsPath, "utf8");
    const patched = body.replace(
      "  artifactRefs:\n    - hub-source\n",
      "  artifactRefs:\n    - does-not-exist\n",
    );
    expect(patched).not.toBe(body);
    writeFileSync(projectsPath, patched, "utf8");

    const res = run(["export", "profile", "--json", "--workspace", dir]);
    expect(res.code).toBe(1);
    const envelope = JSON.parse(res.stdout) as Envelope;
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.kind).toBe("schema");
    expect(envelope.error?.violations?.length).toBeGreaterThan(0);
    expect(envelope.error?.violations?.[0]?.message).toContain("does-not-exist");
  });

  it("exits 1 on a malformed or impossible --now (no clock guess)", () => {
    const cases = [
      "tomorrow",
      "2026-10-28",
      "2026-13-01T00:00:00Z",
      "2026-02-31T00:00:00Z", // Date.parse would normalize this to March 3
      "2025-02-29T00:00:00Z", // 2025 is not a leap year
      "2026-10-28T24:00:00Z", // hour 24 exists only as a day-boundary alias
      "2026-10-28T00:60:00Z",
      "2026-10-28T00:00:60Z",
      "2026-10-28T00:00:00",
      "",
    ];
    for (const now of cases) {
      const res = run(["export", "profile", "--json", "--workspace", FIXTURE, "--now", now]);
      expect(res.code, `--now "${now}" should refuse`).toBe(1);
      const envelope = JSON.parse(res.stdout) as Envelope;
      expect(envelope.ok).toBe(false);
      expect(envelope.error?.kind).toBe("now");
    }
  });

  it("accepts a real leap-day and a real offset", () => {
    for (const now of ["2024-02-29T00:00:00Z", "2026-10-28T23:59:59-05:00"]) {
      const envelope = exportProfile(["--now", now]);
      expect(envelope.data?.source.generatedAt).toBe(now);
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
