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
└── checks.yaml           # criterios machine-readable que ejecuta `pasco check`
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
   (mecánico = modelo pequeño; juicio = modelo grande) para el refinamiento vía `pasco refine`.
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
offline en `pasco check`), trademark/impersonación. Ver `skills/github-org/`.

## Post skills (MVP, #264/#266/#361)

The week-1 post experiment uses a **different shape** from the profile skills:
`skills/<platform>/post.md` (judgment) + a machine-readable rule file.
`pasco post` reads them; `pasco refine` keeps reading `SKILL.md`.

- **Short** (`posting.yaml`): `linkedin`, `x` — char limits, hashtags.
- **Long-form** (`longform.yaml`, #266): `substack`, `ghost`, `medium`, `devto`,
  `hashnode`, `wordpress`, `listmonk` — required fields (`title`/`dek`), an
  editorial word band, and `export: api | paste` (Substack/Ghost are paste
  surfaces). The word band is house style, not a platform limit: cite a source
  before encoding a hard cap.

Every long-form channel also carries its judgment layer (#361): the `post.md` the
short channels already have, plus a `SKILL.md` that they do not ship.

- `post.md` — what a piece on that channel is for, its shape, its voice, and its
  GEO and i18n policy, plus what `export: api | paste` means for the writing.
- `SKILL.md` — the channel skill document: mission, when the skill runs, the
  flow, the pointers to the contract, and the suggested model in its frontmatter.
  `pasco refine` resolves it, but refine emits a **profile** task that expects the
  profile-skill `checks.yaml` (not shipped for these channels); the path a post
  channel takes is `pasco post` with `longform.yaml`.

`longform.yaml` stays the contract: required/optional fields, the word band and
`export` are declared there, and the prose explains them instead of restating
their numbers. A channel's *dated* platform sources live in the contract's
`sources[]`; a claim the contract does not already carry needs its own source
(URL + date + tier) before it enters either file. The post shape is Markdown
beside the rule file — not the `research/` + `playbook.md` + `checks.yaml` trio,
which belongs to the profile skills above.

Neither shape is projected to harnesses yet — see `docs/post-mvp.md`.
