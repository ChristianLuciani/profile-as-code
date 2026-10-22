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
 *   D. the page contains no executable `<script>` — the only allowed one is a
 *      JSON-LD block — and no `@import`;
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
/** The site's own origin: an absolute URL under it is self-hosted, not external. */
import { SITE } from "../site-docs/site-config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SITE_DIR = path.join(ROOT, "site");
const PAGE = path.join(SITE_DIR, "index.html");

/** Every `.html` file under `site/`, relative to it, in a stable order. */
function pages(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pages(full));
    else if (entry.name.endsWith(".html")) out.push(path.relative(SITE_DIR, full));
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
      if (!ref.startsWith(`${SITE.baseUrl}/`)) errors.push(`external asset src: ${ref}`);
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
    // An absolute URL on the site's own origin is the 404's only option (it is
    // served at an arbitrary depth); a third-party asset is still refused.
    if (href && /^https?:\/\//i.test(href) && !href.startsWith(`${SITE.baseUrl}/`)) {
      errors.push(`external asset link: ${href}`);
    }
  }

  // The 404 is served AT the requested URL (Pages renders its content for any
  // missing path), so a relative URL in it resolves against a path that does not
  // exist — the page that exists to catch broken links would ship broken links.
  if (page === "404.html") {
    for (const ref of links) {
      if (ref.startsWith("#")) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;
      errors.push(`404.html is served at an arbitrary depth: relative URL ${ref} will break`);
    }
  }

  if (/@import\b/i.test(html)) errors.push("@import is not allowed");
  if (/url\(\s*['"]?https?:\/\//i.test(html)) errors.push("external url() is not allowed");
  // The page must stay script-free. The ONE allowed script element is a JSON-LD
  // block: it is data, the browser does not execute it, and the generator
  // escapes `<` so a string cannot close the tag early. Anything else — a JS
  // `<script>`, or a JSON-LD one with a `src` — is refused.
  for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) {
    const isJsonLd = /type\s*=\s*"application\/ld\+json"/i.test(attrs);
    const hasSrc = /\ssrc\s*=/i.test(attrs);
    if (!isJsonLd || hasSrc) {
      errors.push("the page must stay script-free (only a JSON-LD <script> is allowed)");
      break;
    }
  }
  // A `<script>` tag is not the only way to run code: the projected Markdown
  // passes raw HTML through (`marked` does not sanitize), so an inline handler
  // would execute without ever writing `<script>` (#277 review R2).
  if (/\son[a-z]+\s*=/i.test(html)) {
    errors.push("the page must stay script-free (inline event handler attribute found)");
  }

  return { errors, ids: ids.size, links: links.length };
}

function selfTest() {
  const broken =
    '<div id="a"></div><div id="a"></div><a href="#missing">x</a>' +
    '<script>alert(1)</script><a href="http://example.com">x</a>' +
    '<link rel="stylesheet" href="https://example.com/x.css">' +
    '<img src="https://example.com/x.png">' +
    '<style>@import url("https://example.com/x.css");</style>' +
    '<div onclick="alert(1)">x</div>';
  const result = check(broken, SITE_DIR);
  const failures = [];
  if (!result.errors.some((e) => e.includes("#missing")))
    failures.push("did not catch a broken anchor");
  if (!result.errors.some((e) => e.includes("script-free")))
    failures.push("did not catch a script tag");
  if (!result.errors.some((e) => e.includes("duplicate id")))
    failures.push("did not catch a duplicate id");
  if (!result.errors.some((e) => e.includes("insecure URL")))
    failures.push("did not catch http://");
  if (!result.errors.some((e) => e.includes("external asset")))
    failures.push("did not catch an external asset");
  if (!result.errors.some((e) => e.includes("@import"))) failures.push("did not catch @import");
  if (!result.errors.some((e) => e.includes("inline event handler")))
    failures.push("did not catch an inline event handler");
  if (failures.length > 0) {
    throw new Error(`self-test failed: ${failures.join("; ")}`);
  }
  const good = '<div id="a"></div><a href="#a">x</a><link rel="stylesheet" href="styles.css">';
  const ok = check(good, SITE_DIR);
  if (ok.errors.length > 0) {
    throw new Error(`self-test false positive: ${ok.errors.join("; ")}`);
  }

  // JSON-LD is allowed (data, not code); a JS script type is not.
  const ld = check('<script type="application/ld+json">{"@type":"TechArticle"}</script>', SITE_DIR);
  if (ld.errors.length > 0)
    throw new Error(`self-test false positive: JSON-LD refused (${ld.errors.join("; ")})`);
  const js = check('<script type="text/javascript">alert(1)</script>', SITE_DIR);
  if (!js.errors.some((e) => e.includes("script-free")))
    throw new Error("self-test: a JS <script> was not caught");
  const ldSrc = check('<script type="application/ld+json" src="x.json"></script>', SITE_DIR);
  if (!ldSrc.errors.some((e) => e.includes("script-free")))
    throw new Error("self-test: a JSON-LD script with src was not caught");

  // The 404 must carry absolute URLs only (it is served at arbitrary depth).
  const rel404 = check('<link rel="stylesheet" href="styles.css">', SITE_DIR, "404.html");
  if (!rel404.errors.some((e) => e.includes("arbitrary depth")))
    throw new Error("self-test: a relative URL in 404.html was not caught");
  const abs404 = check(
    '<link rel="stylesheet" href="https://example.com/x.css">',
    SITE_DIR,
    "404.html",
  );
  if (abs404.errors.some((e) => e.includes("arbitrary depth")))
    throw new Error("self-test false positive: an absolute URL in 404.html was refused");

  // Local paths resolve against the PAGE's directory (#277): a nested page
  // legitimately links `../styles.css` and `./sibling.html`.
  const nested = check(
    '<link rel="stylesheet" href="../styles.css"><a href="./sibling.html">x</a>',
    SITE_DIR,
    "docs/nested.html",
  );
  if (nested.errors.some((e) => e.includes("escapes site/")))
    throw new Error("self-test false positive: a nested page cannot link ../");
  if (!nested.errors.some((e) => e.includes("does not exist")))
    throw new Error("self-test: a nested page's missing local path was not caught");
  console.log("site-check self-test: PASS");
}

selfTest();
if (!existsSync(PAGE)) {
  console.error(`site-check: FAIL — missing ${path.relative(ROOT, PAGE)}`);
  process.exit(1);
}
const files = pages(SITE_DIR);
if (!files.includes("index.html")) {
  console.error("site-check: FAIL — site/index.html is missing");
  process.exit(1);
}

let failed = 0;
let totalIds = 0;
let totalLinks = 0;
for (const file of files) {
  const result = check(readFileSync(path.join(SITE_DIR, file), "utf8"), SITE_DIR, file);
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
