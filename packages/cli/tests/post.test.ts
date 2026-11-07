/**
 * `pasco post` — the post MVP (week-1 experiment).
 *
 * CLI-level tests against the BUILT binary and the core `minimal` fixture
 * (copied to a temp workspace; the repo is never mutated). They guard the
 * contract the week-1 experiment depends on: seed → task → choose → check →
 * Postiz payload, plus the check's failure modes.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: Record<string, string> = {}): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, ...env },
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

  it("imports historical posts as seeds, recorded published by assumption", () => {
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

    // #423: an imported historical post is assumed published — the engine
    // cannot prove it and stores no URL, so the pair stays honest
    // (published + unverifiable + url: null) instead of reading as verified.
    const ledger = parseYaml(
      readFileSync(join(ws, "posts", "imported-one", "post.yaml"), "utf8"),
    ) as {
      source: string;
      status: string;
      channels: Record<string, { sync?: string; certification?: string; url?: string | null }>;
    };
    expect(ledger.source).toBe("imported");
    expect(ledger.status).toBe("published");
    expect(ledger.channels.linkedin?.sync).toBe("published");
    expect(ledger.channels.linkedin?.certification).toBe("unverifiable");
    expect(ledger.channels.linkedin?.url).toBeNull();
  });
});

/* #266 — long-form seeds (essay/newsletter) and the short family. */

const ESSAY =
  "An essay from {{fact:identity.name}} about the work that compounds.\n\nhttps://github.com/elenavasquez\n";

function longformSeed(ws: string, id: string, text = ESSAY): void {
  const file = join(ws, "essay.md");
  writeFileSync(file, text);
  const result = run([
    "post",
    "seed",
    id,
    "--text",
    file,
    "--format",
    "longform",
    "--workspace",
    ws,
  ]);
  expect(result.code, result.stderr).toBe(0);
}

function words(n: number): string {
  return Array.from({ length: n }, () => "repeatable").join(" ");
}

