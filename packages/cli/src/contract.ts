/**
 * Platform/lang/flavor parsing — mirrors the contract enums (core exports
 * PLATFORMS; lang enum is en/es/fr per D8/§11; flavor is person|brand per D15).
 * Usage errors are exit code 2.
 */

import type { Flavor, Lang, Platform } from "@profile-as-code/core";
import { PLATFORMS } from "@profile-as-code/core";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const LANGS: readonly string[] = ["en", "es", "fr"] as const;
const FLAVORS: readonly string[] = ["person", "brand"] as const;

export function parsePlatform(value: string): Platform {
  if ((PLATFORMS as readonly string[]).includes(value)) return value as Platform;
  throw new UsageError(`unknown platform "${value}" (allowed: ${PLATFORMS.join(", ")})`);
}

export function parseLang(value: string): Lang {
  if (LANGS.includes(value)) return value as Lang;
  throw new UsageError(`unknown language "${value}" (allowed: ${LANGS.join(", ")})`);
}

export function parseFlavor(value: string): Flavor {
  if ((FLAVORS as readonly string[]).includes(value)) return value as Flavor;
  throw new UsageError(`unknown flavor "${value}" (allowed: ${FLAVORS.join(", ")})`);
}

export function parseVariants(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new UsageError(`--variants must be a positive integer (got "${value}")`);
  return n;
}
