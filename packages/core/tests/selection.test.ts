/**
 * D22 / SPEC §21 — fact selection per view.
 *
 * The tests are organised around the CONTRACT, not the implementation: the
 * subset-only rule (§21.3), exclusion precedence, the no-policy compatibility
 * guarantee (byte-identical output), the four checks (§21.5) and the operator's
 * G1 amendment (every omission warns, §21.4).
 */

import { describe, expect, it } from "vitest";
import type { Profile, SelectionPolicy } from "../src/index.js";
import { compile, orderedForSurface, selectFacts } from "../src/index.js";

/**
 * A workspace with one entry per selectable block, addressable ids on the ones
 * that support them (§19.2) and tags on the artifacts (§18.9). Hand-built on
 * purpose: the point is the resolver, not the YAML loader.
 */
function workspace(): Profile {
  return {
    identity: { name: "Test Person" },
    experience: [
      { id: "acme-2019", title: "Engineer", company: "Acme", start: "2019-01" },
      { id: "film-2021", title: "Director", company: "Studio", start: "2021-01" },
    ],
    projects: [
      { id: "p-ai", name: "AI thing", description: { en: "an AI project" } },
      { id: "p-film", name: "Film thing", description: { en: "a film project" } },
    ],
    publications: [{ id: "pub-1", title: "A paper", venue: "Journal", year: 2020 }],
    education: [{ id: "edu-1", institution: "Uni", degree: "BSc", year: 2018 }],
    press: [{ id: "press-1", title: "Coverage", outlet: "Paper" }],
    credentials: [{ id: "cred-1", kind: "certificate", title: "Cert", issuer: "Issuer" }],
    artifacts: [
      {
        id: "a-film",
        kind: "film",
        title: "Short film",
        locator: { url: "https://x.test/f" },
        tags: ["film"],
      },
      {
        id: "a-ai",
        kind: "code",
        title: "AI repo",
        locator: { url: "https://x.test/ai" },
        tags: ["ai"],
      },
      {
        id: "a-untagged",
        kind: "document",
        title: "Untagged doc",
        locator: { url: "https://x.test/u" },
      },
    ],
    skills: [{ name: "TypeScript" }, { name: "Direction" }],
  } as unknown as Profile;
}

/** Only tag-capable entries — the one shape where a tags view can select ZERO. */
function artifactsOnly(): Profile {
  return {
    identity: { name: "Test Person" },
    artifacts: [
      {
        id: "a-film",
        kind: "film",
        title: "Short film",
        locator: { url: "https://x.test/f" },
        tags: ["film"],
      },
      {
        id: "a-ai",
        kind: "code",
        title: "AI repo",
        locator: { url: "https://x.test/ai" },
        tags: ["ai"],
      },
    ],
  } as unknown as Profile;
}

const policy = (
  views: SelectionPolicy["views"],
  def?: SelectionPolicy["default"],
): SelectionPolicy => ({
  ...(def === undefined ? {} : { default: def }),
  views,
});

const omit = (p: Profile, view: string, pol: SelectionPolicy) =>
  selectFacts(p, view, "github-readme", "en", pol);

describe("selectFacts — no policy is byte-identical (§21.3 rule 2)", () => {
  it("leaves every array untouched and adds no report key to compile()", () => {
    const p = workspace();
    const plain = compile(p, "github-readme", "en");
    const withEmptyPolicy = compile(p, "github-readme", "en", {});

    // The compatibility guarantee: a caller that passes no selection policy gets
    // exactly what it got before this feature existed.
    expect(JSON.stringify(plain)).toBe(JSON.stringify(withEmptyPolicy));
    expect(plain.selection).toBeUndefined();
    expect(plain.artifacts).toHaveLength(3);
    expect(plain.skills).toHaveLength(2);
  });

  it("preserves declaration order (byte-stability is an output property)", () => {
    const p = workspace();
    const { profile } = omit(p, "v", policy({ v: {} }));
    expect(profile.artifacts?.map((a) => a.id)).toEqual(["a-film", "a-ai", "a-untagged"]);
  });
});

