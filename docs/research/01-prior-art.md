# Prior Art — profile-as-code

> Fase de investigación previa a la spec. Método: sota-research (fan-out barato, verificación con fuentes).
> Fecha: 2026-08-07 · Estado: [INF] = inferencia, [WEB] = con fuente, [?] = abierto

## Research questions

1. ¿Existe un estándar "resume/CV as code" con schema versionable? → **Sí: JSON Resume, yamlresume.**
2. ¿Existe algo que genere *perfiles de redes sociales* (no solo CV/PDF/web) desde un solo SSOT? → **No.**
3. ¿Los generadores de GitHub profile README son data-driven o templates estáticos? → **Estáticos.**
4. ¿Hay herramientas de optimización por plataforma con IA + multi-variante? → **Puntuales por plataforma, sin SSOT.**
5. ¿Hay specs/ADRs/discusiones valiosas sobre "identidad como código"? → **brandspec, issues de JSON Resume.**

## Already solved?

### ADOPT — nada (no existe el producto).

### ADAPT — convenciones a tomar, no herramientas a instalar

| Fuente | Qué tomar | URL |
|---|---|---|
| JSON Resume `resume-schema` | Convenciones de fields (`basics`, `work`, `education`, `skills`, `publications`), semver del schema, separación schema/registro/themes | https://github.com/jsonresume/resume-schema |
| JSON Resume issue #48 (2015) | El pedido de interoperabilidad con LinkedIn/Facebook/Seek quedó **abierto 10 años** → el gap es real y viejo | https://github.com/jsonresume/resume-schema/issues/48 |
| yamlresume | YAML como formato de fuente; editor web local-first como referencia UX | https://github.com/yamlresume/yamlresume |
| zhiweio/resume-as-code | Estructura `data/` (profiles + timeline) + `skills/` proyectables (`skills:install <agent>`); pipeline de generación con **de-AI humanization** y quality review; multi-idioma desde el día 1 | https://github.com/zhiweio/resume-as-code |
| brandspec | Capa de identidad: un `brand.yaml` + tokens; principio "AI crea, el usuario es dueño del archivo" | https://github.com/brandspec/brandspec |
| portfolio-as-code-template | Formato template-repo para "professional development as code" | https://github.com/NahomBefekadu/portfolio-as-code-template |

### BUILD — el gap defendible

Ningún proyecto combina: **SSOT versionable + renderers multi-plataforma + optimización por intención con IA (variantes elegidas por el usuario) + skills por plataforma + playbooks/checks de deploy**.
- Los generadores de headline/bio (LinkedIn) son apps puntuales 0-2★ sin versioning → mueren [INF].
- `andoshin11/profile-as-code` lee perfiles → repo (dirección inversa: scrape, no escritura) [WEB: https://github.com/andoshin11/profile-as-code].
- Los GitHub README generators son templates estáticos, no data-driven [INF].

## Applicable theory

- **De-AI humanization**: el pipeline de 10 pasos de zhiweio incluye pasos explícitos de humanización y revisión de calidad → el output de LLM para perfiles profesionales no se publica directo; requiere variantes + revisión humana [WEB: zhiweio README].
- **Schema como deep module**: un contrato pequeño (schema) con mucha implementación detrás (validación, normalización, drift-check) — ver codebase-design.
- **Renderer seam real**: hay >6 plataformas con formatos distintos → el seam de adapters está justificado (regla: un adapter = seam hipotético, dos = seam real).
- **Skills por agente**: el patrón `skills:install <agent>` de zhiweio (11+ agentes soportados) valida skills como mecanismo de distribución de conocimiento operativo [WEB].

## Expectations

- El schema de CV "as code" lleva 10+ años estable → nuestro schema debe apuntar a la misma estabilidad semántica.
- El output IA requiere 2-3 pasos de revisión/humanización (dato de campo, zhiweio).
- Las tools de una sola plataforma sin SSOT no prenden (0-2★) → el producto debe ser el *ecosistema*, no la tool puntual.

## Implications for the spec

1. Hechos (timeline/basics) **separados** de la capa de storytelling (textos por plataforma) — YAML modular tipo zhiweio.
2. Skills por **plataforma** (nuestra granularidad) vs por tarea (zhiweio) — defendible: cada plataforma tiene reglas y ángulos propios.
3. Pipeline obligatorio de humanización + variantes + elección del usuario antes de publicar.
4. Reusar convenciones de fields de JSON Resume para import futuro y compatibilidad mental.
5. Multi-idioma (ES/EN) desde el día 1.
6. `pac skills:install <agent>` como comando de proyección a skill-studio local.
7. Deploy playbooks + checks machine-readable = diferenciador no cubierto por nadie.
8. Si algún día hace falta CV/PDF: delegar a yamlresume/JSON Resume (un renderer más), no reinventar.
9. Capa de identidad tipo `brand.yaml` (brandspec) como base del `positioning`.
10. Evidencia: toda afirmación cuantitativa de una skill con URL + fecha (regla del repo).
