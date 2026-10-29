#!/usr/bin/env node
import { realpathSync } from "node:fs";
/**
 * spec-drefs — the decision register has ONE extent: the `| D<n> |` rows of
 * `docs/SPEC.md` §5 (#326, follow-up of #315).
 *
 * The prose that names the register typed its extent (`decisions D1–D18`) while
 * the register already held D19–D22: a number that only a hand sweep kept
 * honest, and the sweep itself stopped matching (STANDARDS row 7). #315 removed
 * the range from the reader-facing surfaces and pointed them at §5, but two
 * surfaces (an internal build prompt, the feature-request template) and the
 * mechanical check were left out. This gate closes the class:
 *
 *   E-GATE  a `D<n>` cited anywhere in scope does not resolve to a §5 row —
 *           a decision number whose definition a reader cannot open;
 *   E-GATE  a surface types the register's EXTENT as a range (`D1–D18`,
 *           `D1-D18`, `D1..D18`, `D1 through D18`, `D 1 - D 18`) instead of
 *           pointing at §5 — the drift class itself;
 *   E-GATE  `docs/SPEC.md` §5 defines the same `D<n>` twice — a duplicated row
 *           would let one of the two definitions ship silently;
 *   E-GATE  `scripts/spec-drefs/allowlist.json` is malformed, or declares a
 *           pending reference outside the scanned scope;
 *   W-ALLOWLIST-UNUSED  a pending entry nothing references;
 *   W-ALLOWLIST-STALE   a pending entry whose decision now HAS a §5 row.
 *           Both warnings are non-fatal: the registry cannot rot silently, and
 *           the gate never fails for a debt it already declared.
 *
 * The scope is every reader-facing prose surface that cites the register:
 * README, CONTRIBUTING, GOVERNANCE, AGENTS; every `docs/**`, `skills/**` and
 * `templates/**` Markdown file (the register itself included); the skills' YAML
 * catalogs (`checks.yaml`/`posting.yaml` — `pasco check` echoes a row's `note`
 * to the user, so its decision cites are reader-facing too); every package
 * `README.md`; `schema/README.md`; the platform registry's comments; and the
 * PR + issue templates.
 *
 * The exclusions are declared BY CLASS, never left implicit:
 *   - `CHANGELOG.md` — a dated historical record (rule 8 leaves it alone);
 *   - hidden trees (gitignored session artifacts) — same historical class; they
 *     are never versioned, so a local copy must not fail the gate (#274);
 *   - `site/**` — generated projection of these files, never a second copy;
 *   - `.github/workflows/**` — CI annotations and step labels, code-reviewed;
 *   - source code and machine data (`*.ts`, `*.js`/`*.mjs`, `*.json` — including
 *     `schema/profile.schema.json` and the package manifests — plus `DCO`,
 *     `.editorconfig`, `*.cff`) — annotations for code consumers, not documents;
 *   - hidden trees and `node_modules`.
 *
 * `allowlist.json` is the ONE declared exception channel, the same shape as
 * `scripts/link-check/allowlist.json`: an entry names the ref, the file, the
 * reason and the REMOVAL TRIGGER. It exists for a decision the register itself
 * declares ratified-but-pending (`D23`, #262, whose §5 row the register's own
 * prose says is pending): a required check cannot be red on `main` for a debt
 * that already has an owner, but the debt stays visible and its row's arrival
 * turns the entry into a warning. Every other unresolved ref fails.
 *
 * The EXTENT signal is the range, the form #315 swept and the issue names. A
 * numeric count stated as a dated reading ("the census returned N rows") is a
 * record of one run (rule 8), not a typed extent, so it is not flagged — the
 * gate asserts the citation form, not every numeral that happens to be true.
 *
 * Zero dependencies, node >=22 — like `scripts/gen-packages`. Deterministic,
 * offline, no install: it reads text only. Exit: 0 in sync · 1 E-GATE refusal.
 *
 * Usage:  node scripts/spec-drefs/check.mjs [--root DIR] [--check]
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
class GateError extends Error {}

const SPEC_REL = "docs/SPEC.md";
const ALLOWLIST_REL = "scripts/spec-drefs/allowlist.json";
const ROOT_SURFACES = ["README.md", "CONTRIBUTING.md", "GOVERNANCE.md", "AGENTS.md"];
const PR_TEMPLATE_REL = ".github/pull_request_template.md";
const ISSUE_TEMPLATE_REL = ".github/ISSUE_TEMPLATE";
const SKILLS_DIR = "skills";
const TEMPLATES_DIR = "templates";
const PACKAGES_DIR = "packages";
const SCHEMA_README_REL = "schema/README.md";
const PLATFORM_REGISTRY_REL = "platforms/registry.yaml";

const isMarkdown = (name) => name.endsWith(".md");
const isSkillSource = (name) => isMarkdown(name) || /\.ya?ml$/.test(name);

const SECTION_5 = /^##\s+5\.\s+Decisions\b/;
const HEADING = /^##\s+/;
const REGISTER_ROW = /^\|\s*(D\d+)\s*\|/;
const DREF = /\bD(\d+)\b/g;
/**
 * The register's EXTENT, in every form prose has used for it: dash (en/em/ASCII,
 * one or two hyphens), ellipsis (two dots or `…`), and the word `through`. The
 * spaces are tolerated because "D 1 - D 2" is the same claim as "D1–D2"; the
 * digits stay anchored to a `D`, so ordinary prose cannot match.
 */
