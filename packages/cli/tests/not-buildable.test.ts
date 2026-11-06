/**
 * `notBuildable` is not a parallel predicate (#490): every case here RUNS the
 * real build, asserts whether an artifact landed at `artifactPath()`, and only
 * then reads the check buckets. The whitespace case is the one that exposed the
 * last divergence — `build` writes bytes for `text: "   "` (`text === ""` is the
 * unbuild rule), so it must NOT be reported as not buildable.
 *
 * Offline: dist CLI + temp workspaces.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { artifactPath } from "../src/publication.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[]): { code: number; stdout: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 15_000 });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "" };
}

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-not-buildable-"));
  created.push(dir);
  mkdirSync(join(dir, "content"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, "content", name), body, "utf8");
  }
  // The workspace catalog declares the premise for every case, so `declared` is
  // decided by the surface, not by which skill happens to ship a catalog.
  writeFileSync(
    join(dir, "content", "checks.yaml"),
    "- platform: all\n  rule: fact-present\n  value: true\n",
    "utf8",
  );
  return dir;
}

interface Buckets {
  declared: string[];
  checked: string[];
  notRun: string[];
  notBuildable: string[];
}

function buckets(ws: string, surface: string): Buckets {
  const res = run(["check", surface, "--json", "--workspace", ws]);
  expect(res.code).toBe(0);
  return (JSON.parse(res.stdout) as { data: { factPresent: Buckets } }).data.factPresent;
}

describe("notBuildable — the build's own decision tree (#490)", () => {
  it("a whitespace-only bio is buildable: build writes it, so it is not not-buildable", () => {
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "bios.yaml": '- platform: mastodon\n  lang: en\n  length: short\n  text: "   "\n',
    });
    expect(run(["build", "mastodon", "--workspace", ws]).code).toBe(0);
    // The build's unbuild rule is `text === ""`, and pasteSource emits `${text}\n`.
    expect(existsSync(artifactPath(ws, "mastodon"))).toBe(true);
    const facts = buckets(ws, "mastodon");
    expect(facts.notBuildable).toEqual([]);
    expect(facts.checked).toContain("mastodon");
  });

  it("a handle-only surface cannot build: no artifact, notBuildable", () => {
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "socialHandles.yaml": "- platform: x\n  handle: elena\n  status: claimed\n",
    });
    expect(run(["build", "x", "--workspace", ws]).code).toBe(0);
    expect(existsSync(artifactPath(ws, "x"))).toBe(false);
    const facts = buckets(ws, "x");
    expect(facts.notRun).toContain("x");
    expect(facts.notBuildable).toContain("x");
  });

  it("an active variant without a body cannot build: notBuildable", () => {
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "active.yaml":
        'mastodon:\n  lang: en\n  variantId: mst-en-1\n  chosenAt: "2026-11-06T00:00:00Z"\n',
    });
    expect(run(["build", "mastodon", "--workspace", ws]).code).toBe(0);
    expect(existsSync(artifactPath(ws, "mastodon"))).toBe(false);
    const facts = buckets(ws, "mastodon");
    expect(facts.notBuildable).toContain("mastodon");
  });

  it("a renderer that returns empty cannot build: notBuildable", () => {
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "headlines.yaml": "- platform: substack\n  lang: en\n  text: A headline with no body.\n",
    });
    expect(run(["build", "substack", "--workspace", ws]).code).toBe(0);
    expect(existsSync(artifactPath(ws, "substack"))).toBe(false);
    const facts = buckets(ws, "substack");
    expect(facts.notBuildable).toContain("substack");
  });

  it("github-org on a person workspace cannot build: notBuildable", () => {
    const ws = workspace({
      "identity.yaml": "name: Elena Vasquez\n",
      "bios.yaml": "- platform: github-org\n  lang: en\n  length: short\n  text: Org bio.\n",
    });
    expect(run(["build", "github-org", "--workspace", ws]).code).toBe(0);
    expect(existsSync(artifactPath(ws, "github-org"))).toBe(false);
    const facts = buckets(ws, "github-org");
    expect(facts.notBuildable).toContain("github-org");
  });
});
