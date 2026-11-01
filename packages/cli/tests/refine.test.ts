/**
 * `pasco refine` — the agent task template is a PUBLISHED surface (rule 9).
 *
 * Two defects pinned here (issue #415):
 *   1. `experience[].role` became a langMap in schema v1.1, and the template
 *      interpolated it raw: the executing agent read `[object Object]` where a
 *      fact title belongs. The fixture's first row IS a langMap; the requested
 *      language must win, falling back to `en` (the compile-level rule), and a
 *      plain-string role must keep rendering verbatim.
 *   2. `Variant id convention:` computed the prefix correctly but the examples
 *      hardcoded `gh-en-*`: every non-GitHub platform was told to name its
 *      variants after another one. The examples are derived from the prefix.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "fixtures", "refine-langmap");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("pasco refine (agent template)", () => {
  it("resolves a langMap role in the requested language, never `[object Object]`", () => {
    const res = run(["refine", "linkedin", "--lang", "en", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Demo Engineer @ Example Corp");
    expect(res.stdout).not.toContain("[object Object]");
  });

  it("uses the non-English value of the langMap when that is the requested language", () => {
    const res = run(["refine", "linkedin", "--lang", "es", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Ingeniero Demo @ Example Corp");
    expect(res.stdout).not.toContain("[object Object]");
  });

  it("falls back to `en` when the requested language is absent from the role map", () => {
    const res = run(["refine", "linkedin", "--lang", "fr", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Demo Engineer @ Example Corp");
    expect(res.stdout).not.toContain("[object Object]");
  });

  it("keeps a plain-string role verbatim", () => {
    const res = run(["refine", "linkedin", "--workspace", FIXTURE]);
    expect(res.stdout).toContain("Data Analyst @ Plain String Ltd");
  });

  it("derives the variant-id examples from the addressed platform", () => {
    const res = run(["refine", "linkedin", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Variant id convention: linkedin-en-<n>");
    expect(res.stdout).toContain("linkedin-en-1, linkedin-en-2, linkedin-en-3");
    expect(res.stdout).not.toContain("gh-en-");
  });

  it("numbers exactly `--variants` examples and follows `--lang`", () => {
    const res = run([
      "refine",
      "linkedin",
      "--lang",
      "es",
      "--variants",
      "2",
      "--workspace",
      FIXTURE,
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("linkedin-es-1, linkedin-es-2");
    expect(res.stdout).not.toContain("linkedin-es-3");
  });

  it("uses the same slug dialect for github-readme, which the skill now documents", () => {
    const res = run(["refine", "github-readme", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("githubreadme-en-<n>");
    expect(res.stdout).toContain("githubreadme-en-1, githubreadme-en-2, githubreadme-en-3");
    // The pre-#415 line printed `gh-en-*` here; the dialect is now the slug the
    // user guide and the shipped skill agree on — never a per-platform table in
    // the CLI (rule 7).
    expect(res.stdout).not.toContain("gh-en-");
  });

  it("still emits one example when an unvalidated `.pascorc` declares 0 variants", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-variants-"));
    try {
      cpSync(FIXTURE, dir, { recursive: true });
      writeFileSync(join(dir, ".pascorc"), JSON.stringify({ defaults: { variants: 0 } }));
      const res = run(["refine", "linkedin", "--workspace", dir]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("(e.g. linkedin-en-1)");
      expect(res.stdout).not.toContain("(e.g. )");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
