/**
 * `pasco edit` — S1 of epic #247: contract-path resolution + `--check`, and the
 * invariant that makes the slice shippable before S2's write exists: NOTHING on
 * disk is touched (asserted byte-for-byte, the acceptance's "byte-hash fixture").
 *
 * Runs the BUILT binary (`pnpm test` builds first) against a copy of the core
 * `minimal` fixture, so a test never mutates a committed fixture.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

const tempDirs: string[] = [];
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-edit-"));
  tempDirs.push(dir);
  cpSync(MINIMAL, dir, { recursive: true });
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

function edit(dir: string, ...args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, "edit", ...args, "--workspace", dir], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** sha256 of every content file (name + bytes), in name order — the slice's
 *  "no byte moved" assertion. */
function contentHash(dir: string): string {
  const contentDir = join(dir, "content");
  const hash = createHash("sha256");
  for (const name of readdirSync(contentDir).sort()) {
    hash.update(name);
    hash.update(readFileSync(join(contentDir, name)));
  }
  return hash.digest("hex");
}

describe("pasco edit — S1 resolution (read-only)", () => {
  it("prints the current value of a lang-only address", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.statement.en");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("address:  positioning.statement.en");
    expect(r.stdout).toContain("current:  AI engineer building sovereign");
    expect(r.stdout).toContain("rendered (every platform slice, en):");
  });

  it("--set --check prints old → new and the rendered platform text", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "headlines[platform=upwork,lang=en].text",
      "--set",
      "Sovereign AI architect",
      "--check",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "current:  Sovereign AI stack architect — routing, local inference, evaluation",
    );
    expect(r.stdout).toContain("proposed: Sovereign AI architect");
    expect(r.stdout).toContain("rendered (upwork/en): Sovereign AI architect");
  });

  it("renders a bio row through its own platform+lang+length slice", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Short bio",
      "--check",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("rendered (linkedin/en): Short bio");
  });

  it("resolves a link and refuses to write it (the URL SSOT is identity.yaml)", () => {
    const dir = workspace();
    const read = edit(dir, "identity.links[platform=github].url");
    expect(read.code).toBe(0);
    expect(read.stdout).toContain("current:  https://github.com/elenavasquez");
    expect(read.stdout).toContain("verbatim — the URL SSOT");

    const write = edit(
      dir,
      "identity.links[platform=github].url",
      "--set",
      "https://x.dev",
      "--check",
    );
    expect(write.code).toBe(2);
    expect(write.stderr).toContain("read-only");
  });

  it("rejects an unknown address with the grammar for every block", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.foo");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown address "positioning.foo"');
    expect(r.stderr).toContain("positioning.statement.<lang>");
    expect(r.stderr).toContain("headlines[platform=<p>,lang=<l>].text");
    expect(r.stderr).toContain("bios[platform=<p>,lang=<l>,length=<len>].text");
    expect(r.stderr).toContain("identity.links[platform=<p>].url");
  });

  it("rejects an unknown platform with the allowed enum values", () => {
    const dir = workspace();
    const r = edit(dir, "headlines[platform=gitlab,lang=en].text");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown platform "gitlab"');
    expect(r.stderr).toContain("linkedin");
  });

  it("reports 0 rows with the addresses the workspace does have", () => {
    const dir = workspace();
    const r = edit(dir, "headlines[platform=upwork,lang=fr].text");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("resolves to 0 rows");
    expect(r.stdout).toContain("available:");
    expect(r.stdout).toContain("headlines[platform=upwork,lang=en].text");
  });

  it("refuses an ambiguous (duplicate) row instead of choosing one", () => {
    const dir = workspace();
    const bios = join(dir, "content", "bios.yaml");
    const original = readFileSync(bios, "utf8");
    // A duplicate platform+lang+length row is a REAL workspace state
    // (drift/duplicate-bio) — the resolver must surface it, never pick one.
    writeFileSync(
      bios,
      `${original}- platform: linkedin\n  lang: en\n  length: medium\n  text: Duplicate row text.\n`,
    );
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "New",
      "--check",
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("resolves to 2 rows");
    expect(r.stdout).toContain("refuses to choose");
    expect(r.stdout).toContain("Duplicate row text.");
  });

  it("refuses --set without --check: the write lands with S2 (#249)", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.statement.en", "--set", "New statement");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--check");
    expect(r.stderr).toContain("#249");
  });

  it("refuses an empty --set (schema minLength 1)", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.statement.en", "--set", "", "--check");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("must not be empty");
  });

  it("--json carries exactly { address, current, proposed, rendered, ok }", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "headlines[platform=upwork,lang=en].text",
      "--set",
      "Sovereign AI architect",
      "--check",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      command: string;
      ok: boolean;
      exitCode: number;
      data: Record<string, unknown>;
    };
    expect(parsed.command).toBe("edit");
    expect(parsed.ok).toBe(true);
    expect(parsed.exitCode).toBe(0);
    expect(Object.keys(parsed.data).sort()).toEqual(
      ["address", "current", "ok", "proposed", "rendered"].sort(),
    );
    expect(parsed.data.address).toBe("headlines[platform=upwork,lang=en].text");
    expect(parsed.data.current).toBe(
      "Sovereign AI stack architect — routing, local inference, evaluation",
    );
    expect(parsed.data.proposed).toBe("Sovereign AI architect");
    expect(parsed.data.rendered).toBe("Sovereign AI architect");
    expect(parsed.data.ok).toBe(true);
  });

  it("never touches a byte on disk (read-only slice)", () => {
    const dir = workspace();
    const before = contentHash(dir);
    for (const args of [
      ["positioning.statement.en"],
      ["positioning.statement.en", "--set", "Another statement", "--check"],
      ["headlines[platform=x,lang=en].text", "--set", "A new headline", "--check"],
      ["identity.links[platform=orcid].url"],
      ["bios[platform=nope,lang=en,length=medium].text"],
    ]) {
      edit(dir, ...args);
    }
    expect(contentHash(dir)).toBe(before);
  });
});
