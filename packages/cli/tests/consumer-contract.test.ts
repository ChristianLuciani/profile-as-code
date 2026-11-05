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
 *
 * **Hermetic by declaration.** The tag/history rows require the local tag; a
 * fresh or shallow clone without it SKIPS them with the reason in the test name
 * instead of turning the suite red (fresh-review F3 nit). The current-bytes row
 * always runs — it needs only the committed files.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTRACT_HISTORY } from "../src/contract-history.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCHEMA = join(REPO_ROOT, "schema", "profile.schema.json");
const CONTRACT = join(REPO_ROOT, "schema", "consumer-contract.json");

interface Contract {
  schemaPath: string;
  current: {
    schemaVersion: string;
    sha256: string;
    published: boolean;
    artifact: string | null;
    note: string;
  };
  released: { tag: string; url: string; schemaVersion: string; sha256: string };
}

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function schemaVersion(source: string): string {
  const schema = JSON.parse(source) as { $id: string };
  const match = /^https:\/\/profile-as-code\.dev\/schema\/v(\d+\.\d+)\/profile\.schema\.json$/.exec(
    schema.$id,
  );
  if (match === null) throw new Error(`schema $id carries no version: ${schema.$id}`);
  return match[1] as string;
}

function releasedSchema(tag: string): string {
  return execFileSync("git", ["-C", REPO_ROOT, "show", `${tag}:schema/profile.schema.json`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tagAvailable(tag: string): boolean {
  try {
    execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "--verify", `refs/tags/${tag}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const contract = JSON.parse(readFileSync(CONTRACT, "utf8")) as Contract;
const current = readFileSync(SCHEMA, "utf8");
const hasTag = tagAvailable(contract.released.tag);
const tagSkip = hasTag
  ? ""
  : ` [skipped: local tag ${contract.released.tag} is absent — fresh/shallow clone]`;

describe("the consumer schema contract", () => {
  it("names the committed schema by version and hash (drift fails here)", () => {
    expect(contract.schemaPath).toBe("schema/profile.schema.json");
    expect(contract.current.schemaVersion).toBe(schemaVersion(current));
    expect(contract.current.sha256).toBe(sha256(current));
  });

  it("states its publication truth: an unpublished current block has no URL", () => {
    // The manifest is the source of truth for whether a URL exists. The F2 fix
    // was a hash with no artifact while a shipped README promised one; the shape
    // now makes that impossible: `published: false` MUST carry `artifact: null`
    // and a note, and `published: true` MUST carry a public raw URL.
    expect(typeof contract.current.published).toBe("boolean");
    if (contract.current.published === false) {
      expect(contract.current.artifact).toBeNull();
      expect(contract.current.note.trim()).not.toBe("");
    } else {
      expect(contract.current.artifact).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/ChristianLuciani\/profile-as-code\//,
      );
    }
  });

  it("pins a released tag to the public raw URL, not a floating ref", () => {
    expect(contract.released.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(contract.released.url).toBe(
      `https://raw.githubusercontent.com/ChristianLuciani/profile-as-code/${contract.released.tag}/schema/profile.schema.json`,
    );
  });

  it.skipIf(!hasTag)(
    `matches the bytes at the released tag (the immutable artifact)${tagSkip}`,
    () => {
      const released = releasedSchema(contract.released.tag);
      expect(contract.released.sha256).toBe(sha256(released));
      expect(contract.released.schemaVersion).toBe(schemaVersion(released));
    },
  );

  it.skipIf(!hasTag)(`is a published tag reachable from this history${tagSkip}`, () => {
    expect(() =>
      execFileSync(
        "git",
        ["-C", REPO_ROOT, "merge-base", "--is-ancestor", contract.released.tag, "HEAD"],
        { stdio: "ignore" },
      ),
    ).not.toThrow();
  });
});

/**
 * The contract minor history `pasco doctor --contract-delta` reads (#439).
 *
 * The table is a PROJECTION of the schema's own narration — `$id` carries the
 * installed contract, and the `description` narrates every minor it ever added.
 * These rows are what a supervisor session had to reconstruct by hand from the
 * CHANGELOG, the schema and the geo report; pinning them to the narration is
 * what keeps the projection from becoming a second source. A schema bump that
 * forgets a row, a row that invents a minor, and a row that claims a field its
 * own minor never narrated all fail here — in `pnpm test`, not in CI only.
 */
describe("the contract minor history (doctor --contract-delta)", () => {
  const description = (JSON.parse(current) as { description?: string }).description ?? "";
  const MARKER = /(?:New in v(\d+\.\d+))|(?:v(\d+\.\d+):)/g;

  /** Every minor the schema narrates, in the order it narrates them. */
  function narratedMinors(): { version: string; slice: string }[] {
    const found: { version: string; start: number }[] = [];
    for (const match of description.matchAll(MARKER)) {
      found.push({ version: (match[1] ?? match[2]) as string, start: match.index ?? 0 });
    }
    return found.map((entry, index) => ({
      version: entry.version,
      slice: description
        .slice(entry.start, index + 1 < found.length ? found[index + 1]?.start : undefined)
        .trim(),
    }));
  }

  it("pins every narrated minor, in order, and nothing the schema does not narrate", () => {
    const narrated = narratedMinors().map((minor) => minor.version);
    // The narration is the authority on the SET — not this table.
    expect(narrated.length).toBeGreaterThan(0);
    expect(narrated).toEqual(CONTRACT_HISTORY.map((minor) => minor.version));
  });

  it("ends at the version the schema's own $id declares (a bump that forgets a row fails)", () => {
    const installed = schemaVersion(current);
    const last = CONTRACT_HISTORY[CONTRACT_HISTORY.length - 1];
    expect(last?.version).toBe(installed);
    // And a minor that landed without a narration marker would hide here: every
    // row's version must be narrated, which the equality above already pins.
    expect(narratedMinors().some((minor) => minor.version === installed)).toBe(true);
  });

  it("only claims fields its own minor narrated", () => {
    const slices = new Map(narratedMinors().map((minor) => [minor.version, minor.slice]));
    for (const minor of CONTRACT_HISTORY) {
      const slice = slices.get(minor.version);
      expect(slice, minor.version).toBeDefined();
      expect(minor.fields.length, minor.version).toBeGreaterThan(0);
      expect(minor.buys.trim(), minor.version).not.toBe("");
      for (const field of minor.fields) {
        // The leaf segment is what a narration can be expected to spell out
        // (`projects[].artifactRefs` is narrated as "projects[] gains artifactRefs").
        const leaf = field
          .replace(/\[\]$/, "")
          .split(/[.[\]]/)
          .filter(Boolean)
          .pop() as string;
        expect(slice ?? "", `${minor.version}/${field}`).toContain(leaf);
      }
    }
  });
});
