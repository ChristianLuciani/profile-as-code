/**
 * `pasco edit` — contract-path resolution + `--check` (S1 of epic #247) and the
 * writer it delegates to (S2, #249, pinned in `edit-write.test.ts`). Invariants:
 *
 *  1. A READ or a PREVIEW never touches disk (whole-workspace snapshot).
 *  2. The preview is what `pasco build` PUBLISHES, not the addressed row's own
 *     text (review of PR #331, F1). The conformance tests at the bottom
 *     apply the same edit to the workspace, run `build`, and assert the previewed
 *     text is in the artifact bytes.
 *  3. The preview refuses exactly what the write refuses (multi-line/block
 *     scalars, anchors) — F1 of the review of PR #332.
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
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { load, trackableUnits } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { resolveEditTarget } from "../src/commands/edit.js";
import { parseEditAddress } from "../src/contract.js";
import { SEED_FAQ_ENTRIES, SEEDABLE_ROOTS } from "../src/edit-seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

const tempDirs: string[] = [];
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-edit-"));
  tempDirs.push(dir);
  // The committed fixture is the reference workspace AND the writer's input
  // shape: single-line scalars (decision of 2026-10-21, #249). No rewrite.
  cpSync(MINIMAL, dir, { recursive: true });
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

/** A workspace with NO addressable rows: `pasco init` scaffolds identity.yaml
 *  with only `name` (no links, no headlines/bios/positioning). */
function emptyWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-edit-list-"));
  tempDirs.push(dir);
  const res = spawnSync(process.execPath, [CLI, "init", dir], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (res.error !== undefined) throw res.error;
  if (res.status !== 0) throw new Error(`pasco init failed: ${res.stderr}`);
  return dir;
}

/** The committed `faq[]` shape (#288): 3 rows (the schema floor), one with a
 *  Spanish value and a `source`, so the per-lang and source addresses have a row
 *  and the optional-field rule (0 rows) is reachable. */
const FAQ_FIXTURE = `# the answer surface (v1.10, #288) — 3 rows is the floor
- id: what-is-elena
  q:
    en: What does Elena Vasquez do?
    es: ¿A qué se dedica Elena Vasquez?
  a:
    en: Elena Vasquez is an AI engineer building sovereign, open-source infrastructure for education.
    es: Elena Vasquez es ingeniera de IA que construye infraestructura soberana de código abierto.
  source: https://example.com/about
- id: where-based
  q:
    en: Where is Elena Vasquez based?
  a:
    en: Elena Vasquez is based in Madrid, Spain.
- id: why-profile-as-code
  q:
    en: Why profile-as-code?
  a:
    en: One identity must stay consistent across every platform.
`;

/** The `minimal` workspace plus the two answer-engine fields #435 addresses:
 *  a definition in identity.yaml and a root faq.yaml. */
function answerWorkspace(): string {
  const dir = workspace();
  const identity = join(dir, "content", "identity.yaml");
  writeFileSync(
    identity,
    `${readFileSync(identity, "utf8")}definition:\n  en: Elena Vasquez is an AI engineer building sovereign AI infrastructure.\n`,
  );
  writeFileSync(join(dir, "content", "faq.yaml"), FAQ_FIXTURE);
  return dir;
}

/** The contract caps, read from the schema itself so the CLI's pre-flight table
 *  cannot drift from the contract it claims to cite (#288). */
