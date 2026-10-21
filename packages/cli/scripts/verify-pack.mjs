#!/usr/bin/env node
/**
 * Verify that the packed tarball really exposes the `pasco` bin (issue #43).
 *
 * `npm pack --json` only echoes package.json metadata — it does not tell us
 * whether the bin target actually exists in the tarball, is executable, has a
 * node shebang, or even runs. So we pack a real tarball, extract it, and check:
 *
 *   1. `bin.pasco` points to a file present in the tarball
 *   2. that file is executable (mode bit survives npm pack)
 *   3. that file starts with a node shebang
 *   4. the packed dependency ranges (dependencies, peerDependencies,
 *      optionalDependencies) contain no `workspace:` protocol — unresolvable
 *      for any consumer installing from the registry
 *   5. full-fidelity smoke: the tarball is installed into an isolated prefix
 *      (network, like a real consumer) and the bin npm links at
 *      node_modules/.bin/pasco runs, printing `pasco <version>` — this is
 *      exactly the first-publish acceptance check of the publish issue.
 *
 * Exit 0 = all checks pass, 1 = concrete reason. Run after `pnpm build`.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  throw new Error(`verify-pack FAIL: ${msg}`);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...opts,
  });
}

const tmp = mkdtempSync(join(tmpdir(), "pasco-pack-"));

try {
  if (!existsSync(join(pkgDir, "dist"))) {
    fail("dist/ missing — run `pnpm build` before verify:pack");
  }

  // 1. Pack a real tarball (not --dry-run: we need the on-disk file modes).
  const packed = run("npm", ["pack", "--pack-destination", tmp]).trim().split("\n").pop().trim();
  if (!packed.endsWith(".tgz")) {
    fail(`npm pack did not produce a tarball: ${packed}`);
  }

  // 2. Extract.
  const extractDir = join(tmp, "extracted");
  mkdirSync(extractDir);
  run("tar", ["-xzf", join(tmp, packed), "-C", extractDir], { cwd: tmp });

  const inner = join(extractDir, "package");
  const manifest = JSON.parse(readFileSync(join(inner, "package.json"), "utf8"));

  // 3. bin target exists inside the tarball.
  const binPath = manifest.bin?.pasco;
  if (!binPath) fail('package.json in tarball has no bin entry for "pasco"');
  const binFile = join(inner, normalize(binPath));
  if (!existsSync(binFile)) {
    fail(`bin target "${binPath}" does not exist in the tarball`);
  }

  // 4. Executable bit must survive packing.
  if ((statSync(binFile).mode & 0o111) === 0) {
    fail(`bin target "${binPath}" is not executable (missing +x)`);
  }

  // 5. Node shebang on the first line.
  const firstLine = readFileSync(binFile, "utf8").split("\n")[0];
  if (!firstLine.startsWith("#!")) {
    fail(`bin target "${binPath}" does not start with a shebang: "${firstLine}"`);
  }

  // 6. No workspace: protocol in the ranges consumers actually resolve.
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (String(range).includes("workspace:")) {
        fail(`packed ${field} entry "${name}" uses unresolvable "workspace:" protocol`);
      }
    }
  }

  // 7. Full-fidelity smoke: install the tarball into an isolated prefix
  //    (resolves real dependencies from the registry) and run the bin npm
  //    linked at node_modules/.bin/pasco — mirrors `npm i -g ... && pasco --version`.
  const installDir = join(tmp, "installed");
  mkdirSync(installDir);
  run("npm", ["install", "--prefix", installDir, "--no-audit", "--no-fund", join(tmp, packed)], {
    cwd: installDir,
  });
  const binLink = join(installDir, "node_modules", ".bin", "pasco");
  if (!existsSync(binLink)) {
    fail('npm install of the tarball did not create the "pasco" bin link');
  }
  const out = run(realpathSync(binLink), ["--version"], { cwd: installDir });
  const expected = `pasco ${manifest.version}`;
  if (out.trim() !== expected) {
    fail(`installed bin printed "${out.trim()}", expected "${expected}"`);
  }

  // 8. Platform skills ship in the tarball and resolve from the INSTALLED
  //    package (#253): `refine` must print a real path under the npm prefix,
  //    not the repo-dev layout a user does not have. The tarball also must not
  //    carry a reference to tooling/repos a reader cannot open (#254 C1).
  const packedSkill = join(inner, "skills", "github-readme", "SKILL.md");
  if (!existsSync(packedSkill)) {
    fail('tarball is missing "skills/github-readme/SKILL.md" (files must ship skills/)');
  }
  const workspace = join(pkgDir, "..", "core", "tests", "fixtures", "minimal");
  const refineOut = run(
    realpathSync(binLink),
    ["refine", "github-readme", "--workspace", workspace],
    {
      cwd: installDir,
    },
  );
  const match = refineOut.match(/^Skill \(communicative strategy — READ IT FIRST\): (.+)$/m);
  if (match === null) fail(`installed refine printed no skill line:\n${refineOut}`);
  const skillPath = match[1];
  const installedPkg = realpathSync(join(installDir, "node_modules", "@profile-as-code", "cli"));
  if (!existsSync(skillPath)) {
    fail(`installed refine printed a skill path that does not exist: ${skillPath}`);
  }
  if (!realpathSync(skillPath).startsWith(installedPkg)) {
    fail(`installed refine resolved outside the installed package: ${skillPath}`);
  }
  const noSkillOut = run(realpathSync(binLink), ["refine", "upwork", "--workspace", workspace], {
    cwd: installDir,
  });
  if (!noSkillOut.includes("no skill for upwork yet")) {
    fail(
      `installed refine did not distinguish "no skill for upwork" from "not shipped":\n${noSkillOut}`,
    );
  }
  const helpOut = run(realpathSync(binLink), ["--help"], { cwd: installDir });
  if (/skills-studio|prompt-studio|AGOS\b|project\.sh/.test(helpOut)) {
    fail("installed --help references a repo/tooling the reader cannot open");
  }
  const listOut = run(realpathSync(binLink), ["skills:export", "--list"], { cwd: installDir });
  if (!listOut.includes("github-readme")) {
    fail(`installed skills:export --list does not list the shipped skills:\n${listOut}`);
  }

  console.log(
    `verify-pack PASS: ${packed} exposes bin pasco (${binPath}, executable, shebang, installed smoke "${expected}") + ships skills (${skillPath})`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
