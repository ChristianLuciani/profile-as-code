/**
 * The shipped skill catalogs, `skills/README.md`, the two published schema
 * descriptions and `docs/USER-GUIDE.md` all document the split (#455).
 *
 * The catalogs and `skills/README.md` presented a `checks.yaml` as the rule set
 * `pasco check` executes. It is not: the union decides WHICH PREMISES run
 * (`fact-present`); the char caps come from the workspace's `content/checks.yaml`
 * when it declares checks (the whole catalog wins, never merged row by row),
 * else the caps shipped with pasco (#240), and no skill `max-chars` row reaches
 * that executor. `readme-reference.test.ts` already pins the behaviour with a
 * control; this file pins the words, so the next reader cannot re-derive the old
 * union claim (SPEC §7 `check` row is the contract's one home).
 *
 * Every shipped catalog must carry the split unless it is the declared
 * exemption (`github-repo-meta`, which says pasco v1 does not execute it); a new
 * catalog that does neither is a documentation regression, not a style choice.
 */

import { createHash } from "node:crypto";
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

/** One shipped catalog that does not declare itself outside `pasco check`. */
interface CheckCatalog {
  platform: string;
  header: string;
}

/** The ONE catalog that declares itself outside `pasco check` (SPEC §7 v1). */
const OUTSIDE_PASCO_CHECK = new Set(["github-repo-meta"]);

function checkCatalogs(): CheckCatalog[] {
  return (
    readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ platform: entry.name, path: join(SKILLS_DIR, entry.name, "checks.yaml") }))
      .filter(({ path }) => existsSync(path))
      .map(({ platform, path }) => ({ platform, header: headerOf(readFileSync(path, "utf8")) }))
      // The exemption is DELIBERATE and named: a phrase anywhere in a header
      // would silently skip a catalog that merely mentions non-execution.
      .filter(({ platform }) => !OUTSIDE_PASCO_CHECK.has(platform))
  );
}

describe("the shipped catalogs state the premise/cap split (#455)", () => {
  const catalogs = checkCatalogs();

  it("covers the four catalogs that ship a `pasco check` header", () => {
    // The four, not the count: a new catalog joins the contract below unless it
    // declares that pasco v1 does not execute it.
    expect(catalogs.map(({ platform }) => platform)).toEqual(
      expect.arrayContaining(["github-org", "github-readme", "hotmart", "kofi"]),
    );
  });

  it("every header names the premise union, the cap source and SPEC §7", () => {
    for (const { platform, header } of catalogs) {
      const text = flat(header);
      expect(text, `${platform}: the union decides which premises run`).toContain(
        "facts/checks.yaml",
      );
      expect(text, `${platform}: name what the union decides (premises)`).toMatch(/premisas?/i);
      expect(text, `${platform}: name where the caps come from`).toContain(
        "catálogo del workspace cuando declara checks",
      );
      expect(text, `${platform}: the whole catalog wins, not a per-row merge`).toContain(
        "sin merge por fila",
      );
      expect(text, `${platform}: name the fallback cap source`).toContain("defaults del paquete");
      expect(text, `${platform}: say the limit rows do not execute`).toContain(
        "nunca de estas filas",
      );
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

  it("github-repo-meta is exempt by its own non-execution declaration", () => {
    const meta = readFileSync(join(SKILLS_DIR, "github-repo-meta", "checks.yaml"), "utf8");
    expect(flat(headerOf(meta)), "the exemption must be written, not inferred").toMatch(
      /`pasco check` no la ejecuta/,
    );
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
    expect(entry, "name the cap source condition").toContain(
      "catálogo del workspace cuando declara checks",
    );
    expect(entry, "the whole catalog wins, not a per-row merge").toContain("sin merge por fila");
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
      { label: "checks", text: schema.properties.checks.description, fallback: "package defaults" },
      {
        label: "check.rule",
        text: schema.$defs.check.properties.rule.description,
        fallback: "caps shipped with pasco",
      },
    ] as const;
    for (const { label, text, fallback } of rows) {
      expect(text, `${label}: the union decides which premises run`).toContain("premises run");
      expect(text, `${label}: the workspace catalog wins whole`).toContain("declares checks");
      expect(text, `${label}: no per-row merge`).toContain("never merged row by row");
      expect(text, `${label}: name the fallback cap source`).toContain(fallback);
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

  it("SPEC §3 is byte-pinned: a restatement cannot ride beside the pointer", () => {
    const spec = readFileSync(join(REPO_DIR, "docs", "SPEC.md"), "utf8");
    const start = spec.indexOf("## 3. Success criteria");
    const end = spec.indexOf("## 4. Architecture", start);
    expect(start, "SPEC §3 must exist").toBeGreaterThanOrEqual(0);
    // Both headings must be unique: a duplicate §3 (or a fake §4 before the
    // real one) would let the hash cover a copy while the real one is restated.
    expect(spec.indexOf("## 3. Success criteria", start + 1), "§3 must be unique").toBe(-1);
    const next4 = spec.indexOf("## 4. Architecture", start + 1);
    expect(spec.indexOf("## 4. Architecture", next4 + 1), "§4 must be unique").toBe(-1);
    const section = spec.slice(start, end < 0 ? undefined : end);
    // The pointer is the ONLY statement about `pasco check` in §3. The WHOLE
    // section is byte-pinned: a rewritten restatement (or a continuation line)
    // changes the hash, so it cannot ride beside the pointer — the hole a
    // vocabulary denylist left open across passes 3-5. Editing §3 is fine; it
    // just has to be deliberate, and the `pasco check` clause stays a pointer.
    expect(section.match(/`pasco check`/g) ?? [], "§3 must name `pasco check` once").toHaveLength(
      1,
    );
    expect(section, "§3 must carry the exact §7 pointer").toContain(
      "warns on drift/geo (facts); `pasco check` runs the rules SPEC §7 `check` row owns.",
    );
    expect(
      createHash("sha256").update(section).digest("hex"),
      "SPEC §3 changed — re-read it; the `pasco check` clause must stay a pointer at the §7 `check` row, never a restatement. Update this pin deliberately.",
    ).toBe("e5ef63e72a503ce855b9b081605c08bfbbb2eb78caa0b8416ee254578a52f1f8");
  });
});
