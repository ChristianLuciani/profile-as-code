/**
 * `pasco preview` — one self-contained HTML file, and the privacy gate that
 * refuses to write it when it would leak (issue #282, SPEC §7.8).
 *
 * What this file pins:
 *  - the artifact shape: ONE file, doctype + inline <style>, no `<script>`, no
 *    `<link>`, no external `src` — the "opens with no network and no JS" claim;
 *  - the two transports: the default writes outside the versioned tree, `--out`
 *    writes where it is told and opens NOTHING;
 *  - the gate: each refusal class is seeded (a token, an absolute path) and the
 *    write must NOT happen — a refused preview leaves no file to clean up;
 *  - escaping: raw HTML in content is shown as text, never executed (the renderer
 *    override, proven on the built CLI);
 *  - determinism: the same workspace plus the same `--now` is byte-identical.
 *
 * The unit half (`scanPreviewHtml`, `checkSources`, `countFacts`) seeds the
 * defect directly: a gate whose failure mode cannot be reproduced is folklore.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { countFacts } from "../src/commands/preview.js";
import { markdownToHtml } from "../src/preview/document.js";
import { checkSources, isInside, scanPreviewHtml } from "../src/preview/privacy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "fixtures", "export-profile");
const NOW = "2026-10-29T12:00:00Z";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd?: string): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    timeout: 60_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tempDirs: string[] = [];

/** A throwaway COPY of the fixture workspace (never write into the fixture). */
function workspaceCopy(seed?: { file: string; from: string; to: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-preview-"));
  tempDirs.push(dir);
  spawnSync("cp", ["-R", FIXTURE, dir], { encoding: "utf8" });
  const workspace = join(dir, "export-profile");
  if (seed !== undefined) {
    const path = join(workspace, "content", seed.file);
    const text = readFileSync(path, "utf8");
    expect(text).toContain(seed.from);
    writeFileSync(path, text.replace(seed.from, seed.to));
  }
  return workspace;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pasco preview — the artifact", () => {
  it("writes ONE self-contained file: inline style, no script, no link, no remote src", () => {
    const workspace = workspaceCopy();
    const out = join(workspace, "out");
    const result = run(["preview", "--workspace", workspace, "--out", out, "--now", NOW]);
    expect(result.code).toBe(0);
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toMatch(/<style>/u);
    expect(html).not.toMatch(/<script/iu);
    expect(html).not.toMatch(/<link\b/iu);
    // Assert with the gate itself: a second copy of the attribute regex is how
    // the round-1 bug survived its own test (round-2 F5).
    expect(scanPreviewHtml(html)).toEqual([]);
    expect(html).not.toMatch(/@import/iu);
    // The surfaces that publish for this language are sections; the rest are
    // LISTED, never silently dropped.
    expect(html).toContain('id="github-readme"');
    expect(html).toContain('id="linkedin"');
    expect(html).toContain('id="not-published"');
    expect(html).toContain('id="checks"');
    // Freshness, not a version.
    expect(html).toMatch(/generated 2026-10-29T12:00:00Z from \d+ facts/u);
    expect(html).toContain('name="robots" content="noindex, nofollow, noarchive"');
  });

  it("turns a remote badge into text instead of a fetch, and keeps the profile's own links", () => {
    const workspace = workspaceCopy();
    const out = join(workspace, "out");
    expect(run(["preview", "--workspace", workspace, "--out", out, "--now", NOW]).code).toBe(0);
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toMatch(/<span class="asset-note" title="https:\/\/img\.shields\.io/u);
    expect(html).not.toMatch(/<img[^>]*src="https?:/iu);
    expect(html).toMatch(/<a href="https:\/\/github\.com\/elenavasquez"/u);
  });

  it("escapes raw HTML from the content — never executes it", () => {
    const workspace = workspaceCopy({
      file: "identity.yaml",
      from: "Elena Vasquez",
      to: "Elena <script>alert(1)</script>",
    });
    const out = join(workspace, "out");
    const result = run(["preview", "--workspace", workspace, "--out", out, "--now", NOW]);
    expect(result.code).toBe(0);
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).not.toMatch(/<script/iu);
    expect(html).toContain("&lt;script&gt;");
  });

  it("defaults to <workspace>/.pasco/preview/index.html and --no-open opens nothing", () => {
    const workspace = workspaceCopy();
    const result = run(["preview", "--workspace", workspace, "--no-open", "--now", NOW]);
    expect(result.code).toBe(0);
    expect(existsSync(join(workspace, ".pasco", "preview", "index.html"))).toBe(true);
    expect(result.stdout).toContain("privacy gate");
  });

  it("--json carries the path, the surfaces and the gate result", () => {
    const workspace = workspaceCopy();
    const out = join(workspace, "out");
    const result = run(["preview", "--workspace", workspace, "--out", out, "--now", NOW, "--json"]);
    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.command).toBe("preview");
    expect(envelope.ok).toBe(true);
    expect(envelope.exitCode).toBe(0);
    expect(envelope.data.written).toBe(true);
    expect(envelope.data.path).toBe(join(out, "index.html"));
    expect(envelope.data.opened).toBe(false);
    expect(envelope.data.generatedAt).toBe("2026-10-29T12:00:00Z");
    expect(envelope.data.privacy.findings).toEqual([]);
    expect(
      envelope.data.sections.some((s: { platform: string }) => s.platform === "github-readme"),
    ).toBe(true);
  });

  it("dates the check rules from --now, not from the machine clock (round-2 F1)", () => {
    // A credential expiring 2023-01-01: under a 2022 pin it is NOT expired, under
    // a 2024 pin it is. Reading the machine clock would print "expired" in both
    // runs — and change the bytes from one day to the next.
    const workspace = workspaceCopy({
      file: "credentials.yaml",
      from: "  issued: 2021-06-01",
      to: "  issued: 2021-06-01\n  expires: 2023-01-01",
    });
    const past = join(workspace, "past");
    const future = join(workspace, "future");
    expect(
      run(["preview", "--workspace", workspace, "--out", past, "--now", "2022-01-01T00:00:00Z"])
        .code,
    ).toBe(0);
    expect(
      run(["preview", "--workspace", workspace, "--out", future, "--now", "2024-01-01T00:00:00Z"])
        .code,
    ).toBe(0);
    expect(readFileSync(join(past, "index.html"), "utf8")).not.toContain("expired 2023-01-01");
    expect(readFileSync(join(future, "index.html"), "utf8")).toContain("expired 2023-01-01");
  });

  it("is byte-identical for the same workspace and the same --now", () => {
    const workspace = workspaceCopy();
    const a = join(workspace, "a");
    const b = join(workspace, "b");
    expect(run(["preview", "--workspace", workspace, "--out", a, "--now", NOW]).code).toBe(0);
    expect(run(["preview", "--workspace", workspace, "--out", b, "--now", NOW]).code).toBe(0);
    expect(readFileSync(join(a, "index.html"), "utf8")).toBe(
      readFileSync(join(b, "index.html"), "utf8"),
    );
  });

  it("warns when --out lands inside a git work tree that does not ignore it", () => {
    const workspace = workspaceCopy();
    const out = join(workspace, "out");
    expect(spawnSync("git", ["init", "-q", workspace], { encoding: "utf8" }).status).toBe(0);
    const result = run(["preview", "--workspace", workspace, "--out", out, "--now", NOW]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("not ignored");
    // …and in the page's own notes: resolving the destination before the render
    // is what keeps the two surfaces from disagreeing (round-2 F7).
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain("not ignored");
  });

  it("refuses a positional argument and a malformed --now (usage, exit 2)", () => {
    const workspace = workspaceCopy();
    expect(run(["preview", "github", "--workspace", workspace]).code).toBe(2);
    expect(run(["preview", "--workspace", workspace, "--now", "yesterday"]).code).toBe(2);
    // ISO-prefixed but not a real instant: still usage, never exit 1 (review F4).
    expect(run(["preview", "--workspace", workspace, "--now", "2026-13-01T00:00:00Z"]).code).toBe(
      2,
    );
    expect(run(["preview", "--workspace", workspace, "--now", "2026-10-29T99:99:99Z"]).code).toBe(
      2,
    );
    // Date.parse normalizes these into another instant; the contract does not.
    expect(run(["preview", "--workspace", workspace, "--now", "2026-02-30T00:00:00Z"]).code).toBe(
      2,
    );
    expect(run(["preview", "--workspace", workspace, "--now", "2026-10-29T24:00:00Z"]).code).toBe(
      2,
    );
    expect(
      run([
        "preview",
        "--workspace",
        workspace,
        "--out",
        join(workspace, "o2"),
        "--now",
        "2026-10-29T12:00:00-05:00",
      ]).code,
    ).toBe(0);
  });
});

describe("pasco preview — the privacy gate refuses the write", () => {
  it("refuses a credential pasted into the data (and leaves no file behind)", () => {
    const workspace = workspaceCopy({
      file: "identity.yaml",
      from: "Elena Vasquez",
      to: "Elena ghp_0123456789abcdefghijklmnop",
    });
    const out = join(workspace, "out");
    const result = run(["preview", "--workspace", workspace, "--out", out, "--now", NOW]);
    expect(result.code).toBe(1);
    expect(existsSync(join(out, "index.html"))).toBe(false);
    expect(result.stderr).toContain("privacy");
    expect(result.stderr).toContain("credential");
    // Redacted at creation: the token must not survive in the message or stdout
    // (round-2 F8).
    expect(result.stderr).not.toContain("ghp_");
    expect(result.stdout).not.toContain("ghp_");
  });

  it("refuses an absolute local path in the data", () => {
    const workspace = workspaceCopy({
      file: "identity.yaml",
      from: "Elena Vasquez",
      to: "Elena /Users/secret/private/profile.yaml",
    });
    const out = join(workspace, "out");
    const result = run(["preview", "--workspace", workspace, "--out", out, "--now", NOW]);
    expect(result.code).toBe(1);
    expect(existsSync(join(out, "index.html"))).toBe(false);
    expect(result.stderr).toContain("absolute-path");
  });

  it("refuses with --json too: written false, the findings enumerated", () => {
    const workspace = workspaceCopy({
      file: "identity.yaml",
      from: "Elena Vasquez",
      to: "Elena AKIAIOSFODNN7EXAMPLE",
    });
    const out = join(workspace, "out");
    const result = run(["preview", "--workspace", workspace, "--out", out, "--now", NOW, "--json"]);
    expect(result.code).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.data.written).toBe(false);
    expect(envelope.data.path).toBe(null);
    expect(envelope.data.privacy.findings[0].rule).toBe("credential");
    expect(envelope.error.kind).toBe("privacy");
  });
});

