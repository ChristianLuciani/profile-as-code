# Prompt de investigación SOTA — sesión dedicada

> Copiá este prompt en una sesión NUEVA de agente (pi/claude). Una sesión por bloque de plataformas,
> o una sola si el contexto alcanza. Salida esperada: un archivo `research/SOTA-<año>/<plataforma>.md` por plataforma.
> Regla de oro: **toda afirmación cuantitativa o de best-practice lleva URL de fuente + fecha de verificación.**
> Sin fuente → se marca `[?]` y NO entra a la skill.

---

## Contexto

Estoy construyendo **profile-as-code**, un CLI open source que versiona la información profesional de una persona
(SSOT en YAML) y genera textos optimizados por plataforma (LinkedIn, GitHub, Upwork, X, ResearchGate, Substack…), con
"skills" por plataforma que contienen el conocimiento SOTA de cada red. Cada skill debe codificar: límites
oficiales, directrices de ranking/SEO+GEO, ángulos por audiencia, trampas y checks verificables.

Voy a ser el primer usuario: físico (USFQ/Cuenca), comunicador de ciencias, innovación educativa,
contribuidor open source (sovereign AI, AionCore/ACP), publicaciones arbitradas (2006–2026).

Tu trabajo: producir el conocimiento SOTA de cada plataforma con fuentes verificadas y fechadas.

## Método (por plataforma)

1. **Research questions** — escribí 4-6 preguntas específicas de la plataforma ANTES de buscar.
2. **Fuentes oficiales primero** — docs/help centers oficiales (límites reales de caracteres, campos, directrices).
3. **Expertos después** — artículos reconocidos (no listas SEO genéricas): criterio de autor, fecha, datos.
4. **Benchmark de perfiles top** — elegí 3-5 perfiles de referencia del nicho (física / IA educativa / open source /
   ciencia comunicación) y extraé patrones reales (estructura de headline/about, keywords, formato).
5. **Trampas** — errores conocidos por la comunidad (p. ej. keywords stuffing, bots de engagement, etc.).
6. **Salida** — secciones abajo. Toda cifra con fuente.

## Entregable por plataforma — estructura de `SOTA-<año>/<plataforma>.md`

```
## Research questions (las 4-6 pre-registradas)
## Límites oficiales (tabla: campo → límite → fuente → fecha)
## Campos disponibles / estructura
## Directrices de ranking / descubrimiento / SEO
## Ángulos por audiencia (¿qué quiere ver cada tipo de visitante?)
## Benchmark: 3-5 perfiles de referencia del nicho (patrones extraídos, con links)
## Trampas y anti-patrones
## Checklist machine-readable propuesta (checks YAML que el CLI pueda ejecutar)
## Fuentes (todas, con fecha)
```

## Plataforma 1 — GitHub (perfil + README)

Research questions sugeridas:
- ¿Qué estructura de profile README maximiza la retención de un recruiter/devol en <60s?
- ¿Qué proyectos conviene feature (pinned) y con qué formato de metadata?
- ¿Los badges/stats dinámicos suman o restan según la audiencia?
- ¿Qué demuestra "credibilidad técnica" (contribuciones, PRs a upstream, papers) en el perfil?
- ¿Patrones de perfiles top de científicos/open source maintainers?

## Plataforma 2 — LinkedIn

Research questions sugeridas:
- Límites reales actuales: headline, about, experiencia (desc), skills, featured.
- ¿Cómo funciona el ranking de búsqueda de reclutadores (keywords en qué campos pesan más)?
- ¿Estructura óptima del About (gancho → evidencia → CTA) para perfiles de ciencia/IA?
- ¿Featured y publicaciones: qué conviene anclar?
- ¿SEO: cómo aprovechar las "skills endorsements" y el título del cargo?
- Benchmark: perfiles top del nicho.

## Plataforma 3 — Upwork

Research questions sugeridas:
- Límites: title, overview, specialties, catalog, portfolio.
- ¿Cómo rankea el algoritmo de búsqueda de clientes (title vs overview vs skills)?
- ¿Estructura óptima del overview para conversión (gancho → propuesta de valor → prueba → CTA)?
- ¿Cómo se posiciona "científico/IA/educación" como servicio (specialty, hourly rate, availability)?
- Reglas de Upwork sobre links externos/contacto (ToS): qué NO hacer.
- Benchmark: perfiles top de IA/educación/data.

