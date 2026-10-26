/**
 * M7 evidence core (D17, §18) — registry integrity + checks + JSON-LD payoff.
 *
 * Integrity (load, D12 fail class): duplicate ids, dangling cross-refs, locator
 * XOR — the checks the generated Zod cannot express (same precedent as the
 * ledger's post-Zod re-checks). Checks (§18.8, offline/deterministic):
 * `credential-expiry` (warn) and `no-private-in-public-output` (error).
 *
 * Workspace convention (schema/README.md): the file NAME is the root property —
 * `credentials.yaml` holds the bare list, no root key inside the file.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, geoCheck, load, SchemaValidationError } from "../src/index.js";
import { registryCheck } from "../src/registry.js";

const IDENTITY =
  "name: Elena Vasquez\nlinks:\n  - label: GitHub\n    url: https://github.com/elena\n";

const CREDENTIAL = `- id: cert-aws-ml
  kind: certificate
  title: AWS Certified ML - Specialty
  issuer: Amazon Web Services
  credentialId: ML-S-1234
  verifyUrl: https://aws.amazon.com/verification/cert-aws-ml
  issued: '2024-05-01'
  expires: '2027-05-01'
  visibility: public
`;

const ARTIFACT = `- id: reel-2025
  kind: showreel
  title: Reel 2025
  description:
    en: Selected work 2025.
    es: Trabajo seleccionado 2025.
  locator:
    url: https://vimeo.com/reel2025
  license: CC-BY-4.0
  tags: [film]
  visibility: public
`;

/** A second credential list item (same shape, new id) to append to CREDENTIAL. */
function secondCredential(id: string, overrides: Record<string, string> = {}): string {
  const body = `- id: ${id}
  kind: certificate
  title: Second Cert
  issuer: Other Issuer
  verifyUrl: https://example.com/verify/${id}
  issued: '2024-05-01'
  expires: '2027-05-01'
  visibility: public
`;
  const lines = body.split("\n").map((line) => {
    let out = line;
    for (const [key, value] of Object.entries(overrides)) {
      if (out.startsWith(`  ${key}:`)) out = `  ${key}: ${value}`;
    }
    return out;
  });
  return `${lines.join("\n")}\n`;
}

/** A second artifact list item (same shape, new id) to append to ARTIFACT. */
function secondArtifact(id: string, overrides: Record<string, string> = {}): string {
  const body = `- id: ${id}
  kind: document
  title: Second Work
  locator:
    url: https://example.com/works/${id}
  visibility: public
`;
  const lines = body.split("\n").map((line) => {
    let out = line;
    for (const [key, value] of Object.entries(overrides)) {
      if (out.startsWith(`  ${key}:`)) out = `  ${key}: ${value}`;
    }
    return out;
  });
  return `${lines.join("\n")}\n`;
}

/** A public project whose single evidence claim references registry ids. */
function projectWithEvidence(credentialId?: string, artifactId?: string): string {
  return `- name: Demo
  status: active
  evidence:
    - claim:
        en: I hold the cert and shipped the reel.
      source: https://example.com/proof
${credentialId !== undefined ? `      credentialId: ${credentialId}\n` : ""}${artifactId !== undefined ? `      artifactId: ${artifactId}\n` : ""}`;
}

function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pasco-registry-"));
  mkdirSync(join(dir, "content"), { recursive: true });
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(dir, "content", name), body, "utf8");
  return dir;
}

