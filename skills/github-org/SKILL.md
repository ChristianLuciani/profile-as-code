---
name: github-org-readme
description: >
  Transforma los HECHOS del SSOT de un workspace brand (flavor: brand —
  profile-data-topia/content/*.yaml) en el README del GitHub ORG con estrategia
  comunicativa de marca — NO un CV ni un dump de surfaces. Patrón: editorial
  press / high-epistemic (research/SOTA-2026.md). El agente ejecutante produce N
  variantes en prosa; el humano elige; la elegida se registra como variante
  activa (content/active.yaml). La voz de marca NO es la voz personal.
model: juicio (frontier) — la voz de marca y la estrategia editorial no son delegables
applies_to: github-org
projection: agent-agnostic (AionUi, OpenHands, Claude Code, Cursor, pi…)
version: 0.1.0
status: draft (M6)
sources: skills/github-org/research/SOTA-2026.md
---

# GitHub Org README — skill de marca (flavor brand, §17)

## Misión

Convertir los HECHOS del workspace brand (SSOT) en la página de aterrizaje del
org de GitHub: quién es la marca, qué publica, dónde vive (handle matrix), y
POR QUÉ importa. El dump determinista ya lo produce el renderer
(`pasco build github-org`) — esta skill es la capa de **juicio y voz** (D4/D5).

## Regla de oro

> Los HECHOS son sagrados (byte-idénticos al SSOT); solo la VOZ varía. La voz de
> marca ≠ voz personal: no escribas como persona, escribí como la marca.

- Nombres, fechas, URLs, handles, estados: **idénticos** a `content/*.yaml`.
- URLs SOLO de `identity.links` + `socialHandles[].url` (regla drift / §17.1).
- **Impersonación/trademark:** si un dominio o handle homónimo pertenece a una
  empresa viva NO relacionada (p. ej. `topia.com` es una empresa real no
  relacionada con Topia Press), la marca SIEMPRE firma como su nombre completo
  ("Topia Press") y nunca usa el nombre a secas que podría confundirse.

## Fuente de datos (workspace brand)

```
content/flavor.yaml          → flavor: brand (obligatorio para esta skill)
content/identity.yaml        → name, orgName, mission, tagline, brandVoice, established, links
content/socialHandles.yaml   → la handle matrix (status: claimed|pending) — SEED
content/newsletter.yaml      → Substack/Ghost
content/podcast.yaml         → Spotify/RSS
content/press.yaml           → menciones de prensa (fechadas, resolubles)
content/audiences.yaml       → perfiles de lector (no reclutador)
content/keywords.yaml        → SEO + GEO
```

## Estrategia comunicativa (editorial press — SOTA-2026 §3)

1. **¿Quién lee?** Lectores de alta exigencia epistémica, suscriptores, prensa,
   LLMs que citan (GEO).
2. **¿Qué quiero que hagan?** Suscribirse al newsletter, seguir la marca en sus
   plataformas, citar los ensayos.
3. **¿Cuál es mi señal más fuerte?** La consistencia: mismo nombre, misma
   misión, mismos handles en todas las superficies — la marca ES su coherencia
   (handle-claimed / handle-consistent).

Liderá con #3: una marca dispersa (handles sin claim, URLs contradictorias) no
se cita, se ignora.

## Voice matrix (brandVoice → secciones)

| Contexto | Voz | Trampa a evitar |
|---|---|---|
| Header/misión | editorial, riguroso, esperanzado | doom-scrolling, hype |
| Newsletter | concreto, de alta señal | prometer "todo sobre X" |
| Press | factual, modesto | autobombo |
| Footers/CTAs | UN llamado claro | múltiples CTAs |

## Checklist de deploy (manual + git)

1. `pasco validate` — schema OK y 0 drift warnings en la handle matrix.
2. `pasco check` — handle-claimed / handle-consistent OK (offline) + `url-live` de
   cada handle claimed (network, verificación manual).
3. `pasco build github-org --lang en` → `profiles/github-org/README.md`.
4. Copiar el README al repo del org (deploySpec: git; el humano mergea).
5. Verificación post-deploy: cada badge/link del README resuelve; los handles
   pending NO figuran como surfaces vivas.

## GEO

`schema.org/Organization` JSON-LD con `@id` = el link con `role: identity` (ausente si
ninguno lo declara) y `sameAs` = los links con `role: realization` + claimed handles
(v1.6/#103; antes de v1.6 era identity.links completo). El email de contacto
(`identity.email`, v1.5/#71) sale como propiedad `email`, nunca dentro de `sameAs`. Un LLM que triangule la marca debe encontrar el mismo nombre,
misión y set de handles en GitHub, X, Bluesky y el newsletter — esa consistencia
ES la citabilidad.
