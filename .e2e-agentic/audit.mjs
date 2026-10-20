// Auditor del E2E agéntico: deriva del TRANSCRIPT CRUDO lo que el agente hizo — nunca del
// reporte que el agente narra (un agente describe lo que cree haber hecho; el transcript es lo
// que hizo). Read-only.
//
// Uso: node .e2e-agentic/audit.mjs <transcript.jsonl> [workspace]
//
// Responde, con evidencia por línea:
//   1. ¿Qué leyó?        — Read/Glob/Grep sobre qué rutas
//   2. ¿Qué corrió?      — comandos Bash, en orden, con exit code
//   3. ¿Descubrió pasco? — ¿lo invocó, y llegó por --help o leyendo el repo?
//   4. ¿Leyó el repo?    — el atajo: cualquier acceso a profile-as-code (el paquete no lo trae)
//   5. ¿Validó?          — y si lo hizo, ¿antes o después de editar?
//   6. ¿Abandonó honesto? — ¿preguntó, se detuvo, o inventó?

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("uso: node .e2e-agentic/audit.mjs <transcript.jsonl> [workspace]");
  process.exit(2);
}

const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const events = [];
for (const raw of lines) {
  try {
    events.push(JSON.parse(raw));
  } catch {
    /* stream-json line that is not JSON (banner/log) — keep index, skip */
  }
}

// Claude Code stream-json: assistant messages carry content blocks (tool_use), user messages
// carry tool_result. We flatten both into ordered tool events.
const toolCalls = [];
for (const e of events) {
  const content = e?.message?.content;
  if (!Array.isArray(content)) continue;
  for (const block of content) {
    if (block?.type === "tool_use") {
      toolCalls.push({ name: block.name, input: block.input ?? {}, id: block.id });
    }
    // tool_result carries the output; attach it to the previous call by id
    if (block?.type === "tool_result") {
      const call = toolCalls.find((c) => c.id === block.tool_use_id);
      if (call)
        call.result =
          typeof block.content === "string" ? block.content : JSON.stringify(block.content);
    }
  }
}

const bash = toolCalls.filter((c) => c.name === "Bash").map((c) => String(c.input.command ?? ""));
const reads = toolCalls
  .filter((c) => c.name === "Read" || c.name === "Glob" || c.name === "Grep")
  .map((c) => String(c.input.file_path ?? c.input.path ?? c.input.pattern ?? ""));

const out = [];
const say = (k, v) => {
  out.push({ k, v });
  console.log(`  ${k.padEnd(38)} ${v}`);
};

say("transcript", basename(file));
say("turnos de asistente", String(events.filter((e) => e?.type === "assistant").length));
say("llamadas a herramientas", String(toolCalls.length));

// 1. qué leyó
const touchedRepo = reads.filter((r) =>
  /profile-as-code|github\.com\/ChristianLuciani\/profile/.test(r),
);
const touchedWorkspace = reads.filter((r) => /content\/|\.pascorc|README/.test(r));
say("archivos leídos (Read/Glob/Grep)", String(new Set(reads).size));
say("  └ en el workspace", String(new Set(touchedWorkspace).size));
say("  └ EN EL REPO DEL AUTOR", String(touchedRepo.length));

// 2. qué corrió
say("comandos Bash", String(bash.length));
for (const [i, cmd] of bash.slice(0, 30).entries()) {
  say(`  [${i}] ${cmd.split("\n")[0].slice(0, 70)}`, "");
}

// 3/4/5 — las preguntas que importan
const usedPasco = bash.some((c) => /pasco/.test(c));
const usedHelp = bash.some((c) => /pasco\s+(--help|-h)\b/.test(c));
const cloned = bash.some((c) => /git clone|npm view|curl .*github|gh repo view|gh api/.test(c));
const validated = bash.some((c) => /pasco\s+validate/.test(c));
const built = bash.some((c) => /pasco\s+build/.test(c));
// Ordering must be measured on the TOOL SEQUENCE, not on the Bash list: a `findIndex` over
// `bash` alone returned 0 for a write that is not a Bash call at all (the control run exposed
// it — "edit → validate" was reported as "validated before editing").
const firstWrite = toolCalls.findIndex((c) => c.name === "Write" || c.name === "Edit");
const firstValidateCall = toolCalls.findIndex(
  (c) => c.name === "Bash" && /pasco\s+validate/.test(String(c.input.command ?? "")),
);

say("¿usó pasco?", usedPasco ? "SÍ" : "NO — ¿hecho a mano?");
say("¿llegó por `pasco --help`?", usedHelp ? "SÍ" : "NO");
say("¿fue al repo / registry (atajo)?", cloned ? "SÍ" : "no");
say("¿validó?", validated ? `SÍ (paso de herramienta #${firstValidateCall})` : "NO");
say("¿build antes de terminar?", built ? "SÍ" : "NO");
say(
  "¿validó DESPUÉS de editar?",
  firstWrite < 0
    ? "no editó"
    : firstValidateCall > firstWrite
      ? "SÍ (correcto)"
      : "NO — validó antes o nunca",
);

// 6. abandono honesto: ¿preguntó? ¿terminó sin decir que falló?
const text = events
  .filter((e) => e?.type === "assistant" && Array.isArray(e?.message?.content))
  .flatMap((e) => e.message.content.filter((b) => b?.type === "text").map((b) => b.text))
  .join("\n");
say(
  "¿pidió ayuda al humano?",
  /\?|necesito que|¿podés|¿me confirmás|no puedo|no tengo acceso/i.test(text)
    ? "SÍ (posible abandono honesto)"
    : "no dijo nada",
);

const failed = [];
if (!usedPasco)
  failed.push("no descubrió el motor: resolvió el pedido sin pasco (o se quedó a medias)");
if (touchedRepo.length)
  failed.push("fue al repo del autor: sin el repo, el paquete no se basta solo");
if (usedPasco && !usedHelp)
  failed.push("llegó a pasco sin leer su --help: aprendió del repo, no del binario");
if (usedPasco && !validated) failed.push("editó y nunca validó el contrato");
if (firstWrite >= 0 && firstValidateCall >= 0 && firstValidateCall < firstWrite)
  failed.push("validó sólo ANTES de editar");

console.log(`\n${failed.length === 0 ? "SIN HALLAZGOS" : `${failed.length} HALLAZGO(S)`}`);
for (const f of failed) console.log(`  ✗ ${f}`);
