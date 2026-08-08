# profile-as-code

**Tu identidad profesional como código.** Un solo source of truth versionado (YAML) → textos optimizados
por plataforma (LinkedIn, GitHub, Upwork, X, ResearchGate…) con **skills por plataforma** que codifican el
conocimiento SOTA de cada red.

> CLI-first · TypeScript · Sin infraestructura · Tus datos siempre tuyos.

![CI](https://github.com/ChristianLuciani/profile-as-code/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
[![Discussions](https://img.shields.io/badge/discussions-comunidad-blue.svg)](https://github.com/ChristianLuciani/profile-as-code/discussions)

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
        │  │         │  │  drift-check │  │  x/researchgate/│  │
        │  │         │  │  geo-check   │  │  substack       │  │
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
  `FR` deseable). Docs del repo en inglés (D8).
- **Deploy como checklist:** las plataformas sin API (LinkedIn, Upwork) se marcan como "pegar + verificar";
  las con API (GitHub) se actualizan por git/API.

## Estado

| Fase | Estado |
|---|---|
| Prior-art research | ✅ `docs/research/01-prior-art.md` |
| Spec (D1–D14 resueltas) | ✅ `docs/SPEC.md` (GEO, i18n, user-brand-data, Substack) |
| Investigación SOTA por plataforma | 🔜 pendiente — asistente **SOTA Research**, ver `docs/research/RUN.md` |
| Schema JSON v1 (contrato) | ✅ `schema/profile.schema.json` |
| Core engine (load · drift · geo · compile) | ✅ `packages/core` (37 tests, CI) |
| CLI `pac` | ⏳ |
| Renderer GitHub (dogfood) | ⏳ |

## Arranque (dev)

```bash
pnpm install
pnpm test            # workspace tests (vitest)
pnpm build           # build + type-check
pnpm typecheck       # tsc --noEmit
pnpm gen:zod         # regenera Zod desde schema/profile.schema.json (D3)
```

## Documentación

- [`docs/SPEC.md`](docs/SPEC.md) — el contrato del motor: goals, decisiones D1–D14, data model, core interfaces, GEO, roadmap.
- [`docs/research/`](docs/research/) — prior-art + prompts de investigación SOTA por plataforma.
- [`schema/README.md`](schema/README.md) — el contrato de datos: mapping de archivos, semántica de validación.
- [`docs/ci-cd.md`](docs/ci-cd.md) — protección de main, CI, dependabot (cómo y por qué).
- [`packages/core/README.md`](packages/core/README.md) — el motor: APIs, tests.

## Roadmap (M1–M5, detalle en SPEC §12)

1. **M1** spec + schema + core ✅ → **CLI `pac`** ⏳
2. **M2** renderer `github-readme` + CI + dogfood
3. **M3** investigación SOTA → skills v1 + `pac refine` (hub local)
4. **M4** renderers linkedin/upwork/x/researchgate/substack + playbooks + `pac check`
5. **M5** renderer web, template `user-brand-data` release, CONTRIBUTING completo

## Estructura

```
profile-as-code/
├── schema/               # EL contrato (JSON Schema, semver, aditivo)
├── packages/
│   ├── core/             # ✅ load · drift · geo · compile (Zod desde schema)
│   ├── renderers/        # ⏳ un adapter por plataforma (seam de contribución)
│   └── cli/              # ⏳ pac build|validate|diff|check|refine|skills:install
├── skills/               # skills por plataforma (conocimiento SOTA)
├── templates/
│   ├── playbooks/        # deploy por plataforma (pasos + verificación)
│   └── user-brand-data/  # workspace de datos del usuario — template fork/clone (SPEC §9)
├── examples/             # data de muestra (persona ficticia)
└── docs/                 # SPEC, research, ci-cd, build prompts
```

Los datos reales de cada usuario viven en un **repo privado separado** (`user-brand-data/`), nunca aquí.
Cada usuario arranca con el template `templates/user-brand-data/` (fork o clone) — ver `docs/SPEC.md` §9.

## Comunidad

- 💬 [**Discussions**](https://github.com/ChristianLuciani/profile-as-code/discussions) — preguntas, ideas y chat. Issues: bugs y propuestas concretas.
- 🛠️ [**Contributing**](CONTRIBUTING.md) — guía completa: qué aportar, reglas, workflow de PR, skills.
- 🤝 [**Code of Conduct**](CODE_OF_CONDUCT.md) — Contributor Covenant.
- 🏛️ [**Governance**](GOVERNANCE.md) — modelo, aceptación de contribuciones, camino a co-maintainers.
- 🐛 Issues: [bug](https://github.com/ChristianLuciani/profile-as-code/issues/new?labels=bug&template=bug_report.yml) · [feature](https://github.com/ChristianLuciani/profile-as-code/issues/new?labels=enhancement&template=feature_request.yml) · [good first issue](https://github.com/ChristianLuciani/profile-as-code/labels/good%20first%20issue)
- 🔒 [**Security**](SECURITY.md) — reportes privados vía GitHub Security Advisories.

### Qué aportar hoy

- **PRs de renderers** — un adapter por plataforma en `packages/renderers/`.
- **PRs de skills** — conocimiento SOTA de una plataforma que no cubrimos (Behance, Xing, Indeed…).
  Toda skill pasa por review: sanitización + security scan + test de comportamiento.
- Regla de evidencia: toda afirmación cuantitativa de una skill lleva fuente + fecha.

## Licencia

MIT — ver `LICENSE`.
