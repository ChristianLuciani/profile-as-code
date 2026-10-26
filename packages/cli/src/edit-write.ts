/**
 * The single-value writer (S2 of epic #247, issue #249) — the mechanism recorded
 * on 2026-10-21 (`main@647c510`):
 *
 *  1. **range splice** over the ORIGINAL text: the CST locates the scalar (node +
 *     `range` + type + value) and only those bytes are replaced. Comments,
 *     alignment and layout survive BY CONSTRUCTION, and the diff is one line by
 *     construction — no document re-serialization (measured: `String(doc)`
 *     normalizes alignment and flattens block scalars).
 *  2. **block / multi-line scalars are refused** in v1 (`|`, `>`, or any scalar
 *     whose SOURCE spans lines): replacing one changes the line count and breaks
 *     the one-line-diff criterion.
 *  3. **anchors and aliases are refused**: rewriting an anchored scalar would
 *     silently change every alias that points at it, and rewriting an alias would
 *     detach it from its anchor.
 *  4. **staleness is checked**: the file's node value must still match what the
 *     caller resolved (`expect`), so a row inserted or reordered between
 *     `load()` and the splice is refused instead of hitting the wrong row.
 *  5. **no-op = 0 + `noop: true`** — re-setting an identical value is not a write
 *     and not an error; the exit matrix stays 0/1/2.
 *  6. temp file in the same directory → `load()` + schema over a temp copy of
 *     `content/` → **atomic rename**. An invalid file never reaches disk, a
 *     symlinked content file keeps its link (the target is replaced), and the
 *     file's mode is preserved.
 *  7. CRLF and the final newline are preserved: only the scalar's byte range is
 *     replaced and the rest of the original text is written back verbatim.
 */

import { randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  cpSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LoadError, load } from "@profile-as-code/core";
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Scalar, stringify } from "yaml";
import { UsageError } from "./contract.js";

/** Where the value lives — the `locate` handle `pasco edit` resolved (FILE
 *  relative, so a CST can resolve it). */
export interface WriteTarget {
  file: string;
  path: (string | number)[];
}

export interface WriteOutcome {
  /** Workspace-relative file that was written. */
  file: string;
  /** The node's value before the write — what the FILE held, not the profile. */
  before: string;
  /** True when the file already held the value: nothing was written. */
  noop: boolean;
}

export interface WriteDeps {
  /** Validation seam. Production = `load()` over a temp copy of `content/`.
   *  Tests inject a throwing validator to pin "an invalid edit never reaches
   *  disk" (the acceptance's forced-invalid fixture). */
  validate?: (workspace: string) => void;
  /** How long to wait for a concurrent `pasco edit` lock before refusing.
   *  Production 2000 ms; tests shorten it. */
  lockWaitMs?: number;
}

/** The advisory lock's path — inside `content/`, dot-prefixed so `load()`'s
 *  `*.yaml` scan ignores it. */
const LOCK_NAME = ".pasco-edit.lock";
const LOCK_STALE_MS = 30_000;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Serialize `pasco edit` writers on ONE workspace. Concurrent `--set` on the
 *  same file is otherwise last-writer-wins: the re-read guard only narrows the
 *  window to the check/rename gap (measured ms on a 2.7 MB workspace, premerge
 *  review of #332 R1). An external editor is still caught by the re-read.
 *  A lock left by a crashed process is broken after 30 s. */
function withWriteLock<T>(workspace: string, waitMs: number, run: () => T): T {
  const lockPath = join(workspace, "content", LOCK_NAME);
  const started = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      } finally {
        closeSync(fd);
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new LoadError(
          `${LOCK_NAME}: could not take the write lock (${(err as NodeJS.ErrnoException).code ?? "error"}) — nothing was written`,
        );
      }
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue; // the holder removed it between our open and stat: retry
      }
      if (Date.now() - started >= waitMs) {
        throw new WriteRefusedError(
          `another pasco edit is writing this workspace (content/${LOCK_NAME}) — retry in a moment`,
        );
      }
      sleep(25);
    }
  }
  try {
    return run();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

/** The address no longer points at the value the caller resolved (a row was
 *  inserted/reordered or the value changed between `load()` and the splice).
 *  NOT a usage error: the command was right and the workspace moved. */
export class StaleEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleEditError";
  }
}

/** The workspace is in a state where the write must not run (a read-only file,
 *  a permission the caller cannot override) — exit 1, never usage. */
export class WriteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteRefusedError";
  }
}