const RANGE = /\bD\s*\d+\s*(?:[–—]|--|-|\.{2,}|…|through)\s*D\s*\d+\b/gi;

const normalize = (value) => value.split(path.sep).join("/");

/** Code-unit order, matching `link-check`/`gen-packages` (never ICU collation). */
const byCodeUnit = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The `| D<n> |` rows of `docs/SPEC.md` §5, with the line that defines each. */
export function parseRegister(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => SECTION_5.test(line));
  if (start === -1) {
    throw new GateError(`${SPEC_REL}: missing the "## 5. Decisions" section`);
  }
  const rows = new Map();
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i])) break;
    const match = lines[i].match(REGISTER_ROW);
    if (!match) continue;
    const previous = rows.get(match[1]);
    if (previous !== undefined) {
      throw new GateError(
        `${SPEC_REL}: §5 defines ${match[1]} twice (lines ${previous} and ${i + 1}) — the register has one row per decision`,
      );
    }
    rows.set(match[1], i + 1);
  }
  if (rows.size === 0) {
    throw new GateError(`${SPEC_REL} §5 lists no \`| D<n> |\` row`);
  }
  return rows;
}

/** Files under `directory` that `accept` names, deterministic order, hidden skipped. */
async function walkFiles(root, directory, accept) {
  const found = [];
  async function visit(relative) {
    let entries;
    try {
      entries = await readdir(path.join(root, relative), { withFileTypes: true });
    } catch (error) {
      throw new GateError(`cannot read ${relative}/: ${error.message}`);
    }
    entries.sort(byCodeUnit);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && accept(entry.name)) found.push(child);
    }
  }
  await visit(directory);
  return found;
}

/** The issue-template files (all of them: a new form is in scope by existing). */
async function issueTemplates(root) {
  let entries;
  try {
    entries = await readdir(path.join(root, ISSUE_TEMPLATE_REL), { withFileTypes: true });
  } catch (error) {
    throw new GateError(`cannot read ${ISSUE_TEMPLATE_REL}/: ${error.message}`);
  }
  return entries
    .filter((entry) => entry.isFile() && /\.(md|ya?ml)$/.test(entry.name))
    .map((entry) => `${ISSUE_TEMPLATE_REL}/${entry.name}`)
    .sort();
}

/** Does this repo-relative path name a regular file? (`ENOENT` = simply absent.) */
async function isFile(root, relative) {
  try {
    return (await stat(path.join(root, relative))).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw new GateError(`cannot stat ${relative}: ${error.message}`);
  }
}

/** The READMEs a reader opens: top-level packages and every renderer adapter. */
async function packageReadmes(root) {
  const found = [];
  let entries;
  try {
    entries = await readdir(path.join(root, PACKAGES_DIR), { withFileTypes: true });
  } catch (error) {
    throw new GateError(`cannot read ${PACKAGES_DIR}/: ${error.message}`);
  }
  entries.sort(byCodeUnit);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relative = `${PACKAGES_DIR}/${entry.name}/README.md`;
    if (await isFile(root, relative)) found.push(relative);
    if (entry.name !== "renderers") continue;
    let renderers;
    try {
      renderers = await readdir(path.join(root, PACKAGES_DIR, "renderers"), {
        withFileTypes: true,
      });
    } catch (error) {
      throw new GateError(`cannot read ${PACKAGES_DIR}/renderers/: ${error.message}`);
    }
    renderers.sort(byCodeUnit);
    for (const renderer of renderers) {
      if (!renderer.isDirectory()) continue;
      const adapter = `${PACKAGES_DIR}/renderers/${renderer.name}/README.md`;
      if (await isFile(root, adapter)) found.push(adapter);
    }
  }
  return found;
}

