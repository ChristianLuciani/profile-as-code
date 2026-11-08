/**
 * `pasco migrate` — the schema v2.0 visibility migration (D27, issue #498).
 *
 * Schema v2.0 makes `visibility` optional with **absent = private** on
 * `credentials`, `artifacts`, `projects` and `experience`. A workspace written
 * under the old rule (absent = public) must run this command once so its output
 * does not change: every row that lacks the field gets `visibility: public`.
 * `achievements` keeps the field REQUIRED (v1.16), so it is never touched.
 *
 * The write is a **CST insertion**, not a document re-serialization: the new
 * `visibility: public` line is spliced after the row's last line, so comments,
 * alignment and every existing byte survive by construction (the `pasco edit`
 * precedent). A row that already declares any visibility value is left alone,
 * which is what makes the command idempotent. Before anything reaches disk the
 * whole migrated `content/` goes through the same `load()` gate the CLI uses;
 * then the files are replaced atomically under the shared content write lock.
 *
 * Exit: 0 migrated or already current · 1 load/write failure (nothing written) ·
 * 2 usage.
 */

import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LoadError,
  load,
  missingVisibility,
  PROFILE_SCHEMA_VERSION,
  SchemaValidationError,
  VISIBILITY_BLOCKS,
} from "@profile-as-code/core";
import { isAlias, isMap, isSeq, parseDocument } from "yaml";
import { type ContractFloor, contractFloorAgeOf } from "../contract-history.js";
import { owningFile, StaleEditError, WriteRefusedError, withWriteLock } from "../edit-write.js";
import { EXIT } from "../exit.js";
import { line, report } from "../output.js";

/** One row insertion located in the ORIGINAL text. */
interface Insertion {
  /** Byte offset where `text` is inserted. */
  at: number;
  text: string;
  /** The row's zero-based index inside the block (for the report). */
  row: number;
}

/** A content file with at least one missing visibility. */
export interface VisibilityFileEdit {
  /** Workspace-relative path (`content/credentials.yaml`). */
  file: string;
  original: string;
  text: string;
  rows: number;
  block: (typeof VISIBILITY_BLOCKS)[number];
}

/** A CST node's `[start, valueEnd, nodeEnd]` range, or `null` when absent. */
function rangeOf(node: unknown): [number, number, number] | null {
  if (node === null || typeof node !== "object" || !("range" in node)) return null;
  const range = (node as { range?: [number, number, number] | null }).range;
  return range ?? null;
}

/** The indentation of a block map's keys. The first key may sit on the dash
 *  line (`- id: x`), so the dash is stripped and the remaining indent of the
 *  parent sequence plus two spaces is the key indent. */
function blockIndent(text: string, map: NonNullable<ReturnType<typeof mapOf>>): string {
  const last = map.items[map.items.length - 1];
  const range = rangeOf(last?.key);
  if (range === null) return "  ";
  const lineStart = text.lastIndexOf("\n", range[0] - 1) + 1;
  const prefix = text.slice(lineStart, range[0]);
  const dash = prefix.lastIndexOf("-");
  if (dash !== -1) return `${" ".repeat(dash)}  `;
  return prefix;
}

function mapOf(item: unknown) {
  return isMap(item) ? item : undefined;
}

/** The insertion for ONE row that lacks the field, or `undefined` when the row
 *  already declares visibility (or is not a shape this command can migrate). */
