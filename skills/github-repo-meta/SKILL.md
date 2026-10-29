---
name: github-repo-meta
description: >
  Superficie de presencia `github-repo-meta` (D23, #262): la metadata del
  artefacto de código — descripción del repo, topics, social preview, release
  notes y la página npm derivada. Convierte un release en presencia visible
  sobre el repo, sin inventar hechos: la descripción y las notas salen del
  release plan (`pasco release plan`) y del SSOT, nunca de la memoria del agente.
model: mecánico (la copy es corta y acotada; el juicio de posicionamiento vive en
  la skill de la README del perfil)
applies_to: github-repo-meta
projection: agent-agnostic (AionUi, OpenHands, Claude Code, Cursor, pi…)
version: 0.1.0
status: draft (D23, #262)
sources: "platforms/registry.yaml (kind: repo-meta) · docs/SPEC.md §22"
---

# GitHub repo metadata — skill de superficie repo-meta (D23)

## Misión

Que un release exista como **presencia**: el repo se encuentra, se entiende y se
comparte. El motor no renderiza esta superficie (no hay renderer: es HTML/API de
GitHub); lo que el motor SÍ da es el **plan**: `pasco release plan <id>` nombra la
superficie, su estado derivado del ledger y la **espina factual** del release. Esta
skill es la capa de juicio que convierte esa espina en metadata publicable.

## Regla de oro

> La metadata del repo describe el **artefacto**, no a la persona. El perfil
> (github-readme) es la voz; `github-repo-meta` es la ficha: qué es esto, para
> quién, y qué cambió.

- La descripción NO repite el positioning personal: dice qué hace el repo.
- Los facts (versión, fecha, link) salen del release row y del SSOT; si un dato
  no está, no se escribe.
- Un release = una pasada. No optimices metadata sin release: sin evento, la
  superficie queda `never` en el plan (y eso es correcto, D23).

## Flujo

1. **Plan**: `pasco release plan <release-id> --json` → la fila
   `github-repo-meta` (estado) + `baseText[kind=repo-meta]` (la espina factual).
   Sin `releases[]` en el workspace, el comando falla con la razón: agregá el
   release primero (schema v1.15).
2. **Composición** (juicio, esta skill):
   - `description` ≤350 chars, la promesa del artefacto + una señal de para quién.
   - `topics` ≤20, minúsculas, guiones; genéricos primero, específicos después.
   - release notes: `baseText` como primer párrafo + `changedUnits` como bullets
     verificables; nada de métricas sin fuente.
   - social preview 1280×640 (el preview se sube a mano: no hay API).
3. **Deploy** (API de GitHub, D9):
   ```sh
   gh repo edit --description "<description>" --add-topic <topic> …
   gh release edit <tag> --notes-file <notas.md>
   ```
4. **Verificación** (playbook.md, sección "Verificación post-deploy"): la
   lectura de vuelta con `gh repo view --json description,repositoryTopics` y la
   inspección visual del social preview.
5. **Cierre del loop**: en v1 el ledger solo direcciona las superficies del enum
   de perfiles; `github-repo-meta` no tiene record y el plan la lee `never`. Es
   un límite declarado (D23): el plan nombra lo que falta tocar; extender la
   clave de superficie del ledger es un cambio de contrato aparte.

## Límites y trampas

- **Descripción duplicada**: si el repo y la página npm dicen lo mismo, es señal
  de que el release no cambió nada relevante; no reescribas por inercia.
- **Topics como hashtags**: no son keywords de marketing; son el índice por el
  que un desconocido encuentra el artefacto.
- **Notas = changelog completo**: el release note es la parte que le importa a
  quien evalúa adoptar; el detalle vive en CHANGELOG.
- **Social preview desactualizado**: es la única pieza sin API; verificala a
  mano o no cuenta como publicada.

## Checks

`checks.yaml` declara los criterios con la misma forma que el resto de las skills
(`rule` del catálogo, `platform: github-repo-meta`). En v1 `pasco check` no
ejecuta una superficie fuera del enum de perfiles: el catálogo queda declarado
para cuando la superficie tenga renderer, y hoy la verificación es la del
playbook.