/** load() expecting a schema failure; returns the violation paths. */
function loadFail(files: Record<string, string>): string[] {
  const dir = makeWorkspace(files);
  try {
    load(dir);
  } catch (err) {
    if (err instanceof SchemaValidationError) return err.issues.map((i) => i.path);
    throw err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return [];
}

describe("registry integrity (load, D12 fail class)", () => {
  it("loads a registry workspace and normalizes the new blocks", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "credentials.yaml": CREDENTIAL,
        "artifacts.yaml": ARTIFACT,
      }),
    );
    expect(profile.credentials).toHaveLength(1);
    expect(profile.credentials[0]?.title).toBe("AWS Certified ML - Specialty");
    expect(profile.artifacts).toHaveLength(1);
    expect(profile.artifacts[0]?.locator.url).toBe("https://vimeo.com/reel2025");
  });

  it("normalizes absent registry blocks to empty arrays", () => {
    const dir = makeWorkspace({ "identity.yaml": IDENTITY });
    try {
      const profile = load(dir);
      expect(profile.credentials).toEqual([]);
      expect(profile.artifacts).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on duplicate credential ids", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "credentials.yaml": `${CREDENTIAL}${secondCredential("cert-aws-ml")}`,
    });
    expect(paths.some((p) => p.includes("credentials"))).toBe(true);
  });

  it("fails on duplicate artifact ids", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "artifacts.yaml": `${ARTIFACT}${secondArtifact("reel-2025")}`,
    });
    expect(paths.some((p) => p.includes("artifacts"))).toBe(true);
  });

  it("fails on a dangling evidence credentialId", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "projects.yaml": projectWithEvidence("cert-nope"),
    });
    expect(paths.some((p) => p.includes("credentialId"))).toBe(true);
  });

  it("fails on a dangling evidence artifactId", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "projects.yaml": projectWithEvidence(undefined, "reel-nope"),
    });
    expect(paths.some((p) => p.includes("artifactId"))).toBe(true);
  });

  it("fails on dangling artifactRefs in publications", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "publications.yaml": `- title: Paper
  venue: Venue
  year: 2024
  artifactRefs: [reel-nope]
`,
    });
    expect(paths.some((p) => p.includes("artifactRefs"))).toBe(true);
  });

  it("fails on dangling artifactRefs in press", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "press.yaml": `- outlet: News
  title:
    en: Mention
  url: https://news.example.com/story
  date: '2024-06-01'
  artifactRefs: [reel-nope]
`,
    });
    expect(paths.some((p) => p.includes("artifactRefs"))).toBe(true);
  });

  it("fails on dangling artifactRefs in projects (v1.12, #333 — the third ref site)", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "projects.yaml": `- name: Demo
  status: active
  artifactRefs: [reel-nope]
`,
    });
    expect(paths.some((p) => p.includes("projects") && p.includes("artifactRefs"))).toBe(true);
  });

  it("rejects a non-list artifactRefs at the schema boundary (v1.12, #333)", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "projects.yaml": `- name: Demo
  artifactRefs: reel-2025
`,
    });
    expect(paths.some((p) => p.includes("artifactRefs"))).toBe(true);
  });

  it("resolves project artifactRefs to a public artifact (edge kept, no issue raised)", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "artifacts.yaml": ARTIFACT,
        "projects.yaml": `- name: Demo
  status: active
  artifactRefs: [reel-2025]
`,
      }),
    );
    expect(profile.projects?.[0]?.artifactRefs).toEqual(["reel-2025"]);
    expect(registryCheck(profile)).toEqual([]);
  });

  it("fails when a locator has both url and path (XOR)", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "artifacts.yaml": `- id: dual-loc
  kind: document
  title: Dual
  locator:
    url: https://example.com/works/dual
    path: media/certificates/dual
`,
    });
    expect(paths.some((p) => p.includes("locator"))).toBe(true);
  });

  it("fails when a locator has neither url nor path", () => {
    const paths = loadFail({
      "identity.yaml": IDENTITY,
      "artifacts.yaml": `- id: empty-loc
  kind: document
  title: Empty
  locator: {}
`,
    });
    expect(paths.some((p) => p.includes("locator"))).toBe(true);
  });
});

