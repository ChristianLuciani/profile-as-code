# templates/profile-data-brand — puntero al skeleton brand

El esqueleto del workspace **brand** (flavor: brand, D15/§17) se genera con el
propio engine — no se duplica acá:

```sh
pac init --flavor brand        # crea content/{flavor,identity,socialHandles,newsletter,podcast,press,audiences}.yaml
```

El template repo `profile-data-template` sigue siendo la fuente del esqueleto
**person** (ver `templates/profile-data/README.md`). Un workspace brand es un
repo privado propio por identidad (multi-workspace, §9.1): p. ej.
`profile-data-topia` para la marca Topia — nunca mezclado con el workspace
personal. Misma familia de nombres (`profile-data`-primero), mismo engine,
mismo contrato.

## Flujo brand

1. `pac init --flavor brand` en un repo privado (`profile-data-topia`).
2. Llenar `content/` (identity org + handle matrix + newsletter/podcast/press/audiences).
3. `pac validate` → 0 drift warnings en la matrix; `pac check` → handle rules OK.
4. `pac build github-org --lang en` → `profiles/github-org/README.md` (git deploy).
5. Deploy: el humano mergea (repo-governance).

Detalles en `docs/SPEC.md` §17 (brand flavor) y `skills/github-org/`.
