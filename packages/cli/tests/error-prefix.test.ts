/**
 * Published error surfaces — ONE prefix policy (rule 9, issue #416).
 *
 * The CLI prints `pasco <command>: …` on its success paths. The error path was
 * the exception: `report()` printed `<command>: …` without the `pasco`, and the
 * top-level catch added a `usage: ` to messages that already carried one, so a
 * usage error read `usage: usage: pasco skills:export …`.
 *
 * Pinned here, one test per shape the issue named: `skills:export` with no args,
 * `refine` with no platform, and the `export ai-policy` refuse path — plus a
 * UsageError whose message is a constraint rather than a usage line, so the fix
 * cannot be "delete the prefix everywhere".
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const AI_POLICY_FIXTURE = join(__dirname, "fixtures", "ai-policy");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-prefix-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

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

/** Exactly one `usage:` label, and it opens the line. */
function expectSingleUsage(stderr: string, subject: string): void {
  expect(stderr.match(/usage:/g) ?? []).toHaveLength(1);
  expect(stderr.startsWith(`usage: ${subject}`)).toBe(true);
}

describe("usage errors carry exactly one `usage:`", () => {
  it("skills:export with no destination", () => {
    const res = run(["skills:export"]);
    expect(res.code).toBe(2);
    expectSingleUsage(res.stderr, "pasco skills:export");
  });

  it("refine with no platform", () => {
    const res = run(["refine"]);
    expect(res.code).toBe(2);
    expectSingleUsage(res.stderr, "pasco refine");
  });

  it("a UsageError that states a constraint instead of a usage line", () => {
    const res = run(["skills:export", "--list", "out"]);
    expect(res.code).toBe(2);
    expect(res.stderr.match(/usage:/g) ?? []).toHaveLength(1);
    expect(res.stderr.startsWith("usage: --list takes no destination")).toBe(true);
  });
});

describe("the human error path uses the same `pasco <command>:` prefix as success", () => {
  it("export ai-policy refuses a robots.txt it did not generate", () => {
    const out = tempDir();
    writeFileSync(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
    const res = run(["export", "ai-policy", "--out", out, "--workspace", AI_POLICY_FIXTURE]);
    expect(res.code).toBe(1);
    expect(res.stderr.startsWith("pasco export ai-policy: refusing to overwrite")).toBe(true);
    expect(res.stderr).toContain("pass --force to replace it");
  });
});
