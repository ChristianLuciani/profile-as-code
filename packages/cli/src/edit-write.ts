/**
 * The single-value writer (S2 of epic #247, issue #249) — the mechanism recorded
 * on 2026-10-21 (`main@647c510`):
 *
 *  1. **range splice** over the ORIGINAL text: the CST locates the scalar (node +
 *     `range` + type + value) and only those bytes are replaced. Comments,
 *     alignment and layout survive BY CONSTRUCTION, and the diff is one line by
 *     construction — no document re-serialization (measured: `String(doc)`
 *     normalizes alignment and flattens block scalars).
 *  2. **block / multi-line scalars are refused** in v1 (`|`, `>`, or a quoted
 *     value carrying a line break): replacing one changes the line count and
 *     breaks the one-line-diff criterion.
 *  3. **no-op = 0 + `noop: true`** — re-setting an identical value is not a write
 *     and not an error; the exit matrix stays 0/1/2.
 *  4. temp file in the SAME directory → `load()` + schema over a temp copy of
 *     `content/` → **atomic rename**. An invalid file never reaches disk.
 *  5. CRLF and the final newline are preserved: only the scalar's byte range is
 *     replaced and the rest of the original text is written back verbatim.
 */

import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LoadError, load } from "@profile-as-code/core";
import { isMap, isScalar, isSeq, parseDocument, type Scalar, stringify } from "yaml";
import { UsageError } from "./contract.js";

/** Where the value lives — the `locate` handle `pasco edit` resolved (FILE
 *  relative, so a CST can resolve it). */
export interface WriteTarget {
  file: string;
  path: (string | number)[];
}

export interface WriteOutcome {
  /** Workspace-relative file that was (or would have been) written. */
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
}

/** Serialize the scalar ALONE (not the document): quoting/escaping are correct
 *  without dragging the rest of the file through the emitter. */
function scalarText(value: string): string {
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
    if (isMap(cursor)) {
      cursor = cursor.get(String(key), true);
    } else if (isSeq(cursor)) {
      if (typeof key !== "number" || key < 0 || key >= cursor.items.length) return undefined;
      cursor = cursor.items[key];
    } else {
      return undefined;
    }
    if (cursor === undefined || cursor === null) return undefined;
  }
  return cursor;
}

/** Refuse every shape whose replacement would move lines or spans — the
 *  recorded decision refuses BOTH block scalars (`|`, `>`) and multi-line
 *  scalars (a plain scalar folded over two lines, or a quoted value carrying a
 *  line break), because replacing one changes the line count and the one-line
 *  diff is the criterion. */
function assertSingleLine(
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
}

/**
 * Replace one scalar in `target.file` with `value`.
 *
 * @throws UsageError — the node cannot be addressed safely (block/multi-line
 *   scalar, missing node, multi-line replacement), exit 2.
 * @throws LoadError — the resulting workspace would NOT validate; the original
 *   file is untouched, exit 1.
 */
export function writeEdit(
  args: { workspace: string; target: WriteTarget; value: string },
  deps: WriteDeps = {},
): WriteOutcome {
  const filePath = join(args.workspace, args.target.file);
  const original = readFileSync(filePath, "utf8");
  // Ranges are present on parsed nodes, and the splice reads the ORIGINAL text
  // (never the document's serialization), so no emitter option is needed.
  const document = parseDocument(original);
  if (document.errors.length > 0) {
    throw new LoadError(
      `${args.target.file}: invalid YAML — ${document.errors[0]?.message ?? "parse error"}`,
    );
  }
  const node = nodeAt(document, args.target.path);
  if (!isScalar(node)) {
    throw new UsageError(
      `cannot locate the scalar at ${args.target.file}:${args.target.path.join(".")} — the file changed since the preview; re-run`,
    );
  }
  assertSingleLine(node, original, args.target.file, args.target.path);

  const before = node.value === null || node.value === undefined ? "" : String(node.value);
  if (before === args.value) return { file: args.target.file, before, noop: true };

  const range = node.range;
  if (range === null || range === undefined) {
    throw new UsageError(
      `${args.target.file}:${args.target.path.join(".")} has no source range — cannot splice it safely`,
    );
  }
  const replacement = scalarText(args.value);
  // [start, valueEnd): the node's own bytes, WITHOUT trailing comment/newline
  // (range[2] is the node end, which includes them).
  const nextText = `${original.slice(0, range[0])}${replacement}${original.slice(range[1])}`;

  // Validate BEFORE touching the real file: a temp copy of `content/` with the
  // new text goes through the same `load()` the CLI uses (schema + ledger +
  // registry integrity), so a broken edit fails here and the original survives.
  const validate = deps.validate ?? ((workspace: string) => void load(workspace));
  const tempWorkspace = mkdtempSync(join(tmpdir(), "pasco-edit-write-"));
  try {
    cpSync(join(args.workspace, "content"), join(tempWorkspace, "content"), { recursive: true });
    writeFileSync(join(tempWorkspace, args.target.file), nextText);
    validate(tempWorkspace);
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true });
  }

  // Atomic replace in the same directory (same filesystem ⇒ rename is atomic).
  const tempFile = join(dirname(filePath), `.pasco-edit-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(tempFile, nextText);
    renameSync(tempFile, filePath);
  } finally {
    rmSync(tempFile, { force: true });
  }
  return { file: args.target.file, before, noop: false };
}
