#!/usr/bin/env node
/**
 * Consumer schema contract gate — issue #348, SPEC §7.7.
 *
 * A consumer without the `pasco` engine must be able to validate a profile
 * against the contract without installing the CLI. The published identity of
 * that contract is `schema/consumer-contract.json`: the sha256 of the committed
 * `schema/profile.schema.json`, plus the immutable copy at a released git tag
 * (URL + hash). This gate makes the manifest honest OFFLINE — no network, no
 * registry, D19:
 *
 *   E-CONTRACT  the manifest's `sha256`/`schemaVersion` disagree with the
 *               committed schema — an edit that would silently publish a new
 *               contract under the old hash (the CI drift failure);
 *   E-CONTRACT  the released URL is not exactly the public repo's tag-pinned raw
 *               URL — a private repo/path or a floating ref can never ship
 *               (AGENTS.md rule 9);
 *   E-CONTRACT  the released tag is missing/unreachable, or the bytes at the tag
 *               do not hash/version to what the manifest claims — the pinned
 *               artifact moved;
 *   E-CONTRACT  the manifest's shape cannot be verified (unknown schemaPath,
 *               malformed sha256, non-central version).
 *
 * A release pin that is no longer the newest reachable `v*` tag is a WARNING,
 * not a failure: the released artifact stays valid forever (#226 rule 8), and a
 * release is a human act — the release prep updates the pin.
 *
 * Zero dependencies, node >=22, no network. Usage:
 *   node scripts/schema-contract/check.mjs                    # print the contract
 *   node scripts/schema-contract/check.mjs --check            # CI verdict
 *   node scripts/schema-contract/check.mjs --write [--tag vX.Y.Z]  # recompute the manifest
 * Exit: 0 consistent/written · 1 E-CONTRACT refusal.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** The public repository the contract is published from. The ONLY repo a
 *  consumer URL may name — the sibling workspaces that motivated #348 are not
 *  part of a published surface (AGENTS.md rule 9). */
export const PUBLIC_REPO = "ChristianLuciani/profile-as-code";
export const SCHEMA_REL = "schema/profile.schema.json";
export const CONTRACT_REL = "schema/consumer-contract.json";

/** Shape errors mean the gate cannot verify what it was asked to verify. */
export class GateError extends Error {}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The contract version from the schema's own `$id` (one home: the schema). */
export function schemaVersionOf(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new GateError("schema is not valid JSON");
  }
  const id = typeof parsed?.$id === "string" ? parsed.$id : "";
  const match = /^https:\/\/profile-as-code\.dev\/schema\/v(\d+\.\d+)\/profile\.schema\.json$/.exec(
    id,
  );
  if (match === null) {
    throw new GateError(
      `schema $id does not carry the versioned contract identity (got ${JSON.stringify(id)})`,
    );
  }
  return match[1];
}

/** The exact tag-pinned URL the manifest must carry. */
export function releasedUrl(tag) {
  return `https://raw.githubusercontent.com/${PUBLIC_REPO}/${tag}/${SCHEMA_REL}`;
}

const SHA256 = /^[a-f0-9]{64}$/;
const TAG = /^v\d+\.\d+\.\d+$/;
const CONTRACT_VERSION = /^\d+\.\d+$/;

/**
 * Pure verification of the manifest against the bytes it claims to identify.
 *
 * @param {object} input
 * @param {unknown} input.contract          parsed schema/consumer-contract.json
 * @param {string}  input.schema            the committed schema text
 * @param {string}  input.releasedSchema    the schema text at `released.tag`
 * @param {boolean} input.tagReachable      the tag is an ancestor of HEAD
 * @param {string|null} input.newestTag     the newest reachable `v*` tag, if any
 * @returns {{errors: string[], warnings: string[]}}
 */
