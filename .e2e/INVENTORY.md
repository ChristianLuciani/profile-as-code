# E2E — inventario de features testeadas (run 2026-10-19/20)

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: cada comando y cada comportamiento del CLI `@profile-as-code/cli@0.3.0` que el run ejecutó, con el nivel de profundidad real · No cubre: los 7 renderers distintos de `github-readme`, el flavor `brand`, ni (en v0.3.0) ninguna feature que no existía — ver §"Lo que NO se probó" · as_of: 2026-10-20
>
> Si una feature no aparece, no asumas que no se probó: leé §Lo que NO se probó.

## Identidad del artefacto bajo prueba

Todo número de este informe se refiere a **este** binario, y se puede re-derivar **sin red**:

| Dato | Valor | Cómo re-derivarlo |
|---|---|---|
| Paquete | `@profile-as-code/cli@0.3.0` | `pasco --version` |
| `dist` sha256 | `c94b339e98d4c440f8dd6f19054cde9901c5742ceabfca426a836fce72cc080f` | `shasum -a 256 "$(npm prefix -g)/lib/node_modules/@profile-as-code/cli/dist/index.js"` |
| Dependencias publicadas | `yaml ^2.9.1`, `zod ^4.6.5` (nada más) | `npm view @profile-as-code/cli@0.3.0 dependencies` |
| Fuente de la versión | tag `v0.3.0` → `21e4cde` | `git rev-parse v0.3.0` |
| Tag de baseline E2E | `e2e-0.3.0` → `21e4cde` | `git rev-parse e2e-0.3.0^{commit}` |
| Attestation de provenance | **ausente** (`dist.attestations` no existe) | `npm view @profile-as-code/cli@0.3.0 dist.attestations` |
| `main` del engine al cerrar | `d8ebc7e` (6 días y ~20 commits adelante de `v0.3.0`) | `git log --oneline v0.3.0..main` |
| `profile-data` al cerrar | `5ed0073` | `git -C profile-data rev-parse main` |
| Perfil publicado al cerrar | `ac8a619` · README sha256 `bfb0dbc35cd9` | `gh api repos/ChristianLuciani/ChristianLuciani/commits/main` |

> **Por qué importa la separación `v0.3.0` ↔ `main`:** el dogfood corrió contra el **tarball publicado**, que es el código de `v0.3.0`. Lo que hoy está en `main` **no fue dogfoodeado**. Un usuario que instale `main` (o el build local) está en un artefacto distinto al que este informe describe.

## Inventario — ✅ probado a fondo · 🟡 probado parcial · ❌ no probado

