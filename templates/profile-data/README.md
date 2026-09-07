# templates/profile-data — puntero al template repo

El esqueleto del workspace por usuario vive en su propio **GitHub template repository**:

👉 **https://github.com/ChristianLuciani/profile-data-template** (fork / *Use this template*)

No se duplica acá a propósito (evita drift). El template repo es la fuente de verdad del
esqueleto; este README es el puntero.

## Flujo

1. El usuario forkea / usa el template → `profile-data-<username>` (privado recomendado:
   `gh repo create profile-data-<username> --template https://github.com/ChristianLuciani/profile-data-template --private`).
2. Llena `content/` con sus datos (el ejemplo incluido es ficticio y documenta el schema).
3. Corre `pasco validate` / `pasco build` / `pasco refine` (engine, por ruta — ver `.pascorc`).
4. Deploy: manual con `CHECKLIST.md` (LinkedIn, Upwork…) o git/API (GitHub README).

Detalles de integración (ruta configurada, sin symlinks; montaje symlink solo para CI del
engine): ver `docs/SPEC.md` §9 (D14).
