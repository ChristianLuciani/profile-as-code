# E2E agéntico — el prompt ciego

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: el texto EXACTO que recibe el agente, y nada más · No cubre: el workspace sintético (en [`PERSONA.md`](PERSONA.md)) ni el auditor (en [`audit.mjs`](audit.mjs)) · as_of: 2026-10-20

## La regla

El agente recibe **un workspace con datos incoherentes** y **una frase**. No se le nombra el
paquete, no se le nombra el repo, no se le dice qué comando correr. Ese silencio es el
instrumento: lo que el agente **tenga que descubrir** es lo que estamos midiendo.

## PROMPT (verbatim — no editar)

```
Tengo mis datos profesionales dispersos en este equipo y cada plataforma dice algo distinto.
Quiero un perfil profesional único y coherente, homologado en todas mis cuentas: LinkedIn,
GitHub, X. Los datos están en la carpeta con la que arrancás.

Hacelo y contame qué hiciste.
```

Eso es todo. Nada de "usá pasco", nada de "leé el README", nada de "validá".

## Por qué este prompt y no otro

| Incluí | Por qué |
|---|---|
| "carpeta con la que arrancás" | le dice **dónde** está el material (el cwd es la única pista legítima) |
| LinkedIn / GitHub / X | nombra superficies reales: el agente tiene que decidir **qué texto va que plataforma** |
| "Hacelo y contame qué hiciste" | no le pido un informe estructurado: si le pido un formato, lo llena aunque sea falso |

| Dejé afuera | Por qué |
|---|---|
| "usá pasco" / "hay un CLI" | contaminaría todo: mediría *seguir instrucciones*, no *descubrir* |
| "leé el README / AGENTS.md" | es el atajo cuya ausencia/uso queremos medir |
| "validá al final" | si se lo digo, no mide si el agente **sabe** que hay que validar |
| "no toques X" | el agente debe decidir el alcance; si toca algo raro, es evidencia |

## Qué NO se le entrega

- **No tiene el repo `profile-as-code`.** Si lo descarga por su cuenta, eso es un dato: significa
  que **sin el repo no podía**, y ese es el hallazgo central.
- **No tiene red hacia el repo privado** ni hacia `profile-data`.
- **No se le da el transcript.** El transcript es lo que capturamos nosotros.

## La persona (ver `PERSONA.md`)

El workspace es **sintético y reproducible**: `pasco init` + siete `content/*.yaml` (identidad,
positioning, bios, headlines, experience, projects, skills). Pasa `validate` con drift 0 y
geo 64/100 — **deliberadamente incompleto**, para que haya trabajo real que hacer.

Está incoherente a propósito en tres puntos que solo se ven leyendo los datos:

1. `positioning.statement` dice "public health pipelines" pero `experience` es un rol de analista
   en un ministerio y `projects` un dashboard — hay que **armar** la narrativa.
2. `bios` tiene LinkedIn (medium) y X (short); **ResearchGate, Upwork y Substack no tienen nada**.
   El pedido menciona LinkedIn, GitHub y X — el agente tiene que decidir si esas tres alcanzan o
   si el SSOT declara más superficies.
3. `skills` pesa `github-readme` y `linkedin`, pero **no hay `headlines` para GitHub** — el
   agente tiene que detectar que le falta uno.

## Lo que el agente NO puede saber (y por eso mide)

- que `pasco build` escribe `profiles/github-readme/README.md`;
- que la decisión de la variante de prosa no llega al artefacto (#238);
- que el texto que se publica y el artefacto determinista son **dos archivos distintos**.

Si llega a resolverlo, lo hizo **leyendo la salida del comando o el repo** — y cada uno de esos
caminos queda en el transcript.
