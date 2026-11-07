/**
 * The capture path's write mechanism (D25/S2, issue #496) — `pasco log` appends
 * ONE schema-valid row to `content/achievements.yaml`.
 *
 * It is NOT the `pasco edit` splice (#249): the splice replaces ONE scalar in
 * place, while a capture ADDS a row. Appending is the mechanism that preserves
 * an existing file BY CONSTRUCTION — every byte before the new row is written
 * back verbatim, so comments, layout and alignment survive without ever
 * re-serializing the document (measured: `String(doc)` normalizes alignment).
 *
 *   1. the row is serialized alone (`yaml.stringify`, `lineWidth: 0`) and only
 *      its text is appended; a missing file is created with a header (the
 *      `--create` pattern of #435 — a seed, never an invented fact);
 *   2. a **collision** (declared or derived id) is refused before any write:
 *      capture never overwrites a row;
 *   3. the whole `content/` plus the new text goes through the same `load()` gate
 *      over a temp copy (`validateContentFile`), then the real file is replaced by
 *      an **atomic rename** with its mode preserved;
 *   4. the file is re-read immediately before the rename, so a concurrent writer
 *      is refused (`StaleEditError`) instead of silently lost;
 *   5. the write runs under `content/.pasco-edit.lock`, the SAME lock `pasco edit`
 *      uses — the two writers can never interleave a read/validate/rename pair.
 *
 * A non-empty FLOW-style root (`[ { id: … } ]`) is refused: the capture path
 * appends block rows and never re-serializes a document; rewriting it would move
 * the bytes the comment-preservation promise rests on.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type Achievement, LoadError, load } from "@profile-as-code/core";
import { isSeq, parseDocument, stringify } from "yaml";
import {
  owningFile,
  StaleEditError,
  validateContentFile,
  type WriteDeps,
  WriteRefusedError,
  withWriteLock,
} from "./edit-write.js";

/** The root property the capture path writes. The file name IS the root
 *  property (`load()` matches `content/<root>.ya?ml`, extension case-insensitive). */
const ROOT = "achievements";

/** The header of a file this command creates. It names the block and its two
 *  invariants (one result per row, the status derived) — a seed, never facts. */
const FILE_HEADER = `# The impact log (D24): one row per RESULT — the units it belongs to (refs),
# how it is known (basis) and its visibility. The status is DERIVED
# (planned · measured · achieved · partial); never store it.`;

/**
 * The deterministic id of a row captured without `--id`: the statement + the
 * date. Punctuation and accents become `-`, and a date-less row uses the
 * literal `undated` — so the same statement on the same day derives the same id
 * and a second capture is REFUSED (never an overwrite).
 *
 * `$defs/entryId` is `[a-z0-9][a-z0-9._:-]*`; a statement with no Latin
 * characters derives an empty slug, so that case falls back to a hash of the
 * statement + date (still deterministic and still a valid entry id).
 */
export function deriveAchievementId(statement: string, date?: string): string {
  const slug = statement
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  const suffix = date ?? "undated";
  if (slug.length > 0) return `ach-${slug}-${suffix}`;
  const digest = createHash("sha256").update(`${statement}\n${suffix}`).digest("hex");
  return `ach-${digest.slice(0, 12)}`;
}

/** The YAML block of one row (a sequence item, no leading document markers). */
export function serializeAchievement(achievement: Achievement): string {
  // `lineWidth: 0` keeps every scalar on its own line: a folded plain scalar is
  // valid YAML but makes the appended block harder to read and to diff.
  return stringify([achievement], { lineWidth: 0, indent: 2 });
}

export interface AppendOutcome {
  /** Workspace-relative file the row landed in. */
  file: string;
  /** True when the file did not exist and this write created it. */
  created: boolean;
  /** The row as written. */
  row: Achievement;
}

export interface AppendArgs {
  workspace: string;
  row: Achievement;
}

/** The file that owns the `achievements` root, or the canonical path when the
 *  workspace does not declare it yet. */
export function achievementsFile(workspace: string): string {
  return owningFile(workspace, ROOT) ?? `content/${ROOT}.yaml`;
}

/**
 * Append the row to the workspace's impact log.
 *
 * @throws WriteRefusedError — the id already exists, or the file uses a shape
 *   the append cannot preserve (flow-style root); exit 1, nothing written.
 * @throws StaleEditError — the file changed during validation; exit 1.
 * @throws LoadError — the resulting workspace would not load, or the write
 *   failed; exit 1, the original is untouched.
 */
export function appendAchievement(args: AppendArgs, deps: WriteDeps = {}): AppendOutcome {
  return withWriteLock(args.workspace, deps.lockWaitMs ?? 2_000, () => appendLocked(args, deps));
}

