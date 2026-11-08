/**
 * `pasco check` — `check/link-platform-icon`, icon coverage of the identity
 * links (#511).
 *
 * The failure it exists for: a platform entered `identity.links[]` and the badge
 * silently did not render, because the surface's badge table did not know it —
 * and nothing said so. Icon metadata now has ONE home (the registry row, projected
 * as `PLATFORM_ICONS`), so the gap is named instead of mute. It is a WARN: the
 * link still renders as text, so a missing badge never fails the command.
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

function workspace(links: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-check-icons-"));
  created.push(dir);
  cpSync(MINIMAL, dir, { recursive: true });
  writeFileSync(join(dir, "content", "identity.yaml"), `name: Elena Vasquez\nlinks:\n${links}`);
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

interface LinkIconFinding {
  code: string;
  severity: string;
  message: string;
  path: string;
}

function findingsOf(ws: string): LinkIconFinding[] {
  const res = run(["check", "--json", "--workspace", ws]);
  expect(res.code).toBe(0); // presentation gap: warn, never fail
  const data = JSON.parse(res.stdout) as { data: { linkIcons: LinkIconFinding[] } };
  return data.data.linkIcons;
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe("pasco check — check/link-platform-icon (#511)", () => {
  it("names a link platform the registry has no icon for", () => {
    const ws = workspace("  - platform: myspace\n    url: https://myspace.com/elena\n");
    const findings = findingsOf(ws);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("check/link-platform-icon");
    expect(findings[0]?.severity).toBe("warn");
    expect(findings[0]?.message).toContain('"myspace"');
    expect(findings[0]?.path).toBe("identity.links[0].platform");

    const human = run(["check", "--workspace", ws]);
    expect(human.stdout).toContain("link icons (identity.links, #511)");
    expect(human.stdout).toContain("[check/link-platform-icon]");
  });

  it("stays quiet for the platforms the registry declares", () => {
    const ws = workspace(
      [
        "  - platform: github\n    url: https://github.com/elena",
        "  - platform: orcid\n    url: https://orcid.org/0000-0001-2345-6789",
        "  - platform: website\n    url: https://elena.example.com",
        "",
      ].join("\n"),
    );
    expect(findingsOf(ws)).toEqual([]);
    expect(run(["check", "--workspace", ws]).stdout).toContain(
      "check/link-platform-icon: OK (every declared link platform has icon metadata)",
    );
  });
});
