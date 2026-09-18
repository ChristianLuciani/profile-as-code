/**
 * Renderer `github-readme` (M2) — SPEC §15.
 *
 * Pure function of a PlatformProfile (compile() slice): same input → same bytes
 * (byte-stable, §15.1). No network, no AI, no randomness. Facts pass through
 * untouched from the SSOT; texts are the platform+lang slice with en-fallback
 * for langMaps (compile already filtered bios/headlines by exact lang).
 *
 * Output sections (§15.3): header (name + headline + identity badges) ·
 * statement · featured projects (ordered by github-readme skill weight) ·
 * publications (DOI-resolvable) · skills (weight order) · links (sameAs) ·
 * evidence registry (v1.4/D17/§18: credentials + artifacts, `public` only —
 * §18.5; `path` locators never emit a URL, §18.3 capability matrix) ·
 * JSON-LD Person (with hasCredential, §18.9) · generated footer with fact-count.
 */

import type {
  Artifact,
  Credential,
  Lang,
  MediaAsset,
  PlatformProfile,
  Project,
  Skill,
} from "@profile-as-code/core";
import { credentialLdEntries, isPublicEntry } from "@profile-as-code/core";
import { mdHref, mdText } from "@profile-as-code/markdown";

export const deploySpec = "git" as const;

export interface RenderResult {
  text: string;
  assets?: string[];
}

export interface RenderOptions {
  lang?: Lang;
  /** M8 (§18.6): the build's media bundle — the renderer links ONLY artifacts
   *  whose bytes the build actually bundled (checksummed at compile); absent →
   *  path locators stay link-free (byte-identical to the M7 output). */
  assets?: readonly MediaAsset[];
}

/** Deterministic credential row: **Title** (kind) — issuer, years · [verify](url). */
function credentialLine(c: Credential): string {
  const years =
    c.issued !== undefined
      ? `, ${c.issued.slice(0, 4)}${c.expires !== undefined ? `–${c.expires.slice(0, 4)}` : ""}`
      : "";
  const verify = c.verifyUrl !== undefined ? ` · [verify](${mdHref(c.verifyUrl)})` : "";
  return `- **${c.title}** (${c.kind}) — ${c.issuer}${years}${verify}`;
}

/** Deterministic artifact row — capability matrix (§18.3): `url` locators link
 *  verbatim (URL SSOT); a BUNDLED `path` locator links its deploy-relative
 *  target `assets/<id>/<basename>` (M8/§18.6 — resolves on the public deploy
 *  surface, never a private raw URL, D14); an unbundled `path` locator emits no
 *  link (byte-identical to the M7 output — the build only passes assets whose
 *  bytes it actually copied, checksummed at compile). */
function artifactLine(
  a: Artifact,
  lang: Lang,
  assetsById: ReadonlyMap<string, MediaAsset>,
): string {
  const desc = pickText(a.description, lang);
  const license = a.license !== undefined ? ` · ${a.license}` : "";
  let link = "";
  if (a.locator.url !== undefined) {
    link = ` — [${mdText(hostname(a.locator.url))}](${mdHref(a.locator.url)})`;
  } else if (a.id !== undefined) {
    const asset = assetsById.get(a.id);
    if (asset !== undefined) link = ` — [${mdText(asset.target)}](${mdHref(asset.target)})`;
  }
  return `- **${a.title}** (${a.kind})${link}${license}${desc !== undefined ? ` — ${desc}` : ""}`;
}

