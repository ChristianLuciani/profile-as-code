#!/usr/bin/env node
/**
 * Project-page gate (#201).
 *
 * `site/index.html` sits outside the Markdown link corpus, so the docs link
 * gate (`scripts/link-check`) cannot see its local links or in-page anchors.
 * This gate keeps the static page honest with zero dependencies and no
 * network access:
 *
 *   A. every `id` is unique;
 *   B. every `href="#id"` resolves to an id on the page;
 *   C. every local `href`/`src` resolves to a file under `site/`;
 *   D. the page contains no `<script>` (it must stay script-free);
 *   E. no `http://` URL is used (https only).
 *
 * The self-test runs first and proves the gate refuses a broken anchor and a
 * script tag, so a green run is a signal, not a coincidence.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SITE = path.join(ROOT, "site");
const PAGE = path.join(SITE, "index.html");

function uniq(values) {
  return [...new Set(values)];
}

function check(html, siteDir) {
  const errors = [];
  const ids = new Set();
  const idRe = /\sid\s*=\s*"([^"]+)"/g;
  for (const match of html.matchAll(idRe)) {
    const id = match[1];
    if (ids.has(id)) errors.push(`duplicate id #${id}`);
    ids.add(id);
  }

  const links = [];
  const refRe = /\s(?:href|src)\s*=\s*"([^"]+)"/g;
  for (const match of html.matchAll(refRe)) {
    const ref = match[1];
    links.push(ref);

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
    const target = path.resolve(siteDir, clean);
    const rel = path.relative(siteDir, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      errors.push(`local path escapes site/: ${ref}`);
      continue;
    }
    if (!existsSync(target)) errors.push(`local path does not exist: ${ref}`);
  }

  if (/<script\b/i.test(html)) errors.push("the page must stay script-free (<script> found)");

  return { errors, ids: ids.size, links: links.length };
}

function selfTest() {
  const broken =
    '<div id="a"></div><div id="a"></div><a href="#missing">x</a>' +
    '<script>alert(1)</script><a href="http://example.com">x</a>';
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
  if (failures.length > 0) {
    throw new Error(`self-test failed: ${failures.join("; ")}`);
  }
  const good = '<div id="a"></div><a href="#a">x</a><link href="styles.css">';
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
const { errors, ids, links } = check(readFileSync(PAGE, "utf8"), SITE);
if (errors.length > 0) {
  for (const error of errors) console.error(`E-SITE: ${error}`);
  console.error(`site-check: FAIL (${uniq(errors).length} error(s))`);
  process.exit(1);
}
console.log(`site-check: PASS (${ids} ids, ${links} links)`);
