#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * evidence-gate — staleness of a run-citation is COMPUTABLE, not opinionable (#226, R2).
 *
 * R1 removes the *number* from prose, but a status row still rests on a run:
 * "`pnpm install … && pnpm test` at `<sha>` (`<date>`) → 553 tests, 33 files".
 * That citation is honest only while its anchor describes the present, and the
 * repo had no way to tell. This gate makes the question mechanical, with the
 * three states and the decisions taken in #226's ADR-lite:
 *
 *   fresh        the anchored sha is an ancestor of the reference and no
 *                relevant path changed in `sha..ref`;
 *   stale        reachable, but a relevant path changed after the anchor — the
 *                citation no longer describes the present. **This WARNS.**
 *   unreachable  the sha is unknown here, or no longer an ancestor of the
 *                reference (rebase / force-squash). **This is the only FATAL**:
 *                a citation nobody can resolve is a claim without a source, and
 *                the evidence rule (AGENTS.md §Rules) is a contract.
 *
 * Three decisions, taken (never re-litigated here):
 *   1. anchor = **sha**, never a calendar date — a time-based threshold is
 *      non-deterministic, punishes legitimate old-branch work and turns a gate
 *      into a clock; every other gate in this repo is deterministic + offline;
 *   2. stale is computed from `git`, never judged;
 *   3. `stale` warns, `unreachable` fails — a gate that fails CI for a stale
 *      prose figure pushes people to delete the figure instead of fixing it.
 *
 * Scope: **current-state claims only**. A historical record ("that run's
 * record", `as_of: 9498ed3`) is correct forever and must NOT be marked stale —
 * it is annotated `kind=record` and is only subject to the reachability check.
 * A `kind=current` claim is the live evidence for a status row and goes stale
 * when a RELEVANT path moves. The relevant paths are bound to the CLAIM TYPE:
 * a test count can only move if a package changed; a link census only if a
 * Markdown doc did. Binding them per-type is what keeps the gate from being
 * permanently stale.
 *
 * Honest limits (declared, not hidden):
 *   - the `kind` is DECLARED by the author; the gate does not read the prose and
 *     cannot tell a record from a current claim by itself. A mislabelled claim
 *     silences its own warning — that is a review matter, not a mechanical one;
 *   - the citation's OWN file is excluded from the relevant diff: annotating a
 *     document is not evidence that its subject moved. Without that, a `links`
 *     claim would go stale the moment its own annotation landed;
 *   - a clone without the anchor's history (a shallow checkout) reaches the same
 *     `unreachable` verdict as a rebase. CI checks out with `fetch-depth: 0`
 *     precisely so the two cannot be confused.
 *
 * The corpus is link-check's, REUSED not re-walked: `listMarkdown` is exported
 * by `scripts/link-check/check.mjs`, so the two gates can never disagree on
 * which docs exist. Zero dependencies, node >=22.
 *
 * Usage:  node scripts/evidence-gate/check.mjs [--root DIR] [--ref REF]
 * Exit:   0 no unreachable citation (stale may warn) · 1 unreachable/E-GATE
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listMarkdown, maskCode } from "../link-check/check.mjs";

/** Configuration/shape error: the gate cannot verify what it was asked to verify. */
export class GateError extends Error {}

const ANNOTATION = /<!--\s*evidence:\s*(\S+)\s+as_of=(\S+)\s+kind=(\S+)\s*-->/g;
const MARKER = "<!-- evidence:";
const SHA = /^[0-9a-f]{7,40}$/;
const KINDS = ["record", "current"];

/**
 * The claim-type registry: what a claim of this type is a function of. A change
 * to any of these paths can move the number, so they are the relevant set —
 * bound per type, exactly as #226 requires (otherwise the gate is red forever).
 */
const CLAIM_TYPES = {
  tests: { paths: ["packages"], what: "the test suite counts" },
  links: { paths: ["*.md"], what: "the documentation link census" },
};

const RULES = {
  unreachable: "E-EVIDENCE-UNREACHABLE",
  invalid: "E-GATE",
  stale: "W-EVIDENCE-STALE",
};

const isError = (message) => /^E-[A-Z-]+:/.test(message);

function git(root, args) {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (res.error) throw new GateError(`cannot run git: ${res.error.message}`);
  return { code: res.status, out: `${res.stdout ?? ""}`.trim(), err: `${res.stderr ?? ""}`.trim() };
}