describe("registryCheck (§18.8, offline/deterministic)", () => {
  it("warns when a credential is expired (credential-expiry)", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "credentials.yaml": CREDENTIAL.replace("'2027-05-01'", "'2020-01-01'"),
      }),
    );
    const issues = registryCheck(profile);
    expect(issues.some((i) => i.code === "check/credential-expired" && i.severity === "warn")).toBe(
      true,
    );
  });

  it("does not warn for a live or open-ended credential", () => {
    const profile = load(
      makeWorkspace({ "identity.yaml": IDENTITY, "credentials.yaml": CREDENTIAL }),
    );
    const issues = registryCheck(profile);
    expect(issues.some((i) => i.code === "check/credential-expired")).toBe(false);
  });

  it("errors when public evidence references a private credential (no-private-in-public-output)", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "credentials.yaml": `${CREDENTIAL}${secondCredential("cert-private", { visibility: "private" })}`,
        "projects.yaml": projectWithEvidence("cert-private"),
      }),
    );
    const issues = registryCheck(profile);
    const leak = issues.find((i) => i.code === "check/private-in-public-output");
    expect(leak?.severity).toBe("error");
  });

  it("errors when a press mention references an unlisted artifact (leak gate covers press too)", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "artifacts.yaml": `${ARTIFACT}${secondArtifact("work-unlisted", { visibility: "unlisted" })}`,
        "press.yaml": `- outlet: News
  title:
    en: Mention
  url: https://news.example.com/story
  date: '2024-06-01'
  artifactRefs: [work-unlisted]
`,
      }),
    );
    const issues = registryCheck(profile);
    const leak = issues.find((i) => i.code === "check/private-in-public-output");
    expect(leak?.severity).toBe("error");
    expect(leak?.path).toContain("press");
  });

  it("errors when a publication references an unlisted artifact", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "artifacts.yaml": `${ARTIFACT}${secondArtifact("work-unlisted", { visibility: "unlisted" })}`,
        "publications.yaml": `- title: Paper
  venue: Venue
  year: 2024
  artifactRefs: [work-unlisted]
`,
      }),
    );
    const issues = registryCheck(profile);
    expect(
      issues.some((i) => i.code === "check/private-in-public-output" && i.severity === "error"),
    ).toBe(true);
  });

  it("errors when a project references an unlisted artifact (leak gate covers the third site)", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "artifacts.yaml": `${ARTIFACT}${secondArtifact("work-unlisted", { visibility: "unlisted" })}`,
        "projects.yaml": `- name: Demo
  status: active
  artifactRefs: [work-unlisted]
`,
      }),
    );
    const issues = registryCheck(profile);
    const leak = issues.find((i) => i.code === "check/private-in-public-output");
    expect(leak?.severity).toBe("error");
    expect(leak?.path).toContain("projects");
  });

  it("is clean for a public registry referenced from public claims", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "credentials.yaml": CREDENTIAL,
        "artifacts.yaml": ARTIFACT,
        "projects.yaml": projectWithEvidence("cert-aws-ml", "reel-2025"),
      }),
    );
    expect(registryCheck(profile)).toEqual([]);
  });
});

describe("GEO payoff (§18.9): JSON-LD hasCredential", () => {
  it("emits hasCredential for public credentials (Person)", () => {
    const profile = load(
      makeWorkspace({ "identity.yaml": IDENTITY, "credentials.yaml": CREDENTIAL }),
    );
    const geo = geoCheck(profile);
    expect(geo.sections.structuredData.readiness.jsonLd?.hasCredential).toEqual([
      {
        "@type": "EducationalOccupationalCredential",
        name: "AWS Certified ML - Specialty",
        url: "https://aws.amazon.com/verification/cert-aws-ml",
        awardedBy: { "@type": "Organization", name: "Amazon Web Services" },
        validFrom: "2024-05-01",
        validThrough: "2027-05-01",
      },
    ]);
  });

  it("emits hasCredential for Organization too (brand parity, §17.1)", () => {
    const brandIdentity =
      "name: Topia Press\nlinks:\n  - label: Site\n    url: https://topia.press\n";
    const profile = load(
      makeWorkspace({
        "identity.yaml": brandIdentity,
        "flavor.yaml": "brand\n",
        "credentials.yaml": CREDENTIAL,
      }),
    );
    const geo = geoCheck(profile);
    const jsonLd = geo.sections.structuredData.readiness.jsonLd;
    expect(jsonLd?.["@type"]).toBe("Organization");
    expect(jsonLd?.hasCredential).toEqual([
      {
        "@type": "EducationalOccupationalCredential",
        name: "AWS Certified ML - Specialty",
        url: "https://aws.amazon.com/verification/cert-aws-ml",
        awardedBy: { "@type": "Organization", name: "Amazon Web Services" },
        validFrom: "2024-05-01",
        validThrough: "2027-05-01",
      },
    ]);
  });

  it("omits private credentials from the JSON-LD (visibility first-class, §18.5)", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "credentials.yaml": CREDENTIAL.replace("visibility: public", "visibility: private"),
      }),
    );
    const geo = geoCheck(profile);
    expect(geo.sections.structuredData.readiness.jsonLd?.hasCredential).toBeUndefined();
  });
});

describe("compile: registry rides on the PlatformProfile slice", () => {
  it("passes credentials/artifacts through untouched (facts, §7)", () => {
    const profile = load(
      makeWorkspace({
        "identity.yaml": IDENTITY,
        "credentials.yaml": CREDENTIAL,
        "artifacts.yaml": ARTIFACT,
      }),
    );
    const slice = compile(profile, "github-readme", "en");
    expect(slice.credentials).toHaveLength(1);
    expect(slice.artifacts).toHaveLength(1);
    expect(slice.artifacts[0]?.description?.en).toBe("Selected work 2025.");
  });
});
