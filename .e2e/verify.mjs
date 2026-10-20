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
const PASCO = join(ENGINE, "packages", "cli", "dist", "index.js");

// The workspace is NOT part of this repo: it is an independent, private profile-data repo.
// No default path (a personal absolute path in the engine repo is a portability bug and a
// privacy hint). Set PASCO_WS, or let the manifest carry it for a recorded run.
const MANIFEST_PATH = join(HERE, "manifest.json");
const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) : {};
const WS = process.env.PASCO_WS ?? manifest.workspace?.path;

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
record(existsSync(PASCO) ? "PASS" : "FAIL", "engine binary present", PASCO);
if (WS === undefined) {
  record("FAIL", "workspace path supplied", "set PASCO_WS=<path to a profile-data workspace>");
  process.exit(1);
}
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
  // Baseline comes from the manifest (measured at run start), never a literal in the script:
  // a hardcoded number makes every later run compare against yesterday's workspace.
  const baselinePct = manifest.baseline?.completeness?.pct;
  const c = run("node", [PASCO, "status", "--completeness"]);
  const m = c.out.match(/(\d+(?:\.\d+)?)% — (\d+)\/(\d+)/);
  if (m && baselinePct !== undefined) {
    record(
      Number(m[1]) >= baselinePct ? "PASS" : "FAIL",
      "completeness not below baseline",
      `${m[1]}% (baseline ${baselinePct}%)`,
    );
  } else if (m) {
    record("INFO", "completeness", `${m[1]}% (no baseline declared in manifest)`);
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
  // Not a FAIL: a workspace may legitimately be EN-only on a surface (this run declared it).
  // The engine's own language rule is the INFO below; this line only reports the shape.
  record("INFO", "en platforms without an es text", missingEs.join(", ") || "none");
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
  // R6: the skills must declare the SAME cap this verifier enforces. The old check searched
  // `new RegExp("headline")` — which matches nearly any prose — so it was tautological.
  const CAP_FIELD = { linkedin: "headline", upwork: "headline", x: "bio" };
  for (const [platform, field] of Object.entries(CAP_FIELD)) {
    const cap = LIMITS[platform]?.[field];
    const skillPath = join(ENGINE, "skills", platform, "SKILL.md");
    const body = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "";
    record(
      existsSync(skillPath) ? "INFO" : "INFO",
      `skills/${platform}/SKILL.md`,
      existsSync(skillPath)
        ? body.includes(String(cap))
          ? `declares the enforced cap (${cap})`
          : `does NOT declare the enforced cap (${cap})`
        : "not present in this engine version",
    );
  }

  // ── 5. link SSOT + markdown validity in renders ───────────────────────────
  const identity = load("identity.yaml") ?? {};
  const ssot = new Set((identity.links ?? []).map((l) => l.url));
  // R2: what the deploy cycle must judge is the PUBLISHED artifact — the active variant when
  // one exists (#238), never the deterministic render. The manifest declares which file that
  // is for this run; with no declaration we fall back to the deterministic render and SAY so.
  const publishedRel = manifest.surface?.published_artifact;
  const artifactRel = publishedRel ?? "profiles/github-readme/README.md";
  const readme = existsSync(join(WS, artifactRel))
    ? readFileSync(join(WS, artifactRel), "utf8")
    : "";
  record(
    "INFO",
    "parity target",
    publishedRel
      ? `${artifactRel} (declared published artifact)`
      : `${artifactRel} (no published_artifact declared — deterministic)`,
  );
  // R1: an empty or trivial render must FAIL, not pass vacuously — a check that green-lights
  // an empty file is worse than no check (it was the one false PASS this verifier produced).
  if (readme.trim().length < 32) {
    record("FAIL", "rendered artifact has content", `${readme.trim().length} chars`);
  } else {
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
    // A raw "(" inside a CommonMark destination invalidates the whole link. The previous
    // pattern matched a PAR inside ITSELF (dest with "(" closed by ")" + ")" of the link), so
    // it could never fire — it reported 0 forever. Bare inline is not this check's domain.
    // CommonMark: an UNENCODED "(" inside a destination makes it ambiguous — GitHub's renderer
    // closes the link early and the rest leaks as text. (A raw ")" always closes it; a BALANCED
    // pair like a_(b) is still outside the spec, and %28/%29 is the fix.) The original check
    // matched a paren pair inside its own pattern, so it could never fire — that is the false
    // PASS this replacement removes.
    const broken = [...readme.matchAll(/\]\(([^)\n]*)\)/g)].filter(
      (m) => !m[1].startsWith("<") && /[()]/.test(m[1].replace(/%28/gi, "").replace(/%29/gi, "")),
    );
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
  }

  // ── 6. live GitHub profile parity (the deploy is byte-identical to the artifact) ──
  const gh = run(
    "gh",
    [
      "api",
      `repos/${manifest.surface?.target_repo ?? "ChristianLuciani/ChristianLuciani"}/readme`,
      "--jq",
      ".content",
    ],
    { cwd: ENGINE },
  );
  if (gh.code === 0) {
    const live = Buffer.from(gh.out.trim(), "base64").toString("utf8");
    const liveSha = createHash("sha256").update(live).digest("hex");
    const artSha = readme ? createHash("sha256").update(readme).digest("hex") : null;
    record(
      liveSha === artSha ? "PASS" : "FAIL",
      `live profile README == ${publishedRel ? "published artifact (variants)" : "workspace artifact"}`,
      `${liveSha.slice(0, 12)} vs ${artSha?.slice(0, 12) ?? "no artifact"}${manifest.surface?.published_sha256_at_run_end ? ` (run declared ${manifest.surface.published_sha256_at_run_end})` : ""}`,
    );
    record(
      /generated by profile-as-code p(asc)?o build/.test(live) ? "PASS" : "INFO",
      "live README carries the generated marker",
      "",
    );
    record(
      /"@type": "Person"/.test(live) ? "PASS" : "FAIL",
      "live README carries schema.org Person JSON-LD (§15.4: @id/entity fields live only in the deterministic render; a prose variant without it is citable-less)",
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