export function checkContract({ contract, schema, releasedSchema, tagReachable, newestTag }) {
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);

  if (typeof contract !== "object" || contract === null || Array.isArray(contract)) {
    return { errors: ["schema/consumer-contract.json must be a JSON object"], warnings };
  }
  if (contract.schemaPath !== SCHEMA_REL) {
    fail(`schemaPath must be "${SCHEMA_REL}" (got ${JSON.stringify(contract.schemaPath)})`);
  }

  const currentVersion = (() => {
    try {
      return schemaVersionOf(schema);
    } catch (err) {
      fail(`cannot read the committed schema version: ${err.message}`);
      return null;
    }
  })();
  if (currentVersion !== null && !CONTRACT_VERSION.test(String(contract.schemaVersion))) {
    fail(`schemaVersion must be MAJOR.MINOR (got ${JSON.stringify(contract.schemaVersion)})`);
  } else if (currentVersion !== null && contract.schemaVersion !== currentVersion) {
    fail(
      `schemaVersion ${contract.schemaVersion} does not match the committed schema $id (v${currentVersion}) — regenerate the manifest`,
    );
  }
  if (!SHA256.test(String(contract.sha256))) {
    fail(`sha256 must be 64 lowercase hex characters (got ${JSON.stringify(contract.sha256)})`);
  } else if (contract.sha256 !== sha256(schema)) {
    fail(
      `sha256 ${contract.sha256} does not match the committed ${SCHEMA_REL} (${sha256(schema)}) — a schema edit must regenerate the manifest`,
    );
  }

  const released = contract.released;
  if (typeof released !== "object" || released === null || Array.isArray(released)) {
    return { errors: [...errors, "released must be a JSON object"], warnings };
  }
  const tag = typeof released.tag === "string" ? released.tag : "";
  if (!TAG.test(tag)) {
    fail(
      `released.tag must be a published release tag vMAJOR.MINOR.PATCH (got ${JSON.stringify(released.tag)})`,
    );
  } else {
    const expected = releasedUrl(tag);
    if (released.url !== expected) {
      fail(
        `released.url must be exactly ${expected} (got ${JSON.stringify(released.url)}) — tag-pinned, public repo only`,
      );
    }
    if (tagReachable !== true) {
      fail(
        `released.tag ${tag} is not reachable from HEAD — a published contract must come from this history`,
      );
    }
    if (newestTag !== null && newestTag !== undefined && tag !== newestTag) {
      warnings.push(
        `released.tag ${tag} is not the newest reachable tag ${newestTag} — update schema/consumer-contract.json at release prep`,
      );
    }
  }
  if (!SHA256.test(String(released.sha256))) {
    fail(
      `released.sha256 must be 64 lowercase hex characters (got ${JSON.stringify(released.sha256)})`,
    );
  } else if (released.sha256 !== sha256(releasedSchema)) {
    fail(
      `released.sha256 ${released.sha256} does not match ${SCHEMA_REL} at ${tag} (${sha256(releasedSchema)}) — the pinned artifact moved`,
    );
  }
  const releasedVersion = (() => {
    try {
      return schemaVersionOf(releasedSchema);
    } catch (err) {
      fail(`cannot read the schema version at ${tag || "the released tag"}: ${err.message}`);
      return null;
    }
  })();
  if (releasedVersion !== null && !CONTRACT_VERSION.test(String(released.schemaVersion))) {
    fail(
      `released.schemaVersion must be MAJOR.MINOR (got ${JSON.stringify(released.schemaVersion)})`,
    );
  } else if (releasedVersion !== null && released.schemaVersion !== releasedVersion) {
    fail(
      `released.schemaVersion ${released.schemaVersion} does not match the schema $id at ${tag} (v${releasedVersion})`,
    );
  }

  return { errors, warnings };
}

// --- CLI -------------------------------------------------------------------

const CHECK = process.argv.includes("--check");
const WRITE = process.argv.includes("--write");
/** `--tag <tag>`: the release to pin when writing (defaults to the existing pin). */
const TAG_ARG = (() => {
  const index = process.argv.indexOf("--tag");
  return index === -1 ? undefined : process.argv[index + 1];
})();
/** Only run the CLI when this file was executed, not when `test.mjs` imports
 *  its pure functions (the gate body is a module, not a side effect). */
const IS_MAIN =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

function git(args) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: "pipe" });
}

