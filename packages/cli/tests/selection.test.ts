/**
 * `pasco build --view` / `pasco status --selection` — D22, SPEC §21.
 *
 * These are CLI-level tests (the built binary against a real workspace), because
 * the contract they guard is the CLI's: `--view` resolves a declared view, every
 * omission WARNS (§21.4), and an addressed key that resolves to nothing FAILS
 * (§21.5, G6). The filtering itself is unit-tested in core.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd?: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    timeout: 15_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * A workspace with two tagged artifacts and two addressable projects, so both
 * selection mechanisms (tags = Phase 1 `artifacts` only, keys = every block) are
 * exercised against a real renderer.
 */
function workspace(pascorc: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-selection-"));
  tempDirs.push(dir);
  execFileSync("cp", ["-R", `${MINIMAL}/.`, dir]);
  writeFileSync(join(dir, ".pascorc"), `${JSON.stringify(pascorc, null, 2)}\n`);
  writeFileSync(
    join(dir, "content", "artifacts.yaml"),
    [
      "- id: short-film",
      "  kind: showreel",
      "  title: Short Film",
      "  locator:",
      "    url: https://example.com/film",
      "  tags: [film]",
      "  visibility: public",
      "- id: ai-repo",
      "  kind: code",
      "  title: AI Repository",
      "  locator:",
      "    url: https://example.com/ai",
      "  tags: [ai]",
      "  visibility: public",
      "- id: untagged-doc",
      "  kind: document",
      "  title: Untagged Document",
      "  locator:",
      "    url: https://example.com/doc",
      "  visibility: public",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "content", "projects.yaml"),
    [
      "- id: p-secret",
      "  name: Confidential Project",
      "  status: active",
      "  description:",
      "    en: A project that must not reach the public surface.",
      "- id: p-open",
      "  name: Open Project",
      "  status: active",
      "  description:",
      "    en: A project that may be published.",
      "",
    ].join("\n"),
  );
  return dir;
}

const readReadme = (dir: string) =>
  readFileSync(join(dir, "profiles", "github-readme", "README.md"), "utf8");

describe("pasco build --view (D22/§21)", () => {
  it("a view's excludeKeys removes the entry from the rendered artifact and warns", () => {
    const ws = workspace({
      selection: { views: { linkedin: { excludeKeys: ["projects:p-secret"] } } },
    });
    const r = run(["build", "linkedin", "--view", "linkedin", "--json"], ws);
    expect(r.code).toBe(0);
    // The surface is a SUBSET of the SSOT — subset-only, never a rewrite.
    const data = JSON.parse(r.stdout) as {
      data: { selection: { code: string; severity: string; message: string }[] };
    };
    const warn = data.data.selection.find((f) => f.code === "selection/omits-facts");
    expect(warn?.severity).toBe("warn");
    expect(warn?.message).toContain("projects:p-secret");
  });

  it("a declared view may carry its own platform, so --view alone is enough", () => {
    const ws = workspace({
      selection: {
        views: { film: { platform: "github-readme", lang: "en", mode: "tags", tags: ["film"] } },
      },
    });
    const r = run(["build", "--view", "film"], ws);
    expect(r.code).toBe(0);
    const readme = readReadme(ws);
    expect(readme).toContain("Short Film");
    // `mode: tags` is an explicit allowlist for tag-capable blocks.
    expect(readme).not.toContain("AI Repository");
    expect(readme).not.toContain("Untagged Document");
    // Never silent (§21.4): the omission is printed.
    expect(r.stdout).toContain("selection/omits-facts");
  });

  it("--view with no platform and no declared target is a config error (exit 1)", () => {
    const ws = workspace({ selection: { views: { film: { mode: "tags", tags: ["film"] } } } });
    const r = run(["build", "--view", "film"], ws);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/declares no platform/);
  });

  it("an unknown view fails instead of silently building everything", () => {
    const ws = workspace({ selection: { views: { film: { platform: "github-readme" } } } });
    const r = run(["build", "--view", "nope"], ws);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/unknown view "nope"/);
  });

  it("a view targeting a different platform than the command fails (ambiguous)", () => {
    const ws = workspace({
      selection: { views: { film: { platform: "github-readme" } } },
    });
    const r = run(["build", "linkedin", "--view", "film"], ws);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/targets "github-readme" but the command names "linkedin"/);
  });

  it("an addressed key that resolves to nothing FAILS the build (G6)", () => {
    const ws = workspace({ selection: { views: { v: { excludeKeys: ["projects:ghost"] } } } });
    const r = run(["build", "github-readme", "--view", "v"], ws);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/selection\/unknown-key|selection error/);
  });

  it("no selection policy ⇒ byte-identical artifact (the compatibility guarantee)", () => {
    const plain = workspace({});
    const r = run(["build", "github-readme"], plain);
    expect(r.code).toBe(0);
    const first = readReadme(plain);
    // Rebuild: profiles/ is a pure function of the workspace (§15.1).
    expect(run(["build", "github-readme"], plain).code).toBe(0);
    expect(readReadme(plain)).toBe(first);
    expect(r.stdout).not.toContain("fact selection");
  });
});

