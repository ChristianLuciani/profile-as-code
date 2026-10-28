#!/usr/bin/env node
/**
 * Self-test for the spec-drefs gate (#326) — the `scripts/gen-packages` idiom:
 * prove the gate REFUSES every failure class it claims to close, and that a
 * consistent tree passes. A gate whose tests cannot fail with the defect present
 * is not a test.
 *
 * The trees are synthesized in a temp dir rather than committed as fixtures: the
 * gate's subject IS the register × the prose corpus, so a fixture tree would
 * assert nothing a case name does not already say. Each case breaks exactly one
 * thing. The working tree's real allowlist is NOT used: every fixture declares
 * its own, so the cases stay honest when the register moves.
 *
 * Usage: node scripts/spec-drefs/test.mjs
 * Exit:  0 all cases pass · 1 any case fails
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "check.mjs");

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function write(root, rel, content) {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

const SPEC = `# SPEC

## 5. Decisions (ADR-lite)

| # | Decision | Rationale |
|---|---|---|
| D1 | TypeScript only | x |
| D2 | Text-first YAML | x |

## 6. Data model

The schema is the contract.
`;

/**
 * A synthetic repo root. `docs` and `templates` are `{ "rel/path": content }`,
 * so a case can put a reference exactly where it wants it. The issue-template
 * directory is always present (it is required by the gate), and the allowlist is
 * per tree so the real one cannot leak into a case.
 */
function makeTree({
  readme = "The register is §5; D1 and D2.\n",
  spec = SPEC,
  docs = {},
  templates = { "feature_request.yml": "Check D1 before filing.\n" },
  allowlist = { pendingReferences: [] },
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "spec-drefs-"));
  write(root, "docs/SPEC.md", spec);
  write(root, "README.md", readme);
  write(root, "CONTRIBUTING.md", "");
  write(root, "GOVERNANCE.md", "");
  write(root, "AGENTS.md", "");
  write(root, ".github/pull_request_template.md", "");
  write(root, "scripts/spec-drefs/allowlist.json", JSON.stringify(allowlist, null, 2));
  for (const [rel, content] of Object.entries(docs)) write(root, `docs/${rel}`, content);
  for (const [rel, content] of Object.entries(templates)) {
    write(root, `.github/ISSUE_TEMPLATE/${rel}`, content);
  }
  return root;
}

const roots = [];
function tree(spec) {
  const root = makeTree(spec);
  roots.push(root);
  return root;
}

