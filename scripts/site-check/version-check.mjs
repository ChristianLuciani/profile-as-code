#!/usr/bin/env node
/**
 * Release barrier for the project page (#277).
 *
 * The page is published from a released commit, so whatever it claims at that
 * commit becomes the public description of that release. npm cannot be
 * un-published, so a stale claim has no rollback.
 *
 * Scope is EVERY surface the page publishes, not just the landing: the landing
 * (`site/index.html`) and the documents projected into `site/docs/` — read from
 * their canonical Markdown (`scripts/site-docs/site-config.mjs`), so the check does not
 * depend on having generated first. A page-level check that read only
 * `index.html` would pass while the projected user guide still advertised the
 * previous version (that is exactly how this gate first shipped — PR #278
 * review, major).
 *
 * The claim has one canonical form: `${SITE.claimPackage}@<version>`. A document
 * that states the version any other way is not gated; write it in that form.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DOCS, LANDINGS, SITE } from "../site-docs/site-config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const PKG = SITE.claimPackage;
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every published version a text claims, via `<claimPackage>@X`. */
function claimedVersions(text) {
  const pattern = new RegExp(`${escapeRe(PKG)}@([0-9]+\\.[0-9]+\\.[0-9]+[^\\s<\`)",;]*)`, "g");
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/**
 * `files` is `[{ label, text }]` for every published surface. Returns the list
 * of disagreements; a surface with no claim at all is an error only when NO
 * surface claims (the page must state which version it describes).
 */
function check(files, version) {
  const errors = [];
  let claims = 0;
  for (const file of files) {
    for (const claim of new Set(claimedVersions(file.text))) {
      if (file.claims === false) {
        // A declared claim-free surface (the /es/ mirror, #308): repeating the
        // version here would be a second place to forget on every release.
        errors.push(`${file.label} must not state a version (it is a claim-free mirror)`);
        continue;
      }
      claims += 1;
      if (claim !== version) {
        errors.push(
          `${file.label} advertises ${PKG}@${claim} but ${SITE.versionManifest} says ${version}`,
        );
      }
    }
  }
  for (const file of files) {
    for (const match of file.text.matchAll(/"softwareVersion"\s*:\s*"([^"]+)"/g)) {
      if (file.claims === false) {
        errors.push(`${file.label} must not carry softwareVersion (claim-free mirror)`);
        continue;
      }
      claims += 1;
      if (match[1] !== version) {
        errors.push(
          `${file.label} JSON-LD says softwareVersion ${match[1]}, manifest says ${version}`,
        );
      }
    }
  }
  if (claims === 0) {
    errors.push(`no published surface states ${PKG}@<version> — add the claim in that form`);
  }
  return errors;
}

/**
 * The upgrade route is a published surface too (#440): a workspace born on an
 * older engine must find a section that teaches the path, and the reference
 * manual must name the version it upgrades to — in the canonical claim form
 * `check()` above already validates. Without this, deleting the route leaves the
 * release gate green.
 */
