/**
 * The D27 LEAK SURFACES (issue #498, S4c) — one workspace, one marker, every
 * public surface that must never carry a non-public row.
 *
 * The rule this file enforces is SPEC §18.5 under the v2.0 default: only
 * `visibility: public` leaves the workspace, and an ABSENT field is private. The
 * fixture (`packages/core/tests/fixtures/leak-matrix/`) declares one `public`
 * and one `private` row per visibility-carrying block — `credentials`,
 * `artifacts`, `projects`, `experience`, `achievements` — plus a ledger record
 * and a release event addressed to a private unit. Every private value carries
 * the `PRIVATE-` marker, so "does surface X leak?" is a scan, not a judgement.
 *
 * Why per SURFACE instead of per function: the filter has one home (`compile()`
 * for a renderer slice, `structuredData()` for the JSON-LD, `publicProjection()`
 * for the export), and a test of the helper would keep passing the day a caller
 * stops using it. Each case here drives a real consumer — the nine renderers,
 * `entity`, `export profile`, `preview`, `audit --public`, and the `pasco post`
 * fact pointers — and scans its bytes. The `--all`/SSOT assertion is the
 * positive control: the markers are in the fixture, so a clean surface is the
 * filter working, not an empty fixture.
 *
 * Two cases guard the SEAM rather than the pipeline: a renderer's input type
 * (`PlatformProfile`) is documented to accept hand-built slices, and
 * `github-readme` already re-applied `isPublicEntry()` to credentials/artifacts
 * (§18.5, pre-dating D27). A hand-built slice must not be a bypass.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compile,
  load,
  type Platform,
  type PlatformProfile,
  publicProjection,
  structuredData,
} from "@profile-as-code/core";
import { afterAll, describe, expect, it } from "vitest";
import { renderFacts } from "../src/commands/post.js";
import { RENDERERS } from "../src/generated/renderers.gen.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "..", "..", "core", "tests", "fixtures", "leak-matrix");

/** Every private value in the fixture starts with this prefix. */
const MARKER = "PRIVATE-";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (res.error !== undefined) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Assert a surface emitted no marked line — reporting the offending lines makes
 *  the failure name the leak instead of printing a 100 KB artifact diff. */
function expectNoLeak(surface: string, text: string): void {
  const hits = text.split("\n").filter((line) => line.includes(MARKER));
  expect(hits, `${surface} emitted a non-public row (SPEC §18.5 / D27)`).toEqual([]);
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-leak-"));
  tempDirs.push(dir);
  return dir;
}

describe("D27 leak — the renderer surfaces (compile is the choke point)", () => {
  it("every renderer's artifact is clean for the whole platform set", () => {
    const profile = load(FIXTURE);
    const platforms = Object.keys(RENDERERS) as Platform[];
    // Guard the sweep: an empty/partial map would make the suite vacuous.
    expect(platforms.length).toBeGreaterThanOrEqual(9);
    for (const platform of platforms) {
      const render = RENDERERS[platform];
      expect(render, `no renderer registered for ${platform}`).toBeDefined();
      const rendered = render!(compile(profile, platform, "en"), []);
      expectNoLeak(`renderer ${platform}`, rendered.text);
    }
  });

  it("the positive control: github-readme does emit the public rows", () => {
    const rendered = RENDERERS["github-readme"]!(compile(load(FIXTURE), "github-readme", "en"), []);
    expect(rendered.text).toContain("PUBLIC-PROJ-NAME");
    expect(rendered.text).toContain("PUBLIC-CRED-TITLE");
    expect(rendered.text).toContain("PUBLIC-ART-TITLE");
  });

  it("a HAND-BUILT slice cannot smuggle a private row past a renderer", () => {
    // `PlatformProfile` is a documented seam (hand-built slices are accepted),
    // so the guard must live where the block is emitted, not only upstream.
    const slice = compile(load(FIXTURE), "github-readme", "en");
    const smuggled = {
      ...slice,
      projects: [
        ...slice.projects,
        { id: "smuggled-proj", name: "PRIVATE-SMUGGLED-PROJ", visibility: "private" },
      ],
      credentials: [
        ...slice.credentials,
        {
          id: "smuggled-cred",
          kind: "award",
          title: "PRIVATE-SMUGGLED-CRED",
          issuer: "X",
          visibility: "private",
        },
      ],
      artifacts: [
        ...slice.artifacts,
        {
          id: "smuggled-art",
          kind: "code",
          title: "PRIVATE-SMUGGLED-ART",
          locator: { url: "https://example.com/smuggled" },
          visibility: "private",
        },
      ],
    } as PlatformProfile;
    expectNoLeak(
      "github-readme (hand-built slice)",
      RENDERERS["github-readme"]!(smuggled, []).text,
    );
  });
});