function frontMatter(fields: Record<string, string>, body: string): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${body}\n`;
}

function ledgerOf(ws: string, id: string): Record<string, unknown> {
  const raw = readFileSync(join(ws, "posts", id, "post.yaml"), "utf8");
  // The ledger is written by the CLI's yaml stringify; a tiny parser is enough
  // for the two scalar fields this test asserts (format/derivedFrom).
  const out: Record<string, unknown> = {};
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined) out[match[1]] = match[2];
  }
  return out;
}

describe("pasco post — long-form (#266)", () => {
  it("turns one essay seed into 1 long-form projection + 3 short projections linked by derivedFrom", () => {
    const ws = workspace();
    longformSeed(ws, "essay");

    const longTask = run([
      "post",
      "task",
      "essay",
      "--format",
      "longform",
      "--channel",
      "medium,substack",
      "--workspace",
      ws,
    ]);
    expect(longTask.code, longTask.stderr).toBe(0);
    const mediumTask = readFileSync(join(ws, "posts", "essay", "medium", "task.md"), "utf8");
    expect(mediumTask).toContain("LONG-FORM");
    expect(mediumTask).toContain("fields required: title, dek");
    expect(mediumTask).toContain("words: 600–3000");

    variant(
      ws,
      "essay",
      "medium",
      "medium-1",
      frontMatter(
        {
          title: "Repeatable work",
          dek: "What compounds.",
          canonical: "https://elenavasquez.substack.com",
        },
        words(650),
      ),
    );

    const shorts: { id: string; channel: string }[] = [
      { id: "essay-x", channel: "x" },
      { id: "essay-li", channel: "linkedin" },
      { id: "essay-x2", channel: "x" },
    ];
    for (const short of shorts) {
      const task = run([
        "post",
        "task",
        short.id,
        "--format",
        "short",
        "--from",
        "essay",
        "--channel",
        short.channel,
        "--workspace",
        ws,
      ]);
      expect(task.code, task.stderr).toBe(0);
      const body = readFileSync(join(ws, "posts", short.id, short.channel, "task.md"), "utf8");
      expect(body).toContain("Derived from long-form seed: essay");
      expect(body).toContain("Source essay (canonical");
      variant(
        ws,
        short.id,
        short.channel,
        `${short.channel}-1`,
        "A short take from {{fact:identity.name}}.\n",
      );
      expect(ledgerOf(ws, short.id).format).toBe("short");
      expect(ledgerOf(ws, short.id).derivedFrom).toBe("essay");
    }

    expect(ledgerOf(ws, "essay").format).toBe("longform");
    expect(ledgerOf(ws, "essay").derivedFrom).toBeUndefined();

    for (const id of ["essay", ...shorts.map((short) => short.id)]) {
      const check = run(["post", "check", id, "--workspace", ws]);
      expect(check.code, `${id}: ${check.stdout}${check.stderr}`).toBe(0);
    }

    const listed = run(["post", "list", "--json", "--workspace", ws]);
    expect(listed.code, listed.stderr).toBe(0);
    const rows = (
      JSON.parse(listed.stdout) as {
        data: { posts: { id: string; format: string; derivedFrom: string | null }[] };
      }
    ).data.posts;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("essay")?.format).toBe("longform");
    expect(byId.get("essay")?.derivedFrom).toBeNull();
    const derived = rows.filter((row) => row.derivedFrom === "essay");
    expect(derived).toHaveLength(3);
    expect(derived.every((row) => row.format === "short")).toBe(true);
  });

  it("fails a long-form check on missing title/dek, word-count breach, out-of-SSOT URL and a dangling ref", () => {
    const ws = workspace();
    longformSeed(ws, "essay2");
    expect(
      run([
        "post",
        "task",
        "essay2",
        "--format",
        "longform",
        "--channel",
        "medium",
        "--workspace",
        ws,
      ]).code,
    ).toBe(0);

    // No front matter at all: title and dek are both missing, and the body is short.
    variant(ws, "essay2", "medium", "medium-1", "Only a few words from {{fact:identity.name}}.\n");
    const missing = run(["post", "check", "essay2", "--json", "--workspace", ws]);
    expect(missing.code).toBe(1);
    const missingCodes = (
      JSON.parse(missing.stdout) as {
        data: { channels: { findings: { code: string }[] }[] };
      }
    ).data.channels.flatMap((channel) => channel.findings.map((finding) => finding.code));
    expect(missingCodes.filter((code) => code === "missing-field")).toHaveLength(2);
    expect(missingCodes).toContain("word-count");

    // Fields present, but the canonical URL is outside the SSOT and a fact ref dangles.
    writeFileSync(
      join(ws, "posts", "essay2", "medium", "medium-1.md"),
      frontMatter(
        {
          title: "Repeatable work",
          dek: "What compounds.",
          canonical: "https://evil.example/post",
        },
        `${words(650)}\nFrom {{fact:identity.nope}}.`,
      ),
    );
    const bad = run(["post", "check", "essay2", "--json", "--workspace", ws]);
    expect(bad.code).toBe(1);
    const codes = (
      JSON.parse(bad.stdout) as {
        data: { channels: { findings: { code: string }[] }[] };
      }
    ).data.channels.flatMap((channel) => channel.findings.map((finding) => finding.code));
    expect(codes).toContain("url-not-in-ssot");
    expect(codes).toContain("dangling-ref");
  });

  it("exports an API Postiz payload and a paste checklist for the paste channels", () => {
    const ws = workspace();
    longformSeed(ws, "essay3");
    expect(
      run([
        "post",
        "task",
        "essay3",
        "--format",
        "longform",
        "--channel",
        "medium,substack,ghost",
        "--workspace",
        ws,
      ]).code,
    ).toBe(0);
    const fields = {
      title: "Repeatable work",
      dek: "What compounds.",
      tags: "[craft, work]",
      canonical: "https://elenavasquez.substack.com",
    };
    variant(ws, "essay3", "medium", "medium-1", frontMatter(fields, words(650)));
    variant(ws, "essay3", "substack", "substack-1", frontMatter(fields, words(650)));
    variant(ws, "essay3", "ghost", "ghost-1", frontMatter(fields, words(650)));
    writeFileSync(join(ws, "postiz.yaml"), "channels:\n  medium: md-123\n");

    const exported = run(["post", "export", "essay3", "--workspace", ws]);
    expect(exported.code, exported.stderr).toBe(0);
    expect(exported.stdout).toContain("paste checklist");

    const payload = JSON.parse(
      readFileSync(join(ws, "posts", "essay3", "postiz.json"), "utf8"),
    ) as {
      posts: {
        integration: { id: string };
        settings: { __type: string; title?: string; canonical?: string; tags?: string[] };
        value: { content: string }[];
      }[];
    };
    expect(payload.posts).toHaveLength(1);
    const medium = payload.posts[0];
    expect(medium?.integration.id).toBe("md-123");
    expect(medium?.settings.__type).toBe("medium");
    expect(medium?.settings.title).toBe("Repeatable work");
    expect(medium?.settings.canonical).toBe("https://elenavasquez.substack.com");
    expect(medium?.value[0]?.content.startsWith("repeatable repeatable")).toBe(true);
    expect(medium?.value[0]?.content).not.toContain("title:");

    for (const channel of ["substack", "ghost"]) {
      const checklist = readFileSync(
        join(ws, "posts", "essay3", channel, "paste-checklist.md"),
        "utf8",
      );
      expect(checklist).toContain("paste surface");
      expect(checklist).toContain("title: Repeatable work");
      expect(checklist).toContain("dek: What compounds.");
    }
  });

  it("maps publication into the API settings and warns on an undeclared front-matter field", () => {
    const ws = workspace();
    longformSeed(ws, "essay5");
    expect(
      run([
        "post",
        "task",
        "essay5",
        "--format",
        "longform",
        "--channel",
        "medium",
        "--workspace",
        ws,
      ]).code,
    ).toBe(0);
    variant(
      ws,
      "essay5",
      "medium",
      "medium-1",
      frontMatter(
        {
          title: "Repeatable work",
          dek: "What compounds.",
          publication: "my-publication",
          imprint: "not-a-declared-field",
        },
        words(650),
      ),
    );
    const check = run(["post", "check", "essay5", "--json", "--workspace", ws]);
    expect(check.code, check.stdout).toBe(0);
    const envelope = JSON.parse(check.stdout) as {
      data: {
        warnings: number;
        channels: { findings: { code: string; message: string }[] }[];
      };
    };
    const findings = envelope.data.channels.flatMap((channel) => channel.findings);
    expect(envelope.data.warnings).toBe(1);
    expect(findings.map((finding) => finding.code)).toContain("unknown-field");
    expect(findings.find((finding) => finding.code === "unknown-field")?.message).toContain(
      "imprint",
    );

    writeFileSync(join(ws, "postiz.yaml"), "channels:\n  medium: md-9\n");
    expect(run(["post", "export", "essay5", "--workspace", ws]).code).toBe(0);
    const payload = JSON.parse(
      readFileSync(join(ws, "posts", "essay5", "postiz.json"), "utf8"),
    ) as {
      posts: { settings: Record<string, unknown> }[];
    };
    expect(payload.posts[0]?.settings.publication).toBe("my-publication");
    expect(payload.posts[0]?.settings.imprint).toBeUndefined();
  });

  it("treats empty front matter as no fields and counts only the body", () => {
    const ws = workspace();
    longformSeed(ws, "essay6");
    expect(
      run([
        "post",
        "task",
        "essay6",
        "--format",
        "longform",
        "--channel",
        "medium",
        "--workspace",
        ws,
      ]).code,
    ).toBe(0);
    variant(ws, "essay6", "medium", "medium-1", `---\n---\n${words(650)}\n`);
    const check = run(["post", "check", "essay6", "--json", "--workspace", ws]);
    expect(check.code).toBe(1);
    const codes = (
      JSON.parse(check.stdout) as {
        data: { channels: { findings: { code: string }[] }[] };
      }
    ).data.channels.flatMap((channel) => channel.findings.map((finding) => finding.code));
    expect(codes.filter((code) => code === "missing-field")).toHaveLength(2);
    expect(codes).not.toContain("front-matter");
    expect(codes).not.toContain("word-count");
  });

  it("writes nothing when a task would fail, and rejects a derived child without --from", () => {
    const ws = workspace();
    longformSeed(ws, "essay7");
    // Unknown channel: validated before the ledger/seed/task is written.
    const badChannel = run([
      "post",
      "task",
      "fresh",
      "--format",
      "longform",
      "--channel",
      "nosuch",
      "--workspace",
      ws,
    ]);
    expect(badChannel.code).toBe(2);
    expect(existsSync(join(ws, "posts", "fresh"))).toBe(false);

    expect(
      run([
        "post",
        "task",
        "child7",
        "--format",
        "short",
        "--from",
        "essay7",
        "--channel",
        "x",
        "--workspace",
        ws,
      ]).code,
    ).toBe(0);
    const noFrom = run(["post", "task", "child7", "--channel", "x", "--workspace", ws]);
    expect(noFrom.code).toBe(2);
    expect(noFrom.stderr).toContain("derived from");
  });

  it("refuses --out with only paste channels before writing any checklist", () => {
    const ws = workspace();
    longformSeed(ws, "essay8");
    expect(
      run([
        "post",
        "task",
        "essay8",
        "--format",
        "longform",
        "--channel",
        "substack",
        "--workspace",
        ws,
      ]).code,
    ).toBe(0);
    variant(
      ws,
      "essay8",
      "substack",
      "substack-1",
      frontMatter({ title: "Repeatable work", dek: "What compounds." }, words(650)),
    );
    const out = run(["post", "export", "essay8", "--out", join(ws, "out.json"), "--workspace", ws]);
    expect(out.code).toBe(2);
    expect(existsSync(join(ws, "posts", "essay8", "substack", "paste-checklist.md"))).toBe(false);
  });

  it("rejects --from with a non-essay parent and with --format longform", () => {
    const ws = workspace();
    longformSeed(ws, "essay4");
    seed(ws, "short4");
    expect(
      run([
        "post",
        "task",
        "child",
        "--format",
        "longform",
        "--from",
        "essay4",
        "--channel",
        "medium",
        "--workspace",
        ws,
      ]).code,
    ).toBe(2);
    const notEssay = run([
      "post",
      "task",
      "child",
      "--format",
      "short",
      "--from",
      "short4",
      "--channel",
      "x",
      "--workspace",
      ws,
    ]);
    expect(notEssay.code).toBe(2);
    expect(notEssay.stderr).toContain("long-form");
  });
});

/* #484 — `access`, a generic long-form field each channel contract declares. */

const ACCESS_LEVELS = ["free", "free-subscribers", "paid", "founding"];

function findingsOf(stdout: string): { errors: number; codes: string[]; messages: string[] } {
  const envelope = JSON.parse(stdout) as {
    data: { errors: number; channels: { findings: { code: string; message: string }[] }[] };
  };
  const findings = envelope.data.channels.flatMap((channel) => channel.findings);
  return {
    errors: envelope.data.errors,
    codes: findings.map((finding) => finding.code),
    messages: findings.map((finding) => finding.message),
  };
}

function substackTask(ws: string, id: string): void {
  const task = run([
    "post",
    "task",
    id,
    "--format",
    "longform",
    "--channel",
    "substack",
    "--workspace",
    ws,
  ]);
  expect(task.code, task.stderr).toBe(0);
}

describe("pasco post — long-form access (#484)", () => {
  it("declares the access vocabulary in the task only for a channel that opts in", () => {
    const ws = workspace();
    longformSeed(ws, "essay-level-task");
    const task = run([
      "post",
      "task",
      "essay-level-task",
      "--format",
      "longform",
      "--channel",
      "substack,medium",
      "--workspace",
      ws,
    ]);
    expect(task.code, task.stderr).toBe(0);
    expect(task.stdout).toContain("access: free | free-subscribers | paid | founding");
    // The stdout summary distinguishes the optional branch; the required branch
    // has its own assertion in the required-contract test (#484 review).
    expect(task.stdout).toContain("(default: free)");

    const substack = readFileSync(
      join(ws, "posts", "essay-level-task", "substack", "task.md"),
      "utf8",
    );
    expect(substack).toContain("access: free | free-subscribers | paid | founding");
    expect(substack).toContain("# access: <optional>");

    // medium's contract does not declare `access`: its task is untouched.
    const medium = readFileSync(join(ws, "posts", "essay-level-task", "medium", "task.md"), "utf8");
    expect(medium).not.toContain("access");
  });

  it("accepts every level and echoes an explicit level into the paste checklist", () => {
    const ws = workspace();
    longformSeed(ws, "essay-access-levels");
    substackTask(ws, "essay-access-levels");
    for (const level of ACCESS_LEVELS) {
      variant(
        ws,
        "essay-access-levels",
        "substack",
        "substack-1",
        frontMatter(
          { title: "Repeatable work", dek: "What compounds.", access: level },
          words(650),
        ),
      );
      const check = run(["post", "check", "essay-access-levels", "--json", "--workspace", ws]);
      expect(check.code, `${level}: ${check.stdout}${check.stderr}`).toBe(0);
      const findings = findingsOf(check.stdout);
      expect(findings.errors).toBe(0);
      expect(findings.codes).not.toContain("bad-access");

      const exported = run(["post", "export", "essay-access-levels", "--workspace", ws]);
      expect(exported.code, exported.stderr).toBe(0);
      const checklist = readFileSync(
        join(ws, "posts", "essay-access-levels", "substack", "paste-checklist.md"),
        "utf8",
      );
      expect(checklist).toContain(`- access: ${level}`);
      expect(checklist).toContain(`- [ ] Access is set to "${level}"`);
    }
  });

  it("reports bad-access for a value outside the enum or a non-string", () => {
    const ws = workspace();
    longformSeed(ws, "essay-access-bad");
    substackTask(ws, "essay-access-bad");
    variant(
      ws,
      "essay-access-bad",
      "substack",
      "substack-1",
      frontMatter({ title: "Repeatable work", dek: "What compounds.", access: "foo" }, words(650)),
    );
    const bad = run(["post", "check", "essay-access-bad", "--json", "--workspace", ws]);
    expect(bad.code).toBe(1);
    const badFindings = findingsOf(bad.stdout);
    expect(badFindings.codes).toContain("bad-access");
    const message = badFindings.messages.find((text) => text.includes("access")) ?? "";
    expect(message).toContain("free | free-subscribers | paid | founding");
    expect(message).toContain("default: free");

    // YAML turns an unquoted 3 into a number: still not a level.
    writeFileSync(
      join(ws, "posts", "essay-access-bad", "substack", "substack-1.md"),
      `---\ntitle: Repeatable work\ndek: What compounds.\naccess: 3\n---\n${words(650)}\n`,
    );
    const numeric = run(["post", "check", "essay-access-bad", "--json", "--workspace", ws]);
    expect(numeric.code).toBe(1);
    expect(findingsOf(numeric.stdout).codes).toContain("bad-access");
  });

  it("treats a missing access as free: no finding and no new checklist line", () => {
    const ws = workspace();
    longformSeed(ws, "essay-no-level");
    substackTask(ws, "essay-no-level");
    variant(
      ws,
      "essay-no-level",
      "substack",
      "substack-1",
      frontMatter({ title: "Repeatable work", dek: "What compounds." }, words(650)),
    );
    const check = run(["post", "check", "essay-no-level", "--json", "--workspace", ws]);
    expect(check.code, check.stdout).toBe(0);
    const findings = findingsOf(check.stdout);
    expect(findings.errors).toBe(0);
    expect(findings.codes).not.toContain("bad-access");

    expect(run(["post", "export", "essay-no-level", "--workspace", ws]).code).toBe(0);
    const checklist = readFileSync(
      join(ws, "posts", "essay-no-level", "substack", "paste-checklist.md"),
      "utf8",
    );
    expect(checklist).not.toContain("access");
    expect(checklist).not.toContain("Access is set");
  });

  it("does not add an Access step for a channel that does not declare the field", () => {
    // The opt-in must gate EVERY surface: `ghost` does not declare `access`, so a
    // variant that carries it gets `unknown-field` and its checklist must not
    // claim an Access step the Fields section does not list (#484 review).
    const ws = workspace();
    longformSeed(ws, "essay-ghost-level");
    const task = run([
      "post",
      "task",
      "essay-ghost-level",
      "--format",
      "longform",
      "--channel",
      "ghost",
      "--workspace",
      ws,
    ]);
    expect(task.code, task.stderr).toBe(0);
    variant(
      ws,
      "essay-ghost-level",
      "ghost",
      "ghost-1",
      frontMatter({ title: "Repeatable work", dek: "What compounds.", access: "paid" }, words(650)),
    );
    const check = run(["post", "check", "essay-ghost-level", "--json", "--workspace", ws]);
    expect(check.code, check.stdout).toBe(0);
    const findings = findingsOf(check.stdout);
    expect(findings.codes).toContain("unknown-field");
    expect(findings.codes).not.toContain("bad-access");

    expect(run(["post", "export", "essay-ghost-level", "--workspace", ws]).code).toBe(0);
    const checklist = readFileSync(
      join(ws, "posts", "essay-ghost-level", "ghost", "paste-checklist.md"),
      "utf8",
    );
    expect(checklist).not.toContain("- access:");
    expect(checklist).not.toContain("Access is set");
  });

  it("states access as required when the channel contract mandates it", () => {
    // The required branch is supported (validation runs), so the task guide must
    // not tell the writer to omit the field (#484 review).
    const skills = mkdtempSync(join(tmpdir(), "pasco-skills-required-"));
    tempDirs.push(skills);
    mkdirSync(join(skills, "ghost"), { recursive: true });
    writeFileSync(
      join(skills, "ghost", "longform.yaml"),
      [
        "platform: ghost",
        "format: longform",
        "export: paste",
        "fields:",
        "  required:",
        "    - title",
        "    - dek",
        "    - access",
        "  optional:",
        "    - tags",
        "",
      ].join("\n"),
    );
    const env = { PASCO_SKILLS_DIR: skills };
    const ws = workspace();
    longformSeed(ws, "essay-required-access");
    const task = run(
      [
        "post",
        "task",
        "essay-required-access",
        "--format",
        "longform",
        "--channel",
        "ghost",
        "--workspace",
        ws,
      ],
      env,
    );
    expect(task.code, task.stderr).toBe(0);
    expect(task.stdout).toContain("(required)");
    expect(task.stdout).not.toContain("(default: free)");
    const taskMd = readFileSync(
      join(ws, "posts", "essay-required-access", "ghost", "task.md"),
      "utf8",
    );
    expect(taskMd).toContain("required: state it in the front matter");
    expect(taskMd).not.toContain("only when it is not free");

    // Omitting it is a missing-field for this contract.
    variant(
      ws,
      "essay-required-access",
      "ghost",
      "ghost-1",
      frontMatter({ title: "Repeatable work", dek: "What compounds." }, words(650)),
    );
    const missing = run(
      ["post", "check", "essay-required-access", "--json", "--workspace", ws],
      env,
    );
    expect(missing.code).toBe(1);
    expect(findingsOf(missing.stdout).codes).toContain("missing-field");

    // An invalid value is bad-access, and the message must not promise a default
    // the contract does not have.
    variant(
      ws,
      "essay-required-access",
      "ghost",
      "ghost-1",
      frontMatter({ title: "Repeatable work", dek: "What compounds.", access: "foo" }, words(650)),
    );
    const bad = run(["post", "check", "essay-required-access", "--json", "--workspace", ws], env);
    expect(bad.code).toBe(1);
    const finding = findingsOf(bad.stdout);
    expect(finding.codes).toContain("bad-access");
    const message = finding.messages.find((text) => text.includes("access")) ?? "";
    expect(message).toContain("free | free-subscribers | paid | founding");
    expect(message).not.toContain("default:");
  });

  it("keeps access out of the Postiz payload for an API channel", () => {
    const ws = workspace();
    longformSeed(ws, "essay-access-api");
    const task = run([
      "post",
      "task",
      "essay-access-api",
      "--format",
      "longform",
      "--channel",
      "medium,substack",
      "--workspace",
      ws,
    ]);
    expect(task.code, task.stderr).toBe(0);
    const fields = { title: "Repeatable work", dek: "What compounds.", access: "paid" };
    variant(ws, "essay-access-api", "medium", "medium-1", frontMatter(fields, words(650)));
    variant(ws, "essay-access-api", "substack", "substack-1", frontMatter(fields, words(650)));
    writeFileSync(join(ws, "postiz.yaml"), "channels:\n  medium: md-access\n");

    // medium does not declare `access`, so the field is merely not exported (warn).
    const check = run(["post", "check", "essay-access-api", "--json", "--workspace", ws]);
    expect(check.code, check.stdout).toBe(0);
    expect(findingsOf(check.stdout).codes).toContain("unknown-field");

    const exported = run(["post", "export", "essay-access-api", "--workspace", ws]);
    expect(exported.code, exported.stderr).toBe(0);
    const payload = JSON.parse(
      readFileSync(join(ws, "posts", "essay-access-api", "postiz.json"), "utf8"),
    ) as { posts: { settings: Record<string, unknown> }[] };
    expect(payload.posts).toHaveLength(1);
    expect(payload.posts[0]?.settings.access).toBeUndefined();

    const checklist = readFileSync(
      join(ws, "posts", "essay-access-api", "substack", "paste-checklist.md"),
      "utf8",
    );
    expect(checklist).toContain(`- [ ] Access is set to "paid"`);
  });
});