describe("pasco status --selection (D22/§21.4)", () => {
  it("names every omission with its reason", () => {
    const ws = workspace({
      selection: {
        views: { linkedin: { excludeKeys: ["projects:p-secret"], excludeTags: ["ai"] } },
      },
    });
    const r = run(["status", "linkedin", "--selection"], ws);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("projects:p-secret");
    expect(r.stdout).toContain("excluded-by-key");
    expect(r.stdout).toContain("excluded-by-tag");
  });

  it("--json exposes the resolved report", () => {
    const ws = workspace({
      selection: { views: { linkedin: { excludeKeys: ["projects:p-secret"] } } },
    });
    const r = run(["status", "linkedin", "--selection", "--json"], ws);
    const data = JSON.parse(r.stdout) as {
      data: { mode: string; reports: { view: string; omitted: { reason: string }[] }[] };
    };
    expect(data.data.mode).toBe("selection");
    expect(data.data.reports[0]?.view).toBe("linkedin");
    expect(data.data.reports[0]?.omitted[0]?.reason).toBe("excluded-by-key");
  });

  it("refuses to run beside the ledger write paths (exit 2)", () => {
    const ws = workspace({});
    const r = run(["status", "--selection", "--write-checklist"], ws);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/read-only report/);
  });

  it("reports nothing omitted when there is no policy", () => {
    const ws = workspace({});
    const r = run(["status", "github-readme", "--selection"], ws);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("nothing omitted");
  });
});

describe("pasco build --view orderKeys (#458)", () => {
  const projectOrder = (dir: string) =>
    [
      ...(
        readFileSync(join(dir, "profiles", "github-readme", "README.md"), "utf8")
          .split("## Projects")[1]
          ?.split("\n## ")[0] ?? ""
      ).matchAll(/- \*\*([^*]+)\*\*/g),
    ].map((m) => m[1]);

  it("renders the pinned keys first, in declared order", () => {
    const ws = workspace({
      selection: { views: { v: { orderKeys: ["projects:p-open"] } } },
    });
    const r = run(["build", "github-readme", "--view", "v", "--json"], ws);
    expect(r.code).toBe(0);
    // Default alphabetical order would put Confidential first; the view pins Open.
    expect(projectOrder(ws)).toEqual(["Open Project", "Confidential Project"]);
  });

  it("status --selection shows the resolved order", () => {
    const ws = workspace({
      selection: { views: { v: { orderKeys: ["projects:p-open"] } } },
    });
    const r = run(["status", "github-readme", "--selection", "--view", "v"], ws);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("order projects: projects:p-open");
  });

  it("an order key the view does not emit WARNS and the build still succeeds", () => {
    const ws = workspace({
      selection: { views: { v: { orderKeys: ["projects:ghost"] } } },
    });
    const r = run(["build", "github-readme", "--view", "v", "--json"], ws);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("selection/order-key-unknown");
  });

  it("a non-string orderKeys entry is a config error (exit 1), never a dropped order", () => {
    const ws = workspace({
      selection: { views: { v: { orderKeys: ["projects:p-open", 42] } } },
    });
    const r = run(["build", "github-readme", "--view", "v"], ws);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/config error: .*orderKeys/);
  });
});

describe("pasco build --view orderKeys — the empty-list edge (#458)", () => {
  it("an explicit orderKeys: [] still declares the view (no unknown-view)", () => {
    const ws = workspace({ selection: { views: { v: { orderKeys: [] } } } });
    const r = run(["build", "github-readme", "--view", "v", "--json"], ws);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout) as { data: { selection: unknown[] } };
    expect(data.data.selection).toEqual([]);
  });

  it("the empty list is a no-op: the rendered order is the comparator's", () => {
    const ws = workspace({ selection: { views: { v: { orderKeys: [] } } } });
    expect(run(["build", "github-readme", "--view", "v"], ws).code).toBe(0);
    const readme = readReadme(ws);
    const section = readme.split("## Projects")[1]?.split("\n## ")[0] ?? "";
    const order = [...section.matchAll(/- \*\*([^*]+)\*\*/g)].map((m) => m[1]);
    expect(order).toEqual(["Confidential Project", "Open Project"]);
  });
});

