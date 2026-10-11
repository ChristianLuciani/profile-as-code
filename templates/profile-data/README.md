# templates/profile-data — puntero al on-ramp A

El esqueleto **completo** del workspace por usuario vive en su propio **GitHub template
repository**:

👉 **https://github.com/ChristianLuciani/profile-data-template** (fork / *Use this template*)

No se duplica acá a propósito (evita drift). El template repo es la fuente de verdad del
esqueleto; este README es el puntero. Este es el **on-ramp A** (recomendado): cero
instalación para arrancar y trae el paquete completo — ejemplo comentado, docs operativas,
licencia y automatización. Requiere cuenta y repo.

## Los otros dos on-ramps (sin cuenta ni repo)

El workspace **es una carpeta**; un repo es el lugar recomendado para guardarla, no un
requisito (SPEC §9). Los dos caminos que no necesitan cuenta ni repo son pares entre sí y
conservan todo el set de comandos del motor salvo `pasco diff` (que necesita historial git):

- **On-ramp B — `pasco init`**: carpeta mínima y válida en segundos. Pierde automatización e
  historial (nada corre en un cambio y nada versiona por vos).
  ```sh
  pasco init ~/profile-data-<username>
  ```
- **On-ramp C — traé tu almacenamiento**: el mismo scaffold `pasco init`, escrito en la ruta
  que elijas (disco, carpeta sincronizada, otro host de git). Mismas capacidades que B.

El paquete de npm `@profile-as-code/cli` es público: B y C no necesitan acceso a ningún repo.
Guía completa (EN): [`docs/USER-GUIDE.md`](../../docs/USER-GUIDE.md) §3. Contrato:
[`docs/SPEC.md`](../../docs/SPEC.md) §9.

## Flujo (on-ramp A)

1. El usuario forkea / usa el template → `profile-data-<username>` (privado recomendado:
   `gh repo create profile-data-<username> --template https://github.com/ChristianLuciani/profile-data-template --private`).
2. Llena `content/` con sus datos (el ejemplo incluido es ficticio y documenta el schema).
3. Corre `pasco validate` / `pasco build` / `pasco refine` (engine, por ruta — ver `.pascorc`).
4. Deploy: manual con `CHECKLIST.md` (LinkedIn, Upwork…) o git/API (GitHub README).

Detalles de integración (ruta configurada, sin symlinks; montaje symlink solo para CI del
engine): ver `docs/SPEC.md` §9 (D14).
