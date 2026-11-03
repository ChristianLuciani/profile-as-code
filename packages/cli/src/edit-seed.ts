/**
 * `pasco edit --create <root>` — the seed templates (#435).
 *
 * The write is a byte-range splice over EXISTING bytes, so it cannot invent a
 * root: `content/faq.yaml` — the answer-engine surface the product exists to be
 * quoted through — had to be hand-written. `--create` is a DIFFERENT operation
 * (never a rewrite of the splice, #435 ADR-lite): it writes a schema-valid seed
 * for a root the workspace does not declare yet, refuses when the root already
 * exists (idempotent), and validates the result with the same `load()` gate.
 *
 * A seed is a TEMPLATE, not copy: every value is a `<placeholder>` the owner
 * replaces. The engine never invents facts (D11/D14) — an invented answer would
 * be the exact opposite of the citable surface `faq[]` exists to be.
 *
 * Only the roots with a template are seedable. A root whose schema requires
 * user facts (a headline's platform, a bio's length) has no honest seed — the
 * command says so instead of making one up.
 */

import { UsageError } from "./contract.js";

/** The roots `--create` can seed, in the order the usage message prints them. */
export const SEEDABLE_ROOTS = ["faq"] as const;
export type SeedableRoot = (typeof SEEDABLE_ROOTS)[number];

/** The `faq[]` seed's three pairs — the schema floor (`minItems: 3`). Exported so
 *  the template text and the cap pre-flight read the SAME values (one home). */
export const SEED_FAQ_ENTRIES: readonly {
  id: string;
  q: string;
  a: string;
}[] = [
  {
    id: "question-1",
    q: "<the first question this entity answers>",
    a: "<the answer — a fact the owner can defend, not marketing copy>",
  },
  {
    id: "question-2",
    q: "<the second question this entity answers>",
    a: "<the answer — a fact the owner can defend, not marketing copy>",
  },
  {
    id: "question-3",
    q: "<the third question this entity answers>",
    a: "<the answer — a fact the owner can defend, not marketing copy>",
  },
];

const FAQ_SEED_HEADER = `# faq[] — the answer-engine surface (contract v1.10, #288): 3–20 citable
# Q&A pairs. Replace every <placeholder>: the answer is the owner's own
# assertion, never invented copy; \`en\` is required on q and a; a quantitative
# answer should carry a \`source\`.`;

/** The seed text for a seedable root. */
export function seedTemplate(root: SeedableRoot): string {
  if (root === "faq") {
    const rows = SEED_FAQ_ENTRIES.map(
      (entry) => `- id: ${entry.id}\n  q:\n    en: ${entry.q}\n  a:\n    en: ${entry.a}`,
    );
    return `${FAQ_SEED_HEADER}\n${rows.join("\n")}\n`;
  }
  // Exhaustive over SeedableRoot: a new root must add its template here.
  throw new UsageError(`no seed template for "${root}"`);
}

/**
 * Normalize `--create`'s argument to a root name: both `faq` and the file form
 * the issue documents (`content/faq.yaml`, case-insensitive extension) are
 * accepted; anything else — a nested path, an absolute path, an unknown root —
 * is a usage error that names what CAN be seeded.
 */
export function parseCreateRoot(raw: string): SeedableRoot {
  const text = raw.trim();
  const match = /^(?:content\/)?([A-Za-z][A-Za-z0-9]*)(?:\.ya?ml)?$/i.exec(text);
  // `content/faq.yaml` normalizes to `faq`; `faq.yaml` and `content/faq` do too.
  // A path with a directory beyond `content/` never matches (no traversal).
  const root = match?.[1];
  if (root === undefined) {
    throw new UsageError(
      `--create takes a root name or its content file (faq · content/faq.yaml) — got ${JSON.stringify(raw)}`,
    );
  }
  if (!(SEEDABLE_ROOTS as readonly string[]).includes(root)) {
    throw new UsageError(
      `--create has no seed template for "${root}" — seedable roots: ${SEEDABLE_ROOTS.join(", ")}`,
    );
  }
  return root as SeedableRoot;
}