## Plataforma 4 — X

Research questions sugeridas:
- Límites: bio (160), name (50), pinned, threads, media.
- ¿Cómo funciona el descubrimiento (keywords en bio/name, hashtags, lists)?
- ¿Estructura de bio para credibilidad científica + open source?
- ¿Frecuencia/formato de publicaciones para científicos (papers → threads)?
- Benchmark: científicos/open source que usan X bien.

## Plataforma 5 — ResearchGate (y nota ORCID/Scholar)

Research questions sugeridas:
- ¿Qué campos existen (bio, skills, publications, projects)?
- ¿Qué pesa en el RG Score y conviene/evita optimizar?
- ¿Cómo sincronizar con ORCID/Crossref sin duplicar?
- ORCID: ¿hay API de escritura disponible para individuos? (verificar estado actual)

## Plataforma 6 — Substack

Research questions sugeridas:
- Límites del perfil (name, bio, notes) y de la página de publicación.
- Descubrimiento: search, recommendations, tags, importación — ¿qué mueve suscriptores?
- Estructura de un perfil de autor creíble para ciencia/IA/educación: bio, secciones, archivo, featured.
- GEO: los LLM citan newsletters (RSS, indexación, llms.txt) — ¿qué hace citable una Substack?
- Política de idioma (EN para audiencia global vs ES para el nicho local) y enlace cruzado con X/LinkedIn.
- Benchmark: 3-5 Substack de autores científicos/IA bien posicionados.

## Reglas

- **Fuentes fechadas**: cada claim con `[URL] (verificado: AAAA-MM-DD)`.
- **Distinguir**: `[OFICIAL]` (docs de la plataforma) / `[EXPERTO]` (artículo de autor reconocido) / `[BENCHMARK]` (patrón observado en perfiles reales) / `[?]` (sin confirmar).
- Si un límite oficial no se encuentra, decilo explícitamente (`[?] límite de X no confirmado`) — no inventes.
- Verificá fechas de docs: las plataformas cambian límites seguido; si la fuente es vieja (>1 año), marcala.
- No optimices para el engagement vacío: la prioridad es credibilidad + conversión real (reclutador, cliente).
- Al final: **veredicto de 3 bullets** por plataforma ("lo que la skill DEBE codificar", "lo que DEBE evitar", "riesgos").

## Sección GEO transversal (obligatoria en TODA plataforma)

Los LLM (ChatGPT, Gemini, Perplexity, Claude…) leen perfiles y los citan o los descartan. Para cada plataforma, agregá al final de tu investigación una sub-sección `## GEO — cómo los LLM leen esta plataforma` con:

- ¿Cómo accede un LLM a esta plataforma? (p. ej. LinkedIn: agentes/`loop`/API de partners; GitHub: README como contexto; X: citas y enlaces; ResearchGate: indexación).
- ¿Qué usa un LLM para citar a una persona como fuente/autoridad (consistencia factual entre redes, DOI/ORCID resolubles, presencia en datasets públicos)?
- Checks de GEO que la skill debe codificar: los hechos que deben ser IDÉNTICOS en todas las superficies (fechas, roles, papers) — una contradicción entre LinkedIn y GitHub es motivo de descarte.
- Structured data: ¿qué campos de schema.org (`Person`, `author`, `sameAs`) aplican al renderer web/GitHub?
- Anclas semánticas: 3-5 asociaciones que un LLM debería conectar con la persona (p. ej. "física + innovación educativa + soberanía de IA") y cómo sembrarlas sin stuffing.

## Multilingüe

Cada plataforma: indicá la **política de idioma** (qué `lang` priorizar y por qué — p. ej. Upwork overview EN-first para clientes internacionales; LinkedIn según mercado objetivo; X mixto EN/ES). Los textos del producto soportan EN/ES/FR; la investigación debe cubrir cómo el idioma afecta ranking y percepción en cada red.

## Fin del prompt
