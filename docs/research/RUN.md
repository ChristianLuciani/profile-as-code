# Cómo ejecutar la investigación SOTA

La investigación por plataforma corre en una **sesión de agente dedicada** (ocupa contexto).
Este repo ya contiene todo lo necesario para lanzarla desde AionUi.

## Pasos

1. **Abrí esta carpeta como proyecto en AionUi** (`/Users/eva/PROJECTOS/GitHub/ChristianLuciani/profile-as-code`).
2. **Creá una conversación nueva** con tu asistente de trabajo (Pi).
3. **Pegá como primer mensaje el contenido de** [`02-prompt-investigacion.md`](./02-prompt-investigacion.md).
   Opcional: decile "seguí el prompt de docs/research/02-prompt-investigacion.md".
4. **Por sesión:** una plataforma, o dos si el contexto alcanza. Recomendado por orden:
   GitHub → LinkedIn → Upwork → X → ResearchGate.
5. **Guardá cada salida en** `research/SOTA-<año>/<plataforma>.md` dentro de este repo,
   con fuentes fechadas (la regla de evidencia está en el prompt).

## Checklist post-investigación

- [ ] Cada plataforma tiene `research/SOTA-<año>/<plataforma>.md` con fuentes fechadas
- [ ] Los `checks.yaml` propuestos son ejecutables por un CLI (campos, límites, reglas)
- [ ] El veredicto de 3 bullets por plataforma quedó escrito ("DEBE codificar / DEBE evitar / riesgos")
- [ ] Los archivos se commitean en la branch de trabajo (nunca directo a main)

## Nota

El prior-art scan ya está hecho ([`01-prior-art.md`](./01-prior-art.md)): nadie cubre
SSOT + multi-plataforma + skills por plataforma. La investigación SOTA es lo que hace
que las skills sean **defendibles** — es el moat del proyecto.
