#!/usr/bin/env node
/**
 * Project-page gate (#201).
 *
 * The page's HTML sits outside the Markdown link corpus, so the docs link gate
 * (`scripts/link-check`) cannot see its local links or in-page anchors. This
 * gate keeps every page under `site/` honest with zero dependencies and no
 * network access — including the documentation pages projected into
 * `site/docs/` by `scripts/site-docs/gen.mjs` (#277):
 *
 *   A. every `id` is unique;
 *   B. every `href="#id"` resolves to an id on the page;
 *   C. every local `href`/`src` resolves to a file under `site/`;
 *   D. the page contains no `<script>` and no `@import`;
 *   E. no `http://` URL and no external asset (`src`, stylesheet/icon/preload
 *      links, or `url(...)`), because the page must stay self-contained.
 *
 * The self-test runs first and proves the gate refuses a broken anchor, a
 * script tag, a duplicate id, an insecure URL, an external asset and
 * `@import`, so a green run is a signal, not a coincidence.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SITE = path.join(ROOT, "site");
const PAGE = path.join(SITE, "index.html");

/** Every `.html` file under `site/`, relative to it, in a stable order. */
function pages(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pages(full));
    else if (entry.name.endsWith(".html")) out.push(path.relative(SITE, full));
  }
  return out;
}

function uniq(values) {
  return [...new Set(values)];
}

function check(html, siteDir, page = "index.html") {
  // Local paths resolve against the PAGE's directory, not the site root: a page
  // under site/docs/ links to ../styles.css and ./spec.html.
  const pageDir = path.dirname(path.join(siteDir, page));
  const errors = [];
  const ids = new Set();
  const idRe = /\sid\s*=\s*"([^"]+)"/g;
  for (const match of html.matchAll(idRe)) {
    const id = match[1];
    if (ids.has(id)) errors.push(`duplicate id #${id}`);
    ids.add(id);
  }

  const links = [];
  const refRe = /\s(href|src)\s*=\s*"([^"]+)"/g;
  for (const match of html.matchAll(refRe)) {
    const [, attr, ref] = match;
    links.push(ref);

    if (attr === "src" && /^https?:\/\//i.test(ref)) {
      errors.push(`external asset src: ${ref}`);
      continue;
    }
    if (ref.startsWith("#")) {
      const id = ref.slice(1);
      if (!ids.has(id)) errors.push(`in-page anchor does not resolve: ${ref}`);
      continue;
    }
    if (/^https?:\/\//i.test(ref)) {
      if (ref.startsWith("http://")) errors.push(`insecure URL: ${ref}`);
      continue;
    }
    if (/^(?:mailto:|data:|tel:)/i.test(ref)) continue;

    const clean = ref.split(/[?#]/, 1)[0];
    if (clean === "") continue;
    const target = path.resolve(pageDir, clean);
    const rel = path.relative(siteDir, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      errors.push(`local path escapes site/: ${ref}`);
      continue;
    }
    if (!existsSync(target)) errors.push(`local path does not exist: ${ref}`);
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/rel\s*=\s*"(?:stylesheet|icon|preload|prefetch)"/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*"([^"]+)"/i)?.[1];
    if (href && /^https?:\/\//i.test(href)) errors.push(`external asset link: ${href}`);
  }

  if (/@import\b/i.test(html)) errors.push("@import is not allowed");
  if (/url\(\s*['"]?https?:\/\//i.test(html)) errors.push("external url() is not allowed");
  if (/<script\b/i.test(html)) errors.push("the page must stay script-free (<script> found)");

  return { errors, ids: ids.size, links: links.length };
}

function selfTest() {
  const broken =
    '<div id="a"></div><div id="a"></div><a href="#missing">x</a>' +
    '<script>alert(1)</script><a href="http://example.com">x</a>' +
    '<link rel="stylesheet" href="https://example.com/x.css">' +
    '<img src="https://example.com/x.png">' +
    '<style>@import url("https://example.com/x.css");</style>';
  const result = check(broken, SITE);
  const failures = [];
  if (!result.errors.some((e) => e.includes("#missing")))
    failures.push("did not catch a broken anchor");
  if (!result.errors.some((e) => e.includes("<script>")))
    failures.push("did not catch a script tag");
  if (!result.errors.some((e) => e.includes("duplicate id")))
    failures.push("did not catch a duplicate id");
  if (!result.errors.some((e) => e.includes("insecure URL")))
    failures.push("did not catch http://");
  if (!result.errors.some((e) => e.includes("external asset")))
    failures.push("did not catch an external asset");
  if (!result.errors.some((e) => e.includes("@import"))) failures.push("did not catch @import");
  if (failures.length > 0) {
    throw new Error(`self-test failed: ${failures.join("; ")}`);
  }
  const good = '<div id="a"></div><a href="#a">x</a><link rel="stylesheet" href="styles.css">';
  const ok = check(good, SITE);
  if (ok.errors.length > 0) {
    throw new Error(`self-test false positive: ${ok.errors.join("; ")}`);
  }
  console.log("site-check self-test: PASS");
}

selfTest();
if (!existsSync(PAGE)) {
  console.error(`site-check: FAIL — missing ${path.relative(ROOT, PAGE)}`);
  process.exit(1);
}
const files = pages(SITE);
if (!files.includes("index.html")) {
  console.error("site-check: FAIL — site/index.html is missing");
  process.exit(1);
}

let failed = 0;
let totalIds = 0;
let totalLinks = 0;
for (const file of files) {
  const result = check(readFileSync(path.join(SITE, file), "utf8"), SITE, file);
  totalIds += result.ids;
  totalLinks += result.links;
  if (result.errors.length === 0) continue;
  failed += 1;
  for (const error of uniq(result.errors)) console.error(`E-SITE ${file}: ${error}`);
}
if (failed > 0) {
  console.error(`site-check: FAIL (${failed} of ${files.length} page(s))`);
  process.exit(1);
}
console.log(`site-check: PASS (${files.length} page(s), ${totalIds} ids, ${totalLinks} links)`);
