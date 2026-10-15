# Roadmap — de acá a lo planificado

> **Generado** 2026-09-24 · **actualizado** 2026-10-05 (+M9, post-merge PR #135) desde el estado
> verificado del repo (no del declarado).
> Canónico del plan: `docs/SPEC.md` §12. Este documento agrega **qué está realmente hecho**
> y **en qué orden conviene seguir**, con la evidencia de cada afirmación.
> Regenerar/corregir cuando la evidencia cambie.

## Estado real (verificado, no declarado)

| Milestone | SPEC dice | Estado real | Evidencia |
|---|---|---|---|
| **M1** spec + schema + core + CLI skeleton | ✅ | **✅ cerrado** | `schema/`, `packages/core` (10 archivos de test), CLI con 8 comandos |
| **M2** renderer github-readme + CI + dogfood | ✅ | **✅ cerrado** | `packages/renderers/github-readme`; el README real de `ChristianLuciani/ChristianLuciani` (10.3 KB) lleva el marker generado |
| **M3** SOTA research + skills v1 + `pasco refine` | pendiente | **⚠️ parcial** — skills existen, `refine` parcial (template + `--choose`; el flujo completo es M3) | `skills/github-readme/`, `skills/github-org/`; header PARTIAL de `packages/cli/src/commands/refine.ts` + `packages/cli/README.md` |
| **M4** renderers linkedin/upwork/x/researchgate/substack + `pasco check` + ledger | pendiente | **⚠️ parcial** — ledger ✅ (D18), `check` parcial, renderers ✗ | `deployments` en schema (v1.3); `check.ts` ejecuta reglas offline M6/M7/M8 (`CHECK_OWNER`, `packages/cli/src/commands/check.ts:29`) y lista el resto del catálogo `content/checks.yaml` como no ejecutado (M3/M4); solo 2 renderers |
| **M5** web renderer + template release + CONTRIBUTING | pendiente | **✗ no empezado** | Sin `packages/renderers/web`; CONTRIBUTING existe pero M5 pedía "completo" |
| **M6** brand flavor | ✅ | **✅ cerrado** | `flavor: brand`, `github-org` renderer, `skills/github-org/`, `templates/profile-data-brand` |
| **M7** evidence core | ✅ | **✅ cerrado** | schema v1.4 (`credentials[]`/`artifacts[]`), `registryCheck`, `hasCredential` en JSON-LD |
| **M8** media pipeline | ✅ | **✅ contrato sí, deploy no** | `assets/` + `manifest.json` + `collectMedia` en core; los playbooks de deploy son M4 |
| **M9** training-time corpus presence | ⏳ contrato sí, decisión **deferida** (Q10, post-M3) | **✗ no empezado** — piso ya definido: **privado-first** (bloquea crawlers de entrenamiento, sin licencia abierta) con opt-in explícito del dueño | `docs/research/03-training-time-visibility.md` (PR #135 + corrección de consentimiento, 2026-10-05); SPEC §12 M9 + §14 Q10 |

**Lectura:** el engine y el README raíz están alineados tras el alineamiento M-state (#117, PR #121):
`pasco` ✅ con `refine`/`check` 🚧, detalle en `packages/cli/README.md`. Lo que falta **no es motor
— es superficie**: más renderers (M4), el web (M5), y el flujo completo de `refine` (M3).

---

## Orden recomendado

El criterio de orden es **desbloquear valor con la menor cantidad de piezas nuevas**. Publicar
`pasco` es lo que convierte trabajo terminado en algo usable por otros; todo lo demás suma a un
motor que hoy nadie de afuera puede ejecutar.

### Ahora — desbloquear la distribución

**1 · Publicar `pasco`** → **#105** (implementation-ready)
Tres bloques de docs + una decisión del operador (visibilidad ↔ provenance). **No requiere
código**: `verify:pack` pasa. Es el mayor retorno por hora de todo el backlog, porque el
trabajo ya está hecho y solo le falta la puerta de entrada.

**2 · `pasco refine` real** → M3
Es **el diferenciador del producto** (§1 goal 3: *"intent-driven texts como N variantes que el
usuario elige"*). Hoy es parcial (D10/D11/D13: emitir el template del agent task y registrar la
variante elegida con `--choose`); falta el flujo completo (generate → user picks → commit active),
y sin él `pasco` es válido pero no es lo que el proyecto promete. Además es la pieza que las
platform skills (ya escritas) existen para alimentar.

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

**7 · `profile-data-template` release + CONTRIBUTING completo** → M5
**8 · #95 licence + CLA** — time-sensitive, antes de la primera contribución externa
**9 · #100 refresh de la status table** — housekeeping

**Hosted path (no account, no terminal) — declared v1 non-goal, outside the sequence.**
None of §9.2's three on-ramps reaches a visitor who has neither an account nor a terminal; the
reopening trigger lives in `docs/SPEC.md` §2 (`#122`, closed as a non-goal). Not work to design.

### Transversal — no milestone

**10 · #98 dependency gate de `packages/server`** — scope rule del D20, cuando ese paquete exista

---

## Lo que este roadmap NO incluye (deliberadamente)

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
#105 publicar ──────────────┐
                            ├──► permite que 3/4/5 tengan usuarios reales
M3 refine ──────────────────┤
                            │
M4 renderers ───► M4 check ─┘
                     │
M5 web ──────────────┴──► M8 deploy playbooks
     └──► consume #103 (@id/sameAs/roles)
```

**Camino crítico:** `M3 refine` → `M4 renderers` → `M4 check`.
**Paralelizable:** `M5 web` con `M4 renderers` (tocan paquetes distintos, y `structured-data.ts`
ya expone el contrato que M5 necesita).
