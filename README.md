# profile-as-code

**Tu identidad profesional como código.** Un solo source of truth versionado (YAML) → textos optimizados
por plataforma (LinkedIn, GitHub, Upwork, X, ResearchGate…) con **skills por plataforma** que codifican el
conocimiento SOTA de cada red.

> CLI-first · TypeScript · Sin infraestructura · Tus datos siempre tuyos.

![CI](https://github.com/ChristianLuciani/profile-as-code/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
[![Discussions](https://img.shields.io/badge/discussions-comunidad-blue.svg)](https://github.com/ChristianLuciani/profile-as-code/discussions)

## Para quién es (y qué necesitás)

**Hoy es una herramienta para gente técnica**: lo mínimo es una terminal y **Node.js ≥ 22** — y
hoy hace falta además **una cuenta de GitHub con acceso al repo del motor** (privado). Sin eso
**no hay forma de obtener `pasco`**: el paquete de npm todavía no está publicado y la
instalación desde fuente clona un repo privado. Con acceso al motor pero no al template (también
privado), el camino es parcial: `pasco init` local y pegado a mano en cada plataforma. El camino
guiado y sin terminal es el hito M5 y **todavía no existe**
([#101](https://github.com/ChristianLuciani/profile-as-code/issues/101)).

Instalación, verificación y qué cambia según lo que tengas: [**User Guide**](docs/USER-GUIDE.md) (EN).
Acá abajo, el qué y el por qué.

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
        │        CI: validate · lint · tests · build          │
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
| Spec (D1–D18 resueltas) | ✅ `docs/SPEC.md` (GEO, i18n, profile-data, Substack, **brand flavor D15/§17**) |
| Investigación SOTA por plataforma | 🚧 `skills/github-readme` + `skills/github-org`; resto: asistente **SOTA Research**, ver `docs/research/RUN.md` |
| Schema JSON v1.6 (contrato) | ✅ `schema/profile.schema.json` (person + brand flavor) |
| Core engine (load · drift · geo · compile) | ✅ `packages/core` (tests, CI) |
| CLI `pasco` | ✅ init·validate·build·diff·status; check ejecuta reglas offline M6/M7/M8 (catálogo M3/M4); refine/skills:install 🚧 — detalle en [`packages/cli/README.md`](packages/cli/README.md) |
| Renderer GitHub (dogfood) | ✅ `github-readme` + `github-org` (brand) |

**Brand flavor (M6, D15):** el mismo engine modela identidades de marca — `pasco init
--flavor brand`, handle matrix (`socialHandles`), `schema.org/Organization` GEO,
renderer `github-org`. Primer workspace brand: Topia — planeado como repo privado (`profile-data-<username>`, SPEC §9.1).

## Arranque (dev)

```bash
pnpm install
pnpm test            # workspace tests (vitest)
pnpm build           # build (CLI: tsup transpile-only — type gate is pnpm typecheck, #108)
pnpm typecheck       # tsc --noEmit, whole workspace (CI-enforced since #108)
pnpm lint            # style gate (Biome: lint + format + import order)
pnpm gen:zod         # regenera Zod desde schema/profile.schema.json (D3)
```

## Documentación

- [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) — guía de usuario: instalación → workspace → primer load de datos → updates (EN).
- [`docs/SPEC.md`](docs/SPEC.md) — el contrato del motor: goals, decisiones D1–D18, data model, core interfaces, GEO, roadmap, brand flavor (§17).
- [`docs/research/`](docs/research/) — prior-art + prompts de investigación SOTA por plataforma.
- [`schema/README.md`](schema/README.md) — el contrato de datos: mapping de archivos, semántica de validación.
- [`docs/ci-cd.md`](docs/ci-cd.md) — protección de main, CI, dependabot (cómo y por qué).
- [`packages/core/README.md`](packages/core/README.md) — el motor: APIs, tests.

## Roadmap (M1–M5, detalle en SPEC §12)

1. **M1** spec + schema + core ✅ → **CLI `pasco` ✅** (init·validate·build·diff·status; refine/check/skills:install 🚧 — detalle en [`packages/cli/README.md`](packages/cli/README.md))
2. **M2** renderer `github-readme` + CI + dogfood
3. **M3** investigación SOTA → skills v1 + `pasco refine` (hub local)
4. **M4** renderers linkedin/upwork/x/researchgate/substack + playbooks + `pasco check`
5. **M5** renderer web, template `profile-data` release, CONTRIBUTING completo

## Estructura

```
profile-as-code/
├── schema/               # EL contrato (JSON Schema, semver, aditivo)
├── packages/
│   ├── core/             # ✅ load · drift · geo · compile (Zod desde schema)
│   ├── renderers/        # github-readme + github-org — más adapters por plataforma (seam de contribución)
│   └── cli/              # pasco — init·validate·build·diff·status ✅ (refine/check/skills:install 🚧; check ejecuta reglas offline M6/M7/M8, igual que packages/cli/README.md)
├── skills/               # skills por plataforma (conocimiento SOTA)
├── templates/
│   ├── profile-data/       # workspace de datos del usuario — template fork/clone (SPEC §9)
│   └── profile-data-brand/ # workspace brand — template fork/clone (multi-workspace, §9.1/§17.2)
└── docs/                 # SPEC, research, ci-cd, build prompts
```

Los datos reales de cada usuario viven en un **repo privado separado** (`profile-data-<username>/`), nunca aquí.
Cada usuario arranca con el template `templates/profile-data/` (fork o clone) — ver `docs/SPEC.md` §9.

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
