/**
 * `pasco preview` carries the SAME check report `pasco check` prints (SPEC §7:
 * "the check state is the same report `pasco check` prints" — one builder, two
 * commands). Twice now a rule was added to the builder and dropped by the page's
 * own list of findings: `text/same-across-platforms` (#462) and
 * `check/link-platform-icon` (#511). The third pass of the #511 review found the
 * oldest instance — the handle-matrix findings never reached the page at all, so
 * a brand workspace with an unlinked handle read `0 warning(s)`.
 *
 * This file pins PARITY, not a rule: every finding the builder produces for a
 * workspace must be visible on the page. It is written per rule because the page
 * takes a flat list; a future rule that forgets the list fails here.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

const created: string[] = [];

/** A brand workspace exercising the handle matrix (claimed, no url) AND a link
 *  platform with no icon — two different rules, one page. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-preview-parity-"));
  created.push(dir);
  cpSync(MINIMAL, dir, { recursive: true });
  // Each `content/<root>.yaml` is ONE root block: `flavor` is a scalar root, the
  // handle matrix is the `socialHandles[]` root (the cite-brand fixture layout).
  writeFileSync(
    join(dir, "content", "identity.yaml"),
    [
      "name: Topia Press",
      "links:",
      "  - platform: myspace",
      "    url: https://myspace.com/topia",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "content", "flavor.yaml"), "brand\n");
  writeFileSync(
    join(dir, "content", "socialHandles.yaml"),
    ["- platform: mastodon", "  handle: topiapress", "  status: claimed", ""].join("\n"),
  );
  return dir;
}

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 20_000 });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe("pasco preview — same check report as `pasco check`", () => {
  it("carries the handle-matrix finding the CLI reports", () => {
    const ws = workspace();
    const checked = run(["check", "--json", "--workspace", ws]);
    expect(checked.code).toBe(0);
    const data = JSON.parse(checked.stdout) as {
      data: { handleIssues: { code: string }[] };
    };
    expect(data.data.handleIssues.length).toBeGreaterThan(0);
    const code = data.data.handleIssues[0]!.code;

    const out = mkdtempSync(join(tmpdir(), "pasco-preview-parity-out-"));
    created.push(out);
    const preview = run(["preview", "--out", out, "--no-open", "--workspace", ws]);
    expect(preview.code).toBe(0);
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain(code);
  });

  it("carries the icon-coverage finding in the same page", () => {
    const ws = workspace();
    const out = mkdtempSync(join(tmpdir(), "pasco-preview-parity-out-"));
    created.push(out);
    expect(run(["preview", "--out", out, "--no-open", "--workspace", ws]).code).toBe(0);
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain("check/link-platform-icon");
  });
});