/** The scoped surfaces, each read once. */
export async function collectSurfaces(root) {
  const docs = await walkFiles(root, "docs", isMarkdown);
  const skills = await walkFiles(root, SKILLS_DIR, isSkillSource);
  const templates = await walkFiles(root, TEMPLATES_DIR, isMarkdown);
  const packages = await packageReadmes(root);
  const files = [
    ...ROOT_SURFACES,
    PR_TEMPLATE_REL,
    ...docs,
    ...skills,
    ...templates,
    ...packages,
    SCHEMA_README_REL,
    PLATFORM_REGISTRY_REL,
    ...(await issueTemplates(root)),
  ];
  const surfaces = [];
  for (const file of files) {
    try {
      surfaces.push({ file, source: await readFile(path.join(root, file), "utf8") });
    } catch (error) {
      throw new GateError(`cannot read ${file}: ${error.message}`);
    }
  }
  return surfaces;
}

/** The declared pending references, or an `E-GATE` reason. */
export async function loadAllowlist(root) {
  let raw;
  try {
    raw = await readFile(path.join(root, ALLOWLIST_REL), "utf8");
  } catch (error) {
    throw new GateError(`cannot read ${ALLOWLIST_REL}: ${error.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new GateError(`${ALLOWLIST_REL} is not valid JSON: ${error.message}`);
  }
  const entries = data?.pendingReferences;
  if (!Array.isArray(entries)) {
    throw new GateError(`${ALLOWLIST_REL}: \`pendingReferences\` must be an array`);
  }
  const seen = new Set();
  return entries.map((entry, index) => {
    const where = `${ALLOWLIST_REL}: pendingReferences[${index}]`;
    if (typeof entry?.ref !== "string" || !/^D\d+$/.test(entry.ref)) {
      throw new GateError(`${where}: \`ref\` must be a \`D<n>\` string`);
    }
    if (typeof entry?.path !== "string" || entry.path.length === 0) {
      throw new GateError(`${where}: \`path\` must be a non-empty repo-relative path`);
    }
    if (path.isAbsolute(entry.path) || normalize(entry.path).startsWith("../")) {
      throw new GateError(`${where}: \`path\` must stay inside the repo`);
    }
    if (typeof entry?.reason !== "string" || entry.reason.trim().length === 0) {
      throw new GateError(`${where}: \`reason\` is required — why is the row pending?`);
    }
    if (typeof entry?.removalTrigger !== "string" || entry.removalTrigger.trim().length === 0) {
      throw new GateError(`${where}: \`removalTrigger\` is required — what removes the entry?`);
    }
    const key = `${entry.ref}\u0000${normalize(entry.path)}`;
    if (seen.has(key)) {
      throw new GateError(`${where}: duplicate entry for ${entry.ref} in ${normalize(entry.path)}`);
    }
    seen.add(key);
    return {
      ref: entry.ref,
      path: normalize(entry.path),
      reason: entry.reason,
      removalTrigger: entry.removalTrigger,
    };
  });
}

/**
 * The census over one snapshot. Pure: the CLI feeds it reads.
 *
 * `surfaces` is `[{ file, source }]`, `register` is parseRegister's Map, and
 * `pending` is loadAllowlist's list.
 */
