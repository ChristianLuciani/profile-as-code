# Contributing to profile-as-code

First off: thanks for considering a contribution. This is an early-stage, spec-driven project —
every decision lives in [`docs/SPEC.md`](docs/SPEC.md) (decisions D1–D18). Read it before diving in.

## What you can contribute

| Area | Where | Entry points |
|---|---|---|
| **Core engine** (load, drift, geo, compile) | `packages/core/` | [`good first issue`](https://github.com/ChristianLuciani/profile-as-code/labels/good%20first%20issue) |
| **Schema** (the contract) | `schema/profile.schema.json` + `scripts/schema-check/` | Issue first — the contract is additive and reviewed carefully (D3) |
| **Renderers** | `packages/renderers/<platform>/` — 2 shipped (`github-readme`, `github-org`); new platforms welcome | One adapter per platform — the contribution seam. CommonMark escaping comes from `packages/markdown/` (`mdHref`/`mdText`) — never re-implement it in an adapter |
| **Platform skills** | `skills/<platform>/` | SOTA knowledge for a platform we don't cover (Behance, Xing, Indeed…) — see `skills/README.md` |
| **Research** | `docs/research/` | Prior-art and per-platform SOTA research, all claims sourced and dated |
| **Docs** | `docs/`, `README.md` | Typos, clarifications, translation of docs |

## Ground rules

1. **Never push to `main`.** Every change goes through a PR with the `ci` check green
   (schema self-test + `pnpm lint` + D3 freshness + typecheck gate (`pnpm build && pnpm typecheck`, issue #108) + `pnpm test` + `pnpm build` + pack check —
   the full step list lives in `docs/ci-cd.md`); only the maintainer merges.
   While the repo is private on GitHub Free, branch protection is not available — `main` is
   protected by access + process (see [`docs/STANDARDS.md`](docs/STANDARDS.md)); it is
   re-applied the moment the repo goes public (see [`docs/ci-cd.md`](docs/ci-cd.md)).
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
7. **Sign your work (DCO, D21).** Every commit carries a sign-off — commit with
   `git commit -s`. See [Sign your work](#sign-your-work-dco) below.

## Local setup

```bash
# pnpm >= 11 (see packageManager in package.json)
git clone https://github.com/ChristianLuciani/profile-as-code.git
cd profile-as-code
pnpm install
pnpm test          # all workspace tests
pnpm build         # build (CLI: tsup transpile-only — type gate is pnpm typecheck, #108)
pnpm typecheck     # tsc --noEmit, whole workspace (CI-enforced since #108)
pnpm lint          # style gate (Biome: lint + format + import order)
pnpm lint:fix      # auto-fix with Biome's *safe* fixes only (unsafe fixes are a separate script)
pnpm lint:fix:unsafe  # opt-in: also apply Biome's *unsafe* fixes (review the diff)
pnpm format        # reformat only

# contract self-test (also runs in CI)
python3 -m venv /tmp/schema-venv
/tmp/schema-venv/bin/pip install jsonschema
/tmp/schema-venv/bin/python scripts/schema-check/check.py
```

## Sign your work (DCO)

Contributions are accepted under the [Developer's Certificate of Origin](DCO) 1.1 — a
certification, not a contract: by signing off you state that you wrote the code (or have the
right to submit it) and that it may be distributed under this project's licence (MIT). It is
recorded as **D21** in [`docs/SPEC.md`](docs/SPEC.md) §5.

Sign off every commit with `-s`:

```bash
git commit -s -m "feat(core): handle empty langMap"
```

which appends a trailer built from your git identity:

```
Signed-off-by: Your Name <you@example.com>
```

What the `dco` check enforces:

- **One trailer per commit, and its email must match the commit's author email** — sign off as
  yourself, never on someone else's behalf.
- **Forgetting is cheap to fix:** `git commit --amend -s` for the last commit, or
  `git rebase --signoff main` for the whole branch.
- **Merge commits are skipped** (they author nobody's work), and **bot commits are exempt** —
  Dependabot cannot sign off, and blocking it would block every dependency PR.
- If the commit range cannot be resolved, the gate **fails closed** instead of passing silently.

Use your real name and a valid email: the trailer is the record of who certified the
contribution. The gate is `scripts/dco-check/` (self-test first, then the range check) — run it
locally with `bash scripts/dco-check/test.sh`.

## Pull request workflow

1. Pick an issue (or open one first — discuss before big changes; the contract and core
   interfaces are deliberately designed, see SPEC §7).
2. Create your branch (descriptive name, e.g. `feat/<topic>`), commit in small logical steps,
   each one signed off (`git commit -s`).
3. Push and open a PR. Use the [PR template](.github/pull_request_template.md) (auto-applied).
4. Ensure the `ci` and `dco` checks are green and your branch is up to date with `main`.
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
