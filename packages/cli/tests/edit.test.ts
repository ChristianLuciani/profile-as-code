/**
 * `pasco edit` — contract-path resolution + `--check` (S1 of epic #247) and the
 * writer it delegates to (S2, #249, pinned in `edit-write.test.ts`). Invariants:
 *
 *  1. A READ or a PREVIEW never touches disk (whole-workspace snapshot).
 *  2. The preview is what `pasco build` PUBLISHES, not the addressed row's own
 *     text (premerge review of PR #331, F1). The conformance tests at the bottom
 *     apply the same edit to the workspace, run `build`, and assert the previewed
 *     text is in the artifact bytes.
 *  3. The preview refuses exactly what the write refuses (multi-line/block
 *     scalars, anchors) — F1 of the premerge review of PR #332.
 *
 * Runs the BUILT binary (`pnpm test` builds first) against a copy of the core
 * `minimal` fixture, so a test never mutates a committed fixture.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { resolveEditTarget } from "../src/commands/edit.js";
import { parseEditAddress } from "../src/contract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

const tempDirs: string[] = [];
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-edit-"));
  tempDirs.push(dir);
  cpSync(MINIMAL, dir, { recursive: true });
  // The committed fixture wraps 5 of its 6 bios; the writer (and therefore the
  // preview, which must refuse what the write refuses) accepts single-line
  // scalars only, so the test workspace carries the same VALUES, one line each.
  writeFileSync(
    join(dir, "content", "bios.yaml"),
    `- platform: github-readme
  lang: en
  length: long
  text: Elena Vasquez builds sovereign AI infrastructure.
- platform: github-readme
  lang: en
  length: short
  text: Sovereign AI infrastructure · open-source education.
- platform: linkedin
  lang: en
  length: medium
  text: Senior AI engineer designing local-first LLM infrastructure.
- platform: linkedin
  lang: es
  length: medium
  text: Ingeniera senior de IA diseñando infraestructura local-first.
- platform: upwork
  lang: en
  length: long
  text: "I architect sovereign AI stacks: model routing, local inference, and evaluation pipelines for teams that want provider independence."
`,
  );
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(dir: string, ...args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args, "--workspace", dir], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function edit(dir: string, ...args: string[]): RunResult {
  return run(dir, "edit", ...args);
}

/** sha256 over every file of the temp workspace (name + bytes, sorted) — the
 *  acceptance's "no file on disk is touched", not just "no content file". */
function workspaceHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      hash.update(relative(dir, full));
      hash.update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

/** The artifact `pasco build` writes for a surface (renderer → dir/README.md). */
function artifact(workspaceDir: string, platform: string): string {
  const rendered = join(workspaceDir, "profiles", platform, "README.md");
  const pasted = join(workspaceDir, "profiles", `${platform}.md`);
  if (existsSync(rendered)) return readFileSync(rendered, "utf8");
  if (existsSync(pasted)) return readFileSync(pasted, "utf8");
  throw new Error(`no artifact for ${platform} under ${workspaceDir}`);
}

function json(r: RunResult): { ok: boolean; data: Record<string, unknown> } {
  return JSON.parse(r.stdout) as { ok: boolean; data: Record<string, unknown> };
}

