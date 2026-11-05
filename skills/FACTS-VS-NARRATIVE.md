# Facts are unique · narrative is per surface

The one rule every platform skill in this tree carries. It has a single home —
**this file** — and each `SKILL.md` points at it. A skill may keep its platform's
own gold rule, but it may not present a second definition of the two axes nor
contradict this one: in particular, **order is narrative**, so ordering facts
differently is not a fact change. The normative version is SPEC §21.8, and the
pointer is asserted by `packages/cli/tests/skill-two-axis.test.ts`.

## The two axes

| Axis | What it is | May it differ per surface? |
|---|---|---|
| **Facts** | `content/*.yaml` — name, dates, roles, numbers, DOIs, links, evidence | **No.** One and identical everywhere. A contradiction between two surfaces is a defect (GEO/citability), not an adaptation. |
| **Narrative** | reader, emphasis, **order**, subset, composition | **Yes — deliberately.** It **must not** be propagated "for consistency". |

The texts shared verbatim across surfaces are the root-block facts themselves
(`identity.definition`, `positioning.statement`) — **facts**, not per-platform
texts. No per-platform `headlines`/`bios` row is shared.

## The pasco surfaces the rule touches

| Surface | Which axis | Where it lives |
|---|---|---|
| `headlines` | text (narrative) | per-platform rows; the same literal on two platforms is the warning sign |
| `bios` | text (narrative), banded by `length` | per-platform rows |
| `selection.views` | **subset** + **`orderKeys`** | workspace policy (`.pascorc`), never an SSOT field — order is narrative (SPEC §21.2/§21.3) |
| variant body | **composition** | `profiles/<platform>/variants/<id>.md` — the chosen variant's body |
| `identity.definition` · `positioning.statement` | **fact** | one row each, identical everywhere |

## What the engine does about it

`pasco check` runs the **advisory** rule `text/same-across-platforms`: when two
**different** platforms carry a byte-identical `headline` (or a `bio` in the same
`length` band), it emits a **warn** naming both platforms and the text kind. It is
a heuristic — it cites the copy and never fails the command, never blocks a build.
Exempt by construction: the same platform across langs, and `identity.definition`.
A warning is a prompt to write again for that surface's reader, not a fact to fix.

## When writing for a surface

1. Read that platform's skill: its reader, angle and limits are the narrative axis.
2. Never paste another platform's headline, bio or body "for consistency". Facts
   are what stay identical; the voice is what changes.
3. Change facts only at the SSOT, for every surface at once.
