/**
 * `FACT_PRESENT_KEYS` is the single key-set source (#489 review): the runtime
 * `check --json` payload and the USER-GUIDE enumeration both read it, so a key
 * cannot vanish from the docs while the engine keeps emitting it — or be added
 * to the payload without the docs and this test picking it up.
 *
 * Offline: dist CLI + a committed fixture.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FACT_PRESENT_KEYS } from "../src/fact-present.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..");
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(REPO, "packages", "core", "tests", "fixtures", "minimal-kofi");
const USER_GUIDE = readFileSync(join(REPO, "docs", "USER-GUIDE.md"), "utf8");

describe("factPresent key set — one source, gated on both sides (#489 review)", () => {
  it("the runtime check payload carries exactly the key set", () => {
    const res = spawnSync(process.execPath, [CLI, "check", "--json", "--workspace", FIXTURE], {
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(res.status, res.stderr).toBe(0);
    const data = (JSON.parse(res.stdout ?? "") as { data: { factPresent: object } }).data;
    expect(Object.keys(data.factPresent)).toEqual([...FACT_PRESENT_KEYS]);
  });

  it("the USER-GUIDE enumeration is exactly the key set", () => {
    // Parse the parenthesized enumeration itself, not a window of prose: the next
    // sentence names `notBuildable` again, and a window would keep that key green
    // after it was dropped from the list (#499 review).
    const match = /`data\.factPresent`\s*\(([^)]*)\)/.exec(USER_GUIDE);
    expect(match, "the guide must document data.factPresent with its key list").not.toBeNull();
    const enumerated = [...(match?.[1] ?? "").matchAll(/`([a-zA-Z]+)`/g)].map((entry) => entry[1]);
    expect(enumerated).toEqual([...FACT_PRESENT_KEYS]);
  });
});