/** Deterministic badge map: platform → shield.io style + display name. */
const BADGE: Record<string, { color: string; logo: string; label: string }> = {
  github: { color: "181717", logo: "github", label: "GitHub" },
  linkedin: { color: "0A66C2", logo: "linkedin", label: "LinkedIn" },
  x: { color: "000000", logo: "X", label: "X" },
  orcid: { color: "A6CE39", logo: "orcid", label: "ORCID" },
  substack: { color: "FF6719", logo: "substack", label: "Substack" },
  researchgate: { color: "00CCBB", logo: "researchgate", label: "ResearchGate" },
  scholar: { color: "4285F4", logo: "googlescholar", label: "Scholar" },
  website: { color: "111111", logo: "github", label: "Website" },
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function hostnamePath(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

function pickText(map: Record<string, string> | undefined, lang: Lang): string | undefined {
  if (map === undefined) return undefined;
  // Issue #84 (option (a) ratified): empty-string values count as ABSENT at
  // both lookup levels — a lang-specific "" falls back to en, an empty en is
  // no text. Byte-parity: populated workspaces unchanged.
  return map[lang] || map.en || undefined;
}

/**
 * Issue #84/#86 (empty = absent at the accessor): plain-string lists drop exact
 * empty items — the same rule langMaps get in `pickText`, applied to arrays.
 * One helper for both keyword sites: rendering (``"a, , b"`) and weight matching
 * (`{ "" } ∩ { "" }` used to match two keyword-less entries). No trim — the rule
 * is the exact empty string, whitespace-only stays data.
 */
function nonEmpty(list: readonly string[] | undefined): string[] {
  return (list ?? []).filter((value) => value !== "");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** github-readme weight of a skill (missing → 0). */
function skillWeight(s: Skill): number {
  return s.platformWeights?.["github-readme"] ?? 0;
}

/**
 * Featured-project ordering (SPEC §15.3): the best github-readme skill weight
 * among skills sharing at least one keyword OR geoKeyword with the project
 * (geoKeywords = the GEO match surface, D7). Deterministic: weight desc,
 * then name asc.
 */
function projectWeight(p: Project, skills: readonly Skill[]): number {
  const pk = new Set(nonEmpty(p.keywords).map((k) => k.toLowerCase().trim()));
  if (pk.size === 0) return 0;
  let best = 0;
  for (const s of skills) {
    const sk = new Set(
      [...nonEmpty(s.keywords), ...nonEmpty(s.geoKeywords)].map((k) => k.toLowerCase().trim()),
    );
    if ([...pk].some((k) => sk.has(k))) best = Math.max(best, skillWeight(s));
  }
  return best;
}

export function render(p: PlatformProfile, opts: RenderOptions = {}): RenderResult {
  const lang = opts.lang ?? p.lang;
  let referencedAssets: string[] | undefined;
  const out: string[] = [];

  // 1. Header — name, headline (exact lang; compile already filtered), badges.
  out.push(`# ${p.identity.name}`);
  const headline = p.headlines.find((h) => h.lang === lang);
  if (headline !== undefined) out.push("", `### ${headline.text}`);

  // Badges: ONE per platform, in identity.links order — the canonical profile
  // links first (project/repo links share the github platform but are not
  // badges; they live in Projects/Links sections).
  const seenBadge = new Set<string>();
  const badges: string[] = [];
  for (const l of p.identity.links ?? []) {
    if (l.platform === undefined) continue;
    if (seenBadge.has(l.platform)) continue;
    const b = BADGE[l.platform];
    if (b === undefined) continue;
    seenBadge.add(l.platform);
    badges.push(
      `[![${b.label}](https://img.shields.io/badge/${b.label}-${hostname(l.url)}-${b.color}?style=flat&logo=${b.logo}&logoColor=white)](${mdHref(l.url)})`,
    );
  }
  if (badges.length > 0) out.push("", badges.join(" "));

  // 2. Statement.
  if (p.statement !== undefined) out.push("", `**${p.statement}**`);

  // 3. Featured projects — top 6 by weight (§15.3), all if fewer.
  const projects = [...p.projects].sort(
    (a, b) =>
      projectWeight(b, p.skills) - projectWeight(a, p.skills) || a.name.localeCompare(b.name),
  );
  if (projects.length > 0) {
    out.push("", "## Projects");
    for (const project of projects.slice(0, 6)) {
      const desc = pickText(project.description, lang);
      // `status` is schema-optional (required is `name` only): absent → the
      // ` · \`status\`` segment is omitted, never interpolated as "undefined"
      // (issue #78 sweep — same class as the label fallback).
      const status = project.status !== undefined ? ` · \`${project.status}\`` : "";
      out.push("", `- **${project.name}**${status}${desc !== undefined ? ` — ${desc}` : ""}`);
      for (const link of project.links ?? [])
        out.push(`  - [${mdText(hostnamePath(link))}](${mdHref(link)})`);
      for (const ev of project.evidence ?? []) {
        const claim = pickText(ev.claim, lang);
        if (claim !== undefined)
          out.push(`  - Evidence: ${claim} ([source](${mdHref(ev.source)}))`);
      }
    }
  }

  // 4. Publications — DOI/ORCID-resolvable (the GEO anchor).
  if (p.publications.length > 0) {
    out.push("", "## Publications");
    for (const pub of p.publications) {
      const doi =
        pub.doi !== undefined
          ? ` [DOI: ${mdText(pub.doi)}](${mdHref(`https://doi.org/${pub.doi}`)})`
          : "";
      out.push("", `- **${pub.title}** — ${pub.venue}, ${pub.year}.${doi}`);
    }
  }

  // 5. Skills — weight order for this platform.
  const skills = [...p.skills].sort(
    (a, b) => skillWeight(b) - skillWeight(a) || a.name.localeCompare(b.name),
  );
  if (skills.length > 0) {
    out.push("", "## Skills");
    for (const s of skills) {
      const keywords = nonEmpty(s.keywords).join(", ");
      // `level` is schema-optional (required is `name` only): absent → the
      // parenthetical is omitted, never interpolated as "undefined"
      // (issue #78 sweep — same class as the label fallback).
      out.push(
        "",
        `- **${s.name}**${s.level !== undefined ? ` (${s.level})` : ""}${keywords !== "" ? `: ${keywords}` : ""}`,
      );
    }
  }

  // 6. Evidence registry (v1.4/D17/§18) — public entries only (§18.5), compact.
  const credentials = (p.credentials ?? []).filter(isPublicEntry);
  const artifacts = (p.artifacts ?? []).filter(isPublicEntry);
  if (credentials.length > 0) {
    out.push("", "## Credentials");
    for (const c of credentials) out.push("", credentialLine(c));
  }
  if (artifacts.length > 0) {
    // M8 (§18.6): bundled path-locator artifacts link their deploy-relative
    // target; the referenced targets are the renderer's `assets` declaration —
    // the contract the build bundles and checksums into the platform output.
    const assetsById = new Map((opts.assets ?? []).map((a) => [a.artifactId, a]));
    const referenced: string[] = [];
    out.push("", "## Artifacts");
    for (const a of artifacts) {
      const target =
        a.locator.path !== undefined && a.id !== undefined
          ? assetsById.get(a.id)?.target
          : undefined;
      out.push("", artifactLine(a, lang, assetsById));
      if (target !== undefined) referenced.push(target);
    }
    if (referenced.length > 0) referencedAssets = referenced;
  }

  // 7. Links (sameAs) + JSON-LD Person (with hasCredential, §18.9).
  // Contact email (v1.5, issue #71): a FACT emitted first (contact leads,
  // channels follow) as a mailto: href — output-only: identity.links[] stays
  // page-URLs-only, so `sameAs` (below) never carries a mailto: URI.
  out.push("", "## Links");
  if (p.identity.email !== undefined)
    out.push("", `- [Email](${mdHref(`mailto:${p.identity.email}`)})`);
  // `label` is optional in the schema (`identity.links[]` — only `url` is
  // required, and the string may be EMPTY — no minLength): the pre-#78 emission
  // interpolated it raw, so a label-less link rendered "[undefined]" and an
  // empty-string label rendered "- [](...)", both in a public README. Fallback =
  // `hostnamePath(l.url)` (issue option (b)) — exactly the label project links
  // already use, so the two link families stay visually consistent; loose
  // labels stay bracket-safe like every other label. `||` (not `??`) so the
  // empty string also counts as label-less.
  for (const l of p.identity.links ?? [])
    out.push("", `- [${mdText(l.label || hostnamePath(l.url))}](${mdHref(l.url)})`);

  const publicCredentials = credentialLdEntries(p.credentials ?? []); // filters internally — no double pass
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: p.identity.name,
  };
  if (p.identity.email !== undefined) jsonLd.email = p.identity.email;
  if (p.identity.photo !== undefined) jsonLd.image = p.identity.photo;
  if (p.identity.location !== undefined) jsonLd.address = p.identity.location;
  jsonLd.sameAs = (p.identity.links ?? []).map((l) => l.url);
  if (publicCredentials.length > 0) jsonLd.hasCredential = publicCredentials;
  out.push(
    "",
    "<!-- JSON-LD (schema.org Person) -->",
    "```json",
    JSON.stringify(jsonLd, null, 2),
    "```",
  );

  // 8. Footer — deterministic marker + fact count (for diff/CI assertions, §15.3).
  out.push(
    "",
    `<!-- generated by profile-as-code pasco build github-readme · ${plural(projects.length, "project")} · ${plural(p.publications.length, "publication")} -->`,
  );

  return {
    text: `${out.join("\n")}\n`,
    ...(referencedAssets !== undefined ? { assets: referencedAssets } : {}),
  };
}
