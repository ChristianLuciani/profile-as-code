/**
 * The shared GitHub owner-resolution conformance body (#224): ONE suite, run by
 * every GitHub surface adapter against its own `githubOwner`, so "this surface
 * derives the owner the canonical way" cannot drift per adapter.
 *
 * It ships as a subpath (`@profile-as-code/github/conformance`) consumed only by
 * tests, keeping the runtime entry free of the test tool — the
 * `packages/paste` / `packages/artifact` precedent, and the same reason it lives
 * in a renderer support package and not in `core`.
 *
 * The body checks four different things, and all are load-bearing:
 *
 *   1. DELEGATION — the adapter's `githubOwner` is a function this package
 *      produced (`isGithubOwnerResolver`) bound to the declared surface. A copied
 *      owner resolution in one adapter is a second implementation and fails here;
 *   2. the adapter answers exactly `resolveGithubOwner` under ITS OWN binding on
 *      every corpus workspace — so the shared home and the adapter cannot drift
 *      apart even while both import the same factory;
 *   3. the shared corpus — the positive rungs, the F3 ordering, the F2/F5
 *      refusals, and the NEGATIVE family that matters most: a workspace that names
 *      no GitHub at all must resolve `null`. That is not a corner case — it is
 *      every user who has no GitHub — and getting it wrong aims a `--verify`
 *      request at a surface the workspace never declared and writes durable
 *      `http-404` evidence into their ledger, where today there is no request and
 *      no row (§19.5: `no-artifact-url` is derived, never recorded);
 *   4. the `null` rung is coherent with the public `artifactUrl` seam: a surface
 *      derives a URL exactly when it resolves an owner, and the URL names that
 *      owner — never a URL without an owner, never an owner the URL ignores.
 */
import type { Profile } from "@profile-as-code/core";
import { describe, expect, it } from "vitest";
import {
  createGithubOwnerResolver,
  type GithubOwnerResolver,
  type GithubSurfaceBinding,
  isGithubOwnerResolver,
  resolveGithubOwner,
} from "./index.js";

/** One `identity.links[]` row of a corpus workspace. */
export interface GithubOwnerLink {
  readonly platform?: string;
  readonly url: string;
}

/** One `socialHandles[]` row of a corpus workspace. */
export interface GithubOwnerHandle {
  readonly platform: string;
  readonly handle: string;
  readonly status: "claimed" | "pending";
  readonly url?: string;
}

/**
 * A workspace expressed as the two SSOT blocks the owner resolution reads
 * (§15.4/§18.4). Deliberately NOT a `Profile`: the corpus is data, and building a
 * validated profile is the adapter's business (it owns its flavor — a `person`
 * profile and a `brand` profile are not built the same way, and each adapter must
 * run the corpus through the REAL `load()` so the cases are constructible in a
 * workspace D12 accepts, not only in a hand-built object).
 */
export interface GithubOwnerWorkspace {
  readonly links?: readonly GithubOwnerLink[];
  readonly handles?: readonly GithubOwnerHandle[];
}

/**
 * The guarantees the corpus is partitioned into. `no-github` is the one that must
 * never lose a member: it is every user who has no GitHub, and its failure mode is
 * a request aimed at a surface the workspace never declared.
 */
export type GithubOwnerFamily = "positive" | "ordering" | "refusal" | "no-github";

/** One corpus case: a workspace, the owner the surface must answer, and why. */
export interface GithubOwnerCase {
  /** The property this case pins — the test's own words when it fails. */
  readonly why: string;
  /**
   * Which guarantee of §19.5 this case belongs to. A TAG, not decoration: the
   * no-GitHub family is the one the owner of this work asked about by name, and a
   * flattened `owner === null` filter cannot tell it apart from the refusals — so
   * eroding that family would keep the suite green (the erosion guard in the body
   * reads this field).
   */
  readonly family: GithubOwnerFamily;
  readonly workspace: GithubOwnerWorkspace;
  /**
   * True when EVERY GitHub surface must answer this case IDENTICALLY — the F3
   * cross-surface rule ("one workspace cannot name two different owners"). False
   * for the cases that deliberately speak a surface's OWN slug, where the two
   * surfaces are expected to differ (a `github-readme` link names the readme
   * surface and not the org one).
   */
  readonly sharedAcrossSurfaces: boolean;
  readonly owner: string | null;
}

/** The owner the corpus derives. Never a real account — a fixture name. */
const OWNER = "elenavasquez";
/** A second, valid owner: a wrong pick is visible instead of coincidentally right. */
const OTHER = "topiapress";
/** A real `$defs/platform` slug that is not a GitHub surface. */
const FOREIGN = "linkedin";

