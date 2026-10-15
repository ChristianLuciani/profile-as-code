/**
 * #224 — the two GitHub surfaces must resolve the SAME owner for one workspace,
 * and this is the seam where that is observable: `capabilitiesOf` hands
 * `pasco status --verify` each surface's `artifactUrl`, derived from the same URL
 * SSOT. A one-file divergence in the owner rule would let `--verify` fetch — and
 * record as `evidenceUrl` — a DIFFERENT URL than the sibling would have derived
 * from the same workspace.
 *
 * What is asserted here is the strongest guarantee the ratified split permits.
 * The rule lives once (`@profile-as-code/github`, #224) and each adapter binds it
 * to its OWN platform set, which deliberately DIFFERS: a `github-readme` link
 * names the personal profile README repo and not the org's, so the two resolvers
 * are not interchangeable. What must hold — and does — is that they agree
 * wherever the workspace does not speak a surface's own slug, that each one
 * refuses the other's, and that neither carries a second implementation.
 *
 * The subject set is ENUMERATED from `capabilitiesOf`, not written down here: the
 * resolver map is checked against that same enumeration, so a third GitHub surface
 * FAILS the guard loudly until its resolver is added — it does not silently join
 * the assertions (fresh-review F2; failing is the safe direction, and the reason
 * that guard exists). A guard test also fails if the registry stops declaring the
 * two GitHub surfaces, so the enumeration cannot go vacuous.
 */
import type { Profile } from "@profile-as-code/core";
import { declaredReason, PLATFORMS } from "@profile-as-code/core";
import type { GithubOwnerResolver } from "@profile-as-code/github";
import { type GithubOwnerWorkspace, githubOwnerCorpus } from "@profile-as-code/github/conformance";
import {
  artifactUrl as orgArtifactUrl,
  githubOwner as orgGithubOwner,
} from "@profile-as-code/renderers-github-org";
import {
  artifactUrl as readmeArtifactUrl,
  githubOwner as readmeGithubOwner,
} from "@profile-as-code/renderers-github-readme";
import { describe, expect, it } from "vitest";
import { capabilitiesOf } from "../src/capabilities.js";

const OWNER = "elenavasquez";
/** A second, valid owner: a wrong pick is visible instead of coincidentally right. */
const OTHER = "topiapress";
/** The one platform slug that may name a surface besides its own: the fixture
 *  convention `github` — a FREE string (`identity.links[].platform` is not tied to
 *  the enum, which has no bare `github`), matched by name in both adapters. Typed
 *  `string` on purpose: as a literal it would be disjoint from `Platform`, and
 *  `tsc` rightly refuses a comparison that can never hold (`TS2367`). */
const GITHUB_ALIAS: string = "github";

/** A hand-built brand workspace: `github-org` is declared for `flavor: brand`
 *  only (F2 of #215), and the resolution reads only `identity.links` +
 *  `socialHandles` — the documented seam for a partial profile (the
 *  `artifact-conformance` precedent). */
const profileOf = ({ links = [], handles = [] }: GithubOwnerWorkspace): Profile =>
  ({
    flavor: "brand",
    identity: { name: "Topia Press", ...(links.length === 0 ? {} : { links }) },
    ...(handles.length === 0 ? {} : { socialHandles: handles }),
  }) as unknown as Profile;

/** A brand workspace that names no GitHub surface at all — the user this issue's
 *  no-request guarantee exists for. */
const NO_GITHUB = profileOf({
  links: [{ platform: "x", url: "https://x.com/topiapress" }],
  handles: [{ platform: "linkedin", handle: "topiapress", status: "claimed" }],
});

const REGISTERED = Object.keys(capabilitiesOf(NO_GITHUB)).sort();

/** The per-surface bindings, keyed the way the registry keys them. The guard
 *  below holds this map to `REGISTERED`, so a new surface cannot be admitted
 *  without its resolver appearing here. */
const RESOLVERS: Readonly<Record<string, GithubOwnerResolver>> = {
  "github-readme": readmeGithubOwner,
  "github-org": orgGithubOwner,
};

/** Slugs foreign to EVERY registered surface: the values a one-file widening of ONE
 *  adapter's platform set would start accepting while its sibling keeps skipping
 *  them — one workspace, two different owners (F3), the divergence #224 exists to
 *  fail. Derived from the contract's enum, never written down here. */
const CROSS_SURFACE_FOREIGN = PLATFORMS.filter(
  (slug) => slug !== GITHUB_ALIAS && !REGISTERED.includes(slug),
);

/** Values a careless edit could plausibly add to ONE adapter's set that the enum
 *  does not contain (`identity.links[].platform` is a free string, so a workspace
 *  can carry them). The enum covers the real convention; this covers the typos. */
const PLAUSIBLE_WIDENINGS = ["git", "GitHub", "GH", "github ", "github.com"];