function insertionFor(
  text: string,
  item: unknown,
  row: number,
  file: string,
): Insertion | undefined {
  const map = mapOf(item);
  if (map === undefined) {
    throw new LoadError(
      `${file}: row ${row} is not a mapping — \`pasco migrate\` cannot add a visibility field to it (nothing was written)`,
    );
  }
  if (map.has("visibility")) return undefined;
  const range = map.range;
  if (range === null || range === undefined) {
    throw new LoadError(
      `${file}: row ${row} has no source range — the file uses a shape the CST cannot migrate (nothing was written)`,
    );
  }
  if (map.flow === true) {
    // Flow row (`- { id: x, … }`): insert AFTER the last VALUE, never at the
    // closing brace. A trailing `# comment` before `}` then follows the inserted
    // entry instead of swallowing it, and the existing comma (if any) stays
    // valid after it.
    const last = map.items[map.items.length - 1];
    const lastRange = rangeOf(last?.value) ?? rangeOf(last?.key);
    if (lastRange === null) {
      // Empty flow map: right after the opening brace.
      return { at: range[0] + 1, text: "visibility: public", row };
    }
    return { at: lastRange[1], text: ", visibility: public", row };
  }
  const last = map.items[map.items.length - 1];
  const lastRange = rangeOf(last?.value) ?? rangeOf(last?.key);
  if (lastRange === null) {
    throw new LoadError(
      `${file}: row ${row} has no last-value range — cannot migrate it (nothing was written)`,
    );
  }
  // The CST range end may already be ONE PAST the last byte of the value and
  // the value's own line break may sit at `range[1] - 1` (a block sequence
  // ending in a newline). Start one byte back so the insertion lands at the
  // real end of the row's line, never after the NEXT row's first key.
  const newline = text.indexOf("\n", Math.max(0, lastRange[1] - 1));
  const indent = blockIndent(text, map);
  if (newline === -1) {
    // No final newline: derive the file's convention from the newlines it DOES
    // have, never from the last byte (a CRLF file without a final newline ends
    // with the value, not with `\r`).
    const crlf = (text.match(/\r\n/g) ?? []).length;
    const lf = (text.match(/\n/g) ?? []).length - crlf;
    const eol = crlf > 0 && crlf >= lf ? "\r\n" : "\n";
    return { at: text.length, text: `${eol}${indent}visibility: public`, row };
  }
  // Same EOL as the line being extended: a CRLF file stays CRLF.
  if (newline > 0 && text[newline - 1] === "\r") {
    return { at: newline - 1, text: `\r\n${indent}visibility: public`, row };
  }
  return { at: newline, text: `\n${indent}visibility: public`, row };
}

/** Plan the insertion for one content file. Returns `undefined` when every row
 *  already declares visibility (no write). */
export function planVisibilityFile(
  file: string,
  block: (typeof VISIBILITY_BLOCKS)[number],
  original: string,
): VisibilityFileEdit | undefined {
  const document = parseDocument(original);
  if (document.errors.length > 0) {
    throw new LoadError(
      `${file}: invalid YAML — ${document.errors[0]?.message ?? "parse error"} (nothing was written)`,
    );
  }
  const root = document.contents;
  if (root === null || root === undefined) return undefined;
  if (!isSeq(root)) {
    throw new LoadError(
      `${file}: the root is not a sequence — \`pasco migrate\` only adds visibility to rows (nothing was written)`,
    );
  }
  const insertions: Insertion[] = [];
  const seen = new Set<unknown>();
  for (const [row, item] of root.items.entries()) {
    // `load()` parses with aliases resolved; a `- *anchor` row is a valid map
    // there, so migrate resolves it too. The insertion goes to the ANCHOR map,
    // and `seen` prevents a second one for an alias of the same node.
    const node = isAlias(item) ? item.resolve(document) : item;
    if (node === undefined) {
      throw new LoadError(
        `${file}: row ${row} is an unresolved YAML alias — cannot migrate it (nothing was written)`,
      );
    }
    if (isMap(node)) {
      if (seen.has(node)) continue;
      seen.add(node);
    }
    const insertion = insertionFor(original, node, row, file);
    if (insertion !== undefined) insertions.push(insertion);
  }
  if (insertions.length === 0) return undefined;

  // Apply bottom-up so every offset stays valid.
  let text = original;
  for (const insertion of [...insertions].sort((a, b) => b.at - a.at)) {
    text = `${text.slice(0, insertion.at)}${insertion.text}${text.slice(insertion.at)}`;
  }

  // The splice must still parse, keep the row count, and give every row the
  // field. A mismatch is a bug in the locator, never a silent partial migration.
  const reparsed = parseDocument(text);
  if (reparsed.errors.length > 0) {
    throw new LoadError(
      `${file}: the migrated text does not parse — nothing was written (${reparsed.errors[0]?.message ?? "parse error"})`,
    );
  }
  if (!isSeq(reparsed.contents) || reparsed.contents.items.length !== root.items.length) {
    throw new WriteRefusedError(
      `${file}: the migrated text changed the row count — nothing was written; re-run on a clean file`,
    );
  }
  for (const [row, item] of reparsed.contents.items.entries()) {
    const node = isAlias(item) ? item.resolve(reparsed) : item;
    if (!isMap(node) || !node.has("visibility")) {
      throw new WriteRefusedError(
        `${file}: row ${row} still lacks visibility after the splice — nothing was written`,
      );
    }
  }
  return { file, block, original, text, rows: insertions.length };
}