describe("selectFacts — subset-only (§21.3)", () => {
  it("excludeKeys removes exactly the addressed entry", () => {
    const { profile, report } = omit(
      workspace(),
      "linkedin",
      policy({ linkedin: { excludeKeys: ["projects:p-ai"] } }),
    );
    expect(profile.projects?.map((x) => x.id)).toEqual(["p-film"]);
    expect(report.omitted).toEqual([
      { block: "projects", key: "projects:p-ai", label: "p-ai", reason: "excluded-by-key" },
    ]);
  });

  it("never mutates the SSOT or the kept entries", () => {
    const p = workspace();
    const before = JSON.stringify(p);
    const { profile } = omit(p, "v", policy({ v: { excludeKeys: ["artifacts:a-film"] } }));
    expect(JSON.stringify(p)).toBe(before);
    // Kept entries are the SAME objects — selection filters, it does not copy or
    // rewrite (that is what keeps the sub-conjunction argument true).
    expect(profile.artifacts?.[0]).toBe(p.artifacts?.[1]);
  });

  it("every selected entry exists in the SSOT (subset property)", () => {
    const p = workspace();
    const { profile } = omit(
      p,
      "v",
      policy({ v: { mode: "tags", tags: ["film"], excludeTags: [] } }),
    );
    for (const block of [
      "experience",
      "projects",
      "publications",
      "education",
      "press",
      "credentials",
      "skills",
    ] as const) {
      for (const entry of (profile[block] ?? []) as unknown[]) {
        expect((p[block] as unknown[]).includes(entry)).toBe(true);
      }
    }
  });
});

describe("selectFacts — exclusion wins (§21.3 rule 1)", () => {
  it("a tag that is both allowed and denied is DENIED", () => {
    const { profile, report } = omit(
      workspace(),
      "v",
      policy({ v: { mode: "tags", tags: ["film"], excludeTags: ["film"] } }),
    );
    expect(profile.artifacts).toEqual([]);
    expect(report.omitted[0]?.reason).toBe("excluded-by-tag");
  });

  it("a key denial beats a tag allowance", () => {
    const { profile } = omit(
      workspace(),
      "v",
      policy({ v: { mode: "tags", tags: ["film"], excludeKeys: ["artifacts:a-film"] } }),
    );
    expect(profile.artifacts).toEqual([]);
  });
});

describe("selectFacts — mode semantics (§21.3 rule 5, Phase-1 boundary §21.7)", () => {
  it("mode: tags omits untagged artifacts with an explicit reason", () => {
    const { report } = omit(
      workspace(),
      "film",
      policy({ film: { mode: "tags", tags: ["film"] } }),
    );
    const untagged = report.omitted.find((o) => o.key === "artifacts:a-untagged");
    expect(untagged?.reason).toBe("not-tagged");
  });

  it("blocks without tag support pass through in mode: tags (Phase 1)", () => {
    // Only `artifacts` is tag-capable today; a tags view must not silently wipe
    // experience/projects because they carry no `tags` field yet.
    const { profile } = omit(
      workspace(),
      "film",
      policy({ film: { mode: "tags", tags: ["film"] } }),
    );
    expect(profile.experience).toHaveLength(2);
    expect(profile.projects).toHaveLength(2);
    expect(profile.artifacts?.map((a) => a.id)).toEqual(["a-film"]);
  });

  it("falls back to `default` for an undeclared view", () => {
    const { profile } = omit(
      workspace(),
      "anywhere",
      policy({}, { excludeKeys: ["skills:Direction"] }),
    );
    expect(profile.skills?.map((s) => s.name)).toEqual(["TypeScript"]);
  });
});

describe("selectFacts — checks (§21.5)", () => {
  it("selection/unknown-key is an ERROR (G6: addressed ⇒ resolvable)", () => {
    const { report } = omit(workspace(), "v", policy({ v: { excludeKeys: ["projects:nope"] } }));
    const f = report.findings.find((x) => x.code === "selection/unknown-key");
    expect(f?.severity).toBe("error");
  });

  it("selection/unknown-tag warns", () => {
    const { report } = omit(workspace(), "v", policy({ v: { mode: "tags", tags: ["ghost"] } }));
    expect(report.findings.find((x) => x.code === "selection/unknown-tag")?.severity).toBe("warn");
  });

  it("selection/omits-facts warns on ANY omission (G1 amendment, §21.4)", () => {
    const { report } = omit(workspace(), "v", policy({ v: { excludeKeys: ["projects:p-ai"] } }));
    const warn = report.findings.find((x) => x.code === "selection/omits-facts");
    expect(warn?.severity).toBe("warn");
    expect(warn?.message).toContain("projects:p-ai");
  });

  it("selection/empty-facts warns when a view selects nothing", () => {
    // Artifacts-only: non-tag-capable blocks pass through (§21.7), so they would
    // keep the view non-empty and hide the case this check exists for.
    const { report } = omit(artifactsOnly(), "v", policy({ v: { mode: "tags", tags: ["ghost"] } }));
    expect(report.findings.some((x) => x.code === "selection/empty-facts")).toBe(true);
  });

  it("selection/anchor-omitted names a GEO anchor that only the dropped entries reinforce", () => {
    const p = Object.assign(artifactsOnly(), {
      positioning: { geo: { semanticAssociations: ["film"] } },
    }) as Profile;
    const { report } = omit(p, "v", policy({ v: { mode: "tags", tags: ["ai"] } }));
    // "film" appears in the omitted artifact, not in the kept one.
    expect(report.findings.some((x) => x.code === "selection/anchor-omitted")).toBe(true);
  });
});

