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
 *   - the relevant paths are an APPROXIMATION of what can move the number, and
 *     both directions are declared in `CLAIM_TYPES`: package READMEs are
 *     excluded (a doc cannot move a test count) and root `package.json` is
 *     excluded (it holds the command the citation already states verbatim), which
 *     trades a possible missed warning for the noise that gets warn-only gates
 *     switched off;
 *   - a clone without the anchor's history (a shallow checkout) reaches the same
 *     `unreachable` verdict as a rebase. CI checks out with `fetch-depth: 0`
 *     precisely so the two cannot be confused;
 *   - the reference is `origin/main` (then `main`, then `HEAD`) and is NAMED in
 *     the verdict. A reference OLDER than the anchor is reported as a warning,
 *     never as `unreachable`: the anchor was not rewritten, the clone simply has
 *     not fetched.
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

const MARKER_RE = /<!--\s*evidence:/gi;
const ANNOTATION = /<!--\s*evidence:\s*(\S+)\s+as_of=(\S+)\s+kind=(\S+)\s*-->/gi;
const SHA = /^[0-9a-f]{7,40}$/;
const KINDS = ["record", "current"];

/**
 * The claim-type registry: what a claim of this type is a function of. A change
 * to any of these paths can move the number, so they are the relevant set —
 * bound per type, exactly as #226 requires (otherwise the gate is red forever).
 *
 * Boundaries, declared (review F7 on #230):
 *   - `:(exclude)*.md` keeps package READMEs OUT of `tests`: a doc edit cannot
 *     move a test count, and counting it produced noise on a warn-only gate.
 *   - root `pnpm-lock.yaml` / `pnpm-workspace.yaml` are IN: a dependency or
 *     workspace-membership change can move the suite, and nothing else at the
 *     root can. Root `package.json` is deliberately OUT — it holds the test
 *     COMMAND, which the citation states verbatim, not the reading; including it
 *     would mark these claims stale from any chore that adds a script.
 */
