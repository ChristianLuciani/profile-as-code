# GitHub Profile README — deploy playbook

Deploy = git (D9): el README generado se commitea en el repo-perfil
(`<user>/<user>`, p.ej. `ChristianLuciani/ChristianLuciani`) y GitHub lo muestra.
Sin pegar a mano, sin API.

## Flujo

1. **Refine**: `pasco refine github-readme --variants 3` → el agente (esta skill)
   produce 3 variantes en prosa. Elegí una:
   `pasco refine github-readme --choose gh-en-2`.
2. **Build determinista** (control de verdad): `pasco build github-readme` → regenera
   `profiles/github-readme/README.md` (snapshot byte-stable del SSOT).
3. **Deploy**: copiá la variante elegida al repo-perfil y commit:
   ```sh
   cp profiles/github-readme/variants/gh-en-2.md ../<usuario>/README.md
   cd ../<usuario> && git commit -am "docs: profile README (variante gh-en-2, desde profile-data)"
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
