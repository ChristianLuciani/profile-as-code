# GitHub repo metadata — deploy playbook

Deploy = **API de GitHub** (D9): la metadata se escribe con `gh` (REST/GraphQL),
no se pega a mano en la UI. El social preview es la única pieza sin API — se
sube a mano y se verifica visualmente.

Superficie: `github-repo-meta` (`kind: repo-meta`, D23/#262). Estado esperado en
el plan: `never` mientras el ledger no pueda direccionar la superficie (límite
declarado v1).

## Flujo

1. **Plan**: `pasco release plan <release-id> --json` → `surfaces[]` trae la fila
   `github-repo-meta` y `baseText` la espina factual del release.
2. **Componer** (ver SKILL.md): `description` ≤350 chars · `topics` ≤20 ·
   release notes desde `changedUnits`.
3. **Deploy**:
   ```sh
   gh repo edit --description "<description>"
   gh repo edit --add-topic <topic>        # repetir por topic nuevo
   gh release edit <tag> --notes-file <notas.md>
   ```
4. **Social preview**: subir 1280×640 (Settings → Social preview). Sin API.
5. **Verificar** (ver abajo) y reportar el resultado en el PR/issue del release.

## Verificación post-deploy

- [ ] `gh repo view --json description --jq .description` devuelve la descripción
      publicada, y no pasa de 350 chars.
- [ ] `gh repo view --json repositoryTopics --jq '.repositoryTopics[].name'`
      devuelve exactamente los topics declarados (≤20), sin duplicados.
- [ ] `gh release view <tag> --json body --jq .body` devuelve las notas y el
      primer párrafo cita la versión + fecha del release row.
- [ ] El social preview se ve en la página del repo (1280×640, sin texto
      recortado) — inspección visual, es la excepción sin API.
- [ ] La descripción describe el artefacto, no repite el positioning personal de
      `github-readme`.
- [ ] Ningún número de las notas carece de fuente (regla de evidencia).

## Rollback

`gh repo edit` es aditivo y versionable en git no: guardá la descripción y los
topics anteriores antes de escribir (`gh repo view --json description,repositoryTopics`).
Revertir = repetir el paso 3 con los valores previos; las release notes se
revierte con `gh release edit <tag> --notes-file <previas.md>`.