describe("pasco edit — resolution, preview and write", () => {
  it("prints the current value of a lang-only address", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.statement.en");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("address:  positioning.statement.en");
    expect(r.stdout).toContain("current:  AI engineer building sovereign");
  });

  it("--set --check previews the published lines of a renderer surface", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "Sovereign AI infra",
      "--check",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("current:  Sovereign AI infrastructure engineer");
    expect(r.stdout).toContain("proposed: Sovereign AI infra");
    // The published line, as the README renders it — not the raw row.
    expect(r.stdout).toContain("  - ### Sovereign AI infrastructure engineer");
    expect(r.stdout).toContain("  + ### Sovereign AI infra");
  });

  it("previews a bio the paste artifact actually publishes", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Shorter bio text",
      "--check",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("published (linkedin/en");
    expect(r.stdout).toContain("  + Shorter bio text");
  });

  it("says NO CHANGE when the artifact publishes a different row (paste priority)", () => {
    const dir = workspace();
    const bios = join(dir, "content", "bios.yaml");
    writeFileSync(
      bios,
      `${readFileSync(bios, "utf8")}- platform: linkedin\n  lang: en\n  length: short\n  text: A short bio.\n`,
    );
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=short].text",
      "--set",
      "Edited short",
      "--check",
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("no change");
    expect(r.stdout).toContain("publishes the `medium` bio");
  });

  it("says NO CHANGE when the artifact carries no such field at all", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "headlines[platform=upwork,lang=en].text",
      "--set",
      "New upwork headline",
      "--check",
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("no change");
    expect(r.stdout).toContain("carries no headline");
  });

  it("previews the statement on the artifacts that carry it", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.statement.en", "--set", "New statement text", "--check");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("published (github-readme/en");
    expect(r.stdout).toContain("  + **New statement text**");
  });

  it("resolves a link, and a label disambiguates two links on one platform", () => {
    const dir = workspace();
    const identity = join(dir, "content", "identity.yaml");
    writeFileSync(
      identity,
      readFileSync(identity, "utf8").replace(
        "  - platform: github\n    label: GitHub\n    url: https://github.com/elenavasquez\n",
        "  - platform: github\n    label: GitHub\n    url: https://github.com/elenavasquez\n  - platform: github\n    label: GitHub projects\n    url: https://github.com/elenavasquez/project-as-code\n",
      ),
    );

    const ambiguous = edit(dir, "identity.links[platform=github].url");
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stdout).toContain("several links share this platform");
    expect(ambiguous.stdout).toContain("label=<…>");
    expect(ambiguous.stdout).toContain("label=GitHub projects");

    const labelled = edit(dir, "identity.links[platform=github,label=GitHub projects].url");
    expect(labelled.code).toBe(0);
    expect(labelled.stdout).toContain("current:  https://github.com/elenavasquez/project-as-code");

    const write = edit(
      dir,
      "identity.links[platform=github,label=GitHub].url",
      "--set",
      "https://x.dev",
      "--check",
    );
    expect(write.code).toBe(2);
    expect(write.stderr).toContain("read-only");
  });

  it("rejects an unknown address with the grammar for every block", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.foo");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown address "positioning.foo"');
    expect(r.stderr).toContain("positioning.statement.<lang>");
    expect(r.stderr).toContain("headlines[platform=<p>,lang=<l>].text");
    expect(r.stderr).toContain("bios[platform=<p>,lang=<l>,length=<len>].text");
    expect(r.stderr).toContain("identity.links[platform=<p>,label=<l>].url");
  });

  it("rejects an unknown platform with the allowed enum values", () => {
    const dir = workspace();
    const r = edit(dir, "headlines[platform=gitlab,lang=en].text");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown platform "gitlab"');
    expect(r.stderr).toContain("linkedin");
  });

  it("reports 0 rows with the addresses the workspace does have", () => {
    const dir = workspace();
    const r = edit(dir, "headlines[platform=upwork,lang=fr].text");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("resolves to 0 rows");
    expect(r.stdout).toContain("available:");
    expect(r.stdout).toContain("headlines[platform=upwork,lang=en].text");
  });

  it("keeps the proposal visible on a 0-row address and says creation is not previewable", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.statement.fr", "--set", "Nouvelle déclaration", "--check");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("proposed: Nouvelle déclaration");
    expect(r.stdout).toContain("edit does not create rows");
  });

  it("refuses an ambiguous (duplicate) row instead of choosing one", () => {
    const dir = workspace();
    const bios = join(dir, "content", "bios.yaml");
    writeFileSync(
      bios,
      `${readFileSync(bios, "utf8")}- platform: linkedin\n  lang: en\n  length: medium\n  text: Duplicate row text.\n`,
    );
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "New",
      "--check",
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("resolves to 2 rows");
    expect(r.stdout).toContain("drift/duplicate-bio");
    expect(r.stdout).toContain("Duplicate row text.");
  });

  it("refuses a --set with a line break (S2 writes single-line scalars only)", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.statement.en", "--set", "line one\nline two", "--check");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("line break");
    expect(r.stderr).toContain("#249");
  });

  it("does not list an empty statement string as an available address", () => {
    const dir = workspace();
    const positioning = join(dir, "content", "positioning.yaml");
    writeFileSync(
      positioning,
      readFileSync(positioning, "utf8").replace("statement:\n  en:", 'statement:\n  fr: ""\n  en:'),
    );
    const r = edit(dir, "positioning.statement.fr");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("resolves to 0 rows");
    const available = r.stdout.split("available:")[1] ?? "";
    expect(available).not.toContain("positioning.statement.fr");
    expect(available).toContain("positioning.statement.en");
  });

  it("refuses to PREVIEW a multi-line scalar the write would refuse (F1)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-edit-wrapped-"));
    tempDirs.push(dir);
    cpSync(MINIMAL, dir, { recursive: true }); // the committed fixture wraps its bios
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "New",
      "--check",
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("multi-line scalar");
  });

  it("writes when --check is absent (S2, #249) and previews with it", () => {
    const dir = workspace();
    const check = edit(dir, "positioning.statement.en", "--set", "New statement", "--check");
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("published (github-readme/en");

    const write = edit(dir, "positioning.statement.en", "--set", "New statement");
    expect(write.code).toBe(0);
    expect(write.stdout).toContain("written: yes");
    expect(readFileSync(join(dir, "content", "positioning.yaml"), "utf8")).toContain(
      "en: New statement",
    );
  });

  it("refuses --check without --set, and an empty --set", () => {
    const dir = workspace();
    const checkOnly = edit(dir, "positioning.statement.en", "--check");
    expect(checkOnly.code).toBe(2);
    expect(checkOnly.stderr).toContain("--set");

    const empty = edit(dir, "positioning.statement.en", "--set", "", "--check");
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain("must not be empty");
    expect(empty.stderr).toContain("#84");
  });

  it("treats re-setting the current value as a noop (exit 0, no write)", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "positioning.statement.en",
      "--set",
      "AI engineer building sovereign, open-source AI infrastructure for education.",
      "--check",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("(noop)");
  });

  it("--json carries { address, current, proposed, rendered, ok, noop, written }", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "Sovereign AI infra",
      "--check",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = json(r);
    expect(parsed.ok).toBe(true);
    const inner = parsed.data as Record<string, unknown>;
    expect(Object.keys(inner).sort()).toEqual(
      ["address", "current", "noop", "ok", "proposed", "rendered", "warnings", "written"].sort(),
    );
    expect(inner.address).toBe("headlines[platform=github-readme,lang=en].text");
    expect(inner.current).toBe("Sovereign AI infrastructure engineer");
    expect(inner.proposed).toBe("Sovereign AI infra");
    expect(inner.rendered).toBe("### Sovereign AI infra");
    expect(inner.ok).toBe(true);
    expect(inner.noop).toBe(false);
    expect(inner.written).toBe(false);
  });

  it("names the active variant when it shadows the edited field (#238)", () => {
    const dir = workspace();
    // The minimal fixture declares `github-readme → gh-en-2025-01` in
    // content/active.yaml but ships no body; give it one so the variant wins.
    mkdirSync(join(dir, "profiles", "github-readme", "variants"), { recursive: true });
    writeFileSync(
      join(dir, "profiles", "github-readme", "variants", "gh-en-2025-01.md"),
      "# Variant body\n",
    );
    const r = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "Shadows nothing",
      "--check",
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("no change");
    expect(r.stdout).toContain("#238, gh-en-2025-01");
  });

  it("--json reports a 0-row address honestly (nulls, ok false)", () => {
    const dir = workspace();
    const r = edit(dir, "positioning.statement.fr", "--json");
    expect(r.code).toBe(1);
    const parsed = json(r);
    expect(parsed.ok).toBe(false);
    expect(parsed.data.current).toBeNull();
    expect(parsed.data.proposed).toBeNull();
    expect(parsed.data.rendered).toBeNull();
    expect(parsed.data.ok).toBe(false);
  });

  it("--json reports an ambiguous address (ok false, no rendered)", () => {
    const dir = workspace();
    const bios = join(dir, "content", "bios.yaml");
    writeFileSync(
      bios,
      `${readFileSync(bios, "utf8")}- platform: linkedin\n  lang: en\n  length: medium\n  text: Duplicate row text.\n`,
    );
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "New",
      "--check",
      "--json",
    );
    expect(r.code).toBe(1);
    const parsed = json(r);
    expect(parsed.ok).toBe(false);
    expect(parsed.data.current).toBeNull();
    expect(parsed.data.rendered).toBeNull();
  });

  it("rejects a selector given twice", () => {
    const dir = workspace();
    const r = edit(dir, "headlines[platform=x,platform=linkedin,lang=en].text");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('selector "platform" given twice');
  });

  it("never touches a byte on disk (whole-workspace snapshot)", () => {
    const dir = workspace();
    const before = workspaceHash(dir);
    for (const args of [
      ["positioning.statement.en"],
      ["positioning.statement.en", "--set", "Another statement", "--check"],
      ["headlines[platform=github-readme,lang=en].text", "--set", "A new headline", "--check"],
      ["headlines[platform=upwork,lang=en].text", "--set", "Not published", "--check"],
      ["identity.links[platform=orcid].url"],
      ["bios[platform=nope,lang=en,length=medium].text"],
    ]) {
      edit(dir, ...args);
    }
    expect(workspaceHash(dir)).toBe(before);
  });
});