function appendLocked(args: AppendArgs, deps: WriteDeps): AppendOutcome {
  const { workspace, row } = args;
  const profile = load(workspace);
  if (profile.achievements.some((achievement) => achievement.id === row.id)) {
    throw new WriteRefusedError(
      `achievement id "${row.id}" already exists in the impact log — capture never overwrites a row (nothing was written); pass a different --id or a different statement/date`,
    );
  }

  const relative = achievementsFile(workspace);
  const filePath = join(workspace, relative);
  const rowText = serializeAchievement(row);

  let original: string;
  try {
    original = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new LoadError(
        `${relative}: could not read (${(err as NodeJS.ErrnoException).code ?? "error"}) — nothing was written`,
      );
    }
    // A missing root: create it with a header (the #435 seed pattern).
    const text = `${FILE_HEADER}\n${rowText}`;
    validateContentFile({ workspace, file: relative, text }, deps);
    try {
      // `wx` is the O_EXCL refusal: a file that appeared in the validation window
      // is not replaced, it is refused.
      writeFileSync(filePath, text, { mode: 0o644, flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        throw new StaleEditError(
          `${relative} appeared while the row was being validated — nothing was written; re-run`,
        );
      }
      throw new LoadError(
        `${relative}: could not create (${(err as NodeJS.ErrnoException).code ?? "error"}) — nothing was written`,
      );
    }
    return { file: relative, created: true, row };
  }

  const text = appendText(original, rowText, relative);
  validateContentFile({ workspace, file: relative, text }, deps);
  replaceAtomically(filePath, original, text, relative);
  return { file: relative, created: false, row };
}

/** The new file text: the original bytes plus the row block (or the empty flow
 *  sequence replaced by the block rows). */
export function appendText(
  original: string,
  rowText: string,
  file = "content/achievements.yaml",
): string {
  const document = parseDocument(original);
  if (document.errors.length > 0) {
    throw new LoadError(
      `${file}: invalid YAML — ${document.errors[0]?.message ?? "parse error"} (nothing was written)`,
    );
  }
  const contents = document.contents;
  if (contents === null) {
    // Empty or comments-only: every existing byte (the comments) stays, the row
    // follows them.
    if (original.trim().length === 0) return `${FILE_HEADER}\n${rowText}`;
    return `${ensureNewline(original)}${rowText}`;
  }
  if (!isSeq(contents)) {
    throw new WriteRefusedError(
      `${file}: the root is not a sequence — the capture path appends rows to a list (nothing was written)`,
    );
  }
  if (contents.flow) {
    if (contents.items.length > 0) {
      throw new WriteRefusedError(
        `${file}: the root uses FLOW style ([ { … } ]) — the capture path appends block rows and never re-serializes a document (nothing was written); rewrite the file as a block sequence and re-run`,
      );
    }
    const range = contents.range;
    if (range === null || range === undefined) {
      throw new WriteRefusedError(
        `${file}: the empty root has no source range — cannot append safely (nothing was written)`,
      );
    }
    // `range[0]..range[1]` covers `[]`; a trailing comment on the same line is
    // moved onto its own line instead of being glued to the last new scalar.
    const lineEnd = original.indexOf("\n", range[1]);
    const rest = lineEnd === -1 ? original.slice(range[1]) : original.slice(range[1], lineEnd);
    const afterLine = lineEnd === -1 ? "" : original.slice(lineEnd);
    const comment = rest.trim();
    const replacement = `${comment.startsWith("#") ? `  ${comment}\n` : ""}${rowText.trimEnd()}`;
    return `${original.slice(0, range[0])}${replacement}${afterLine}`;
  }
  if (/^\s*\.\.\.\s*$/m.test(original.trimEnd().split("\n").at(-1) ?? "")) {
    throw new WriteRefusedError(
      `${file}: the file ends with a YAML document-end marker (...) — appending would start a second document (nothing was written); remove the marker and re-run`,
    );
  }
  // Block sequence: append after the existing bytes. One blank line separates
  // the new row from the previous one; comments between rows are untouched.
  const withNewline = ensureNewline(original);
  return `${withNewline.endsWith("\n\n") ? withNewline : `${withNewline}\n`}${rowText}`;
}

function ensureNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Validate happened already; re-read, then replace at the REAL path (a
 *  symlinked content file keeps its link) preserving the mode. */
function replaceAtomically(filePath: string, original: string, text: string, file: string): void {
  let realPath: string;
  try {
    realPath = realpathSync(filePath);
  } catch {
    realPath = filePath;
  }
  let current: string;
  try {
    current = readFileSync(realPath, "utf8");
  } catch (err) {
    throw new StaleEditError(
      `${file}: disappeared while the row was being validated — nothing was written (${(err as NodeJS.ErrnoException).code ?? "error"})`,
    );
  }
  if (current !== original) {
    throw new StaleEditError(
      `${file}: changed while the row was being validated — nothing was written; re-run`,
    );
  }
  let mode: number;
  try {
    mode = statSync(realPath).mode & 0o777;
  } catch (err) {
    throw new StaleEditError(
      `${file}: disappeared before the atomic replace — nothing was written (${(err as NodeJS.ErrnoException).code ?? "error"})`,
    );
  }
  const tempFile = join(dirname(realPath), `.pasco-log-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(tempFile, text, { mode });
    chmodSync(tempFile, mode);
    renameSync(tempFile, realPath);
  } catch (err) {
    throw new LoadError(
      `${file}: could not write (${(err as NodeJS.ErrnoException).code ?? "error"}) — the file was not modified`,
    );
  } finally {
    rmSync(tempFile, { force: true });
  }
}
