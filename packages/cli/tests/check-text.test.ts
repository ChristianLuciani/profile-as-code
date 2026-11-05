/**
 * `pasco check` — `text/same-across-platforms`, the ADVISORY narrative rule
 * (SPEC §21.8, #462).
 *
 * The failure it exists for: an agent unified one platform's headline across
 * every surface "for consistency" and `pasco check` stayed green. Facts are
 * unique; narrative is per surface — so the rule warns, cites both platforms and
 * the text kind, and never fails the command (a heuristic is not a gate).
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

const created: string[] = [];

function workspace(headlines: string, bios = "[]\n"): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-check-text-"));
  created.push(dir);
  cpSync(MINIMAL, dir, { recursive: true });
  writeFileSync(join(dir, "content", "headlines.yaml"), headlines);
  writeFileSync(join(dir, "content", "bios.yaml"), bios);
  return dir;
}

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

interface SameTextFinding {
  code: string;
  severity: string;
  kind: string;
  surfaces: string[];
  message: string;
  path: string;
}

function findingsOf(ws: string): SameTextFinding[] {
  const res = run(["check", "--json", "--workspace", ws]);
  expect(res.code).toBe(0); // advisory: warn, never fail (D12)
  const data = JSON.parse(res.stdout) as { data: { sameText: SameTextFinding[] } };
  return data.data.sameText;
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe("pasco check — text/same-across-platforms (SPEC §21.8, #462)", () => {
  it("warns when two different platforms carry a byte-identical headline", () => {
    const text = "Sovereign AI infrastructure, built in the open";
    const ws = workspace(
      [
        { platform: "linkedin", lang: "en", text },
        { platform: "x", lang: "en", text },
      ]
        .map((row) => `- platform: ${row.platform}\n  lang: ${row.lang}\n  text: ${row.text}\n`)
        .join(""),
    );
    const findings = findingsOf(ws);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("text/same-across-platforms");
    expect(findings[0]?.severity).toBe("warn");
    expect(findings[0]?.kind).toBe("headline");
    expect(findings[0]?.surfaces).toEqual(["linkedin", "x"]);
    expect(findings[0]?.message).toContain("linkedin, x");
    expect(findings[0]?.path).toBe("headlines:linkedin/en");

    const human = run(["check", "--workspace", ws]);
    expect(human.stdout).toContain("text/same-across-platforms");
    expect(human.stdout).toContain("narrative across platforms (advisory)");
  });

  it("adds no finding when the platforms write their own text", () => {
    const ws = workspace(
      "- platform: linkedin\n  lang: en\n  text: Builds sovereign AI systems\n- platform: x\n  lang: en\n  text: One release at a time\n",
    );
    expect(findingsOf(ws)).toEqual([]);
  });

  it("warns for a bio shared verbatim within the same length band", () => {
    const text = "AI engineer working on local-first infrastructure.";
    const ws = workspace(
      "- platform: linkedin\n  lang: en\n  text: Own angle\n- platform: x\n  lang: en\n  text: Another angle\n",
      [
        { platform: "linkedin", lang: "en", length: "short", text },
        { platform: "x", lang: "en", length: "short", text },
      ]
        .map(
          (row) =>
            `- platform: ${row.platform}\n  lang: ${row.lang}\n  length: ${row.length}\n  text: ${row.text}\n`,
        )
        .join(""),
    );
    const findings = findingsOf(ws);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("bio");
    expect(findings[0]?.surfaces).toEqual(["linkedin", "x"]);
  });

  it("scopes itself to the addressed platform", () => {
    const text = "Shared line";
    const ws = workspace(
      [
        { platform: "linkedin", lang: "en", text },
        { platform: "x", lang: "en", text },
      ]
        .map((row) => `- platform: ${row.platform}\n  lang: ${row.lang}\n  text: ${row.text}\n`)
        .join(""),
    );
    const res = run(["check", "medium", "--json", "--workspace", ws]);
    expect(res.code).toBe(0);
    const data = JSON.parse(res.stdout) as { data: { sameText: SameTextFinding[] } };
    expect(data.data.sameText).toEqual([]);
  });
});
