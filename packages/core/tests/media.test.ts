/**
 * M8 media pipeline (D17/D19, §18.6) — collectMedia: byte-stable asset bundling.
 *
 * The pointer-first transport (§18.3 capability matrix): `path` locators reach
 * public surfaces ONLY via the renderer `assets/` output — copied, checksummed
 * (sha256), recorded at compile; the engine never owns the binaries (D14).
 * Offline and deterministic given the machine state: findings are facts about
 * the local filesystem (existence, checksums, size), reported per §18.8-style
 * severities — workspace SSOT violations are errors, per-machine external
 * state is a warn (CI-degradable by design, §18.3).
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Profile } from "../src/index.js";
import { artifactAssetTarget, collectMedia } from "../src/index.js";

const IDENTITY =
  "name: Elena Vasquez\nlinks:\n  - label: GitHub\n    url: https://github.com/elena\n";

/** sha256 of the file contents as the engine must record it (hex, no prefix). */
function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-media-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(artifactsYaml: string): string {
  const ws = tempDir();
  const content = join(ws, "content");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "identity.yaml"), IDENTITY);
  writeFileSync(join(content, "artifacts.yaml"), artifactsYaml);
  return ws;
}

function artifact(id: string, path: string, extra = ""): string {
  return `- id: ${id}
  kind: portfolio
  title: Work ${id}
  locator:
    path: ${path}
${extra}  visibility: public
`;
}

