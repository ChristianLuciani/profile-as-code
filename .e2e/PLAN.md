# E2E dogfood — Christian Luciani · plan de extremo a extremo

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: las 6 superficies que tienen sección propia en el SSOT y un flujo completo (GitHub profile README · LinkedIn · Upwork · X · ResearchGate · Substack) + Patreon y CV/website como chequeo de coherencia, más el loop del engine **hasta donde el run lo ejecutó** (`validate → build → diff → status`; `--mark` y el tag `release-*` NO se ejecutaron) · No cubre: Instagram, WhatsApp, ORCID y YouTube (sin checklist ni texto por plataforma en el SSOT) · as_of: 2026-10-19
>
> Si una superficie no aparece, no asumas que no existe: reportá el hueco.

**Rol de cada lado.** Vos ejecutás cada comando y cada pega. Yo verifico contra el filesystem y
la API de GitHub, nunca contra lo que decís haber hecho — y lo reporto como PASS/FAIL con la evidencia.

**Dónde corrés.** Todos los comandos de `pasco` arrancan con `cd ~/PROJECTOS/GitHub/ChristianLuciani/profile-data`.

---

## 0. Lo que ya verifiqué antes de darte un solo comando (2026-10-19)

| Hecho | Evidencia |
|---|---|
| `pasco` **no está en tu `PATH`** | `which pasco` → not found |
| El binario que sí existe es tu build local, y reporta la versión | `node packages/cli/dist/index.js --version` → `pasco 0.3.0` |
| Tu SSOT valida, sin drift | `pasco validate` → schema valid · drift 0 · **geo 87/100** |
| Completitud | `pasco status --completeness` → **65.8% — 2/5** |
| Nada registrado como deployado | `pasco status` → **59 units · 0 stale · 59 never · 0 in-sync** |
| El README **vivo** de tu perfil NO es el que produce el engine | `diff` artifact vs `gh api repos/ChristianLuciani/ChristianLuciani/readme` → **9 líneas de diferencia**; el vivo tiene el footer viejo `pac build` (era pre-`pasco`) |
| Ins. | npm `@profile-as-code/cli@0.3.0` es `latest`; tu `main` está 6 días adelante | `npm view … version` → 0.3.0 · tag `v0.3.0` → `21e4cde` · `main` → `30555c1` |
| Ins. | El tarball **real** se instala y funciona: `init` → `validate` OK sobre carpeta vacía | instalación limpia a prefijo aislado (`/tmp`), 2026-10-19 |
| Ins. | Mi sesión **no puede** escribir `~/.npm` ni `~/.local` (`EPERM`) | touch en `_cacache/tmp` y `~/.local/bin` |
| Git CLI **secuestrado** (lo hace el hook de AGOS) | `git branch`, `git worktree add`, `git checkout <archivo>` → `Operation not permitted` / `unable to lock ref`. Es intencional: esta sesión no crea ramas. |

**Qué significa en la práctica.** Todo lo que escribís va sobre `main` (con confirmación tuya
antes de cada `push`) y tu rollback es la API de GitHub, que está capturada al byte en
[`ROLLBACK.md`](ROLLBACK.md) — el README vivo de hoy quedó guardado en `/tmp/live-profile-readme.md`.

**Lo que encontré y quiero que sepas antes de empezar.** Nada de esto es un error del engine:
son huecos del SSOT que hoy te hacen perder puntos y que la mayoría nadie ve:

1. **Upwork `title` = 80 caracteres**, y el campo tiene un **máximo de 50**. Con 80, Upwork
   te lo corta en el medio (`Strategic Systems Consultant — BI, ERP, Cash-Audit & Sovereign AI…`).
2. **No hay bios en `es` para Upwork ni ResearchGate** (hay en `en`), así que esos perfiles
   quedan monolingües mientras el resto es bilingüe.
3. **Cero `headlines` para `researchgate`** — y ResearchGate muestra una línea de headline.
4. **No hay `headlines` para `x` en inglés** (sólo `es`), aunque el perfil de X sirve en EN. La bio EN existe (100/160), el headline EN no.
5. **El `role: identity` está sin declarar** en `identity.links`: tu sitio (`christianluciani.github.io`)
   entra al JSON-LD como `sameAs`, igual que 17 URLs de proyecto. Sin el ancla `identity`, la
   preparación de datos estructurados paga el techo de 5 puntos que el SPEC §15.4 documenta. **No lo
   invento yo: quién lo tiene lo declarás vos.** Si es la URL canónica, cambiás 1 línea de tu SSOT.
