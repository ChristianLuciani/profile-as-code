# Skills por plataforma

Cada plataforma tiene UNA skill: el conocimiento operacional SOTA de esa red,
versionado y contribuible. Las skills son la capa de *juicio* que complementa
al renderer (capa determinista de código).

## Estructura de una skill

```
skills/<plataforma>/
├── SKILL.md              # frontmatter (nombre, descripción, modelo sugerido) + flujo
├── research/             # investigación versionada, con fuentes fechadas
│   └── SOTA-<año>.md
├── playbook.md           # pasos de deploy manual + verificación post-pega
└── checks.yaml           # criterios machine-readable que ejecuta `pac check`
```

## División de responsabilidades

| Capa | Qué garantiza |
|---|---|
| **Renderer** (`packages/renderers/<plataforma>`) | Consistencia: el mismo hecho nunca se contradice entre redes. Determinista, snapshot-tested. |
| **Skill** (`skills/<plataforma>/`) | Juicio y actualidad: límites oficiales, ranking/SEO, ángulos por audiencia, trampas, checks. |

## Reglas

1. **Evidencia:** toda afirmación cuantitativa lleva fuente + fecha. Sin fuente → no entra.
2. **Distinción de fuentes:** `[OFICIAL]` docs de la plataforma · `[EXPERTO]` artículo de autor reconocido ·
   `[BENCHMARK]` patrón observado en perfiles reales · `[?]` sin confirmar.
3. **Frontmatter con modelo sugerido:** las skills declaran qué nivel de modelo requieren
   (mecánico = modelo pequeño; juicio = modelo grande) para el refinamiento vía `pac refine`.
4. **GEO obligatorio por skill:** además de SEO, cada skill documenta cómo los LLM leen/citan
   esa plataforma (p. ej. LinkedIn vía agentes, X vía citas, GitHub README como contexto de agente)
   y qué checks de consistencia factual aplican.
5. **i18n por skill:** la política de idioma de cada plataforma (qué `lang` prioriza y por qué).
6. **Contribución:** PR de skills para plataformas que no cubrimos. Toda skill pasa por
   sanitización + security scan + test de comportamiento antes de aceptarse.
7. **No optimizar engagement vacío:** la prioridad es credibilidad + conversión real
   (reclutador, cliente), no métricas superficiales.

## Plataformas objetivo (orden de prioridad)

1. `github-readme` — la única superficie 100% automatizable (git/API)
2. `linkedin` — trayectoria profesional
3. `upwork` — servicio/cliente
4. `x` — visibilidad
5. `researchgate` — ciencia
6. `substack` — newsletter/audiencia propia (superficie de contenido + perfil)

## Brand flavor (M6, §17)

`github-org` — README del GitHub **org** para workspaces `flavor: brand`: voz de
marca (≠ voz personal), handle-matrix checks (`handle-claimed`/`handle-consistent`,
offline en `pac check`), trademark/impersonación. Ver `skills/github-org/`.
