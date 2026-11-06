# Skills por plataforma

Cada plataforma tiene UNA skill: el conocimiento operacional SOTA de esa red,
versionado y contribuible. Las skills son la capa de *juicio* que complementa
al renderer (capa determinista de código).

## Estructura de una skill

```
skills/
├── FACTS-VS-NARRATIVE.md # la regla de dos ejes, UN hogar; cada SKILL.md la referencia (SPEC §21.8)
└── <plataforma>/
    ├── SKILL.md              # OBLIGATORIO: frontmatter (nombre, descripción, modelo sugerido) + flujo + lector/ángulo
    ├── research/             # investigación versionada, con fuentes fechadas
    │   └── SOTA-<año>.md
    ├── playbook.md           # pasos de deploy manual + verificación post-pega
    └── checks.yaml           # premisas machine-readable: la unión con content/checks.yaml decide qué corre; los caps salen del catálogo del workspace cuando declara checks (entero, sin merge por fila) o de los defaults del paquete (SPEC §7)
```

Every `skills/<plataforma>/` carries a `SKILL.md` — the profile channels and the
post channels alike (#462: `linkedin` and `x` shipped `post.md`/`posting.yaml`
with no strategy file, which is where a homogenized narrative went unnoticed).
The two-axis rule is **one** file, cited by every skill. A skill may restate its
own platform's golden rule, but it must not contradict the shared statement — in
particular, **order is narrative** (SPEC §21.2), so ordering facts differently is
not a fact change.

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
6. `substack` — newsletter/audiencia propia: perfil + publicación (bundle de perfil) y post largo (`post.md`)

## Brand flavor (M6, §17)

`github-org` — README del GitHub **org** para workspaces `flavor: brand`: voz de
marca (≠ voz personal), handle-matrix checks (`handle-claimed`/`handle-consistent`,
offline en `pasco check`), trademark/impersonación. Ver `skills/github-org/`.

## Post skills (MVP, #264/#266/#361)

The week-1 post experiment uses a **different shape** from the profile skills:
`skills/<platform>/post.md` (judgment) + a machine-readable rule file.
`pasco post` reads them; `pasco refine` reads `SKILL.md`, whose role differs by
channel (below).

- **Short** (`posting.yaml`): `linkedin`, `x` — char limits, hashtags.
- **Long-form** (`longform.yaml`, #266): `substack`, `ghost`, `medium`, `devto`,
  `hashnode`, `wordpress`, `listmonk` — required fields (`title`/`dek`), an
  editorial word band, and `export: api | paste` (Substack/Ghost are paste
  surfaces). The word band is house style, not a platform limit: cite a source
  before encoding a hard cap.

Every post channel also carries its judgment layer: the `post.md` — plus a
`SKILL.md`, whose role depends on the channel.

- `post.md` — what a piece on that channel is for, its shape and its voice, plus
  what `export: api | paste` means for the writing. The channel's GEO/i18n policy
  lives in `post.md` and/or in its `SKILL.md`'s own section: the short channels
  (`linkedin`, `x`) state it only in the skill, the long-form channels state it
  in both — and where they do, `post.md` is the one to read first.
- `SKILL.md` — for **every channel except `substack`**, the channel strategy
  document (#361 for the long-form channels, #462 for the short ones — `linkedin`
  and `x` were the two channels with no strategy file, and that is exactly where a
  narrative copied across surfaces went uncited): mission, when the skill runs,
  the flow, the pointers to the contract, and the suggested model in its
  frontmatter. It is a strategy reference, not a bundle input: `pasco post task`
  carries the contract and `post.md`, never this file.
- `substack` is the channel that ships BOTH shapes as first-class (#482):
  `skills/substack/SKILL.md` is its **profile/publication** skill (with
  `checks.yaml` + `playbook.md`, like the profile platforms above), and
  `post.md` + `longform.yaml` are its long-form post skill. The slot is the
  profile one, which is what `pasco refine` reads.

**`pasco refine <channel>` reads the PROFILE skill.** For a profile platform —
`substack` included after #482 — refine resolves `SKILL.md` and emits a profile
task that saves to `profiles/<channel>/variants/<id>.md`. A post is never
written by refine: the post path is `pasco post` with `posting.yaml` /
`longform.yaml`, on every channel. That is why the old warning ("do not use
refine on a post channel") is gone for `substack` — the slot it warned about was
the post skill occupying the profile slot. For the remaining long-form channels
the engine still cannot tell the two apart (their `SKILL.md` documents the post
channel), so refine there resolves a file that was written for the post;
separating those two shapes is an engine matter, not something a skill can fix.
(`checks.yaml` is not the cause: `pasco check` reads that catalog and reports
"no catalog" without failing when it is missing.)

`longform.yaml` stays the contract: required/optional fields, the word band and
`export` are declared there, and the prose explains them instead of restating
their numbers. A channel's *dated* platform sources live in the contract's
`sources[]`; a claim the contract does not already carry needs its own source
(URL + date + tier) before it enters either file. The post shape is Markdown
beside the rule file — not the `research/` + `playbook.md` + `checks.yaml` trio,
which belongs to the profile skills above. `substack` is the one channel that
carries both: the trio for its profile/publication surface and `post.md` +
`longform.yaml` for the issue.

Neither shape is projected to harnesses yet — see `docs/post-mvp.md`.