6. **El Google Scholar URL entra a `sameAs` con `?user=…&hl=en`** (el `&` rompe el JSON-LD crudo).
7. **El `mailto:` entra a `sameAs`** como si fuera un URI de recurso. Con tu engine actual eso es
   **a propósito** (v1.5/#71 lo documenta) — lo dejo como INFO, no como defecto.
8. **Patreon: no encontré una fuente pública citable** para el cap del About, así que no te
   digo que 542/559 violen algo. Solo no voy a inventar un número.

Guardé una copia read-only de tus 15 `content/*.yaml` + el `manifest` con el sha de arranque
(`profile-data@d0303f7`) para poder diffear todo lo que edites, incluso lo que no escogí.

**Pendientes que me toca escalar al repo del engine** (no los arreglo desde acá, `session-discipline` §5):
el `role: identity` sin default (el 87/100 lo esconde), y que
`.worktrees/` está en `.gitignore` pero **no** en el `.git/info/exclude`.

---

## 1. El plan

Tres bloques. El Bloque A es donde gana el engine; B y C son las superficies donde ganás vos.

| # | Paso | Dueño | Cómo lo verifico |
|---|---|---|---|
| — | 0. Cuido tus bytes | **yo** | hecho: `/tmp/live-profile-readme.md` + copia de `content/` |
| 0 | A0. `npm i -g @profile-as-code/cli` + ¿el shell encuentra `pasco`? | vos | `.e2e/verify-install.mjs` |
| 1 | A1. Alias al binario global + `validate` con 0.3.0 | vos | re-corro `validate` |
| 2 | A2. `pasco build` → regenera `profiles/` | vos | diff de `profiles/` |
| 3 | A3. Checks offline del engine, evidencia + media (`pasco check`) | vos | `check` |
| 4 | L0. Línea base del ledger | vos | `status` |
| 5 | L1. Revisás y corregís `content/` | vos | `pasco validate` + checklist |
| 6 | L2. `pasco build` + `status --completeness` | vos | número |
| 7 | L3. **Decidido (b)**: Upwork y ResearchGate quedan EN-only y lo declarás en el README del workspace | vos | `README.md` diff |
| 8 | L4. Completitud final: `status --write-checklist` | vos | `CHECKLIST.md` |
| 9 | G1. Deploy del GitHub profile (el único con flujo git/API) | vos | **byte-parity** del README vivo vs artifact |
| 10 | G2. Deploy de las superficies manuales (LinkedIn/Upwork/X/RG/Substack) | vos | ledger por superficie |
| 11 | M1. `pasco status --mark` por **unidad** y por superficie | vos | `pasco status` deja de decir `never` |
| 12 | M2. `--verify` contra `raw.githubusercontent.com` | vos | `in-sync/verified` o el motivo honesto |
| 13 | M3. Baseline para `pasco diff` | vos | `git tag release-*` |
| 14 | N0. Gate de cierre del workspace | vos | commit + push |
| 15 | — | **yo** | `.e2e/verify.mjs` + lectura fina |

### Cuánto tiempo

- **Bloque A**: 5 comandos, ~30 segundos.
- **Bloque B**: `validate` + 6–10 ediciones de YAML. Los comandos son seguros; **las ediciones
  las escribís vos o yo con tu OK**.
- **Bloque C**: una pega por plataforma. LinkedIn, Upwork, X, ResearchGate son ~10 min cada una
  con la verificación del checklist incluida. La pega es lo único **irreversible** del run, y por eso
  el paso L3 existe.

---

## Bloque A — instalación y loop del engine

> **Artefacto bajo prueba: npm `@profile-as-code/cli@0.3.0`** (dist-tag `latest`, tag `v0.3.0` → `21e4cde`,
> 2026-10-11). Tu build local de `main` (`30555c1`) **no** es lo que este run verifica — lo digo
> porque es 6 días más nuevo y los números pueden diferir.

### A0 · instalación global

> **Ya probé el tarball publicado** en un prefijo limpio y aislado (`/tmp`): se instala, `pasco 0.3.0`,
> `init` → `validate` OK. Lo que **no** puedo probar desde acá es la instalación **en tu home** —
> mi sesión no escribe ahí. Eso es exactamente lo que hacés vos en este paso.

Corré esto en **tu** terminal (mi sesión no puede escribir `~/.npm` ni `~/.local` — `EPERM`):

```sh
# 1) instalar el artefacto real (0.3.0)
npm i -g @profile-as-code/cli

# 2) ¿existe un `pasco` para un shell NUEVO?
sh -lc 'command -v pasco; pasco --version'

# 3) si el paso 2 no encontró nada: ¿dónde quedó el bin?
npm prefix -g
```

**Esperado** (lo medí): el prefijo es `/Users/eva/.local`, el binario se instala en
`/Users/eva/.local/bin/pasco`, y un shell nuevo lo encuentra **solo si `~/.local/bin` está en `PATH`**.
Si no lo encuentra, es un **hallazgo de instalación**, no un error tuyo — anotalo y seguí con la ruta
completa, porque el run no se frena por eso:

```sh
# 4) si el paso 2 falló: verificar por ruta explícita (también sirve para todo el resto del plan)
$(npm prefix -g)/bin/pasco --version
```

> Por qué importa: `docs/USER-GUIDE.md` §1 mete `~/.local/bin` en el `PATH` en **§2 Option B (source)**,
> no en **Option A (npm)** — el on-ramp recomendado. Si el paso 2 falla, es ese hueco, y es lo que
> un usuario nuevo descubre a la mala.

### A1 · el `pasco` de este run

```sh
cd ~/PROJECTOS/GitHub/ChristianLuciani/profile-data
# si el paso 2 encontró `pasco`, usá ese; si no, este:
alias pasco="$(npm prefix -g)/bin/pasco"
pasco --version                 # GATE: tiene que decir 0.3.0

# GATE del SSOT
pasco validate                  # 0.3.0 sobre TU workspace → schema valid · drift 0 · geo 87/100

# A2 · regenerar artifacts (0.3.0 no conoce los 6 días de main; `profiles/` puede diferir)
pasco build
git status --short profiles/

# A3 · checks offline (evidencia + media)
pasco check
```

> Si `pasco validate` da exit 1 con 0.3.0 y daba 0 con tu build de `main`, **pará**: sería una
> regresión de compatibilidad entre `main` y lo publicado, y la escalo como issue del engine.

## Bloque B — ledger y datos

```sh
cd ~/PROJECTOS/GitHub/ChristianLuciani/profile-data

# L0 · la línea base: 59 units, todas `never` (nada deployado, nada stale)
pasco status

# L1 · revisá y corregí content/ (ver la lista de ediciones abajo)
#      Después de CADA edición: pasco validate

# L2 · regenerá y mirá el número
pasco build
pasco status --completeness           # en la línea base: 65.8% — 2/5

# L4 · cuando el contenido esté cerrado, la vista del ledger
pasco status --write-checklist        # ⚠️ sobrescribe CHECKLIST.md (se lleva el bloque de alcance)
```

### L1 — las ediciones (valores exactos en [`L1-values.md`](L1-values.md))

Tus tres decisiones del 2026-10-19 ya están incorporadas: **(b)** Upwork/RG EN-only ·
**sí** `role: identity` en `christianluciani.github.io` · **vos escribís** cada valor.
Ocho ediciones, ninguna inventada — todas salen del SSOT y del diff contra el README vivo:

| # | Archivo | Qué cambia | Por qué |
|---|---|---|---|
| 1 | `headlines.yaml` | `upwork/en`: **80 → ≤50** | el título tiene cap 50; hoy te lo cortan |
| 2 | `headlines.yaml` | agregar `researchgate/en` | hoy la superficie no tiene headline |
| 3 | `headlines.yaml` | agregar `x/en` | el perfil de X sirve en EN y no hay |
| 4 | `bios.yaml` | agregar `linkedin/es/short` | la superficie LinkedIn tiene `short` sólo en EN |
| 5 | `README.md` (workspace) | 1 línea: Upwork/RG EN-only | tu decisión (b), declarada donde ya declarás alcance |
| 6 | `identity.yaml` | `role: identity` en el sitio | tu decisión: es la URL canónica (geo +5 esperado) |
| 7 | `identity.yaml` | Scholar sin `&hl=en` | saca el `&` de un `sameAs` |
| 8 | `projects.yaml` | evidence de Drahma + `source` | claim publicado en 3 superficies sin fuente |

Dos quedan como **pregunta tuya**, sin edición mientras no decidas (§8 y §9 de `L1-values.md`):
la fila `exp-photo-audiovisual-teaching` (¿mismo lugar que la especialización?) y el `en` de la
evidence de Drahma ("Amazonian indigenous communities" vs el SSOT).

**El corolario honesto para hoy**: con las ediciones de arriba, la fila *Language coverage* de
completitud **no se mueve**. La regla del engine (`docs/SPEC.md` §20) cuenta un texto sólo si
**una misma entrada cubre en/es/fr** — y hoy hay **1 de 49**. Eso no se arregla con tus 8 plataformas:
es una decisión de producto (¿cuáles de tus textos son parte de la 3-lang target?). Te lo digo antes de
que lo intentes para que no persigas un número que no existe.

**L3 — decidido (b):** Upwork y ResearchGate quedan **EN-only**. No se agrega bio `es` en el SSOT;
la decisión vive en `README.md` del workspace (1 línea) y el ledger certifica lo que pegaste (el EN).
La honestidad es esa: la superficie se marca `attested` porque pegaste EN, no porque exista un ES.

**L4** regenera `CHECKLIST.md` desde el ledger — y se lleva el bloque de "alcance declarado"
(tu propio `CHECKLIST.md:4` lo dice). Después del `--write-checklist`, **volvé a pegarlo**.

---

## Bloque C — deploy por superficie (lo que verifica el dogfood)

### G1 · GitHub profile README (git/API) — el único con artefacto git

El artifact es `profiles/github-readme/README.md`. Tu repo de perfil es `ChristianLuciani/ChristianLuciani`
(`main`, hoy `2e317e6`).

```sh
cd ~/PROJECTOS/GitHub/ChristianLuciani/profile-data
# 1) lo que se va a publicar (abrí el archivo y leelo)
cat profiles/github-readme/README.md

# 2) lo que hay HOY publicado (diff debe ser el de las 9 líneas del punto 0)
gh api repos/ChristianLuciani/ChristianLuciani/readme --jq .content | base64 -d | diff - profiles/github-readme/README.md

# 3) deploy por API — el mismo contenido, con commit firmado por tu script, NUNCA `git push` manual
gh api --method PUT repos/ChristianLuciani/ChristianLuciani/contents/README.md \
  -f message="feat(profile): README regenerado por pasco build (e2e dogfood 2026-10-19)" \
  -f content="$(base64 < profiles/github-readme/README.md | tr -d '\n')" \
  -f branch=main
```

> **Si el paso 2 muestra algo distinto del diff conocido** (alguien cambió el README vivo desde hoy):
> parás. Un deploy ciego encima de un cambio ajeno es la clase de daño que no vuelve.

### G2 · las manuales: una línea por plataforma

**Esto es lo que hace que el ledger diga la verdad sobre tus perfiles** — solo si pegaste de verdad.
Si no pegás una superficie, no la marques.

| Superficie | Qué pegás | Dónde |
|---|---|---|
| `linkedin` | headline `linkedin/en` + About `bios linkedin/en/medium` | Editar perfil → Headline / Acerca de |
| `upwork` | title ≤50 (`upwork/en`) + overview `bios upwork/en/long` | Profile → Title / Overview |
| `x` | bio `bios x/en/short` (100/160) + headline `x/en` | Edit profile |
| `researchgate` | headline + bio `researchgate/en/medium` | ResearchGate → Edit profile |
| `substack` | bio `substack/en/short` | Substack → Account → Profile |
| `patreon` | bio `patreon/en/short` | Patreon → About |

### M1 · `--mark` (una vez por unidad × superficie que pegaste)

El formato es `pasco status --mark <ledgerKey> <surface>`. Los `ledgerKey` salen de `pasco status`:

```sh
# los que afectan LinkedIn (headline + about + identidad)
pasco status --mark headlines:linkedin:en   linkedin
pasco status --mark bios:linkedin:en:medium linkedin
pasco status --mark identity                linkedin
# Upwork, X, ResearchGate, Substack, Patreon: mismo patrón, la surface que pegaste
```

### M2 · `--verify` — el único paso con red (opt-in) y el único que **prueba** el artefacto

```sh
pasco status --verify github-readme
# espero: in-sync/verified, o el motivo honesto:
#   verified     → fetch a raw.githubusercontent.com y el digest coincide con el ancla
#   out-of-band-drift → el README vivo cambió fuera del ledger
#   host-not-allowed / no-artifact-url / unattributed → el motivo, nunca un falso verde
```

> La URL fiable es `raw.githubusercontent.com` — **el repo de perfil es público**, así que es el único
> artefacto que puedo leer vivo desde acá. Las demás superficies las verifico con lo que pegaste en el ledger.

### M3 · baseline para `pasco diff`

```sh
git tag release-2026-10 && git push --tags
pasco diff                      # después del tag: "changes since release-2026-10"
```

### N0 · cierre del workspace

```sh
cd ~/PROJECTOS/GitHub/ChristianLuciani/profile-data
pasco validate                  # GATE: exit 0
git status --short              # lo que vas a commitear
git add -A && git commit -m "feat(e2e): dogfood 2026-10-19 — headlines ≤ cap, bios es, ledger, tag"
git push origin main            # ← este push lo autorizás vos (main protegida, CI verde en el repo)
```

---

## 2. Cómo te verifico (paso 15)

Cuando me digas *"listo"*, corro `node ~/PROJECTOS/GitHub/ChristianLuciani/profile-as-code/.e2e/verify.mjs`
y además leo lo que el script no puede juzgar (prosa, hechos nuevos, variantes rechazadas).

Un `verify.mjs` que termina en **0** con **`FAIL 0`** es mi veredicto de "hecho".
Si algo quedó en **`PENDING`**, lo digo con la razón — no lo cuento como completado.

| Qué pasa al final | Mi reporte |
|---|---|
| `pasco validate` exit 0, 0 drift | ✔ contrato |
| `verify.mjs` en 0 con FAIL 0 | ✔ "perfiles optimizados", con el detalle por superficie |
| GitHub README byte-idéntico al artifact vivo | ✔ deploy G1 verificado contra la red |
| Las 6 superficies en el ledger como `in-sync`/`stale` | ✔ estado real de lo que pegaste |
| Completitud ≥ 65.8% | ✔, y te explico qué la mueve y qué no |

---

## 3. Guía de caracteres (límites con fuente, para el L1)

| Superficie | Campo | Cap | Fuente |
|---|---|---|---|
| LinkedIn | headline | **220** | [unil.ink 2026-05-02](https://unil.ink/blog/linkedin-character-limits-2026) |
| LinkedIn | About | **2,600** | idem |
| Upwork | Title | **50** | [snipework 2026-03-08](https://snipework.com/blog/upwork-character-limits-2026) |
| Upwork | Overview | **5,000** | idem |
| X | bio | **160** | [omnisocials 2026-10-17](https://omnisocials.com/guides/twitter-character-limits) |
| Substack | bio | ~26 palabras (convención) | [substackwritersatwork](https://www.substackwritersatwork.com/p/your-short-description-and-bio) |
| ResearchGate / Patreon | bio | **sin fuente pública citable** | — (reportado como `[?]`) |

Y tus números de hoy (medidos, no estimados):

| Texto | Chars | Verdict |
|---|---|---|
| `headlines.linkedin/en` | 90 | ✔ |
| `headlines.linkedin/es` | 85 | ✔ |
| `headlines.upwork/en` | **80** | ✗ cap 50 |
| `headlines.x/es` | 66 | ✔ |
| `headlines.substack/en` | 78 | ✔ |
| `headlines.patreon/en` | 52 | ? |
| `bios.x/en/short` | 100 | ✔ (160) |
| `bios.x/es/short` | 98 | ✔ (160) |
| `bios.linkedin/en/medium` | 315 | ✔ (2,600) |
| `bios.linkedin/es/medium` | 324 | ✔ |
| `bios.upwork/en/long` | 384 | ✔ (5,000) |
| `bios.researchgate/en/medium` | 284 | ? |
| `bios.patreon/en/short` | 542 | ? |
| `bios.patreon/es/short` | 559 | ? |

## 4. Estado de arranque (para comparar al final)

| Métrica | Hoy (2026-10-19) | Al final |
|---|---|---|
| `pasco validate` | 0 · 0 drift · geo 87/100 | — |
| Completitud | 65.8% (2/5) | — |
| `pasco status` | 59 units · 0 stale · 59 never · 0 in-sync | — |
| README vivo vs artifact | ✗ difiere (9 líneas) | — |
| `release-*` tag | ninguno | — |

---

## 5. Dónde está cada cosa en este run

- `.e2e/manifest.json` — sha de arranque de los dos repos, líneas base, comandos
- `.e2e/ROLLBACK.md` — cómo volver atrás cada superficie
- `.e2e/old-values.md` — los textos viejos, para pegar de vuelta si rechazás una variante
- `.e2e/{*.yaml}` — copia read-only de tus 15 `content/*.yaml` en `d0303f7`
- `.e2e/verify.mjs` — el verificador mecánico