export interface MigrateOutcome {
  /** Files that were (or would be) written. */
  files: { file: string; rows: number }[];
  /** Total rows given `visibility: public`. */
  rows: number;
}

export interface MigrateDeps {
  /** Validation seam (tests inject a throwing validator). Production: `load()`
   *  over a temp copy of `content/` with every planned file applied. */
  validate?: (workspace: string) => void;
  lockWaitMs?: number;
  /** The effective contract floor. Re-checked INSIDE the write lock: a row that
   *  appears while the command waits is classified under the same floor. */
  contractFloor?: ContractFloor;
}

/** The per-block source files that still carry pre-v2.0 rows. */
export function planVisibilityMigration(workspace: string): VisibilityFileEdit[] {
  const edits: VisibilityFileEdit[] = [];
  for (const block of VISIBILITY_BLOCKS) {
    const file = owningFile(workspace, block);
    if (file === undefined) continue;
    const original = readFileSync(join(workspace, file), "utf8");
    const edit = planVisibilityFile(file, block, original);
    if (edit !== undefined) edits.push(edit);
  }
  return edits;
}

/** The validation gate: every planned file applied to ONE temp copy of
 *  `content/`, through the same `load()` the CLI uses. */
function validateMigration(
  workspace: string,
  edits: readonly VisibilityFileEdit[],
  deps: MigrateDeps,
): void {
  const validate = deps.validate ?? ((path: string) => void load(path));
  const temp = mkdtempSync(join(tmpdir(), "pasco-migrate-"));
  try {
    cpSync(join(workspace, "content"), join(temp, "content"), {
      recursive: true,
      dereference: true,
    });
    for (const edit of edits) {
      const copy = join(temp, edit.file);
      // `cpSync` preserves a symlink; writing through it would mutate the REAL
      // workspace file during validation (before the atomic replace) and a
      // failed validation would claim "nothing written" while already having
      // written. Remove the copied link first — the sibling writer's guard.
      rmSync(copy, { force: true });
      writeFileSync(copy, edit.text, { mode: 0o600 });
    }
    validate(temp);
  } catch (err) {
    if (err instanceof LoadError || err instanceof SchemaValidationError) throw err;
    const code = (err as NodeJS.ErrnoException).code ?? "error";
    throw new LoadError(`the migration could not be validated (${code}) — nothing was written`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Run the migration for one workspace. */
export function migrateVisibility(workspace: string, deps: MigrateDeps = {}): MigrateOutcome {
  return withWriteLock(workspace, deps.lockWaitMs ?? 2_000, () => {
    const edits = planVisibilityMigration(workspace);
    if (edits.length === 0) return { files: [], rows: 0 };

    // Re-evaluate the floor INSIDE the lock, after planning: a row created while
    // the command waited must not be published in a v2.0/INVALID workspace.
    const age = contractFloorAgeOf(deps.contractFloor ?? { declared: null });
    if (age !== "legacy") {
      throw new WriteRefusedError(
        age === "current"
          ? `workspace declares contract ${deps.contractFloor?.declared}; since v2.0 an omitted visibility is the intentional private default — set visibility: public explicitly on the rows you want to publish (nothing was written)`
          : `workspace declares an INVALID contract floor ${JSON.stringify(deps.contractFloor)}; fix .pascorc before migrating — nothing was written`,
      );
    }

    for (const edit of edits) {
      if (edit.original !== readFileSync(join(workspace, edit.file), "utf8")) {
        throw new StaleEditError(
          `${edit.file}: changed while the migration was being planned — nothing was written; re-run`,
        );
      }
    }

    validateMigration(workspace, edits, deps);

    // Re-read IMMEDIATELY before staging: an external edit in the validation
    // window must be refused, never overwritten.
    for (const edit of edits) {
      if (edit.original !== readFileSync(join(workspace, edit.file), "utf8")) {
        throw new StaleEditError(
          `${edit.file}: changed while the migration was being validated — nothing was written; re-run`,
        );
      }
    }

    const staged: { edit: VisibilityFileEdit; temp: string; real: string; mode: number }[] = [];
    const renamed: { edit: VisibilityFileEdit; real: string; mode: number }[] = [];
    try {
      for (const edit of edits) {
        const filePath = join(workspace, edit.file);
        const real = (() => {
          try {
            return realpathSync(filePath);
          } catch {
            return filePath;
          }
        })();
        const mode = statSync(real).mode & 0o777;
        const temp = join(dirname(real), `.pasco-migrate-${process.pid}-${edit.block}.tmp`);
        writeFileSync(temp, edit.text, { mode });
        chmodSync(temp, mode);
        staged.push({ edit, temp, real, mode });
      }
      for (const { edit, temp, real, mode } of staged) {
        renameSync(temp, real);
        renamed.push({ edit, real, mode });
      }
    } catch (err) {
      // A rename that fails midway must not leave a half-migrated workspace:
      // put back the files already replaced, then drop the remaining temps.
      for (const { edit, real, mode } of renamed.reverse()) {
        try {
          writeFileSync(real, edit.original, { mode });
          chmodSync(real, mode);
        } catch {
          // Best effort: the original bytes are still in `edit.original` and the
          // error names the file, so a re-run is deterministic.
        }
      }
      for (const { temp } of staged) rmSync(temp, { force: true });
      const code = (err as NodeJS.ErrnoException).code ?? "error";
      throw new LoadError(`the migration could not be written (${code}) — re-run`);
    }

    return {
      files: edits.map((edit) => ({ file: edit.file, rows: edit.rows })),
      rows: edits.reduce((sum, edit) => sum + edit.rows, 0),
    };
  });
}

export interface MigrateArgs {
  workspace: string;
  /** The effective contract floor (every consulted `.pascorc`, lowest wins). */
  contractFloor?: ContractFloor;
}

export function runMigrate(args: MigrateArgs): number {
  try {
    const outcome = migrateVisibility(args.workspace, {
      contractFloor: args.contractFloor,
    });
    // Validate even when there was nothing to migrate: a workspace that fails
    // `load()` is never "already current" (exit 1, the documented matrix). On a
    // pre-v2.0 workspace this runs AFTER the splice, so the visibility leak the
    // old default caused is resolved before the gate is judged.
    const pending = missingVisibility(load(args.workspace));
    if (outcome.rows === 0) {
      line(
        "no migration needed — every credentials/artifacts/projects/experience row declares visibility",
      );
      return report("migrate", true, EXIT.OK, {
        data: {
          schemaVersion: PROFILE_SCHEMA_VERSION,
          migrated: [],
          rows: 0,
          missing: pending,
        },
      });
    }
    for (const file of outcome.files) line(`migrated ${file.rows} row(s) — ${file.file}`);
    line(
      `schema v2.0: ${outcome.rows} row(s) now declare \`visibility: public\`; new rows default private (D27). Re-run is a no-op.`,
    );
    return report("migrate", true, EXIT.OK, {
      data: {
        schemaVersion: PROFILE_SCHEMA_VERSION,
        migrated: outcome.files,
        rows: outcome.rows,
        missing: pending,
      },
    });
  } catch (err) {
    if (err instanceof StaleEditError || err instanceof WriteRefusedError) {
      return report("migrate", false, EXIT.FAIL, {
        error: { kind: "write", message: err.message },
      });
    }
    if (err instanceof SchemaValidationError) {
      return report("migrate", false, EXIT.FAIL, {
        error: {
          kind: "schema",
          message: `schema validation failed (D12 fail-on-schema) — ${err.issues.length} violation(s)`,
          violations: [...err.issues],
        },
      });
    }
    if (err instanceof LoadError) {
      return report("migrate", false, EXIT.FAIL, {
        error: { kind: "load", message: err.message },
      });
    }
    throw err;
  }
}