| Superficie | Comando | Nivel | Qué se verificó / qué faltó |
|---|---|---|---|
| Instalación | `npm i -g`, PATH, versión | ✅ | `command -v pasco` en shell nuevo; `pasco 0.3.0`; dist idéntico al de una instalación aislada en `/tmp` |
| Scaffold | `pasco init` | ✅ | carpeta vacía → `validate`-clean; **se niega a sobrescribir** (exit 1) |
| Contrato | `pasco validate` | ✅ | schema valid · drift 0 · geo en 6 estados distintos (87 → 93); **no escribe** (hash antes/después) |
| Render | `pasco build [platform]` | 🟡 | a fondo **sólo `github-readme`**; los otros 7 renderers de 0.3.0 (`github-org`, `kofi`, `buymeacoffee`, `liberapay`, `gumroad`, `payhip`, `hotmart`) **no se ejercitaron** (los creadores de monetización hicieron *empty render → removed*, que sí se observó) |
| Historial | `pasco diff` | ✅ | sin `release-*` → fallback al primer commit; listado de archivos correcto |
| Ledger | `pasco status` (lectura) | ✅ | 59 → 62 units, todos `never`; unidades compuestas (`bios:*`, `headlines:*`, `skills:*`) bien construidas |
| Ledger | `pasco status --mark` | ❌ | **nunca se ejecutó** — no hubo pega manual que marcar |
| Ledger | `pasco status --verify` | ❌ | nunca se ejecutó (requiere una fila del ledger) |
| Ledger | `pasco status --write-checklist` | ❌ | nunca (sobrescribe `CHECKLIST.md`) |
| Completitud | `pasco status --completeness` | ✅ | 65.8% — 2/5, estable en 4 mediciones |
| Reglas | `pasco check` | ✅ | ejecuta registro de evidencia + media; **el catálogo por plataforma no ejecuta** (su propio `owner:` lo dice y lo probamos con un título ilegal) |
| Variantes | `pasco refine` (sin `--choose`) | ✅ | emite el task template; **y se midió su defecto**: `(not installed — fall back…)` en instalación npm (#253) |
| Variantes | `pasco refine --choose` | ❌ | nunca — y habría sido inútil: `build` no lee `active.yaml` (#238) |
| Skills | `pasco skills:install` | 🟡 | en `/tmp`; imprime un placeholder de un repo privado (#254) |
| Salida máquina | `--json` | 🟡 | `validate --json`; no sistemático en el resto |
| Workspace | `--workspace` | 🟡 | un uso (verificar memoria del `.pascorc` en worktrees) |
| Flavor | `brand` | ❌ | nunca — ni `init --flavor brand` ni `github-org` ni la matriz de handles |
| Deploy | ciclo git/API real | ✅ | _no es un comando_: PR en `profile-data` + PR en el repo de perfil + `sha256(publicado)==sha256(decidido)` |
| Deploy | pega manual + ledger | ❌ | 5 superficies sin pegar → el ledger quedó en `never` |

## Lo que NO se probó (declarado)

1. **7 de 8 renderers.** El run usó un workspace `person` cuyo único renderer relevante es `github-readme`. Los de monetización y `github-org` (brand) quedaron intactos.
2. **Todo el camino de escritura del ledger** — `--mark`, `--verify`, `--write-checklist`. Es el hueco más grande: son los comandos que vuelven verdad el estado de deploy y hoy no tienen un run detrás.
3. **`refine --choose`** y, detrás, el flujo de variantes completo (M3).
4. **Flavor `brand` completo.**
5. **La red de seguridad de salida** (`--json`) en todos los comandos.

## Contrato de re-e2e (para cada versión siguiente)

El objetivo no es "probar una vez", es **hacer esto obligatorio en cada release**. Tres piezas que lo hacen mecánico:

### 1. La versión deja de ser prosa: es un hash

Antes de correr, se anota `shasum -a 256` del `dist` instalado. Un run que no puede reproducir ese hash **no es comparable**. (Hoy el informe dice "0.3.0" en prosa; el hash es la constancia.)

### 2. El diff entre versiones se puede hacer

```sh
# el código de la versión que se testeó, contra el de la próxima
git diff e2e-0.3.0 e2e-<próxima> -- packages/cli/src packages/renderers skills platforms
```

Ese diff **es** la lista de features nuevas que el próximo run tiene que inventariar. Regla: **ninguna version se declara e2e-completa hasta que cada entrada del diff esté en el inventario con nivel ✅/🟡/❌** — un ❌ es aceptable como declaración, el silencio no.

### 3. El checklist de features nuevas

Crear el tag `e2e-<versión>` **junto al release** (no después). El cuerpo del tag quotea: el hash del `dist`, el comando de re-derivación y la ruta de este inventario. Así el inventario de la versión N+1 arranca desde `git diff`.

### Estado de este contrato hoy

| Pieza | Estado |
|---|---|
| Tag `e2e-0.3.0` | ✅ creado (`21e4cde`) |
| Hash del `dist` en el informe | ✅ §Identidad |
| Inventario por feature | ✅ esta tabla |
| Checklist automático al publicar | ❌ hoy es una regla documentada, no un gate de CI |
