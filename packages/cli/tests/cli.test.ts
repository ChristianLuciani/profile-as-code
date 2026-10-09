/**
 * CLI-level tests: execute the BUILT binary (`node dist/index.js`) against the
 * core fixtures (reused, not duplicated) + a small invalid fixture.
 * Build first (`pnpm test` = build + vitest run), so dist/ is always current.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PASTE_PLATFORMS, PLATFORMS } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURES = join(__dirname, "fixtures");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");
const DRIFTING = join(__dirname, "..", "..", "core", "tests", "fixtures", "drifting");
const INVALID = join(FIXTURES, "invalid");

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

function git(dir: string, args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" });
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-test-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A git repo with one release tagged and one change after it (for diff). */
function makeGitWorkspace(): string {
  const dir = tempDir();
  mkdirSync(join(dir, "content"));
  writeFileSync(join(dir, "content", "identity.yaml"), "name: Elena Vasquez\n");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@test.test"]);
  git(dir, ["config", "user.name", "test"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "initial release"]);
  git(dir, ["tag", "release-1.0"]);
  writeFileSync(join(dir, "content", "identity.yaml"), "name: Elena Vasquez\nlocation: Madrid\n");
  writeFileSync(
    join(dir, "content", "headlines.yaml"),
    "- platform: x\n  lang: en\n  text: New headline\n",
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "update identity + x headline"]);
  return dir;
}

