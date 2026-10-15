/**
 * The shared owner resolution's own conformance run (#224): the swapped-in body
 * applied to the factory itself, so `resolveGithubOwner`/`createGithubOwnerResolver`
 * and the harness cannot drift apart. Adapter suites run the same body against
 * their own `githubOwner` and their own loaded workspaces.
 *
 * It also pins the promises the body leans on and the ones only this package can
 * check: `isGithubOwnerResolver` answers true for a function THIS package produced
 * and false for a hand-written one (that is what makes a future one-file
 * divergence fail CI), the bound surface is frozen, and an incoherent binding is
 * REFUSED — that refusal is the copy-paste guard: an adapter left carrying its
 * sibling's `linkPlatforms` would otherwise answer `null` for every valid link and
 * report the honest-looking `no-artifact-url` for an artifact it does publish.
 */
import type { Profile } from "@profile-as-code/core";
import { describe, expect, it } from "vitest";
import {
  describeGithubOwnerConformance,
  type GithubOwnerWorkspace,
  githubOwnerCorpus,
} from "../src/conformance.js";
import {
  createGithubOwnerResolver,
  type GithubOwnerResolver,
  isGithubOwnerResolver,
  RESERVED_ROUTES,
  resolveGithubOwner,
} from "../src/index.js";

/** A synthetic D16 surface slug: this package is generic over the surface, so its
 *  own run must not borrow a real platform's name. */
const SURFACE = "github-surface";
const LINK_PLATFORMS = new Set(["github", SURFACE]);
const BINDING = { surface: SURFACE, linkPlatforms: LINK_PLATFORMS } as const;

/** Hand-built slices (no `load`): the resolution reads only these two blocks, and
 *  the adapter suites are the ones that prove the corpus is constructible in a
 *  workspace D12 accepts. */
const profileWith = ({ links, handles }: GithubOwnerWorkspace): Profile =>
  ({
    identity: { name: "Elena Vasquez", ...(links === undefined ? {} : { links }) },
    ...(handles === undefined ? {} : { socialHandles: handles }),
  }) as unknown as Profile;

const githubOwner = createGithubOwnerResolver(BINDING);

describeGithubOwnerConformance({
  surface: SURFACE,
  githubOwner,
  artifactUrl: (profile) => {
    const owner = githubOwner(profile);
    return owner === null ? null : `https://raw.example.test/${owner}/HEAD/README.md`;
  },
  profileWith,
});

