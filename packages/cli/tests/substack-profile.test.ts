/**
 * The Substack profile bundle (#482): `SKILL.md` is the profile/publication
 * skill, so `pasco refine substack` is the PROFILE command, and the shipped
 * `checks.yaml` puts the `fact-present` premise in play for the surface while the
 * char caps still come from the workspace catalog (or the package defaults),
 * never from a shipped row (#455).
 *
 * The failure this closes: the post skill occupied the slot the engine reads as
 * the profile skill, so refine emitted a profile task that pointed at a file
 * about writing an issue — and `pasco check substack` had no catalog, so the
 * `surface facts` premise was not declared by anything.
 *
 * Offline: dist CLI + fixture copies in a temp dir, no network.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, "..", "..", "..");
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal-kofi");
const SKILL_DIR = join(REPO_DIR, "skills", "substack");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 15_000 });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * A workspace that targets `substack`: the shared fixture plus a `substack` bio
 * row and a workspace-declared cap. The cap is deliberately declared HERE, not
 * attributed to the skill — a shipped catalog's `max-chars` rows never reach the
 * limit executor (#455).
 */
function substackWorkspace(bioText: string, cap: number): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-substack-"));
  created.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(
    join(dir, "content", "bios.yaml"),
    `${readFileSync(join(FIXTURE, "content", "bios.yaml"), "utf8")}
- platform: substack
  lang: en
  length: short
  text: ${JSON.stringify(bioText)}
`,
  );
  writeFileSync(
    join(dir, "content", "checks.yaml"),
    `${readFileSync(join(FIXTURE, "content", "checks.yaml"), "utf8")}
- id: substack-bio-workspace
  platform: substack
  rule: max-chars
  value: ${cap}
  surface: bio
  note: "[?] fixture cap — the workspace catalog is what the limit executor reads."
`,
  );
  return dir;
}

interface CheckPayload {
  checks: { id?: string; rule: string; value?: unknown }[];
  limits: { code: string; message: string; path: string }[];
  factPresent: {
    catalog: string;
    declared: string[];
    checked: string[];
    notRun: string[];
    findings: { code: string }[];
  };
}

