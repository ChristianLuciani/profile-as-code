/**
 * Types for `release-notes.mjs` (#181): the release-notes suite imports the
 * exported extractor directly, so the test type-check needs its surface
 * declared. Kept beside the script (not in the package `src`) because the
 * script is a release-path tool, shipped outside the published `dist`.
 */

/**
 * Extract the Keep-a-Changelog section for `version` (the exact heading, not a
 * prefix) from `changelog`. Returns `null` when the version has no section.
 */
export function extractReleaseNotes(changelog: string, version: string): string | null;
