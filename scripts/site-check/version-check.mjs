#!/usr/bin/env node
/**
 * Release barrier for the project page (#277).
 *
 * The page is published from a released commit, so whatever it claims at that
 * commit becomes the public description of that release. Its `Status` section
 * names the published CLI version by hand — the one fact on the page that can
 * contradict npm. This gate fails the release BEFORE the irreversible publish
 * when the page advertises a version other than `packages/cli/package.json`.
 *
 * Runs in `release.yml` (pre-publish). It is not a general page check: the page
 * gate lives next to it in `scripts/site-check/check.mjs`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** Every published-CLI version the page claims, via `@profile-as-code/cli@X`. */
function claimedVersions(html) {
  return [...html.matchAll(/@profile-as-code\/cli@([0-9]+\.[0-9]+\.[0-9]+[^\s<`)",;]*)/g)].map(
    (match) => match[1],
  );
}

function check(html, version) {
  const claims = [...new Set(claimedVersions(html))];
  if (claims.length === 0) {
    return [
      "the page names no @profile-as-code/cli@<version> claim — add one (or update the barrier)",
    ];
  }
  return claims
    .filter((claim) => claim !== version)
    .map(
      (claim) =>
        `the page advertises @profile-as-code/cli@${claim} but package.json says ${version}`,
    );
}

function selfTest() {
  const failures = [];
  const run = (html, version) => check(html, version);

  if (run("<code>@profile-as-code/cli@0.3.0</code>", "0.3.0").length > 0)
    failures.push("false positive on a matching version");
  if (run("<code>@profile-as-code/cli@0.2.0</code>", "0.3.0").length === 0)
    failures.push("did not catch a stale version");
  if (run("<p>no claim here</p>", "0.3.0").length === 0)
    failures.push("did not catch a missing claim");
  if (failures.length > 0) throw new Error(`self-test failed: ${failures.join("; ")}`);
  console.log("site version-check self-test: PASS");
}

selfTest();

const version = JSON.parse(
  readFileSync(path.join(ROOT, "packages", "cli", "package.json"), "utf8"),
).version;
const html = readFileSync(path.join(ROOT, "site", "index.html"), "utf8");
const errors = check(html, version);
if (errors.length > 0) {
  for (const error of errors) console.error(`E-SITE-VERSION: ${error}`);
  console.error("site version-check: FAIL");
  process.exit(1);
}
console.log(`site version-check: PASS (page advertises @profile-as-code/cli@${version})`);