function run(root, args = []) {
  const res = spawnSync(process.execPath, [GATE, "--root", root, ...args], { encoding: "utf8" });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const PENDING_D23 = {
  pendingReferences: [
    {
      ref: "D23",
      path: "docs/SPEC.md",
      reason: "ratified, row pending (#262)",
      removalTrigger: "#262 adds the row",
    },
  ],
};

try {
  // ── the passing shape ─────────────────────────────────────────────────────
  {
    const root = tree({});
    const res = run(root, ["--check"]);
    check("a consistent tree passes --check", res.code === 0, res.out.trim());
    check(
      "the verdict names the corpus and the register size",
      res.out.includes("3 reference(s)") && res.out.includes("resolve to the 2 §5 row(s)"),
      res.out.trim(),
    );
    const report = run(root);
    check(
      "the default mode prints the per-surface census",
      report.code === 0 && report.out.includes("README.md: 2 reference(s)"),
      report.out.trim(),
    );
  }

  // ── the #315/#326 shape: a reference with no row ──────────────────────────
  {
    const root = tree({ readme: "Read the decisions.\n\nSee D9 for details.\n" });
    const res = run(root, ["--check"]);
    check(
      "a dangling reference refuses with file:line and the ref",
      res.code === 1 &&
        res.out.includes("README.md:3 → D9") &&
        res.out.includes("do not resolve to a `| D<n> |` row"),
      res.out.trim(),
    );
  }
  {
    const root = tree({
      docs: { "build/01-core-build.md": "# Build\n\nSPEC (decisions D1–D18).\n" },
    });
    const res = run(root, ["--check"]);
    check(
      "a nested docs/ file is in scope",
      res.code === 1 && res.out.includes("docs/build/01-core-build.md:3"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ templates: { "feature_request.yml": "Check docs/SPEC.md (D9) first.\n" } });
    const res = run(root, ["--check"]);
    check(
      "an issue template is in scope",
      res.code === 1 && res.out.includes(".github/ISSUE_TEMPLATE/feature_request.yml:1 → D9"),
      res.out.trim(),
    );
  }
  {
    const spec = SPEC.replace("The schema is the contract.", "D9 is discussed here.");
    const root = tree({ spec });
    const res = run(root, ["--check"]);
    check(
      "the register file itself is scanned (a dangling ref outside §5 refuses)",
      res.code === 1 && res.out.includes("docs/SPEC.md:12 → D9"),
      res.out.trim(),
    );
  }

  // ── the drift class itself: a typed extent ────────────────────────────────
  {
    const root = tree({ readme: "Decisions D1–D2 are settled.\n" });
    const res = run(root, ["--check"]);
    check(
      "an en-dash range refuses as a re-typed extent",
      res.code === 1 &&
        res.out.includes("README.md:1 → D1–D2") &&
        res.out.includes("re-type the register extent"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ templates: { "feature_request.yml": "First check D1-D2, then file.\n" } });
    const res = run(root, ["--check"]);
    check(
      "an ASCII-hyphen range refuses too (the sweep regex shape)",
      res.code === 1 && res.out.includes("D1-D2"),
      res.out.trim(),
    );
  }

  // ── scope boundaries: historical records and projected copies are OUT ─────
  {
    const root = tree({});
    write(root, "CHANGELOG.md", "- Old release (D1–D14 resolved). See D99.\n");
    const res = run(root, ["--check"]);
    check("CHANGELOG is out of scope (a dated record, rule 8)", res.code === 0, res.out.trim());
  }

  // ── the declared pending channel ──────────────────────────────────────────
  {
    const spec = SPEC.replace(
      "The schema is the contract.",
      "D23 is ratified; its row is pending.",
    );
    const root = tree({ spec, allowlist: PENDING_D23 });
    const res = run(root, ["--check"]);
    check("a declared pending ref in its declared file passes", res.code === 0, res.out.trim());
  }
  {
    const spec = SPEC.replace(
      "The schema is the contract.",
      "D23 is ratified; its row is pending.",
    );
    const root = tree({ spec, readme: "Presence is D23.\n", allowlist: PENDING_D23 });
    const res = run(root, ["--check"]);
    check(
      "a pending declaration is scoped to its file — the same ref elsewhere still fails",
      res.code === 1 && res.out.includes("README.md:1 → D23"),
      res.out.trim(),
    );
  }
  {
    const allowlist = {
      pendingReferences: [
        {
          ref: "D9",
          path: "docs/SPEC.md",
          reason: "x",
        },
      ],
    };
    const root = tree({ allowlist });
    const res = run(root, ["--check"]);
    check(
      "an entry without a removal trigger refuses (the registry cannot rot)",
      res.code === 1 && res.out.includes("`removalTrigger` is required"),
      res.out.trim(),
    );
  }
  {
    const allowlist = {
      pendingReferences: [
        {
          ref: "D9",
          path: "notes/D9.md",
          reason: "x",
          removalTrigger: "y",
        },
      ],
    };
    const root = tree({ allowlist });
    const res = run(root, ["--check"]);
    check(
      "an entry outside the scanned scope refuses",
      res.code === 1 && res.out.includes("outside the scanned scope"),
      res.out.trim(),
    );
  }
  {
    const root = tree({ allowlist: PENDING_D23 });
    const res = run(root, ["--check"]);
    check(
      "an unused pending entry warns without failing (exit 0)",
      res.code === 0 && res.out.includes("W-ALLOWLIST-UNUSED: D23 in docs/SPEC.md"),
      res.out.trim(),
    );
  }
  {
    const allowlist = {
      pendingReferences: [
        {
          ref: "D1",
          path: "README.md",
          reason: "was pending",
          removalTrigger: "the row landed",
        },
      ],
    };
    const root = tree({ allowlist });
    const res = run(root, ["--check"]);
    check(
      "a pending entry whose row now exists warns as stale (exit 0)",
      res.code === 0 && res.out.includes("W-ALLOWLIST-STALE: D1 now has a §5 row"),
      res.out.trim(),
    );
  }

  // ── unreadable subjects ───────────────────────────────────────────────────
  {
    const spec = "# SPEC\n\n## 6. Data model\n\nno register here\n";
    const root = tree({ spec });
    const res = run(root, ["--check"]);
    check(
      "a SPEC without the §5 section refuses",
      res.code === 1 && res.out.includes('missing the "## 5. Decisions" section'),
      res.out.trim(),
    );
  }
  {
    const spec =
      "# SPEC\n\n## 5. Decisions (ADR-lite)\n\n| # | Decision | Rationale |\n|---|---|---|\n\n## 6. Data model\n";
    const root = tree({ spec });
    const res = run(root, ["--check"]);
    check(
      "a §5 with no register rows refuses (nothing to resolve against)",
      res.code === 1 && res.out.includes("lists no `| D<n> |` row"),
      res.out.trim(),
    );
  }
  {
    const root = tree({});
    rmSync(join(root, "scripts/spec-drefs/allowlist.json"));
    const res = run(root, ["--check"]);
    check(
      "a missing allowlist refuses (fail closed, never a silent empty registry)",
      res.code === 1 && res.out.includes("cannot read scripts/spec-drefs/allowlist.json"),
      res.out.trim(),
    );
  }

  // ── the placeholder must not be read as a reference ───────────────────────
  {
    const root = tree({ readme: "Every `D<n>` in scope is checked; D1 is defined.\n" });
    const res = run(root, ["--check"]);
    check("a `D<n>` placeholder is not a reference", res.code === 0, res.out.trim());
  }

  // ── symlinked invocation must still run (fail-open guard, dep-gate idiom) ──
  {
    const root = tree({});
    const linkedDir = mkdtempSync(join(tmpdir(), "spec-drefs-link-"));
    roots.push(linkedDir);
    const via = join(linkedDir, "check.mjs");
    symlinkSync(GATE, via, "file");
    const res = spawnSync(process.execPath, [via, "--root", root, "--check"], {
      encoding: "utf8",
    });
    check(
      "the gate runs through a symlinked path (no silent no-op)",
      res.status === 0 && res.stdout.includes("spec-drefs: in sync"),
      `status=${res.status} ${res.stdout}${res.stderr}`,
    );
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

for (const failure of failures) console.log(`FAIL: ${failure}`);
console.log(`spec-drefs self-test: ${passed}/${passed + failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
