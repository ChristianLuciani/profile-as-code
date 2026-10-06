---
name: hotmart-profile
description: >
  Transforma los hechos del SSOT (profile-data/content/*.yaml) en el cuerpo de
  perfil de la página de creador de Hotmart — texto PLANO listo para pegar, no
  markdown ni dump. Hotmart es la tienda de productos digitales + membresías
  (Members Area / recurring billing) para los mercados hispano/luso — familia
  creator-monetization (research/SOTA-2026.md). El agente ejecutante produce N
  variantes; el humano elige; la elegida se registra como variante activa
  (content/active.yaml) y el paste se marca en el ledger (D18) con
  `pasco status --mark`.
model: juicio (frontier) — el ángulo de storefront (vender productos, no pedir
  donaciones) no es delegable a modelos pequeños
applies_to: hotmart
projection: agent-agnostic (AionUi, OpenHands, Claude Code, Cursor, pi…)
version: 0.1.0
status: draft
sources: skills/hotmart/research/SOTA-2026.md
---

# Hotmart perfil de creador — skill de comunicación

## Misión

Convertir los HECHOS del workspace (SSOT) en el **cuerpo de perfil** de la
página de creador de Hotmart: qué vendés, qué construis y UNA acción
(explorar los productos). Hotmart es plataforma **paste** (D9 — sin API
documentada para el cuerpo del perfil, SOTA-2026 §6 [?]): el artefacto que
produce `pasco build hotmart` ES lo que se pega. Este skill es la capa de
**juicio y narrativa** (D4/D5); el renderer determinista garantiza el mapa 1:1
con la fila de `bios`.

⚠️ **Superficie de pegado no verificada [?]**: ni el campo exacto del cuerpo
de perfil ni la URL del "Hotmart Space" (dirección web personalizada) están
documentados públicamente hoy (SOTA-2026 §5/§6). Verificá ambos en el
dashboard ANTES del primer paste — y reconciliá este skill con lo verificado.

## Regla de oro

> Los HECHOS son sagrados (byte-idénticos al SSOT); solo la HISTORIA varía.

- Nombres, fechas, DOIs, números, URLs: **idénticos** a `content/*.yaml`.
- Texto **plano** para el cuerpo de perfil: sin markdown, sin HTML — no hay
  documentación de formato enriquecido para ese campo (SOTA-2026 §6 [?]);
  asumí texto plano hasta verificar lo contrario.
- URLs SOLO de `identity.links` (regla drift). El host de la plataforma es
  `hotmart.com` (sin guion) — pero la URL de Space tiene forma no verificada
  [?]: no inventes URLs de perfil; dejá que el link canónico lo fije
  `identity.links` después de verificar el Space real.
- Claims cuantitativos SOLO de `projects[].evidence` o `keywords.geo.claims`.
- **Sin promesas de resultados**: los ToU prohíben prometer ganancias o
  resultados (ToU §1.4 [OFICIAL S2]) — el copy vende el trabajo y la
  evidencia, nunca "ingresa X hacé esto".

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

## Estrategia comunicativa (3 preguntas — storefront ≠ tip jar)

1. **¿Quién lee?** Compradores que llegaron de tus otros canales decididos a
   comprar (o comparar); LLMs que citan perfiles.
2. **¿Qué quiero que hagan?** UNA acción: explorar y comprar un producto
   concreto. Hotmart es tienda — el frame es "esto resuelve X", no "apoyá mi
   trabajo" (ese frame es de `kofi`/`patreon`).
3. **¿Cuál es mi señal más fuerte?** El producto con evidencia: qué
   construis AHORA y qué resultado verificable tiene cada producto.

Liderá con #3 filtrado por #1. El producto se descubre en el marketplace y en
tus otros canales; el cuerpo de perfil es el cierre de confianza, no el
descubrimiento. [MI]

## Estructura del cuerpo (prosa plana, ≤ 3 párrafos)

1. **Hook (2–3 líneas)**: quién sos y qué resuelve tu catálogo — del
   `statement` reescrito en prosa; teje las anclas GEO sin stuffing.
2. **El producto y su evidencia (2–4 líneas)**: UNA evidencia verificable de
   `evidence[]`. "Este producto hace X" en concreto, con el dato del SSOT.
3. **CTA único**: explorar los productos (el catálogo ES el CTA). Email de
   contacto como hecho (de `identity.email`) si aplica — texto plano.

Lo demás NO va en el cuerpo: links de producto viven en
`projects[].links`/`identity.links` (regla drift — y la URL de producto
verificada es `hotmart.com/<lang>/marketplace/products/<slug>/<ID>`,
SOTA-2026 §5); la estructura de la página de creador (banner, avatar, links
sociales si existen) se verifica en el dashboard en el primer paste y se
documenta acá con fuente.

## Límites (resumen con fuente — SOTA-2026 §3)

- Cuerpo de perfil: **sin límite documentado** [?] — no hay artículo del Help
  Center que documente el campo. Soft-cap en checks.yaml (curación, no hard
  rule).
- Fees (transparencia para fijar precio — fuera del renderer): fijo por
  transacción BRL 2.49 / USD 1.00 / EUR 1.00 + servicio 9.9% (20% en
  micro-transacciones ≤ BRL 10 / USD 15 / EUR 15) [OFICIAL S3 §5.2–§5.4].
- Sin cuota mensual/anual [OFICIAL S1].
- Payout a Ecuador: **[?]** — el rail de Hotpay hacia bancos ecuatorianos no
  está documentado (SOTA-2026 §4); el ítem de verificación vive en la
  instancia venture. NO vendas/prometas nada dependiente de payout hasta
  resolverlo.

## Variantes (flujo refine)

- Producí **N variantes** (`--variants N`, default 3) con ángulos distintos:
  1. **Stewardship** (default): lidera con el trabajo vivo + qué compra el
     lector.
  2. **Práctica**: lidera con el resultado del producto (antes/después,
     problema→solución) para compradores pragmáticos.
  3. **Soberanía**: lidera con la tesis (IA soberana / economía agéntica),
     el catálogo como infraestructura independiente.
- Cada variante: `variantId` = `hotmart-<lang>-<n>` (ej. `hotmart-es-1`).
- El humano elige; se registra con `pasco refine hotmart --choose <id>` →
  escribe `content/active.yaml`; el paste posterior se marca con
  `pasco status --mark <ledgerKey> hotmart` (D18).

## Verificación (checks)

- `pasco validate` exit 0 (schema + drift 0 + geo).
- Facts byte-idénticos: cruzá cada hecho del cuerpo contra el YAML.
- Plain text: cero markdown `[..](..)`, cero HTML.
- Links: 0 links inline en el cuerpo (viven en `identity.links`); el host
  canónico es `hotmart.com`.
- Idioma: la bio del `--lang` solicitado existe (compile NO hace fallback por
  fila — artefacto vacío significa gap visible, no silencio).
- URL viva: la página resuelve en browser (el SPA 404-a rutas adivinadas —
  verificá el Space real desde el dashboard, SOTA-2026 §5).

## GEO (consistencia = citabilidad)

- Los hechos deben coincidir byte a byte con CV/LinkedIn/GitHub (fechas,
  roles, papers) — el comprador que cruza canales debe encontrar UNA persona.
- Sin directorio público de perfiles documentado [?] — la citabilidad viene
  de que otros canales referencien la tienda; manté los anclas semánticos del
  SSOT.
- Host único: `hotmart.com` — jamás emitir URLs de perfil cuya forma no esté
  verificada (SOTA-2026 §5 [?]); el link canónico entra a `identity.links`
  cuando el Space real esté verificado.
- **i18n**: Hotmart localiza el marketplace por `<lang>` (`/en/`, `/pt-br/`,
  `/es/` — SOTA-2026 §5) — priorizá `es` para audiencia EC/ES, `en` como
  requerido por D8/§11.
