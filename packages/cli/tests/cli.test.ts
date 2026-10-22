/**
 * CLI-level tests: execute the BUILT binary (`node dist/index.js`) against the
 * core fixtures (reused, not duplicated) + a small invalid fixture.
 * Build first (`pnpm test` = build + vitest run), so dist/ is always current.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

/** `git`, capturing trimmed stdout (sync) — for SHAs a test must assert against. */
function gitOut(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
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

/**
 * A git repo whose only tag does NOT match its `.pascorc` `diff.tagPattern`
 * (#197). The pattern is deliberately NOT the `release-*` default: a fixture
 * equal to the default passes even when `.pascorc` is never read.
 */
function makeGitWorkspaceWithNonMatchingTag(): string {
  const dir = tempDir();
  mkdirSync(join(dir, "content"));
  writeFileSync(join(dir, "content", "identity.yaml"), "name: Elena Vasquez\n");
  writeFileSync(join(dir, ".pascorc"), '{ "diff": { "tagPattern": "rel-*" } }\n');
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@test.test"]);
  git(dir, ["config", "user.name", "test"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "initial commit"]);
  writeFileSync(
    join(dir, "content", "headlines.yaml"),
    "- platform: x\n  lang: en\n  text: New headline\n",
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "second: edit"]);
  git(dir, ["tag", "v0.2.0"]);
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
    for (const cmd of ["init", "validate", "build", "diff", "refine", "check", "skills:export"]) {
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
    // Build into a COPY: building inside `fixtures/minimal` dirtied the tracked
    // fixture directory (premerge #256, N3 — `profiles/linkedin.md` appeared as an
    // untracked artifact of the test run).
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    const r = run(["build", "linkedin", "--lang", "es", "--workspace", ws]);
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
    // renderer platforms write their deploy artifact; manual surfaces with a bio
    // row write profiles/<platform>.md (#239). github-org is brand-only (D15).
    expect(data.data.written.map((w) => w.platform)).toEqual([
      "github-readme",
      "linkedin",
      "upwork",
      "x",
    ]);
    // v1.7 (#130): an EMPTY render must leave no trace — not even the profiles/<platform>/ dir
    // (a regression here litters every pre-existing workspace with empty dirs per new renderer).
    expect(existsSync(join(ws, "profiles", "kofi"))).toBe(false);
  });

  it("writes a paste artifact for a manual surface without a renderer (#239)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    const r = run(["build", "--workspace", ws]);
    expect(r.code).toBe(0);

    const linkedin = join(ws, "profiles", "linkedin.md");
    const upwork = join(ws, "profiles", "upwork.md");
    const x = join(ws, "profiles", "x.md");
    expect(existsSync(linkedin)).toBe(true);
    expect(existsSync(upwork)).toBe(true);
    expect(existsSync(x)).toBe(true);
    const linkedinText = readFileSync(linkedin, "utf8");
    expect(linkedinText).toContain("Senior AI engineer");
    expect(linkedinText.split("\n").filter((l) => l !== "")).toHaveLength(1);
    expect(linkedinText.endsWith("\n")).toBe(true);
    expect(readFileSync(upwork, "utf8")).toContain("I architect sovereign AI stacks");
    // A headline-only surface has no bio row: no paste file is invented.
    expect(existsSync(join(ws, "profiles", "substack.md"))).toBe(false);
  });

  it("unbuilds a stale manual paste artifact and reports it (#239)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    const first = run(["build", "upwork", "--workspace", ws]);
    expect(first.code).toBe(0);
    expect(existsSync(join(ws, "profiles", "upwork.md"))).toBe(true);
    rmSync(join(ws, "content", "bios.yaml"));
    const second = run(["build", "upwork", "--json", "--workspace", ws]);
    expect(second.code).toBe(0);
    const data = JSON.parse(second.stdout) as {
      data: { written: unknown[]; skipped: { platform: string; reason: string }[] };
    };
    expect(data.data.written).toEqual([]);
    expect(data.data.skipped.some((s) => s.platform === "upwork")).toBe(true);
    expect(existsSync(join(ws, "profiles", "upwork.md"))).toBe(false);
  });

  it("renders the chosen variant body when active + store exist (#238)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    mkdirSync(join(ws, "profiles", "upwork", "variants"), { recursive: true });
    writeFileSync(join(ws, "profiles", "upwork", "variants", "up-1.md"), "CHOSEN VARIANT BODY\n");
    writeFileSync(
      join(ws, "content", "active.yaml"),
      'upwork:\n  lang: en\n  variantId: up-1\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );

    const r = run(["build", "upwork", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { written: { platform: string; variant?: string }[] };
    };
    expect(data.data.written[0]?.variant).toBe("up-1");
    const artifact = readFileSync(join(ws, "profiles", "upwork.md"), "utf8");
    expect(artifact).toContain("CHOSEN VARIANT BODY");
    expect(artifact).not.toContain("I architect sovereign AI stacks");
  });

  it("renders a multi-paragraph variant as prose, not bold (#238 premerge)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    mkdirSync(join(ws, "profiles", "github-readme", "variants"), { recursive: true });
    writeFileSync(
      join(ws, "profiles", "github-readme", "variants", "gh-prose.md"),
      "First line.\n\nSecond paragraph.\n",
    );
    writeFileSync(
      join(ws, "content", "active.yaml"),
      'github-readme:\n  lang: en\n  variantId: gh-prose\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );
    const r = run(["build", "github-readme", "--workspace", ws]);
    expect(r.code).toBe(0);
    const artifact = readFileSync(join(ws, "profiles", "github-readme", "README.md"), "utf8");
    expect(artifact).toContain("First line.\n\nSecond paragraph.");
    expect(artifact).not.toContain("**First line.");
  });

  it("uses the chosen complete artifact even when it cites non-SSOT chrome URLs (#238 premerge)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    mkdirSync(join(ws, "profiles", "upwork", "variants"), { recursive: true });
    writeFileSync(
      join(ws, "profiles", "upwork", "variants", "up-evil.md"),
      "Body with https://evil.example/x and a badge.\n",
    );
    writeFileSync(
      join(ws, "content", "active.yaml"),
      'upwork:\n  lang: en\n  variantId: up-evil\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );
    const r = run(["build", "upwork", "--workspace", ws]);
    expect(r.code).toBe(0);
    // The variant is user-authored complete text; the engine copies it. The
    // URL-SSOT rule applies to generated renderers, not to this user artifact.
    expect(readFileSync(join(ws, "profiles", "upwork.md"), "utf8")).toContain("evil.example");
  });

  it("writes a complete github-org variant verbatim (#238 premerge)", () => {
    const dir = join(tempDir(), "brand-variant");
    expect(run(["init", "--flavor", "brand", dir]).code).toBe(0);
    mkdirSync(join(dir, "profiles", "github-org", "variants"), { recursive: true });
    writeFileSync(join(dir, "profiles", "github-org", "variants", "org-1.md"), "ORG BODY\n");
    writeFileSync(
      join(dir, "content", "active.yaml"),
      'github-org:\n  lang: en\n  variantId: org-1\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );
    const r = run(["build", "github-org", "--workspace", dir]);
    expect(r.code).toBe(0);
    const artifact = readFileSync(join(dir, "profiles", "github-org", "README.md"), "utf8");
    expect(artifact).toBe("ORG BODY\n");
  });

  it("validate keeps active-variant-missing for an empty body (#238 premerge)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    mkdirSync(join(ws, "profiles", "researchgate", "variants"), { recursive: true });
    writeFileSync(join(ws, "profiles", "researchgate", "variants", "rg-empty.md"), "");
    writeFileSync(
      join(ws, "content", "active.yaml"),
      'researchgate:\n  lang: en\n  variantId: rg-empty\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );
    const r = run(["validate", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("active-variant-missing");
  });

  it("falls back deterministically when the active variant body is missing (#238)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    writeFileSync(
      join(ws, "content", "active.yaml"),
      'upwork:\n  lang: en\n  variantId: up-2\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );
    const r = run(["build", "upwork", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("variant warnings");
    expect(r.stdout).toContain("no body");
    expect(readFileSync(join(ws, "profiles", "upwork.md"), "utf8")).toContain(
      "I architect sovereign AI stacks",
    );
  });

  it("writes the chosen complete artifact verbatim (#238)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    mkdirSync(join(ws, "profiles", "github-readme", "variants"), { recursive: true });
    writeFileSync(
      join(ws, "profiles", "github-readme", "variants", "gh-en-1.md"),
      "CHOSEN VARIANT BODY\n",
    );
    writeFileSync(
      join(ws, "content", "active.yaml"),
      'github-readme:\n  lang: en\n  variantId: gh-en-1\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );
    const r = run(["build", "github-readme", "--workspace", ws]);
    expect(r.code).toBe(0);
    const artifact = readFileSync(join(ws, "profiles", "github-readme", "README.md"), "utf8");
    // The store holds a COMPLETE README; build writes it as the artifact (no
    // duplicated deterministic header/badges/footer).
    expect(artifact).toBe("CHOSEN VARIANT BODY\n");
    expect(artifact).not.toContain("# Elena Vasquez");
  });

  it("refuses a variant id that is not a safe path segment (#238)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    const r = run(["refine", "linkedin", "--choose", "../evil", "--workspace", ws]);
    expect(r.code).toBe(2);
    expect(readFileSync(join(ws, "content", "active.yaml"), "utf8")).not.toContain("../evil");

    writeFileSync(
      join(ws, "content", "active.yaml"),
      'upwork:\n  lang: en\n  variantId: "../evil"\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );
    const b = run(["build", "upwork", "--workspace", ws]);
    expect(b.code).toBe(0);
    expect(b.stdout).toContain("not a safe path segment");
    expect(readFileSync(join(ws, "profiles", "upwork.md"), "utf8")).toContain(
      "I architect sovereign AI stacks",
    );
  });

  it("preserves the variant store when an empty render unbuilds a platform (#238)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    mkdirSync(join(ws, "profiles", "kofi", "variants"), { recursive: true });
    writeFileSync(join(ws, "profiles", "kofi", "variants", "k1.md"), "BODY\n");
    const r = run(["build", "kofi", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(existsSync(join(ws, "profiles", "kofi", "variants", "k1.md"))).toBe(true);
    expect(existsSync(join(ws, "profiles", "kofi", "README.md"))).toBe(false);
  });

  it("does not put the variant marker in a manual paste artifact (#238)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    mkdirSync(join(ws, "profiles", "kofi", "variants"), { recursive: true });
    writeFileSync(join(ws, "profiles", "kofi", "variants", "k1.md"), "CHOSEN KOFI BODY\n");
    writeFileSync(
      join(ws, "content", "active.yaml"),
      'kofi:\n  lang: en\n  variantId: k1\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );
    const r = run(["build", "kofi", "--workspace", ws]);
    expect(r.code).toBe(0);
    const artifact = readFileSync(join(ws, "profiles", "kofi", "README.md"), "utf8");
    expect(artifact).toContain("CHOSEN KOFI BODY");
    expect(artifact).not.toContain("<!-- active variant:");
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
    // github-readme (git) + the 5 family paste platforms + the manual paste
    // surfaces with a bio row (#239); kofi has no bios row in this fixture →
    // empty render → not written (§15.1 pure profiles/).
    expect(data.data.written.map((w) => w.platform)).toEqual([
      "github-readme",
      "linkedin",
      "upwork",
      "x",
      ...PASTE_PLATFORMS.map((entry) => entry.platform),
    ]);
    expect(existsSync(join(ws, "profiles", "kofi"))).toBe(false);
  });

  it("validate does not warn active-variant-missing when the body exists (#238)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    mkdirSync(join(ws, "profiles", "researchgate", "variants"), { recursive: true });
    writeFileSync(join(ws, "profiles", "researchgate", "variants", "rg-1.md"), "BODY\n");
    writeFileSync(
      join(ws, "content", "active.yaml"),
      'researchgate:\n  lang: en\n  variantId: rg-1\n  chosenAt: "2026-10-19T12:00:00.000Z"\n',
    );
    const r = run(["validate", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("active-variant-missing");
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

  // #197: a tag that exists but does NOT match diff.tagPattern must be ignored —
  // the documented fallback is `tag: null` + base = the root commit (USER-GUIDE §5).
  it("ignores a tag that does not match diff.tagPattern and bases on the root commit", () => {
    const ws = makeGitWorkspaceWithNonMatchingTag();
    const root = gitOut(ws, ["rev-list", "--max-parents=0", "HEAD"]);
    const head = gitOut(ws, ["rev-parse", "HEAD"]);
    const r = run(["diff", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: {
        tag: string | null;
        base: string;
        commits: { subject: string }[];
        hasChanges: boolean;
      };
    };
    expect(data.data.tag).toBeNull();
    expect(data.data.base).toBe(root);
    expect(data.data.base).not.toBe(head);
    expect(data.data.commits.map((c) => c.subject)).toEqual(["second: edit"]);
    expect(data.data.hasChanges).toBe(true);
  });

  it("picks up the tag once one matches diff.tagPattern", () => {
    const ws = makeGitWorkspaceWithNonMatchingTag();
    const releaseSha = gitOut(ws, ["rev-parse", "HEAD"]);
    git(ws, ["tag", "rel-1"]);
    const r = run(["diff", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: {
        tag: string | null;
        base: string;
        commits: { subject: string }[];
        hasChanges: boolean;
      };
    };
    expect(data.data.tag).toBe("rel-1");
    expect(data.data.base).toBe(releaseSha);
    expect(data.data.commits).toEqual([]);
    expect(data.data.hasChanges).toBe(false);
  });
});

describe("pasco init (scaffold)", () => {
  it("scaffolds a workspace that pasco validate accepts", () => {
    const dir = join(tempDir(), "ws");
    const r = run(["init", dir]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "content", "identity.yaml"))).toBe(true);
    expect(existsSync(join(dir, "content", "checks.yaml"))).toBe(true);
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

describe("pasco check (offline rules) + pasco skills:export (shipped skills)", () => {
  it("lists the user checks from the schema-validated catalog", () => {
    const r = run(["check", "github-readme", "--workspace", MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("evidence registry (D17/§18.8)"); // M7 checks execute offline
    expect(r.stdout).toContain("credential-expiry / no-private-in-public-output: OK");
    expect(r.stdout).toContain("gh-bio-max");
    expect(r.stdout).toContain("geo-consistent");
    expect(r.stdout).toContain("platform=all"); // union semantics: all applies to every platform
  });

  it("ships a default cap catalog that fires on the #240 repro (surface-scoped)", () => {
    const dir = join(tempDir(), "ws-caps");
    expect(run(["init", dir]).code).toBe(0);
    writeFileSync(
      join(dir, "content", "headlines.yaml"),
      `- platform: upwork\n  lang: en\n  text: "${"x".repeat(80)}"\n`,
    );
    writeFileSync(
      join(dir, "content", "bios.yaml"),
      `- platform: upwork\n  lang: en\n  length: long\n  text: "${"y".repeat(132)}"\n`,
    );

    const r = run(["check", "upwork", "--json", "--workspace", dir]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { limits: { code: string; message: string; path: string }[] };
    };
    expect(
      data.data.limits.some(
        (f) =>
          f.code === "max-chars" &&
          f.path === "headlines:upwork:en" &&
          f.message.includes("over max 50") &&
          f.message.includes("third-party guidance"),
      ),
    ).toBe(true);
    // The title cap is `surface: headline`; it must not flag the 132-char bio.
    expect(data.data.limits.some((f) => f.path.startsWith("bios:upwork"))).toBe(false);
  });

  it("falls back to the default catalog when the workspace has no checks.yaml (#240 premerge)", () => {
    const ws = tempDir();
    copyFixture(MINIMAL, ws);
    rmSync(join(ws, "content", "checks.yaml"));
    writeFileSync(
      join(ws, "content", "headlines.yaml"),
      `- platform: upwork\n  lang: en\n  text: "${"x".repeat(80)}"\n`,
    );
    const r = run(["check", "upwork", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { checks: unknown[]; limits: { path: string; message: string }[] };
    };
    expect(data.data.limits.some((f) => f.path === "headlines:upwork:en")).toBe(true);
  });

  it("scopes a platform: all cap to the requested platform (#240 premerge)", () => {
    const dir = join(tempDir(), "ws-all");
    expect(run(["init", dir]).code).toBe(0);
    writeFileSync(
      join(dir, "content", "bios.yaml"),
      `- platform: upwork\n  lang: en\n  length: long\n  text: "${"y".repeat(132)}"\n`,
    );
    writeFileSync(
      join(dir, "content", "checks.yaml"),
      "- id: all-bio\n  platform: all\n  rule: max-chars\n  value: 5\n  surface: bio\n",
    );
    const r = run(["check", "github-readme", "--json", "--workspace", dir]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as { data: { limits: { path: string }[] } };
    expect(data.data.limits.some((f) => f.path === "bios:upwork:en:long")).toBe(false);
  });

  it("executes max-chars/min-chars over headlines and bios as warnings (#240)", () => {
    const ws = tempDir();
    execFileSync("cp", ["-R", `${MINIMAL}/.`, ws]);
    writeFileSync(
      join(ws, "content", "checks.yaml"),
      "- id: upwork-title-max\n  platform: upwork\n  rule: max-chars\n  value: 20\n- id: upwork-title-min\n  platform: upwork\n  rule: min-chars\n  value: 100\n",
    );
    const r = run(["check", "--json", "--workspace", ws]);
    expect(r.code).toBe(0); // warn, not fail (D12)
    const data = JSON.parse(r.stdout) as {
      data: {
        implemented: { limits: boolean };
        limits: { code: string; severity: string; message: string }[];
      };
    };
    expect(data.data.implemented.limits).toBe(true);
    expect(
      data.data.limits.some(
        (f) => f.code === "max-chars" && f.severity === "warn" && f.message.includes("over max 20"),
      ),
    ).toBe(true);
    expect(
      data.data.limits.some(
        (f) =>
          f.code === "min-chars" && f.severity === "warn" && f.message.includes("under min 100"),
      ),
    ).toBe(true);

    const text = run(["check", "--workspace", ws]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("text limits");
    expect(text.stdout).toContain("over max 20");
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

  it("skills:export --list lists the platform skills this package ships", () => {
    const r = run(["skills:export", "--list"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("github-readme");
    expect(r.stdout).toMatch(/skills\/?$/m);
    expect(r.stdout).not.toContain("skills-studio");
  });

  it("skills:export <dir> copies the shipped skills into a directory the user names", () => {
    const dest = join(tempDir(), "exported-skills");
    const r = run(["skills:export", dest]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dest, "github-readme", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dest, "github-readme", "checks.yaml"))).toBe(true);

    const again = run(["skills:export", dest]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("not empty");

    const forced = run(["skills:export", dest, "--force"]);
    expect(forced.code).toBe(0);
    expect(forced.stdout).toContain("copied");
  });

  it("reports 'skills not shipped' when the package carries no skills (#253)", () => {
    // A package-shaped layout with no skills/ and no workspace marker above it:
    // the state that must never be confused with "this platform has no skill".
    const pkg = tempDir();
    mkdirSync(join(pkg, "dist"));
    copyFileSync(CLI, join(pkg, "dist", "index.js"));
    symlinkSync(join(__dirname, "..", "node_modules"), join(pkg, "node_modules"), "dir");
    const r = spawnSync(
      process.execPath,
      [join(pkg, "dist", "index.js"), "refine", "github-readme", "--workspace", MINIMAL],
      { encoding: "utf8", cwd: pkg, timeout: 15_000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("skills not shipped with this package");
    expect(r.stdout).not.toContain("no skill for github-readme");
  });

  it("skills:export refuses a destination inside the shipped tree (no self-copy recursion)", () => {
    const listed = JSON.parse(run(["skills:export", "--list", "--json"]).stdout) as {
      data: { root: string };
    };
    const r = run(["skills:export", join(listed.data.root, "nested")]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("inside the shipped skills tree");
  });

  it("skills:install is gone from the public CLI (#254 C1)", () => {
    const r = run(["skills:install", "pi"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });
});

describe("published-surface boundary (#253/#254)", () => {
  const PRIVATE = /skills-studio|prompt-studio|AGOS\b|project\.sh/;

  it("help output names no repo or tooling a reader cannot open", () => {
    const helps = [
      run(["--help"]),
      ...[
        "init",
        "validate",
        "build",
        "diff",
        "refine",
        "check",
        "post",
        "status",
        "skills:export",
      ].map((cmd) => run([cmd, "--help"])),
    ];
    for (const r of helps) {
      expect(r.code).toBe(0);
      expect(r.stdout).not.toMatch(PRIVATE);
    }
  });

  it("refine prints a real SKILL.md path from the package (#253)", () => {
    const r = run(["refine", "github-readme", "--workspace", MINIMAL]);
    expect(r.code).toBe(0);
    const match = r.stdout.match(/^Skill \(communicative strategy — READ IT FIRST\): (.+)$/m);
    expect(match).not.toBeNull();
    const skillPath = match?.[1] ?? "";
    expect(skillPath).toMatch(/skills\/github-readme\/SKILL\.md$/);
    expect(existsSync(skillPath)).toBe(true);
  });

  it("refine distinguishes 'no skill for <platform>' from 'skills not shipped'", () => {
    const r = run(["refine", "upwork", "--workspace", MINIMAL]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no skill for upwork yet");
    expect(r.stdout).toContain("this package ships:");
    expect(r.stdout).not.toContain("skills not shipped with this package");
  });

  it("refine --json carries the skill lookup state", () => {
    const found = JSON.parse(
      run(["refine", "github-readme", "--json", "--workspace", MINIMAL]).stdout,
    ) as { data: { skill: { state: string; path?: string } } };
    expect(found.data.skill.state).toBe("found");
    expect(found.data.skill.path).toMatch(/skills\/github-readme\/SKILL\.md$/);

    const missing = JSON.parse(
      run(["refine", "upwork", "--json", "--workspace", MINIMAL]).stdout,
    ) as { data: { skill: { state: string; channel?: string } } };
    expect(missing.data.skill.state).toBe("no-skill");
    expect(missing.data.skill.channel).toBe("upwork");
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

  it("--completeness reports the weighted checklist plus the percentage (issue #102)", () => {
    const ws = mkws();
    const res = run(["status", "--completeness", "--json", "--workspace", ws]);
    expect(res.code).toBe(0);
    const data = json(res.stdout).data as {
      mode: string;
      percent: number;
      satisfied: number;
      total: number;
      target: string;
      items: { id: string; score: number }[];
    };
    expect(data.mode).toBe("completeness");
    expect(data.percent).toBeGreaterThan(0);
    expect(data.percent).toBeLessThan(100);
    expect(data.items.length).toBe(5);
    expect(data.total).toBe(data.items.length);
    expect(data.target).toBe("profile-complete"); // shipped default
  });

  it("--completeness honours the .pascorc policy (dropped item leaves the score)", () => {
    const ws = mkws();
    // en/es/fr expected by default; a single-lang policy raises coverage, and
    // dropping the ledger item removes it from the denominator entirely.
    writeFileSync(
      join(ws, ".pascorc"),
      JSON.stringify({
        workspace: ".",
        completeness: {
          target: "github-milestone",
          langs: ["en"],
          items: [{ id: "deployment", weight: 0 }],
        },
      }),
      "utf8",
    );
    const res = run(["status", "--completeness", "--json", "--workspace", ws]);
    expect(res.code).toBe(0);
    const data = json(res.stdout).data as {
      target: string;
      total: number;
      items: { id: string }[];
    };
    expect(data.target).toBe("github-milestone");
    expect(data.total).toBe(4);
    expect(data.items.some((i) => i.id === "deployment")).toBe(false);
  });

  it("--write-checklist folds the completeness line into the generated view", () => {
    const ws = mkws();
    expect(run(["status", "--write-checklist", "--workspace", ws]).code).toBe(0);
    const body = readFileSync(join(ws, "CHECKLIST.md"), "utf8");
    expect(body).toContain("Profile completeness:");
    expect(body).toContain("% — ");
    // still the generated view, never hand-edited (D18)
    expect(body).toContain("AUTO-GENERATED");
  });

  it("--completeness + --mark is rejected, not silently ignored", () => {
    const res = run([
      "status",
      "--mark",
      "identity",
      "linkedin",
      "--completeness",
      "--workspace",
      mkws(),
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("mutually exclusive");
  });

  // Review of #205, F5: a malformed weight must not reach the arithmetic.
  it("a malformed .pascorc weight is dropped, never rendered as NaN", () => {
    const ws = mkws();
    writeFileSync(
      join(ws, ".pascorc"),
      // "heavy" is not a number, "" is empty, "geoanchor" is not a catalog id.
      '{"workspace":".","completeness":{"items":[{"id":"presence","weight":"heavy"},{"id":"evidence","weight":0.5},{"id":"geoAnchors","weight":""},{"id":"nope","weight":1}]}}',
      "utf8",
    );
    const res = run(["status", "--completeness", "--json", "--workspace", ws]);
    expect(res.code).toBe(0);
    const data = json(res.stdout).data as {
      percent: number;
      items: { id: string; weight: number }[];
    };
    expect(Number.isFinite(data.percent)).toBe(true);
    expect(res.stdout).not.toContain("NaN");
    // the valid override survives; the malformed ones fall back / drop out
    expect(data.items.find((i) => i.id === "evidence")?.weight).toBe(0.5);
    expect(data.items.map((i) => i.id)).not.toContain("nope");
    expect(Number.isFinite(data.items.find((i) => i.id === "presence")?.weight)).toBe(true);
  });

  it("--completeness + --write-checklist is rejected instead of silently dropping the write", () => {
    const ws = mkws();
    const res = run(["status", "--completeness", "--write-checklist", "--workspace", ws]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("run them separately");
    expect(existsSync(join(ws, "CHECKLIST.md"))).toBe(false); // nothing half-written
  });

  // Review of #205, finding 3: `pasco build` compiles with the WORKSPACE policy,
  // so the rendered artifact and `status --completeness` report one number.
  it("build renders the workspace policy's number, matching status --completeness", () => {
    const ws = mkws();
    // observe the DEFAULT number first (no .pascorc yet)
    const defaultPercent = (
      json(run(["status", "--completeness", "--json", "--workspace", ws]).stdout).data as {
        percent: number;
      }
    ).percent;

    writeFileSync(
      join(ws, ".pascorc"),
      JSON.stringify({
        workspace: ".",
        completeness: {
          target: "github-milestone",
          langs: ["en"],
          items: [{ id: "deployment", weight: 0 }],
        },
      }),
      "utf8",
    );
    const percent = (
      json(run(["status", "--completeness", "--json", "--workspace", ws]).stdout).data as {
        percent: number;
      }
    ).percent;
    expect(percent).not.toBe(defaultPercent); // the policy is observable

    expect(run(["build", "github-readme", "--workspace", ws]).code).toBe(0);
    const readme = readFileSync(join(ws, "profiles", "github-readme", "README.md"), "utf8");
    expect(readme).toContain(`Profile completeness: ${percent}%`);
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

/**
 * `pasco status --verify` through the BUILT binary (SPEC §19.5, issue #132).
 *
 * The injected-fetch ladder lives in `tests/status-verify.test.ts` (module-level,
 * no network). This block asserts the end-to-end contract of the REAL binary:
 * with no renderer yet declaring an extractor (Lane B, #212), `--verify` must
 * degrade honestly instead of pretending — and the write path must be a write
 * path (exit codes, ledger round-trip, the certification token in the generated
 * checklist).
 */
describe("pasco status --verify (D18/§19.5 certification)", () => {
  function verifyWorkspace(): string {
    const ws = tempDir();
    execFileSync("cp", ["-R", `${MINIMAL}/.`, ws]);
    return ws;
  }

  it("--mark records certification.state attested (and no anchor while no extractor exists)", () => {
    const ws = verifyWorkspace();
    expect(run(["status", "--mark", "identity", "linkedin", "--workspace", ws]).code).toBe(0);
    const ledger = readFileSync(join(ws, "content", "deployments.yaml"), "utf8");
    expect(ledger).toContain("certification:");
    expect(ledger).toContain("state: attested");
    expect(ledger).not.toContain("artifactHash:"); // forward-only: no extractor yet
  });

  it("--verify reports no-extractor per surface WITHOUT pinning the declared reason in the ledger", () => {
    const ws = verifyWorkspace();
    expect(run(["status", "--mark", "identity", "linkedin", "--workspace", ws]).code).toBe(0);
    const res = run(["status", "--verify", "--workspace", ws]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("no-extractor");
    const ledger = readFileSync(join(ws, "content", "deployments.yaml"), "utf8");
    // §19.5: a DECLARED reason is derived at read time, never stored — writing it
    // would pin a derived verdict into the file.
    expect(ledger).not.toContain("unverifiable");
    expect(ledger).not.toContain("no-extractor");
    // The human's confirmation stands, and staleness is untouched.
    expect(ledger).toContain("state: attested");
    expect(ledger).toContain("contentHash:");
    expect(ledger).toContain("deployedAt:");
  });

  it("--json is ADDITIVE: surfaces/state keep their old shape, certification rides beside them", () => {
    const ws = verifyWorkspace();
    // §19.5: the human `--mark` IS a confirmation — `attested` is the honest state
    // right after it, and it survives a read (a stored state is never overridden by
    // the derived `no-extractor`, which describes the ABSENCE of a confirmation).
    run(["status", "--mark", "identity", "github-readme", "--workspace", ws]);
    const res = run(["status", "--json", "--workspace", ws]);
    expect(res.code).toBe(0);
    const data = JSON.parse(res.stdout).data as {
      units: {
        key: string;
        state: string;
        surfaces: Record<string, string>;
        certification: null | {
          state: string;
          surfaces: Record<string, { state: string; reason?: string; artifactHash?: string }>;
        };
      }[];
    };
    const identity = data.units.find((u) => u.key === "identity");
    expect(identity?.state).toBe("in-sync");
    expect(identity?.surfaces).toEqual({ "github-readme": "in-sync" });
    // §19.5 read rule: the stored block IS the answer. `--mark` recorded
    // `attested` (the human's assertion) PLUS the anchor — this workspace declares
    // a GitHub surface, so the extractor renders and digests the artifact (#215).
    // The anchor is what lets a later `--verify` JUDGE the record, not just
    // observe it.
    expect(identity?.certification?.state).toBe("attested");
    expect(identity?.certification?.surfaces["github-readme"]?.state).toBe("attested");
    expect(identity?.certification?.surfaces["github-readme"]?.artifactHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    // A unit with no ledger record has no certification at all (absence, not never).
    expect(data.units.find((u) => u.key === "skills:Model routing")?.certification).toBeNull();

    // …and a pre-v1.10 record (no certification block) reads `attested` — the
    // human `--mark` it was, the ONLY ledger writer before v1.10.
    const legacy = verifyWorkspace();
    writeFileSync(
      join(legacy, "content", "deployments.yaml"),
      [
        "identity:",
        "  linkedin:",
        "    deployedAt: 2026-09-08T10:00:00Z",
        `    contentHash: ${"a".repeat(64)}`,
        "    source: manual",
      ].join("\n"),
      "utf8",
    );
    const legacyRes = run(["status", "--json", "--workspace", legacy]);
    const legacyIdentity = (
      JSON.parse(legacyRes.stdout).data as {
        units: {
          key: string;
          certification: null | { state: string; surfaces: Record<string, { reason?: string }> };
        }[];
      }
    ).units.find((u) => u.key === "identity");
    expect(legacyIdentity?.certification?.state).toBe("attested");
    expect(legacyIdentity?.certification?.surfaces.linkedin).toEqual({ state: "attested" });
  });

  it("--write-checklist carries the certification token: an attested surface is never a bare in-sync", () => {
    const ws = verifyWorkspace();
    run(["status", "--mark", "identity", "linkedin", "--workspace", ws]);
    expect(run(["status", "--write-checklist", "--workspace", ws]).code).toBe(0);
    const checklist = readFileSync(join(ws, "CHECKLIST.md"), "utf8");
    // The token carries the certification dimension, so an `attested` surface is
    // never a bare `in-sync` masquerading as a machine check.
    expect(checklist).toContain("linkedin (in-sync/attested)");
  });

  it("--verify conflicts with the other modes (exit 2), never silently ignored", () => {
    const ws = verifyWorkspace();
    expect(
      run(["status", "--verify", "--mark", "identity", "linkedin", "--workspace", ws]).code,
    ).toBe(2);
    expect(run(["status", "--verify", "--write-checklist", "--workspace", ws]).code).toBe(2);
    expect(run(["status", "--verify", "--completeness", "--workspace", ws]).code).toBe(2);
  });

  it("--verify help documents the network path and the forward-only anchor limit", () => {
    const help = run(["status", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--verify");
    expect(help.stdout).toContain("forward-only");
  });

  it("--verify leaves a workspace with no ledger record untouched (no file created)", () => {
    const ws = verifyWorkspace();
    const res = run(["status", "--verify", "--workspace", ws]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("nothing to verify");
    expect(existsSync(join(ws, "content", "deployments.yaml"))).toBe(false);
  });
});
