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
 * their canonical Markdown (`scripts/site-docs/docs.mjs`), so the check does not
 * depend on having generated first. A page-level check that read only
 * `index.html` would pass while the projected user guide still advertised the
 * previous version (that is exactly how this gate first shipped — PR #278
 * review, major).
 *
 * The claim has one canonical form: `@profile-as-code/cli@<version>`. A document
 * that states the version any other way is not gated; write it in that form.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DOCS } from "../site-docs/docs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** Every published-CLI version a text claims, via `@profile-as-code/cli@X`. */
function claimedVersions(text) {
  return [...text.matchAll(/@profile-as-code\/cli@([0-9]+\.[0-9]+\.[0-9]+[^\s<`)",;]*)/g)].map(
    (match) => match[1],
  );
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
      claims += 1;
      if (claim !== version) {
        errors.push(
          `${file.label} advertises @profile-as-code/cli@${claim} but package.json says ${version}`,
        );
      }
    }
  }
  if (claims === 0) {
    errors.push(
      "no published surface states @profile-as-code/cli@<version> — add the claim in that form",
    );
  }
  return errors;
}

function selfTest() {
  const failures = [];
  const ok = [{ label: "index", text: "<code>@profile-as-code/cli@0.3.0</code>" }];

  if (check(ok, "0.3.0").length > 0) failures.push("false positive on a matching version");
  if (
    check([{ label: "index", text: "<code>@profile-as-code/cli@0.2.0</code>" }], "0.3.0").length ===
    0
  )
    failures.push("did not catch a stale version");
  if (check([{ label: "index", text: "<p>no claim here</p>" }], "0.3.0").length === 0)
    failures.push("did not catch a missing claim");
  // The regression this gate shipped with: the landing is right, a projected
  // document is stale — it must still fail, and name the document.
  const stale = [
    { label: "site/index.html", text: "@profile-as-code/cli@0.3.0" },
    { label: "docs/USER-GUIDE.md", text: "tracks `pasco` at `@profile-as-code/cli@0.2.0`" },
  ];
  const staleErrors = check(stale, "0.3.0");
  if (staleErrors.length === 0) failures.push("did not catch a stale PROJECTED document");
  if (!staleErrors.some((e) => e.includes("docs/USER-GUIDE.md")))
    failures.push("did not name the stale document");

  if (failures.length > 0) throw new Error(`self-test failed: ${failures.join("; ")}`);
  console.log("site version-check self-test: PASS");
}

selfTest();

const version = JSON.parse(
  readFileSync(path.join(ROOT, "packages", "cli", "package.json"), "utf8"),
).version;

const files = [
  { label: "site/index.html", text: readFileSync(path.join(ROOT, "site", "index.html"), "utf8") },
  ...DOCS.map((doc) => ({
    label: doc.file,
    text: readFileSync(path.join(ROOT, doc.file), "utf8"),
  })),
];

const errors = check(files, version);
if (errors.length > 0) {
  for (const error of errors) console.error(`E-SITE-VERSION: ${error}`);
  console.error("site version-check: FAIL");
  process.exit(1);
}
console.log(
  `site version-check: PASS (${files.length} published surface(s) scanned, claim @profile-as-code/cli@${version})`,
);
