/**
 * Release notes extractor (issue #58) — the CLI half of the GitHub Release job.
 *
 * A parser that silently grabs the WRONG section ships a release page with
 * another version's changes, which is worse than no notes at all. So the cases
 * pinned here are the ones that would lie: a prefix version (`0.1` vs `0.1.0`),
 * a released version whose body must NOT leak the `[Unreleased]` bullets below
 * it, and the CLI contract (exit 1 on a missing section; `--output` file vs
 * stdout).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { extractReleaseNotes } from "../scripts/release-notes.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "release-notes.mjs");

const CHANGELOG = `# Changelog

Intro prose that belongs to no version.

## [Unreleased]

### Added

- an unreleased feature that must never leak into a released page

## [0.2.0] - 2026-10-01

### Added

- the two-point-oh feature

## [0.1.0] - 2026-09-15

### Added

- the first release

### Fixed

- an early bug
`;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-notes-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Run the script the way the workflow does; return exit code + combined output. */
function run(args: string[], script = SCRIPT): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("extractReleaseNotes", () => {
  it("returns the section body for the exact version, without the heading", () => {
    const notes = extractReleaseNotes(CHANGELOG, "0.1.0");
    expect(notes).toContain("### Added");
    expect(notes).toContain("- the first release");
    expect(notes).toContain("- an early bug");
    expect(notes).not.toContain("## [0.1.0]");
  });

  it("stops at the next level-2 heading — no leakage from other versions", () => {
    const notes = extractReleaseNotes(CHANGELOG, "0.2.0");
    expect(notes).toContain("the two-point-oh feature");
    expect(notes).not.toContain("the first release");
    expect(notes).not.toContain("an unreleased feature");
  });

  it("never matches [Unreleased] for a numeric version", () => {
    const notes = extractReleaseNotes(CHANGELOG, "0.3.0");
    expect(notes).toBeNull();
  });

  it("matches the version exactly — a prefix must not satisfy it", () => {
    expect(extractReleaseNotes(CHANGELOG, "0.1")).toBeNull();
    expect(extractReleaseNotes(CHANGELOG, "0")).toBeNull();
  });

  it("treats a section with a date suffix and one without the same way", () => {
    const undated = "# Changelog\n\n## [1.2.3]\n\n### Added\n\n- undated release\n";
    expect(extractReleaseNotes(undated, "1.2.3")).toBe("### Added\n\n- undated release");
  });

  it("returns null for an empty section (a release page with no notes is a lie)", () => {
    const empty = "# Changelog\n\n## [1.0.0]\n\n## [0.9.0]\n\n- previous\n";
    expect(extractReleaseNotes(empty, "1.0.0")).toBeNull();
  });

  it("keeps a `## ` line that sits inside a fenced code block", () => {
    // The fresh-context review found the terminator truncated here silently:
    // a `## ...` inside a fence is content, not the next section.
    const fenced = [
      "# Changelog",
      "",
      "## [1.0.0]",
      "",
      "- before",
      "",
      "```md",
      "## this is inside a code fence",
      "```",
      "",
      "- real note two",
      "",
      "## [0.9.0]",
      "",
      "- previous",
      "",
    ].join("\n");
    const notes = extractReleaseNotes(fenced, "1.0.0");
    expect(notes).toContain("## this is inside a code fence");
    expect(notes).toContain("- real note two");
    expect(notes).not.toContain("- previous");
  });

  it("does not absorb trailing link reference definitions", () => {
    const withRefs = [
      "# Changelog",
      "",
      "## [1.0.0]",
      "",
      "- the release",
      "",
      "[1.0.0]: https://example.com/compare/v0.9.0...v1.0.0",
      "[Unreleased]: https://example.com/compare/v1.0.0...HEAD",
      "",
    ].join("\n");
    const notes = extractReleaseNotes(withRefs, "1.0.0");
    expect(notes).toContain("- the release");
    expect(notes).not.toContain("[1.0.0]:");
    expect(notes).not.toContain("[Unreleased]:");
  });
});

describe("release-notes CLI", () => {
  it("prints the notes to stdout", () => {
    const dir = tempDir();
    const changelog = join(dir, "CHANGELOG.md");
    writeFileSync(changelog, CHANGELOG);

    const res = run(["--version", "0.1.0", "--changelog", changelog]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("the first release");
  });

  it("writes the notes to --output when given", () => {
    const dir = tempDir();
    const changelog = join(dir, "CHANGELOG.md");
    const output = join(dir, "notes.md");
    writeFileSync(changelog, CHANGELOG);

    const res = run(["--version", "0.2.0", "--changelog", changelog, "--output", output]);
    expect(res.code).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("the two-point-oh feature");
  });

  it("exits 1 (release must not proceed) when the section is missing", () => {
    const dir = tempDir();
    const changelog = join(dir, "CHANGELOG.md");
    writeFileSync(changelog, CHANGELOG);

    const res = run(["--version", "9.9.9", "--changelog", changelog]);
    expect(res.code).toBe(1);
    expect(res.out).toContain("no non-empty");
  });

  it("exits 2 on a missing --version", () => {
    const res = run([]);
    expect(res.code).toBe(2);
    expect(res.out).toContain("usage");
  });

  it("exits 0 for --help", () => {
    const res = run(["--help"]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("--version");
  });

  it("accepts the --key=value form", () => {
    const dir = tempDir();
    const changelog = join(dir, "CHANGELOG.md");
    writeFileSync(changelog, CHANGELOG);

    const res = run(["--version=0.1.0", `--changelog=${changelog}`]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("the first release");
  });

  it("still runs main() when invoked through a symlink", () => {
    // A main-guard that compared the path spelling would silently no-op here:
    // a missing section would exit 0 and the release would ship with no notes —
    // the #81 failure class, "a check that did not run" reading as "check passed".
    const dir = tempDir();
    const changelog = join(dir, "CHANGELOG.md");
    const link = join(dir, "release-notes-link.mjs");
    writeFileSync(changelog, CHANGELOG);
    symlinkSync(SCRIPT, link);

    const ok = run(["--version", "0.1.0", "--changelog", changelog], link);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("the first release");

    const missing = run(["--version", "9.9.9", "--changelog", changelog], link);
    expect(missing.code).toBe(1);
  });
});
