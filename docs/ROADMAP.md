# Roadmap — de acá a lo planificado

> **Generado** 2026-09-24 · **actualizado** 2026-10-26 (estado de publicación y la página
> release-bound; prep de `v0.3.6`) desde el estado verificado del repo (no del declarado).
> Canónico del plan: `docs/SPEC.md` §12. Este documento agrega **qué está realmente hecho**
> y **en qué orden conviene seguir**, con la evidencia de cada afirmación.
> Regenerar/corregir cuando la evidencia cambie.

## Estado real (verificado, no declarado)

| Milestone | SPEC dice | Estado real | Evidencia |
|---|---|---|---|
| **M1** spec + schema + core + CLI skeleton | ✅ | **✅ cerrado** | `schema/`, `packages/core` (10 archivos de test), CLI con 8 comandos |
| **M2** renderer github-readme + CI + dogfood | ✅ | **✅ cerrado** | `packages/renderers/github-readme`; el README real de `ChristianLuciani/ChristianLuciani` (10.3 KB) lleva el marker generado |
| **M3** SOTA research + skills v1 + `pasco refine` | pendiente | **⚠️ parcial** — skills ✅ y **viajan con el paquete** (copia generada `packages/cli/skills/` en `files`, #253; `pasco skills:export` #254); `refine` parcial (template + `--choose`; el flujo completo es M3) | header PARTIAL de `packages/cli/src/commands/refine.ts` (re-verificado 2026-10-24) |
| **M4** renderers linkedin/upwork/x/researchgate/substack + `pasco check` + ledger | pendiente | **⚠️ parcial** — ledger ✅ (D18), `check` parcial, los renderers M4 ✗ | `deployments` en schema (v1.3); `check.ts` ejecuta reglas offline M6/M7/M8 + limits (`CHECK_OWNER`, `packages/cli/src/commands/check.ts`; catálogo `content/checks.yaml`); el repo tiene 8 renderers (GitHub ×2 + la familia funding-paste entregada en `0.2.0`, D16/D17) — los M4 no (verificado 2026-10-24, `ls packages/renderers/`) |
| **M5** web renderer + template release + CONTRIBUTING | pendiente | **⚠️ parcial** — template release ✅ (`profile-data-template` PUBLIC, #273) y CONTRIBUTING existe; web renderer ✗ | `gh repo view ChristianLuciani/profile-data-template --json visibility` → `PUBLIC` (2026-10-23); sin `packages/renderers/web` (2026-10-24) |
| **M6** brand flavor | ✅ | **✅ cerrado** | `flavor: brand`, `github-org` renderer, `skills/github-org/`, `templates/profile-data-brand` |
| **M7** evidence core | ✅ | **✅ cerrado** | schema v1.4 (`credentials[]`/`artifacts[]`), `registryCheck`, `hasCredential` en JSON-LD |
| **M8** media pipeline | ✅ | **✅ contrato sí, deploy no** | `assets/` + `manifest.json` + `collectMedia` en core; los playbooks de deploy son M4 |
| **M9** training-time corpus presence | ⏳ contrato sí, decisión **deferida** (Q10, post-M3) | **✗ no empezado** — piso ya definido: **privado-first** (bloquea crawlers de entrenamiento, sin licencia abierta) con opt-in explícito del dueño | `docs/research/03-training-time-visibility.md` (PR #135 + corrección de consentimiento, 2026-10-05); SPEC §12 M9 + §14 Q10 |

**Fuera de los milestones — lo que la serie `0.2.0` → `0.3.6` entregó (2026-10-09 → hoy):**

- **Distribución resuelta (#105, cerrado)**: `@profile-as-code/cli` en npm — `0.2.0`
  (2026-10-09T23:24:37Z) y `0.3.0` (2026-10-11T03:43:27Z, `latest`), con GitHub Releases
  creados por el run del `workflow_dispatch` (el push del tag solo anuncia)
  [OFICIAL] [WEB: registry.npmjs.org + `gh release list`, 2026-10-24].
- **Publicación verificable end-to-end (SPEC §20.1, #242)**: `pasco status` deriva
  `sync` / `artifact` / `limits` contra la SSOT, y `--completeness` es coverage de
  publicación; los caps del catálogo #240 viven en `packages/cli/src/limits.ts`.
- **Página release-bound (#277/#278/#279)**: landing + 5 documentos proyectados (START-HERE
  incluido, #260), gates `site-check`/`version-check`, y el deploy sale del commit del
  release (job `site` de `.github/workflows/release.yml` → `pages.yml`). La página viva hoy
  (2026-10-24) es la landing anterior; la nueva sale con el primer release bajo esta
  maquinaria.
- **Scaffold + on-ramps**: tres granos (`content/` identidad · `profiles/` generado ·
  `posts/` stream) en los templates de `pasco init` (#267); `profile-data-template` PUBLIC
  (#273); hosted on-ramp declarado **v1 non-goal** con trigger de reapertura (#221/#222,
  SPEC §2).
- **Repo público + hygiene**: la reconciliación del flip de visibilidad (#293) y los issue
  templates canónicos (#294) quedaron medidos y fechados en sus documentos.
- **Release 0.3.6 (2026-10-26)**: schema v1.10/v1.11 — answer-engine surface (#288) y
  `identity.nationality` (#334); geoCheck v2 con sus códigos de citability (#289);
  `pasco edit` S1–S3 (epic #247); publicación del cohort de cinco paquetes (#301);
  funding rails y el lock anti-carreras del writer (#332).

**Lectura:** el motor cubre su contrato, la distribución está resuelta y la publicación es
verificable de punta a punta. Lo que falta **no es motor — es superficie**: el flujo completo
de `refine` (M3), los renderers M4 y el web (M5); detalle en `packages/cli/README.md`.

---

## Orden recomendado

El criterio de orden es **desbloquear valor con la menor cantidad de piezas nuevas**. Con
`pasco` publicado y la publicación verificable, el multiplicador es el flujo completo de
refinamiento y cada renderer nuevo: suman canal sin tocar el motor.

### Ahora — el producto prometido

**1 · `pasco refine` real** → M3
Es **el diferenciador del producto** (§1 goal 3: *"intent-driven texts como N variantes que el
usuario elige"*). Hoy es parcial (D10/D11/D13: emitir el template del agent task y registrar la
variante elegida con `--choose`); falta el flujo completo (generate → user picks → commit active),
y sin él `pasco` es válido pero no es lo que el proyecto promete. Además es la pieza que las
platform skills — que ahora viajan con el paquete (#253) — existen para alimentar.

**2 · Epic `pasco edit` (#247)** — la superficie de edición sin YAML a la vista, para
humanos y agentes. S1 (#248), S2 (#249) y S3 (#250) están implementados: resuelve un contract path,
previewa las líneas que el artefacto de `build` cambia, escribe un valor con splice por
rango (comentarios y layout intactos, diff de una línea, bloques rechazados, no-op 0 +
`noop`, validación + rename atómico + lock anti-carreras) y reporta el **impacto por
superficie** derivado del ledger §19. Faltan S4–S5 (#251–#252: caps antes del paste y
contrato de agente); los slices **consumen** los ejes de publicación de #242 en vez de
una segunda tabla de caps.

### Después — superficie por plataforma

**3 · Los renderers de M4** (linkedin → upwork → x → researchgate → substack)
Un adapter por vez, cada uno con su skill ya escrita. Acá la arquitectura ya está probada dos
veces (`github-readme`, `github-org`), así que es trabajo de adaptación, no de diseño.
**Criterio de orden:** el orden del SPEC (LinkedIn primero) es el correcto — es la plataforma
donde el drift duele más.

**4 · `pasco check` completo** → M3/M4
Cierra el catálogo de reglas. Depende de los renderers: `checks.yaml` por skill declara límites
por plataforma, y sin el renderer no hay qué medir.

### Después — el sitio

**5 · Web renderer (M5)**
Es el que **consume** la identidad de entidad que se acaba de construir (#103): `@id`, `sameAs`,
`mainEntityOfPage`. También es donde `role: aggregator` cobra sentido — hoy el mapeo a
`mainEntityOfPage` es **declarativo**, y M5 es su consumidor (documentado en SPEC §15.4).
Depende de: nada. Puede hacerse en paralelo con 3/4 si hay dos sesiones.

**6 · Deploy playbooks + media a superficie pública** → M8/M4
Cierra el pipeline de media: hoy el engine bundlea assets, pero publicarlos es M4.

### Después — comunidad

**7 · #299** — el residuo contable de la reconciliación pública (#293): las filas de
checklist y la sección libre de `docs/STANDARDS.md` que siguen en presente con la premisa
vieja. Chico, docs-only; una sesión lo cierra.
**8 · #175** — el estrato de respuesta externa se publica cuando existan 3 PRs externos
(bloqueado por naturaleza — el trigger es el mundo, no el repo).

### Transversal — no milestone

**9 · #274** — gate de CI: superficies públicas no referencian tooling/repos que el lector
no puede abrir (inventario de testigos + gate).
**10 · #280** — i18n: ¿versión en español de la página? (D8, hreflang y el coste de
mantener dos corpus) — decisión abierta (`needs-decision`), no trabajo pendiente.

---

## Lo que este roadmap NO incluye (deliberadamente)

**Hosted path (no account, no terminal) — declared v1 non-goal.** None of §9.2's three
on-ramps reaches a visitor who has neither an account nor a terminal; the reopening trigger
lives in [SPEC §2](SPEC.md) (`#122`, closed as a non-goal).

Del análisis de identidad de esta sesión (corpus en `identeco-cifereca`):

| Ítem | Por qué no está acá |
|---|---|
| **Portabilidad / migración de identidad** ("empieza en Facebook, termina en ResearchGate") | **Problema abierto del campo.** W3C DID ofrece primitivas pero los métodos no las soportan consistentemente (S-06). Documentado, no construido. |
| **Canales de contacto** (WhatsApp Business, punto de venta, board) | Sin taxonomía consensuada. `identity.email` ya fue un parche en esa grieta (#71). |
| **La clase `aggregator` como estándar** | El campo la reconoce, ningún estándar la nombró. Seguimiento en `identeco-cifereca#2`. |

Se agregan al roadmap **cuando el campo consensúe** — no antes. Construirlos hoy sería
retrofittear un modelo que el propio campo todavía está discutiendo.

---

## Dependencias entre ítems

```
pasco publicado (0.2/0.3) ───┐
                             ├──► permite que 3/4/5 tengan usuarios reales
M3 refine ───────────────────┤
                             │
M4 renderers ───► M4 check ─┘
                     │
M5 web ──────────────┴──► M8 deploy playbooks
     └──► consume #103 (@id/sameAs/roles)
```

**Camino crítico:** `M3 refine` → `M4 renderers` → `M4 check`.
**Paralelizable:** `M5 web` con `M4 renderers` (tocan paquetes distintos, y `structured-data.ts`
ya expone el contrato que M5 necesita).