describe("the shared owner resolution binds one surface and proves it (#224)", () => {
  it("answers true for a function this module produced, and false for a copy", () => {
    expect(isGithubOwnerResolver(githubOwner)).toBe(true);
    // Behaviourally identical, and still not the shared implementation: identity,
    // not shape — a second implementation is the accident this package removes.
    const copy = ((profile: Profile) =>
      resolveGithubOwner(profile, BINDING)) as GithubOwnerResolver;
    expect(isGithubOwnerResolver(copy)).toBe(false);
    expect(isGithubOwnerResolver(() => null)).toBe(false);
    expect(isGithubOwnerResolver(undefined)).toBe(false);
  });

  it("keeps the corpus's families honest: a positive case names an owner, a refusal does not", () => {
    // The `family` tag is load-bearing for the erosion guard in the shared body, so
    // it is checked as an INVARIANT rather than trusted: a mis-tagged case would
    // quietly move a guarantee out of the family that guards it, and the tag would
    // still look plausible in review.
    const cases = githubOwnerCorpus(SURFACE);
    expect(cases.length).toBeGreaterThan(0);
    for (const { why, family, owner } of cases) {
      if (family === "positive" || family === "ordering") {
        expect(owner, `${family}: ${why}`).not.toBeNull();
      } else {
        expect(owner, `${family}: ${why}`).toBeNull();
      }
    }
  });

  it("refuses a binding whose own surface slug is not in its linkPlatforms (the copy-paste guard)", () => {
    // The exact #224 shape: the adapter kept the SIBLING's platform set. Left
    // unrefused it derives `null` for a valid workspace link and reads
    // `no-artifact-url` — a verdict, from a call-site bug.
    const sibling = { surface: "github-org", linkPlatforms: new Set(["github", "github-readme"]) };
    expect(() => createGithubOwnerResolver(sibling)).toThrow(/not in its own linkPlatforms/);
    expect(() => resolveGithubOwner(profileWith({}), sibling)).toThrow(
      /not in its own linkPlatforms/,
    );
    expect(() => createGithubOwnerResolver({ surface: "", linkPlatforms: new Set([""]) })).toThrow(
      /not in its own linkPlatforms/,
    );
  });

  it("snapshots the declaration, so mutating the caller's Set cannot move the resolver", () => {
    // The declaration is the ADAPTER's data and the conformance body reads it back
    // from the resolver (fresh-review F1), so a later mutation of the Set the caller
    // passed must not change the matching behind that declaration.
    const mutable = new Set(["github", "mutable-surface"]);
    const snapshotted = createGithubOwnerResolver({
      surface: "mutable-surface",
      linkPlatforms: mutable,
    });
    expect(snapshotted.linkPlatforms).toEqual(["github", "mutable-surface"]);
    mutable.add("git");
    expect(snapshotted.linkPlatforms).toEqual(["github", "mutable-surface"]);
    expect(
      snapshotted(profileWith({ links: [{ platform: "git", url: "https://github.com/someone" }] })),
    ).toBeNull();
  });

  it("freezes the bound surface: the resolver never answers for a surface it stopped advertising", () => {
    expect(githubOwner.surface).toBe(SURFACE);
    expect(() => {
      (githubOwner as { surface: string }).surface = "github-other";
    }).toThrow(TypeError);
    expect(githubOwner.surface).toBe(SURFACE);
  });

  it("never derives an owner for a workspace with no GitHub at all (the no-request rung)", () => {
    // The operator's case, at the package seam: a workspace whose links are only
    // other platforms, and one with no SSOT blocks at all.
    const silent = profileWith({ links: [{ platform: "x", url: "https://x.com/someone" }] });
    expect(githubOwner(silent)).toBeNull();
    expect(githubOwner(profileWith({}))).toBeNull();
  });

  it("keeps the reserved route table well formed, so a row cannot be a silent no-op (#227)", () => {
    // The table is DATA, and the corpus pins the RULE by kind rather than one case
    // per row — so the shape of the data is what this suite has to hold. A
    // duplicate prefix would shadow a row in the Map; a non-lowercase prefix would
    // never match the case-insensitive lookup; an empty `why`/`observed` would
    // detach a row from its argument and its source; and a table that lost the
    // owner-after rows would silently refuse every org and Sponsors workspace.
    const seen = new Set<string>();
    for (const { prefix, kind, why, observed } of RESERVED_ROUTES) {
      expect(prefix, `not lowercase: ${prefix}`).toBe(prefix.toLowerCase());
      expect(prefix, `not a single slug segment: ${prefix}`).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(prefix), `duplicate prefix: ${prefix}`).toBe(false);
      seen.add(prefix);
      expect(kind === "owner-after-prefix" || kind === "no-owner", kind).toBe(true);
      expect(why.length, `no rationale: ${prefix}`).toBeGreaterThan(0);
      expect(observed.length, `no source: ${prefix}`).toBeGreaterThan(0);
    }
    // The KIND partition, as a LITERAL oracle (#232 review, F3): `kind` is the
    // field that decides whether a prefix is read as a route or as the owner, and a
    // derived loop cannot falsify it — the expectation would come from the data it
    // is meant to check. Typed out here, a kind flip (or a new row) is a diff
    // somebody has to write twice and a reviewer sees. The order-insensitive form
    // keeps row reordering free.
    //
    // The ADMISSION evidence for every prefix in these lists, re-run 2026-10-15:
    // `gh api /users/<prefix>` → 404 (the login is FREE, so no account is shadowed)
    // and `https://github.com/<prefix>` → 200 with GitHub's own page. A name a live
    // account holds is NOT a row, whatever the lowercase page looks like — that is
    // why `profile`, `www`, `customer-stories`, `careers`, `actions`, `docs`, … are
    // absent (`/users/<name>` → 200 for each).
    const EXPECTED_OWNER_AFTER = ["orgs", "sponsors"];
    const EXPECTED_NO_OWNER =
      `about account advisories apps blog business codespaces collections contact copilot
      customers dashboard discover discussions education enterprise enterprises events
      explore features gists guides home issues join login logout marketplace mobile new
      nonprofit notifications open-source organizations pages partners press pricing pulls
      readme repositories resources search security settings signup site-policy sitemap
      social-impact solutions spark stars status support team terms topics trending
      trust-center universe users why-github wiki`
        .split(/\s+/)
        .filter((p) => p !== "");
    expect(
      RESERVED_ROUTES.filter(({ kind }) => kind === "owner-after-prefix")
        .map((r) => r.prefix)
        .sort(),
    ).toEqual(EXPECTED_OWNER_AFTER);
    expect(
      RESERVED_ROUTES.filter(({ kind }) => kind === "no-owner")
        .map((r) => r.prefix)
        .sort(),
    ).toEqual([...EXPECTED_NO_OWNER].sort());
    expect(EXPECTED_OWNER_AFTER.length + EXPECTED_NO_OWNER.length).toBe(RESERVED_ROUTES.length);
    // `profile` is the row #227 proposed and this table deliberately refuses:
    // `github.com/profile` is a live account, so a row here would un-verify a
    // workspace that does publish.
    expect(seen.has("profile")).toBe(false);
    expect(githubOwner(profileWith({ links: [{ url: "https://github.com/profile" }] }))).toBe(
      "profile",
    );
  });

  it("exercises EVERY row's behaviour, so a row the code ignores cannot pass (#232 review, F3)", () => {
    // The corpus pins representatives; this loop is the other half — each row must
    // actually change an answer. A row that the resolution never consults (a typo'd
    // prefix, a row added to data but not to the lookup) would leave 31 of the rows
    // unproven, and `kind` is what decides the owner: `no-owner` must refuse the
    // segment after the prefix, `owner-after-prefix` must read it.
    for (const { prefix, kind } of RESERVED_ROUTES) {
      const bare = `https://github.com/${prefix}`;
      expect(githubOwner(profileWith({ links: [{ url: bare }] })), bare).toBeNull();
      const withOwner = `https://github.com/${prefix}/elenavasquez`;
      expect(githubOwner(profileWith({ links: [{ url: withOwner }] })), withOwner).toBe(
        kind === "owner-after-prefix" ? "elenavasquez" : null,
      );
    }
  });

  it("refuses a reserved name proposed as an OWNER, not only as a first segment (#227, review F1)", () => {
    // DERIVED over the table, not two hand-picked cases: the first revision
    // consulted the table only for `segments[0]`, so `/sponsors/settings` and
    // `/orgs/topics` still derived the owner `settings`/`topics` and aimed
    // `--verify` at `raw.githubusercontent.com/settings/settings/…`. Raising the
    // check into `ownerSlug` makes it candidate-level, and this loop holds it for
    // every owner-after row against every reserved name at once — a new row cannot
    // reopen the hole silently.
    const reserved = RESERVED_ROUTES.map(({ prefix }) => prefix);
    const ownerAfter = RESERVED_ROUTES.filter(({ kind }) => kind === "owner-after-prefix");
    expect(ownerAfter.length).toBeGreaterThan(0);
    for (const { prefix } of ownerAfter) {
      for (const name of reserved) {
        const url = `https://github.com/${prefix}/${name}`;
        expect(githubOwner(profileWith({ links: [{ url }] })), url).toBeNull();
      }
    }
    // The complementary half, so the refusal is not vacuous: a real owner in the
    // same slot still resolves.
    expect(
      githubOwner(profileWith({ links: [{ url: "https://github.com/sponsors/elenavasquez" }] })),
    ).toBe("elenavasquez");
  });
});