describe("surface", () => {
  it("prints version", () => {
    const r = run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/pasco \d+\.\d+\.\d+/);
  });

  it("prints help", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    for (const cmd of ["init", "validate", "build", "diff", "refine", "check", "skills:install"]) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it("exit 2 on unknown command", () => {
    const r = run(["frobnicate"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });

  it("exit 2 on unknown flag", () => {
    const r = run(["validate", "--bogus"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage");
  });
});

describe("pasco validate (D12: fail on schema, warn on drift)", () => {
  it("exits 0 on a clean workspace", () => {
    const r = run(["validate", "--workspace", MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("valid");
    expect(r.stdout).toContain("no drift warnings");
  });

  it("exits 0 but warns on drift", () => {
    const r = run(["validate", "--workspace", DRIFTING]);
    expect(r.code).toBe(0); // D12: facts warn
    expect(r.stdout).toContain("warn: [");
  });

  it("exits 1 on schema violation", () => {
    const r = run(["validate", "--workspace", INVALID]);
    expect(r.code).toBe(1);
    // Contract: issue path is stable; the message wording is Zod-version-specific
    // (Zod 3: "Required" · Zod 4: "Invalid input: ...") — assert the path only.
    expect(r.stderr).toMatch(/identity: /);
  });

  it("--json is machine-readable: clean workspace", () => {
    const r = run(["validate", "--json", "--workspace", MINIMAL]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      ok: boolean;
      exitCode: number;
      data: { schema: string; drift: unknown[]; geo: { score: number } };
    };
    expect(data.ok).toBe(true);
    expect(data.exitCode).toBe(0);
    expect(data.data.schema).toBe("valid");
    expect(data.data.drift).toEqual([]);
    expect(data.data.geo.score).toBeGreaterThanOrEqual(0);
    expect(data.data.geo.score).toBeLessThanOrEqual(100);
  });

  it("--json carries violations on schema failure", () => {
    const r = run(["validate", "--json", "--workspace", INVALID]);
    expect(r.code).toBe(1);
    const data = JSON.parse(r.stdout) as {
      ok: boolean;
      error: { kind: string; violations: { path: string }[] };
    };
    expect(data.ok).toBe(false);
    expect(data.error.kind).toBe("schema");
    expect(data.error.violations.some((v) => v.path === "identity")).toBe(true);
  });
});

describe("legacy .pacrc detection (issue #38 migration guard)", () => {
  it("fails with a migration hint when a legacy .pacrc is present", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".pacrc"), JSON.stringify({ workspace: "." }));
    const r = run(["validate", "--json"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/legacy \.pacrc/);
    expect(r.stderr).toMatch(/\.pascorc/);
  });

  it("does not complain when no config file exists", () => {
    const dir = tempDir();
    const r = run(["validate", "--json", "--workspace", MINIMAL], dir);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/legacy/);
  });
});

describe("pasco build (compile slices)", () => {
  it("renders base texts for one platform+lang and writes the deploy artifact", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    const r = run(["build", "github-readme", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("[github-readme]");
    expect(r.stdout).toContain("Sovereign AI infrastructure engineer"); // headline
    expect(r.stdout).toContain("Sovereign AI infra"); // short bio
    expect(r.stdout).toContain("deploy artifacts written");
    const artifact = join(ws, "profiles", "github-readme", "README.md");
    expect(existsSync(artifact)).toBe(true);
    expect(readFileSync(artifact, "utf8")).toContain("# Elena Vasquez");
    expect(readFileSync(artifact, "utf8")).toContain(
      "generated by profile-as-code pasco build github-readme",
    );
  });

  it("filters by lang", () => {
    const r = run(["build", "linkedin", "--lang", "es", "--workspace", MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Ingeniera Senior de IA · Infraestructura Soberana de IA"); // es headline
    expect(r.stdout).not.toContain("Senior AI Engineer · Sovereign AI Infrastructure"); // en headline
  });

  it("builds all platforms when none given", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    const r = run(["build", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { platforms: { platform: string }[]; written: { platform: string; path: string }[] };
    };
    expect(data.data.platforms.map((p) => p.platform)).toEqual([...PLATFORMS]);
    // only renderer platforms write artifacts; github-org is brand-only (D15) so a person workspace writes only github-readme
    expect(data.data.written.map((w) => w.platform)).toEqual(["github-readme"]);
    // v1.7 (#130): an EMPTY render must leave no trace — not even the profiles/<platform>/ dir
    // (a regression here litters every pre-existing workspace with empty dirs per new renderer).
    expect(existsSync(join(ws, "profiles", "kofi"))).toBe(false);
  });

  it("writes the kofi paste artifact for a kofi workspace (v1.7, #130)", () => {
    const ws = tempDir();
    copyFixture(join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal-kofi"), ws);
    const r = run(["build", "kofi", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { written: { platform: string; path: string }[] };
    };
    // D9 paste platform: the artifact IS the paste source (single bios row).
    expect(data.data.written).toEqual([
      { platform: "kofi", path: join(ws, "profiles", "kofi", "README.md") },
    ]);
    expect(readFileSync(join(ws, "profiles", "kofi", "README.md"), "utf8")).toContain(
      "support the sovereign-AI work",
    );
  });

  it("unbuilds a stale kofi artifact when its bios row is removed (pure profiles/, v1.7 #130)", () => {
    const ws = tempDir();
    mkdirSync(join(ws, "content"), { recursive: true });
    writeFileSync(join(ws, "content", "identity.yaml"), "name: Elena Vasquez\n");
    writeFileSync(
      join(ws, "content", "bios.yaml"),
      "- platform: kofi\n  lang: en\n  length: long\n  text: To be removed.\n",
    );
    expect(run(["build", "kofi", "--workspace", ws]).code).toBe(0);
    expect(existsSync(join(ws, "profiles", "kofi", "README.md"))).toBe(true);
    // The SSOT drops the row → the paste source it no longer backs must not
    // survive on disk (status compares ledger↔SSOT hashes only; profiles/ is
    // a pure function of the workspace, §15.1).
    writeFileSync(join(ws, "content", "bios.yaml"), "");
    const r = run(["build", "kofi", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { written: unknown[]; skipped: { platform: string }[] };
    };
    expect(data.data.written).toEqual([]);
    expect(data.data.skipped.map((sk) => sk.platform)).toEqual(["kofi"]);
    expect(existsSync(join(ws, "profiles", "kofi"))).toBe(false);
  });

  // v1.8 (#133) + v1.9 (#137): the creator-monetization family — same paste chain as kofi.
  // The list is projected from `platforms/registry.yaml` (#154) — derived, not
  // hand-extended when a new creator-monetization paste platform lands.
  it.each(PASTE_PLATFORMS.map((entry) => entry.platform))(
    "writes the %s paste artifact for the family workspace (v1.8/v1.9, #133/#137)",
    (slug) => {
      const ws = tempDir();
      copyFixture(
        join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal-creator-monetization"),
        ws,
      );
      const r = run(["build", slug, "--json", "--workspace", ws]);
      expect(r.code).toBe(0);
      const data = JSON.parse(r.stdout) as {
        data: { written: { platform: string; path: string }[] };
      };
      // D9 paste platform: the artifact IS the paste source (single bios row).
      expect(data.data.written).toEqual([
        { platform: slug, path: join(ws, "profiles", slug, "README.md") },
      ]);
      expect(readFileSync(join(ws, "profiles", slug, "README.md"), "utf8")).toContain(
        "sovereign-AI",
      );
    },
  );

  it("writes only family-rendered artifacts when the family workspace builds all (v1.8/v1.9, #133/#137)", () => {
    const ws = tempDir();
    copyFixture(
      join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal-creator-monetization"),
      ws,
    );
    const r = run(["build", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { written: { platform: string; path: string }[] };
    };
    // github-readme (git) + the 5 family paste platforms; kofi has no bios row
    // in this fixture → empty render → not written (§15.1 pure profiles/).
    expect(data.data.written.map((w) => w.platform)).toEqual([
      "github-readme",
      ...PASTE_PLATFORMS.map((entry) => entry.platform),
    ]);
    expect(existsSync(join(ws, "profiles", "kofi"))).toBe(false);
  });

  it("exit 2 on unknown platform", () => {
    const r = run(["build", "bogus", "--workspace", MINIMAL]);
    expect(r.code).toBe(2);
  });

  it("exit 1 when the workspace violates the schema", () => {
    const r = run(["build", "--workspace", INVALID]);
    expect(r.code).toBe(1);
  });
});

describe("pasco diff (git-based, release tags)", () => {
  it("lists commits and changed content files since the release tag", () => {
    const ws = makeGitWorkspace();
    const r = run(["diff", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("release tag 'release-1.0'");
    expect(r.stdout).toContain("content/identity.yaml");
    expect(r.stdout).toContain("content/headlines.yaml");
    expect(r.stdout).toContain("re-verify deployed profiles");
  });

  it("--json reports files and hint", () => {
    const ws = makeGitWorkspace();
    const r = run(["diff", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: {
        tag: string | null;
        files: { path: string; root: string }[];
        hint: string;
        hasChanges: boolean;
      };
    };
    expect(data.data.tag).toBe("release-1.0");
    expect(data.data.hasChanges).toBe(true);
    expect(data.data.files).toHaveLength(2);
    expect(data.data.files.map((f) => f.root).sort()).toEqual(["headlines", "identity"]);
    expect(data.data.hint).toContain("re-verify deployed profiles");
  });

  it("exit 1 on a workspace outside any git repo", () => {
    const dir = tempDir();
    const r = run(["diff", "--workspace", dir]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("git");
  });
});

describe("pasco init (scaffold)", () => {
  it("scaffolds a workspace that pasco validate accepts", () => {
    const dir = join(tempDir(), "ws");
    const r = run(["init", dir]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "content", "identity.yaml"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(true);
    expect(existsSync(join(dir, ".pascorc"))).toBe(true);
    const v = run(["validate", "--workspace", dir]);
    expect(v.code).toBe(0);
    expect(v.stdout).toContain("valid");
  });

  it("scaffolds a brand workspace (--flavor brand) that validates and builds github-org", () => {
    const dir = join(tempDir(), "brand-ws");
    const r = run(["init", "--flavor", "brand", dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("flavor: brand");
    for (const f of [
      "flavor.yaml",
      "identity.yaml",
      "socialHandles.yaml",
      "newsletter.yaml",
      "podcast.yaml",
      "press.yaml",
      "audiences.yaml",
    ]) {
      expect(existsSync(join(dir, "content", f))).toBe(true);
    }
    // flavor.yaml value IS the root value → bare scalar
    expect(readFileSync(join(dir, "content", "flavor.yaml"), "utf8")).toContain("brand");
    const v = run(["validate", "--workspace", dir]);
    expect(v.code).toBe(0);
    expect(v.stdout).toContain("valid");
    const b = run(["build", "github-org", "--workspace", dir]);
    expect(b.code).toBe(0);
    expect(b.stdout).toContain("deploy artifacts written");
    const artifact = join(dir, "profiles", "github-org", "README.md");
    expect(existsSync(artifact)).toBe(true);
    expect(readFileSync(artifact, "utf8")).toContain(
      "generated by profile-as-code pasco build github-org",
    );
  });

  it("exit 2 on an unknown --flavor", () => {
    const r = run(["init", "--flavor", "alien", join(tempDir(), "x")]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown flavor");
  });

  it("refuses to overwrite an existing content/", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "content"));
    const r = run(["init", dir]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("already exists");
  });
});

describe("pasco refine (partial: template + record)", () => {
  it("emits the agent task (no LLM call) pointing at the platform skill", () => {
    const r = run(["refine", "linkedin", "--variants", "2", "--workspace", MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("agent task");
    expect(r.stdout).toContain("Platform: linkedin");
    expect(r.stdout).toContain("Skill (communicative strategy — READ IT FIRST)");
    expect(r.stdout).toContain("Facts");
    expect(r.stdout).toContain("--choose <variantId>");
  });

  it("records the chosen variant in content/active.yaml and stays valid", () => {
    const ws = join(tempDir(), "ws");
    copyFixture(MINIMAL, ws);
    const r = run(["refine", "linkedin", "--lang", "es", "--choose", "li-es-x", "--workspace", ws]);
    expect(r.code).toBe(0);
    const active = readFileSync(join(ws, "content", "active.yaml"), "utf8");
    expect(active).toContain("li-es-x");
    expect(active).toContain("lang: es");
    const v = run(["validate", "--workspace", ws]);
    expect(v.code).toBe(0);
  });

  it("exit 2 without a platform", () => {
    const r = run(["refine", "--workspace", MINIMAL]);
    expect(r.code).toBe(2);
  });
});

describe("pasco check (offline rules) + pasco skills:install (projection pointer)", () => {
  it("lists the user checks from the schema-validated catalog", () => {
    const r = run(["check", "github-readme", "--workspace", MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("evidence registry (D17/§18.8)"); // M7 checks execute offline
    expect(r.stdout).toContain("credential-expiry / no-private-in-public-output: OK");
    expect(r.stdout).toContain("gh-bio-max");
    expect(r.stdout).toContain("geo-consistent");
    expect(r.stdout).toContain("platform=all"); // union semantics: all applies to every platform
  });

  it("check --json reports implemented:true (registry checks, M7) + owner", () => {
    const r = run(["check", "--json", "--workspace", MINIMAL]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: {
        implemented: { handleMatrix: boolean; registry: boolean };
        checks: unknown[];
        ownedBy: string;
      };
    };
    expect(data.data.implemented.registry).toBe(true);
    expect(data.data.implemented.handleMatrix).toBe(false); // person flavor
    expect(data.data.checks).toHaveLength(3);
    expect(data.data.ownedBy).toContain("M6");
  });

  it("runs the handle-matrix rules for a brand workspace (handle-claimed/handle-consistent)", () => {
    const dir = join(tempDir(), "brand-ws");
    run(["init", "--flavor", "brand", dir]);
    // a claimed handle without url and one on a wrong host → offline violations
    writeFileSync(
      join(dir, "content", "socialHandles.yaml"),
      "- platform: x\n  handle: topiapress\n  status: claimed\n- platform: bluesky\n  handle: topiapress\n  status: claimed\n  url: https://instagram.com/topiapress\n",
    );
    const r = run(["check", "--workspace", dir]);
    expect(r.code).toBe(0); // drift warns, never fails (D12)
    expect(r.stdout).toContain("handle matrix");
    expect(r.stdout).toContain("drift/handle-claimed-not-linked");
    expect(r.stdout).toContain("drift/handle-host-mismatch");
    const j = run(["check", "--json", "--workspace", dir]);
    expect(j.code).toBe(0);
    const data = JSON.parse(j.stdout) as {
      data: {
        flavor: string;
        implemented: { handleMatrix: boolean; registry: boolean };
        handleMatrix: { platform: string; status: string }[];
        handleIssues: { code: string }[];
      };
    };
    expect(data.data.flavor).toBe("brand");
    expect(data.data.implemented.handleMatrix).toBe(true); // brand: handle rules run
    expect(data.data.handleMatrix).toHaveLength(2);
    expect(data.data.handleIssues.map((i) => i.code).sort()).toEqual([
      "drift/handle-claimed-not-linked",
      "drift/handle-host-mismatch",
    ]);
  });

  it("skills:install prints the skills-studio projection command", () => {
    const r = run(["skills:install", "pi"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("bin/project.sh pi");
  });

  it("skills:install exit 2 on unknown agent", () => {
    const r = run(["skills:install", "cobol"]);
    expect(r.code).toBe(2);
  });
});

describe("workspace resolution (D14: .pascorc → configured path)", () => {
  it("resolves the workspace from .pascorc", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".pascorc"), JSON.stringify({ workspace: MINIMAL }));
    const r = run(["validate"], dir); // cwd = dir with .pascorc
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("valid");
  });

  it("resolves a RELATIVE .pascorc workspace against the .pascorc dir (regression: dirname, not file path)", () => {
    // Fixture workspace copied into a temp dir; .pascorc at its root uses the
    // documented `"workspace": "."` form (workspace root itself).
    const dir = tempDir();
    copyFixture(MINIMAL, dir);
    writeFileSync(join(dir, ".pascorc"), JSON.stringify({ workspace: "." }));
    const r = run(["validate"], dir); // cwd = dir with .pascorc
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("valid");
    expect(r.stdout).not.toContain("no content/");
  });

  it("--workspace flag wins over .pascorc", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".pascorc"), JSON.stringify({ workspace: "/nonexistent" }));
    const r = run(["validate", "--workspace", MINIMAL], dir);
    expect(r.code).toBe(0);
  });
});

describe("pasco status (D18 deploy ledger)", () => {
  const mkws = (): string => {
    const dir = tempDir();
    copyFixture(MINIMAL, dir);
    return dir;
  };
  const json = (out: string): { ok: boolean; exitCode: number; data: Record<string, unknown> } =>
    JSON.parse(out) as { ok: boolean; exitCode: number; data: Record<string, unknown> };

  it("fresh workspace: never everywhere, stale nowhere (acceptance #37)", () => {
    const ws = mkws();
    const res = run(["status", "--json", "--workspace", ws]);
    expect(res.code).toBe(0);
    const env = json(res.stdout);
    const data = env.data as { stale: number; never: number; total: number; untracked: unknown[] };
    expect(env.ok).toBe(true);
    expect(data.stale).toBe(0);
    expect(data.never).toBe(data.total);
    expect(data.total).toBeGreaterThan(0);
    expect(data.untracked.length).toBe(6); // 2 experience + 2 projects + 2 publications, no ids
  });

  it("--mark records the deploy and flips the unit in-sync", () => {
    const ws = mkws();
    const marked = run([
      "status",
      "--mark",
      "identity",
      "linkedin",
      "--at",
      "2026-09-08T10:00:00Z",
      "--json",
      "--workspace",
      ws,
    ]);
    expect(marked.code).toBe(0);
    expect(json(marked.stdout).data.mode).toBe("marked");
    const ledger = readFileSync(join(ws, "content", "deployments.yaml"), "utf8");
    expect(ledger).toContain("identity:");
    expect(ledger).toContain("deployedAt: 2026-09-08T10:00:00.000Z");
    expect(ledger).toContain("source: manual");

    const after = run(["status", "--json", "--workspace", ws]);
    const units = (
      json(after.stdout).data as {
        units: { key: string; state: string; surfaces: Record<string, string> }[];
      }
    ).units;
    const identity = units.find((u) => u.key === "identity");
    expect(identity?.state).toBe("in-sync");
    expect(identity?.surfaces.linkedin).toBe("in-sync");
  });

  it("SSOT edit after deploy → stale; re-mark → in-sync", () => {
    const ws = mkws();
    expect(run(["status", "--mark", "identity", "linkedin", "--workspace", ws]).code).toBe(0);
    writeFileSync(
      join(ws, "content", "identity.yaml"),
      "name: Elena V. Vasquez\nlocation: Madrid, Spain\n",
      "utf8",
    );

    let units = (
      json(run(["status", "--json", "--workspace", ws]).stdout).data as {
        units: { key: string; state: string }[];
      }
    ).units;
    expect(units.find((u) => u.key === "identity")?.state).toBe("stale");

    expect(run(["status", "--mark", "identity", "linkedin", "--workspace", ws]).code).toBe(0);
    units = (
      json(run(["status", "--json", "--workspace", ws]).stdout).data as {
        units: { key: string; state: string }[];
      }
    ).units;
    expect(units.find((u) => u.key === "identity")?.state).toBe("in-sync");
  });

  it("--mark rejects unknown keys, untracked rows and bad surfaces", () => {
    const ws = mkws();
    expect(run(["status", "--mark", "nope:nope", "linkedin", "--workspace", ws]).code).toBe(1);
    // rows without id are untracked → not addressable
    expect(run(["status", "--mark", "experience:exp-1", "linkedin", "--workspace", ws]).code).toBe(
      1,
    );
    expect(run(["status", "--mark", "identity", "myspace", "--workspace", ws]).code).toBe(2);
  });

  it("surface filter reports that surface only; --write-checklist regenerates the view", () => {
    const ws = mkws();
    expect(run(["status", "--mark", "identity", "github-readme", "--workspace", ws]).code).toBe(0);
    const linkedin = json(run(["status", "linkedin", "--json", "--workspace", ws]).stdout).data as {
      units: { key: string; state: string; surfaces: Record<string, string> }[];
    };
    const identity = linkedin.units.find((u) => u.key === "identity");
    expect(identity?.state).toBe("never");
    expect(Object.keys(identity?.surfaces ?? {})).toEqual([]);

    expect(run(["status", "--write-checklist", "--workspace", ws]).code).toBe(0);
    const checklist = readFileSync(join(ws, "CHECKLIST.md"), "utf8");
    expect(checklist).toContain("AUTO-GENERATED");
    expect(checklist).toContain("`identity`");
    expect(checklist).toContain("In sync");
  });

  it("premerge F2: --mark refuses ambiguous composite keys — workspace stays valid", () => {
    const ws = tempDir();
    mkdirSync(join(ws, "content"));
    writeFileSync(join(ws, "content", "identity.yaml"), "name: Elena Vasquez\n", "utf8");
    writeFileSync(
      join(ws, "content", "bios.yaml"),
      [
        "- platform: linkedin",
        "  lang: en",
        "  length: medium",
        "  text: one",
        "- platform: linkedin",
        "  lang: en",
        "  length: medium",
        "  text: two",
      ].join("\n"),
      "utf8",
    );
    expect(run(["validate", "--workspace", ws]).code).toBe(0); // un-addressed duplicates are legal
    const res = run(["status", "--mark", "bios:linkedin:en:medium", "linkedin", "--workspace", ws]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("ambiguous");
    expect(existsSync(join(ws, "content", "deployments.yaml"))).toBe(false); // nothing persisted
    expect(run(["validate", "--workspace", ws]).code).toBe(0); // workspace NOT bricked
  });

  it("premerge F3: --mark + --write-checklist is rejected, not silently ignored", () => {
    const ws = mkws();
    const res = run([
      "status",
      "--mark",
      "identity",
      "linkedin",
      "--write-checklist",
      "--workspace",
      ws,
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("mutually exclusive");
  });

  it("premerge F5: --mark on a removed key says removed, not unknown", () => {
    const ws = mkws();
    writeFileSync(
      join(ws, "content", "experience.yaml"),
      "- id: exp-1\n  role: A\n  org: O\n  start: 2020-01-01\n",
      "utf8",
    );
    expect(run(["status", "--mark", "experience:exp-1", "linkedin", "--workspace", ws]).code).toBe(
      0,
    );
    rmSync(join(ws, "content", "experience.yaml")); // unit gone — ledger key dangles
    const res = run(["status", "--mark", "experience:exp-1", "linkedin", "--workspace", ws]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("removed");
  });

  it("usage: --help works and missing surface in --mark is exit 2", () => {
    const help = run(["status", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--mark");
    expect(run(["status", "--mark", "identity", "--workspace", mkws()]).code).toBe(2);
  });
});

/** Recursive copy of a fixture workspace into a temp dir (tests mutate it). */
function copyFixture(from: string, to: string): void {
  execFileSync("cp", ["-R", `${from}/.`, `${to}/`]);
}

describe("pasco build — media pipeline (M8, §18.6)", () => {
  function mediaWorkspace(): string {
    const ws = tempDir();
    execFileSync("cp", ["-R", `${MINIMAL}/.`, ws]);
    mkdirSync(join(ws, "media", "photos"), { recursive: true });
    writeFileSync(join(ws, "media", "photos", "reel-2025.mp4"), "reel-bytes");
    writeFileSync(
      join(ws, "content", "artifacts.yaml"),
      `- id: reel-local
  kind: showreel
  title: Reel 2025
  locator:
    path: media/photos/reel-2025.mp4
  visibility: public
`,
    );
    return ws;
  }

  it("bundles referenced assets into profiles/<platform>/assets/ with a deterministic manifest.json", () => {
    const ws = mediaWorkspace();
    const r = run(["build", "github-readme", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { written: { platform: string; assets?: number }[] };
    };
    expect(data.data.written[0]?.assets).toBe(1);

    const assetPath = join(
      ws,
      "profiles",
      "github-readme",
      "assets",
      "reel-local",
      "reel-2025.mp4",
    );
    expect(existsSync(assetPath)).toBe(true);
    expect(readFileSync(assetPath, "utf8")).toBe("reel-bytes"); // byte-for-byte copy

    const manifest = JSON.parse(
      readFileSync(join(ws, "profiles", "github-readme", "assets", "manifest.json"), "utf8"),
    ) as {
      version: number;
      platform: string;
      lang: string;
      assets: { id: string; target: string; sha256: string; bytes: number; origin: string }[];
    };
    expect(manifest.version).toBe(1);
    expect(manifest.platform).toBe("github-readme");
    expect(manifest.lang).toBe("en");
    expect(manifest.assets).toEqual([
      {
        id: "reel-local",
        target: "assets/reel-local/reel-2025.mp4",
        sha256: createHash("sha256").update("reel-bytes").digest("hex"),
        bytes: "reel-bytes".length,
        origin: "workspace",
      },
    ]);
  });

  it("rebuild is byte-stable and cleans stale assets (output dir = pure function of the workspace)", () => {
    const ws = mediaWorkspace();
    run(["build", "github-readme", "--workspace", ws]);
    const manifest1 = readFileSync(
      join(ws, "profiles", "github-readme", "assets", "manifest.json"),
      "utf8",
    );
    const stale = join(ws, "profiles", "github-readme", "assets", "old-one", "x.bin");
    mkdirSync(join(ws, "profiles", "github-readme", "assets", "old-one"), { recursive: true });
    writeFileSync(stale, "stale"); // simulates a removed artifact left behind
    const r = run(["build", "github-readme", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(existsSync(stale)).toBe(false); // rebuilt clean
    const manifest2 = readFileSync(
      join(ws, "profiles", "github-readme", "assets", "manifest.json"),
      "utf8",
    );
    expect(manifest2).toBe(manifest1); // §15.1: same input → same bytes (manifest incl.)
    expect(manifest2).not.toContain("old-one");
  });

  it("writes no assets/ dir when nothing is bundled (url locators only)", () => {
    const ws = tempDir();
    execFileSync("cp", ["-R", `${MINIMAL}/.`, ws]);
    const r = run(["build", "github-readme", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(existsSync(join(ws, "profiles", "github-readme", "assets"))).toBe(false);
  });
});

describe("pasco check — media pipeline rules (M8, §18.6/§18.8)", () => {
  function workspaceWithLocator(path: string, checksum?: string): string {
    const ws = tempDir();
    execFileSync("cp", ["-R", `${MINIMAL}/.`, ws]);
    const extra = checksum !== undefined ? `  checksum: sha256:${checksum}\n` : "";
    writeFileSync(
      join(ws, "content", "artifacts.yaml"),
      `- id: reel-local
  kind: showreel
  title: Reel 2025
  locator:
    path: ${path}
${extra}  visibility: public
`,
    );
    return ws;
  }

  it("exit 1 when an in-workspace media file is missing (SSOT violation = error, D12 class)", () => {
    const ws = workspaceWithLocator("media/photos/gone.mp4");
    const r = run(["check", "--json", "--workspace", ws]);
    expect(r.code).toBe(1);
    const data = JSON.parse(r.stdout) as { data: { media: { code: string; severity: string }[] } };
    expect(data.data.media).toEqual([
      expect.objectContaining({ code: "check/media-missing-workspace", severity: "error" }),
    ]);
  });

  it("exit 0 with a warn when an external locator has no evidence root on this machine (CI-degradable)", () => {
    const ws = workspaceWithLocator("datasets/one.csv");
    const r = run(["check", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as { data: { media: { code: string; severity: string }[] } };
    expect(data.data.media).toEqual([
      expect.objectContaining({ code: "check/media-external-missing", severity: "warn" }),
    ]);
  });

  it("exit 1 on a declared-checksum mismatch (immutable artifact promise broken, §18.6)", () => {
    const ws = workspaceWithLocator("media/photos/reel.mp4", "f".repeat(64));
    mkdirSync(join(ws, "media", "photos"), { recursive: true });
    writeFileSync(join(ws, "media", "photos", "reel.mp4"), "actual");
    const r = run(["check", "--json", "--workspace", ws]);
    expect(r.code).toBe(1);
    const data = JSON.parse(r.stdout) as { data: { media: { code: string }[] } };
    expect(data.data.media.map((f) => f.code)).toContain("check/media-checksum-mismatch");
  });
});
