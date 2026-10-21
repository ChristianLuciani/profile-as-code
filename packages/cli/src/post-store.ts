/**
 * Post store — the seed → projection ledger (post MVP, week 1).
 *
 * A seed is the canonical unit (`posts/<id>/seed.md`); each channel projection
 * is a variant (`posts/<id>/<channel>/<variant>.md`) and the ledger
 * (`posts/<id>/post.yaml`) records the choice + the two publish axes:
 *
 *   sync:          local-only | published | diverged | deleted-remote
 *   certification: verified | attested | unverifiable
 *
 * The store is deliberately OUTSIDE `content/` and outside the profile schema:
 * a post is an event/projection, not an identity fact, and it must never enter
 * `artifacts[]` (D17 is immutable-work scoped). Only this module writes it.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, stringify } from "yaml";

export type PostSyncState = "local-only" | "published" | "diverged" | "deleted-remote";
export type PostCertification = "verified" | "attested" | "unverifiable";
export type PostSource = "authored" | "imported";

export interface PostChannelState {
  chosen?: string;
  chosenAt?: string;
  /** SHA-256 of the PUBLISHED bytes (facts rendered), not the template. */
  contentHash?: string;
  /** SHA-256 of the variant template as written (may contain {{fact:...}}). */
  templateHash?: string;
  publishedAt?: string | null;
  url?: string | null;
  sync?: PostSyncState;
  certification?: PostCertification;
}

export interface PostLedger {
  id: string;
  createdAt: string;
  source: PostSource;
  seed: string;
  status: "draft" | "published" | "archived";
  channels: Record<string, PostChannelState>;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A seed id is a single, traversal-free path segment. */
export function isSafeSeedId(id: string): boolean {
  return SAFE_ID.test(id) && !id.includes("..");
}

export function postsDir(workspace: string): string {
  return join(workspace, "posts");
}

export function seedDir(workspace: string, id: string): string {
  if (!isSafeSeedId(id)) throw new Error(`unsafe seed id ${JSON.stringify(id)}`);
  return join(postsDir(workspace), id);
}

export function seedPath(workspace: string, id: string): string {
  return join(seedDir(workspace, id), "seed.md");
}

export function ledgerPath(workspace: string, id: string): string {
  return join(seedDir(workspace, id), "post.yaml");
}

export function variantPath(
  workspace: string,
  id: string,
  channel: string,
  variant: string,
): string {
  if (!SAFE_ID.test(variant) || variant.includes("..")) {
    throw new Error(`unsafe variant id ${JSON.stringify(variant)}`);
  }
  return join(seedDir(workspace, id), channel, `${variant}.md`);
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function defaultLedger(id: string, source: PostSource): PostLedger {
  return {
    id,
    createdAt: new Date().toISOString(),
    source,
    seed: "seed.md",
    status: "draft",
    channels: {},
  };
}

/** Read a ledger. A missing ledger is an error for read paths; createSeed writes one. */
export function readLedger(workspace: string, id: string): PostLedger {
  const path = ledgerPath(workspace, id);
  if (!existsSync(path)) throw new Error(`no post ledger at ${path}`);
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.errors.length > 0) {
    throw new Error(`${path}: invalid YAML — ${doc.errors[0]?.message ?? "parse error"}`);
  }
  const raw = doc.toJS({ maxAliasCount: 100 }) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path} must contain a mapping`);
  }
  const obj = raw as Record<string, unknown>;
  const channelsRaw = obj.channels;
  const channels: Record<string, PostChannelState> =
    channelsRaw !== null && typeof channelsRaw === "object" && !Array.isArray(channelsRaw)
      ? (channelsRaw as Record<string, PostChannelState>)
      : {};
  return {
    id: typeof obj.id === "string" ? obj.id : id,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
    source: obj.source === "imported" ? "imported" : "authored",
    seed: typeof obj.seed === "string" ? obj.seed : "seed.md",
    status:
      obj.status === "published" || obj.status === "archived" ? obj.status : ("draft" as const),
    channels,
  };
}

export function writeLedger(workspace: string, ledger: PostLedger): void {
  const dir = seedDir(workspace, ledger.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(ledgerPath(workspace, ledger.id), stringify(ledger));
}

export function seedText(workspace: string, id: string): string {
  const path = seedPath(workspace, id);
  if (!existsSync(path)) throw new Error(`no seed at ${path}`);
  return readFileSync(path, "utf8");
}

/** Create a seed if it does not exist. Existing seeds are never overwritten. */
export function createSeed(
  workspace: string,
  id: string,
  text: string,
  source: PostSource = "authored",
): PostLedger {
  if (!isSafeSeedId(id)) throw new Error(`unsafe seed id ${JSON.stringify(id)}`);
  const dir = seedDir(workspace, id);
  mkdirSync(dir, { recursive: true });
  const seed = seedPath(workspace, id);
  if (!existsSync(seed)) writeFileSync(seed, text);
  const ledgerFile = ledgerPath(workspace, id);
  if (existsSync(ledgerFile)) return readLedger(workspace, id);
  const ledger = defaultLedger(id, source);
  writeLedger(workspace, ledger);
  return ledger;
}

export function listSeedIds(workspace: string): string[] {
  const dir = postsDir(workspace);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory() && isSafeSeedId(name);
      } catch {
        return false;
      }
    })
    .sort();
}

export interface ChooseResult {
  ledger: PostLedger;
  path: string;
  contentHash: string;
  templateHash: string;
}

/** Record the chosen variant for a channel. The body must already exist.
 *  `publishedText` is the fact-rendered text the platform will receive; when
 *  omitted (legacy callers), the template is hashed as the published bytes. */
export function chooseVariant(
  workspace: string,
  id: string,
  channel: string,
  variant: string,
  publishedText?: string,
): ChooseResult {
  const path = variantPath(workspace, id, channel, variant);
  if (!existsSync(path)) throw new Error(`no variant body at ${path}`);
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") throw new Error(`variant body is empty at ${path}`);
  const ledger = readLedger(workspace, id);
  const templateHash = hashText(text);
  const contentHash = hashText(publishedText ?? text);
  const chosenAt = new Date().toISOString();
  ledger.channels[channel] = {
    ...(ledger.channels[channel] ?? {}),
    chosen: variant,
    chosenAt,
    contentHash,
    templateHash,
    sync: "local-only",
    certification: "unverifiable",
  };
  ledger.status = "draft";
  writeLedger(workspace, ledger);
  return { ledger, path, contentHash, templateHash };
}

/** Read the chosen variant body, or undefined when the channel has no choice. */
export function chosenVariant(
  workspace: string,
  ledger: PostLedger,
  channel: string,
): { variant: string; text: string; path: string } | undefined {
  const chosen = ledger.channels[channel]?.chosen;
  if (chosen === undefined) return undefined;
  const path = variantPath(workspace, ledger.id, channel, chosen);
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  return { variant: chosen, text, path };
}
