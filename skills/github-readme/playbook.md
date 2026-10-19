# GitHub Profile README — deploy playbook

Deploy = git (D9): el README generado se commitea en el repo-perfil
(`<user>/<user>`, p.ej. `ChristianLuciani/ChristianLuciani`) y GitHub lo muestra.
Sin pegar a mano, sin API.

## Flujo

1. **Refine**: `pasco refine github-readme --variants 3` → el agente (esta skill)
   produce 3 variantes en prosa. Elegí una:
   `pasco refine github-readme --choose gh-en-2`.
2. **Build**: `pasco build github-readme` → si hay una variante activa con cuerpo,
   escribe ese README completo VERBATIM en `profiles/github-readme/README.md`;
   sin variante, regenera el snapshot determinista del SSOT (control de verdad).
3. **Deploy**: copiá el artefacto al repo-perfil y commit:
   ```sh
   cp profiles/github-readme/README.md ../<usuario>/README.md
   cd ../<usuario> && git commit -am "docs: profile README (variante activa, desde profile-data)"
   ```
4. **Verificar en GitHub**: perfil → se ve el README en dark/light, links clicables,
   facts consistentes con el CV.

## Verificación post-deploy (CHECKLIST)

- [ ] README visible en el perfil (repo público con el nombre del usuario)
- [ ] Dark mode OK (badges y assets legibles)
- [ ] Todos los links → identity.links (clicables, sin 404)
- [ ] Facts byte-idénticos al CV (fechas, roles, papers, DOIs)
- [ ] UN CTA primario (Patreon + un link más)
- [ ] Se lee en ~30 segundos
- [ ] `pasco validate` exit 0 con la variante activa registrada

## Rollback

Git: `git revert` del último commit del repo-perfil. El SSOT nunca se ve afectado
(el deploy es un commit normal).