describe("compile — the filtered/unfiltered split (§21.5)", () => {
  it("structuredData is built from the FILTERED profile", () => {
    const p = workspace();
    const full = compile(p, "github-readme", "en");
    const filtered = compile(p, "github-readme", "en", {
      selection: { views: { "github-readme": { excludeKeys: ["credentials:cred-1"] } } },
    });
    expect(full.credentials).toHaveLength(1);
    expect(filtered.credentials).toHaveLength(0);
    // The credential ledger lives in the JSON-LD; it must not survive the filter.
    expect(JSON.stringify(filtered.structuredData)).not.toContain("Cert");
  });

  it("completeness stays on the UNFILTERED profile (§20 scores the workspace)", () => {
    const p = workspace();
    const full = compile(p, "github-readme", "en");
    const filtered = compile(p, "github-readme", "en", {
      selection: {
        views: { "github-readme": { excludeKeys: ["projects:p-ai", "artifacts:a-ai"] } },
      },
    });
    expect(filtered.completeness?.percent).toBe(full.completeness?.percent);
  });

  it("a declared view may target its own name, and `view` overrides the implicit one", () => {
    // `--view film` compiles the github-readme platform but resolves the rule
    // named "film" — the name is not derivable from the platform.
    const slice = compile(workspace(), "github-readme", "en", {
      view: "film",
      selection: { views: { film: { mode: "tags", tags: ["film"] } } },
    });
    expect(slice.selection?.view).toBe("film");
    expect(slice.artifacts?.map((a) => a.id)).toEqual(["a-film"]);
  });

  it("reports the resolved view on the slice", () => {
    const slice = compile(workspace(), "linkedin", "en", {
      selection: { views: { linkedin: { excludeKeys: ["education:edu-1"] } } },
    });
    expect(slice.selection).toMatchObject({ view: "linkedin", platform: "linkedin", lang: "en" });
    expect(slice.selection?.selected.education).toBe(0);
  });
});