/**
 * The texts the shared resolution must answer to — the #224 corpus, GENERIC over
 * the surface: every case is built from `surface` (its own slug) and the `github`
 * alias convention, never from a sibling's name (the pairwise rule is asserted at
 * the CLI seam, where the surfaces are enumerated and a hand-written sibling list
 * cannot go stale). Exported so a consumer that must hold EVERY surface to the
 * same rule — the CLI, whose `--verify` certifies them — runs this corpus instead
 * of a second one that could drift.
 */
export function githubOwnerCorpus(surface: string): readonly GithubOwnerCase[] {
  const link = (url: string, platform?: string): GithubOwnerLink =>
    platform === undefined ? { url } : { platform, url };
  const handle = (over: Partial<GithubOwnerHandle> = {}): GithubOwnerHandle => ({
    platform: surface,
    handle: OWNER,
    status: "claimed",
    ...over,
  });

  return [
    // --- the positive rungs: `identity.links` is the canonical URL set (§15.4) ---
    {
      why: "a `github` link names the surface",
      workspace: { links: [link(`https://github.com/${OWNER}`, "github")] },
      sharedAcrossSurfaces: true,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "a github.com URL names the surface whether or not the row sets `platform`",
      workspace: { links: [link(`https://github.com/${OWNER}`)] },
      sharedAcrossSurfaces: true,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "the `www.` host alias and a sub-path are still the same page",
      workspace: { links: [link(`https://www.github.com/${OWNER}/repo`, "github")] },
      sharedAcrossSurfaces: true,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "reads the segment after GitHub's reserved `orgs/` route (regression: review F2)",
      workspace: { links: [link(`https://github.com/orgs/${OWNER}`, "github")] },
      sharedAcrossSurfaces: true,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "39 characters is still a valid owner: the cap is a boundary, not a guess (F5)",
      workspace: { links: [link(`https://github.com/${"a".repeat(39)}`, "github")] },
      sharedAcrossSurfaces: true,
      family: "positive",
      owner: "a".repeat(39),
    },
    {
      why: "a link named for THIS surface names it",
      workspace: { links: [link(`https://github.com/${OWNER}`, surface)] },
      sharedAcrossSurfaces: false,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "a slug that EXTENDS this surface's is not this surface (generic sibling rule, F3)",
      workspace: { links: [link(`https://github.com/${OWNER}`, `${surface}-page`)] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "skips a row that names another platform and keeps scanning the canonical set",
      workspace: {
        links: [
          link(`https://github.com/${OTHER}`, FOREIGN),
          link(`https://github.com/${OWNER}`, "github"),
        ],
      },
      sharedAcrossSurfaces: true,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "skips a row whose URL is not a GitHub page and keeps scanning",
      workspace: {
        links: [
          link("https://notgithub.com/other", "github"),
          link(`https://github.com/${OWNER}`, "github"),
        ],
      },
      sharedAcrossSurfaces: true,
      family: "positive",
      owner: OWNER,
    },

    // --- the handle matrix fallback (§17.1): only claimed rows count ---
    {
      why: "falls back to a CLAIMED handle-matrix row, handle only",
      workspace: { handles: [handle()] },
      sharedAcrossSurfaces: false,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "a declared handle is a slug, not a display name: `@user` and `user` are the same owner",
      workspace: { handles: [handle({ handle: `@${OWNER}` })] },
      sharedAcrossSurfaces: false,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "a claimed row's own url is read first",
      workspace: { handles: [handle({ url: `https://github.com/${OWNER}` })] },
      sharedAcrossSurfaces: false,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "a foreign url on the row does not cancel a valid declared handle (the `??` fallback)",
      workspace: { handles: [handle({ url: `https://notgithub.com/${OWNER}` })] },
      sharedAcrossSurfaces: false,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "39 characters is still a valid handle: the same cap on the handle path (F5)",
      workspace: { handles: [handle({ handle: "a".repeat(39) })] },
      sharedAcrossSurfaces: false,
      family: "positive",
      owner: "a".repeat(39),
    },
    {
      why: "a pending row before a claimed one does not shadow it",
      workspace: {
        handles: [handle({ handle: OTHER, status: "pending" }), handle()],
      },
      sharedAcrossSurfaces: false,
      family: "positive",
      owner: OWNER,
    },

    // --- ordering (review F3): links outrank the handle matrix ---
    {
      why: "prefers identity.links over the handle matrix — the same order on every surface",
      workspace: {
        links: [link(`https://github.com/${OWNER}`, "github")],
        handles: [handle({ handle: OTHER })],
      },
      sharedAcrossSurfaces: true,
      family: "ordering",
      owner: OWNER,
    },

    // --- refusals: the slug shape (F5) and the URL grammar ---
    {
      why: "a foreign host never becomes an owner",
      workspace: { links: [link(`https://notgithub.com/${OWNER}`, "github")] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "a sub-path does not change the owner: the first segment is the owner",
      workspace: { links: [link(`https://github.com/${OWNER}/repo/extra`, "github")] },
      sharedAcrossSurfaces: true,
      family: "positive",
      owner: OWNER,
    },
    {
      why: "a display-name-shaped segment is not a slug",
      workspace: { links: [link("https://github.com/evil.com/x", "github")] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "a crafted `%2e%2e` segment never steers the derived URL",
      workspace: { links: [link("https://github.com/%2e%2e", "github")] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "an empty path has no owner",
      workspace: { links: [link("https://github.com/", "github")] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "the reserved `orgs/` prefix alone has no owner",
      workspace: { links: [link("https://github.com/orgs/", "github")] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "a trailing hyphen is not a GitHub handle (regression: review F5)",
      workspace: { links: [link("https://github.com/trail-", "github")] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "a doubled hyphen is not a GitHub handle (regression: review F5)",
      workspace: { links: [link("https://github.com/double--hyphen", "github")] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "a leading hyphen is not a GitHub handle (regression: review F5)",
      workspace: { links: [link("https://github.com/-lead", "github")] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "40 characters exceeds the owner cap (regression: review F5)",
      workspace: { links: [link(`https://github.com/${"a".repeat(40)}`, "github")] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "a pending handle is not a deployed surface",
      workspace: { handles: [handle({ status: "pending" })] },
      sharedAcrossSurfaces: false,
      family: "refusal",
      owner: null,
    },
    {
      why: "a claimed row of another platform is not this surface",
      workspace: { handles: [handle({ platform: FOREIGN })] },
      sharedAcrossSurfaces: true,
      family: "refusal",
      owner: null,
    },
    {
      why: "an invalid handle AND a foreign url resolve to nothing",
      workspace: {
        handles: [handle({ handle: "evil.com", url: `https://notgithub.com/${OWNER}` })],
      },
      sharedAcrossSurfaces: false,
      family: "refusal",
      owner: null,
    },
    {
      why: "a path-shaped handle is not a slug",
      workspace: { handles: [handle({ handle: "a/b" })] },
      sharedAcrossSurfaces: false,
      family: "refusal",
      owner: null,
    },
    {
      why: "a bare `..` handle is refused, not decoded into a path",
      workspace: { handles: [handle({ handle: ".." })] },
      sharedAcrossSurfaces: false,
      family: "refusal",
      owner: null,
    },
    {
      why: "the slug shape holds on the handle path too (regression: review F5)",
      workspace: { handles: [handle({ handle: "trail-" })] },
      sharedAcrossSurfaces: false,
      family: "refusal",
      owner: null,
    },
    {
      why: "a doubled hyphen is not a GitHub handle either (F5, the twin of the link-path case)",
      workspace: { handles: [handle({ handle: "double--hyphen" })] },
      sharedAcrossSurfaces: false,
      family: "refusal",
      owner: null,
    },
    {
      why: "the 40-character cap holds on the handle path too (regression: review F5)",
      workspace: { handles: [handle({ handle: "a".repeat(40) })] },
      sharedAcrossSurfaces: false,
      family: "refusal",
      owner: null,
    },

    // --- the NEGATIVE family: a workspace with no GitHub at all ---------------
    // Not a corner case: it is every user who has no GitHub. Each of these must
    // resolve `null`, or `--verify` aims at a surface the workspace never declared
    // and records durable `http-404` evidence where today there is no request.
    {
      why: "a workspace that declares no links and no handles names no surface",
      workspace: {},
      sharedAcrossSurfaces: true,
      family: "no-github",
      owner: null,
    },
    {
      why: "a non-GitHub link names no GitHub surface, even when its URL is a github.com page",
      workspace: { links: [link(`https://github.com/${OWNER}`, FOREIGN)] },
      sharedAcrossSurfaces: true,
      family: "no-github",
      owner: null,
    },
    {
      why: "a workspace with only other platforms names no surface",
      workspace: {
        links: [link("https://x.com/elenavasquez", "x")],
        handles: [handle({ platform: FOREIGN })],
      },
      sharedAcrossSurfaces: true,
      family: "no-github",
      owner: null,
    },
  ];
}

export interface GithubOwnerConformanceOptions {
  /** The surface slug the adapter publishes (D16) — the handle-matrix key. */
  surface: string;
  /** The adapter's exported `githubOwner` (the shared factory must have produced it,
   *  and it CARRIES the binding it was built from: the body reads the declaration
   *  from here rather than accepting it as an option, so the caller cannot re-type
   *  the per-surface data in the test — fresh-review F1). */
  githubOwner: GithubOwnerResolver;
  /** The adapter's exported `artifactUrl` — the public §19.5 seam, `null` rung included. */
  artifactUrl: (profile: Profile) => string | null;
  /** Build a REAL workspace (through `load()`, D12) from a corpus case. */
  profileWith: (workspace: GithubOwnerWorkspace) => Profile;
}

/**
 * Register the shared owner-resolution guarantee as a suite: the DECLARED binding
 * (asserted against the contract, so a widened set fails here, in the file that
 * changed), delegation to the one implementation, agreement with the canonical rule
 * and with `resolveGithubOwner` on every corpus workspace, the corpus's expected
 * owners (positive rungs, F3 ordering, F2/F5 refusals, and the no-GitHub
 * negatives), and the coherence of the `null` rung with the public `artifactUrl`.
 */
export function describeGithubOwnerConformance({
  surface,
  githubOwner,
  artifactUrl,
  profileWith,
}: GithubOwnerConformanceOptions): void {
  describe(`shared GitHub owner resolution — ${surface}`, () => {
    // The CONTRACT expectation, built here and not taken from the adapter: the
    // `github` alias every surface's links may carry, plus the surface's own slug.
    // Deriving it from the resolver instead would make the comparison below
    // vacuous — the point is to falsify a wrong declaration.
    const expected = Object.freeze(["github", surface].sort());
    // The binding the ADAPTER declared, read back from its own resolver.
    const binding: GithubSurfaceBinding = {
      surface: githubOwner.surface,
      linkPlatforms: new Set(githubOwner.linkPlatforms),
    };
    const canonical: GithubOwnerResolver = createGithubOwnerResolver({
      surface,
      linkPlatforms: new Set(expected),
    });
    const cases = githubOwnerCorpus(surface);

    it("declares exactly the binding contract — the `github` alias plus its own slug", () => {
      // A widened set used to leave this whole suite green and only fail at the CLI
      // seam, one level up from the file that changed (fresh-review F1).
      expect(githubOwner.linkPlatforms).toEqual(expected);
    });

    it("delegates the owner resolution to the shared home instead of re-implementing it (#224)", () => {
      expect(isGithubOwnerResolver(githubOwner)).toBe(true);
      expect(githubOwner.surface).toBe(surface);
    });

    it("answers exactly the canonical rule, and the unbound function, on every corpus workspace", () => {
      expect(cases.length).toBeGreaterThan(0);
      for (const { why, workspace } of cases) {
        const profile = profileWith(workspace);
        expect(githubOwner(profile), why).toBe(canonical(profile));
        expect(githubOwner(profile), why).toBe(resolveGithubOwner(profile, binding));
      }
    });

    it("derives the corpus owner for every workspace (positive rungs, ordering, F2/F5, and no-GitHub)", () => {
      for (const { why, workspace, owner } of cases) {
        expect(githubOwner(profileWith(workspace)), why).toBe(owner);
      }
    });

    it("keeps the `null` rung coherent with the public `artifactUrl` seam (§19.5 row 2)", () => {
      // A surface derives a URL exactly when it resolves an owner — never a URL
      // without an owner (a guessed request), never an owner the URL ignores.
      for (const { why, workspace } of cases) {
        const profile = profileWith(workspace);
        const owner = githubOwner(profile);
        const url = artifactUrl(profile);
        expect(url === null, why).toBe(owner === null);
        if (owner !== null && url !== null) expect(url, why).toContain(owner);
      }
    });

    it("pins the no-GitHub family ITSELF, so eroding it cannot stay green", () => {
      // The family the owner of this work asked about by name — every user who has
      // no GitHub — asserted as a FAMILY, not as "the null cases": a flattened
      // `owner === null` filter cannot tell it apart from the refusals, so deleting
      // a no-GitHub case would have left this suite green (fresh-review finding).
      // The floor is the erosion guard (the three scenarios: no SSOT blocks at all /
      // a foreign-labelled github.com row / only other platforms); the seam
      // assertions are the guarantee — no owner means no URL means `declaredReason`
      // reads `no-artifact-url`, so the pass makes no request and writes no row.
      const noGithub = cases.filter(({ family }) => family === "no-github");
      expect(noGithub.length).toBeGreaterThanOrEqual(3);
      for (const { why, workspace } of noGithub) {
        const profile = profileWith(workspace);
        expect(githubOwner(profile), why).toBeNull();
        expect(artifactUrl(profile), why).toBeNull();
      }
    });
  });
}