describe("build — active variant vs a resolved orderKeys (#458)", () => {
  const ACTIVE = [
    "github-readme:",
    "  lang: en",
    "  variantId: gh-1",
    '  chosenAt: "2026-11-05T00:00:00.000Z"',
    "linkedin:",
    "  lang: en",
    "  variantId: li-1",
    '  chosenAt: "2026-11-05T00:00:00.000Z"',
    "",
  ].join("\n");

  /** Add an active variant body so renderArtifact writes it verbatim. */
  function withVariant(ws: string): void {
    mkdirSync(join(ws, "profiles", "github-readme", "variants"), { recursive: true });
    writeFileSync(
      join(ws, "profiles", "github-readme", "variants", "gh-1.md"),
      "# Hand-authored body\n",
    );
    writeFileSync(join(ws, "content", "active.yaml"), ACTIVE);
  }

  const buildJson = (ws: string, view?: string) =>
    JSON.parse(
      run(["build", "github-readme", ...(view === undefined ? [] : ["--view", view]), "--json"], ws)
        .stdout,
    ) as {
      data: { written: { variant?: string }[]; warnings: { reason: string }[] };
    };

  const projectOrder = (dir: string) =>
    [
      ...(
        readFileSync(join(dir, "profiles", "github-readme", "README.md"), "utf8")
          .split("## Projects")[1]
          ?.split("\n## ")[0] ?? ""
      ).matchAll(/- \*\*([^*]+)\*\*/g),
    ].map((m) => m[1]);

  it("warns that the order applied to the render, not the verbatim variant body", () => {
    const ws = workspace({
      selection: { views: { v: { orderKeys: ["projects:p-open"] } } },
    });
    withVariant(ws);
    const data = buildJson(ws, "v");
    expect(data.data.written[0]?.variant).toBe("gh-1");
    // The variant is authoritative; the engine must not stay silent about the no-op.
    expect(data.data.warnings.map((w) => w.reason).join(" ")).toMatch(
      /active variant "gh-1".*resolved order applies to the render, not to this body/,
    );
  });

  it("the note is permanent: a nominal order that pins the already-first key still warns", () => {
    // `p-secret` is already first by name, so the ordered render is byte-identical
    // to the no-order render. The note is about the LAYER, not a delta — §21.3 r11.
    const ws = workspace({ selection: { views: { v: { orderKeys: ["projects:p-secret"] } } } });
    withVariant(ws);
    const data = buildJson(ws, "v");
    expect(data.data.warnings).toHaveLength(1);
    expect(data.data.warnings[0]?.reason).toContain("informational");
  });

  it("runs §16.2 step 4 (remove entry → build → write body → refine --choose) and preserves other choices", () => {
    const ws = workspace({
      selection: { views: { v: { orderKeys: ["projects:p-open"] } } },
    });
    withVariant(ws);
    // 1. remove THAT platform's entry (never the file — the linkedin choice stays)
    writeFileSync(
      join(ws, "content", "active.yaml"),
      'linkedin:\n  lang: en\n  variantId: li-1\n  chosenAt: "2026-11-05T00:00:00.000Z"\n',
    );
    expect(run(["build", "github-readme", "--view", "v"], ws).code).toBe(0);
    expect(projectOrder(ws)).toEqual(["Open Project", "Confidential Project"]);
    // 2-3. take the ordered render as the base and write it as the body. The
    // agent's composition (chrome/JSON-LD) is not mechanizable here; this test
    // pins the mechanical sequence the engine owns.
    const orderedBody = readFileSync(join(ws, "profiles", "github-readme", "README.md"), "utf8");
    writeFileSync(join(ws, "profiles", "github-readme", "variants", "gh-1.md"), orderedBody);
    // 4. re-record through the real CLI path; `--lang` is part of the entry and
    // `recordVariant` must preserve the other platform's choice.
    const choose = run(["refine", "github-readme", "--choose", "gh-1", "--lang", "en"], ws);
    expect(choose.code).toBe(0);
    const active = readFileSync(join(ws, "content", "active.yaml"), "utf8");
    expect(active).toContain("github-readme:");
    expect(active).toContain("linkedin:");
    const data = buildJson(ws, "v");
    expect(data.data.written[0]?.variant).toBe("gh-1");
    // The artifact is the composed body, and it carries the resolved order.
    expect(readFileSync(join(ws, "profiles", "github-readme", "README.md"), "utf8")).toBe(
      orderedBody,
    );
    // The note is permanent/informational while the variant serves the surface.
    expect(data.data.warnings.map((w) => w.reason).join(" ")).toContain('active variant "gh-1"');
  });

  it("does not warn when the view resolves no order", () => {
    const ws = workspace({});
    withVariant(ws);
    const data = buildJson(ws);
    expect(data.data.warnings).toEqual([]);
  });
});
