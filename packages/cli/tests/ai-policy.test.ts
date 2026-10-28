/**
 * `pasco export ai-policy` — the AI policy artifact (SPEC §7.3, issue #290).
 *
 * The contracts that matter here:
 *   1. robots.txt expresses TWO named groups and never a wildcard allow-all —
 *      the M9 floor would be cosmetic otherwise;
 *   2. the UA classification is registry data (`@profile-as-code/core`), so the
 *      CLI cannot hold a list of its own;
 *   3. `--check` fails an unsourced entry or an `as_of` older than 180 days, and
 *      the WRITE path refuses to produce what `--check` would reject;
 *   4. `llms.txt` asserts coverage — a dropped document fails instead of
 *      disappearing (the assertion is exercised against doctored text, so this
 *      test can actually fail);
 *   5. an existing file pasco did not generate is never truncated without
 *      `--force`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_CRAWLERS,
  AI_POLICY_AS_OF,
  AI_POLICY_STANCE,
  type AiCrawler,
  load,
} from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import {
  AI_POLICY_MAX_AGE_DAYS,
  ageInDays,
  aiPolicyArtifacts,
  assertLlmsCoverage,
  checkCrawlers,
  llmsDocuments,
  llmsInput,
  renderAiPolicy,
  renderLlmsTxt,
  renderRobots,
  runAiPolicyCheck,
  runAiPolicyExport,
} from "../src/commands/export.js";
import { type JsonEnvelope, setJsonMode } from "../src/output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "fixtures", "ai-policy");

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-ai-policy-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Capture stdout for a command run (JSON envelopes and artifacts both go there). */
function capture<T>(run: () => T): { code: T; out: string } {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: run(), out };
  } finally {
    process.stdout.write = original;
    setJsonMode(false);
  }
}

const now = new Date(`${AI_POLICY_AS_OF}T12:00:00Z`);

const crawler = (over: Partial<AiCrawler> = {}): AiCrawler => ({
  slug: "example-bot",
  ua: "ExampleBot",
  family: "retrieval",
  operator: "Example",
  source: "https://example.com/bots",
  as_of: AI_POLICY_AS_OF,
  ...over,
});

