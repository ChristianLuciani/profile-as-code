/**
 * Live-verification capability of the `github-org` surface (SPEC §19.5, issue
 * #132 Lane B / #212; one home #216/#224) — the brand sibling of `github-readme`,
 * declaring the same four exports: the canonical projection, the fetch allowlist,
 * the owner resolution and the URL of the live org README derived from the URL
 * SSOT.
 *
 * Neither rule is re-implemented here. The projection RULE lives once in
 * `@profile-as-code/artifact` (#216) and the owner RESOLUTION once in
 * `@profile-as-code/github` (#224); this suite runs BOTH shared bodies against
 * this adapter's exports — which is what proves the delegation and pins the F2/F5
 * refusals and the no-GitHub negatives on THIS surface too — and keeps locally
 * only what needs this renderer or this surface: the render → digest golden, the
 * sibling-footer regression, the allowlist and the hand-built-slice guard.
 *
 * Golden fixtures (committed, byte-exact): see the `github-readme` sibling for
 * the fixture contract — bare / chrome / edited / projection / digest.
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

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
const digestOf = (text: string): string =>
  createHash("sha256").update(extractArtifact(text), "utf8").digest("hex");

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A brand workspace loaded through the real `load()` (D12 validation). */
function brandWorkspace(extra: Record<string, string> = {}): Profile {
  const dir = mkdtempSync(join(tmpdir(), "pasco-org-artifact-"));
  tempDirs.push(dir);
  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  const files: Record<string, string> = {
    "flavor.yaml": "brand\n",
    "identity.yaml":
      "name: Topia Press\nmission:\n  en: High-epistemic essays moving from dystopia to utopia.\ntagline:\n  en: From dystopia to utopia — the newsletter\nlinks:\n  - platform: website\n    url: https://topia.press\n",
    ...extra,
  };
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
 *  engine actually accepts — a `brand` workspace (D15), loaded through `load()`
 *  so every corpus case is provably constructible, not only hand-buildable. */
function profileWith({ links, handles }: GithubOwnerWorkspace): Profile {
  return brandWorkspace({
    "identity.yaml":
      `name: Topia Press\n` +
      (links === undefined || links.length === 0 ? "" : `links:\n${links.map(linkYaml).join("")}`),
    ...(handles !== undefined && handles.length > 0
      ? { "socialHandles.yaml": handles.map(handleYaml).join("") }
      : {}),
  });
}

// The bound + transport regression set AND the fixture integration run ONCE,
// against the shared home (#216); the body also proves THIS adapter delegates
// instead of re-implementing it, and that neither the sibling's footer nor an
// extended slug's footer is this surface's terminus.
describeArtifactConformance({
  surface: "github-org",
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
  surface: "github-org",
  githubOwner,
  artifactUrl,
  profileWith,
});

describe("github-org golden digest — the artifact the CLI anchors (§19.5)", () => {
  it("does not confuse the sibling surface's footer for its own terminus", () => {
    // The `github-readme` footer is NOT this renderer's marker: with no own
    // terminus in the text, the projection must not truncate at it.
    const foreign =
      "# Topia Press\n\n<!-- generated by profile-as-code pasco build github-readme · 0 projects -->\n\ntail\n";
    expect(extractArtifact(foreign)).toContain("tail");
  });

  it("render → extract → digest is byte-stable (golden digest fixture)", () => {
    const profile = brandWorkspace({
      "socialHandles.yaml":
        "- platform: github-org\n  handle: topiapress\n  status: claimed\n  url: https://github.com/topiapress\n",
    });
    const digest = digestOf(render(compile(profile, "github-org", "en")).text);
    expect(digest).toBe(readFileSync(join(FIXTURES, "org.digest"), "utf8").trim());
  });
});

describe("artifactUrl — the surface's own declarations (§15.4/§18.4)", () => {
  const ORG_URL = "https://raw.githubusercontent.com/topiapress/.github/HEAD/profile/README.md";

  it("derives the org profile-README raw URL from the claimed github-org handle", () => {
    const profile = profileWith({
      handles: [{ platform: "github-org", handle: "topiapress", status: "claimed" }],
    });
    expect(artifactUrl(profile)).toBe(ORG_URL);
  });

  it("guards a non-http(s) URL on the hand-built-slice seam (review F5)", () => {
    // `load()` already refuses it (D12: every declared `url` must match
    // `^https?://`), so this guard is defense-in-depth for the public API's
    // documented hand-built slice. The link path has no handle fallback, which
    // isolates the scheme check from the slug check.
    const handBuilt = {
      identity: {
        name: "x",
        links: [{ platform: "github-org", url: "ftp://github.com/topiapress" }],
      },
    } as unknown as Profile;
    expect(artifactUrl(handBuilt)).toBeNull();
  });

  it("only ever derives a URL inside the declared fetch allowlist", () => {
    const profile = profileWith({
      handles: [
        {
          platform: "github-org",
          handle: "topiapress",
          status: "claimed",
          url: "https://github.com/topiapress",
        },
      ],
    });
    const url = artifactUrl(profile);
    expect(url).toBe(ORG_URL);
    expect(fetchHosts).toContain(new URL(url as string).hostname);
  });

  it("declares the raw host as its one-host v1 allowlist", () => {
    expect(fetchHosts).toEqual(["raw.githubusercontent.com"]);
  });
});
