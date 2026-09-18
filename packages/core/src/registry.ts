/**
 * registry.ts — the evidence registry (D17, §18): integrity + checks.
 *
 * Two concerns, two severities:
 *
 * 1. `checkRegistryIntegrity(profile)` — post-Zod contract checks the generated
 *    Zod cannot express (ledger precedent, D12 fail class): duplicate registry
 *    ids, dangling cross-refs (`evidenceItem.credentialId`/`artifactId`,
 *    `publications[]`/`press[]` `artifactRefs`) and the locator XOR (§18.3 —
 *    the JSON Schema keeps the oneOf; required-without-property does not
 *    survive Zod generation). load() throws on any violation.
 *
 *  `registryCheck(profile)` — the §18.8 `pasco check` rules. Offline (no
 *  network, no randomness); deterministic for a given machine date —
 *  `credential-expiry` is a time-keyed warn (reproducible per-day, NOT across
 *  days): warn when `expires` is in the past; `no-private-in-public-output`
 *  (error) when a public-rendered surface — evidence claims — references a
 *  non-public registry entry (§18.5: renderers emit only public, and the leak
 *  check is the gate that enforces it).
 *
 * Naming discipline (§18.1): this module is the REGISTRY. `projects[].evidence[]`
 * stays claims-only — the word evidence never names this layer.
 */

import type { EducationalOccupationalCredentialLd, LoadedProfile, Profile } from "./types.js";

/**
 * The §18.5 visibility rule in ONE place: renderers and structured data emit
 * only `public`, and **absent = public** (the pre-registry profile was public
 * by design — absence must not hide silently). Every consumer of registry
 * visibility (geo JSON-LD, renderers, the leak check) calls this; no private
 * re-implementations of the default.
 */
export function isPublicEntry(entry: { visibility?: string }): boolean {
  return (entry.visibility ?? "public") === "public";
}

/**
 * Canonical JSON-LD mapping (§18.9): public credentials → schema.org
 * `EducationalOccupationalCredential` entries. Single source for every emitter
 * (geoCheck structured data, github-readme JSON-LD) — the shape is the contract.
 */
export function credentialLdEntries(
  credentials: readonly {
    title?: string;
    issuer?: string;
    verifyUrl?: string;
    issued?: string;
    expires?: string;
    visibility?: string;
  }[],
): EducationalOccupationalCredentialLd[] {
  return credentials.filter(isPublicEntry).map((c) => ({
    "@type": "EducationalOccupationalCredential" as const,
    ...(c.title ? { name: c.title } : {}),
    ...(c.verifyUrl !== undefined ? { url: c.verifyUrl } : {}),
    ...(c.issuer ? { awardedBy: { "@type": "Organization" as const, name: c.issuer } } : {}),
    ...(c.issued !== undefined ? { validFrom: c.issued } : {}),
    ...(c.expires !== undefined ? { validThrough: c.expires } : {}),
  }));
}

/** Post-Zod contract violation (load fails on it, D12). */
export interface RegistryIssue {
  path: string;
  message: string;
}

/** §18.8 check finding. `warn` reports; `error` fails `pasco check` (§18.5 leak gate). */
export interface RegistryFinding {
  /** Stable machine-readable code, e.g. `check/credential-expired`. */
  code: string;
  severity: "warn" | "error";
  /** Human-readable explanation in EN (docs convention, D8). */
  message: string;
  /** Dot-path into the profile where the finding lives. */
  path: string;
}

function integrity(path: string, message: string): RegistryIssue {
  return { path, message };
}

/** Registry ids present in a block (entries without id cannot be referenced). */
function idsOf(entries: { id?: string }[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const [index, entry] of (entries ?? []).entries()) {
    if (entry.id === undefined) continue;
    map.set(entry.id, index);
  }
  return map;
}

function duplicateIssues(
  block: "credentials" | "artifacts",
  entries: { id?: string }[] | undefined,
): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const seen = new Map<string, number>();
  for (const [index, entry] of (entries ?? []).entries()) {
    if (entry.id === undefined) continue;
    const first = seen.get(entry.id);
    if (first !== undefined) {
      issues.push(
        integrity(
          `${block}[${index}].id`,
          `duplicate registry id "${entry.id}" (first used at ${block}[${first}]) — registry ids are unique per block (load fails, D12 fail class)`,
        ),
      );
    } else {
      seen.set(entry.id, index);
    }
  }
  return issues;
}

/** locator XOR (§18.3): exactly one of `url` | `path`. The generated Zod drops
 *  the JSON Schema oneOf (required-without-property does not survive generation),
 *  so core re-checks it — ledger precedent. */
function locatorIssues(
  entries: { locator: { url?: string; path?: string } }[] | undefined,
): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  for (const [index, entry] of (entries ?? []).entries()) {
    const hasUrl = entry.locator?.url !== undefined;
    const hasPath = entry.locator?.path !== undefined;
    if (hasUrl === hasPath) {
      issues.push(
        integrity(
          `artifacts[${index}].locator`,
          `locator must have exactly one of "url" | "path" (§18.3 capability matrix) — got ${hasUrl ? "both" : "neither"}`,
        ),
      );
    }
  }
  return issues;
}