describe("pasco edit — conformance with `pasco build` (F1)", () => {
  it("the previewed headline is exactly a line of the built README", () => {
    const dir = workspace();
    const preview = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "Sovereign AI infra",
      "--check",
      "--json",
    );
    const rendered = json(preview).data.rendered as string;
    // Apply the same edit to the SSOT, then build — the artifact must contain
    // the previewed line EXACTLY (a substring match would also pass on the
    // round-1 defect, where `rendered` was the raw row).
    const headlines = join(dir, "content", "headlines.yaml");
    writeFileSync(
      headlines,
      readFileSync(headlines, "utf8").replace(
        "  text: Sovereign AI infrastructure engineer\n",
        "  text: Sovereign AI infra\n",
      ),
    );
    expect(run(dir, "build", "github-readme").code).toBe(0);
    expect(artifact(dir, "github-readme").split("\n")).toContain(rendered);
  });

  it("the previewed bio IS the built paste artifact (one row, verbatim)", () => {
    const dir = workspace();
    const preview = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Shorter bio text",
      "--check",
      "--json",
    );
    const rendered = json(preview).data.rendered as string;
    const bios = join(dir, "content", "bios.yaml");
    writeFileSync(
      bios,
      readFileSync(bios, "utf8").replace(
        "  text: Senior AI engineer designing local-first LLM infrastructure.\n",
        "  text: Shorter bio text\n",
      ),
    );
    expect(run(dir, "build", "linkedin").code).toBe(0);
    expect(artifact(dir, "linkedin")).toBe(`${rendered}\n`);
  });

  it("NEGATIVE: a row the artifact does not publish is never previewed as published", () => {
    const dir = workspace();
    const bios = join(dir, "content", "bios.yaml");
    writeFileSync(
      bios,
      `${readFileSync(bios, "utf8")}- platform: linkedin\n  lang: en\n  length: short\n  text: A short bio.\n`,
    );
    const preview = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=short].text",
      "--set",
      "Edited short",
      "--check",
      "--json",
    );
    expect(preview.code).toBe(1);
    expect(json(preview).data.rendered).toBeNull();
    // Apply it anyway: the built paste artifact must still NOT carry it.
    writeFileSync(
      bios,
      readFileSync(bios, "utf8").replace("  text: A short bio.\n", "  text: Edited short\n"),
    );
    expect(run(dir, "build", "linkedin").code).toBe(0);
    expect(artifact(dir, "linkedin")).not.toContain("Edited short");
  });
});

