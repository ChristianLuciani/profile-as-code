# E2E dogfood — Christian Luciani · informe de cierre

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: el ciclo completo de un usuario no técnico sobre `@profile-as-code/cli@0.3.0` publicado en npm — instalación, loop del engine, 7 ediciones al SSOT, deploy a GitHub, vocabulario, y la verificación de que lo publicado es lo decidido · No cubre: las superficies manuales (LinkedIn, Upwork, X, ResearchGate, Substack) — **no se pegó ni se marcó ninguna** · el ledger de deploy quedó en `never` · el `--verify` no se corrió · as_of: 2026-10-20
>
> Si una superficie no aparece, no asumas que no existe: reportá el hueco.

## Veredicto

**El ciclo de publicación cerró, verificado al byte.** El ciclo de **registro** no: 62 unidades siguen en `never` porque las 5 superficies manuales no se pegaron ni se marcaron.

```
sha256(publicado en github.com/ChristianLuciani) = bfb0dbc35cd9
sha256(decidido en profiles/…/variants/gh-en-3.md) = bfb0dbc35cd9
→ ✅ PÚBLICO == DECIDIDO (40 líneas idénticas, 2026-10-20)
```

Esa igualdad **no existía en ningún momento anterior de este repo**: hasta hoy, lo publicado era una copia manual del 2026-08-11 y llevaba 9 líneas de diferencia con el SSOT, incluyendo un footer con el nombre pre-rename del CLI (`pac`).

## Tabla de evidencia

| # | Verificación | Método | Resultado |
|---|---|---|---|
| 1 | Instalación limpia del artefacto publicado | `npm i -g` + `sh -lc 'command -v pasco'` | ✅ `pasco 0.3.0`, dist sha256 `c94b339e…` idéntico al instalado en `/tmp` |
| 2 | `init` → `validate` → `build` en carpeta vacía | verifier · `/tmp` | ✅ 9/9 checks |
| 3 | `init` se niega a sobrescribir | verifier | ✅ exit 1 |
| 4 | `validate` no escribe en el workspace | hash antes/después | ✅ byte-idéntico |
| 5 | SSOT con el binario publicado reproduce el estado de `main` | `validate` × 2 artefactos | ✅ geo 87/100 en ambos |
| 6 | Loop completo sin tocar hechos | `shasum` antes/después de `check`/`diff`/`--completeness` | ✅ `7f699ffb…` = `7f699ffb…` |
| 7 | Las 7 ediciones al SSOT | `validate` tras cada una | ✅ schema valid · drift 0 |
| 8 | `role: identity` recupera el ancla de entidad | `validate --json` | ✅ structured-data **80 → 100** · geo **87 → 93** |
| 9 | Dos headlines faltantes (RG, X/en) suben consistencia | `validate` | ✅ fact consistency **92 → 94** |
| 10 | PR de datos mergeado | GitHub API | ✅ `profile-data#7` → `5ed0073` |
| 11 | PR de publicación mergeado | GitHub API | ✅ `ChristianLuciani#2` → `bfb0dbc3` depende de `5ed0073` |
| 12 | **Publicado == decidido** | sha256 | ✅ **`bfb0dbc35cd9`** |

## Lo que el run produjo en tu perfil

| Superficie | Antes | Ahora |
|---|---|---|
| Gancho GitHub | *"doctoral candidacy … 20+ years …"* | *"…synthetic cognition… for people and organisations, not for machines"* |
| Header | `synthetic intelligence` | `synthetic cognition` + `(agentic AI)` |
| Upwork title | **80** chars (cap 50, lo cortaban) | **44** |
| ResearchGate / X headline | no existían | 50 / 52 chars |
| Bio LinkedIn ES short | no existía | 64 chars |
| Entidad schema.org | sitio en `sameAs` | `@id` = sitio · `sameAs` = 17 perfiles |
| `geo` | 87/100 | **93/100** |

## Lo que NO se hizo (y por qué)