/** Semver-ish ordering for `vMAJOR.MINOR.PATCH` tags (no ICU, numeric). */
function tagOrder(a, b) {
  const parse = (tag) => tag.slice(1).split(".").map(Number);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

function main() {
  const contract = JSON.parse(readFileSync(path.join(ROOT, CONTRACT_REL), "utf8"));
  const schema = readFileSync(path.join(ROOT, SCHEMA_REL), "utf8");
  const tag = typeof contract?.released?.tag === "string" ? contract.released.tag : "";

  let releasedSchema = "";
  let tagExists = false;
  let tagReachable = false;
  try {
    git(["rev-parse", "--verify", `refs/tags/${tag}`]);
    tagExists = true;
    releasedSchema = git(["show", `${tag}:${SCHEMA_REL}`]);
    tagReachable = spawnGit(["merge-base", "--is-ancestor", tag, "HEAD"]);
  } catch {
    // A missing tag is reported below with its name; an existing tag whose
    // bytes moved is caught by checkContract's hash/version comparison.
  }
  let newestTag = null;
  try {
    const tags = git(["tag", "--merged", "HEAD", "--list", "v*"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => TAG.test(line))
      .sort(tagOrder);
    newestTag = tags.at(-1) ?? null;
  } catch {
    newestTag = null;
  }

  const { errors, warnings } = checkContract({
    contract,
    schema,
    releasedSchema: tagReachable ? releasedSchema : "",
    tagReachable,
    newestTag,
  });
  if (!tagExists) errors.unshift(`released.tag ${tag} does not exist in this clone`);

  for (const warning of warnings) console.error(`W-SCHEMA-CONTRACT: ${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`E-SCHEMA-CONTRACT: ${error}`);
    console.error("schema-contract: FAIL");
    return 1;
  }
  console.log(
    `schema-contract: PASS (current v${schemaVersionOf(schema)} sha256 ${sha256(schema)}; released ${contract.released.tag} sha256 ${contract.released.sha256}; no network)`,
  );
  return 0;
}

/** `--write`: recompute the manifest from the committed schema and the tag copy.
 *  The hash is always computed LOCALLY (no network); the tag must already exist
 *  in this clone, so a not-yet-published artifact can never be claimed. */
function writeContract() {
  const contractPath = path.join(ROOT, CONTRACT_REL);
  const existing = JSON.parse(readFileSync(contractPath, "utf8"));
  const tag = TAG_ARG ?? existing?.released?.tag;
  if (typeof tag !== "string" || !TAG.test(tag)) {
    throw new GateError(
      `--write needs a published release tag (vMAJOR.MINOR.PATCH); got ${JSON.stringify(tag)} — pass --tag <tag>`,
    );
  }
  // Throws when the tag is missing: `git show` is the only source of the bytes.
  const releasedSchema = git(["show", `${tag}:${SCHEMA_REL}`]);
  const schema = readFileSync(path.join(ROOT, SCHEMA_REL), "utf8");
  const next = {
    ...(existing.$comment === undefined ? {} : { $comment: existing.$comment }),
    schemaPath: SCHEMA_REL,
    schemaVersion: schemaVersionOf(schema),
    sha256: sha256(schema),
    released: {
      tag,
      url: releasedUrl(tag),
      schemaVersion: schemaVersionOf(releasedSchema),
      sha256: sha256(releasedSchema),
    },
  };
  writeFileSync(contractPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `schema-contract: wrote ${CONTRACT_REL} (current v${next.schemaVersion} sha256 ${next.sha256}; released ${tag} v${next.released.schemaVersion} sha256 ${next.released.sha256})`,
  );
  return 0;
}

/** `execFileSync` throws on a non-zero exit; reachability is a boolean. */
function spawnGit(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

if (IS_MAIN) {
  if (WRITE) {
    try {
      process.exitCode = writeContract();
    } catch (err) {
      console.error(`E-SCHEMA-CONTRACT: ${err.message}`);
      process.exitCode = 1;
    }
  } else if (CHECK) {
    process.exitCode = main();
  } else {
    // Default mode prints the published identity and the verification.
    try {
      const contract = JSON.parse(readFileSync(path.join(ROOT, CONTRACT_REL), "utf8"));
      console.log(`${CONTRACT_REL}:`);
      console.log(`  current  v${contract.schemaVersion}  sha256 ${contract.sha256}`);
      console.log(`  released ${contract.released.tag}  ${contract.released.url}`);
      console.log(
        `           v${contract.released.schemaVersion}  sha256 ${contract.released.sha256}`,
      );
      process.exitCode = main();
    } catch (err) {
      console.error(`E-SCHEMA-CONTRACT: ${err.message}`);
      process.exitCode = 1;
    }
  }
}
