/**
 * The published schema contract for consumers without the engine (#348, SPEC
 * §7.7).
 *
 * A consumer validates a profile against `schema/profile.schema.json` at a
 * released tag, identified by URL + sha256. This test pins the manifest to the
 * bytes it claims to identify, so `pnpm test` fails on a schema edit that did
 * not regenerate `schema/consumer-contract.json` — the same drift the CI gate
 * (`node scripts/schema-contract/check.mjs --check`) refuses, checked here so a
 * local test run catches it too. No network: the released copy is read from the
 * local git tag, and any network fetch is the CONSUMER's act.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCHEMA = join(REPO_ROOT, "schema", "profile.schema.json");
const CONTRACT = join(REPO_ROOT, "schema", "consumer-contract.json");

interface Contract {
  schemaPath: string;
  schemaVersion: string;
  sha256: string;
  released: { tag: string; url: string; schemaVersion: string; sha256: string };
}

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function schemaVersion(source: string): string {
  const schema = JSON.parse(source) as { $id: string };
  const match = /\/v(\d+\.\d+)\/profile\.schema\.json$/.exec(schema.$id);
  if (match === null) throw new Error(`schema $id carries no version: ${schema.$id}`);
  return match[1] as string;
}

function releasedSchema(tag: string): string {
  return execFileSync("git", ["-C", REPO_ROOT, "show", `${tag}:schema/profile.schema.json`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const contract = JSON.parse(readFileSync(CONTRACT, "utf8")) as Contract;
const current = readFileSync(SCHEMA, "utf8");

describe("the consumer schema contract", () => {
  it("names the committed schema by version and hash (drift fails here)", () => {
    expect(contract.schemaPath).toBe("schema/profile.schema.json");
    expect(contract.schemaVersion).toBe(schemaVersion(current));
    expect(contract.sha256).toBe(sha256(current));
  });

  it("pins a released tag to the public raw URL, not a floating ref", () => {
    expect(contract.released.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(contract.released.url).toBe(
      `https://raw.githubusercontent.com/ChristianLuciani/profile-as-code/${contract.released.tag}/schema/profile.schema.json`,
    );
  });

  it("matches the bytes at the released tag (the immutable artifact)", () => {
    const released = releasedSchema(contract.released.tag);
    expect(contract.released.sha256).toBe(sha256(released));
    expect(contract.released.schemaVersion).toBe(schemaVersion(released));
  });

  it("is a published tag reachable from this history", () => {
    expect(() =>
      execFileSync(
        "git",
        ["-C", REPO_ROOT, "merge-base", "--is-ancestor", contract.released.tag, "HEAD"],
        { stdio: "ignore" },
      ),
    ).not.toThrow();
  });
});