describe("locate — S2's write handle (file-relative + merged-profile paths)", () => {
  it("points at the FILE path (the CST can resolve it) and the profile path (applyEdit)", () => {
    const dir = workspace();
    const profile = load(dir);

    const headline = resolveEditTarget(
      profile,
      parseEditAddress("headlines[platform=upwork,lang=en].text"),
      dir,
    );
    expect(headline.locate).toEqual({
      file: "content/headlines.yaml",
      path: [3, "text"],
      profilePath: ["headlines", 3, "text"],
    });

    const bio = resolveEditTarget(
      profile,
      parseEditAddress("bios[platform=linkedin,lang=en,length=medium].text"),
      dir,
    );
    expect(bio.locate).toEqual({
      file: "content/bios.yaml",
      path: [2, "text"],
      profilePath: ["bios", 2, "text"],
    });

    const statement = resolveEditTarget(profile, parseEditAddress("positioning.statement.en"), dir);
    expect(statement.locate).toEqual({
      file: "content/positioning.yaml",
      path: ["statement", "en"],
      profilePath: ["positioning", "statement", "en"],
    });
  });

  it("is absent for a read-only link, and for an address that is not exactly one row", () => {
    const dir = workspace();
    const profile = load(dir);
    expect(
      resolveEditTarget(profile, parseEditAddress("identity.links[platform=github].url"), dir)
        .locate,
    ).toBeUndefined();
    expect(
      resolveEditTarget(profile, parseEditAddress("bios[platform=x,lang=en,length=long].text"), dir)
        .locate,
    ).toBeUndefined();
  });

  it("finds a file whose extension is upper-case (load() is case-insensitive)", async () => {
    const dir = workspace();
    const { renameSync } = await import("node:fs");
    renameSync(join(dir, "content", "headlines.yaml"), join(dir, "content", "headlines.YAML"));
    const target = resolveEditTarget(
      load(dir),
      parseEditAddress("headlines[platform=upwork,lang=en].text"),
      dir,
    );
    expect(target.locate?.file).toBe("content/headlines.YAML");
  });
});