describe("D27 leak — the JSON-LD surface", () => {
  it("structuredData() straight from load() carries no non-public row", () => {
    // `pasco entity --jsonld` calls structuredData(load()) DIRECTLY — not through
    // compile() — so the assembler owns this filter.
    const view = structuredData(load(FIXTURE), "en");
    expectNoLeak("structuredData()", JSON.stringify(view));
    const jsonLd = view.jsonLd as
      | { jobTitle?: string; worksFor?: string; hasCredential?: { name?: string }[] }
      | undefined;
    // currentRole(): the private role is the most recent one in the fixture.
    expect(jsonLd?.jobTitle).toBe("PUBLIC-ROLE");
    expect(jsonLd?.worksFor).toBe("Public Org");
    expect(jsonLd?.hasCredential?.map((entry) => entry.name)).toEqual(["PUBLIC-CRED-TITLE"]);
  });

  it("`pasco entity` emits no non-public row, in either output", () => {
    for (const flag of ["--jsonld", "--json"]) {
      const res = run(["entity", flag, "--workspace", FIXTURE]);
      expect(res.code, `${flag}: ${res.stderr}`).toBe(0);
      expectNoLeak(`pasco entity ${flag}`, res.stdout);
    }
  });
});

describe("D27 leak — the export surface", () => {
  it("`pasco export profile` defaults to the clean projection; `--all` is the control", () => {
    const publicRun = run(["export", "profile", "--json", "--workspace", FIXTURE]);
    expect(publicRun.code, publicRun.stderr).toBe(0);
    expectNoLeak("pasco export profile", publicRun.stdout);

    const allRun = run(["export", "profile", "--all", "--json", "--workspace", FIXTURE]);
    expect(allRun.code, allRun.stderr).toBe(0);
    // The marker EXISTS in the SSOT — a clean default is the filter, not a
    // fixture that never had the value.
    for (const marker of [
      "PRIVATE-PROJ-NAME",
      "PRIVATE-ROLE",
      "PRIVATE-CRED-TITLE",
      "PRIVATE-ART-TITLE",
      "PRIVATE-ACH",
    ]) {
      expect(allRun.stdout, `fixture control: ${marker} missing from --all`).toContain(marker);
    }
  });

  it("the projection drops the ledger record and the release event of a private unit", () => {
    const projected = publicProjection(load(FIXTURE));
    expectNoLeak("publicProjection()", JSON.stringify(projected));
    expect(Object.keys(projected.deployments).sort()).toEqual(["identity", "projects:pub-proj"]);
    expect(projected.releases.map((release) => release.id)).toEqual(["v-mixed"]);
  });
});

describe("D27 leak — the preview and audit surfaces", () => {
  it("the preview document carries no non-public row", () => {
    const dir = tempDir();
    const res = run(["preview", "--out", dir, "--workspace", FIXTURE]);
    expect(res.code, res.stderr).toBe(0);
    expectNoLeak("pasco preview", readFileSync(join(dir, "index.html"), "utf8"));
  });

  it("`pasco audit --public` reports no non-public row", () => {
    const res = run(["audit", "--public", "--json", "--workspace", FIXTURE]);
    // Exit 1 = a FAIL finding: the report is still the surface under test.
    expect([0, 1]).toContain(res.code);
    expectNoLeak("pasco audit --public", res.stdout);
  });
});

describe("D27 leak — the `pasco post` fact pointers", () => {
  it("a {{fact:…}} pointer cannot resolve a non-public row", () => {
    // The post task/check bundle is a public-facing surface (S4a): the pointer
    // grammar is generic, so EVERY visibility block must be filtered before a
    // pointer is resolved — otherwise `{{fact:achievements[1].statement}}` reads
    // a private row straight out of the SSOT.
    const profile = load(FIXTURE);
    const privateHits = [
      "projects[1].name",
      "experience[1].role",
      "experience[1].org",
      "credentials[1].title",
      "artifacts[1].title",
      // A langMap pointer must address the language: `resolveFact` returns a
      // string, never an object.
      "achievements[1].statement.en",
    ];
    for (const pointer of privateHits) {
      const { text, dangling } = renderFacts(`{{fact:${pointer}}}`, profile);
      expectNoLeak(`pasco post {{fact:${pointer}}}`, text);
      expect(dangling, `${pointer} must not resolve`).toContain(pointer);
    }
    // Control: the public rows DO resolve.
    expect(renderFacts("{{fact:projects[0].name}}", profile).text).toBe("PUBLIC-PROJ-NAME");
    expect(renderFacts("{{fact:achievements[0].statement.en}}", profile).text).toBe("PUBLIC-ACH");
  });
});