const UPGRADE_ROUTES = [
  { file: "docs/START-HERE.md", heading: /^#{2,4} .*workspace is behind/i, claims: false },
  { file: "docs/USER-GUIDE.md", heading: /^#{2,4} .*older engine/i, claims: true },
];

/** The lines under a heading, down to the next heading of the same or a higher level. */
function upgradeSection(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex(
    (line, index) => index > start && /^#+\s/.test(line) && line.match(/^#+/)[0].length <= level,
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function checkUpgradeRoutes(files, version) {
  const errors = [];
  for (const route of UPGRADE_ROUTES) {
    const file = files.find((candidate) => candidate.label === route.file);
    const section = file ? upgradeSection(file.text, route.heading) : null;
    if (section === null) {
      errors.push(`${route.file} has no upgrade section for an older workspace (#440)`);
      continue;
    }
    if (route.claims && !section.includes(`${PKG}@${version}`)) {
      errors.push(`${route.file}'s upgrade section must state ${PKG}@${version}`);
    }
  }
  return errors;
}

function selfTest() {
  const failures = [];
  const ok = [{ label: "index", text: `<code>${PKG}@0.3.0</code>` }];

  if (check(ok, "0.3.0").length > 0) failures.push("false positive on a matching version");
  if (check([{ label: "index", text: `<code>${PKG}@0.2.0</code>` }], "0.3.0").length === 0)
    failures.push("did not catch a stale version");
  if (check([{ label: "index", text: "<p>no claim here</p>" }], "0.3.0").length === 0)
    failures.push("did not catch a missing claim");
  // The regression this gate shipped with: the landing is right, a projected
  // document is stale — it must still fail, and name the document.
  const badJsonLd = check(
    [
      {
        label: "site/index.html",
        text: `${PKG}@0.3.0 <script>{"softwareVersion":"0.2.0"}</script>`,
      },
    ],
    "0.3.0",
  );
  if (badJsonLd.length === 0) failures.push("did not catch a stale JSON-LD softwareVersion");

  const stale = [
    { label: "site/index.html", text: `${PKG}@0.3.0` },
    { label: "docs/USER-GUIDE.md", text: `tracks \`pasco\` at \`${PKG}@0.2.0\`` },
  ];
  const staleErrors = check(stale, "0.3.0");
  if (staleErrors.length === 0) failures.push("did not catch a stale PROJECTED document");
  if (!staleErrors.some((e) => e.includes("docs/USER-GUIDE.md")))
    failures.push("did not name the stale document");

  const mirrorClaim = check(
    [
      { label: "site/es/index.html", text: `${PKG}@0.3.0`, claims: false },
      { label: "site/index.html", text: `${PKG}@0.3.0`, claims: true },
    ],
    "0.3.0",
  );
  if (mirrorClaim.length === 0)
    failures.push("did not catch a version claim on a claim-free mirror");
  const mirrorJsonLd = check(
    [
      { label: "site/es/index.html", text: `{"softwareVersion":"0.3.0"}`, claims: false },
      { label: "site/index.html", text: `${PKG}@0.3.0`, claims: true },
    ],
    "0.3.0",
  );
  if (mirrorJsonLd.length === 0)
    failures.push("did not catch softwareVersion on a claim-free mirror");

  // The upgrade route (#440): both sections present and the reference names the version.
  const route = (startHere, guide) => [
    { label: "docs/START-HERE.md", text: startHere },
    { label: "docs/USER-GUIDE.md", text: guide },
  ];
  const goodRoutes = route(
    "## Route 4 — my workspace is behind\nsteps",
    `### 8.2.1 Upgrading a workspace born on an older engine\nuses ${PKG}@0.3.0\n### 8.3 next`,
  );
  if (checkUpgradeRoutes(goodRoutes, "0.3.0").length > 0)
    failures.push("false positive on a complete upgrade route");
  const noSection = route("# nothing", `### 8.2.1 Upgrading one\nuses ${PKG}@0.3.0`);
  if (!checkUpgradeRoutes(noSection, "0.3.0").some((e) => e.includes("START-HERE")))
    failures.push("did not catch a missing upgrade section");
  const noClaim = route("## Route 4 — my workspace is behind", "### 8.2.1 older engine");
  if (!checkUpgradeRoutes(noClaim, "0.3.0").some((e) => e.includes("must state")))
    failures.push("did not catch an upgrade section without the version");

  if (failures.length > 0) throw new Error(`self-test failed: ${failures.join("; ")}`);
  console.log("site version-check self-test: PASS");
}

selfTest();

const version = JSON.parse(readFileSync(path.join(ROOT, SITE.versionManifest), "utf8")).version;

const files = [
  ...LANDINGS.map((landing) => ({
    label: landing.file,
    text: readFileSync(path.join(ROOT, landing.file), "utf8"),
    claims: landing.claims,
  })),
  ...DOCS.map((doc) => ({
    label: doc.file,
    text: readFileSync(path.join(ROOT, doc.file), "utf8"),
  })),
];

const errors = [...check(files, version), ...checkUpgradeRoutes(files, version)];
if (errors.length > 0) {
  for (const error of errors) console.error(`E-SITE-VERSION: ${error}`);
  console.error("site version-check: FAIL");
  process.exit(1);
}
console.log(
  `site version-check: PASS (${files.length} published surface(s) scanned, claim ${PKG}@${version})`,
);
