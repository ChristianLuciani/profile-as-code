# E2E agéntico — cómo correrlo

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: el procedimiento para lanzar el agente de tercero y capturar su transcript · No cubre: el resultado (no existe aún — ningún run válido se ejecutó) · as_of: 2026-10-20
>
> Si un run no aparece en este directorio, no asumas que se hizo: reportá el hueco.

## Qué mide este experimento (y qué no)

Mide **una** cosa: **¿puede un agente que llega sin el repo resolver el pedido usando sólo lo que
el paquete le ofrece?** No mide si pasco funciona (eso ya está en `.e2e/INVENTORY.md`), ni si el
perfil queda bien (eso es juicio humano).

Y una advertencia de alcance honesta: con `claude` como ejecutor, el resultado dice
*"un agente Claude Code, sin el repo, ¿puede?"* — **no** *"cualquier agente puede"*. Para decidir
el otro harness hay que repetir con `codex`/`opencode` cuando haya sesión.

## Los tres artefactos

| Archivo | Qué es |
|---|---|
| `PROMPT.md` | el prompt **verbatim** y por qué cada palabra está (o está afuera) |
| `PERSONA.md` | la persona sintética — 7 `content/*.yaml` reproducibles, `validate` OK, geo 64/100, incompleta a propósito |
| `audit.mjs` | el auditor que lee el **transcript**, no el reporte |

## El rol de cada lado

- **Vos corrés el agente** (`run.sh`): usa **tu** sesión de Claude Code y **tu** sandbox. No se
  toca ningún repo, ni `profile-data`, ni tu perfil: el workspace vive en `/tmp/e2e-agentic-<run>`
  y se borra solo en la próxima corrida.
- **Yo audito** el transcript y contrasto las predicciones. **El veredicto sale del transcript**, nunca del reporte que el agente
  narra: un agente describe lo que cree haber hecho.

## Paso a paso

```sh
cd ~/PROJECTOS/GitHub/ChristianLuciani/profile-as-code

# 0. (una vez) el agente necesita sesión activa
claude          # si pide: /login      ← después salí con Ctrl-D

# 1. la corrida — prompt ciego, transcript capturado
bash .e2e-agentic/run.sh                       # → transcript-run-001.jsonl
#    para repetir el experimento (la estocasticidad importa):
bash .e2e-agentic/run.sh run-002
```

Si `pasco` no está en `PATH`:

```sh
PASCO_BIN="$(npm prefix -g)/bin/pasco" bash .e2e-agentic/run.sh
```

## Lo que esperás ver al final

```
· workspace : /tmp/e2e-agentic-run-001
· pasco     : …/bin/pasco (pasco 0.3.0)
· baseline  : validate OK (el agente arranca de un workspace sano)
· agent     : claude -p (headless, stream-json)
· transcript: …/.e2e-agentic/transcript-run-001.jsonl
…
· transcript: N líneas → …/transcript-run-001.jsonl
· próximo paso: node .e2e-agentic/audit.mjs …/transcript-run-001.jsonl
```

**Pasame el transcript** (el archivo, o su ruta) y yo corro:

```sh
node .e2e-agentic/audit.mjs .e2e-agentic/transcript-run-001.jsonl
```

## Lo que el auditor deriva, y de dónde

| Pregunta | Dónde sale del transcript |
|---|---|
| ¿qué leyó? | `Read` / `Glob` / `Grep` → `file_path` / `path` / `pattern` |
| ¿qué corrió? | `Bash` → `command`, en orden |
| ¿descubrió pasco? | cualquier `Bash` con `pasco` |
| ¿llegó por `--help` o por el repo? | `pasco --help` / acceso a `profile-as-code` |
| ¿validó, y en qué orden? | índice del primer `Write`/`Edit` **vs** el primer `Bash pasco validate` |
| ¿abandonó honesto? | el texto del asistente: pregunta, se detiene, o inventa |

Controles del auditor (probados antes de publicarlo): un transcript con edición→validación da
**SIN HALLAZGOS**; uno que empieza validando y después edita da **"validó sólo ANTES de editar"**;
uno que lee el repo del autor da **"fue al repo del autor"**.

## Las predicciones a contrastar (falsables)

1. El agente **no encuentra** `AGENTS.md`: vive en el repo del engine, no en el paquete.
2. `pasco --help` describe **comandos, no el ciclo** — el agente edita, valida verde y cree que terminó.
3. Si tiene acceso al repo, **lo lee antes que `--help`** (evidencia de que la CLI no se basta sola).
4. Falla en **"qué dato va en qué archivo"** — el error que el operador humano cometió hoy con la bio.
5. **No sabe** que su edición no llega al artefacto publicado (#238/#253), porque `validate` le dice verde.

Si 2–5 se confirman, el repo está optimizado para **mantenedores**, no para **agentes**. Ese es el
hallazgo accionable — y el input natural del issue [#260](https://github.com/ChristianLuciani/profile-as-code/issues/260) (docs de entrada por lector).

## Qué NO hacer con el transcript

- **No committearlo** sin revisarlo: contiene el workspace completo del agente y, si el agente leyó
  algo de tu home, también eso. La persona es sintética, pero el transcript no garantiza qué tocó.
- **No contarme lo que el agente dijo que hizo.** El auditor lo deriva; la narración sesga el pase.
