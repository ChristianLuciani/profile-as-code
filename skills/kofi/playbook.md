# Playbook — deploy Ko-fi (paste, D9)

Superficie: página de creador `ko-fi.com/<handle>` — **sin API de deploy**
(webhooks de pago only, SOTA-2026 §6/S18). El deploy es manual; el ledger lo
registra `pasco status --mark`.

## Pre-paste

1. `pasco validate` — exit 0 (schema + drift + geo).
2. `pasco build kofi --lang <lang>` — escribe `profiles/kofi/README.md`; ese
   archivo ES el texto a pegar (plano, 1 fila de bios — long > medium > short).
3. Verificá el handle vigente: `identity.links` debe contener el URL canónico
   `https://ko-fi.com/<handle>` (host con guion; `kofi.com` NO resuelve,
   S17). **Rename-drift**: si el username cambió, los handles viejos siguen
   resolviendo (S6/S12) y el preview social puede mostrar el nombre viejo
   (S4) — regenerá el preview y actualizá el link ANTES de pegar.

## Paste (dashboard)

Orden sugerido (SOTA-2026 §6):

1. **Settings → Profile** (`settings?tab=profile`): display name correcto +
   "Your social links": hasta 15 links, `https://` completo (S3). El About NO
   lleva links inline.
2. **`ko-fi.com/manage/mypage` → About**: pegá el contenido de
   `profiles/kofi/README.md` tal cual (texto plano; el card trunca tras unas
   líneas con "Show more" — lo primero es lo que se lee).
3. **Estado** ("Set a status", junto al perfil): ≤ 40 chars (S1) — one-liner
   visible, manual, no vive en el SSOT.
4. **Settings → Page** (`settings?tab=page`): "Customize preview" (texto/imagen
   del link-share) + Page focus. Preview ≠ About (S4).
5. **Cover image**: 3:1, 1200×400 px, < 8 MB, JPEG/PNG (S5).

## Post-paste (verificación + ledger)

1. Verificá la página pública en **browser** (Cloudflare 403 para fetchers
   planos, SOTA-2026 §5): About visible, sin markdown leaks, links de Social
   links anclados.
2. Marca el ledger: `pasco status --mark bios:kofi.long@en kofi`
   (ledgerKey = la fila de bios exacta que se pegó).
3. `pasco status kofi` — in-sync. `pasco diff` vacío para esa unidad.

## No hacerlo a mano en el workspace

- El paste solo se registra vía `--mark`; editar `content/deployments.yaml`
  a mano rompe el contrato D18 (solo `pasco` escribe el ledger).
- No pegues variantes no elegidas (solo la fila activa de bios es deployable).