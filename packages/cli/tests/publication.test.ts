/**
 * #242 — the derived PUBLICATION-TRUTH line.
 *
 * SPEC §20 says the engine never stores a derived number; this report is the
 * missing invariant that makes "optimized" measurable: per surface, does the
 * artifact on disk match what the SSOT produces today, is the ledger in sync,
 * and does any text exceed the platform's declared cap?
 *
 * Every test drives the BUILT binary against a real workspace on disk, because
 * two of the three axes are filesystem facts (the artifact bytes) and the third
 * is the ledger — none of them is inferable from a unit test of the derivation.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deployStatus, load } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { publicationTruth } from "../src/publication.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd?: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    timeout: 20_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-publication-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

interface Truth {
  surface: string;
  sync: "in-sync" | "stale" | "never";
  artifact: "matches-SSOT" | "diverges" | "absent";
  limits: "ok" | "over(cap)";
  findings: { code: string; message: string; path: string }[];
}

interface StatusJson {
  data: { publication: Truth[]; units: unknown[]; workspace: string };
}

function publicationOf(stdout: string): Truth[] {
  return (JSON.parse(stdout) as StatusJson).data.publication;
}

/** A workspace bootstrapped by the CLI itself (#240's catalog included). */
function initWorkspace(): string {
  const dir = join(tempDir(), "ws");
  expect(run(["init", dir]).code).toBe(0);
  return dir;
}

/** Load a workspace profile for the module-level tests. */
function loadFor(ws: string): ReturnType<typeof load> {
  return load(ws);
}

