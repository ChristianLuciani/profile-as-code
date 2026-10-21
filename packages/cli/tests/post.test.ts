/**
 * `pasco post` — the post MVP (week-1 experiment).
 *
 * CLI-level tests against the BUILT binary and the core `minimal` fixture
 * (copied to a temp workspace; the repo is never mutated). They guard the
 * contract the week-1 experiment depends on: seed → task → choose → check →
 * Postiz payload, plus the check's failure modes.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function run(args: string[]): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error !== undefined) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-post-"));
  tempDirs.push(dir);
  cpSync(MINIMAL, dir, { recursive: true });
  return dir;
}

const OK_POST =
  "A note from {{fact:identity.name}}.\n\nThe work that compounds is repeatable.\n\nhttps://github.com/elenavasquez\n";

function seed(ws: string, id: string, text = OK_POST): void {
  const file = join(ws, "seed.md");
  writeFileSync(file, text);
  const result = run(["post", "seed", id, "--text", file, "--workspace", ws]);
  expect(result.code, result.stderr).toBe(0);
}

function variant(ws: string, id: string, channel: string, name: string, text: string): void {
  const dir = join(ws, "posts", id, channel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), text);
  const result = run([
    "post",
    "choose",
    id,
    "--channel",
    channel,
    "--variant",
    name,
    "--workspace",
    ws,
  ]);
  expect(result.code, result.stderr).toBe(0);
}

describe("pasco post (week-1 MVP)", () => {
  it("seeds, emits tasks, chooses, checks and exports a Postiz draft", () => {
    const ws = workspace();
    seed(ws, "s1");
    const task = run(["post", "task", "s1", "--channel", "linkedin,x", "--workspace", ws]);
    expect(task.code, task.stderr).toBe(0);
    expect(task.stdout).toContain("linkedin/task.md");
    expect(task.stdout).toContain("x/task.md");
    const taskFile = readFileSync(join(ws, "posts", "s1", "linkedin", "task.md"), "utf8");
    expect(taskFile).toContain("Elena Vasquez");

    variant(ws, "s1", "linkedin", "linkedin-1", OK_POST);
    const check = run(["post", "check", "s1", "--workspace", ws]);
    expect(check.code, check.stderr).toBe(0);
    expect(check.stdout).toContain("0 error(s)");

    writeFileSync(join(ws, "postiz.yaml"), "channels:\n  linkedin: li-123\n");
    const exported = run(["post", "export", "s1", "--target", "postiz", "--workspace", ws]);
    expect(exported.code, exported.stderr).toBe(0);
    const payload = JSON.parse(readFileSync(join(ws, "posts", "s1", "postiz.json"), "utf8")) as {
      type: string;
      posts: {
        integration: { id: string };
        settings: { __type: string };
        value: { content: string }[];
      }[];
    };
    expect(payload.type).toBe("draft");
    expect(payload.posts).toHaveLength(1);
    const first = payload.posts[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error("expected one post");
    expect(first.integration.id).toBe("li-123");
    expect(first.settings.__type).toBe("linkedin");
    const content = first.value[0]?.content ?? "";
    expect(content).toContain("Elena Vasquez");
    expect(content).not.toContain("{{fact:");
  });

  it("fails URLs outside the SSOT, including uppercase and scheme-less forms", () => {
    const ws = workspace();
    seed(ws, "s2");
    const bad =
      "A claim.\n\nhttps://evil.example/not-in-ssot\nHTTPS://evil.example/upper\nsee github.com/evil/bare\n";
    variant(ws, "s2", "x", "x-bad", bad);
    const check = run(["post", "check", "s2", "--json", "--workspace", ws]);
    expect(check.code).toBe(1);
    const envelope = JSON.parse(check.stdout) as {
      data: { errors: number; channels: { findings: { code: string }[] }[] };
    };
    const codes = envelope.data.channels.flatMap((channel) => channel.findings.map((f) => f.code));
    expect(codes.filter((code) => code === "url-not-in-ssot")).toHaveLength(3);
  });

  it("rejects a dangling fact ref at choose and catches it after an edit", () => {
    const ws = workspace();
    seed(ws, "s3");
    const dir = join(ws, "posts", "s3", "x");
    mkdirSync(dir, { recursive: true });
    const dangling = join(dir, "x-dangling.md");
    writeFileSync(dangling, "A claim from {{fact:identity.nope}}.\n");
    const choose = run([
      "post",
      "choose",
      "s3",
      "--channel",
      "x",
      "--variant",
      "x-dangling",
      "--workspace",
      ws,
    ]);
    expect(choose.code).toBe(2);
    expect(choose.stderr).toContain("dangling");

    variant(ws, "s3", "x", "x-ok", "A claim from {{fact:identity.name}}.\n");
    writeFileSync(join(dir, "x-ok.md"), "A claim from {{fact:identity.nope}}.\n");
    const check = run(["post", "check", "s3", "--json", "--workspace", ws]);
    expect(check.code).toBe(1);
    const envelope = JSON.parse(check.stdout) as {
      data: { channels: { findings: { code: string }[] }[] };
    };
    const codes = envelope.data.channels.flatMap((channel) => channel.findings.map((f) => f.code));
    expect(codes).toContain("dangling-ref");
  });

  it("trims the published text before counting chars", () => {
    const ws = workspace();
    seed(ws, "s4");
    variant(ws, "s4", "x", "x-280", `${"a".repeat(280)}\n`);
    expect(run(["post", "check", "s4", "--workspace", ws]).code).toBe(0);
    variant(ws, "s4", "x", "x-281", "a".repeat(281));
    const check = run(["post", "check", "s4", "--json", "--workspace", ws]);
    expect(check.code).toBe(1);
    const envelope = JSON.parse(check.stdout) as {
      data: { channels: { findings: { code: string }[] }[] };
    };
    const codes = envelope.data.channels.flatMap((channel) => channel.findings.map((f) => f.code));
    expect(codes).toContain("max-chars");
  });

  it("rejects an invalid export date and schedule without a date", () => {
    const ws = workspace();
    seed(ws, "s5");
    variant(ws, "s5", "x", "x-ok", "A short post from {{fact:identity.name}}.\n");
    expect(run(["post", "export", "s5", "--type", "schedule", "--workspace", ws]).code).toBe(2);
    expect(run(["post", "export", "s5", "--date", "not-a-date", "--workspace", ws]).code).toBe(2);
  });

  it("imports historical posts as seeds", () => {
    const ws = workspace();
    const dir = join(ws, "historico");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "one.md"), "Imported one.\n");
    writeFileSync(join(dir, "two.md"), "Imported two.\n");
    const imported = run(["post", "import", dir, "--channel", "linkedin", "--workspace", ws]);
    expect(imported.code, imported.stderr).toBe(0);
    expect(imported.stdout).toContain("imported 2 post(s)");
    const listed = run(["post", "list", "--workspace", ws]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("imported-one");
    expect(listed.stdout).toContain("imported-two");
  });
});