describe("GitHub owner resolution — the surfaces agree across one workspace (#224)", () => {
  it("the registry declares at least the two GitHub surfaces (guards the enumeration itself)", () => {
    // Without this, an empty/renamed registry would make every loop below vacuous.
    expect(REGISTERED).toEqual(["github-org", "github-readme"]);
    expect(Object.keys(RESOLVERS).sort()).toEqual(REGISTERED);
  });

  it("resolves the SAME owner on every surface-agnostic corpus workspace, on both surfaces", () => {
    // F3 as a mechanism: the corpus's `sharedAcrossSurfaces` cases are exactly the
    // ones a workspace can pose to every surface at once, so a divergence here is
    // "one workspace named two different owners".
    const corpus = githubOwnerCorpus("github-readme").filter((c) => c.sharedAcrossSurfaces);
    expect(corpus.length).toBeGreaterThan(0);
    for (const { why, workspace, owner } of corpus) {
      const profile = profileOf(workspace);
      for (const surface of REGISTERED) {
        expect(RESOLVERS[surface]?.(profile), `${surface}: ${why}`).toBe(owner);
      }
    }
  });

  it("refuses every OTHER platform value on BOTH surfaces, so widening ONE set fails here", () => {
    // The platform-VALUE axis (fresh-review finding): the algorithm is one home, but
    // each surface still declares its own platform set — so a one-file edit that adds
    // a value to ONE adapter's set lets that surface accept a row its sibling skips,
    // and a workspace with such a row first derives a DIFFERENT owner per surface.
    // That is the F3 divergence this suite exists to fail, and the enumeration is the
    // contract's `PLATFORMS` (plus the plausible non-enum widenings), not a list here.
    expect(CROSS_SURFACE_FOREIGN.length).toBeGreaterThan(0);
    for (const slug of [...PLATFORMS, ...PLAUSIBLE_WIDENINGS]) {
      const profile = profileOf({
        links: [{ platform: slug, url: `https://github.com/${OTHER}` }],
      });
      for (const surface of REGISTERED) {
        const namesIt = slug === GITHUB_ALIAS || slug === surface;
        expect(
          RESOLVERS[surface]?.(profile),
          `${surface} must ${namesIt ? "accept" : "refuse"} a '${slug}'-labelled github.com link`,
        ).toBe(namesIt ? OTHER : null);
      }
    }
  });

  it("keeps both surfaces agreeing when a foreign-labelled row precedes the github row (F3 ordering)", () => {
    // The ordering half: a surface that WRONGLY accepted the first row would answer
    // its owner and shadow the `github` row — so this compares the two surfaces'
    // answers, not just their null-ness.
    for (const slug of CROSS_SURFACE_FOREIGN) {
      const profile = profileOf({
        links: [
          { platform: slug, url: `https://github.com/${OTHER}` },
          { platform: GITHUB_ALIAS, url: `https://github.com/${OWNER}` },
        ],
      });
      for (const surface of REGISTERED) {
        expect(
          RESOLVERS[surface]?.(profile),
          `${surface}: a preceding '${slug}' row must not shadow the github row`,
        ).toBe(OWNER);
      }
    }
  });

  it("lets a surface's own slug name it — as a link or as a claimed handle — and never its sibling", () => {
    for (const surface of REGISTERED) {
      const rows: GithubOwnerWorkspace[] = [
        { links: [{ platform: surface, url: `https://github.com/${OWNER}` }] },
        { handles: [{ platform: surface, handle: OWNER, status: "claimed" }] },
      ];
      for (const workspace of rows) {
        const profile = profileOf(workspace);
        for (const other of REGISTERED) {
          const resolved = RESOLVERS[other]?.(profile);
          if (other === surface) {
            expect(resolved, `${other} must answer for its own slug`).toBe(OWNER);
          } else {
            expect(resolved, `${other} must refuse ${surface}'s own slug`).toBeNull();
          }
        }
      }
    }
  });
});

describe("#224 — a workspace that names no GitHub surface", () => {
  it("declares the honest `no-artifact-url` rung on BOTH surfaces, extractor and all", () => {
    const caps = capabilitiesOf(NO_GITHUB);
    for (const surface of REGISTERED) {
      // The extractor still exists: the honest rung is `no-artifact-url`, NOT the
      // lie `no-extractor` — and the rung is what the pass reads to skip the
      // request, so a `null` here is the whole no-request guarantee.
      expect(typeof caps[surface]?.extractor, surface).toBe("function");
      expect(caps[surface]?.artifactUrl, surface).toBeNull();
      expect(declaredReason(caps[surface]), surface).toBe("no-artifact-url");
    }
  });

  it("resolves no owner for it on either surface (so no request can be aimed)", () => {
    for (const surface of REGISTERED) {
      expect(RESOLVERS[surface]?.(NO_GITHUB), surface).toBeNull();
    }
  });

  it("keeps each surface's own template: the same owner is a different artifact URL per surface", () => {
    // The per-surface half of the split is real, not cosmetic — one owner, two
    // artifacts. This is why the shared home stops at the owner and the URL
    // template stays with the adapter.
    const profile = profileOf({
      links: [{ platform: "github", url: `https://github.com/${OWNER}` }],
    });
    expect(readmeArtifactUrl(profile)).toBe(
      `https://raw.githubusercontent.com/${OWNER}/${OWNER}/HEAD/README.md`,
    );
    expect(orgArtifactUrl(profile)).toBe(
      `https://raw.githubusercontent.com/${OWNER}/.github/HEAD/profile/README.md`,
    );
  });
});
