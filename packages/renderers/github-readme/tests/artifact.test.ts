/**
 * Live-verification capability of the `github-readme` surface (SPEC §19.5,
 * issue #132 Lane B / #212; one home #216).
 *
 * The capability is what lets `pasco status --verify` JUDGE this surface instead
 * of only observing it, so these tests pin its three promises:
 *
 *   - `extractArtifact` is the canonical projection of the engine-owned region —
 *     the rule itself lives once in `@profile-as-code/artifact` (#216), so this
 *     suite runs the SHARED conformance body instead of copying it, and adds only
 *     what this adapter's own fixtures can prove: real published bytes project to
 *     the committed goldens;
 *   - `artifactUrl` derives the live URL from the URL SSOT alone and refuses
 *     anything a crafted workspace could use to steer the request;
 *   - `fetchHosts` is the one-host allowlist the derived URL must stay inside.
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
import { afterAll, describe, expect, it } from "vitest";
import { artifactUrl, extractArtifact, fetchHosts, render } from "../src/index.js";

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

const IDENTITY = (links: string): string => `name: Elena Vasquez\nlinks:\n${links}`;

// The border/transport regression set runs ONCE, against the shared home (#216);
// this suite runs the shared body against THIS adapter's export, so an adapter
// that stopped delegating — a copied bound — fails CI instead of certifying
// under rules its sibling does not share.
describeArtifactConformance({ surface: "github-readme", extractArtifact });

describe("github-readme fixtures — the published artifact projects to its golden (§19.5)", () => {
  it("projects the published artifact to the byte-golden projection", () => {
    expect(extractArtifact(fixture("bare.md"))).toBe(fixture("projection.md"));
  });

  it("is chrome-invariant over the committed preamble/appendix fixture", () => {
    expect(extractArtifact(fixture("chrome.md"))).toBe(fixture("projection.md"));
    expect(digestOf(fixture("chrome.md"))).toBe(digestOf(fixture("bare.md")));
  });

  it("reports an edit INSIDE the artifact as a different digest (drift)", () => {
    expect(digestOf(fixture("edited.md"))).not.toBe(digestOf(fixture("bare.md")));
    expect(extractArtifact(fixture("edited.md"))).not.toBe(fixture("projection.md"));
  });

  it("render → extract → digest is byte-stable (golden digest fixture)", () => {
    const slice = compile(load(MINIMAL), "github-readme", "en");
    const digest = digestOf(render(slice).text);
    expect(digest).toBe(readFileSync(join(FIXTURES, "readme.digest"), "utf8").trim());
  });
});

describe("artifactUrl — derived from the URL SSOT (§15.4/§18.4)", () => {
  it("derives the profile-README raw URL from the declared GitHub link", () => {
    const profile = profileFrom({
      "identity.yaml": IDENTITY("  - platform: github\n    url: https://github.com/elenavasquez\n"),
    });
    expect(artifactUrl(profile)).toBe(
      "https://raw.githubusercontent.com/elenavasquez/elenavasquez/HEAD/README.md",
    );
  });

  it("accepts a link named for this surface, unlabelled or with a sub-path — not a sibling's", () => {
    for (const links of [
      "  - url: https://www.github.com/elenavasquez/repo\n",
      "  - platform: github-readme\n    url: https://github.com/elenavasquez\n",
    ]) {
      expect(artifactUrl(profileFrom({ "identity.yaml": IDENTITY(links) }))).toBe(
        "https://raw.githubusercontent.com/elenavasquez/elenavasquez/HEAD/README.md",
      );
    }
    // A `github-org` link names the ORG surface: it cannot name the personal
    // profile README repo, so deriving from it would be a guess (and a wrong URL).
    expect(
      artifactUrl(
        profileFrom({
          "identity.yaml": IDENTITY(
            "  - platform: github-org\n    url: https://github.com/elenavasquez\n",
          ),
        }),
      ),
    ).toBeNull();
  });

  it("falls back to a CLAIMED handle-matrix row (§17) and ignores a pending one", () => {
    const claimed = profileFrom({
      "identity.yaml": "name: Topia Press\n",
      "socialHandles.yaml":
        "- platform: github-readme\n  handle: '@topiapress'\n  status: claimed\n",
    });
    expect(artifactUrl(claimed)).toBe(
      "https://raw.githubusercontent.com/topiapress/topiapress/HEAD/README.md",
    );
    // `pending` is the renderer's own non-deployed marker (claimed-only badges):
    // guessing its URL would record a wrong artifactUrl, so it declares nothing.
    const pending = profileFrom({
      "identity.yaml": "name: Topia Press\n",
      "socialHandles.yaml": "- platform: github-readme\n  handle: topiapress\n  status: pending\n",
    });
    expect(artifactUrl(pending)).toBeNull();
  });

  it("reads the segment after GitHub's reserved `orgs/` route (regression: review F2)", () => {
    const profile = profileFrom({
      "identity.yaml": IDENTITY(
        "  - platform: github\n    url: https://github.com/orgs/topiapress\n",
      ),
    });
    expect(artifactUrl(profile)).toBe(
      "https://raw.githubusercontent.com/topiapress/topiapress/HEAD/README.md",
    );
  });

  it("prefers identity.links over the handle matrix — the same order as its sibling (review F3)", () => {
    const profile = profileFrom({
      "identity.yaml": IDENTITY("  - platform: github\n    url: https://github.com/elenavasquez\n"),
      "socialHandles.yaml": "- platform: github-readme\n  handle: otherbrand\n  status: claimed\n",
    });
    expect(artifactUrl(profile)).toBe(
      "https://raw.githubusercontent.com/elenavasquez/elenavasquez/HEAD/README.md",
    );
  });

  it("is null when the workspace declares no GitHub surface (no-artifact-url)", () => {
    const profile = profileFrom({
      "identity.yaml": IDENTITY("  - platform: x\n    url: https://x.com/elenavasquez\n"),
    });
    expect(artifactUrl(profile)).toBeNull();
  });

  it("refuses another platform, a foreign host or a non-slug owner", () => {
    const cases = [
      "  - platform: linkedin\n    url: https://github.com/elenavasquez\n",
      "  - platform: github\n    url: https://notgithub.com/elenavasquez\n",
      "  - platform: github\n    url: https://github.com/evil.com/x\n",
      "  - platform: github\n    url: https://github.com/%2e%2e\n",
      "  - platform: github\n    url: https://github.com/\n",
      // Review F5: a trailing or doubled hyphen is not a GitHub handle.
      "  - platform: github\n    url: https://github.com/trail-\n",
      "  - platform: github\n    url: https://github.com/double--hyphen\n",
      "  - platform: github\n    url: https://github.com/-lead\n",
      `  - platform: github\n    url: https://github.com/${"a".repeat(40)}\n`,
    ];
    for (const links of cases) {
      expect(artifactUrl(profileFrom({ "identity.yaml": IDENTITY(links) }))).toBeNull();
    }
  });

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
    const profile = profileFrom({
      "identity.yaml": IDENTITY("  - platform: github\n    url: https://github.com/elenavasquez\n"),
    });
    const url = artifactUrl(profile);
    expect(url).not.toBeNull();
    expect(fetchHosts).toContain(new URL(url as string).hostname);
  });

  it("declares the raw host as its one-host v1 allowlist", () => {
    expect(fetchHosts).toEqual(["raw.githubusercontent.com"]);
  });
});