/** Hash every file under a directory, so "derived, never stored" is a byte fact. */
function hashTree(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(path.slice(dir.length)).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

describe("pasco status — derived publication truth (#242)", () => {
  it("reports the three axes for a built-but-never-deployed surface", () => {
    const ws = initWorkspace();
    expect(run(["build"], ws).code).toBe(0);

    const r = run(["status", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const truth = publicationOf(r.stdout);
    const readme = truth.find((t) => t.surface === "github-readme");
    expect(readme).toEqual({
      surface: "github-readme",
      // No `--mark` yet: the ledger has no record, so staleness is `never`.
      sync: "never",
      // `pasco build` just wrote it from the SSOT at the workspace lang.
      artifact: "matches-SSOT",
      limits: "ok",
      findings: [],
    });
  });

  it("prints the exact derived line (text surface, not only --json)", () => {
    const ws = initWorkspace();
    expect(run(["build"], ws).code).toBe(0);
    const r = run(["status", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("publication truth");
    expect(r.stdout).toMatch(/github-readme: never · artifact: matches-SSOT · limits: ok/);
  });

  it("a deploy confirmation does not invalidate the artifact by its own token", () => {
    // `--mark` changes the ledger, which changes the completeness NUMBER embedded
    // in the artifact. That token is a derived view (SPEC §20), not a fact, so the
    // confirmation must not flip the surface to `diverges`.
    const ws = initWorkspace();
    expect(run(["build"], ws).code).toBe(0);
    expect(run(["status", "--mark", "identity", "github-readme", "--workspace", ws]).code).toBe(0);
    const truth = publicationOf(run(["status", "--json", "--workspace", ws]).stdout);
    expect(truth.find((t) => t.surface === "github-readme")).toMatchObject({
      sync: "in-sync",
      artifact: "matches-SSOT",
    });
  });

  it("an SSOT edit after a deploy reads stale + diverges (the dogfood's row 3)", () => {
    const ws = initWorkspace();
    expect(run(["build"], ws).code).toBe(0);
    // Confirm a paste: the identity unit is now recorded on github-readme.
    expect(run(["status", "--mark", "identity", "github-readme", "--workspace", ws]).code).toBe(0);

    let truth = publicationOf(run(["status", "--json", "--workspace", ws]).stdout);
    expect(truth.find((t) => t.surface === "github-readme")).toMatchObject({
      sync: "in-sync",
      artifact: "matches-SSOT",
      limits: "ok",
    });

    // Edit the SSOT *in a way the artifact renders* — the README H1 comes from
    // `identity.name` — and do not rebuild.
    const identity = join(ws, "content", "identity.yaml");
    writeFileSync(
      identity,
      readFileSync(identity, "utf8").replace(/^name: .*$/m, "name: Ada Lovelace"),
    );

    truth = publicationOf(run(["status", "--json", "--workspace", ws]).stdout);
    expect(truth.find((t) => t.surface === "github-readme")).toMatchObject({
      sync: "stale",
      // The artifact on disk is now a different artifact than the SSOT produces.
      artifact: "diverges",
    });
  });

  it("a build made with an explicit --lang matches at that declared lang", () => {
    // The comparison tries every lang the profile declares, so a legitimately
    // built `es` artifact is not called divergent (the declared v1 behaviour).
    const ws = initWorkspace();
    writeFileSync(
      join(ws, "content", "positioning.yaml"),
      'statement:\n  en: "English statement for the README"\n  es: "Declaración en español"\n',
    );
    expect(run(["build", "github-readme", "--lang", "es"], ws).code).toBe(0);

    const truth = publicationOf(run(["status", "--json", "--workspace", ws]).stdout);
    expect(truth.find((t) => t.surface === "github-readme")?.artifact).toBe("matches-SSOT");
  });

  it("an artifact removed from disk reads absent — never a silent match", () => {
    const ws = initWorkspace();
    expect(run(["build"], ws).code).toBe(0);
    expect(run(["status", "--mark", "identity", "github-readme", "--workspace", ws]).code).toBe(0);
    rmSync(join(ws, "profiles", "github-readme"), { recursive: true, force: true });

    const truth = publicationOf(run(["status", "--json", "--workspace", ws]).stdout);
    expect(truth.find((t) => t.surface === "github-readme")).toMatchObject({
      sync: "in-sync",
      artifact: "absent",
    });
  });

  it("an out-of-band edit of the built artifact reads diverges (not a re-render)", () => {
    const ws = initWorkspace();
    expect(run(["build"], ws).code).toBe(0);
    const artifact = join(ws, "profiles", "github-readme", "README.md");
    writeFileSync(artifact, `${readFileSync(artifact, "utf8")}\nhand-edited\n`);

    const truth = publicationOf(run(["status", "--json", "--workspace", ws]).stdout);
    expect(truth.find((t) => t.surface === "github-readme")?.artifact).toBe("diverges");
  });

  it("an over-cap row reads over(cap) with the cited finding (#240 repro)", () => {
    const ws = initWorkspace();
    // The dogfood's exact event: an 80-char Upwork title against the 50 cap.
    writeFileSync(
      join(ws, "content", "headlines.yaml"),
      `- platform: upwork\n  lang: en\n  text: "${"x".repeat(80)}"\n`,
    );
    writeFileSync(
      join(ws, "content", "bios.yaml"),
      `- platform: upwork\n  lang: en\n  length: long\n  text: "${"y".repeat(132)}"\n`,
    );
    expect(run(["build"], ws).code).toBe(0);
    expect(existsSync(join(ws, "profiles", "upwork.md"))).toBe(true);

    const truth = publicationOf(run(["status", "--json", "--workspace", ws]).stdout);
    // The cap belongs to the upwork ROWS, not to every surface in the workspace.
    expect(truth.find((t) => t.surface === "github-readme")).toMatchObject({
      limits: "ok",
      findings: [],
    });
    const upwork = truth.find((t) => t.surface === "upwork");
    expect(upwork).toMatchObject({ sync: "never", artifact: "matches-SSOT", limits: "over(cap)" });
    expect(upwork?.findings).toHaveLength(1);
    expect(upwork?.findings[0]?.path).toBe("headlines:upwork:en");
    expect(upwork?.findings[0]?.message).toContain("over max 50");
  });

  it("a surface with no cap exceeded and no artifact is not invented", () => {
    const ws = initWorkspace();
    // No build, no mark: no surface is in play, so the section states the fact.
    const r = run(["status", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("publication truth");
    expect(r.stdout).toContain("no surface published yet");
  });

  it("is DERIVED: a status run changes no byte of content/ or profiles/ (SPEC §20)", () => {
    const ws = initWorkspace();
    expect(run(["build"], ws).code).toBe(0);
    const before = hashTree(join(ws, "content")) + hashTree(join(ws, "profiles"));
    expect(run(["status", "--workspace", ws]).code).toBe(0);
    expect(run(["status", "--json", "--workspace", ws]).code).toBe(0);
    const after = hashTree(join(ws, "content")) + hashTree(join(ws, "profiles"));
    expect(after).toBe(before);
  });

  it("folds into --completeness as publication COVERAGE, never a new score", () => {
    const ws = initWorkspace();
    const before = JSON.parse(
      run(["status", "--completeness", "--json", "--workspace", ws]).stdout,
    ) as { data: { percent: number; total: number; publication: Truth[] } };
    expect(run(["build"], ws).code).toBe(0);
    const after = JSON.parse(
      run(["status", "--completeness", "--json", "--workspace", ws]).stdout,
    ) as { data: { percent: number; total: number; publication: Truth[] } };

    // The percentage is a function of the profile alone — the derived publication
    // state must never move it (SPEC §20: no new score, no stored number).
    expect(after.data.percent).toBe(before.data.percent);
    expect(after.data.total).toBe(before.data.total);
    expect(after.data.publication.map((t) => t.surface)).toContain("github-readme");

    const text = run(["status", "--completeness", "--workspace", ws]).stdout;
    expect(text).toMatch(/publication coverage — 1\/1 surface matches the SSOT/);
  });

  it("§19.5 out-of-band-drift forces diverges — contrary evidence is never a match", () => {
    // Unit-level: the offline derivation may only cite a live verdict the ledger
    // already recorded; no network is touched here (D20/§19.5).
    const ws = initWorkspace();
    expect(run(["build"], ws).code).toBe(0);
    const report = {
      units: [
        {
          key: "identity",
          kind: "root" as const,
          block: "identity",
          label: "identity",
          origin: "user" as const,
          hash: "0".repeat(64),
          surfaces: { "github-readme": "in-sync" as const },
          state: "in-sync" as const,
          certification: {
            state: "out-of-band-drift" as const,
            reason: "live-mismatch",
            surfaces: {
              "github-readme": { state: "out-of-band-drift" as const, reason: "live-mismatch" },
            },
          },
        },
      ],
      untracked: [],
      removed: [],
    };
    const truth = publicationTruth({
      workspace: ws,
      profile: loadFor(ws),
      reportData: report,
      checks: [],
      lang: "en",
    });
    expect(truth.find((t) => t.surface === "github-readme")).toMatchObject({
      sync: "in-sync",
      artifact: "diverges",
    });
    // And the clean report read above is genuinely clean — the rule is not
    // `diverges` for everyone.
    expect(
      publicationTruth({
        workspace: ws,
        profile: loadFor(ws),
        reportData: deployStatus(loadFor(ws)),
        checks: [],
        lang: "en",
      }).find((t) => t.surface === "github-readme")?.artifact,
    ).toBe("matches-SSOT");
  });

  it("--write-checklist folds the coverage line into the generated view", () => {
    const ws = initWorkspace();
    expect(run(["build"], ws).code).toBe(0);
    expect(run(["status", "--write-checklist", "--workspace", ws]).code).toBe(0);
    const checklist = readFileSync(join(ws, "CHECKLIST.md"), "utf8");
    expect(checklist).toContain("Publication truth: 1/1 surface matches the SSOT · 0 over cap");
  });
});
