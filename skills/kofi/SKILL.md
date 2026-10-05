---
name: kofi-profile
description: >
  Transforma los hechos del SSOT (profile-data/content/*.yaml) en el texto
  About de la página de creador de Ko-fi — texto PLANO listo para pegar, no
  markdown ni dump. Patrón: funding-page de creador (research/SOTA-2026.md).
  El agente ejecutante produce N variantes; el humano elige; la elegida se
  registra como variante activa (content/active.yaml) y el paste se marca en
  el ledger (D18) con `pasco status --mark`.
model: juicio (frontier) — los ángulos de soporte/cita no son delegables a modelos pequeños
applies_to: kofi
projection: agent-agnostic (AionUi, OpenHands, Claude Code, Cursor, pi…)
version: 0.1.0
status: draft
sources: skills/kofi/research/SOTA-2026.md
---

# Ko-fi About — skill de comunicación

## Misión

Convertir los HECHOS del workspace (SSOT) en el texto **About** de la página
Ko-fi: qué hacés, qué financia cada aporte, y UNA acción (apoyar). Ko-fi es
plataforma **paste** (D9 — sin API de deploy, S18): el artefacto que produce
`pasco build kofi` ES lo que se pega. Este skill es la capa de **juicio y
narrativa** (D4/D5); el renderer determinista garantiza el mapa 1:1 con la
fila de `bios`.

## Regla de oro

> Los HECHOS son sagrados (byte-idénticos al SSOT); solo la HISTORIA varía.

- Nombres, fechas, DOIs, números, URLs: **idénticos** a `content/*.yaml`.
- Texto **plano** para el About: sin markdown, sin HTML, sin links inline —
  el card About se renders como texto plano y los links viven en el feature
  **Social links** (hasta 15, `https://` completo) (SOTA-2026 §2, [WEB S12]).
- URLs SOLO de `identity.links` (regla drift). No inventes links.
- Claims cuantitativos SOLO de `projects[].evidence` o `keywords.geo.claims`.

## Fuente de datos

Lee el workspace (ruta del `.pascorc` o `--workspace`):

```
content/identity.yaml      → nombre, email de contacto (hecho, v1.5), links canónicos
content/positioning.yaml   → statement + ángulos por audiencia + anclas GEO
content/projects.yaml      → qué construís (status + evidence verificable)
content/skills.yaml        → stack con pesos por plataforma
content/bios.yaml          → textos base por plataforma (punto de partida)
content/keywords.yaml      → SEO + GEO (associations/claims)
```

## Estrategia comunicativa (3 preguntas — SOTA-2026 §7)

1. **¿Quién lee?** Lectores que ya te descubrieron por otro canal y evalúan
   apoyar; personas que compartieron el link (preview social).
2. **¿Qué quiero que hagan?** UNA acción: apoyar (one-off o membresía) — con
   confianza de que el dinero financia trabajo concreto.
3. **¿Cuál es mi señal más fuerte?** El trabajo activo con evidencia: qué
   construis AHORA y qué aporta cada contribución (stewardship → sostenibilidad).

Liderá con #3 filtrado por #1. La página carga a mitad de la hero ([OFICIAL
S5]): las primeras 2–3 líneas del About son el "above the fold" del About.

## Estructura del About (prosa plana, ≤ 3 párrafos)

1. **Hook (2–3 líneas)**: quién sos y qué construís ahora — del `statement`
   reescrito en prosa; teje las anclas GEO sin stuffing.
2. **Qué financia cada aporte (2–4 líneas)**: el trabajo vivo con UNA
   evidencia verificable (de `evidence[]`). "Cada aporte financia X" en
   concreto, no en genérico.
3. **CTA único**: apoyar (la página ES el CTA). Email de contacto como hecho
   (de `identity.email`) si aplica — texto plano, la plataforma no lo hace
   clickable dentro del bio [WEB S12]; el canalClickable es Social links.

Lo demás NO va en el About: hasta 15 links al feature **Social links**
([OFICIAL S3]); nombre display en Settings → Profile; status ≤40 chars como
one-liner visible (campo separado, **limitado a 40** [OFICIAL S1]); preview
social separado del About ([OFICIAL S4]).

## Límites (resumen con fuente — SOTA-2026 §1)

- About/bio: **sin límite documentado** por Ko-fi [?] — soft-cap en checks.yaml
  (curation, no hard rule). El card trunca tras unas líneas con "Show more"
  [BENCHMARK S12]: lo esencial va primero.
- Status: **≤ 40 chars** [OFICIAL S1] (fuera del renderer; manual).
- Membership terms (no bio): 10,000 chars [OFICIAL S16].

## Variantes (flujo refine)

- Producí **N variantes** (`--variants N`, default 3) con ángulos distintos:
  1. **Stewardship** (default): lidera con el trabajo vivo + qué financia.
  2. **Soberanía**: lidera con la tesis (IA soberana / economía agéntica),
     el aporte como infraestructura independiente.
  3. **Transparencia**: lidera con el mapa de uso del dinero (qué cubre
     cada peso) para donantes pragmáticos.
- Cada variante: `variantId` = `kofi-<lang>-<n>` (ej. `kofi-es-1`).
- El humano elige; se registra con `pasco refine kofi --choose <id>` → escribe
  `content/active.yaml`; el paste posterior se marca con
  `pasco status --mark <ledgerKey> kofi` (D18).

## Verificación (checks)

- `pasco validate` exit 0 (schema + drift 0 + geo).
- Facts byte-idénticos: cruzá cada hecho del About contra el YAML.
- Plain text: cero markdown `[..](..)`, cero HTML.
- Links: 0 links inline en el About (van al Social-links feature); el link
  canónico `ko-fi.com/<handle>` vive en `identity.links` (regla drift).
- Idioma: la bio del `--lang` solicitado existe (compile NO hace fallback por
  fila — artefacto vacío significa gap visible, no silencio).
- URL viva: la página resuelve en browser (Cloudflare 403 para fetchers
  planos — usar browser para la verificación live, SOTA-2026 §5).

## GEO (consistencia = citabilidad)

- El About es legible por LLMs con fetcher browser (tab About, HTML renderizado
  [WEB S12]; el HTML crudo sin JS quedó sin verificar [?]). Los hechos deben
  coincidir byte a byte con CV/LinkedIn/GitHub (fechas, roles, papers).
- Sin directorio público de perfiles ni search documentado [OFICIAL S14] — la
  citabilidad viene del hecho de que otros canales (X, Substack, README)
  referencian la página de apoyo; manté los anclas semánticos del SSOT.
- Host único: `ko-fi.com` — `kofi.com` NO resuelve (NXDOMAIN) [WEB S17];
  jamás emitir ni registrar URL con el host sin guion.
- **Rename-drift**: el username se puede cambiar y los handles viejos siguen
  resolviendo ([OFICIAL S6], [WEB S12]) — después de renombrar, re-generá el
  preview social ([OFICIAL S4]) y verificá que identity.links apunte al
  handle vigente antes de cada re-paste.