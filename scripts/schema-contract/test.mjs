#!/usr/bin/env node
/**
 * Self-test for the consumer schema contract gate (#348, SPEC §7.7) — the
 * `scripts/gen-packages` idiom: prove the gate REFUSES every failure class it
 * claims to close, and that a consistent manifest passes.
 *
 * Two layers, because the gate has two:
 *   1. the exported PURE `checkContract` (shape, drift, URL, reachability);
 *   2. the real CLI end-to-end (`--check`, `--write`, `--root`) against a
 *      synthesized git repository — including the F3 invariant that `--write`
 *      enforces the SAME reachability as `--check`, so it cannot produce a
 *      manifest the next `--check` refuses.
 *
 * Usage: node scripts/schema-contract/test.mjs
 * Exit:  0 all cases pass · 1 any case fails
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_REL, checkContract, releasedUrl, SCHEMA_REL, sha256 } from "./check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "check.mjs");

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

// --- layer 1: the pure contract -------------------------------------------

function schema(version) {
  return `${JSON.stringify(
    {
      $id: `https://profile-as-code.dev/schema/v${version}/profile.schema.json`,
      title: `profile-as-code — user profile contract (v${version})`,
      type: "object",
      required: ["identity"],
    },
    null,
    2,
  )}\n`;
}

const CURRENT = schema("1.14");
const RELEASED = schema("1.13");

function manifest(overrides = {}) {
  return {
    schemaPath: SCHEMA_REL,
    current: {
      schemaVersion: "1.14",
      sha256: sha256(CURRENT),
      published: false,
      artifact: null,
      note: "No tag carries v1.14; use the repository checkout and verify the sha256.",
    },
    released: {
      tag: "v0.3.6",
      url: releasedUrl("v0.3.6"),
      schemaVersion: "1.13",
      sha256: sha256(RELEASED),
    },
    ...overrides,
  };
}

function runPure(over = {}) {
  return checkContract({
    contract: over.contract ?? manifest(),
    schema: over.schema ?? CURRENT,
    releasedSchema: over.releasedSchema ?? RELEASED,
    tagReachable: over.tagReachable ?? true,
    newestTag: over.newestTag === undefined ? "v0.3.6" : over.newestTag,
  });
}

function refusesPure(name, over, needle) {
  const { errors } = runPure(over);
  check(name, errors.length > 0 && errors.some((e) => e.includes(needle)), errors.join(" | "));
}

{
  const { errors, warnings } = runPure();
  check("consistent manifest passes", errors.length === 0, errors.join(" | "));
  check("no warning for the newest pin", warnings.length === 0, warnings.join(" | "));
}

refusesPure("refuses a current-schema hash drift", { schema: `${CURRENT} ` }, "sha256");
refusesPure(
  "refuses a current-schema version drift",
  { schema: schema("1.15") },
  "does not match the schema $id",
);
refusesPure(
  "refuses a false publication (published:false + artifact)",
  {
    contract: manifest({
      current: { ...manifest().current, artifact: releasedUrl("v0.3.6") },
    }),
  },
  "current.artifact must be null",
);
refusesPure(
  "refuses an unexplained unpublished current block",
  { contract: manifest({ current: { ...manifest().current, note: "" } }) },
  "current.note must state",
);
refusesPure(
  "refuses a published current block with no joinable URL",
  {
    contract: manifest({
      current: { ...manifest().current, published: true, artifact: null },
    }),
  },
  "current.artifact must be a public",
);
refusesPure(
  "refuses a published current block that names a different artifact",
  {
    contract: manifest({
      current: {
        ...manifest().current,
        published: true,
        artifact: releasedUrl("v0.2.0"),
      },
    }),
  },
  "must equal the released URL",
);
refusesPure(
  "refuses a floating released ref",
  {
    contract: manifest({
      released: { ...manifest().released, url: releasedUrl("main") },
    }),
  },
  "tag-pinned, public repo only",
);
refusesPure(
  "refuses a private repo/path in the released URL",
  {
    contract: manifest({
      released: {
        ...manifest().released,
        url: "https://raw.githubusercontent.com/someone/private-workspace/v0.3.6/schema/profile.schema.json",
      },
    }),
  },
  "tag-pinned, public repo only",
);
refusesPure(
  "refuses a non-https released URL",
  {
    contract: manifest({
      released: {
        ...manifest().released,
        url: releasedUrl("v0.3.6").replace("https://", "http://"),
      },
    }),
  },
  "tag-pinned, public repo only",
);
refusesPure("refuses a released hash drift", { releasedSchema: `${RELEASED} ` }, "released.sha256");
refusesPure(
  "refuses a released version drift",
  { releasedSchema: schema("1.12") },
  "does not match the schema $id",
);
refusesPure(
  "refuses a missing tag",
  { tagReachable: false, releasedSchema: "" },
  "not reachable from HEAD",
);
refusesPure(
  "refuses a wrong schemaPath",
  { contract: manifest({ schemaPath: "schema/other.json" }) },
  "schemaPath",
);
refusesPure(
  "refuses a non-hex sha",
  { contract: manifest({ current: { ...manifest().current, sha256: "not-a-hash" } }) },
  "64 lowercase hex",
);
refusesPure(
  "refuses a non-release tag name",
  { contract: manifest({ released: { ...manifest().released, tag: "release-2026" } }) },
  "vMAJOR.MINOR.PATCH",
);

{
  const { errors, warnings } = runPure({ newestTag: "v0.3.7" });
  check("older pin still passes", errors.length === 0, errors.join(" | "));
  check(
    "older pin warns about the newest tag",
    warnings.some((w) => w.includes("v0.3.7")),
    warnings.join(" | "),
  );
}

// --- layer 2: the CLI end-to-end ------------------------------------------

const tempDirs = [];
function tempDir(prefix = "schema-contract-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" });
}

function initRepo() {
  const dir = tempDir();
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "self-test@example.com");
  git(dir, "config", "user.name", "Schema Contract Self-Test");
  git(dir, "config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "schema"), { recursive: true });
  return dir;
}

function writeSchema(dir, version) {
  writeFileSync(join(dir, SCHEMA_REL), schema(version));
}

function commitAll(dir, message) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

function contractPath(dir) {
  return join(dir, CONTRACT_REL);
}

function readContract(dir) {
  return JSON.parse(readFileSync(contractPath(dir), "utf8"));
}

function writeContractJson(dir, value) {
  writeFileSync(contractPath(dir), `${JSON.stringify(value, null, 2)}\n`);
}

function cli(dir, ...args) {
  const res = spawnSync(process.execPath, [CHECK, "--root", dir, ...args], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** A repo with a released v1.13 at tag v0.3.6 and the current v1.14 committed. */