| Hueco | Razón |
|---|---|
| **Las 5 superficies manuales** (LinkedIn, Upwork, X, ResearchGate, Substack) | la pega es del operador; el run verificó el flujo, no ejecutó las pegatas |
| **Ledger de deploy** — 62 units en `never` | `--mark` sin pega sería ficción; queda como el trabajo pendiente real |
| **`release-*` tag** | `pasco diff` sigue sin baseline (`diff` desde el primer commit) |
| **4 bios largas** con la cifra temporal | decisión editorial aparte — su primera línea es lo más leído; requiere redacción, no tachado |

## Los 10 issues abiertos (este run los produjo)

| # | Título | Evidencia que lo sostiene |
|---|---|---|
| [#238](https://github.com/ChristianLuciani/profile-as-code/issues/238) | el variant elegido nunca se renderiza | `active.yaml` = `gh-en-1`; `build` emite el determinista |
| [#239](https://github.com/ChristianLuciani/profile-as-code/issues/239) | superficies de pega sin artefacto en disco | `find` → solo `github-readme/` |
| [#240](https://github.com/ChristianLuciani/profile-as-code/issues/240) | texto sobre el límite pasa `validate` **y** `check` | Upwork 80/50, `0 finding(s)` |
| [#241](https://github.com/ChristianLuciani/profile-as-code/issues/241) | el hueco de `role: identity` invisible en el score | 80/100 sin `@id` — luego **+20 reales** al declararlo |
| [#242](https://github.com/ChristianLuciani/profile-as-code/issues/242) | "optimizado" no es medible | verde en todos los gates mientras el artefacto publicado era otro |
| [#247](https://github.com/ChristianLuciani/profile-as-code/issues/247) + [#248](https://github.com/ChristianLuciani/profile-as-code/issues/248)–[#252](https://github.com/ChristianLuciani/profile-as-code/issues/252) | epic `pasco edit` + 5 slices | el error de campo-en-archivo-equivocado, y "cambié una cosa y 4 filas siguen diciendo otra" |
| [#253](https://github.com/ChristianLuciani/profile-as-code/issues/253) | la skill de plataforma nunca se encuentra en npm | `refine` → `(not installed — fall back…)`; el tarball solo trae `dist/` |
| [#254](https://github.com/ChristianLuciani/profile-as-code/issues/254) | el CLI público referencia repos privados | `skills:install` → `cd <skills-studio>` |
| [#257](https://github.com/ChristianLuciani/profile-as-code/issues/257) | el perfil destaca por peso técnico, no por vigencia | ZENTROPY 113 d en el top-6; `profile-as-code` ausente |

## La lección de fondo

Cuatro veces en un mismo run, **un cambio correcto dejó un resto viejo en otra superficie**:

1. el statement cambió, y 4 bios largas siguieron con la cifra;
2. el término cambió, y la variante publicada siguió con el viejo;
3. `gh-en-3` se creó, y el `.e2e` seguía comparando contra el determinista;
4. una bio ES nueva se escribió con el término viejo **que yo acababa de retirar**.

Ninguna fue un error de sintaxis: las cuatro pasaron `validate` en verde. Por eso el run grita una sola cosa, y es el título del #242: **el profiler no tiene forma de decirte si lo publicado es lo que decidiste** — hasta hoy lo demostramos a mano, y esa prueba vivió en un script de este directorio, no en el engine.

## Artefactos de esta sesión

- `.e2e/manifest.json` — shas de arranque de ambos repos, artefacto bajo prueba, comandos
- `.e2e/PLAN.md` — el plan de tres bloques con los criterios de verificación
- `.e2e/verify-install.mjs` — 11 checks de instalación
- `.e2e/verify.mjs` — 36–39 checks de workspace + red
- `.e2e/L1-values.md` · `old-values.md` · `M1-mark.md` · `ROLLBACK.md`
- `.e2e/content/*.yaml` — copia read-only del SSOT en `d0303f7`