/** Serialize the scalar ALONE (not the document) with `yaml`'s scalar emitter. */
function yamlScalar(value: string): string {
  const dumped = stringify(value);
  const text = dumped.endsWith("\n") ? dumped.slice(0, -1) : dumped;
  if (text.includes("\n")) {
    throw new UsageError(
      "the value would serialize as a multi-line scalar — refused in v1 (#249: a block scalar changes the line count, so the one-line-diff guarantee breaks); pass a single-line value",
    );
  }
  return text;
}

/** Walk the document by the FILE-relative path to the target node. */
function nodeAt(document: ReturnType<typeof parseDocument>, path: (string | number)[]): unknown {
  let cursor: unknown = document.contents;
  for (const key of path) {
    if (isMap(cursor)) cursor = cursor.get(String(key), true);
    else if (isSeq(cursor)) {
      if (typeof key !== "number" || key < 0 || key >= cursor.items.length) return undefined;
      cursor = cursor.items[key];
    } else return undefined;
    if (cursor === undefined || cursor === null) return undefined;
  }
  return cursor;
}

/** Refuse every shape whose replacement would move lines or spans — the
 *  recorded decision refuses BOTH block scalars (`|`, `>`) and multi-line
 *  scalars (a plain scalar folded over two lines, or a quoted value carrying a
 *  line break), because replacing one changes the line count and the one-line
 *  diff is the criterion. */
function assertSpliceable(
  node: Scalar,
  original: string,
  file: string,
  path: (string | number)[],
): void {
  if (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED") {
    throw new UsageError(
      `${file} holds a block scalar (${node.type === "BLOCK_LITERAL" ? "|" : ">"}) at ${path.join(".")} — refused in v1 (#249): a block scalar spans lines, so the replacement would change the line count; rewrite it as a single-line scalar first`,
    );
  }
  const range = node.range;
  const source = range === null || range === undefined ? "" : original.slice(range[0], range[1]);
  if (source.includes("\n") || (typeof node.value === "string" && node.value.includes("\n"))) {
    throw new UsageError(
      `${file} holds a multi-line scalar at ${path.join(".")} — refused in v1 (#249): the replacement would change the line count and break the one-line diff; rewrite it as a single line first`,
    );
  }
  if (node.anchor !== undefined) {
    throw new UsageError(
      `${file}:${path.join(".")} carries a YAML anchor (&${node.anchor}) — rewriting it would silently change every alias that points at it; remove the anchor/aliases first`,
    );
  }
}

/** The scalar at `path`, with the safety checks every caller needs. */
function inspect(
  args: { workspace: string; target: WriteTarget; expect?: string },
  filePath: string,
): { original: string; node: Scalar; before: string } {
  const original = readFileSync(filePath, "utf8");
  const document = parseDocument(original);
  if (document.errors.length > 0) {
    throw new LoadError(
      `${args.target.file}: invalid YAML — ${document.errors[0]?.message ?? "parse error"}`,
    );
  }
  const node = nodeAt(document, args.target.path);
  if (isAlias(node)) {
    throw new UsageError(
      `${args.target.file}:${args.target.path.join(".")} is a YAML alias (*${String(node.source)}) — editing it would detach it from its anchor; edit the anchored scalar instead`,
    );
  }
  if (!isScalar(node)) {
    throw new StaleEditError(
      `${args.target.file}:${args.target.path.join(".")} no longer resolves — the file changed since the address was resolved; re-run`,
    );
  }
  assertSpliceable(node, original, args.target.file, args.target.path);
  try {
    accessSync(filePath, constants.W_OK);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StaleEditError(
        `${args.target.file} disappeared — the file changed since the address was resolved; re-run`,
      );
    }
    throw new WriteRefusedError(
      `${args.target.file} is read-only (the user marked it so) — chmod it to edit, or read it with \`pasco edit <address>\``,
    );
  }
  const before = node.value === null || node.value === undefined ? "" : String(node.value);
  if (args.expect !== undefined && before !== args.expect) {
    throw new StaleEditError(
      `${args.target.file}:${args.target.path.join(".")} now holds ${JSON.stringify(before)}, not ${JSON.stringify(args.expect)} — the file changed since the preview; re-run`,
    );
  }
  return { original, node, before };
}

/** Read-only eligibility check — the PREVIEW runs it too, so `--check` can never
 *  promise a write that `--set` refuses (F1 of the premerge review). */
export function inspectTarget(args: { workspace: string; target: WriteTarget; expect?: string }): {
  before: string;
} {
  return { before: inspect(args, join(args.workspace, args.target.file)).before };
}

/** Every candidate must round-trip through the parser: `yaml`'s scalar emitter
 *  is context-free, so in a flow row (`- {…}`) a plain `a, b` needs quotes. The
 *  JSON form is a legal YAML double-quoted scalar — the fallback, never a guess. */