function makeRepo() {
  const dir = initRepo();
  writeSchema(dir, "1.13");
  commitAll(dir, "schema v1.13");
  git(dir, "tag", "v0.3.6");
  writeSchema(dir, "1.14");
  commitAll(dir, "schema v1.14");
  writeContractJson(dir, {}); // the generator fills it from the tag + committed schema
  const written = cli(dir, "--write", "--tag", "v0.3.6");
  return { dir, written };
}

{
  const { dir, written } = makeRepo();
  check("--write succeeds for a reachable tag", written.code === 0, written.stderr);
  const contract = readContract(dir);
  check(
    "--write derives an UNPUBLISHED current block when the tag predates the schema",
    contract.current.published === false &&
      contract.current.artifact === null &&
      contract.current.sha256 === sha256(schema("1.14")),
    JSON.stringify(contract.current),
  );
  const checked = cli(dir, "--check");
  check("--check accepts what --write produced", checked.code === 0, checked.stderr);

  // Drift: a schema edit that did not regenerate the manifest fails.
  writeFileSync(join(dir, SCHEMA_REL), `${schema("1.14")} `);
  check("--check refuses a schema edit without --write", cli(dir, "--check").code === 1);
  writeSchema(dir, "1.14");

  // Missing tag: both modes refuse, and the message names it.
  const missing = readContract(dir);
  missing.released.tag = "v9.9.9";
  missing.released.url = releasedUrl("v9.9.9");
  writeContractJson(dir, missing);
  const missingCheck = cli(dir, "--check");
  check(
    "--check refuses a missing tag",
    missingCheck.code === 1 && missingCheck.stderr.includes("v9.9.9"),
    missingCheck.stderr,
  );
  const missingWrite = cli(dir, "--write", "--tag", "v9.9.9");
  check("--write refuses a missing tag", missingWrite.code === 1, missingWrite.stderr);

  // Existing but UNMERGED tag: --write must enforce the same reachability as
  // --check (fresh review F3), so it cannot write a manifest --check refuses.
  git(dir, "checkout", "-q", "-b", "side");
  writeSchema(dir, "1.15");
  // Stage ONLY the schema: the untracked manifest must survive the checkout back.
  git(dir, "add", SCHEMA_REL);
  git(dir, "commit", "-q", "-m", "side schema v1.15");
  git(dir, "tag", "v0.4.0");
  git(dir, "checkout", "-q", "-");
  const unreachableWrite = cli(dir, "--write", "--tag", "v0.4.0");
  check(
    "--write refuses an existing but unreachable tag",
    unreachableWrite.code === 1 && unreachableWrite.stderr.includes("not reachable from HEAD"),
    unreachableWrite.stderr,
  );
  const unreachable = readContract(dir);
  unreachable.released.tag = "v0.4.0";
  unreachable.released.url = releasedUrl("v0.4.0");
  writeContractJson(dir, unreachable);
  check("--check refuses an existing but unreachable tag", cli(dir, "--check").code === 1);
}

{
  // A tag that carries the CURRENT bytes: --write derives a published block with
  // the tag-pinned URL, and --check accepts it. This is the release-prep path.
  const dir = initRepo();
  writeSchema(dir, "1.14");
  commitAll(dir, "schema v1.14");
  git(dir, "tag", "v0.4.0");
  writeContractJson(dir, {});
  const written = cli(dir, "--write", "--tag", "v0.4.0");
  check(
    "--write succeeds when the tag carries the current bytes",
    written.code === 0,
    written.stderr,
  );
  const contract = readContract(dir);
  check(
    "--write derives a joinable published current block",
    contract.current.published === true && contract.current.artifact === releasedUrl("v0.4.0"),
    JSON.stringify(contract.current),
  );
  check("--check accepts the release-prepared manifest", cli(dir, "--check").code === 0);
}

for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`schema-contract self-test: FAIL (${failures.length})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`schema-contract self-test: PASS (${passed} case(s))`);
