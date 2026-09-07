# Playbook — deploy del GitHub Org README (flavor brand, deploySpec: git)

## Pre-requisitos

- Workspace brand (`pasco init --flavor brand`) con `content/` lleno y
  `pasco validate` en verde.
- Org de GitHub creado (privado hasta pasar el checklist de public-readiness —
  repo-governance).

## Pasos

1. **Handle matrix** — `pasco check` (offline):
   - Cada fila `claimed` tiene `url` o match en `identity.links`.
   - Sin `drift/duplicate-handle`, sin `drift/handle-host-mismatch`.
2. **Live check (manual, red):** abrí cada URL `claimed` — debe resolver al
   perfil correcto (verificación `url-live` que el engine no automatiza).
3. **Build:** `pasco build github-org --lang en` →
   `profiles/github-org/README.md`.
4. **Deploy:** copiá el README al repo `org/org` del GitHub org y commiteá en tu
   branch + PR — el humano mergea (repo-governance §3).
5. **Verificación post-deploy:** cada badge y link del README resuelve; los
   handles `pending` NO figuran como surfaces vivas; el JSON-LD `Organization`
   está embebido (GEO §17.1).

## Nota de marca (impersonación)

Si un dominio/handle homónimo pertenece a una empresa viva NO relacionada
(p. ej. `topia.com`), la marca siempre firma con su nombre completo
("Topia Press") — nunca el nombre a secas. Checks: `org-mission-identity`,
`org-cta-one`.