describe("the registry is the one home", () => {
  it("ships both families, each with its own token", () => {
    expect(AI_CRAWLERS.filter((row) => row.family === "retrieval").length).toBeGreaterThan(0);
    expect(AI_CRAWLERS.filter((row) => row.family === "training").length).toBeGreaterThan(0);
    const tokens = AI_CRAWLERS.map((row) => row.ua);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("carries source + as_of on every entry (the evidence rule)", () => {
    for (const row of AI_CRAWLERS) {
      expect(row.source).toMatch(/^https?:\/\//);
      expect(row.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.operator.length).toBeGreaterThan(0);
    }
  });

  it("quotes the M9 stance verbatim", () => {
    expect(AI_POLICY_STANCE).toContain("private-first default");
    expect(AI_POLICY_STANCE).toContain("explicit opt-in");
  });
});

describe("robots.txt — two explicit groups", () => {
  const text = renderRobots(AI_CRAWLERS);

  it("emits both named groups and no wildcard", () => {
    expect(text).toMatch(/^# ai-retrieval —/m);
    expect(text).toMatch(/^# ai-training —/m);
    expect(text).not.toMatch(/^User-agent: \*/m);
  });

  it("allows retrieval and disallows training", () => {
    const retrieval = text.slice(text.indexOf("# ai-retrieval"), text.indexOf("# ai-training"));
    const training = text.slice(text.indexOf("# ai-training"));
    expect(retrieval).toContain("Allow: /");
    expect(retrieval).not.toContain("Disallow: /");
    expect(training).toContain("Disallow: /");
  });

  it("explains why each UA is in its group", () => {
    for (const row of AI_CRAWLERS) {
      expect(text).toContain(
        `#   ${row.slug} · ${row.operator} · source ${row.source} · as of ${row.as_of}\nUser-agent: ${row.ua}`,
      );
    }
  });

  it("stays deterministic: same input, same bytes", () => {
    expect(renderRobots(AI_CRAWLERS)).toBe(text);
  });
});

describe("--check rules", () => {
  it("accepts a sourced, fresh list", () => {
    expect(
      checkCrawlers([crawler(), crawler({ ua: "OtherBot", family: "training" })], now),
    ).toEqual([]);
  });

  it("fails an entry with no source", () => {
    const problems = checkCrawlers(
      [crawler({ source: "" }), crawler({ ua: "OtherBot", family: "training" })],
      now,
    );
    expect(problems.map((p) => p.kind)).toContain("unsourced");
  });

  it("fails a source older than 180 days", () => {
    const stale = "2025-01-01";
    const problems = checkCrawlers(
      [crawler({ as_of: stale }), crawler({ ua: "OtherBot", family: "training" })],
      now,
    );
    expect(problems).toContainEqual({
      kind: "stale",
      entry: "example-bot",
      detail: `as_of ${stale} is ${ageInDays(stale, now)} days old (limit ${AI_POLICY_MAX_AGE_DAYS})`,
    });
  });

  it("accepts a source exactly at the boundary and fails the day after", () => {
    const boundary = new Date(now.getTime() - AI_POLICY_MAX_AGE_DAYS * 86_400_000);
    const boundaryDate = boundary.toISOString().slice(0, 10);
    expect(
      checkCrawlers(
        [crawler({ as_of: boundaryDate }), crawler({ ua: "B", family: "training" })],
        now,
      ),
    ).toEqual([]);
    const older = new Date(now.getTime() - (AI_POLICY_MAX_AGE_DAYS + 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(
      checkCrawlers([crawler({ as_of: older }), crawler({ ua: "B", family: "training" })], now).map(
        (p) => p.kind,
      ),
    ).toContain("stale");
  });

  it("fails a future-dated source — a page cannot be read before it exists", () => {
    const problems = checkCrawlers(
      [crawler({ as_of: "2030-01-01" }), crawler({ ua: "B", family: "training" })],
      now,
    );
    expect(problems.map((p) => p.kind)).toContain("future-dated");
  });

  it("fails a duplicate token", () => {
    const problems = checkCrawlers(
      [crawler(), crawler({ slug: "other-bot" }), crawler({ ua: "B", family: "training" })],
      now,
    );
    expect(problems.map((p) => p.kind)).toContain("duplicate-ua");
  });

  it("fails an empty group — a robots.txt that blocks nothing is not the policy", () => {
    const problems = checkCrawlers([crawler({ family: "training" })], now);
    expect(problems).toContainEqual(
      expect.objectContaining({ kind: "empty-group", entry: "retrieval" }),
    );
  });

  it("fails an unknown family", () => {
    const problems = checkCrawlers(
      [
        crawler({ family: "scraping" as AiCrawler["family"] }),
        crawler({ ua: "B", family: "training" }),
      ],
      now,
    );
    expect(problems.map((p) => p.kind)).toContain("unknown-family");
  });
});

describe("--check command", () => {
  it("exits 0 on the shipped list", () => {
    const { code } = capture(() => runAiPolicyCheck({ now }));
    expect(code).toBe(0);
  });

  it("exits 1 when the shipped list is older than the window", () => {
    const farFuture = new Date("2035-01-01T00:00:00Z");
    const { code } = capture(() => runAiPolicyCheck({ now: farFuture }));
    expect(code).toBe(1);
  });

  it("--json carries the frozen shape", () => {
    const { code, out } = (() => {
      setJsonMode(true);
      const result = capture(() => runAiPolicyCheck({ now }));
      return result;
    })();
    expect(code).toBe(0);
    const envelope = JSON.parse(out) as JsonEnvelope & {
      data: {
        schemaVersion: string;
        policy: { maxAgeDays: number; stance: string };
        groups: { retrieval: unknown[]; training: unknown[] };
        problems: unknown[];
      };
    };
    expect(envelope.command).toBe("export ai-policy");
    expect(envelope.data.schemaVersion).toBe("1");
    expect(envelope.data.policy.maxAgeDays).toBe(180);
    expect(envelope.data.policy.stance).toBe(AI_POLICY_STANCE);
    expect(envelope.data.groups.retrieval).toHaveLength(
      AI_CRAWLERS.filter((row) => row.family === "retrieval").length,
    );
    expect(envelope.data.problems).toEqual([]);
  });
});

describe("llms.txt — the workspace index", () => {
  const input = llmsInput(load(FIXTURE), "en");
  const text = renderLlmsTxt(input);

  it("carries the name, definition and canonical identity URL", () => {
    expect(text).toContain("# Elena Vasquez");
    expect(text).toContain("> Elena Vasquez is a sovereign AI infrastructure engineer.");
    expect(text).toContain("- Canonical identity: https://github.com/elenavasquez");
  });

  it("indexes every faq row and every publication", () => {
    for (const row of input.faq) expect(text).toContain(`### ${row.q}`);
    for (const row of input.publications) expect(text).toContain(row.title);
    expect(text).toContain("https://doi.org/10.1234/jam.2024.42");
    expect(text).toContain("Source: https://elenavasquez.dev/about");
  });

  it("COVERAGE: a dropped document fails instead of vanishing", () => {
    const documents = llmsDocuments(input);
    // Prove the assertion has teeth: the same documents against text missing a
    // section must throw, naming the document that would be a silent hole.
    const broken = text.replace("### Where is Elena Vasquez based?", "");
    expect(() => assertLlmsCoverage(broken, documents)).toThrow(
      /does not index faq\.where-is-she-based/,
    );
    expect(() => assertLlmsCoverage(text, documents)).not.toThrow();
  });

  it("is deterministic: the stamp is the registry date, never the clock", () => {
    expect(text).toContain(`as of ${AI_POLICY_AS_OF}`);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("honours --lang", () => {
    const es = renderLlmsTxt(llmsInput(load(FIXTURE), "es"));
    expect(es).toContain("> Elena Vasquez es ingeniera de infraestructura de IA soberana.");
    expect(es).toContain("¿A qué se dedica Elena Vasquez?");
  });

  it("omits the identity line when no link declares role: identity", () => {
    const bare = renderLlmsTxt({ ...input, identityUrl: undefined });
    expect(bare).not.toContain("Canonical identity:");
  });
});

describe("AI-POLICY.md", () => {
  const input = llmsInput(load(FIXTURE), "en");
  const text = renderAiPolicy(input);

  it("is dated and quotes the M9 stance verbatim", () => {
    expect(text).toContain(`**Effective date:** ${AI_POLICY_AS_OF}`);
    expect(text).toContain(AI_POLICY_STANCE);
  });

  it("states what is allowed, what is blocked and who can change it", () => {
    expect(text).toContain("## Allowed — retrieval");
    expect(text).toContain("## Blocked — training");
    expect(text).toContain("## Who can change this");
    expect(text).toContain("The profile owner.");
  });

  it("names each crawler's operator source", () => {
    for (const row of AI_CRAWLERS) expect(text).toContain(`[source](${row.source})`);
  });
});

describe("--out", () => {
  it("writes the three artifacts", () => {
    const out = tempDir();
    const { code } = capture(() =>
      runAiPolicyExport({ workspace: FIXTURE, out, force: false, lang: "en", pascorc: {}, now }),
    );
    expect(code).toBe(0);
    for (const name of ["robots.txt", "llms.txt", "AI-POLICY.md"]) {
      expect(existsSync(join(out, name))).toBe(true);
    }
    expect(readFileSync(join(out, "robots.txt"), "utf8")).not.toMatch(/^User-agent: \*/m);
  });

  it("regenerates its own artifacts without --force", () => {
    const out = tempDir();
    capture(() =>
      runAiPolicyExport({ workspace: FIXTURE, out, force: false, lang: "en", pascorc: {}, now }),
    );
    const first = readFileSync(join(out, "robots.txt"), "utf8");
    const { code } = capture(() =>
      runAiPolicyExport({ workspace: FIXTURE, out, force: false, lang: "en", pascorc: {}, now }),
    );
    expect(code).toBe(0);
    expect(readFileSync(join(out, "robots.txt"), "utf8")).toBe(first);
  });

  it("never truncates a file pasco did not generate", () => {
    const out = tempDir();
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "robots.txt"), "User-agent: *\nAllow: /\n");
    const { code } = capture(() =>
      runAiPolicyExport({ workspace: FIXTURE, out, force: false, lang: "en", pascorc: {}, now }),
    );
    expect(code).toBe(1);
    expect(readFileSync(join(out, "robots.txt"), "utf8")).toBe("User-agent: *\nAllow: /\n");
    expect(existsSync(join(out, "llms.txt"))).toBe(false);
  });

  it("--force replaces a foreign file", () => {
    const out = tempDir();
    writeFileSync(join(out, "robots.txt"), "User-agent: *\nAllow: /\n");
    const { code } = capture(() =>
      runAiPolicyExport({ workspace: FIXTURE, out, force: true, lang: "en", pascorc: {}, now }),
    );
    expect(code).toBe(0);
    expect(readFileSync(join(out, "robots.txt"), "utf8")).toContain("# ai-training");
  });

  it("REFUSES to write what --check would reject (a stale UA list)", () => {
    const out = tempDir();
    const farFuture = new Date("2035-01-01T00:00:00Z");
    const { code } = capture(() =>
      runAiPolicyExport({
        workspace: FIXTURE,
        out,
        force: false,
        lang: "en",
        pascorc: {},
        now: farFuture,
      }),
    );
    expect(code).toBe(1);
    for (const name of ["robots.txt", "llms.txt", "AI-POLICY.md"]) {
      expect(existsSync(join(out, name))).toBe(false);
    }
  });

  it("renders the same bytes for the same workspace at any time of day", () => {
    const artifacts = aiPolicyArtifacts(llmsInput(load(FIXTURE), "en"));
    expect(artifacts["robots.txt"]).not.toMatch(/\d{2}:\d{2}/);
    expect(artifacts["llms.txt"]).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe("CLI surface", () => {
  function run(args: string[], cwd?: string) {
    const res = spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      cwd,
      timeout: 15_000,
    });
    if (res.error !== undefined) throw res.error;
    return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  }

  it("`export ai-policy --check` runs with no workspace and exits 0", () => {
    const dir = tempDir();
    const res = run(["export", "ai-policy", "--check"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("sourced and inside the 180-day window");
  });

  it("`--out` writes into the directory it is given", () => {
    const dir = tempDir();
    const out = join(dir, "public");
    const res = run(["export", "ai-policy", "--out", out, "--workspace", FIXTURE]);
    expect(res.code).toBe(0);
    expect(existsSync(join(out, "AI-POLICY.md"))).toBe(true);
  });

  it("usage: no mode, both modes, unknown subcommand, --force without --out", () => {
    expect(run(["export", "ai-policy"]).code).toBe(2);
    expect(run(["export", "ai-policy", "--out", "/tmp/x", "--check"]).code).toBe(2);
    expect(run(["export", "llms-txt"]).code).toBe(2);
    expect(run(["export", "ai-policy", "--check", "--force"]).code).toBe(2);
    expect(run(["export", "ai-policy", "--check", "--lang", "en"]).code).toBe(2);
  });

  it("`--help` documents both modes", () => {
    const res = run(["export", "ai-policy", "--help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("--out <dir>");
    expect(res.stdout).toContain("--check");
  });
});