describe("selectFacts — per-view orderKeys (#458: order is narrative, not a fact)", () => {
  it("pins the listed keys first, in DECLARED order", () => {
    const { profile, report } = omit(
      workspace(),
      "v",
      policy({ v: { orderKeys: ["projects:p-film", "projects:p-ai"] } }),
    );
    expect(profile.projects?.map((p) => p.id)).toEqual(["p-film", "p-ai"]);
    expect(report.ordered).toEqual({ projects: ["projects:p-film", "projects:p-ai"] });
  });

  it("orders only the blocks its keys name (per-block, no global sequence)", () => {
    const { profile, report } = omit(
      workspace(),
      "v",
      policy({ v: { orderKeys: ["projects:p-film"] } }),
    );
    expect(profile.projects?.map((p) => p.id)).toEqual(["p-film", "p-ai"]);
    // The un-named block keeps the SSOT declaration order, untouched.
    expect(profile.experience?.map((e) => e.id)).toEqual(["acme-2019", "film-2021"]);
    expect(report.ordered).toEqual({ projects: ["projects:p-film"] });
  });

  it("the remaining entries keep the SSOT order (the renderer applies its own comparator)", () => {
    // `p-ai` and `p-film` both survive; only `p-film` is pinned. The tail stays
    // in declaration order here — the sort a renderer adds is its own concern.
    const { profile } = omit(workspace(), "v", policy({ v: { orderKeys: ["projects:p-film"] } }));
    expect(profile.projects?.map((p) => p.id)).toEqual(["p-film", "p-ai"]);
  });

  it("orders skills by their natural §19.2 key", () => {
    const { profile, report } = omit(
      workspace(),
      "v",
      policy({ v: { orderKeys: ["skills:Direction", "skills:TypeScript"] } }),
    );
    expect(profile.skills?.map((s) => s.name)).toEqual(["Direction", "TypeScript"]);
    expect(report.ordered).toEqual({ skills: ["skills:Direction", "skills:TypeScript"] });
  });

  it("a typo warns with its own code instead of no-op'ing silently", () => {
    const { report } = omit(workspace(), "v", policy({ v: { orderKeys: ["projects:ghost"] } }));
    const finding = report.findings.find((f) => f.code === "selection/order-key-unknown");
    expect(finding?.severity).toBe("warn");
    expect(finding?.message).toContain("projects:ghost");
    expect(report.ordered).toBeUndefined();
  });

  it("an entry the same view EXCLUDES cannot be ordered — the key warns", () => {
    const { profile, report } = omit(
      workspace(),
      "v",
      policy({ v: { excludeKeys: ["projects:p-ai"], orderKeys: ["projects:p-ai"] } }),
    );
    expect(profile.projects?.map((p) => p.id)).toEqual(["p-film"]);
    expect(report.findings.some((f) => f.code === "selection/order-key-unknown")).toBe(true);
  });

  it("a key of a non-selectable block warns too (addresses nothing)", () => {
    const { report } = omit(workspace(), "v", policy({ v: { orderKeys: ["identity:me"] } }));
    expect(report.findings.some((f) => f.code === "selection/order-key-unknown")).toBe(true);
  });

  it("no orderKeys ⇒ the report carries no resolved order (compatibility)", () => {
    const { report } = omit(workspace(), "v", policy({ v: { excludeKeys: ["projects:p-ai"] } }));
    expect(report.ordered).toBeUndefined();
    // Not even an empty key: a no-order report is byte-identical to the pre-#458 shape.
    expect(JSON.stringify(report)).not.toContain('"ordered"');
  });

  it("a non-string orderKeys entry WARNs at the core seam (never a silent skip)", () => {
    const { report } = omit(
      workspace(),
      "v",
      policy({ v: { orderKeys: [42 as unknown as string, "projects:p-b"] } }),
    );
    const finding = report.findings.find((f) => f.code === "selection/order-key-unknown");
    expect(finding?.severity).toBe("warn");
    expect(finding?.message).toContain("non-string");
  });

  it("compile carries the ordered slice so a renderer can re-apply the precedence", () => {
    const slice = compile(workspace(), "github-readme", "en", {
      selection: { views: { "github-readme": { orderKeys: ["projects:p-film"] } } },
    });
    expect(slice.projects.map((p) => p.id)).toEqual(["p-film", "p-ai"]);
    expect(slice.selection?.ordered?.projects).toEqual(["projects:p-film"]);
  });
});

describe("orderedForSurface — the renderer's re-application (#458)", () => {
  type Row = { id: string; name: string };
  const rows: Row[] = [
    { id: "p-c", name: "Gamma" },
    { id: "p-a", name: "Alpha" },
    { id: "p-b", name: "Beta" },
  ];
  const byName = (a: Row, b: Row): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  it("pins the declared keys and leaves the rest to the comparator", () => {
    const out = orderedForSurface(rows, "projects", ["projects:p-c", "projects:p-a"], byName);
    expect(out.map((r) => r.id)).toEqual(["p-c", "p-a", "p-b"]);
  });

  it("no keys ⇒ the caller's comparator alone (byte-identical path)", () => {
    expect(orderedForSurface(rows, "projects", undefined, byName).map((r) => r.id)).toEqual([
      "p-a",
      "p-b",
      "p-c",
    ]);
    expect(orderedForSurface(rows, "projects", [], byName).map((r) => r.id)).toEqual([
      "p-a",
      "p-b",
      "p-c",
    ]);
  });

  it("never loses a slot when two array slots share one object (YAML alias)", () => {
    // The loader preserves aliases, so the same object can occupy two slots. An
    // identity-addressed `used` set dropped the second one from the surface.
    const shared: Row = { id: "p-a", name: "Alpha" };
    expect(orderedForSurface([shared, shared], "projects", ["projects:p-a"], byName)).toHaveLength(
      2,
    );
  });

  it("the input array is never mutated", () => {
    const before = rows.map((r) => r.id);
    orderedForSurface(rows, "projects", ["projects:p-c"], byName);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});
