/**
 * `pasco edit` — S2 of epic #247 (issue #249): the comment-preserving
 * single-value writer. The recorded decision (2026-10-21, `main@647c510`) is the
 * contract this file pins:
 *
 *  - range splice over the ORIGINAL text → comments and layout survive, diff = one line;
 *  - block AND multi-line scalars refused (exit 2), no fourth exit code;
 *  - no-op = exit 0 + `noop: true`, nothing written;
 *  - temp file + `load()`/schema over a temp copy + atomic rename → an invalid
 *    edit never reaches disk;
 *  - CRLF and the final newline preserved.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LoadError } from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { StaleEditError, writeEdit } from "../src/edit-write.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const MINIMAL = join(__dirname, "..", "..", "core", "tests", "fixtures", "minimal");

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A workspace whose bios/headlines are SINGLE-LINE decorated with comments —
 *  the shape the writer accepts (the committed `minimal` fixture wraps its bios,
 *  which is the multi-line shape the decision refuses). */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-write-"));
  tempDirs.push(dir);
  cpSync(MINIMAL, dir, { recursive: true });
  writeFileSync(
    join(dir, "content", "bios.yaml"),
    `# links CANÓNICOS: acá vive la verdad de tus URLs (sameAs GEO).
# v1.5 (issue #71): el email de contacto es un HECHO del identity, no un link
- platform: github-readme
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
  text: Senior AI engineer designing local-first LLM infrastructure.  # ojo: no reflow
- platform: linkedin
  lang: es
  length: medium
  text: Ingeniera senior de IA diseñando infraestructura local-first.
# cola: no borrar
`,
  );
  return dir;
}