const CLAIM_TYPES = {
  tests: {
    paths: ["packages", ":(exclude)*.md", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
    what: "the test suite counts",
  },
  links: { paths: ["*.md"], what: "the documentation link census" },
  // #228: the CLI command inventory is a runtime figure of the same class as the
  // others — the enumeration is a reading, not a fact. It is a function of the
  // CLI package's code and manifest; the package's own README is a doc and
  // cannot add a command.
  cli: { paths: ["packages/cli", ":(exclude)*.md"], what: "the CLI command inventory" },
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

/**
 * The reference the present is read from: `--ref`, else `origin/main`, else
 * `main`, else `HEAD`.
 *
 * `origin/main` comes FIRST deliberately (review F4 on #230). A local branch is
 * a working copy that lags between fetches, and preferring it inverted the gate:
 * with a one-commit-behind `main` the same `kind=current` claims reported
 * `fresh` instead of `stale` — a staleness gate silently answering "fine" to the
 * exact question it exists to answer, depending on unrelated local state.
 */
function reference(root, requested) {
  const candidates = requested === undefined ? ["origin/main", "main", "HEAD"] : [requested];
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
 *
 * Detection is derived from the GRAMMAR, never a literal fast path (review F3 on
 * #230): a `text.includes("<!-- evidence:")` guard silently skipped the shapes
 * the grammar accepts (`<!--evidence:` with no space) and case variants, so a
 * `kind=current` claim could go unresolved, undiffed and forever uncatchable —
 * the one thing a fail-closed gate must not do. Every file is scanned, so there
 * is no shape that can be skipped by a cheaper check that disagrees with the
 * expensive one.
 */
export function collectClaims(root) {
  const claims = [];
  let files;
  try {
    files = listMarkdown(root);
  } catch (error) {
    // link-check's walker throws its own class; translate so this gate's
    // refusals stay one vocabulary (review F6 on #230) — a raw stack is not an
    // E-GATE, and the repo's other gates translate this exact error.
    throw new GateError(`cannot read the documentation corpus: ${error.message}`);
  }
  for (const file of files) {
    const rel = path.relative(path.resolve(root), file).split(path.sep).join("/");
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      throw new GateError(`${rel}: cannot read (${error.message})`);
    }
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
    // cannot read — never a silent skip. Counted with the SAME flexible pattern
    // the grammar uses, so "the guard accepts it" and "the parser accepts it"
    // cannot drift apart again.
    const markers = [...masked.matchAll(MARKER_RE)].length;
    if (markers - consumed.length > 0) {
      throw new GateError(
        `${rel}: ${markers - consumed.length} \`<!-- evidence: … -->\` annotation(s) do not match ` +
          "`<!-- evidence: <type> as_of=<sha> kind=<record|current> -->`",
      );
    }
  }
  return claims;
}

/**
 * Classify one claim against a resolved reference. Returns
 * `{state, reason, paths}`; `paths` lists the relevant files that moved.
 *
 * `ref` is the reference OBJECT, not a bare sha, so every message can name the
 * present it actually read — a verdict that hides which ref produced it is
 * unreproducible (review F4 on #230).
 */
export function classify(root, claim, ref) {
  const resolved = git(root, ["rev-parse", "--verify", "--quiet", `${claim.asOf}^{commit}`]);
  if (resolved.code !== 0 || resolved.out.length === 0) {
    return { state: "unreachable", reason: `"${claim.asOf}" is not a commit in this clone` };
  }
  const ancestor = git(root, ["merge-base", "--is-ancestor", resolved.out, ref.sha]);
  if (ancestor.code !== 0) {
    // Two different causes, and conflating them produced a false FATAL: the
    // anchor may have been rewritten (a real `unreachable`), or the REFERENCE
    // may simply be older than the anchor — a clone that has not fetched, where
    // the citation is perfectly verifiable. Only the first is a claim without a
    // source; the second is a stale local view and must never fail the gate.
    const refBehind = git(root, ["merge-base", "--is-ancestor", ref.sha, resolved.out]);
    if (refBehind.code === 0) {
      return {
        state: "stale",
        reason: `the reference \`${ref.name}\` (${ref.sha.slice(0, 7)}) is OLDER than the anchor — the anchor is not on this ref, so nothing was rewritten: \`git fetch\` and re-run`,
        paths: [],
      };
    }
    return {
      state: "unreachable",
      reason: `"${claim.asOf}" is no longer an ancestor of \`${ref.name}\` (${ref.sha.slice(0, 7)}) — rebase or force-squash?`,
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
    `${resolved.out}..${ref.sha}`,
    "--",
    ...CLAIM_TYPES[claim.type].paths,
    `:(exclude)${claim.file}`,
  ]);
  if (changed.code !== 0) {
    throw new GateError(`cannot diff ${claim.asOf}..${ref.name}: ${changed.err || changed.code}`);
  }
  const paths = changed.out.length === 0 ? [] : changed.out.split("\n");
  return paths.length === 0
    ? {
        state: "fresh",
        reason: `no relevant path changed in ${claim.asOf}..${ref.name}`,
        paths: [],
      }
    : {
        state: "stale",
        reason: `${paths.length} relevant path(s) changed in ${claim.asOf}..${ref.name} (${CLAIM_TYPES[claim.type].what}); re-measure, or annotate it \`kind=record\` if it is a historical citation`,
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
        "note: neither `origin/main` nor `main` resolves here — reading the present from HEAD",
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
      const verdict = classify(root, claim, ref);
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
    // The ref is named in EVERY verdict line, not just the fallback: a result
    // that hides the present it read cannot be reproduced or argued with.
    console.log(
      `evidence-gate: ${fatal.length > 0 ? "FAIL" : "in sync"} (ref=${ref.name}@${ref.sha.slice(0, 7)}; ${states.join(", ")})`,
    );
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
