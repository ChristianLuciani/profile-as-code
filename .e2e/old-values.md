# Old values — what to paste back if you dislike the new text

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: los valores ANTERIORES de los campos que el run cambió en `bios` y `headlines` · No cubre: los valores de `positioning`/`identity` (viven en el historial git) ni ningún dato que no estuviera en este workspace · as_of: 2026-10-20
> Si una pieza no aparece, no asumas que no existe: reportá el hueco.

Captured 2026-10-19, from `profile-data` @ `d0303f7`. These are the **current SSOT values**.
If you reject a new variant, paste the old one back into `content/` (L3 in the plan).

## bios.yaml — `bios` array (platform · lang · length → current text, exact)

### github-readme (used only in the deterministic artifact; the prose lives in `profiles/github-readme/variants/gh-en-1.md`)
Not part of this run — the prose variant is the deployed one.

### linkedin/en/medium (315 chars) — current text
```
Independent physicist: 20+ years across research, complex systems, university teaching and educational innovation. Designed and field-tested Drahma — 36 Socratic virtual tutors for the Ecuadorian curriculum (Amazon, Aug 2024). Author of Kontablo, a graph-based universal accounting ontology for the agentic economy.
```

### linkedin/es/medium (324 chars) — current text
```
Físico independiente: 20+ años en investigación, sistemas complejos, docencia universitaria e innovación educativa. Diseñé y probé en campo Drahma — 36 tutores virtuales socráticos para el currículo ecuatoriano (Amazonía, ago 2024). Autor de Kontablo, ontología contable universal basada en grafos para la economía agéntica.
```

### upwork/en/long (384 chars) — current text
```
Strategic systems consultant and physicist: BI platforms, ERP (Zoho, ERPNext), cash-audit systems and SaaS architecture with a sovereign-first approach — you keep the code and the data. 20+ years across research, university teaching and production systems. Flagship: Drahma, 36 Socratic AI tutors field-tested with Amazonian communities (Aug 2024), roughly two months before Khanmigo.
```

### patreon/en/short (542 chars) — current text
```
Christian Luciani — independent physicist in Cuenca, Ecuador. I build applied agentic solutions — sovereign and open source — across education (Drahma's 36 Socratic tutors and CLAPPS.AI, self-taught professional learning), finance (Kontablo, a graph-based universal accounting ontology mapping 195 jurisdictions to IFRS/XBRL), information, organizations and business. My working thesis: humans leverage cognitive machines; they are not replaced by them. No institution, no company, no external funding: your support goes straight to the work.
```

### researchgate/en/medium (284 chars) — current text
```
Physicist (UCV), working in complex systems. 20+ years across research, university teaching and production systems. X-ray diffractometry operator with 5 co-authored publications; 9 citable outputs 2006–2026; newest: Kontablo (graph-based universal accounting ontology, Zenodo & SSRN).
```

## headlines.yaml — new rows (added this run, old state = absent)

| platform | lang | text |
|---|---|---|
| linkedin | es | `Físico \| Sistemas Complejos \| Inteligencia Sintética Educativa \| Open Source Soberano` |
| x | es | `Físico · sistemas complejos · IA educativa · soberanía tecnológica` |
| x | en | *(was absent — new: `Physicist · complex systems · synthetic intelligence` — 59 chars)* |
| researchgate | en | *(was absent — new: `Physicist · Complex Systems · X-ray Diffractometry` — 53 chars)* |

## evidence links (separate, not an edit to identity.yaml)

The 6 evidence sources this run moves into `projects[].evidence[].source` are captured verbatim
in `.e2e/manifest.json` → `evidenceLinks` (or in the current `projects.yaml` if your agent
takes "leave them").
