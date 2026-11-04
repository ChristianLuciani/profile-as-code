/**
 * The shipped skill catalogs, `skills/README.md`, the two published schema
 * descriptions and `docs/USER-GUIDE.md` all document the split (#455).
 *
 * The catalogs and `skills/README.md` present a `checks.yaml` as the rule set
 * `pasco check` executes, as if the workspace catalog were unioned into every
 * executor. It is not: the union decides WHICH PREMISES run (`fact-present`);
 * the char caps come from the workspace's `content/checks.yaml`, else the caps
 * shipped with pasco (#240), and no skill `max-chars` row reaches that executor.
 * `readme-reference.test.ts` already pins the behaviour with a control; this
 * file pins the words, so the next reader cannot re-derive the old union claim
 * (SPEC §7 `check` row is the contract's one home).
 *
 * The catalogs that announce themselves as `pasco check` inputs must carry the
 * split; a new catalog that does not is a documentation regression, not a style
 * choice. `github-repo-meta` is out of scope by class: it already declares that
 * pasco v1 does not execute it.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");
const REPO_DIR = join(PKG_DIR, "..", "..");
const SKILLS_DIR = join(REPO_DIR, "skills");

/** The comment header of a `checks.yaml`: the leading `#`/blank lines only. */
function headerOf(source: string): string {
  const lines = source.split("\n");
  const firstRow = lines.findIndex((line) => line.trim() !== "" && !line.startsWith("#"));
  return (firstRow < 0 ? lines : lines.slice(0, firstRow)).join("\n");
}

/** The header as one line, so a sentence split by wrapping still matches. */
function flat(header: string): string {
  return header.replace(/^# ?/gm, "").replace(/\s+/g, " ").trim();
}

/** One shipped catalog that declares itself an input of `pasco check`. */
interface CheckCatalog {
  platform: string;
  header: string;
}

function checkCatalogs(): CheckCatalog[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ platform: entry.name, path: join(SKILLS_DIR, entry.name, "checks.yaml") }))
    .filter(({ path }) => existsSync(path))
    .map(({ platform, path }) => ({ platform, header: headerOf(readFileSync(path, "utf8")) }))
    .filter(({ header }) => /criterios machine-readable para `pasco check/.test(header));
}

describe("the shipped catalogs state the premise/cap split (#455)", () => {
  const catalogs = checkCatalogs();

  it("covers the four catalogs that ship a `pasco check` header", () => {
    // The four, not the count: a new catalog with a `pasco check` header joins
    // the contract below whether or not it is listed here.
    expect(catalogs.map(({ platform }) => platform)).toEqual(
      expect.arrayContaining(["github-org", "github-readme", "hotmart", "kofi"]),
    );
  });

  it("every header names the premise union, the cap source and SPEC §7", () => {
    for (const { platform, header } of catalogs) {
      const text = flat(header);
      expect(text, `${platform}: the union decides which premises run`).toContain(
        "content/checks.yaml",
      );
      expect(text, `${platform}: name what the union decides (premises)`).toMatch(/premisas?/i);
      expect(text, `${platform}: name where the caps come from`).toContain(
        "catálogo del workspace",
      );
      expect(text, `${platform}: name the fallback cap source`).toContain("defaults del paquete");
      expect(text, `${platform}: say the limit rows do not execute`).toMatch(/NO se ejecutan/);
      expect(text, `${platform}: point at the contract's one home`).toContain("SPEC §7");
    }
  });

  it("no header keeps the unqualified union claim this issue removed", () => {
    for (const { platform, header } of catalogs) {
      expect(flat(header), `${platform}: the old union line must not survive`).not.toContain(
        "unión con content/checks.yaml del workspace; misma rule catalog que el schema",
      );
    }
  });

  it("skills/README.md's checks.yaml entry carries the same split", () => {
    const readme = readFileSync(join(SKILLS_DIR, "README.md"), "utf8");
    const entry = readme
      .split("\n")
      .find((line) => line.includes("# ") && line.includes("checks.yaml"));
    expect(entry, "the skill tree must describe checks.yaml").toBeDefined();
    expect(
      entry,
      "the tree comment must not say pasco check executes it unqualified",
    ).not.toContain("criterios machine-readable que ejecuta `pasco check`");
    expect(entry, "name what the union decides (premises)").toMatch(/premisas?/i);
    expect(entry, "name the cap source").toContain("catálogo del workspace");
    expect(entry, "point at the contract's one home").toContain("SPEC §7");
  });

  it("the two published schema descriptions carry the same split", () => {
    const schema = JSON.parse(
      readFileSync(join(REPO_DIR, "schema", "profile.schema.json"), "utf8"),
    ) as {
      properties: { checks: { description: string } };
      $defs: { check: { properties: { rule: { description: string } } } };
    };
    const rows = [
      ["checks", schema.properties.checks.description],
      ["check.rule", schema.$defs.check.properties.rule.description],
    ] as const;
    for (const [label, text] of rows) {
      expect(text, `${label}: the union decides which premises run`).toContain("premises run");
      expect(text, `${label}: name the cap source`).toContain("caps shipped with pasco");
      expect(text, `${label}: say the skill rows do not execute`).toMatch(
        /no skill `max-chars` row reaches the limit executor/,
      );
      expect(text, `${label}: point at the contract's one home`).toContain("SPEC §7");
    }
  });

  it("docs/USER-GUIDE.md prints the literal the CLI emits", () => {
    const guide = readFileSync(join(REPO_DIR, "docs", "USER-GUIDE.md"), "utf8");
    expect(guide, "the CLI prints `cap unknown`, not `cap: unknown`").toContain(
      "prints `cap unknown`",
    );
    expect(guide).not.toContain("prints `cap: unknown`");
  });
});
