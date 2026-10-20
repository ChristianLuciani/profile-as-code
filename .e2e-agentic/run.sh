#!/usr/bin/env bash
# E2E agéntico — runner del agente de tercero.
#
# Crea un workspace DESCARTABLE con la persona sintética, le pasa al agente UN prompt ciego y
# captura el transcript crudo. No toca ningún repo, ni perfil real, ni datos tuyos.
#
# Uso:
#   bash .e2e-agentic/run.sh            # corrida 1
#   bash .e2e-agentic/run.sh run-002    # corridas numeradas (para repetir el experimento)
#
# Requisitos: `pasco` en PATH (o el build del repo), y un agente headless autenticado
# (por defecto `claude -p`). El transcript ES la evidencia; el reporte que el agente narra NO.
set -euo pipefail

RUN="${1:-run-001}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="/tmp/e2e-agentic-$RUN"
TXT="$HERE/transcript-$RUN.jsonl"

PASCO_BIN="${PASCO_BIN:-$(command -v pasco || true)}"
if [ -z "$PASCO_BIN" ]; then
  echo "pasco no está en PATH. Instalalo ('npm i -g @profile-as-code/cli') o exportá PASCO_BIN." >&2
  exit 1
fi

echo "· workspace : $WS"
echo "· pasco     : $PASCO_BIN ($("$PASCO_BIN" --version))"

# 1. workspace limpio + scaffold de la versión PUBLICADA
rm -rf "$WS" && mkdir -p "$WS"
"$PASCO_BIN" init "$WS" >/dev/null

# 2. la persona sintética, desde PERSONA.md (un dump reproducible: cada "### content/x.yaml"
#    abre un archivo; la persona no vive en ningún repo, vive acá)
python3 - "$WS" "$HERE/PERSONA.md" <<'PY'
import re, sys
ws, src = sys.argv[1], sys.argv[2]
cur = None
for line in open(src):
    m = re.match(r'^### (content/\S+\.yaml)$', line.rstrip())
    if m:
        cur = f"{ws}/{m.group(1)}"
        open(cur, "w").close()
        continue
    if cur:
        with open(cur, "a") as f:
            f.write(line)
PY

cd "$WS"
"$PASCO_BIN" validate >/dev/null 2>&1 && echo "· baseline  : validate OK (el agente arranca de un workspace sano)"

# 3. el experimento: una frase, nada más
echo "· agent     : claude -p (headless, stream-json)"
echo "· transcript: $TXT"
echo

claude -p "Tengo mis datos profesionales dispersos en este equipo y cada plataforma dice algo distinto.
Quiero un perfil profesional único y coherente, homologado en todas mis cuentas: LinkedIn, GitHub, X.
Los datos están en la carpeta con la que arrancás.

Hacelo y contame qué hiciste." \
  --output-format stream-json --verbose \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  > "$TXT" 2>&1 || true

echo
echo "· transcript: $(wc -l < "$TXT" | tr -d ' ') líneas → $TXT"
echo "· próximo paso: node .e2e-agentic/audit.mjs $TXT"