describe("pasco refine substack — the profile/publication task (#482)", () => {
  it("resolves skills/substack/SKILL.md, which is the profile skill", () => {
    const res = run(["refine", "substack", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    const match = /^Skill \(communicative strategy — READ IT FIRST\): (.+SKILL\.md)$/m.exec(
      res.stdout,
    );
    expect(match, "the task must name the skill file it reads").not.toBeNull();
    const resolved = match?.[1] ?? "";
    expect(resolved.replace(/\\/g, "/")).toMatch(/skills\/substack\/SKILL\.md$/);
    // The file the task points at must BE the profile skill, not the old post
    // document: the check is on the resolved file, so the generated bundle and
    // the repo checkout both pass.
    const frontmatter = readFileSync(resolved, "utf8");
    expect(frontmatter).toMatch(/^name: substack-profile$/m);
    expect(frontmatter).toContain("applies_to: substack");
    expect(frontmatter).toContain("sources: skills/substack/research/SOTA-2026.md");
  });

  it("emits a profile task that saves a variant body — never a post workflow", () => {
    const res = run(["refine", "substack", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Write 3 variant(s) of the substack profile in en");
    expect(res.stdout).toContain("profiles/substack/variants/<variantId>.md");
    expect(res.stdout).toContain("pasco refine substack --lang en --choose <variantId>");
    // The post has its own command and contract: none of it leaks into the
    // profile task (#482 was exactly that leak in reverse).
    expect(res.stdout).not.toContain("longform.yaml");
    expect(res.stdout).not.toContain("posts/<seed>/substack");
    expect(res.stdout).not.toContain("pasco post");
  });

  it("carries the same resolution in --json", () => {
    const res = run(["refine", "substack", "--json", "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    const data = JSON.parse(res.stdout) as {
      data: {
        mode: string;
        skill: { state: string; path?: string };
        template: string;
      };
    };
    expect(data.data.mode).toBe("template");
    expect(data.data.skill.state).toBe("found");
    expect(data.data.skill.path?.replace(/\\/g, "/")).toMatch(/skills\/substack\/SKILL\.md$/);
    expect(data.data.template).toContain("of the substack profile");
  });

  it("carries the publication facts into the task — the publication half (#482)", () => {
    // `substack` is one slug over PROFILE + PUBLICATION: a task that only names
    // the bio leaves the agent to rediscover `content/newsletter.yaml`. The
    // fixture is the minimal workspace plus a newsletter block; the task must
    // print name/description/cadence/url, with the langMap resolved for `--lang`.
    const dir = substackWorkspace("A profile bio for the header.", 180);
    writeFileSync(
      join(dir, "content", "newsletter.yaml"),
      [
        "platform: substack",
        "url: https://example.substack.com",
        "cadence: weekly",
        "name:",
        "  en: Example Weekly",
        "  es: Ejemplo Semanal",
        "description:",
        "  en: Notes on shipping sovereign software.",
        "  es: Notas sobre software soberano.",
        "",
      ].join("\n"),
    );
    const res = run(["refine", "substack", "--lang", "es", "--workspace", dir]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(
      "newsletter: Ejemplo Semanal | Notas sobre software soberano. | weekly | https://example.substack.com",
    );
    // Absent newsletter is a declared gap, not an invented block.
    const without = run(["refine", "substack", "--workspace", FIXTURE]);
    expect(without.stdout).toContain("newsletter: —");
  });

  it("keeps the post judgment and its refine note in post.md", () => {
    const post = readFileSync(join(SKILL_DIR, "post.md"), "utf8");
    // The post flow is still here (the criterion is "post.md conserves it").
    expect(post).toContain("pasco post choose");
    expect(post).toContain("pasco post export");
    // And the refined warning: refine IS the profile command now, the post is not.
    expect(post).toContain("`pasco refine substack` is the PROFILE command");
    expect(post).toContain("pasco post");
    expect(post).not.toMatch(/do not run `pasco refine substack`/i);
    // The slot is the profile one: the post skill must not answer to the old name.
    const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    expect(skill).not.toContain("name: substack-post");
    expect(skill).toContain("../FACTS-VS-NARRATIVE.md");
  });
});

describe("pasco check substack — the profile bundle's premises (#482, #455)", () => {
  it("declares the surface-facts premise and reports it as not run, never as OK", () => {
    const dir = substackWorkspace(
      "Sovereign AI notes for builders: routing, local inference and evaluation, published weekly.",
      120,
    );
    const res = run(["check", "substack", "--json", "--workspace", dir]);
    expect(res.code).toBe(0);
    const data = (JSON.parse(res.stdout) as { data: CheckPayload }).data;
    // The catalog ships, and it is the substack checks.yaml that declares the
    // premise — the report must not say "not declared by any catalog".
    expect(data.factPresent.catalog).toBe("shipped");
    expect(data.factPresent.declared).toContain("substack");
    // No artifact was built in this workspace: absence is `notRun`, never a pass.
    expect(data.factPresent.notRun).toContain("substack");
    expect(data.factPresent.findings).toEqual([]);

    const human = run(["check", "substack", "--workspace", dir]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("declared by the catalog: substack");
    expect(human.stdout).not.toContain("not declared by any catalog for this surface");
  });

  it("compares the built SHEET, not a long-bio fallback (#483 closed that gap)", () => {
    // #482 pinned the pre-renderer fallback as the instrument ESCALATE(4) asked
    // for: the build wrote only the `long` bio, so the publication fields never
    // entered the artifact and `fact-present` could not see them. #483 ships the
    // renderer; this test is the signal the gap closed — the built sheet carries
    // both bio rows and the publication copy, and `fact-present` still agrees.
    const dir = substackWorkspace("Profile-header bio for the short row.", 180);
    appendFileSync(
      join(dir, "content", "bios.yaml"),
      [
        "- platform: substack",
        "  lang: en",
        "  length: long",
        '  text: "The long About body the renderer writes into the sheet."',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "content", "newsletter.yaml"),
      [
        "platform: substack",
        "url: https://example.substack.com",
        "cadence: weekly",
        "name:",
        "  en: Example Weekly",
        "description:",
        "  en: Notes on shipping sovereign software.",
        "",
      ].join("\n"),
    );

    const build = run(["build", "substack", "--workspace", dir]);
    expect(build.code).toBe(0);
    const artifact = readFileSync(join(dir, "profiles", "substack", "README.md"), "utf8");
    expect(artifact).toContain("Bio (profile): Profile-header bio for the short row.");
    expect(artifact).toContain("About: The long About body the renderer writes into the sheet.");
    expect(artifact).toContain("Publication: Example Weekly");
    expect(artifact).toContain("Short description: Notes on shipping sovereign software.");
    expect(artifact).toContain("Canonical: https://example.substack.com");

    const res = run(["check", "substack", "--json", "--workspace", dir]);
    const data = (JSON.parse(res.stdout) as { data: CheckPayload }).data;
    expect(data.factPresent.checked).toContain("substack");
    expect(data.factPresent.notRun).not.toContain("substack");
    expect(data.factPresent.findings).toEqual([]);
  });

  it("measures the workspace's cap, not a shipped skill row (#455)", () => {
    // 150 chars: over the workspace's 120 and under the skill's curated 180, so
    // the finding can only come from the workspace catalog.
    const text =
      "Sovereign AI notes for builders: model routing, local-first inference and evaluation, published weekly for the people who ship this infrastructure.";
    expect([...text].length).toBeGreaterThan(120);
    expect([...text].length).toBeLessThan(180);
    const dir = substackWorkspace(text, 120);

    const res = run(["check", "substack", "--json", "--workspace", dir]);
    expect(res.code).toBe(0); // a cap overflow is a WARN (D12), never a fail
    const data = (JSON.parse(res.stdout) as { data: CheckPayload }).data;

    expect(data.limits).toHaveLength(1);
    expect(data.limits[0]?.code).toBe("max-chars");
    expect(data.limits[0]?.path).toBe("bios:substack:en:short");
    expect(data.limits[0]?.message).toContain(`has ${[...text].length} chars`);
    expect(data.limits[0]?.message).toContain("over max 120");
    expect(data.limits[0]?.message).toContain("fixture cap");

    // The executed catalog is the workspace's, whole: the skill's soft-cap row
    // never enters it, so no shipped id can attribute this finding.
    const ids = data.checks.map((row) => row.id ?? "");
    expect(ids).toContain("substack-bio-workspace");
    expect(ids).not.toContain("s-profile-bio-soft");

    const human = run(["check", "substack", "--workspace", dir]);
    expect(human.stdout).toContain("over max 120");
  });

  it("ships the premises the skill bundle promises, with sourced soft caps", () => {
    const source = readFileSync(join(SKILL_DIR, "checks.yaml"), "utf8");
    for (const rule of [
      "fact-present",
      "link-in-identity",
      "geo-consistent",
      "url-live",
      "lang-present",
      "max-chars",
    ]) {
      expect(source, `checks.yaml must declare ${rule}`).toContain(`rule: ${rule}`);
    }
    // A cap that is not a platform limit: `[?]` in the row and the research path
    // in the header/notes, so no reader can mistake it for a hard rule.
    expect(source).toContain("[?]");
    expect(source).toContain("research/SOTA-2026.md");
    expect(source).toContain("Substack documents NO character limit");
  });
});

describe("the profile bundle's docs (#482)", () => {
  it("playbook.md covers the manual paste fields and the post-paste verification", () => {
    const playbook = readFileSync(join(SKILL_DIR, "playbook.md"), "utf8");
    for (const step of [
      "Settings → Publication Description",
      "About page",
      "AI-training",
      "pasco status --mark",
      "browser",
    ]) {
      expect(playbook, `playbook must cover "${step}"`).toContain(step);
    }
    expect(playbook, "playbook must cover the welcome email").toMatch(/welcome email/i);
    // The fields a renderer cannot paste are named as steps, not invented data.
    for (const excluded of ["Billing", "Design layer", "Analytics", "custom domain"]) {
      expect(playbook).toContain(excluded);
    }
  });

  it("skills/README.md no longer describes substack as a post-only channel", () => {
    const readme = readFileSync(join(REPO_DIR, "skills", "README.md"), "utf8");
    expect(readme).toContain("profile/publication");
    expect(readme).not.toContain("**Do not use `pasco refine <channel>` on a post channel.**");
    // `substack` is still a long-form channel — the post contract did not move.
    expect(readme).toContain("(`longform.yaml`, #266): `substack`");
  });
});
