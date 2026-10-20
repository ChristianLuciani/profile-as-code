// E2E dogfood — Christian Luciani · mechanical verifier.
// Read-only on the workspace. Run: node .e2e/verify.mjs   (from the profile-as-code repo)
//
// Prints one line per check (PASS · FAIL · INFO · PENDING) and exits 1 if any FAIL.
// Everything is derived from the workspace + the live GitHub artifact; nothing is taken
// from what a human or agent *said* happened.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "..");
const WS = process.env.PASCO_WS ?? "/Users/eva/PROJECTOS/GitHub/ChristianLuciani/profile-data";
const PASCO = join(ENGINE, "packages", "cli", "dist", "index.js");

let yaml;
try {
  yaml = (await import(join(ENGINE, "node_modules", "yaml", "dist", "index.js"))).default;
} catch {
  yaml = (await import("yaml")).default;
}

const results = [];
const record = (status, name, detail = "") =>
  results.push({ status, name, detail }) &&
  console.log(`${status.padEnd(7)} ${name}${detail ? ` — ${detail}` : ""}`);

const run = (cmd, args, opts = {}) => {
  try {
    const out = execFileSync(cmd, args, {
      cwd: WS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

const load = (file) => {
  const p = join(WS, "content", file);
  return existsSync(p) ? yaml.parse(readFileSync(p, "utf8")) : undefined;
};

// ── 0. preconditions ────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
record(existsSync(PASCO) ? "PASS" : "FAIL", "engine binary present", PASCO);
record("INFO", "workspace", WS);

if (existsSync(join(WS, "content"))) {
  // ── 1. validate ───────────────────────────────────────────────────────────
  const v = run("node", [PASCO, "validate", "--json"]);
  let vj;
  try {
    vj = JSON.parse(v.out);
  } catch {
    /* not json */
  }
  record(v.code === 0 ? "PASS" : "FAIL", "pasco validate exits 0", `exit ${v.code}`);
  if (vj?.drift) {
    const n = vj.drift.failures?.length ?? vj.drift.length ?? vj.drift.count ?? 0;
    record(n === 0 ? "PASS" : "FAIL", "zero drift findings", `${n}`);
  } else if (/no drift warnings/.test(v.out)) {
    record("PASS", "zero drift findings", "no drift warnings");
  }
  if (vj?.geo?.overall != null) record("INFO", "geo overall score", `${vj.geo.overall}/100`);

  // ── 2. completeness ───────────────────────────────────────────────────────
  const c = run("node", [PASCO, "status", "--completeness"]);
  const m = c.out.match(/(\d+(?:\.\d+)?)% — (\d+)\/(\d+)/);
  if (m) {
    record(
      Number(m[1]) >= 65.8 ? "PASS" : "FAIL",
      "completeness not below baseline",
      `${m[1]}% (baseline 65.8%)`,
    );
  }
  // deployment item = every trackable unit carries a ledger record
  const never = c.out.match(/Deployed to a surface — (\d+)\/(\d+)/);
  if (never) record("INFO", "units deployed", `${never[1]}/${never[2]}`);

  // ── 3. language coverage (the completeness row) ───────────────────────────
  const bioT = (load("bios.yaml") ?? []).filter((b) => b.lang === "en").map((b) => b.platform);
  const headT = (load("headlines.yaml") ?? [])
    .filter((h) => h.lang === "en")
    .map((h) => h.platform);
  const esCovered = (load("bios.yaml") ?? []).filter((b) => b.lang === "es").map((b) => b.platform);
  const enPlatforms = [...new Set([...bioT, ...headT])];
  const missingEs = enPlatforms.filter((p) => !esCovered.includes(p));
  record("FAIL", "every en platform also has an es text", missingEs.join(", ") || "complete");
  record(
    "INFO",
    "completeness-lang-coverage",
    "the engine counts a text only when ONE entry covers en/es/fr (1/49 today) — the 3-lang target is a product decision, not part of this run",
  );

  // ── 4. platform limits (§actuals in skills are cited; these are the public caps) ──
  // Public caps. LinkedIn headline 220 / About 2,600 (unil.ink 2026-05-02); Upwork title 50 /
  // overview 5,000 (snipework 2026-03-08); X bio 160 (omnisocials, checked 2026-10-17).
  // Substack/ResearchGate/Patreon: NO sourced cap — measured against the 26-word substack
  // convention only as INFO; the engine's skill is the authority for them.
  const LIMITS = {
    linkedin: { headline: 220, bio: 2600 },
    upwork: { headline: 50, bio: 5000 },
    x: { bio: 160 },
  };
  for (const h of load("headlines.yaml") ?? []) {
    const lim = LIMITS[h.platform]?.headline;
    if (lim)
      record(
        h.text.length <= lim ? "PASS" : "FAIL",
        `headline ${h.platform}/${h.lang} ≤ ${lim}`,
        `${h.text.length}`,
      );
    else record("INFO", `headline ${h.platform}/${h.lang} (no cap in skills)`, `${h.text.length}`);
  }
  for (const b of load("bios.yaml") ?? []) {
    const words = b.text.trim().split(/\s+/).length;
    if (b.platform === "substack")
      record(
        words <= 26 ? "PASS" : "INFO",
        `bio ${b.platform}/${b.lang} ≤ 26 words (convention, not a cap)`,
        `${words} words`,
      );
    const lim = LIMITS[b.platform]?.bio;
    if (lim)
      record(
        b.text.length <= lim ? "PASS" : "FAIL",
        `bio ${b.platform}/${b.lang}/${b.length} ≤ ${lim}`,
        `${b.text.length}`,
      );
  }
  // limits the platform skills must DECLARE (they state the caps the agent is held to)
  for (const [platform, cap] of [
    ["linkedin", "headline"],
    ["upwork", "headline"],
    ["x", "bio"],
  ]) {
    const skillPath = join(ENGINE, "skills", platform, "SKILL.md");
    const has =
      existsSync(skillPath) && new RegExp(String(cap), "i").test(readFileSync(skillPath, "utf8"));
    record(
      "INFO",
      `skills/${platform}/SKILL.md declares a limit for ${cap}`,
      has ? "yes" : "not found",
    );
  }

  // ── 5. link SSOT + markdown validity in renders ───────────────────────────
  const identity = load("identity.yaml") ?? {};
  const ssot = new Set((identity.links ?? []).map((l) => l.url));
  const readme = existsSync(join(WS, "profiles", "github-readme", "README.md"))
    ? readFileSync(join(WS, "profiles", "github-readme", "README.md"), "utf8")
    : "";
  if (readme) {
    const hrefs = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map((x) => x[1]);
    const outside = hrefs.filter(
      (u) =>
        !ssot.has(u) &&
        !/^(mailto:|https?:\/\/(www\.)?(github\.com|doi\.org|https?)\/)/.test(u) &&
        !/shields\.io|doaj|zenodo|ssrn/i.test(u),
    );
    record(
      outside.length === 0 ? "PASS" : "FAIL",
      "rendered links ⊆ identity.links (+ declared proof links)",
      outside.join(", ") || "",
    );
    // unbalanced markdown link labels/parens: `](` that never closes before the next `[`
    const broken = [...readme.matchAll(/\[([^\]]*)\]\(([^()\s]*\([^)]*[^)\s]*)\)/g)];
    record(
      broken.length === 0 ? "PASS" : "FAIL",
      "markdown link destinations balanced (no paren inside a destination)",
      `${broken.length}`,
    );
    // locale-agnostic: no full URL as a badge label
    const labelUrls = [...readme.matchAll(/!\[[^\]]*\]\([^)]*label=([^&)]*)/g)]
      .map((x) => x[1])
      .filter((l) => /https?%3A|\/\/|\.com|\.io/.test(decodeURIComponent(l)));
    record(
      labelUrls.length === 0 ? "PASS" : "FAIL",
      "no URL-as-badge-label (locale-agnostic)",
      labelUrls.join(", ") || "",
    );
    // CV-bio style trilingual hook present
    record(
      /^\*\*Physicist\.|Physicist\.\s*20\+/m.test(readme) ? "PASS" : "INFO",
      "trilingual bio (CV bio_spot) in the hook",
      "optional — reviewer judgement",
    );
  } else {
    record("INFO", "no generated profile README in workspace", "expected before Step 1");
  }

  // ── 6. live GitHub profile parity (the deploy is byte-identical to the artifact) ──
  const gh = run(
    "gh",
    ["api", "repos/ChristianLuciani/ChristianLuciani/readme", "--jq", ".content"],
    { cwd: ENGINE },
  );
  if (gh.code === 0) {
    const live = Buffer.from(gh.out.trim(), "base64").toString("utf8");
    const liveSha = createHash("sha256").update(live).digest("hex");
    const artSha = readme ? createHash("sha256").update(readme).digest("hex") : null;
    record(
      liveSha === artSha ? "PASS" : "FAIL",
      "live profile README == workspace artifact",
      `${liveSha.slice(0, 12)} vs ${artSha?.slice(0, 12) ?? "no artifact"}`,
    );
    record(
      /generated by profile-as-code p(asc)?o build/.test(live) ? "PASS" : "INFO",
      "live README carries the generated marker",
      "",
    );
    record(
      /"@type": "Person"/.test(live) ? "PASS" : "FAIL",
      "live README carries schema.org Person JSON-LD",
      "",
    );
    record(
      /"[^"]+"\s*:\s*"[^"]*[a-z]:\/\/[^"]*"/.test(live) ? "FAIL" : "PASS",
      'JSON-LD URLs are real URLs (no bare "mailto:…" as a URL)',
      "",
    );
  } else {
    record("INFO", "live GitHub read unavailable", gh.out.split("\n")[0]);
  }

  // ── 7. ledger & target surfaces (declaration vs record) ────────────────────
  const s = run("node", [PASCO, "status"]);
  const counts = s.out.match(/(\d+) units · (\d+) stale · (\d+) never · (\d+) in-sync/);
  if (counts)
    record(
      "INFO",
      "deploy status",
      `units ${counts[1]} · stale ${counts[2]} · never ${counts[3]} · in-sync ${counts[4]}`,
    );
  const ledger = load("deployments.yaml") ?? {};
  const surfaces = new Set();
  for (const units of Object.values(ledger))
    for (const surf of Object.keys(units)) surfaces.add(surf);
  const expected = manifest.surfaces ?? [];
  const missing = expected.filter((x) => ![...surfaces].some((sg) => sg.startsWith(x)));
  if (expected.length)
    record(
      missing.length === 0 ? "PASS" : "PENDING",
      "ledger records the surfaces you deployed",
      missing.join(", ") || Object.keys(manifest.ledgerKeys ?? {}).join(", ") || "—",
    );
  record("INFO", "surfaces seen in ledger", [...surfaces].join(", ") || "none");

  // ── 8. release tag for pasco diff ─────────────────────────────────────────
  const tag = run("git", ["tag", "-l", "release-*"]);
  record(
    tag.out.trim() ? "PASS" : "PENDING",
    "release-* tag exists (baseline for pasco diff)",
    tag.out.trim() || "none",
  );
} else {
  record("INFO", "workspace has no content/ yet", "nothing to verify until Step 1");
}

const failed = results.filter((r) => r.status === "FAIL");
console.log(
  `\n${results.length} checks · ${results.filter((r) => r.status === "PASS").length} PASS · ${failed.length} FAIL · ${results.filter((r) => r.status === "PENDING").length} PENDING · ${results.filter((r) => r.status === "INFO").length} INFO`,
);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  process.exit(1);
}
