/**
 * The built `substack` artifact (issue #483): a renderer platform owns
 * `profiles/substack/README.md`, not the pre-renderer flat `profiles/substack.md`
 * (#239/#242). The sheet is deterministic, unbuilds when the SSOT backs no body,
 * and the ledger still records a manual deploy with its existing shape.
 *
 * Offline: dist CLI + fixture copies in a temp dir.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal-substack");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 15_000 });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function fixtureWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-substack-renderer-"));
  created.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

/** A workspace with the identity only — no substack bio row, no newsletter. */
function emptyWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-substack-empty-"));
  created.push(dir);
  mkdirSync(join(dir, "content"), { recursive: true });
  writeFileSync(join(dir, "content", "identity.yaml"), "name: Elena Vasquez\n");
  return dir;
}

const EXPECTED_SHEET = `# Substack — Elena Vasquez (en)
Handle: @elenavasquez
Display name: Elena Vasquez
Bio (profile): Sovereign AI infrastructure · open-source education · GEO for profiles.
About: Elena Vasquez builds sovereign AI infrastructure. She leads the open-source example-agentic-hub project, routes LLM traffic to local-first providers and writes about generative-engine optimization for professional profiles.
Links: https://github.com/elenavasquez · https://elenavasquez.substack.com
Publication: Notes on Sovereign AI
Short description: Notes on sovereign AI, open education and generative-engine optimization.
Cadence: weekly
Canonical: https://elenavasquez.substack.com
`;