function run(dir: string, ...args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args, "--workspace", dir], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const fileOf = (dir: string, name = "bios.yaml") => join(dir, "content", name);
const hashOf = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("pasco edit — S2 writer (range splice)", () => {
  it("changes exactly ONE line and keeps every comment byte-identical", () => {
    const dir = workspace();
    const before = readFileSync(fileOf(dir), "utf8");
    const r = run(
      dir,
      "edit",
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Senior AI engineer. Local-first LLM infrastructure.",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("file:     content/bios.yaml");
    expect(r.stdout).toContain("written: yes");
    expect(r.stdout).toContain("validates: yes");

    const after = readFileSync(fileOf(dir), "utf8");
    // Comments survive byte-for-byte, including the trailing one on the edited
    // line (the splice replaces the scalar's range, nothing else).
    expect(after).toContain("# links CANÓNICOS: acá vive la verdad de tus URLs (sameAs GEO).");
    expect(after).toContain("# v1.5 (issue #71): el email de contacto es un HECHO del identity");
    expect(after).toContain("# ojo: no reflow");
    expect(after).toContain("# cola: no borrar");
    expect(after.split("\n").filter((line) => line !== "")).toHaveLength(
      before.split("\n").filter((line) => line !== "").length,
    );
    // exactly one line differs
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    const changed = afterLines.filter((line, index) => line !== beforeLines[index]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("Senior AI engineer. Local-first LLM infrastructure.");
  });

  it("keeps the one-line diff in git terms too (numstat 1/1)", () => {
    const dir = workspace();
    const git = (...args: string[]) =>
      spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 15_000 });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@test.test");
    git("config", "user.name", "test");
    git("add", "-A");
    git("commit", "-qm", "base");
    const r = run(
      dir,
      "edit",
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "One line, one change.",
    );
    expect(r.code).toBe(0);
    const stat = (git("diff", "--numstat").stdout ?? "").trim();
    expect(stat).toBe("1\t1\tcontent/bios.yaml");
  });

  it("normalizes a quoted scalar without moving a line", () => {
    const dir = workspace();
    writeFileSync(
      fileOf(dir),
      readFileSync(fileOf(dir), "utf8").replace(
        "  text: Senior AI engineer designing local-first LLM infrastructure.  # ojo: no reflow",
        '  text: "Senior AI engineer designing local-first LLM infrastructure."  # ojo: no reflow',
      ),
    );
    const before = readFileSync(fileOf(dir), "utf8");
    const r = run(
      dir,
      "edit",
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Quoted value: with colon",
    );
    expect(r.code).toBe(0);
    const after = readFileSync(fileOf(dir), "utf8");
    expect(after).toContain("# ojo: no reflow");
    expect(after.split("\n").filter((line) => line !== "")).toHaveLength(
      before.split("\n").filter((line) => line !== "").length,
    );
    // The value needs quoting (it carries ": ") — the writer emits one line and
    // lets `yaml` choose the quoting (double quotes here).
    expect(after).toContain('"Quoted value: with colon"');
  });

  it("refuses a BLOCK scalar (|), leaving the file untouched", () => {
    const dir = workspace();
    writeFileSync(
      fileOf(dir),
      readFileSync(fileOf(dir), "utf8").replace(
        "  text: Senior AI engineer designing local-first LLM infrastructure.  # ojo: no reflow",
        "  text: |\n    Senior AI engineer designing\n    local-first LLM infrastructure.",
      ),
    );
    const before = hashOf(fileOf(dir));
    const r = run(dir, "edit", "bios[platform=linkedin,lang=en,length=medium].text", "--set", "X");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("block scalar");
    expect(hashOf(fileOf(dir))).toBe(before);
  });

  it("refuses a multi-line (wrapped) plain scalar, leaving the file untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-write-multiline-"));
    tempDirs.push(dir);
    cpSync(MINIMAL, dir, { recursive: true }); // the committed fixture wraps its bios
    const before = hashOf(fileOf(dir));
    const r = run(dir, "edit", "bios[platform=linkedin,lang=en,length=medium].text", "--set", "X");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("multi-line scalar");
    expect(hashOf(fileOf(dir))).toBe(before);
  });

  it("is a no-op (exit 0, noop) when the value is already there", () => {
    const dir = workspace();
    const before = hashOf(fileOf(dir));
    const r = run(
      dir,
      "edit",
      "bios[platform=linkedin,lang=en,length=medium].text",
      "--set",
      "Senior AI engineer designing local-first LLM infrastructure.",
      "--json",
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: Record<string, unknown> };
    expect(parsed.data.noop).toBe(true);
    expect(parsed.data.written).toBe(false);
    expect(parsed.data.ok).toBe(true);
    expect(hashOf(fileOf(dir))).toBe(before);
  });

  it("preserves CRLF and the final newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasco-write-crlf-"));
    tempDirs.push(dir);
    cpSync(MINIMAL, dir, { recursive: true });
    const crlf = ["# crlf fixture", "- platform: x", "  lang: en", "  text: Old headline", ""].join(
      "\r\n",
    );
    writeFileSync(fileOf(dir, "headlines.yaml"), crlf);
    const r = run(dir, "edit", "headlines[platform=x,lang=en].text", "--set", "New headline");
    expect(r.code).toBe(0);
    const after = readFileSync(fileOf(dir, "headlines.yaml"), "utf8");
    expect(after).toBe(
      ["# crlf fixture", "- platform: x", "  lang: en", "  text: New headline", ""].join("\r\n"),
    );
    expect(after.includes("\n\n")).toBe(false);
    expect(after.endsWith("\r\n")).toBe(true);
  });

  it("never writes when the resulting workspace would not validate (forced invalid)", () => {
    const dir = workspace();
    const before = hashOf(fileOf(dir));
    // The validator seam is the acceptance's "forced invalid" fixture: the temp
    // copy fails `load()` and the original file must survive untouched.
    expect(() =>
      writeEdit(
        {
          workspace: dir,
          target: { file: "content/bios.yaml", path: [2, "text"] },
          value: "Valid text, invalid workspace",
        },
        {
          validate: () => {
            throw new LoadError("forced invalid (test)");
          },
        },
      ),
    ).toThrow(LoadError);
    expect(hashOf(fileOf(dir))).toBe(before);
    const leftovers = readdirSync(join(dir, "content")).filter((name) =>
      name.startsWith(".pasco-edit-"),
    );
    expect(leftovers).toEqual([]);
  });

  it("refuses a path the file no longer has (stale preview)", () => {
    const dir = workspace();
    const before = hashOf(fileOf(dir));
    expect(() =>
      writeEdit({
        workspace: dir,
        target: { file: "content/bios.yaml", path: [99, "text"] },
        value: "X",
      }),
    ).toThrow(StaleEditError);
    expect(hashOf(fileOf(dir))).toBe(before);
  });

  it("refuses an ANCHORED scalar (rewriting it would change every alias)", () => {
    const dir = workspace();
    writeFileSync(
      fileOf(dir, "headlines.yaml"),
      "- platform: x\n  lang: en\n  text: &voice Anchored\n- platform: linkedin\n  lang: en\n  text: *voice\n",
    );
    const before = hashOf(fileOf(dir, "headlines.yaml"));
    const r = run(dir, "edit", "headlines[platform=x,lang=en].text", "--set", "Changed");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("anchor");
    const alias = run(dir, "edit", "headlines[platform=linkedin,lang=en].text", "--set", "Changed");
    expect(alias.code).toBe(2);
    expect(alias.stderr).toContain("alias");
    expect(hashOf(fileOf(dir, "headlines.yaml"))).toBe(before);
  });

  it("refuses to splice when the file moved since the preview (stale expect)", () => {
    const dir = workspace();
    const before = hashOf(fileOf(dir));
    expect(() =>
      writeEdit({
        workspace: dir,
        target: { file: "content/bios.yaml", path: [2, "text"] },
        value: "New",
        expect: "something the file does not hold",
      }),
    ).toThrow(StaleEditError);
    expect(hashOf(fileOf(dir))).toBe(before);
  });

  it("keeps a symlinked content file a symlink and updates its target", () => {
    const dir = workspace();
    const realDir = mkdtempSync(join(tmpdir(), "pasco-write-real-"));
    tempDirs.push(realDir);
    const real = join(realDir, "headlines.yaml");
    writeFileSync(real, "- platform: x\n  lang: en\n  text: Old\n");
    rmSync(fileOf(dir, "headlines.yaml"));
    symlinkSync(real, fileOf(dir, "headlines.yaml"));
    const r = run(dir, "edit", "headlines[platform=x,lang=en].text", "--set", "Via link");
    expect(r.code).toBe(0);
    expect(lstatSync(fileOf(dir, "headlines.yaml")).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toContain("Via link");
  });

  it("preserves the file mode (a read-only content file stays read-only)", () => {
    const dir = workspace();
    chmodSync(fileOf(dir, "headlines.yaml"), 0o444);
    const r = run(dir, "edit", "headlines[platform=x,lang=en].text", "--set", "Still read-only");
    expect(r.code).toBe(0);
    expect(readFileSync(fileOf(dir, "headlines.yaml"), "utf8")).toContain("Still read-only");
    expect(statSync(fileOf(dir, "headlines.yaml")).mode & 0o777).toBe(0o444);
  });

  it("quotes a flow-row value that needs it (round-trip through the parser)", () => {
    const dir = workspace();
    writeFileSync(fileOf(dir, "headlines.yaml"), "- {platform: x, lang: en, text: Old}\n");
    const r = run(dir, "edit", "headlines[platform=x,lang=en].text", "--set", "a, b");
    expect(r.code).toBe(0);
    const after = readFileSync(fileOf(dir, "headlines.yaml"), "utf8");
    expect(after.trim()).toBe('- {platform: x, lang: en, text: "a, b"}');
  });

  it("preserves a missing final newline and a single-quoted scalar", () => {
    const dir = workspace();
    writeFileSync(fileOf(dir, "headlines.yaml"), "- platform: x\n  lang: en\n  text: 'Old'");
    const r = run(dir, "edit", "headlines[platform=x,lang=en].text", "--set", "New");
    expect(r.code).toBe(0);
    const after = readFileSync(fileOf(dir, "headlines.yaml"), "utf8");
    expect(after).toBe("- platform: x\n  lang: en\n  text: New");
  });

  it("reports a write failure (read-only directory) without leaking a temp path", () => {
    const dir = workspace();
    const before = hashOf(fileOf(dir));
    chmodSync(join(dir, "content"), 0o555);
    try {
      const r = run(dir, "edit", "headlines[platform=x,lang=en].text", "--set", "Blocked");
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("could not write");
      expect(r.stderr).not.toContain("/var/");
      expect(r.stderr).not.toContain("/tmp/");
      expect(hashOf(fileOf(dir))).toBe(before);
    } finally {
      chmodSync(join(dir, "content"), 0o755);
    }
  });

  it("--json surfaces the selection warning of a write it proceeds with", () => {
    const dir = workspace();
    writeFileSync(
      join(dir, ".pascorc"),
      '{ "selection": { "default": { "excludeKeys": ["projects:nope"] } } }\n',
    );
    const r = run(dir, "edit", "headlines[platform=x,lang=en].text", "--set", "Warned", "--json");
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: Record<string, unknown> };
    expect(parsed.data.written).toBe(true);
    expect(parsed.data.warnings).toHaveLength(1);
    expect(String((parsed.data.warnings as string[])[0])).toContain("excludes");
  });

  it("writes a langMap value (positioning.statement.<lang>)", () => {
    const dir = workspace();
    const r = run(dir, "edit", "positioning.statement.en", "--set", "A new statement.");
    expect(r.code).toBe(0);
    expect(readFileSync(fileOf(dir, "positioning.yaml"), "utf8")).toContain("en: A new statement.");
  });

  it("reports written but published separately when the artifact ignores the row", () => {
    const dir = workspace();
    // The upwork artifact is the paste source (one bio); a headline edit there
    // is a legitimate SSOT write that no artifact emits — the command must say
    // both things instead of blocking the write.
    const r = run(
      dir,
      "edit",
      "headlines[platform=upwork,lang=en].text",
      "--set",
      "New upwork line",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("written: yes");
    expect(r.stdout).toContain("does not change the artifact");
    expect(existsSync(fileOf(dir, "headlines.yaml"))).toBe(true);
  });
});
