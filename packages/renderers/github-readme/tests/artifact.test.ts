/**
 * Live-verification capability of the `github-readme` surface (SPEC §19.5,
 * issue #132 Lane B / #212; one home #216/#224).
 *
 * The capability is what lets `pasco status --verify` JUDGE this surface instead
 * of only observing it, so these tests pin its three promises:
 *
 *   - `extractArtifact` is the canonical projection of the engine-owned region —
 *     the rule lives once in `@profile-as-code/artifact` (#216), so this suite
 *     runs the SHARED conformance body and hands it this adapter's own committed
 *     fixtures;
 *   - `githubOwner`/`artifactUrl` resolve this surface's owner from the URL SSOT
 *     alone — the rule lives once in `@profile-as-code/github` (#224), so this
 *     suite runs the SHARED owner corpus through a REAL loaded workspace: the
 *     positive rungs, the ordering rule, the F2/F5 refusals and the no-GitHub
 *     negatives are pinned on this surface by the shared body, not by a copy;
 *   - `fetchHosts` is the one-host allowlist the derived URL must stay inside.
 *
 * Both bodies assert the adapter DELEGATES (identity, not shape), so an adapter
 * that stopped delegating — a copied bound or a copied owner rule — fails CI
 * instead of certifying under rules its sibling does not share. What stays local
 * is what genuinely needs this renderer or this surface: the render → digest
 * golden, the allowlist itself, and the hand-built-slice guard.
 *
 * Golden fixtures (committed, byte-exact):
 *   bare.md        the artifact as published
 *   chrome.md      the same artifact wrapped in platform preamble/appendix
 *   edited.md      the artifact with one body line changed (drift)
 *   projection.md  the canonical projection of bare.md/chrome.md
 *   readme.digest  SHA-256 of extractArtifact(render(minimal)) — byte-stable
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeArtifactConformance } from "@profile-as-code/artifact/conformance";
import { compile, load, type Profile } from "@profile-as-code/core";
import {
  describeGithubOwnerConformance,
  type GithubOwnerHandle,
  type GithubOwnerLink,
  type GithubOwnerWorkspace,
} from "@profile-as-code/github/conformance";
import { afterAll, describe, expect, it } from "vitest";
import { artifactUrl, extractArtifact, fetchHosts, githubOwner, render } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures", "artifact");
const MINIMAL = join(__dirname, "..", "..", "..", "core", "tests", "fixtures", "minimal");

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
/** The digest the CALLER computes (§19.5): SHA-256 of the projection's bytes. */
const digestOf = (text: string): string =>
  createHash("sha256").update(extractArtifact(text), "utf8").digest("hex");

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A workspace loaded through the real `load()` (D12 validation) from
 *  hand-written content files — the documented seam for a partial profile. */
function profileFrom(files: Record<string, string>): Profile {
  const dir = mkdtempSync(join(tmpdir(), "pasco-artifact-"));
  tempDirs.push(dir);
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(content, name), body);
  return load(dir);
}

/** One `identity.links[]` row of a shared-corpus workspace, as YAML. */
function linkYaml(link: GithubOwnerLink): string {
  return link.platform === undefined
    ? `  - url: '${link.url}'\n`
    : `  - platform: '${link.platform}'\n    url: '${link.url}'\n`;
}

/** One `socialHandles[]` row of a shared-corpus workspace, as YAML. */
function handleYaml(handle: GithubOwnerHandle): string {
  const url = handle.url === undefined ? "" : `  url: '${handle.url}'\n`;
  return `- platform: '${handle.platform}'\n  handle: '${handle.handle}'\n  status: ${handle.status}\n${url}`;
}

/** The shared corpus is DATA; this is this adapter's bridge to a workspace the
 *  engine actually accepts — a `person` profile needs only `identity` (§9), and
 *  going through `load()` proves every corpus case is constructible in a real
 *  workspace, not only in a hand-built object. */
function profileWith({ links, handles }: GithubOwnerWorkspace): Profile {
  const files: Record<string, string> = {
    "identity.yaml":
      `name: Elena Vasquez\n` +
      (links === undefined || links.length === 0 ? "" : `links:\n${links.map(linkYaml).join("")}`),
  };
  if (handles !== undefined && handles.length > 0) {
    files["socialHandles.yaml"] = handles.map(handleYaml).join("");
  }
  return profileFrom(files);
}

// The bound/transport regression set AND the fixture integration run ONCE,
// against the shared home (#216); this suite runs the shared body against THIS
// adapter's export and its own committed bytes, so an adapter that stopped
// delegating — a copied bound — fails CI instead of certifying under rules its
// sibling does not share.
describeArtifactConformance({
  surface: "github-readme",
  extractArtifact,
  fixtures: {
    bare: fixture("bare.md"),
    chrome: fixture("chrome.md"),
    projection: fixture("projection.md"),
    edited: fixture("edited.md"),
  },
});

// The owner corpus (#224) runs here too: the resolution lives once in
// `@profile-as-code/github`, and this suite proves THIS surface binds it — the
// declaration is read back from the resolver and asserted against the contract, so
// a widened platform set fails HERE, in the file that changed (fresh-review F1) —
// and derives the corpus owner for every workspace, no-GitHub ones included.
describeGithubOwnerConformance({
  surface: "github-readme",
  githubOwner,
  artifactUrl,
  profileWith,
});

describe("github-readme golden digest — the artifact the CLI anchors (§19.5)", () => {
  it("render → extract → digest is byte-stable (golden digest fixture)", () => {
    const slice = compile(load(MINIMAL), "github-readme", "en");
    const digest = digestOf(render(slice).text);
    expect(digest).toBe(readFileSync(join(FIXTURES, "readme.digest"), "utf8").trim());
  });
});

describe("artifactUrl — the surface's own declarations (§15.4/§18.4)", () => {
  it("guards a non-http(s) URL on the hand-built-slice seam (review F5)", () => {
    // `load()` already refuses it (D12: `identity.links[].url` must match
    // `^https?://`), so this guard is defense-in-depth for the public API's
    // documented hand-built slice.
    const handBuilt = {
      identity: {
        name: "x",
        links: [{ platform: "github", url: "ftp://github.com/elenavasquez" }],
      },
    } as unknown as Profile;
    expect(artifactUrl(handBuilt)).toBeNull();
  });

  it("only ever derives a URL inside the declared fetch allowlist", () => {
    const profile = profileWith({
      links: [{ platform: "github", url: "https://github.com/elenavasquez" }],
    });
    const url = artifactUrl(profile);
    expect(url).toBe("https://raw.githubusercontent.com/elenavasquez/elenavasquez/HEAD/README.md");
    expect(fetchHosts).toContain(new URL(url as string).hostname);
  });

  it("declares the raw host as its one-host v1 allowlist", () => {
    expect(fetchHosts).toEqual(["raw.githubusercontent.com"]);
  });
});