describe("preview privacy — the gate's own teeth (seeded)", () => {
  it("catches each byte-level class", () => {
    expect(scanPreviewHtml("<p>/Users/eva/data/x.yaml</p>")[0]?.rule).toBe("absolute-path");
    expect(scanPreviewHtml("<p>file:///etc/passwd</p>")[0]?.rule).toBe("absolute-path");
    expect(scanPreviewHtml("<p>C:\\Users\\eva\\x</p>")[0]?.rule).toBe("absolute-path");
    expect(scanPreviewHtml("<p>ghp_0123456789abcdefghijklmnop</p>")[0]?.rule).toBe("credential");
    expect(scanPreviewHtml("<p>-----BEGIN RSA PRIVATE KEY-----</p>")[0]?.rule).toBe("credential");
    expect(scanPreviewHtml('<img src="https://cdn.example/x.png">')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "external-asset" })]),
    );
    expect(scanPreviewHtml('<link rel="stylesheet" href="x.css">')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "external-asset" })]),
    );
    expect(scanPreviewHtml("<style>a{background:url(https://x/y.png)}</style>")).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "external-asset" })]),
    );
    expect(scanPreviewHtml("<script>alert(1)</script>")).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "active-content" })]),
    );
    expect(scanPreviewHtml('<a href="javascript:alert(1)">x</a>')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "active-content" })]),
    );
    expect(scanPreviewHtml('<div onclick="x()">x</div>')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "active-content" })]),
    );
    // Round-2 F2: a `>` inside a quoted attribute does not end the tag, and an
    // inline `style` is CSS in a tag — both used to slip past the gate.
    expect(scanPreviewHtml('<img alt="a>b" src="https://evil.example/x.png">')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "external-asset" })]),
    );
    expect(
      scanPreviewHtml('<div style="background:url(https://evil.example/x.png)">x</div>'),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "external-asset" })]));
    expect(
      scanPreviewHtml('<div style="background:url(data:image/svg+xml;base64,AA)">x</div>'),
    ).toEqual([]);
    expect(scanPreviewHtml("<!doctype html><p>clean, inline data:image only</p>")).toEqual([]);
  });

  it("admits a QUOTED data: URI and every inline form the page emits (review F1)", () => {
    // The defect: an optional quote before the lookahead backtracks, so
    // `src="data:image/..."` matched "not inline" and inlined workspace media
    // (the feature) made the gate refuse the write.
    expect(scanPreviewHtml('<img src="data:image/png;base64,AAAA">')).toEqual([]);
    expect(scanPreviewHtml("<img src='data:image/png;base64,AAAA'>")).toEqual([]);
    expect(scanPreviewHtml('<img src="data:image/svg+xml;base64,AAAAEEE=" alt="x">')).toEqual([]);
    expect(
      scanPreviewHtml('<img src="data:image/png;base64,AA" srcset="data:image/png;base64,BB 2x">'),
    ).toEqual([]);
    expect(
      scanPreviewHtml('<style>a{background:url("data:image/svg+xml;base64,AA")}</style>'),
    ).toEqual([]);
    expect(scanPreviewHtml('<a href="#github-readme">jump</a>')).toEqual([]);
    // …and the real renderer + the real gate agree on an inlined asset.
    const assets = new Map([
      [
        "assets/logo/logo.png",
        { target: "assets/logo/logo.png", dataUri: "data:image/png;base64,AAAA", bytes: 3 },
      ],
    ]);
    const html = markdownToHtml("![logo](assets/logo/logo.png)", assets);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(scanPreviewHtml(html)).toEqual([]);
  });

  it("does not judge ESCAPED html as markup (review F2)", () => {
    // The renderer escapes raw HTML; inert text must not be refused as a live
    // element, or a bio that merely mentions an <img> cannot be previewed.
    const escaped = [
      "&lt;img src=&quot;https://example.com/x.png&quot; alt=&quot;a&quot;&gt;",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
      "&lt;div onclick=&quot;x()&quot;&gt;y&lt;/div&gt;",
      "&lt;link rel=&quot;stylesheet&quot; href=&quot;x.css&quot;&gt;",
    ];
    for (const text of escaped) {
      expect(scanPreviewHtml(`<pre class="raw-html">${text}</pre>`)).toEqual([]);
    }
    // A REAL tag of the same shape is still refused.
    expect(scanPreviewHtml('<pre>&lt;x&gt;</pre><img src="https://example.com/x.png">')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "external-asset" })]),
    );
    // Same through the renderer: raw HTML in the data is escaped and passes.
    const html = markdownToHtml('<img src="https://example.com/x.png">', new Map());
    expect(html).toContain("&lt;img");
    expect(scanPreviewHtml(html)).toEqual([]);
  });

  it("never echoes the secret it refused (review F3)", () => {
    const token = "ghp_0123456789abcdefghijklmnop";
    const [finding] = scanPreviewHtml(`<p>${token}</p>`);
    expect(finding?.rule).toBe("credential");
    expect(finding?.detail).not.toContain(token);
    expect(finding?.detail).not.toContain("ghp_");
    expect(finding?.detail).toContain("redacted");
  });

  it("refuses a source outside the workspace, a missing source and a credential-shaped asset", () => {
    const root = mkdtempSync(join(tmpdir(), "pasco-gate-"));
    tempDirs.push(root);
    const workspace = join(root, "ws");
    mkdirSync(join(workspace, "content"), { recursive: true });
    writeFileSync(join(workspace, "content", "identity.yaml"), "name: x\n");
    const inside = join(workspace, "content", "identity.yaml");
    const outside = join(root, "outside.png");
    writeFileSync(outside, "bytes");
    writeFileSync(join(workspace, "content", ".env"), "TOKEN=1");

    expect(checkSources([{ role: "content", path: inside }], workspace)).toEqual([]);
    expect(checkSources([{ role: "asset", path: outside }], workspace)[0]?.rule).toBe(
      "source-outside-declared-roots",
    );
    expect(
      checkSources(
        [{ role: "content", path: join(workspace, "content", "nope.yaml") }],
        workspace,
      )[0]?.rule,
    ).toBe("source-missing");
    expect(
      checkSources([{ role: "asset", path: join(workspace, "content", ".env") }], workspace)[0]
        ?.rule,
    ).toBe("credential-file");
    expect(isInside(workspace, inside)).toBe(true);
    expect(isInside(workspace, outside)).toBe(false);
  });

  it("counts facts as the non-empty scalar leaves (derived, never typed)", () => {
    expect(countFacts({ a: "x", b: "", c: 1, d: [true, null, "y"], e: { f: "z" } })).toBe(5);
    expect(countFacts(null)).toBe(0);
  });

  it("markdownToHtml keeps no <script> and refuses javascript: links", () => {
    const html = markdownToHtml("<script>alert(1)</script>\n\n[x](javascript:alert(1))", new Map());
    expect(html).not.toMatch(/<script/iu);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/iu);
  });
});
