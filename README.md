# profile-as-code

**Tu identidad profesional como código.** Un solo source of truth versionado (YAML) → textos optimizados
por plataforma (LinkedIn, GitHub, Upwork, X, ResearchGate…) con **skills por plataforma** que codifican el
conocimiento SOTA de cada red.

> CLI-first · TypeScript · Sin infraestructura · Tus datos siempre tuyos.

## Problema

El mismo perfil vive en 8+ plataformas, cada una con reglas, límites y audiencias distintas. Se editan a mano,
se desincronizan, y los hechos (fechas, proyectos, publicaciones) se contradicen entre redes. No existe forma
de *versionar* tu presencia profesional ni de hacerla consistente sin copiar-pegar.

## Enfoque

```
        ┌──────────────────────────────────────────────────────┐
        │                 REPO PÚBLICO (producto)               │
        │  ┌─────────┐  ┌──────────────┐  ┌─────────────────┐  │
        │  │  DATA   │→ │  CORE        │→ │  RENDERERS      │  │
        │  │  YAML   │  │  validación  │  │  linkedin/      │  │
        │  │  +schema│  │  normalización│ │  upwork/github/ │  │
        │  │         │  │  drift-check │  │  x/researchgate │  │
        │  └─────────┘  └──────────────┘  └─────────────────┘  │
        │        CI: validate · tests · links · drift           │
        └───────────────┬──────────────────────────┬───────────┘
                        │ datos del usuario         │ outputs listos
        ┌───────────────▼──────────┐   ┌───────────▼──────────────┐
        │  REPO PRIVADO (tuyo)     │   │  deploy: pegar (LinkedIn,│
        │  content/*.yaml          │   │  Upwork…) o git/API      │
        │  profiles/ (generados)   │   │  (GitHub README, web)    │
        │  CHANGELOG · CHECKLIST   │   │                          │
        └──────────────────────────┘   └──────────────────────────┘
```

- **Hechos y storytelling separados:** los datos son deterministas (schema, validación, drift-check);
  los textos son *ángulos* por plataforma, generados con IA y **elegidos por vos** (3 variantes → elegís una).
- **Skills por plataforma** (una por LinkedIn, Upwork, GitHub, X…): límites oficiales, ranking/**SEO+GEO**,
  ángulos por audiencia, trampas y *checks* ejecutables. Se proyectan a tu skill-studio de agente.
- **GEO (generative engine optimization) como capa transversal:** los LLM leen y citan perfiles hoy.
  La consistencia factual cross-platform ES citabilidad — un modelo que cruza LinkedIn vs GitHub y encuentra
  contradicciones te descarta. El `geoCheck` del core garantiza hechos idénticos, anclas semánticas y
  readiness para datos estructurados (schema.org JSON-LD).
- **Multilingüe:** contenido por idioma (`EN` esencial para reclutadores internacionales, `ES` nativo,
  `FR` deseable). Docs del repo en inglés.
- **Deploy como checklist:** las plataformas sin API (LinkedIn, Upwork) se marcan como "pegar + verificar";
  las con API (GitHub) se actualizan por git/API.

## Estado

| Fase | Estado |
|---|---|
| Prior-art research | ✅ `docs/research/01-prior-art.md` |
| Spec | ✅ `docs/SPEC.md` (incluye GEO, i18n, template brand-data) |
| Investigación SOTA por plataforma | 🔜 pendiente — asistente **SOTA Research** en AionUi, ver `docs/research/RUN.md` |
| Motor (schema → core → CLI) | ⏳ |
| Renderer GitHub (dogfood) | ⏳ |

## Estructura prevista

```
profile-as-code/
├── schema/               # EL contrato (JSON Schema, semver, aditivo)
├── packages/
│   ├── core/             # validación + normalización + drift-check (Zod desde schema)
│   ├── renderers/        # un adapter por plataforma (seam de contribución)
│   └── cli/              # pac build|validate|diff|check|refine|skills:install
├── skills/               # skills por plataforma (conocimiento SOTA)
│   ├── linkedin/
│   ├── upwork/
│   ├── github-readme/
│   └── …
├── templates/
│   ├── playbooks/        # deploy por plataforma (pasos + verificación)
│   └── brand-data/       # workspace de datos del usuario — template fork/clone (§9 de la SPEC)
├── examples/             # data de muestra (persona ficticia)
└── docs/
    ├── research/         # prior-art + prompts de investigación
    └── SPEC.md           # contrato del motor
```

Los datos reales de cada usuario viven en un **repo privado separado** (`brand-data/`), nunca aquí.
Cada usuario arranca con el template `templates/brand-data/` (fork o clone) — ver `docs/SPEC.md` §9.

## Contribuir

- **PRs de renderers** — un adapter por plataforma en `packages/renderers/`.
- **PRs de skills** — conocimiento SOTA de una plataforma que no cubrimos (Behance, Xing, Indeed…).
  Toda skill pasa por review: sanitización + security scan + test de comportamiento.
- Regla de evidencia: toda afirmación cuantitativa de una skill lleva fuente + fecha.

## Licencia

MIT — ver `LICENSE`.