/** Dangling cross-ref issues against the credential/artifact id sets. */
function refIssues(profile: Profile): RegistryIssue[] {
  const credentialIds = idsOf(profile.credentials);
  const artifactIds = idsOf(profile.artifacts);
  const issues: RegistryIssue[] = [];

  for (const [pIndex, project] of (profile.projects ?? []).entries()) {
    for (const [eIndex, evidence] of (project.evidence ?? []).entries()) {
      if (evidence.credentialId !== undefined && !credentialIds.has(evidence.credentialId)) {
        issues.push(
          integrity(
            `projects[${pIndex}].evidence[${eIndex}].credentialId`,
            `references credentials[].id "${evidence.credentialId}" which does not exist (dangling cross-ref, load fails)`,
          ),
        );
      }
      if (evidence.artifactId !== undefined && !artifactIds.has(evidence.artifactId)) {
        issues.push(
          integrity(
            `projects[${pIndex}].evidence[${eIndex}].artifactId`,
            `references artifacts[].id "${evidence.artifactId}" which does not exist (dangling cross-ref, load fails)`,
          ),
        );
      }
    }
  }
  for (const [pIndex, pub] of (profile.publications ?? []).entries()) {
    for (const [rIndex, ref] of (pub.artifactRefs ?? []).entries()) {
      if (!artifactIds.has(ref)) {
        issues.push(
          integrity(
            `publications[${pIndex}].artifactRefs[${rIndex}]`,
            `references artifacts[].id "${ref}" which does not exist (dangling cross-ref, load fails)`,
          ),
        );
      }
    }
  }
  for (const [pIndex, press] of (profile.press ?? []).entries()) {
    for (const [rIndex, ref] of (press.artifactRefs ?? []).entries()) {
      if (!artifactIds.has(ref)) {
        issues.push(
          integrity(
            `press[${pIndex}].artifactRefs[${rIndex}]`,
            `references artifacts[].id "${ref}" which does not exist (dangling cross-ref, load fails)`,
          ),
        );
      }
    }
  }
  return issues;
}

/** Post-Zod registry contract: unique ids, resolvable cross-refs, locator XOR. */
export function checkRegistryIntegrity(profile: Profile): RegistryIssue[] {
  return [
    ...duplicateIssues("credentials", profile.credentials),
    ...duplicateIssues("artifacts", profile.artifacts),
    ...locatorIssues(profile.artifacts),
    ...refIssues(profile),
  ];
}

/** Today as YYYY-MM-DD (local machine date — the expiry check is a warn, not a gate). */
function todayIso(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * §18.8 checks — offline (no network, no randomness). Deterministic for a
 * given machine date: `credential-expiry` is keyed to today (time is an INPUT,
 * not a defect — but it is not reproducible across days).
 * - `check/credential-expired` (warn): `expires` in the past.
 * - `check/private-in-public-output` (error, §18.5): a public-rendered surface
 *   (evidence claims — rendered on public platforms) references a credential or
 *   artifact with visibility `private`/`unlisted`. Renderers emit only public;
 *   this is the gate that fails the build on a leak instead of hiding silently.
 */
export function registryCheck(profile: LoadedProfile | Profile): RegistryFinding[] {
  const findings: RegistryFinding[] = [];
  const credentials = profile.credentials ?? [];
  const artifacts = profile.artifacts ?? [];
  const today = todayIso();

  for (const [index, credential] of credentials.entries()) {
    if (credential.expires !== undefined && credential.expires < today) {
      findings.push({
        code: "check/credential-expired",
        severity: "warn",
        message: `credential "${credential.title}" (${credential.id}) expired ${credential.expires} — renew or update the workspace`,
        path: `credentials[${index}]`,
      });
    }
  }

  const nonPublic = (
    id: string | undefined,
    kind: "credentials" | "artifacts",
    list: { id?: string; visibility?: string }[],
  ): { blockPath: string; visibility: string; id: string } | undefined => {
    if (id === undefined) return undefined;
    const entry = list.find((e) => e.id === id);
    // `entry.visibility === undefined` narrows only — the default-public DECISION
    // stays in isPublicEntry (the one §18.5 rule); this line never decides.
    if (entry === undefined || entry.visibility === undefined || isPublicEntry(entry))
      return undefined;
    return { blockPath: `${kind}[${list.indexOf(entry)}]`, visibility: entry.visibility, id };
  };

  const flagLeak = (
    leak: { blockPath: string; visibility: string; id: string } | undefined,
    refPath: string,
    where: string,
  ): void => {
    if (leak === undefined) return;
    findings.push({
      code: "check/private-in-public-output",
      severity: "error",
      message: `${where} references registry entry "${leak.id}" with visibility "${leak.visibility}" — public output renders only public entries (§18.5); make it public or drop the reference`,
      path: refPath,
    });
  };

  for (const [pIndex, project] of (profile.projects ?? []).entries()) {
    for (const [eIndex, evidence] of (project.evidence ?? []).entries()) {
      flagLeak(
        nonPublic(evidence.credentialId, "credentials", credentials),
        `projects[${pIndex}].evidence[${eIndex}].credentialId`,
        "evidence claim attests a credential",
      );
      flagLeak(
        nonPublic(evidence.artifactId, "artifacts", artifacts),
        `projects[${pIndex}].evidence[${eIndex}].artifactId`,
        "evidence claim proves an artifact",
      );
    }
  }
  for (const [pIndex, pub] of (profile.publications ?? []).entries()) {
    for (const [rIndex, ref] of (pub.artifactRefs ?? []).entries()) {
      flagLeak(
        nonPublic(ref, "artifacts", artifacts),
        `publications[${pIndex}].artifactRefs[${rIndex}]`,
        "publication",
      );
    }
  }
  for (const [pIndex, press] of (profile.press ?? []).entries()) {
    for (const [rIndex, ref] of (press.artifactRefs ?? []).entries()) {
      flagLeak(
        nonPublic(ref, "artifacts", artifacts),
        `press[${pIndex}].artifactRefs[${rIndex}]`,
        "press mention",
      );
    }
  }
  return findings;
}
