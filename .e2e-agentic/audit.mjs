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

// Dos formatos de transcript, una sola normalización:
//   claude : message.content[] with {type:"tool_use", name, input}
//   pi     : top-level {type:"tool_execution_start", toolName, args}
// Cada uno se aplana a la MISMA forma {name, input} para que el auditor no sepa de harnesses.
const toolCalls = [];
for (const e of events) {
  // pi: tool execution events carry the tool name and its args at top level.
  if (e?.type === "tool_execution_start" && e.toolName) {
    toolCalls.push({ name: String(e.toolName), input: e.args ?? {}, id: e.toolCallId });
    continue;
  }
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

const N = (c) => c.name.toLowerCase();
const isBash = (c) => N(c) === "bash";
const isRead = (c) => ["read", "glob", "grep", "ls", "find"].includes(N(c));
const isWrite = (c) => ["write", "edit", "create", "str_replace"].includes(N(c));
const cmdOf = (c) => String(c.input.command ?? c.input.cmd ?? "");
const pathOf = (c) =>
  String(c.input.file_path ?? c.input.path ?? c.input.pattern ?? c.input.filePath ?? "");

const bash = toolCalls.filter(isBash).map(cmdOf);
const reads = toolCalls.filter(isRead).map(pathOf);

const out = [];
const say = (k, v) => {
  out.push({ k, v });
  console.log(`  ${k.padEnd(38)} ${v}`);
};

say("transcript", basename(file));
say(
  "turnos de asistente",
  String(events.filter((e) => e?.type === "turn_end" || e?.type === "assistant").length),
);
say("llamadas a herramientas", String(toolCalls.length));

// ── tokeneconomía: lo que hay que comparar entre versiones de pasco ──────────
// Un total esconde el reparto: un agente que leyó 2000 tokens de README "gastó" lo mismo
// que uno que entendió con 400 de --help y no hizo nada. Se reportan los cuatro números.
// pi emite el MISMO usage en message_update / message_end / turn_end: sin deduplicar, un
// turno cuenta tres veces y el "turnos con usage" miente. Se toma una vez por mensaje final
// (turn_end/agent_end en pi, `result` en claude, o un assistant sin duplicar).
const seen = new Set();
const usages = events
  .filter((e) => e?.type === "turn_end" || e?.type === "result" || e?.type === "assistant")
  .map((e) => {
    const id =
      e?.message?.responseId ??
      e?.message?.id ??
      e?.uuid ??
      JSON.stringify(e?.message?.usage ?? e?.usage);
    if (seen.has(id)) return null;
    seen.add(id);
    return e?.message?.usage ?? e?.usage;
  })
  .filter((u) => u && typeof u === "object" && (u.input != null || u.prompt_tokens != null))
  .map((u) => ({
    input: u.input ?? u.prompt_tokens ?? 0,
    cacheRead: u.cacheRead ?? u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cacheWrite ?? u.cache_creation_input_tokens ?? 0,
    output: u.output ?? u.completion_tokens ?? 0,
    total: u.totalTokens ?? u.total_tokens ?? 0,
  }));
if (usages.length) {
  // input acumula el contexto en cada turno: el MÁXIMO es el costo real de una vuelta,
  // y cacheWrite es el costo de arrancar frío (el del onboarding).
  const maxInput = Math.max(...usages.map((u) => u.input));
  const sumOut = usages.reduce((a, u) => a + u.output, 0);
  const cold = usages.reduce((a, u) => a + u.cacheWrite, 0);
  say("turnos con usage", String(usages.length));
  say("tokens input (máx. por turno)", String(maxInput));
  say("tokens output (total)", String(sumOut));
  say("tokens cacheWrite (arranque frío)", String(cold));
  say("tokeneconomía", `${maxInput} in + ${sumOut} out (${usages.length} turnos)`);
} else {
  say("tokeneconomía", "el transcript no trae usage — no comparable");
}

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
const firstWrite = toolCalls.findIndex(isWrite);
const firstValidateCall = toolCalls.findIndex(
  (c) => isBash(c) && /pasco\s+validate/.test(cmdOf(c)),
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
  .filter((e) => Array.isArray(e?.message?.content))
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
