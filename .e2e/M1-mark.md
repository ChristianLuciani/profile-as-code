# M1 · la lista de `--mark` (qué pegué dónde)

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: la lista de comandos `--mark` por unidad × superficie que el run PREPARÓ · No cubre: que se hayan ejecutado: ninguno lo hizo (el ledger cerró con 62 units `never`) · as_of: 2026-10-20
> Si una pieza no aparece, no asumas que no existe: reportá el hueco.

`pasco status --mark <ledgerKey> <surface>` registra **una** unidad en **una** superficie.
Cada `--mark` reescribe `content/deployments.yaml` entero (se lleva los comentarios).

Regla: **marcá sólo lo que pegaste.** Un `--mark` sin pega convierte el ledger en ficción,
y para eso ya alcanza con no tener ledger.

## Las 59 unidades (de `pasco status` @ d0303f7)

### LinkedIn — 5

```sh
pasco status --mark headlines:linkedin:en        linkedin
pasco status --mark headlines:linkedin:es        linkedin
pasco status --mark bios:linkedin:en:medium      linkedin
pasco status --mark bios:linkedin:es:medium      linkedin
pasco status --mark bios:linkedin:en:short       linkedin   # sólo si lo pegaste como summary corto
```

### Upwork — 1 unidad indexada (+ lo que corresponda)

```sh
pasco status --mark headlines:upwork:en          upwork
pasco status --mark bios:upwork:en:long          upwork
```

> ⚠️ El headline de Upwork hoy es 80 chars y el cap es 50. **Si no lo corregiste antes de pegar,
> pegaste algo que Upwork te va a cortar** — marcalo igual (es lo que hay publicado) y anotalo en
> `CHANGELOG.md`; corregirlo es el paso L1 #1.

### X — 2

```sh
pasco status --mark headlines:x:es               x    # el que existe hoy
pasco status --mark bios:x:en:short              x
pasco status --mark bios:x:es:short              x    # sólo si tenés el perfil en ES
```

> No hay `headlines:x:en` — si L1 #3 no se hizo, **no existe la unidad**: no la marques.

### ResearchGate — 1

```sh
pasco status --mark bios:researchgate:en:medium  researchgate
```

### Substack — 2

```sh
pasco status --mark headlines:substack:en        substack
pasco status --mark bios:substack:en:short       substack
pasco status --mark bios:substack:es:short       substack   # si la publicación también está en ES
```

### Patreon — 2

```sh
pasco status --mark headlines:patreon:en         patreon
pasco status --mark bios:patreon:en:short        patreon
pasco status --mark bios:patreon:es:short        patreon   # si tu página está en ES
```

### Las raíces (deployadas "en todas" sólo si de verdad lo están)

```sh
# identity = nombre, foto, links canónicos → aparece en CADA superficie que pegaste
pasco status --mark identity linkedin
pasco status --mark identity upwork
pasco status --mark identity x
pasco status --mark identity researchgate
pasco status --mark identity substack
pasco status --mark identity patreon

# positioning / keywords: sólo si los usaste como fuente de la pega
pasco status --mark positioning linkedin
pasco status --mark keywords linkedin
```

### Projects (10) y publicaciones (9) — **NO en este primer pase**

`projects:*` y `publications:*` no tienen texto pegado por plataforma en este run: son hechos
que se muestran en el GitHub README (una sola superficie, ya cubierta por `github-readme`) y
en LinkedIn "Featured" si los agregaste. Marcarlos en `linkedin` cuando no están como Featured
sería mentira. **Mi recomendación: dejarlos en `never` en este pase, y decirlo en el reporte.**
Si querés trackerarlos, es su propia decisión y su propio paso.

### Experience / education / skills — **NO en este primer pase**

Mismo razonamiento: `experience:*` (10 filas) y `education:*` (3) aparecen **dentro** del GitHub
README y, si los cargaste, en la sección Experience de LinkedIn. Si cargaste las 10 fechas en
LinkedIn, ahí sí corresponde `pasco status --mark experience:<id> linkedin` por cada una — pero
eso es un trabajo de registro largo, y prefiero que lo hagamos en un segundo loop si lo querés.

---

## `--verify` (después de los `--mark`)

```sh
pasco status --verify github-readme
```

Sólo `github-readme` tiene extractor en 0.3.0 (fetch a `raw.githubusercontent.com`, comparación
contra el ancla del `--mark`). Las demás superficies no tienen extractor → `unverifiable` (`no-extractor`),
que **no** es un veredicto sobre tu pega: es la ausencia de un chequeo automático posible.
