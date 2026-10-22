/**
 * The reading set projected into `site/docs/` (issue #277).
 *
 * ONE home for the document list: the generator renders it, and the release
 * barrier (`scripts/site-check/version-check.mjs`) reads the same files to make
 * sure every version claim that reaches the published page matches the CLI
 * manifest. A document added here is projected AND gated; there is no second
 * list to forget.
 *
 * `lang` is the language of the DOCUMENT, not of the page chrome (which stays
 * English): the roadmap is written in Spanish and must say so.
 */
export const DOCS = [
  { slug: "user-guide", file: "docs/USER-GUIDE.md", lang: "en" },
  { slug: "spec", file: "docs/SPEC.md", lang: "en" },
  { slug: "contributing", file: "CONTRIBUTING.md", lang: "en" },
  { slug: "roadmap", file: "docs/ROADMAP.md", lang: "es" },
];