export function census(surfaces, register, pending) {
  const references = [];
  const dangling = [];
  const extents = [];
  const allowed = pending.filter((entry) =>
    surfaces.some((surface) => surface.file === entry.path),
  );
  const cites = (surface, ref) =>
    surface.source.split(/\r?\n/).some((raw) => {
      // A register row's first cell is the DEFINITION, not a citation.
      const line = surface.file === SPEC_REL ? raw.replace(REGISTER_ROW, "|") : raw;
      return [...line.matchAll(DREF)].some((match) => `D${match[1]}` === ref);
    });
  const unused = allowed.filter(
    (entry) =>
      !surfaces.some((surface) => surface.file === entry.path && cites(surface, entry.ref)),
  );
  const stale = pending.filter((entry) => register.has(entry.ref));

  for (const { file, source } of surfaces) {
    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      // The register row's own label is the DEFINITION, not a citation: drop the
      // first cell so the census counts references, not the rows they resolve to.
      const line = file === SPEC_REL ? lines[i].replace(REGISTER_ROW, "|") : lines[i];
      const lineNumber = i + 1;
      for (const match of line.matchAll(RANGE)) {
        extents.push({ file, line: lineNumber, extent: match[0] });
      }
      for (const match of line.matchAll(DREF)) {
        const ref = `D${match[1]}`;
        references.push({ file, line: lineNumber, ref });
        if (register.has(ref)) continue;
        const declared = pending.some((entry) => entry.ref === ref && entry.path === file);
        if (!declared) dangling.push({ file, line: lineNumber, ref });
      }
    }
  }

  const outOfScope = pending.filter(
    (entry) => !surfaces.some((surface) => surface.file === entry.path),
  );
  if (outOfScope.length > 0) {
    throw new GateError(
      `${ALLOWLIST_REL}: ${outOfScope.length} entr(y/ies) name a path outside the scanned scope: ${outOfScope
        .map((entry) => `${entry.ref} in ${entry.path}`)
        .join(", ")}`,
    );
  }

  return { references, dangling, extents, allowed, unused, stale, defined: register };
}

/** The gate's verdict: the first failure class, as an `E-GATE` reason. */
export function verdict(model) {
  if (model.dangling.length > 0) {
    const detail = model.dangling
      .map((entry) => `  ${entry.file}:${entry.line} → ${entry.ref}`)
      .join("\n");
    throw new GateError(
      `${model.dangling.length} reference(s) do not resolve to a \`| D<n> |\` row in ${SPEC_REL} §5:\n${detail}`,
    );
  }
  if (model.extents.length > 0) {
    const detail = model.extents
      .map((entry) => `  ${entry.file}:${entry.line} → ${entry.extent}`)
      .join("\n");
    throw new GateError(
      `${model.extents.length} surface range(s) re-type the register extent — cite ${SPEC_REL} §5 instead:\n${detail}`,
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const rootIndex = argv.indexOf("--root");
  const root =
    rootIndex === -1
      ? fileURLToPath(new URL("../../", import.meta.url))
      : path.resolve(argv[rootIndex + 1] ?? "");

  try {
    const surfaces = await collectSurfaces(root);
    const register = parseRegister(
      surfaces.find((surface) => surface.file === SPEC_REL)?.source ?? "",
    );
    const pending = await loadAllowlist(root);
    const model = census(surfaces, register, pending);
    verdict(model);

    for (const entry of model.unused) {
      console.log(
        `W-ALLOWLIST-UNUSED: ${entry.ref} in ${entry.path} — nothing references it; remove the entry`,
      );
    }
    for (const entry of model.stale) {
      console.log(
        `W-ALLOWLIST-STALE: ${entry.ref} now has a §5 row — remove the ${entry.path} entry (${entry.removalTrigger})`,
      );
    }
    if (!check) {
      for (const surface of surfaces) {
        const count = model.references.filter((entry) => entry.file === surface.file).length;
        if (count > 0) console.log(`  ${surface.file}: ${count} reference(s)`);
      }
    }
    console.log(
      `spec-drefs: in sync (${model.references.length} reference(s) across ${surfaces.length} surface(s) resolve to the ${model.defined.size} §5 row(s); ${model.extents.length} re-typed extent(s))`,
    );
  } catch (error) {
    if (error instanceof GateError) {
      console.log(`E-GATE: ${error.message}`);
      console.log("spec-drefs: FAIL");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Direct-execution guard (the dep-gate idiom): `import.meta.url` is the REALPATH
 * of this module while `process.argv[1]` is whatever path invoked it — on a
 * machine where the invocation crosses a symlink (/tmp is one on macOS) the two
 * never match as-is and the CLI silently no-ops (a fail-open).
 */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // unresolvable path — compare as-is rather than fail closed on a probe
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isMain()) {
  await main();
}