function schemaCaps(): { definition: number; q: number; a: number } {
  const schema = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "schema", "profile.schema.json"), "utf8"),
  ) as {
    $defs: {
      definition: { additionalProperties: { maxLength: number } };
      faqEntry: {
        properties: {
          q: { additionalProperties: { maxLength: number } };
          a: { additionalProperties: { maxLength: number } };
        };
      };
    };
  };
  return {
    definition: schema.$defs.definition.additionalProperties.maxLength,
    q: schema.$defs.faqEntry.properties.q.additionalProperties.maxLength,
    a: schema.$defs.faqEntry.properties.a.additionalProperties.maxLength,
  };
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
    const dir = workspace();
    // The committed fixture is single-line by design (decision of 2026-10-21);
    // this workspace wraps one bio to pin the shape both paths must refuse.
    const bios = join(dir, "content", "bios.yaml");
    writeFileSync(
      bios,
      readFileSync(bios, "utf8").replace(
        "  text: Senior AI engineer designing local-first LLM infrastructure used by 12+ deployments. Previously ML engineer at Dataforge. 8 years in ML platforms.",
        "  text: Senior AI engineer designing local-first\n    LLM infrastructure.",
      ),
    );
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

  it("--json carries the full edit payload (incl. stale + drift)", () => {
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
      [
        "address",
        "current",
        "drift",
        "noop",
        "ok",
        "proposed",
        "reason",
        "rendered",
        "stale",
        "state",
        "limit",
        "over",
        "variant",
        "warnings",
        "written",
      ].sort(),
    );
    expect(inner.address).toBe("headlines[platform=github-readme,lang=en].text");
    expect(inner.current).toBe("Sovereign AI infrastructure engineer");
    expect(inner.proposed).toBe("Sovereign AI infra");
    expect(inner.rendered).toBe("### Sovereign AI infra");
    expect(inner.ok).toBe(true);
    expect(inner.noop).toBe(false);
    expect(inner.written).toBe(false);
    expect(inner.stale).toEqual({});
    // A recorded surface would read in-sync|stale; with no record the unit's
    // rollup is `never` (the acceptance's "no record reads never").
    expect(inner.state).toBe("never");
    // content/checks.yaml declares gh-bio-max (1000) without a `surface`, so it
    // scopes both rows (the executor's rule) — the workspace policy wins.
    expect(inner.limit).toEqual({ cap: 1000, source: "(no source recorded)", tier: "?" });
    expect(inner.variant).toBeNull();
    expect(inner.reason).toBeNull();
    expect(inner.over).toBe(false);
    expect(typeof inner.drift).toBe("number");
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

  it("warns before the paste when the value exceeds the sourced cap (S4, #251)", () => {
    const dir = workspace();
    rmSync(join(dir, "content", "checks.yaml")); // fall back to the DEFAULT_CHECK catalog
    const r = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "x".repeat(300),
      "--check",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = json(r);
    expect(parsed.data.over).toBe(true);
    const limit = parsed.data.limit as { cap: number; source: string; tier: string };
    expect(limit.cap).toBe(280);
    expect(limit.tier).toBe("?");
    expect(limit.source).toContain("editorial soft cap");
    expect(limit.source).toMatch(/\[\?\]|\[OFICIAL\]|\[EXPERTO\]|\[BENCHMARK\]/);

    const text = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "x".repeat(300),
      "--check",
    );
    expect(text.stdout).toContain("OVER");
    expect(text.stderr).toContain("over the published cap 280");
  });

  it("prints a real source's tier ONCE and parses it anywhere in the note", () => {
    const dir = workspace();
    writeFileSync(
      join(dir, "content", "checks.yaml"),
      "- id: gh-headline-official\n  platform: github-readme\n  rule: max-chars\n  value: 100\n  surface: headline\n  note: 'Upwork Help Center (2026-01-02) [OFICIAL] — documented title limit.'\n",
    );
    const r = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "x".repeat(150),
      "--check",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = json(r);
    expect((parsed.data.limit as { tier: string }).tier).toBe("OFICIAL");
    expect(parsed.data.over).toBe(true);

    const text = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "x".repeat(150),
      "--check",
    );
    // The note IS the evidence text, so the tier must appear exactly once.
    expect(text.stdout.split("[OFICIAL]").length - 1).toBe(1);
    // …and the over-cap finding rides the machine-readable warnings bucket.
    expect((json(r).data.warnings as string[]).length).toBeGreaterThan(0);
  });

  it("takes the STRICTEST cap, prefers the platform's own row, and scopes by surface", () => {
    const dir = workspace();
    writeFileSync(
      join(dir, "content", "checks.yaml"),
      [
        "- {id: all-bio, platform: all, rule: max-chars, value: 100, surface: bio, note: '[EXPERTO] broad'}",
        "- {id: up-bio, platform: upwork, rule: max-chars, value: 50, surface: bio, note: '[OFICIAL] own row'}",
        "- {id: up-head, platform: upwork, rule: max-chars, value: 999, surface: headline, note: '[OFICIAL] headline only'}",
      ].join("\n"),
    );
    const bio = edit(
      dir,
      "bios[platform=upwork,lang=en,length=long].text",
      "--set",
      "y".repeat(120),
      "--check",
      "--json",
    );
    const limit = json(bio).data.limit as { cap: number; tier: string };
    expect(limit.cap).toBe(50); // strictest wins
    expect(limit.tier).toBe("OFICIAL"); // the OWN row's evidence wins the tie
    const human = edit(
      dir,
      "bios[platform=upwork,lang=en,length=long].text",
      "--set",
      "y".repeat(120),
      "--check",
    );
    expect(human.stdout).toContain("(up-bio)"); // the own row is named, not all-bio

    const head = edit(
      dir,
      "headlines[platform=upwork,lang=en].text",
      "--set",
      "z".repeat(1200),
      "--check",
      "--json",
    );
    expect((json(head).data.limit as { cap: number }).cap).toBe(999); // surface scoping
  });

  it("surfaces a malformed catalog row as a warning instead of skipping it silently", () => {
    const dir = workspace();
    writeFileSync(
      join(dir, "content", "checks.yaml"),
      "- {id: broken, platform: github-readme, rule: max-chars, value: many, surface: headline}\n",
    );
    const r = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "a value",
      "--check",
      "--json",
    );
    const warnings = json(r).data.warnings as string[];
    expect(warnings.some((w) => w.includes("non-numeric"))).toBe(true);
  });

  it("uses the workspace's own catalog over the defaults", () => {
    const dir = workspace(); // content/checks.yaml: x-bio-short = 280
    const r = edit(
      dir,
      "bios[platform=x,lang=en,length=short].text",
      "--set",
      "y".repeat(300),
      "--check",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = json(r);
    expect(parsed.data.over).toBe(true);
    expect((parsed.data.limit as { cap: number }).cap).toBe(280);
  });

  it("says cap unknown when the catalog has no sourced cap", () => {
    const dir = workspace();
    rmSync(join(dir, "content", "checks.yaml")); // DEFAULT_CHECK has no linkedin cap
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "A short bio.",
      "--check",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = json(r);
    expect(parsed.data.limit).toBeNull();
    expect(parsed.data.over).toBe(false);
  });

  it("never BLOCKS an over-cap write (D12: facts warn)", () => {
    const dir = workspace();
    rmSync(join(dir, "content", "checks.yaml"));
    const r = edit(
      dir,
      "headlines[platform=upwork,lang=en].text",
      "--set",
      "x".repeat(80),
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = json(r);
    expect(parsed.data.written).toBe(true);
    expect(parsed.data.over).toBe(true);
  });

  it("reports the recorded surface as stale (S3, #250)", () => {
    const dir = workspace();
    writeFileSync(
      join(dir, "content", "deployments.yaml"),
      'bios:linkedin:en:medium:\n  linkedin:\n    deployedAt: "2025-01-15T09:30:00Z"\n    contentHash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n    source: manual\n',
    );
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Nueva bio.",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = json(r);
    expect(parsed.data.stale).toEqual({ linkedin: "stale" });
    expect(parsed.data.drift).toBe(0);

    const text = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Otra bio.",
      "--check",
    );
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("surface impact (bios:linkedin:en:medium");
    expect(text.stdout).toContain("linkedin → stale");
  });

  it("reads never when the unit has no ledger record", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Sin ledger.",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("never — no ledger record for this unit");
    expect(r.stdout).toContain("drift: 0");
  });

  it("reads in-sync when the record's hash still matches (noop)", () => {
    const dir = workspace();
    const unit = trackableUnits(load(dir)).find((u) => u.key === "bios:linkedin:en:medium");
    expect(unit).toBeDefined();
    writeFileSync(
      join(dir, "content", "deployments.yaml"),
      `bios:linkedin:en:medium:\n  linkedin:\n    deployedAt: "2025-01-15T09:30:00Z"\n    contentHash: ${unit?.hash}\n    source: manual\n`,
    );
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Senior AI engineer designing local-first LLM infrastructure used by 12+ deployments. Previously ML engineer at Dataforge. 8 years in ML platforms.",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = json(r);
    expect(parsed.data.stale).toEqual({ linkedin: "in-sync" });
    expect(parsed.data.state).toBe("in-sync");
  });

  it("keys the impact by the unit family (headline, statement) and lists every recorded surface", () => {
    const dir = workspace();
    writeFileSync(
      join(dir, "content", "deployments.yaml"),
      'headlines:github-readme:en:\n  github-readme:\n    deployedAt: "2025-01-15T09:30:00Z"\n    contentHash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n    source: git\npositioning:\n  github-readme:\n    deployedAt: "2025-01-15T09:30:00Z"\n    contentHash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n    source: git\n  linkedin:\n    deployedAt: "2025-01-15T09:30:00Z"\n    contentHash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n    source: manual\n',
    );
    const headline = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "H2",
      "--json",
    );
    expect(headline.code).toBe(0);
    expect(json(headline).data.stale).toEqual({ "github-readme": "stale" });

    const statement = edit(dir, "positioning.statement.en", "--set", "S2", "--json");
    expect(statement.code).toBe(0);
    expect(json(statement).data.stale).toEqual({ "github-readme": "stale", linkedin: "stale" });
  });

  it("reads stale when the seeded record holds the PRE-edit hash (pre/post discrimination)", () => {
    const dir = workspace();
    const unit = trackableUnits(load(dir)).find((u) => u.key === "bios:linkedin:en:medium");
    writeFileSync(
      join(dir, "content", "deployments.yaml"),
      `bios:linkedin:en:medium:\n  linkedin:\n    deployedAt: "2025-01-15T09:30:00Z"\n    contentHash: ${unit?.hash}\n    source: manual\n`,
    );
    // Different value → the applied unit hash differs from the record's hash.
    // If the impact were computed on the PRE-edit profile it would read in-sync.
    const r = edit(
      dir,
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "A different bio.",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = json(r);
    expect(parsed.data.stale).toEqual({ linkedin: "stale" });
    expect(parsed.data.state).toBe("stale");
  });

  it("does not run the ambiguous branch for a one-row link read (N1 regression)", () => {
    const dir = workspace();
    const r = edit(dir, "identity.links[platform=github].url");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("current:  https://github.com/elenavasquez");
    expect(r.stdout).not.toContain("resolves to");
  });

  it("measures drift even when nothing is proposed (F1)", () => {
    const dir = workspace();
    const headlines = join(dir, "content", "headlines.yaml");
    writeFileSync(
      headlines,
      `${readFileSync(headlines, "utf8")}- platform: x\n  lang: en\n  text: A duplicate headline.\n`,
    );
    const r = edit(dir, "positioning.statement.en", "--json");
    expect(r.code).toBe(0);
    expect(json(r).data.drift).toBeGreaterThan(0);
  });

  it("names the variant that shadows a STATEMENT edit, in warnings and reason", () => {
    const dir = workspace();
    mkdirSync(join(dir, "profiles", "github-readme", "variants"), { recursive: true });
    writeFileSync(
      join(dir, "profiles", "github-readme", "variants", "gh-en-2025-01.md"),
      "# Body\n",
    );
    const r = edit(dir, "positioning.statement.en", "--set", "Otro.", "--json");
    const parsed = json(r);
    const warnings = parsed.data.warnings as string[];
    expect(warnings.some((w) => w.includes("gh-en-2025-01"))).toBe(true);
    expect(String(parsed.data.reason)).toContain("gh-en-2025-01");
  });

  it("carries the machine-readable miss reason (S5)", () => {
    const dir = workspace();
    const r = edit(
      dir,
      "headlines[platform=upwork,lang=en].text",
      "--set",
      "H2",
      "--check",
      "--json",
    );
    expect(r.code).toBe(1);
    const parsed = json(r);
    expect(typeof parsed.data.reason).toBe("string");
    expect(String(parsed.data.reason).length).toBeGreaterThan(0);
  });

  it("names the variant on the WRITE path too (exit 0)", () => {
    const dir = workspace();
    mkdirSync(join(dir, "profiles", "github-readme", "variants"), { recursive: true });
    writeFileSync(
      join(dir, "profiles", "github-readme", "variants", "gh-en-2025-01.md"),
      "# Body\n",
    );
    const r = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "Nuevo",
      "--json",
    );
    expect(r.code).toBe(0);
    expect(json(r).data.variant).toBe("gh-en-2025-01");
  });

  it("names the active variant shadowing the addressed platform (S5, #238 guard)", () => {
    const dir = workspace();
    mkdirSync(join(dir, "profiles", "github-readme", "variants"), { recursive: true });
    writeFileSync(
      join(dir, "profiles", "github-readme", "variants", "gh-en-2025-01.md"),
      "# Body\n",
    );
    const r = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "Nuevo",
      "--check",
      "--json",
    );
    expect(r.code).toBe(1); // the artifact is the variant body: the edit does not reach it
    const parsed = json(r);
    expect(parsed.data.variant).toBe("gh-en-2025-01");

    const human = edit(
      dir,
      "headlines[platform=github-readme,lang=en].text",
      "--set",
      "Nuevo",
      "--check",
    );
    expect(human.stdout).toContain("variant:  gh-en-2025-01 is active for github-readme");
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

describe("edit --list — read-only discovery (#411)", () => {
  it("prints every addressable row, one per line, links marked read-only, touching nothing", () => {
    const dir = workspace();
    const before = workspaceHash(dir);
    const r = edit(dir, "--list");
    expect(r.code).toBe(0);
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("addresses:");
    const listed = lines.slice(1);
    // The addressable blocks, in contract order: statement → headline → bio →
    // identity.definition → link → faq (the middle/last are empty here).
    expect(listed[0]).toBe("positioning.statement.en");
    expect(listed).toContain("headlines[platform=github-readme,lang=en].text");
    expect(listed).toContain("bios[platform=linkedin,lang=es,length=medium].text");
    expect(listed).toContain("identity.links[platform=github,label=GitHub].url  (read-only)");
    expect(listed.at(-1)).toBe("identity.links[platform=substack,label=Substack].url  (read-only)");
    // Every link row is marked; no writable row is.
    for (const line of listed) {
      expect(line.endsWith("  (read-only)")).toBe(line.startsWith("identity.links["));
    }
    // No duplicate address: an address that resolves to several rows is not
    // addressable, so it is never advertised twice.
    expect(new Set(listed).size).toBe(listed.length);
    // Deterministic: the same workspace lists the same bytes.
    expect(edit(dir, "--list").stdout).toBe(r.stdout);
    // Read-only: no lock, no content file, nothing on disk moved.
    expect(r.stderr).toBe("");
    expect(workspaceHash(dir)).toBe(before);
  });

  it("carries the machine contract: data.addresses[{address,kind,readOnly}] + warnings", () => {
    const dir = workspace();
    const r = edit(dir, "--list", "--json");
    expect(r.code).toBe(0);
    const data = json(r).data as {
      addresses: { address: string; kind: string; readOnly: boolean }[];
      warnings: string[];
    };
    expect(data.warnings).toEqual([]);
    expect(data.addresses[0]).toEqual({
      address: "positioning.statement.en",
      kind: "statement",
      readOnly: false,
    });
    expect(data.addresses.at(-1)).toEqual({
      address: "identity.links[platform=substack,label=Substack].url",
      kind: "link",
      readOnly: true,
    });
    // Every entry round-trips through the address grammar (one grammar, no drift).
    for (const entry of data.addresses) {
      expect(() => parseEditAddress(entry.address)).not.toThrow();
    }
  });

  it("scopes to one block with --list <block>", () => {
    const dir = workspace();
    const r = edit(dir, "--list", "headlines");
    expect(r.code).toBe(0);
    const listed = r.stdout.trimEnd().split("\n").slice(1);
    expect(listed.length).toBeGreaterThan(0);
    for (const line of listed) expect(line.startsWith("headlines[")).toBe(true);
    expect(edit(dir, "--list", "positioning").stdout.trimEnd().split("\n").slice(1)).toEqual([
      "positioning.statement.en",
      "positioning.statement.es",
    ]);
  });

  it("lists only addresses that resolve to exactly one row", () => {
    const dir = workspace();
    const profile = load(dir);
    const data = json(edit(dir, "--list", "--json")).data as {
      addresses: { address: string }[];
    };
    for (const entry of data.addresses) {
      expect(resolveEditTarget(profile, parseEditAddress(entry.address), dir).matches).toBe(1);
    }
  });

  it("reports ambiguous or inexpressible rows instead of advertising a path edit rejects", () => {
    const dir = workspace();
    // Each of these is schema-legal and, if listed, would be an address `edit`
    // rejects (exit 1 for N>1 rows) or silently trims onto a different row.
    const headlines = join(dir, "content", "headlines.yaml");
    writeFileSync(
      headlines,
      `${readFileSync(headlines, "utf8")}- platform: github-readme\n  lang: en\n  text: Duplicate row\n`,
    );
    const identity = join(dir, "content", "identity.yaml");
    writeFileSync(
      identity,
      `${readFileSync(identity, "utf8")}  - platform: example\n    label: " Padded "\n    url: https://example.com/padded\n  - platform: example\n    label: ""\n    url: https://example.com/empty\n  - platform: shared\n    label: One\n    url: https://example.com/one\n  - platform: shared\n    url: https://example.com/two\n`,
    );
    const r = edit(dir, "--list", "--json");
    expect(r.code).toBe(0);
    const data = json(r).data as { addresses: { address: string }[]; warnings: string[] };
    const listed = data.addresses.map((entry) => entry.address);
    expect(listed).not.toContain("headlines[platform=github-readme,lang=en].text");
    expect(listed.some((address) => address.includes("Padded"))).toBe(false);
    expect(listed.some((address) => address.includes("example"))).toBe(false);
    expect(listed).not.toContain("identity.links[platform=shared].url");
    expect(listed).toContain("identity.links[platform=shared,label=One].url");
    expect(data.warnings.join("\n")).toContain("resolves to 2 rows");
    // The invariant the review's F1/F2 broke: everything left is usable.
    const profile = load(dir);
    for (const address of listed) {
      expect(resolveEditTarget(profile, parseEditAddress(address), dir).matches).toBe(1);
    }
  });

  it("decides usage before reading the workspace config (a bad .pascorc stays exit 2)", () => {
    const dir = workspace();
    writeFileSync(join(dir, ".pascorc"), "{not json");
    // The non-list usage check and the --list flag combinations are decided
    // BEFORE resolveWorkspace/readWorkspacePascorc: an unreadable config must
    // not turn a usage error into exit 1 (review round 3, F1).
    expect(edit(dir, "a", "b").code).toBe(2);
    expect(edit(dir, "--list", "--set", "x").code).toBe(2);
    expect(edit(dir, "--list", "nope").code).toBe(2);
    // A valid --list still needs the workspace to load: that is a real read.
    expect(edit(dir, "--list").code).toBe(1);
  });

  it("says `--list <address>` takes a block, not an address", () => {
    const dir = workspace();
    const r = edit(dir, "--list", "positioning.statement.en");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--list takes a block, not an address");
  });

  it("falls back to the platform-only address for an inexpressible label", () => {
    const dir = workspace();
    const identity = join(dir, "content", "identity.yaml");
    writeFileSync(
      identity,
      `${readFileSync(identity, "utf8")}  - platform: example\n    label: "Doe, Jane"\n    url: https://example.com/jane\n  - platform: ctrl\n    label: "A\\tB"\n    url: https://example.com/ctrl\n`,
    );
    const r = edit(dir, "--list", "identity.links", "--json");
    expect(r.code).toBe(0);
    const data = json(r).data as {
      addresses: { address: string }[];
      warnings: string[];
    };
    // A label the grammar cannot express never drops a row `edit` can address:
    // the platform-only form resolves to the one row (the review's F1).
    expect(data.addresses.map((entry) => entry.address)).toContain(
      "identity.links[platform=example].url",
    );
    expect(data.addresses.map((entry) => entry.address)).toContain(
      "identity.links[platform=ctrl].url",
    );
    expect(data.warnings.join("\n")).toContain('label "Doe, Jane"');
    const human = edit(dir, "--list", "identity.links");
    expect(human.stdout).not.toContain("Doe");
    // One address per line: a control character in a label never splits a line.
    expect(human.stdout.trimEnd().split("\n")).toHaveLength(data.addresses.length + 1);
    expect(human.stderr).toContain("warning:");
  });

  it("prints the header and nothing else on a workspace with no addressable row", () => {
    const dir = emptyWorkspace();
    const r = edit(dir, "--list");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("addresses:\n");
    const data = json(edit(dir, "--list", "--json")).data as { addresses: unknown[] };
    expect(data.addresses).toEqual([]);
  });
});

describe("exit-code matrix (S5, #252)", () => {
  const cases: [string, string[], number][] = [
    ["read → 0", ["positioning.statement.en"], 0],
    ["write → 0", ["bios[platform=linkedin,lang=en,length=medium].text", "--set", "New bio."], 0],
    [
      "noop → 0",
      [
        "positioning.statement.en",
        "--set",
        "AI engineer building sovereign, open-source AI infrastructure for education.",
      ],
      0,
    ],
    [
      "preview that changes the artifact → 0",
      ["headlines[platform=github-readme,lang=en].text", "--set", "H2", "--check"],
      0,
    ],
    [
      "preview that does not reach the artifact → 1",
      ["headlines[platform=upwork,lang=en].text", "--set", "H2", "--check"],
      1,
    ],
    ["0 rows → 1", ["headlines[platform=upwork,lang=fr].text"], 1],
    ["read-only link --set → 2", ["identity.links[platform=github].url", "--set", "x"], 2],
    ["unknown address → 2", ["positioning.foo"], 2],
    ["unknown platform → 2", ["headlines[platform=gitlab,lang=en].text"], 2],
    ["unknown language → 2", ["headlines[platform=github-readme,lang=de].text"], 2],
    ["--check without --set → 2", ["positioning.statement.en", "--check"], 2],
    ["empty --set → 2", ["positioning.statement.en", "--set", ""], 2],
    ["line break in --set → 2", ["positioning.statement.en", "--set", "a\nb"], 2],
    ["--list → 0", ["--list"], 0],
    ["--list <block> → 0", ["--list", "bios"], 0],
    ["--list unknown block → 2", ["--list", "nope"], 2],
    ["--list with an address → 2", ["--list", "positioning.statement.en"], 2],
    ["--list with --set → 2", ["--list", "--set", "x"], 2],
    ["--list with --check → 2", ["--list", "--check"], 2],
    ["--list with --create → 2", ["--list", "--create", "faq"], 2],
    ["--create → 0", ["--create", "faq"], 0],
    ["--create --check → 0", ["--create", "faq", "--check"], 0],
    ["--create unknown root → 2", ["--create", "projects"], 2],
    ["--create with --set → 2", ["--create", "faq", "--set", "x"], 2],
    ["--create with an address → 2", ["--create", "faq", "positioning.statement.en"], 2],
  ];
  for (const [name, args, code] of cases) {
    it(name, () => {
      const dir = workspace();
      expect(edit(dir, ...args).code).toBe(code);
    });
  }
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
        "  text: Senior AI engineer designing local-first LLM infrastructure used by 12+ deployments. Previously ML engineer at Dataforge. 8 years in ML platforms.\n",
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

describe("pasco edit — the answer-engine surface (#435)", () => {
  it("resolves identity.definition.<lang> and states its contract cap", () => {
    const dir = answerWorkspace();
    const r = edit(dir, "identity.definition.en");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("address:  identity.definition.en");
    expect(r.stdout).toContain("current:  Elena Vasquez is an AI engineer building sovereign");
    expect(r.stdout).toContain(`chars vs cap ${schemaCaps().definition} — ok`);
    expect(r.stdout).toContain("[OFICIAL] the v1.10 contract itself");
    // The §19 unit is `identity` (a root block), not a fabricated row key.
    expect(r.stdout).toContain("surface impact (identity —");
  });

  it("refuses a definition over the contract cap, and the preview says OVER", () => {
    const dir = answerWorkspace();
    const over = "x".repeat(schemaCaps().definition + 1);
    const preview = edit(dir, "identity.definition.en", "--set", over, "--check");
    expect(preview.stdout).toContain(`chars vs cap ${schemaCaps().definition} — OVER`);
    // `--check` only previews (nothing written), so its own exit stays 0; the
    // WRITE is what the schema refuses.
    expect(preview.code).toBe(0);
    // The write is refused by the same schema gate: the file keeps its value.
    const write = edit(dir, "identity.definition.en", "--set", over);
    expect(write.code).toBe(1);
    expect(readFileSync(join(dir, "content", "identity.yaml"), "utf8")).toContain(
      "Elena Vasquez is an AI engineer building sovereign",
    );
  });

  it("reports 0 rows for an undeclared definition language, listing the ones it has", () => {
    const dir = answerWorkspace();
    const r = edit(dir, "identity.definition.fr");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("resolves to 0 rows");
    const available = r.stdout.split("available:")[1] ?? "";
    expect(available).toContain("identity.definition.en");
    expect(available).not.toContain("identity.definition.fr");
  });

  it("PREVIEWS identity.definition as the artifact JSON-LD line that changes", () => {
    const dir = answerWorkspace();
    const before = workspaceHash(dir);
    const r = edit(
      dir,
      "identity.definition.en",
      "--set",
      "Elena Vasquez is an AI engineer and writer.",
      "--check",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("published (github-readme/en");
    expect(r.stdout).toContain(
      '  -   "description": "Elena Vasquez is an AI engineer building sovereign AI infrastructure."',
    );
    expect(r.stdout).toContain(
      '  +   "description": "Elena Vasquez is an AI engineer and writer."',
    );
    // A preview never writes (the S1 invariant the whole file rests on).
    expect(workspaceHash(dir)).toBe(before);
  });

  it("WRITES identity.definition with the range splice (one line, comments intact)", () => {
    const dir = answerWorkspace();
    const identity = join(dir, "content", "identity.yaml");
    const before = readFileSync(identity, "utf8");
    const r = edit(dir, "identity.definition.en", "--set", "Elena Vasquez is an AI engineer.");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("file:     content/identity.yaml");
    expect(r.stdout).toContain("written: yes");
    const after = readFileSync(identity, "utf8");
    // Nothing but the addressed scalar moved: the fixture's links and name stay.
    expect(after).toContain("name: Elena Vasquez");
    expect(after).toContain("url: https://github.com/elenavasquez");
    const changed = after.split("\n").filter((line, index) => line !== before.split("\n")[index]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("en: Elena Vasquez is an AI engineer.");
  });

  it("resolves faq q/a (per lang, EN required by the schema) and source", () => {
    const dir = answerWorkspace();
    const q = edit(dir, "faq[id=what-is-elena,lang=en].q");
    expect(q.code).toBe(0);
    expect(q.stdout).toContain("current:  What does Elena Vasquez do?");
    expect(q.stdout).toContain("chars vs cap 90 — ok");

    const es = edit(dir, "faq[id=what-is-elena,lang=es].q");
    expect(es.code).toBe(0);
    expect(es.stdout).toContain("current:  ¿A qué se dedica Elena Vasquez?");

    const source = edit(dir, "faq[id=what-is-elena].source");
    expect(source.code).toBe(0);
    expect(source.stdout).toContain("current:  https://example.com/about");

    // A required, ordinary row read: no global-unit impact to report.
    const jsonSource = edit(dir, "faq[id=what-is-elena].source", "--json");
    const data = json(jsonSource).data as { state: unknown; limit: unknown };
    expect(data.state).toBeNull();
    expect(data.limit).toBeNull();
  });

  it("reports 0 rows for a field the row does not carry, and never invents it", () => {
    const dir = answerWorkspace();
    const missingLang = edit(dir, "faq[id=where-based,lang=es].q");
    expect(missingLang.code).toBe(1);
    expect(missingLang.stdout).toContain("resolves to 0 rows");
    expect(missingLang.stdout).toContain("faq[id=where-based,lang=en].q");

    const missingSource = edit(dir, "faq[id=where-based].source");
    expect(missingSource.code).toBe(1);
    expect(missingSource.stdout).toContain("resolves to 0 rows");
    expect(missingSource.stdout).toContain("faq[id=what-is-elena].source");
  });

  it("previews the FAQPage node `pasco entity --jsonld` emits, not the raw row", () => {
    const dir = answerWorkspace();
    const r = edit(
      dir,
      "faq[id=what-is-elena,lang=en].q",
      "--set",
      "What is Elena Vasquez known for?",
      "--check",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("published (entity/en");
    expect(r.stdout).toContain('  -       "name": "What does Elena Vasquez do?",');
    expect(r.stdout).toContain('  +       "name": "What is Elena Vasquez known for?",');
  });

  it("writes q/a/source and leaves the other rows byte-identical", () => {
    const dir = answerWorkspace();
    const faq = join(dir, "content", "faq.yaml");
    const q = edit(dir, "faq[id=why-profile-as-code,lang=en].q", "--set", "Why profile as code?");
    expect(q.code).toBe(0);
    expect(q.stdout).toContain("file:     content/faq.yaml");
    const a = edit(
      dir,
      "faq[id=why-profile-as-code,lang=en].a",
      "--set",
      "One identity must stay consistent everywhere.",
    );
    expect(a.code).toBe(0);
    // `source` is an OPTIONAL scalar: an existing one is writable, an absent one
    // is a 0-row address (tested above) — the writer never invents the field.
    const source = edit(dir, "faq[id=what-is-elena].source", "--set", "https://example.com/x");
    expect(source.code).toBe(0);
    expect(readFileSync(faq, "utf8")).toContain("source: https://example.com/x");
    // The untouched rows still hold their values.
    expect(readFileSync(faq, "utf8")).toContain("en: Where is Elena Vasquez based?");
  });

  it("refuses an ambiguous faq id instead of choosing a row", () => {
    const dir = answerWorkspace();
    const faq = join(dir, "content", "faq.yaml");
    writeFileSync(
      faq,
      `${readFileSync(faq, "utf8")}- id: where-based\n  q:\n    en: Duplicate question?\n  a:\n    en: Duplicate answer.\n`,
    );
    const r = edit(dir, "faq[id=where-based,lang=en].q");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("resolves to 2 rows");
    expect(r.stdout).toContain("several faq rows share this id");
    expect(r.stdout).toContain("Where is Elena Vasquez based?");
    expect(r.stdout).toContain("Duplicate question?");
  });

  it("refuses a malformed faq address with the grammar that lists the new rows", () => {
    const dir = answerWorkspace();
    const missingLang = edit(dir, "faq[id=what-is-elena].q");
    expect(missingLang.code).toBe(2);
    expect(missingLang.stderr).toContain('missing selector "lang"');
    expect(missingLang.stderr).toContain("faq[id=<slug>,lang=<l>].q | .a");
    expect(missingLang.stderr).toContain("identity.definition.<lang>");

    const badId = edit(dir, "faq[id=Not A Slug,lang=en].q");
    expect(badId.code).toBe(2);
    expect(badId.stderr).toContain("not a valid entry id");

    const badField = edit(dir, "faq[id=what-is-elena].url");
    expect(badField.code).toBe(2);
    expect(badField.stderr).toContain("not addressable");
  });

  it("pre-flights the contract cap: over-cap previews a warning, the write is refused by the schema", () => {
    const dir = answerWorkspace();
    const over = "x".repeat(schemaCaps().q + 1);
    const preview = edit(dir, "faq[id=what-is-elena,lang=en].q", "--set", over, "--check");
    expect(preview.code).toBe(0); // the FAQPage node changes
    expect(preview.stdout).toContain(`chars vs cap ${schemaCaps().q} — OVER`);
    expect(preview.stderr).toContain("over the contract cap");
    expect(preview.stderr).toContain("the schema refuses the write");

    const write = edit(dir, "faq[id=what-is-elena,lang=en].q", "--set", over);
    expect(write.code).toBe(1);
    expect(write.stderr).toContain("validation failed");
    expect(write.stderr).toContain("Too big");
  });

  it("lists the new addresses under their blocks, built by the same constructors", () => {
    const dir = answerWorkspace();
    const definition = edit(dir, "--list", "identity.definition");
    expect(definition.code).toBe(0);
    expect(definition.stdout.trimEnd().split("\n")).toEqual([
      "addresses:",
      "identity.definition.en",
    ]);

    const faq = edit(dir, "--list", "faq", "--json");
    const data = json(faq).data as { addresses: { address: string; kind: string }[] };
    expect(data.addresses.map((entry) => entry.address)).toEqual([
      "faq[id=what-is-elena,lang=en].q",
      "faq[id=what-is-elena,lang=en].a",
      "faq[id=what-is-elena,lang=es].q",
      "faq[id=what-is-elena,lang=es].a",
      "faq[id=what-is-elena].source",
      "faq[id=where-based,lang=en].q",
      "faq[id=where-based,lang=en].a",
      "faq[id=why-profile-as-code,lang=en].q",
      "faq[id=why-profile-as-code,lang=en].a",
    ]);
    for (const entry of data.addresses) expect(entry.kind).toBe("faq");
    // Every listed address round-trips and resolves to exactly one row.
    const profile = load(dir);
    for (const entry of data.addresses) {
      expect(resolveEditTarget(profile, parseEditAddress(entry.address), dir).matches).toBe(1);
    }
  });

  it("locate carries the FILE-relative and merged-profile paths for faq", () => {
    const dir = answerWorkspace();
    const profile = load(dir);
    const q = resolveEditTarget(profile, parseEditAddress("faq[id=what-is-elena,lang=es].q"), dir);
    expect(q.locate).toEqual({
      file: "content/faq.yaml",
      path: [0, "q", "es"],
      profilePath: ["faq", 0, "q", "es"],
    });
    const source = resolveEditTarget(profile, parseEditAddress("faq[id=where-based].source"), dir);
    // The row exists but carries no source: no write handle for an absent scalar.
    expect(source.matches).toBe(0);
    expect(source.locate).toBeUndefined();
  });
});

describe("pasco edit --create — seeding a missing root (#435)", () => {
  it("--check prints the seed it validated and writes nothing", () => {
    const dir = workspace();
    const r = edit(dir, "--create", "faq", "--check");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("--- seed (nothing was written) ---");
    // The template itself, not just its label: the pair the schema floor requires.
    expect(r.stdout).toContain("- id: question-1");
    expect(r.stdout).toContain("<the first question this entity answers>");
    expect(existsSync(join(dir, "content", "faq.yaml"))).toBe(false);
  });
  it("--check accepts the facts/ file form on a facts/ workspace (D30)", () => {
    const dir = workspace();
    renameSync(join(dir, "content"), join(dir, "facts"));
    const r = edit(dir, "--create", "facts/faq.yaml", "--check");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("root:     faq");
    expect(r.stdout).toContain("file:     facts/faq.yaml");
    expect(existsSync(join(dir, "facts", "faq.yaml"))).toBe(false);
  });

  it("accepts the facts/ file form on a facts/ workspace (D30)", () => {
    const dir = workspace();
    renameSync(join(dir, "content"), join(dir, "facts"));
    const r = edit(dir, "--create", "facts/faq.yaml", "--check");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("root:     faq");
    expect(r.stdout).toContain("file:     facts/faq.yaml");
    expect(existsSync(join(dir, "facts", "faq.yaml"))).toBe(false);
  });

  it("--check validates the seed and writes nothing", () => {
    const dir = workspace();
    const before = workspaceHash(dir);
    const r = edit(dir, "--create", "content/faq.yaml", "--check");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("root:     faq");
    expect(r.stdout).toContain("file:     content/faq.yaml");
    expect(r.stdout).toContain("would create: yes");
    expect(r.stdout).toContain("validates: yes");
    expect(existsSync(join(dir, "content", "faq.yaml"))).toBe(false);
    expect(workspaceHash(dir)).toBe(before);
  });

  it("writes a schema-valid seed and is idempotent-refused on the second run", () => {
    const dir = workspace();
    const r = edit(dir, "--create", "faq");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("written:  yes");
    const faq = join(dir, "content", "faq.yaml");
    expect(existsSync(faq)).toBe(true);

    // The seed passes the same gate every read uses (schema + ledger + registry).
    const profile = load(dir);
    expect(profile.faq).toHaveLength(SEED_FAQ_ENTRIES.length);
    expect(profile.faq.map((row) => row.id)).toEqual(SEED_FAQ_ENTRIES.map((entry) => entry.id));
    expect(profile.faq.map((row) => row.q.en)).toEqual(SEED_FAQ_ENTRIES.map((entry) => entry.q));
    expect(run(dir, "validate").code).toBe(0);

    const before = readFileSync(faq, "utf8");
    const second = edit(dir, "--create", "faq");
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("already exists");
    expect(second.stderr).toContain("never overwrites");
    expect(readFileSync(faq, "utf8")).toBe(before);
  });

  it("carries the machine contract (--json) and the contract caps pre-flight", () => {
    const dir = workspace();
    const data = json(edit(dir, "--create", "faq", "--check", "--json")).data as {
      mode: string;
      root: string;
      file: string;
      created: boolean;
      preview: boolean;
      limits: { field: string; cap: number; length: number; over: boolean; source: string }[];
    };
    expect(data.mode).toBe("create");
    expect(data.root).toBe("faq");
    expect(data.file).toBe("content/faq.yaml");
    expect(data.created).toBe(false);
    expect(data.preview).toBe(true);
    const caps = schemaCaps();
    expect(data.limits.map((limit) => [limit.field, limit.cap])).toEqual([
      ["q", caps.q],
      ["a", caps.a],
    ]);
    // The shipped template is inside every contract cap by construction.
    for (const limit of data.limits) {
      expect(limit.over).toBe(false);
      expect(limit.length).toBeLessThanOrEqual(limit.cap);
    }
  });

  it("decides usage before reading the workspace config", () => {
    const dir = workspace();
    writeFileSync(join(dir, ".pascorc"), "{not json");
    // Unknown root, an address next to --create, and --set next to it are usage,
    // decided before resolveWorkspace/readWorkspacePascorc.
    expect(edit(dir, "--create", "projects").code).toBe(2);
    expect(edit(dir, "--create", "faq", "positioning.statement.en").code).toBe(2);
    expect(edit(dir, "--create", "faq", "--set", "x").code).toBe(2);
    expect(edit(dir, "--list", "--create", "faq").code).toBe(2);
  });

  it("--help lists every new address and the create form", () => {
    const dir = workspace();
    const help = run(dir, "edit", "--help").stdout;
    expect(help).toContain("identity.definition.<lang>");
    expect(help).toContain("faq[id=<slug>,lang=<l>].q | .a");
    expect(help).toContain("faq[id=<slug>].source");
    expect(help).toContain("pasco edit --create <root>");
    for (const root of SEEDABLE_ROOTS) expect(help).toContain(root);
  });

  it("a seeded root is writable by the new addresses (create → edit)", () => {
    const dir = workspace();
    expect(edit(dir, "--create", "faq").code).toBe(0);
    const q = edit(dir, "faq[id=question-1,lang=en].q", "--set", "What does Elena Vasquez do?");
    expect(q.code).toBe(0);
    expect(q.stdout).toContain("written: yes");
    expect(readFileSync(join(dir, "content", "faq.yaml"), "utf8")).toContain(
      "en: What does Elena Vasquez do?",
    );
  });
});