function splicedText(
  original: string,
  node: Scalar,
  path: (string | number)[],
  value: string,
): string {
  const range = node.range;
  if (range === null || range === undefined) {
    throw new UsageError(
      "the target has no source range — cannot splice it safely (the file uses a shape the CST does not locate)",
    );
  }
  for (const candidate of [yamlScalar(value), JSON.stringify(value)]) {
    const next = `${original.slice(0, range[0])}${candidate}${original.slice(range[1])}`;
    const reparsed = parseDocument(next);
    const check = reparsed.errors.length === 0 ? nodeAt(reparsed, path) : undefined;
    if (isScalar(check) && String(check.value) === value) return next;
  }
  throw new UsageError(
    `the value cannot be spliced into ${path.join(".")} without changing other nodes — refused; rewrite the file by hand`,
  );
}

/**
 * Replace one scalar in `target.file` with `value`.
 *
 * @throws UsageError — the node cannot be addressed safely (block/multi-line
 *   scalar, anchor/alias, multi-line replacement), exit 2.
 * @throws StaleEditError — the file no longer holds `expect`; the edit was
 *   computed against a different workspace, exit 1.
 * @throws LoadError — the resulting workspace would NOT validate (or the temp
 *   write failed); the original file is untouched, exit 1.
 */
export function writeEdit(
  args: { workspace: string; target: WriteTarget; value: string; expect?: string },
  deps: WriteDeps = {},
): WriteOutcome {
  return withWriteLock(args.workspace, deps.lockWaitMs ?? 2_000, () => writeEditLocked(args, deps));
}

function writeEditLocked(
  args: { workspace: string; target: WriteTarget; value: string; expect?: string },
  deps: WriteDeps,
): WriteOutcome {
  const filePath = join(args.workspace, args.target.file);
  const { original, node, before } = inspect(args, filePath);
  if (before === args.value) return { file: args.target.file, before, noop: true };

  const nextText = splicedText(original, node, args.target.path, args.value);

  // Validate BEFORE touching the real file: a temp copy of `content/` with the
  // new text goes through the same `load()` the CLI uses (schema + ledger +
  // registry integrity), so a broken edit fails here and the original survives.
  const validate = deps.validate ?? ((workspace: string) => void load(workspace));
  const tempWorkspace = mkdtempSync(join(tmpdir(), "pasco-edit-write-"));
  try {
    cpSync(join(args.workspace, "content"), join(tempWorkspace, "content"), { recursive: true });
    const copy = join(tempWorkspace, args.target.file);
    // `cpSync` copies the mode; a read-only content file must still be writable
    // in the throwaway copy, and no temp path may leak in an error (rule 9).
    rmSync(copy, { force: true });
    writeFileSync(copy, nextText, { mode: 0o600 });
    validate(tempWorkspace);
  } catch (err) {
    if (err instanceof LoadError) throw err;
    const code = (err as NodeJS.ErrnoException).code ?? "error";
    throw new LoadError(
      `${args.target.file}: the edit could not be validated (${code}) — the file was not modified`,
    );
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true });
  }

  // Re-read IMMEDIATELY before the rename: validation took real time (a temp
  // copy of content/ + load()), and two concurrent `pasco edit --set` on the
  // same file would otherwise both report success and one value would vanish
  // (premerge review of #332, N1). The residual window between this read and the
  // rename is microseconds; there is no portable way to close it further.
  let current: string;
  try {
    current = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new StaleEditError(
      `${args.target.file}: the file disappeared while the edit was being validated — nothing was written; re-run (${(err as NodeJS.ErrnoException).code ?? "error"})`,
    );
  }
  if (current !== original) {
    throw new StaleEditError(
      `${args.target.file}: the file changed while the edit was being validated — nothing was written; re-run`,
    );
  }

  // Atomic replace at the REAL path: a symlinked content file keeps its link
  // (renaming over the link would replace the link), and the mode is preserved.
  let realPath: string;
  try {
    realPath = realpathSync(filePath);
  } catch {
    realPath = filePath;
  }
  let mode: number;
  try {
    mode = statSync(realPath).mode & 0o777;
  } catch (err) {
    throw new StaleEditError(
      `${args.target.file}: the file disappeared before the atomic replace — nothing was written (${(err as NodeJS.ErrnoException).code ?? "error"})`,
    );
  }
  const tempFile = join(dirname(realPath), `.pasco-edit-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(tempFile, nextText, { mode });
    chmodSync(tempFile, mode);
    renameSync(tempFile, realPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "error";
    throw new LoadError(
      `${args.target.file}: could not write (${code}) — the file was not modified`,
    );
  } finally {
    rmSync(tempFile, { force: true });
  }
  return { file: args.target.file, before, noop: false };
}
