// A0 — installation verifier (npm @profile-as-code/cli@0.3.0, the published artifact).
// Read-only. Run: node .e2e/verify-install.mjs
//
// Answers, with evidence, the three questions a brand-new user asks after `npm i -g`:
//   1. Is there a `pasco` on PATH, and is it the version I installed?
//   2. Does it work on a fresh, empty workspace (init → validate → build)?
//   3. Does it run against MY workspace without touching it?

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, "manifest.json");
const manifestRaw = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  : {};
// No default personal path (same rule as verify.mjs): PASCO_WS, or the manifest's recorded run.
const WS = process.env.PASCO_WS ?? manifestRaw.workspace?.path;

const out = [];
// Blocked: a precondition this script could not meet (e.g. no `pasco` on PATH yet, so the
// fresh-workspace probes cannot run). Distinct from FAIL — a blocked step is not a verdict.
const rec = (s, name, detail = "") => {
  out.push({ s, name, detail });
  console.log(`${s.padEnd(7)} ${name}${detail ? ` — ${detail}` : ""}`);
};

const sh = (cmd, args = [], opts = {}) => {
  try {
    return {
      code: 0,
      out: execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...opts,
      }),
    };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

// ── 1. what does the *shell* see ────────────────────────────────────────────
const which = sh("/bin/sh", ["-lc", "command -v pasco || true"]);
const onPath = which.out.trim();
rec(
  onPath ? "PASS" : "FAIL",
  "pasco is on PATH (a fresh shell finds it)",
  onPath || "not found — `npm prefix -g`/bin must be on PATH",
);

if (onPath) {
  const v = sh(onPath, ["--version"]);
  rec(
    /pasco 0\.3\.0/.test(v.out) ? "PASS" : "FAIL",
    "the PATH pasco is 0.3.0 (the published version)",
    v.out.trim(),
  );
  // resolution: npm prefix bin must be where the shell found it
  const prefix = sh("npm", ["config", "get", "prefix"]);
  const expected = join(prefix.out.trim(), "bin", "pasco");
  rec(
    existsSync(expected) ? "PASS" : "FAIL",
    "npm global bin exists at `npm prefix -g`/bin",
    expected,
  );
  rec(
    onPath === expected || existsSync(expected) ? "INFO" : "FAIL",
    "PATH resolution",
    `${onPath} vs ${expected}`,
  );
}

// ── 2. fresh workspace, end to end (isolated in /tmp) ──────────────────────
const tmp = mkdtempSync(join(tmpdir(), "pasco-install-"));
if (!onPath) {
  rec(
    "BLOCKED",
    "fresh-workspace probes (init → validate → build)",
    "no pasco on PATH yet — run `npm i -g` first",
  );
  rec("BLOCKED", "real-workspace probe", "same");
} else {
  const pasco = onPath;
  try {
    const init = sh(pasco, ["init", tmp]);
    rec(
      init.code === 0 ? "PASS" : "FAIL",
      "pasco init on an empty folder",
      init.out.split("\n").filter(Boolean).slice(-1)[0] ?? "",
    );
    const val = sh(pasco, ["validate"], { cwd: tmp });
    rec(val.code === 0 ? "PASS" : "FAIL", "fresh workspace validates", `exit ${val.code}`);
    const b = sh(pasco, ["build", "github-readme", "--lang", "en"], { cwd: tmp });
    const art = join(tmp, "profiles", "github-readme", "README.md");
    rec(
      b.code === 0 && existsSync(art) ? "PASS" : "FAIL",
      "fresh workspace builds profiles/github-readme/README.md",
      existsSync(art) ? art : "absent",
    );
    // refusal to overwrite an existing workspace (the documented guard)
    const again = sh(pasco, ["init", tmp]);
    rec(
      again.code !== 0 ? "PASS" : "FAIL",
      "init refuses to overwrite an existing workspace",
      `exit ${again.code}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── 3. the real workspace, read-only ───────────────────────────────────────
  const hash = () => {
    const h = createHash("sha256");
    for (const f of [
      "content/identity.yaml",
      "content/bios.yaml",
      "content/headlines.yaml",
      "content/projects.yaml",
      "content/deployments.yaml",
    ]) {
      const p = join(WS, f);
      if (existsSync(p)) h.update(readFileSync(p));
    }
    return h.digest("hex");
  };
  if (WS === undefined) {
    rec("BLOCKED", "real-workspace probe", "set PASCO_WS=<path to a profile-data workspace>");
  } else {
    const before = existsSync(join(WS, "content")) ? hash() : null;
    const real = sh(pasco, ["validate", "--workspace", WS]);
    rec(
      real.code === 0 ? "PASS" : "FAIL",
      "published CLI validates the real workspace",
      `exit ${real.code}`,
    );
    if (before)
      rec(
        before === hash() ? "PASS" : "FAIL",
        "validate left the workspace byte-identical (no writes)",
        `${before.slice(0, 12)}`,
      );
    rec(
      "INFO",
      "geo line present",
      real.out
        .split("\n")
        .find((l) => /overall score/.test(l))
        ?.trim() ?? "",
    );
  }
}

const failed = out.filter((r) => r.s === "FAIL");
console.log(
  `\n${out.length} checks · ${out.filter((r) => r.s === "PASS").length} PASS · ${failed.length} FAIL · ${out.filter((r) => r.s === "BLOCKED").length} BLOCKED · ${out.filter((r) => r.s === "INFO").length} INFO`,
);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  process.exit(1);
}
