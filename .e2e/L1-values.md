# L1 · valores exactos para tu SSOT (decidido 2026-10-19)

**Vos escribís.** Cada bloque es un valor listo para pegar; el conteo a la derecha es el caracter count
medido con el mismo `.length` que usa el engine para medir (cada símbolo cuenta 1; los caracteres
Unicode como `·` o `—` también).

Regla después de cada edición: `pasco validate` (exit 0). Si te da exit 1, es el contrato — leé el
archivo/valor que nombra y volvé al valor anterior (están en `old-values.md`).

---

## 1. `content/headlines.yaml` — Upwork title (cap 50, hoy 80)

Reemplazá el texto actual del bloque `upwork/en` —

```
Strategic Systems Consultant — BI, ERP, Cash-Audit & Sovereign AI Infrastructure   (80 — corta en 50)
```

— por **una** de estas (todas ≤ 50):

```
Physicist · Systems Consultant · BI & Sovereign AI
Systems Consultant · BI · ERP · Sovereign AI
Physicist · Strategic Systems & Sovereign AI
```

> Por qué importa: con 80, Upwork corta el título en el medio dentro de la búsqueda.

## 2. `content/headlines.yaml` — ResearchGate (hoy sin entrada)

Agregá debajo del bloque de `upwork`:

```yaml
- platform: researchgate
  lang: en
  text: "Physicist · Complex Systems · X-ray Diffractometry"   # 53
```

## 3. `content/headlines.yaml` — X en inglés (hoy sólo `es`)

Agregá:

```yaml
- platform: x
  lang: en
  text: "Physicist · complex systems · synthetic intelligence"  # 53
```

## 4. `content/bios.yaml` — LinkedIn `es` short (hoy sólo `en` short)

Agregá:

```yaml
- platform: linkedin
  lang: es
  length: short
  text: "Físico | Inteligencia sintética educativa | Open source soberano"   # 65
```

## 5. `content/bios.yaml` — Upwork y ResearchGate EN-only (tu decisión: **b**)

**No toco el SSOT de contenido.** Tu decisión (*no pegás ES en Upwork/RG*) se declara una vez,
donde el workspace ya declara alcance — en `README.md`, sección **Decisiones de modelado**:

```markdown
- **Upwork y ResearchGate son EN-only** (decisión 2026-10-19): las dos superficies no tienen pegada
  en `es` y el SSOT no reserva bio `es` para ellas. `pasco status --mark` certifica la superficie
  pegada (EN); la ausencia de `es` es una decisión declarada, no un hueco.
```

> Efecto: la fila *Language coverage* de completitud **no se mueve** — mide *una entrada que cubra
> en/es/fr*, y ese target de 3 idiomas es una decisión de producto separada (ver PLAN §L1).

## 6. `content/identity.yaml` — URL canónica (tu decisión: **sí**)

En la fila del sitio web:

```yaml
  - platform: website
    label: CV — christianluciani.github.io
    url: https://christianluciani.github.io
    role: identity
```

> Esperado: `pasco validate --json` sube el structured-data y el geo overall. Yo mido el delta.

## 7. `content/identity.yaml` — Scholar sin `&hl=en`

```yaml
  - platform: scholar
    label: Google Scholar
    url: https://scholar.google.com/citations?user=7GbpmSQAAAAJ
```

> Saca el `&` del `sameAs` del JSON-LD. Google redirige igual.

## 8. `content/projects.yaml` — evidence de `proj-drahma` (Khanmigo)

Debajo del `evidence` que ya tiene la Drahma, agregá una segunda entrada con el claim que hoy
está en 3 superficies **sin fuente** (dijo el premerge review de `profile-data#1`, y es el mismo
texto que publica tu README vivo):

```yaml
    - claim:
        en: "36 Socratic virtual tutors for the Ecuadorian curriculum, field-tested with Amazonian indigenous communities (Aug 2024) — roughly two months before Khanmigo went public"
        es: "36 tutores virtuales socráticos para el currículo ecuatoriano, probados con comunidades indígenas amazónicas (ago 2024) — aproximadamente dos meses antes de la disponibilidad pública de Khanmigo"
      source: https://github.com/DRAHMAN-ORG/drahman-org
      verified: "2024-08-31"
```

> ⚠️ Ojo: tu propio review de #1 marcó que *"Amazonian indigenous communities"* es más específico que
> el SSOT (*"probados en campo amazónico"*). Si no lo podés sostener con una fuente, dejá el `en`
> como el SSOT dice (“field-tested in the Amazon”) y el claim sigue siendo citable.

## 9. `content/experience.yaml` — la fila que no cuadra

`exp-photo-audiovisual-teaching` está en el bloque de 2006–2010, con `org: "Film & TV School — Venezuela"`
y `role: "Photography · Editing · Audiovisual Teaching"`. Arriba, `exp-specialization-audiovisual`
(education.yaml) ya declara la *Especialización en Audiovisuales* en la misma escuela. **¿Es el mismo rol
del mismo lugar?** Si sí, no hay edición (son dos hechos distintos: el grado y la docencia).
Si no, la fila `exp-photo-audiovisual-teaching` tiene el `org` mal. Lo decidís vos — no lo toco.

---

## Lo que el plan NO va a decir

Ni el número de completitud ni el GEO se van a mover mágicamente con estas ediciones. Lo que sí
tenés al final es **verdad**: el ledger va a dejar de decir `never` para las superficies que
pegaste, el README vivo va a ser byte-idéntico a lo que el engine produce, y ningún campo va a ir
cortado por la plataforma.
