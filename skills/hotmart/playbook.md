# Playbook — deploy Hotmart (paste, D9)

Superficie: página de creador de Hotmart (storefront + Members Area) — **sin
API documentada para el cuerpo del perfil** (SOTA-2026 §6 [?]). El deploy es
manual; el ledger lo registra `pasco status --mark`.

⚠️ **Primer paste = verificación de superficie**: el campo exacto del cuerpo
de perfil y la URL del Hotmart Space están sin verificar [?] (SOTA-2026
§5/§6). En el primer paste documentá (en este archivo, con fuente + fecha)
dónde se pega y qué URL pública resulta — eso convierte el [?] en dato.

## Pre-paste

1. `pasco validate` — exit 0 (schema + drift + geo).
2. `pasco build hotmart --lang <lang>` — escribe `profiles/hotmart/README.md`;
   ese archivo ES el texto a pegar (plano, 1 fila de bios — long > medium >
   short).
3. Verificá el link canónico: `identity.links` debe contener la URL pública
   de tu tienda cuando esté verificada (host `hotmart.com`). Mientras la URL
   de Space esté sin verificar [?], NO la inventes — dejá el link fuera y
   agrégalo con la URL real copiada del dashboard (regla drift).
4. **Gate de negocio (EC)**: el payout a banco ecuatoriano está `[?]`
   (SOTA-2026 §4) — el ítem de verificación vive en la instancia venture
   (issue #137). Un paste de perfil no depende del payout; una venta, sí.

## Paste (dashboard)

Orden sugerido (a verificar en el primer paste — SOTA-2026 §5/§6):

1. Ingresá a `app.hotmart.com` con la cuenta de creador.
2. Localizá la configuración de página/tienda del creador (el producto
   "Hotmart Space" del pricing — dirección web personalizada [?]) y pegá el
   contenido de `profiles/hotmart/README.md` tal cual en el campo de
   descripción/perfil (texto plano).
3. Verificá cómo queda el render: si el campo aplica formato enriquecido,
   documentalo acá (con fuente) — el renderer asume texto plano.
4. Los links de producto NO van en el cuerpo: pertenecen a
   `identity.links`/`projects[].links` del SSOT y a los campos de producto
   del dashboard.

## Post-paste (verificación + ledger)

1. Verificá la página pública en **browser**: cuerpo visible, sin markdown
   leaks, sin caracteres de escape raros.
2. Marcá el ledger: `pasco status --mark bios:hotmart.long@en hotmart`
   (ledgerKey = la fila de bios exacta que se pegó).
3. `pasco status hotmart` — in-sync. `pasco diff` vacío para esa unidad.

## No hacerlo a mano en el workspace

- El paste solo se registra vía `--mark`; editar `content/deployments.yaml`
  a mano rompe el contrato D18 (solo `pasco` escribe el ledger).
- No pegues variantes no elegidas (solo la fila activa de bios es deployable).
