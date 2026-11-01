/**
 * The site's single configuration surface (issue #277).
 *
 * Everything downstream is derived from this file: the generator renders it, and
 * the release barrier reads it. One home, two consumers — a document added here
 * is projected AND gated, so there is no second list to forget.
 *
 * `lang` is the language of the DOCUMENT, not of the page chrome (which stays
 * English): the roadmap is written in Spanish and must say so.
 */
export const SITE = {
  name: "profile-as-code",
  tagline:
    "A versioned source of truth for your professional identity: one YAML workspace, platform-specific texts for GitHub, LinkedIn, Upwork, X, and more.",
  repo: "ChristianLuciani/profile-as-code",
  baseUrl: "https://christianluciani.github.io/profile-as-code",
  license: "MIT",
  /** Named author for the article metadata (the repository's owner). */
  author: "Christian Luciani",
  /** Package manifest the published version claims are checked against. */
  versionManifest: "packages/cli/package.json",
  claimPackage: "@profile-as-code/cli",
  /** A raster asset under `site/` (OG ignores SVG). Null = no og:image. */
  ogImage: { path: "brand/identity.png", width: 1120, height: 720, alt: "profile-as-code" },
};

export const DOCS = [
  { slug: "start-here", file: "docs/START-HERE.md", lang: "en" },
  { slug: "user-guide", file: "docs/USER-GUIDE.md", lang: "en" },
  { slug: "tutorial", file: "docs/TUTORIAL.md", lang: "en" },
  { slug: "spec", file: "docs/SPEC.md", lang: "en" },
  { slug: "contributing", file: "CONTRIBUTING.md", lang: "en" },
  { slug: "schema-contract", file: "docs/SCHEMA-CONTRACT.md", lang: "en" },
  { slug: "roadmap", file: "docs/ROADMAP.md", lang: "es" },
];

/**
 * The hand-authored landings (issue #280/#308): the ONE home of "which page is
 * in which language", so the sitemap alternates and the version gate read the
 * same list instead of each hard-coding `/es/`.
 *
 * `claims: false` means the page must NOT state a version: the release claim
 * lives on the EN landing and in the projected docs, and a mirror that repeated
 * it would be a second place to forget on every release (the drift class this
 * engine exists to remove).
 */
export const LANDINGS = [
  { slug: "", file: "site/index.html", lang: "en", claims: true },
  { slug: "es/", file: "site/es/index.html", lang: "es", claims: false },
];