describe("collectMedia (§18.6 media transport)", () => {
  it("bundles a public in-workspace path-locator artifact with sha256 + bytes, target assets/<id>/<basename>", () => {
    const ws = workspace(artifact("shots-2025", "media/photos/shots-2025.zip"));
    const content = "binary-ish bytes for the portfolio bundle";
    mkdirSync(join(ws, "media/photos"), { recursive: true });
    writeFileSync(join(ws, "media/photos/shots-2025.zip"), content);

    const bundle = collectMedia(
      {
        identity: { name: "Elena Vasquez" },
        artifacts: [
          {
            id: "shots-2025",
            kind: "portfolio",
            title: "Work shots-2025",
            locator: { path: "media/photos/shots-2025.zip" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );

    expect(bundle.findings).toEqual([]);
    expect(bundle.assets).toHaveLength(1);
    const a = bundle.assets[0]!;
    expect(a.artifactId).toBe("shots-2025");
    expect(a.target).toBe("assets/shots-2025/shots-2025.zip");
    expect(a.sha256).toBe(sha256(content));
    expect(a.bytes).toBe(Buffer.byteLength(content));
    expect(a.origin).toBe("workspace");
    expect(a.source.endsWith(join("media", "photos", "shots-2025.zip"))).toBe(true);
  });

  it("is sorted by artifactId and deterministic", () => {
    const ws = workspace(
      [artifact("b-two", "media/b.bin"), artifact("a-one", "media/a.bin")].join("\n"),
    );
    mkdirSync(join(ws, "media"), { recursive: true });
    writeFileSync(join(ws, "media/a.bin"), "a");
    writeFileSync(join(ws, "media/b.bin"), "b");
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "b-two",
            kind: "portfolio",
            title: "B",
            locator: { path: "media/b.bin" },
            visibility: "public",
          },
          {
            id: "a-one",
            kind: "portfolio",
            title: "A",
            locator: { path: "media/a.bin" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(bundle.assets.map((a) => a.artifactId)).toEqual(["a-one", "b-two"]);
  });

  it("skips url-locator artifacts and non-public entries", () => {
    const ws = workspace(
      [
        "- id: remote-reel\n  kind: showreel\n  title: Remote\n  locator:\n    url: https://vimeo.com/x\n",
        "- id: private-one\n  kind: portfolio\n  title: Private\n  locator:\n    path: media/p.jpg\n  visibility: private\n",
      ].join("\n"),
    );
    mkdirSync(join(ws, "media"), { recursive: true });
    writeFileSync(join(ws, "media/p.jpg"), "x");
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "remote-reel",
            kind: "showreel",
            title: "Remote",
            locator: { url: "https://vimeo.com/x" },
            visibility: "public",
          },
          {
            id: "private-one",
            kind: "portfolio",
            title: "P",
            locator: { path: "media/p.jpg" },
            visibility: "private",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(bundle.assets).toEqual([]);
    expect(bundle.findings).toEqual([]);
  });

  it("errors when an in-workspace media file is missing (SSOT violation)", () => {
    const ws = workspace(artifact("gone", "media/photos/gone.jpg"));
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "gone",
            kind: "portfolio",
            title: "G",
            locator: { path: "media/photos/gone.jpg" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(bundle.assets).toEqual([]);
    expect(bundle.findings).toHaveLength(1);
    expect(bundle.findings[0]).toMatchObject({
      code: "check/media-missing-workspace",
      severity: "error",
      path: "artifacts[0].locator.path",
    });
  });

  it("warns (not errors) when PASCO_EVIDENCE_ROOT is unset for an external locator — CI-degradable", () => {
    const ws = workspace(artifact("ext", "datasets/one.csv"));
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "ext",
            kind: "dataset",
            title: "D",
            locator: { path: "datasets/one.csv" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(bundle.assets).toEqual([]);
    expect(bundle.findings).toHaveLength(1);
    expect(bundle.findings[0]).toMatchObject({
      code: "check/media-external-missing",
      severity: "warn",
    });
  });

  it("bundles an external locator resolved through PASCO_EVIDENCE_ROOT (env tier)", () => {
    const root = tempDir();
    mkdirSync(join(root, "datasets"), { recursive: true });
    writeFileSync(join(root, "datasets/one.csv"), "id,val\n1,2\n");
    const ws = workspace(artifact("ext", "datasets/one.csv"));
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "ext",
            kind: "dataset",
            title: "D",
            locator: { path: "datasets/one.csv" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
      { evidenceRoot: root },
    );
    expect(bundle.findings).toEqual([]);
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.assets[0]).toMatchObject({
      artifactId: "ext",
      target: "assets/ext/one.csv",
      origin: "external",
      sha256: sha256("id,val\n1,2\n"),
    });
  });

  it("resolves the evidence root from the gitignored .pasco/local.toml override (tier 2)", () => {
    const root = tempDir();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs/doc.pdf"), "pdf");
    const ws = workspace(artifact("doc", "docs/doc.pdf"));
    mkdirSync(join(ws, ".pasco"), { recursive: true });
    writeFileSync(
      join(ws, ".pasco/local.toml"),
      `# local, never committed\nother = "x"\nevidence_root = "${root}"\n`,
    );
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "doc",
            kind: "document",
            title: "Doc",
            locator: { path: "docs/doc.pdf" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(bundle.findings).toEqual([]);
    expect(bundle.assets[0]).toMatchObject({ target: "assets/doc/doc.pdf", origin: "external" });
  });

  it("anchors a RELATIVE evidence root to the workspace (not the process CWD — deterministic)", () => {
    const root = tempDir();
    mkdirSync(join(root, "sets"), { recursive: true });
    writeFileSync(join(root, "sets/one.csv"), "id\n1\n");
    const ws = workspace(artifact("ext", "sets/one.csv"));
    mkdirSync(join(ws, ".pasco"), { recursive: true });
    // relative root, written in the workspace's .pasco/local.toml: resolves
    // against the workspace root, so invocation CWD cannot change the verdict
    writeFileSync(join(ws, ".pasco/local.toml"), `evidence_root = '../${root.split("/").pop()}'\n`);
    const fromSomewhereElse = tempDir(); // a different CWD must not matter
    const prev = process.cwd();
    process.chdir(fromSomewhereElse);
    try {
      const bundle = collectMedia(
        {
          identity: { name: "E" },
          artifacts: [
            {
              id: "ext",
              kind: "dataset",
              title: "D",
              locator: { path: "sets/one.csv" },
              visibility: "public",
            },
          ],
        } as unknown as Profile,
        ws,
      );
      expect(bundle.findings).toEqual([]);
      expect(bundle.assets[0]).toMatchObject({ target: "assets/ext/one.csv", origin: "external" });
    } finally {
      process.chdir(prev);
    }
  });

  it("errors when a declared checksum does not match the bundled bytes", () => {
    const ws = workspace(`- id: immut
  kind: dataset
  title: Immutable
  locator:
    path: media/data.csv
  checksum: sha256:${"a".repeat(64)}
  visibility: public
`);
    mkdirSync(join(ws, "media"), { recursive: true });
    writeFileSync(join(ws, "media/data.csv"), "actual\n");
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "immut",
            kind: "dataset",
            title: "I",
            locator: { path: "media/data.csv" },
            checksum: `sha256:${"a".repeat(64)}`,
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(bundle.findings).toHaveLength(1);
    expect(bundle.findings[0]).toMatchObject({
      code: "check/media-checksum-mismatch",
      severity: "error",
    });
    // the mismatching asset is NOT bundled — its bytes are not what the SSOT promises
    expect(bundle.assets).toEqual([]);
  });

  it("accepts a declared checksum that matches", () => {
    const content = "stable bytes\n";
    const ws = workspace(`- id: immut
  kind: dataset
  title: Immutable
  locator:
    path: media/data.csv
  checksum: sha256:${sha256(content)}
`);
    mkdirSync(join(ws, "media"), { recursive: true });
    writeFileSync(join(ws, "media/data.csv"), content);
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "immut",
            kind: "dataset",
            title: "I",
            locator: { path: "media/data.csv" },
            checksum: `sha256:${sha256(content)}`,
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(bundle.findings).toEqual([]);
    expect(bundle.assets).toHaveLength(1);
  });

  it("warns when a workspace locator resolves through a symlink outside the workspace (§18.7), unless checksummed", () => {
    const outside = tempDir();
    writeFileSync(join(outside, "big.jpg"), "outside-bytes");
    const ws = workspace(artifact("linked", "media/photos/big.jpg"));
    mkdirSync(join(ws, "media/photos"), { recursive: true });
    symlinkSync(join(outside, "big.jpg"), join(ws, "media/photos/big.jpg"));

    const noChecksum = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "linked",
            kind: "gallery",
            title: "L",
            locator: { path: "media/photos/big.jpg" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(noChecksum.findings.map((f) => f.code)).toEqual(["check/media-symlink-external"]);

    const withChecksum = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "linked",
            kind: "gallery",
            title: "L",
            locator: { path: "media/photos/big.jpg" },
            checksum: `sha256:${sha256("outside-bytes")}`,
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(withChecksum.findings).toEqual([]);
  });

  it("warns on oversize files (default 50 MB per §18.6; parameterized for tests)", () => {
    const ws = workspace(artifact("big", "media/big.bin"));
    mkdirSync(join(ws, "media"), { recursive: true });
    writeFileSync(join(ws, "media/big.bin"), "x".repeat(10));
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "big",
            kind: "portfolio",
            title: "B",
            locator: { path: "media/big.bin" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
      { maxBytes: 5 },
    );
    expect(bundle.findings.map((f) => f.code)).toEqual(["check/media-oversize"]);
    // oversize is a warn — the asset still bundles (git-lfs is the operator's choice)
    expect(bundle.assets).toHaveLength(1);
  });

  it("errors when the resolved path escapes the workspace or evidence root (containment guard)", () => {
    const ws = workspace(artifact("escape", "media/../../outside.txt"));
    const root = tempDir();
    writeFileSync(join(root, "inside.txt"), "ok");
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            id: "escape",
            kind: "document",
            title: "X",
            locator: { path: "media/../../outside.txt" },
            visibility: "public",
          },
          {
            id: "ext-escape",
            kind: "dataset",
            title: "Y",
            locator: { path: "../outside.csv" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
      { evidenceRoot: root },
    );
    expect(bundle.findings).toHaveLength(2);
    expect(bundle.findings[0]).toMatchObject({
      code: "check/media-path-unsafe",
      severity: "error",
    });
    expect(bundle.findings[1]).toMatchObject({
      code: "check/media-path-unsafe",
      severity: "error",
    });
  });

  it("warns on a public path-locator artifact without id (cannot get a stable target)", () => {
    const ws = workspace("- kind: portfolio\n  title: No id\n  locator:\n    path: media/x.jpg\n");
    mkdirSync(join(ws, "media"), { recursive: true });
    writeFileSync(join(ws, "media/x.jpg"), "x");
    const bundle = collectMedia(
      {
        identity: { name: "E" },
        artifacts: [
          {
            kind: "portfolio",
            title: "No id",
            locator: { path: "media/x.jpg" },
            visibility: "public",
          },
        ],
      } as unknown as Profile,
      ws,
    );
    expect(bundle.assets).toEqual([]);
    expect(bundle.findings.map((f) => f.code)).toEqual(["check/media-unbundled-no-id"]);
  });

  it("artifactAssetTarget is pure and collision-free per artifact id", () => {
    expect(artifactAssetTarget("media/photos/2024/reel.mp4", "reel-2025")).toBe(
      "assets/reel-2025/reel.mp4",
    );
    expect(artifactAssetTarget("media/x.jpg", "a")).toBe("assets/a/x.jpg");
  });
});
