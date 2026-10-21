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
# Requisitos: `pasco` en PATH (o el build del repo), y un agente headless con modelo verde
# (HARNESS=pi usa un HOME aislado + la clave de OpenBao — ver CAMINO-PI.md).
# El transcript ES la evidencia; el reporte que el agente narra NO.
#
#   HARNESS=claude  (default) o HARNESS=pi
# Nota: el agente hereda $HOME. Con HARNESS=pi corre con un HOME aislado que NO contiene
# ~/.pi/agent/AGENTS.md, para que no herede el protocolo del operador (y el "descubrimiento"
# sea real). Con HARNESS=claude corre con el HOME real: declararlo, no esconderlo.
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
HARNESS="${HARNESS:-claude}"
echo "· agent     : $HARNESS"
echo "· transcript: $TXT"
echo

if [ "$HARNESS" = "pi" ]; then
  # HOME aislado: solo models.json con la clave real del gateway (ver CAMINO-PI.md)
  HISO="/tmp/e2e-agentic-$RUN/home"
  mkdir -p "$HISO/.pi/agent"
  echo "· key       : leyendo de OpenBao (puede tardar; docker exec)"
  TOK="$(security find-generic-password -a root-token -s nexos-vault-openbao -w)"
  KEY="$(docker --context orbstack exec -e BAO_TOKEN="$TOK" nexos_vault_openbao \
           bao kv get -field=value secret/sah/LITELLM_MASTER_KEY | tr -d '\r\n')"
  case "$KEY" in
    sk-*) : ;;
    *) echo "· ABORTA: OpenBao devolvió una clave sin prefijo sk- (¿path equivocado? ver CAMINO-PI.md)" >&2; exit 4 ;;
  esac
  HOME_ISO="$HISO" KEY="$KEY" SRC="$HOME/.pi/agent/models.json" node -e '
    const fs=require("fs");
    const m=JSON.parse(fs.readFileSync(process.env.SRC,"utf8"));
    m.providers.sah.apiKey=process.env.KEY;
    fs.writeFileSync(process.env.HOME_ISO+"/.pi/agent/models.json", JSON.stringify(m,null,2));
  '
  # el escalón que la cascada no garantiza: sin un modelo verde, no se lanza
  MODEL="${PASCO_E2E_MODEL:-ollama/qwen2.5-coder:7b}"
  if ! curl -s -m 90 -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
      -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"OK\"}],\"max_tokens\":5}" \
      http://127.0.0.1:4000/v1/chat/completions | grep -q '"choices"'; then
    echo "· ABORTA: el gateway no sirve '$MODEL'. Probá otro con PASCO_E2E_MODEL= o mirá CAMINO-PI.md." >&2
    exit 3
  fi
  echo "· model     : $MODEL (verde)"
  HOME="$HISO" pi --mode json -p "Tengo mis datos profesionales dispersos en este equipo y cada plataforma dice algo distinto.
Quiero un perfil profesional único y coherente, homologado en todas mis cuentas: LinkedIn, GitHub, X.
Los datos están en la carpeta con la que arrancás.

Hacelo y contame qué hiciste." \
    --model "$MODEL" > "$TXT" 2>&1 || true
else
claude -p "Tengo mis datos profesionales dispersos en este equipo y cada plataforma dice algo distinto.
Quiero un perfil profesional único y coherente, homologado en todas mis cuentas: LinkedIn, GitHub, X.
Los datos están en la carpeta con la que arrancás.

Hacelo y contame qué hiciste." \
  --output-format stream-json --verbose \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  > "$TXT" 2>&1 || true
fi

echo
echo "· transcript: $(wc -l < "$TXT" | tr -d ' ') líneas → $TXT"
echo "· próximo paso: node .e2e-agentic/audit.mjs $TXT"
