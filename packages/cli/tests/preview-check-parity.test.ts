/**
 * `pasco preview` carries the SAME check report `pasco check` prints (SPEC §7:
 * "the check state is the same report `pasco check` prints" — one builder, two
 * commands). Three times a rule has been dropped by the page's own list of
 * findings: `text/same-across-platforms` (#462), `check/link-platform-icon`
 * (#511) and — found on the third #511 pass — the handle matrix, which never
 * reached the page at all.
 *
 * The assertion is therefore GENERIC: run `pasco check --json` on a workspace
 * that triggers several rules, collect every finding code the report carries,
 * and require each one on the page. A rule added to the builder and forgotten
 * here fails as soon as it produces a finding — no per-rule list to maintain.
 *
 * DECLARED LIMIT (measured, not guessed): this workspace triggers 2 of the 7
 * report arrays (`handleIssues`, `linkIcons`); `registry`, `media`, `limits`,
 * `factPresent` and `sameText` produce nothing here, so their wiring is NOT
 * asserted — a rule dropped from `preview.ts` that also produces no finding
 * would pass this file. Closing that needs one workspace per rule: an expired
 * credential, a broken media file, an over-cap text, a built artifact and a
 * duplicated narrative.
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

interface CheckEnvelope {
  data: {
    handleIssues: { code: string; severity: string }[];
    registry: { code: string }[];
    media: { code: string }[];
    limits: { code: string }[];
    factPresent: { findings: { code: string }[] };
    sameText: { code: string }[];
    linkIcons: { code: string }[];
  };
}

describe("pasco preview — same check report as `pasco check`", () => {
  it("carries every finding code the check report produces", () => {
    const ws = workspace();
    const checked = run(["check", "--json", "--workspace", ws]);
    expect(checked.code).toBe(0);
    const { data } = JSON.parse(checked.stdout) as CheckEnvelope;
    const codes = [
      ...data.handleIssues,
      ...data.registry,
      ...data.media,
      ...data.limits,
      ...(data.factPresent?.findings ?? []),
      ...data.sameText,
      ...data.linkIcons,
    ].map((finding) => finding.code);

    // Two rules minimum, so "nothing to check" cannot pass as parity.
    expect(new Set(codes).size).toBeGreaterThanOrEqual(2);

    const out = mkdtempSync(join(tmpdir(), "pasco-preview-parity-out-"));
    created.push(out);
    expect(run(["preview", "--out", out, "--no-open", "--workspace", ws]).code).toBe(0);
    const page = readFileSync(join(out, "index.html"), "utf8");
    for (const code of new Set(codes)) expect(page, code).toContain(code);
  });
});