/** The reference the present is read from: `--ref`, else main, else origin/main, else HEAD. */
function reference(root, requested) {
  const candidates = requested === undefined ? ["main", "origin/main", "HEAD"] : [requested];
  for (const candidate of candidates) {
    const res = git(root, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    if (res.code === 0 && res.out.length > 0) return { name: candidate, sha: res.out };
  }
  throw new GateError(`cannot resolve a reference commit (tried ${candidates.join(", ")})`);
}

/**
 * Every `<!-- evidence: … -->` annotation in the link corpus.
 * Malformed annotations are a refusal: a marker the parser cannot read must
 * never be a silent skip (the fail-closed rule every gate here follows).
 * The scan runs over link-check's CODE-MASKED text (one masking definition,
 * reused): a doc may legitimately DOCUMENT this syntax in backticks — as this
 * repo's own `AGENTS.md`/`docs/STANDARDS.md` do — and prose describing a marker
 * must never be mistaken for the marker (or the document could not describe it).
 */
export function collectClaims(root) {
  const claims = [];
  for (const file of listMarkdown(root)) {
    const rel = path.relative(path.resolve(root), file).split(path.sep).join("/");
    const text = readFileSync(file, "utf8");
    if (!text.includes(MARKER)) continue;
    const masked = maskCode(text);
    const consumed = [];
    for (const match of masked.matchAll(ANNOTATION)) {
      const [, type, asOf, kind] = match;
      const line = masked.slice(0, match.index).split("\n").length;
      if (!(type in CLAIM_TYPES)) {
        throw new GateError(
          `${rel}:${line}: unknown evidence type "${type}" (known: ${Object.keys(CLAIM_TYPES).join(", ")})`,
        );
      }
      if (!SHA.test(asOf)) {
        throw new GateError(`${rel}:${line}: as_of="${asOf}" is not a commit sha`);
      }
      if (!KINDS.includes(kind)) {
        throw new GateError(`${rel}:${line}: kind="${kind}" must be one of ${KINDS.join(" | ")}`);
      }
      consumed.push(match[0]);
      claims.push({ where: `${rel}:${line}`, file: rel, type, asOf, kind });
    }
    // Fail-closed: a marker the grammar did not consume is a shape this gate
    // cannot read — never a silent skip (the rule every other gate here follows).
    const leftovers = masked.split(MARKER).length - 1 - consumed.length;
    if (leftovers > 0) {
      throw new GateError(
        `${rel}: ${leftovers} "${MARKER}" annotation(s) do not match \`${MARKER} <type> as_of=<sha> kind=<record|current> -->\``,
      );
    }
  }
  return claims;
}

/**
 * Classify one claim. Returns `{state, reason, paths}`.
 * `paths` lists the relevant files that moved (for a stale verdict).
 */
export function classify(root, claim, refSha) {
  const resolved = git(root, ["rev-parse", "--verify", "--quiet", `${claim.asOf}^{commit}`]);
  if (resolved.code !== 0 || resolved.out.length === 0) {
    return { state: "unreachable", reason: `"${claim.asOf}" is not a commit in this clone` };
  }
  const ancestor = git(root, ["merge-base", "--is-ancestor", resolved.out, refSha]);
  if (ancestor.code !== 0) {
    return {
      state: "unreachable",
      reason: `"${claim.asOf}" is no longer an ancestor of the reference (rebase or force-squash?)`,
    };
  }
  if (claim.kind === "record") {
    return { state: "fresh", reason: "a historical record — correct forever", paths: [] };
  }
  // The citation's OWN file is excluded: annotating a document is not evidence
  // that the document's subject moved. Without this, a `links` claim would go
  // stale the moment its annotation landed — the claim could never be fresh.
  const changed = git(root, [
    "diff",
    "--name-only",
    `${resolved.out}..${refSha}`,
    "--",
    ...CLAIM_TYPES[claim.type].paths,
    `:(exclude)${claim.file}`,
  ]);
  if (changed.code !== 0) {
    throw new GateError(`cannot diff ${claim.asOf}..${refSha}: ${changed.err || changed.code}`);
  }
  const paths = changed.out.length === 0 ? [] : changed.out.split("\n");
  return paths.length === 0
    ? { state: "fresh", reason: `no relevant path changed since ${claim.asOf}`, paths: [] }
    : {
        state: "stale",
        reason: `${paths.length} relevant path(s) changed since ${claim.asOf} (${CLAIM_TYPES[claim.type].what}); re-measure, or annotate it \`kind=record\` if it is a historical citation`,
        paths,
      };
}

async function main() {
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf("--root");
  const refIndex = argv.indexOf("--ref");
  const root =
    rootIndex === -1
      ? fileURLToPath(new URL("../../", import.meta.url))
      : path.resolve(argv[rootIndex + 1] ?? "");
  const requestedRef = refIndex === -1 ? undefined : argv[refIndex + 1];

  try {
    const ref = reference(root, requestedRef);
    if (requestedRef === undefined && ref.name === "HEAD") {
      console.log(
        "note: neither `main` nor `origin/main` resolves here — reading the present from HEAD",
      );
    }
    const claims = collectClaims(root);
    if (claims.length === 0) {
      console.log(`evidence-gate: no claim to check (0 annotation(s) in the corpus)`);
      return;
    }
    const messages = [];
    const states = [];
    for (const claim of claims) {
      const verdict = classify(root, claim, ref.sha);
      states.push(
        `${claim.type}@${claim.asOf}${claim.kind === "record" ? "[record]" : ""}=${verdict.state}`,
      );
      if (verdict.state === "unreachable") {
        messages.push(`${RULES.unreachable}: ${claim.where}: ${verdict.reason}`);
      } else if (verdict.state === "stale") {
        messages.push(`${RULES.stale}: ${claim.where}: ${verdict.reason}`);
      }
    }
    for (const message of messages) console.log(message);
    const fatal = messages.filter(isError);
    console.log(`evidence-gate: ${fatal.length > 0 ? "FAIL" : "in sync"} (${states.join(", ")})`);
    process.exit(fatal.length > 0 ? 1 : 0);
  } catch (error) {
    if (error instanceof GateError) {
      console.log(`${RULES.invalid}: ${error.message}`);
      console.log("evidence-gate: FAIL");
      process.exit(1);
    }
    throw error;
  }
}

/** Direct-execution guard — realpath the invocation path (symlink-safe). */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = entry;
  try {
    resolved = realpathSync(entry);
  } catch {
    // unresolvable path — compare as-is rather than fail closed on a probe
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isMain()) {
  await main();
}
