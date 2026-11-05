/**
 * Reading a `robots.txt` back, and comparing its agent↔group map against the
 * registry (issue #477).
 *
 * `pasco export ai-policy --out` emits the posture; a consumer that commits that
 * file can only check its STRUCTURE on its own (two groups, no wildcard, no mixed
 * group). Structure is not the stance: the two lists swapped is a structurally
 * valid file that states the exact opposite policy. This module closes that gap
 * without a workspace and without the network — the classification is registry
 * data, exactly like `export ai-policy --check`.
 *
 * Parsing follows RFC 9309 §2.2: a group is one or more `User-agent` lines
 * followed by rules, terminated by a `User-agent` line or the end of the file;
 * `#` starts a comment; a rule that belongs to no group (one that precedes the
 * first `User-agent`) is ignored by crawlers (§2.2.2) — so it is reported here as
 * an orphan instead of silently scoring as a restriction.
 *
 * Determinism: this module reads no clock and no workspace. Two runs over the
 * same text produce the same findings in the same order (registry order for the
 * agent-level findings, then the structural ones in file order).
 */

import type { AiCrawler } from "@profile-as-code/core";

/** One `Allow`/`Disallow` line, with the 1-based line it came from. */
export interface RobotsRule {
  line: number;
  key: "allow" | "disallow";
  /** The path pattern, verbatim (empty for `Allow:` with no path). */
  path: string;
}

/** One group: its `User-agent` tokens, in file order, and its rules. */
export interface RobotsGroup {
  /** 1-based line of the group's first `User-agent`. */
  line: number;
  agents: string[];
  rules: RobotsRule[];
}

/** A parsed `robots.txt`: the groups plus the rules no group owns. */
export interface RobotsFile {
  groups: RobotsGroup[];
  /** Rules that precede the first `User-agent` (RFC 9309 §2.2.2). */
  orphanRules: RobotsRule[];
}

/**
 * What went wrong. One finding per fact, never a generic "invalid robots.txt":
 * a consumer's gate has to name the crawler and the group.
 */
export type RobotsFindingKind =
  | "missing" // a registry crawler is in no group
  | "duplicate" // the same token in two groups (RFC merges them — contradictory posture)
  | "wrong-group" // the crawler's group states the opposite rule for "/"
  | "wildcard" // a `User-agent: *` group: the policy is an explicit list
  | "orphan-rule"; // a rule with no group, which crawlers ignore

export interface RobotsFinding {
  kind: RobotsFindingKind;
  /** The subject: the registry slug, `*` for the wildcard, or the orphan rule text. */
  entry: string;
  detail: string;
}

/**
 * Parse `robots.txt` into groups, per RFC 9309 §2.2. Comments are stripped at
 * `#`; a record whose key is neither `user-agent` nor `allow`/`disallow`
 * (a `Sitemap`, say) is ignored and does NOT terminate the group (§2.2.4).
 */
export function parseRobots(text: string): RobotsFile {
  const groups: RobotsGroup[] = [];
  const orphanRules: RobotsRule[] = [];

  const lines = text.split(/\r\n|\r|\n/u);
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const hash = raw.indexOf("#");
    const content = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    if (content === "") continue;

    const match = /^([A-Za-z][A-Za-z-]*)\s*:\s*(.*)$/u.exec(content);
    if (match === null) continue;
    const key = match[1]?.toLowerCase() ?? "";
    const value = (match[2] ?? "").trim();

    if (key === "user-agent") {
      // `product-token` per §2.2: the token is the value, up to whitespace.
      const token = value.split(/\s+/u)[0] ?? "";
      if (token === "") continue;
      const current = groups.at(-1);
      // A `User-agent` line after a group's rules starts a new group; before
      // them it joins the group being declared.
      if (current !== undefined && current.rules.length === 0) current.agents.push(token);
      else groups.push({ line, agents: [token], rules: [] });
      continue;
    }

    if (key !== "allow" && key !== "disallow") continue;
    const rule: RobotsRule = { line, key, path: value };
    const group = groups.at(-1);
    if (group === undefined) orphanRules.push(rule);
    else group.rules.push(rule);
  }

  return { groups, orphanRules };
}

/** The rule a group states for the root path `/`, if any. */
function rootStance(group: RobotsGroup): "allow" | "disallow" | "none" {
  const atRoot = group.rules.filter((rule) => rule.path === "/");
  // §2.2.2: an `allow` and a `disallow` for the same pattern — the `allow` wins.
  if (atRoot.some((rule) => rule.key === "allow")) return "allow";
  if (atRoot.some((rule) => rule.key === "disallow")) return "disallow";
  return "none";
}

function describeStance(stance: "allow" | "disallow" | "none"): string {
  if (stance === "allow") return "`Allow: /` (everything allowed)";
  if (stance === "disallow") return "`Disallow: /` (everything blocked)";
  return "no rule for `/` (so the crawler is not restricted)";
}

/**
 * Compare a parsed file against the registry: one finding per crawler that is
 * absent, duplicated or in the wrong group, plus the structural findings.
 */
export function verifyRobotsFile(
  file: RobotsFile,
  crawlers: readonly AiCrawler[],
): RobotsFinding[] {
  const findings: RobotsFinding[] = [];

  for (const crawler of crawlers) {
    const token = crawler.ua.toLowerCase();
    const holders = file.groups.filter((group) =>
      group.agents.some((agent) => agent.toLowerCase() === token),
    );
    const expected = crawler.family === "retrieval" ? "allow" : "disallow";
    const expectedRule = expected === "allow" ? "`Allow: /`" : "`Disallow: /`";

    if (holders.length === 0) {
      findings.push({
        kind: "missing",
        entry: crawler.slug,
        detail: `"${crawler.ua}" is in no group — the registry places it in ai-${crawler.family} (${expectedRule})`,
      });
      continue;
    }
    if (holders.length > 1) {
      const where = holders.map((group) => `line ${group.line}`).join(", ");
      findings.push({
        kind: "duplicate",
        entry: crawler.slug,
        detail: `"${crawler.ua}" appears in ${holders.length} groups (${where}) — RFC 9309 §2.2.1 merges them into one, so the file states a contradictory posture`,
      });
      continue;
    }

    const group = holders[0];
    if (group === undefined) continue;
    const actual = rootStance(group);
    if (actual !== expected) {
      findings.push({
        kind: "wrong-group",
        entry: crawler.slug,
        detail: `"${crawler.ua}" is in the ${crawler.family} role but its group (line ${group.line}) states ${describeStance(actual)} — expected ${expectedRule}`,
      });
    }
  }

  for (const group of file.groups) {
    if (!group.agents.includes("*")) continue;
    findings.push({
      kind: "wildcard",
      entry: "*",
      detail: `line ${group.line} — a \`User-agent: *\` group restricts every crawler the list does not name; the policy is an explicit list, never a wildcard`,
    });
  }

  for (const rule of file.orphanRules) {
    const text = `${rule.key}: ${rule.path === "" ? "(empty)" : rule.path}`;
    findings.push({
      kind: "orphan-rule",
      entry: text,
      detail: `line ${rule.line} — \`${text}\` precedes the first \`User-agent\` line, so no group owns it and crawlers ignore it (RFC 9309 §2.2.2)`,
    });
  }

  return findings;
}
