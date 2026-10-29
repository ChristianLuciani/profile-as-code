#!/usr/bin/env node
/**
 * Self-test for the consumer schema contract gate (#348, SPEC §7.7) — the
 * `scripts/gen-packages` idiom: prove the gate REFUSES every failure class it
 * claims to close, and that a consistent manifest passes. A gate whose tests
 * cannot fail with the defect present is not a test.
 *
 * The cases call the exported PURE `checkContract`; no temp git tree is needed
 * because the git facts (tag reachability, newest tag, the bytes at the tag) are
 * inputs, exactly the seam the real CLI fills.
 *
 * Usage: node scripts/schema-contract/test.mjs
 * Exit:  0 all cases pass · 1 any case fails
 */
import { checkContract, releasedUrl, sha256 } from "./check.mjs";

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

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
    schemaPath: "schema/profile.schema.json",
    schemaVersion: "1.14",
    sha256: sha256(CURRENT),
    released: {
      tag: "v0.3.6",
      url: releasedUrl("v0.3.6"),
      schemaVersion: "1.13",
      sha256: sha256(RELEASED),
    },
    ...overrides,
  };
}

function run(over = {}) {
  return checkContract({
    contract: manifest(over.contract),
    schema: over.schema ?? CURRENT,
    releasedSchema: over.releasedSchema ?? RELEASED,
    tagReachable: over.tagReachable ?? true,
    newestTag: over.newestTag === undefined ? "v0.3.6" : over.newestTag,
  });
}

function refuses(name, over, needle) {
  const { errors } = run(over);
  check(name, errors.length > 0 && errors.some((e) => e.includes(needle)), errors.join(" | "));
}

// A consistent contract passes, with no warnings when the pin is the newest tag.
{
  const { errors, warnings } = run();
  check("consistent manifest passes", errors.length === 0, errors.join(" | "));
  check("no warning for the newest pin", warnings.length === 0, warnings.join(" | "));
}

// The current schema drifted without the manifest being regenerated.
refuses("refuses a current-schema hash drift", { schema: schema("1.14") + " " }, "sha256");
refuses(
  "refuses a current-schema version drift",
  { schema: schema("1.15") },
  "does not match the committed schema $id",
);

// The released artifact is the public repo's tag-pinned raw file, always.
refuses(
  "refuses a floating ref",
  { contract: { ...manifest(), released: { ...manifest().released, url: releasedUrl("main") } } },
  "tag-pinned, public repo only",
);
refuses(
  "refuses a private repo/path in the URL",
  {
    contract: {
      ...manifest(),
      released: {
        ...manifest().released,
        url: "https://raw.githubusercontent.com/someone/private-workspace/v0.3.6/schema/profile.schema.json",
      },
    },
  },
  "tag-pinned, public repo only",
);
refuses(
  "refuses a non-https URL",
  {
    contract: {
      ...manifest(),
      released: {
        ...manifest().released,
        url: releasedUrl("v0.3.6").replace("https://", "http://"),
      },
    },
  },
  "tag-pinned, public repo only",
);

// The immutable tag copy must still hash/version to the claim.
refuses(
  "refuses a released hash drift",
  { releasedSchema: schema("1.13") + " " },
  "pinned artifact moved",
);
refuses(
  "refuses a released version drift",
  { releasedSchema: schema("1.12") },
  "does not match the schema $id at v0.3.6",
);
refuses(
  "refuses a missing tag",
  { tagReachable: false, releasedSchema: "" },
  "not reachable from HEAD",
);

// Malformed manifest shapes are configuration failures, never a silent pass.
refuses(
  "refuses a wrong schemaPath",
  { contract: { ...manifest(), schemaPath: "schema/other.json" } },
  "schemaPath",
);
refuses(
  "refuses a non-hex sha",
  { contract: { ...manifest(), sha256: "not-a-hash" } },
  "64 lowercase hex",
);
refuses(
  "refuses a non-release tag name",
  { contract: { ...manifest(), released: { ...manifest().released, tag: "release-2026" } } },
  "vMAJOR.MINOR.PATCH",
);

// A valid older pin is not invalid — it only warns that the release prep should move it.
{
  const { errors, warnings } = run({ newestTag: "v0.3.7" });
  check("older pin still passes", errors.length === 0, errors.join(" | "));
  check(
    "older pin warns about the newest tag",
    warnings.some((w) => w.includes("v0.3.7")),
    warnings.join(" | "),
  );
}

if (failures.length > 0) {
  console.error(`schema-contract self-test: FAIL (${failures.length})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`schema-contract self-test: PASS (${passed} case(s))`);
