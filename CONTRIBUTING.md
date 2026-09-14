# Contributing to profile-as-code

First off: thanks for considering a contribution. This is an early-stage, spec-driven project —
every decision lives in [`docs/SPEC.md`](docs/SPEC.md) (decisions D1–D15). Read it before diving in.

## What you can contribute

| Area | Where | Entry points |
|---|---|---|
| **Core engine** (load, drift, geo, compile) | `packages/core/` | [`good first issue`](https://github.com/ChristianLuciani/profile-as-code/labels/good%20first%20issue) |
| **Schema** (the contract) | `schema/profile.schema.json` + `scripts/schema-check/` | Issue first — the contract is additive and reviewed carefully (D3) |
| **Renderers** | `packages/renderers/<platform>/` (planned) | One adapter per platform — the contribution seam |
| **Platform skills** | `skills/<platform>/` | SOTA knowledge for a platform we don't cover (Behance, Xing, Indeed…) — see `skills/README.md` |
| **Research** | `docs/research/` | Prior-art and per-platform SOTA research, all claims sourced and dated |
| **Docs** | `docs/`, `README.md` | Typos, clarifications, translation of docs |

## Ground rules

1. **Never push to `main`.** It is protected: every change goes through a PR with the `ci`
   check green (schema contract self-test + `pnpm test` + `pnpm build`).
2. **Work on a descriptive branch** (e.g. `feat/<topic>`, `fix/<topic>`) — never push to
   `main`. The maintainer merges PRs. (Note: `aionui/pi/…` branch names come from the author's
   agent harness, not a project convention.)
3. **Evidence rule (skills):** every quantitative claim carries a URL + verification date.
   `[OFICIAL]` / `[EXPERTO]` / `[BENCHMARK]` / `[?]` — no source, no entry.
4. **Docs in English (D8).** Code comments too, when present.
5. **Zod is generated, never hand-written (D3).** The contract is `schema/profile.schema.json`;
   `packages/core/scripts/gen-zod.ts` regenerates the Zod schemas. If you change the schema, run
   `pnpm gen:zod` and commit both.
6. **Tests accompany behavior.** `packages/core` uses vitest; new behavior needs tests
   (fixtures live in `packages/core/tests/fixtures/`).

## Local setup

```bash
# pnpm >= 11 (see packageManager in package.json)
git clone https://github.com/ChristianLuciani/profile-as-code.git
cd profile-as-code
pnpm install
pnpm test          # all workspace tests
pnpm build         # type-checked build
pnpm typecheck     # tsc --noEmit

# contract self-test (also runs in CI)
python3 -m venv /tmp/schema-venv
/tmp/schema-venv/bin/pip install jsonschema
/tmp/schema-venv/bin/python scripts/schema-check/check.py
```

## Pull request workflow

1. Pick an issue (or open one first — discuss before big changes; the contract and core
   interfaces are deliberately designed, see SPEC §7).
2. Create your branch (descriptive name, e.g. `feat/<topic>`), commit in small logical steps.
3. Push and open a PR. Use the [PR template](.github/pull_request_template.md) (auto-applied).
4. Ensure the `ci` check is green and your branch is up to date with `main`.
5. Address review comments; all conversations must be resolved before merge.
6. The maintainer merges (currently 0 mandatory approvals — review is the maintainer's process).

## Contributing a platform skill (the special case)

Skills are the living-knowledge layer (D5). Every skill must follow `skills/README.md`:
structure (SKILL.md + research/SOTA-<year>.md + playbook.md + checks.yaml), evidence rule,
GEO section per platform, i18n policy, and the "no empty engagement" rule. Before opening the
PR, run the research using the prompts in `docs/research/` so the skill is defensible.

## Code of conduct

We follow the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful; contributions are
reviewed by humans.