describe("pasco build substack — the paste sheet (issue #483)", () => {
  it("writes profiles/substack/README.md with the full sheet", () => {
    const ws = fixtureWorkspace();
    const r = run(["build", "substack", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { written: { platform: string; path: string }[] };
    };
    expect(data.data.written).toEqual([
      { platform: "substack", path: join(ws, "profiles", "substack", "README.md") },
    ]);
    expect(readFileSync(join(ws, "profiles", "substack", "README.md"), "utf8")).toBe(
      EXPECTED_SHEET,
    );
    // The renderer owns the surface: the pre-renderer flat file must not exist.
    expect(existsSync(join(ws, "profiles", "substack.md"))).toBe(false);
  });

  it("is byte-identical across two runs (no timestamp, no clock)", () => {
    const ws = fixtureWorkspace();
    expect(run(["build", "substack", "--workspace", ws]).code).toBe(0);
    const first = readFileSync(join(ws, "profiles", "substack", "README.md"));
    expect(run(["build", "substack", "--workspace", ws]).code).toBe(0);
    const second = readFileSync(join(ws, "profiles", "substack", "README.md"));
    expect(second.equals(first)).toBe(true);
  });

  it("removes a stale flat profiles/substack.md when the renderer owns the surface", () => {
    const ws = fixtureWorkspace();
    mkdirSync(join(ws, "profiles"), { recursive: true });
    writeFileSync(join(ws, "profiles", "substack.md"), "PRE-RENDERER FLAT FILE\n");
    expect(run(["build", "substack", "--workspace", ws]).code).toBe(0);
    expect(existsSync(join(ws, "profiles", "substack.md"))).toBe(false);
    expect(existsSync(join(ws, "profiles", "substack", "README.md"))).toBe(true);
  });

  it("resolves the publication langMap with the es→en fallback core owns", () => {
    const ws = mkdtempSync(join(tmpdir(), "pasco-substack-fallback-"));
    created.push(ws);
    mkdirSync(join(ws, "content"), { recursive: true });
    writeFileSync(
      join(ws, "content", "identity.yaml"),
      "name: Elena Vasquez\nhandle: elenavasquez\n",
    );
    writeFileSync(
      join(ws, "content", "newsletter.yaml"),
      "platform: substack\nurl: https://elenavasquez.substack.com\nname:\n  en: Notes on Sovereign AI\ndescription:\n  en: Notes on sovereign AI and open education.\n",
    );
    expect(run(["build", "substack", "--lang", "es", "--workspace", ws]).code).toBe(0);
    const artifact = readFileSync(join(ws, "profiles", "substack", "README.md"), "utf8");
    expect(artifact).toContain("# Substack — Elena Vasquez (es)");
    expect(artifact).toContain("Publication: Notes on Sovereign AI");
    expect(artifact).toContain("Short description: Notes on sovereign AI and open education.");
  });

  it("unbuilds the platform when there is no substack bio and no newsletter", () => {
    const ws = emptyWorkspace();
    // A prior artifact the SSOT no longer backs must not survive.
    mkdirSync(join(ws, "profiles", "substack"), { recursive: true });
    writeFileSync(join(ws, "profiles", "substack", "README.md"), "STALE\n");

    const r = run(["build", "substack", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as {
      data: { written: unknown[]; skipped: { platform: string }[] };
    };
    expect(data.data.written).toEqual([]);
    expect(data.data.skipped.map((entry) => entry.platform)).toEqual(["substack"]);
    expect(existsSync(join(ws, "profiles", "substack"))).toBe(false);
  });

  it("never claims a newsletter that belongs to another platform", () => {
    // `newsletter` is one raw block on the profile, admitted for any newsletter
    // platform; only `platform: substack` may produce this sheet. A Ghost-only
    // workspace built with no platform argument must not receive one.
    const ws = mkdtempSync(join(tmpdir(), "pasco-substack-ghost-"));
    created.push(ws);
    mkdirSync(join(ws, "content"), { recursive: true });
    writeFileSync(
      join(ws, "content", "identity.yaml"),
      "name: Elena Vasquez\nhandle: elenavasquez\n",
    );
    writeFileSync(
      join(ws, "content", "newsletter.yaml"),
      "platform: ghost\nurl: https://notes.elena.dev\nname:\n  en: Notes on Sovereign AI\n",
    );
    const r = run(["build", "--json", "--workspace", ws]);
    expect(r.code).toBe(0);
    expect(existsSync(join(ws, "profiles", "substack", "README.md"))).toBe(false);
  });

  it("keeps a lone medium bio in the sheet instead of emitting a header-only file", () => {
    // The sheet reads `short`+`long`; a `medium`-only workspace is legal and
    // pre-#483 the paste source published it. The profile-header line carries it
    // so a declared fact never disappears.
    const ws = emptyWorkspace();
    writeFileSync(
      join(ws, "content", "bios.yaml"),
      "- platform: substack\n  lang: en\n  length: medium\n  text: The medium bio.\n",
    );
    expect(run(["build", "substack", "--workspace", ws]).code).toBe(0);
    const artifact = readFileSync(join(ws, "profiles", "substack", "README.md"), "utf8");
    expect(artifact).toContain("Bio (profile): The medium bio.");
    expect(artifact).not.toContain("About:");
  });

  it("scopes check and audit to a newsletter-only artifact (#483)", () => {
    // The sheet exists with a publication and no bio row, so `targetedSurfaces`
    // must include `newsletter.platform`; otherwise check/audit would report
    // `declared: []` for a file `pasco build` demonstrably wrote.
    const ws = mkdtempSync(join(tmpdir(), "pasco-substack-newsletter-only-"));
    created.push(ws);
    mkdirSync(join(ws, "content"), { recursive: true });
    writeFileSync(
      join(ws, "content", "identity.yaml"),
      "name: Elena Vasquez\nhandle: elenavasquez\n",
    );
    writeFileSync(
      join(ws, "content", "newsletter.yaml"),
      "platform: substack\nurl: https://elenavasquez.substack.com\nname:\n  en: Notes on Sovereign AI\n",
    );
    expect(run(["build", "substack", "--workspace", ws]).code).toBe(0);

    const check = JSON.parse(run(["check", "--json", "--workspace", ws]).stdout) as {
      data: { factPresent: { declared: string[]; checked: string[] } };
    };
    expect(check.data.factPresent.declared).toContain("substack");
    expect(check.data.factPresent.checked).toContain("substack");

    const audit = JSON.parse(run(["audit", "--json", "--workspace", ws]).stdout) as {
      data: { scope: { declared: string[]; checked: string[] } };
    };
    expect(audit.data.scope.declared).toContain("substack");
    expect(audit.data.scope.checked).toContain("substack");
  });

  it("records the manual deploy with the existing ledger shape", () => {
    const ws = fixtureWorkspace();
    expect(run(["build", "substack", "--workspace", ws]).code).toBe(0);
    const mark = run([
      "status",
      "--mark",
      "bios:substack:en:short",
      "substack",
      "--workspace",
      ws,
      "--at",
      "2026-11-06T12:00:00Z",
    ]);
    expect(mark.code).toBe(0);
    expect(mark.stdout).toContain("marked");
    const ledger = readFileSync(join(ws, "content", "deployments.yaml"), "utf8");
    expect(ledger).toContain("bios:substack:en:short:");
    expect(ledger).toContain("substack:");
    expect(ledger).toContain("source: manual");
    // The ledger contract did not grow a substack-specific field.
    expect(ledger).not.toContain("sheet");
  });
});
