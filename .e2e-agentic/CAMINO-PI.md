# El camino `pi` — credencial desde OpenBao y un HOME aislado

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: cómo se obtiene la credencial del gateway, cómo se arma el HOME aislado del agente y cómo se verifica que hay un modelo verde ANTES de correr · No cubre: la corrida en sí (no hay ninguna válida todavía) ni la instalación de modelos locales · as_of: 2026-10-20
>
> Si un paso no aparece, no asumas que no existe: reportá el hueco.

## Por qué existe este archivo

La primera corrida falló con `No API key found for sah`. La causa no era el HOME aislado: era que
`~/.pi/agent/models.json` guarda la clave del gateway como **texto literal de 19 caracteres**
(`$LITELLM_MASTER_KEY`, sin expandir). `pi` la envía como si fuera una clave y LiteLLM responde
`401 — expected to start with 'sk-'`.

El error real de la clave está en **OpenBao** — y ahí sí arranca con `sk-`:

| Dato | Valor |
|---|---|
| Instancia | `docker exec` a `nexos_vault_openbao` (`127.0.0.1:3003`) |
| Token | Keychain macOS, servicio `nexos-vault-openbao`, cuenta `root-token` |
| Monta | `secret/` es **KV v1** — un path por clave: `secret/sah/<NOMBRE>` |
| Clave del gateway | `secret/sah/LITELLM_MASTER_KEY` → campo `value` (43 chars, `sk-…`) |
| Gateway | `http://127.0.0.1:4000/v1`, 259 modelos |

> No se versiona ninguna credencial. El comando las trae al vuelo al armar el HOME aislado.

## El HOME aislado — por qué es obligatorio

El agente hereda el `HOME` desde donde se lanza. Si se corre desde `/tmp`, `HOME` sigue siendo
`/Users/eva` y ahí está **`~/.pi/agent/AGENTS.md`**: el protocolo del operador entero. Un agente
que lo lee ya sabe que el operador tiene `pasco`, y el "descubrimiento" que este run mide deja de
ser descubrimiento.

Por eso el run arma `/tmp/e2e-agentic-<run>/home/` con **solo** lo mínimo:

```
home/.pi/agent/models.json   ← el catálogo, con la clave literal REEMPLAZADA por la de OpenBao
home/.pi/agent/auth.json     ← (se copia si existe; en el run ronda no hizo falta)
```

**NO se copian:** `AGENTS.md`, `settings.json`, `extensions/`, `bin/`, `gateway.json`,
`mcp-cache.json`, `trust.json`. `AUDIT` verifica que no estén.

## Montarlo

```sh
RUN=run-001
E2E="$HOME/PROJECTOS/GitHub/ChristianLuciani/profile-as-code/.e2e-agentic"
HOME_ISO="/tmp/e2e-agentic-$RUN/home"

mkdir -p "$HOME_ISO/.pi/agent"

# 1. la clave, desde OpenBao (v1: el valor vive en el campo `value`)
TOK=$(security find-generic-password -a root-token -s nexos-vault-openbao -w)
KEY=$(docker --context orbstack exec -e BAO_TOKEN="$TOK" nexos_vault_openbao \
        bao kv get -field=value secret/sah/LITELLM_MASTER_KEY | tr -d '\r\n')

# 2. el catálogo de pi, con la clave real en lugar del literal roto
node -e '
  const fs=require("fs"), home=process.env.HOME_ISO, key=process.env.KEY;
  const m=JSON.parse(fs.readFileSync(process.env.SRC,"utf8"));
  m.providers.sah.apiKey=key;                       // ← el fix
  fs.writeFileSync(home+"/.pi/agent/models.json", JSON.stringify(m,null,2));
' SRC="$HOME/.pi/agent/models.json"

# 3. verificar que el gateway responde con ESA clave (antes de gastar un turno)
curl -sf -H "Authorization: Bearer $KEY" http://127.0.0.1:4000/v1/models >/dev/null \
  && echo "gateway OK" || { echo "gateway RECHAZA la clave — parar"; exit 1; }
```

## El escalón que faltaba: ¿hay un modelo verde?

El gateway responde **200** con la clave de OpenBao, pero eso sólo prueba autenticación. En la
ronda del 2026-10-20 **ningún proveedor tenía saldo**:

| Modelo | Estado medido |
|---|---|
| `agente-ejecutor` (Fireworks) | cuenta **suspendida** (límite de gasto) |
| `groq/llama-3.3-70b-versatile` | `NotFoundError` |
| `ollama-cloud/glm-5.3-flash:cloud` | `RateLimitError` |
| `cerebras/gpt-oss-120b` | `Payment required` |
| `ollama/qwen2.5-coder:7b` | **no instalado en el Ollama local** |

Un run contra un proveedor caído no mide pasco: mide la cascada. **Antes de lanzar el agente**, un
sonda de un turno:

```sh
for m in ollama/qwen2.5-coder:7b local-qwen; do
  curl -s -m 60 -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"OK\"}],\"max_tokens\":5}" \
    http://127.0.0.1:4000/v1/chat/completions | grep -q '"choices"' \
    && { echo "verde: $m"; MODEL=$m; break; }
done
```

Sin `MODEL`, **no se lanza el run**.

## El modelo local (escalón `$0`)

Hardware: **Apple M2, 16 GB RAM, 15 GB libres**. Los tres que el gateway declara:

| Modelo | Parámetros | Nota |
|---|---|---|
| `ollama/qwen2.5-coder:7b` | 7B | ≈4.7 GB · el elegido (código + shell, el perfil del agente) |
| `ollama/qwen3.5:4b` | 4B | ≈2.5 GB · más liviano, menos capaz |
| `ollama/gemma4:e2b-it-qat` | E2B | ≈2 GB · el más chico |

```sh
ollama pull qwen2.5-coder:7b      # ≈4.7 GB
```

Con el modelo local arriba, el E2E corre **sin depender de ningún saldo**: la cascada cumple su
promesa de `$0`-primero, y el costo de tokens es explícito en el `usage` de la respuesta.
