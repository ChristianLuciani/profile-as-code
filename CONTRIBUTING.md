# Contributing to profile-as-code

First off: thanks for considering a contribution. This is an early-stage, spec-driven project —
every decision lives in [`docs/SPEC.md`](docs/SPEC.md) (decisions D1–D18). Read it before diving in.

## What you can contribute

| Area | Where | Entry points |
|---|---|---|
| **Core engine** (load, drift, geo, compile) | `packages/core/` | [`good first issue`](https://github.com/ChristianLuciani/profile-as-code/labels/good%20first%20issue) |
| **Schema** (the contract) | `schema/profile.schema.json` + `scripts/schema-check/` | Issue first — the contract is additive and reviewed carefully (D3) |
| **Renderers** | `packages/renderers/<platform>/` — 3 shipped (`github-readme`, `github-org`, `kofi`); new platforms welcome | One adapter per platform — the contribution seam. A renderer registers itself in its own `package.json` `pasco` block (`platform`, `deploySpec`, plus `assets: true` if it consumes the media bundle), then run `pnpm gen:renderers` — the CLI's map is generated, never hand-edited (#165). CommonMark escaping comes from `packages/markdown/` (`mdHref`/`mdText`) — never re-implement it in an adapter |
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
   `pnpm gen:zod` and commit both. Platform **metadata** (family, deploy kind, hosts, status) lives
   in `platforms/registry.yaml` (#154): edit an entry and run `pnpm gen:platforms`, which projects
   the core host maps + slug list, the SPEC §6 family/count block and the README status block —
   never hand-edit those projections. The schema enum stays hand-reviewed.
6. **Tests accompany behavior.** `packages/core` uses vitest; new behavior needs tests
   (fixtures live in `packages/core/tests/fixtures/`).
7. **Sign your work (DCO, D21).** Every commit carries a sign-off — commit with
   `git commit -s`. See [Sign your work](#sign-your-work-dco) below.
8. **A dogfood product issue adds the doc line that would have prevented it (#260).**
   Every problem a real end-to-end run finds — a wrong-file edit, an unexplained
   failure, a platform that truncates text — either lands with the line in the guide
   that would have caught it (usually `docs/START-HERE.md` or the section
   `docs/USER-GUIDE.md` it links) or the issue states why it cannot be documented yet
   (because the fix is code). A fix without its line is how the same gap comes back.
9. **Public surfaces name only what a reader can open (#254).** A command's help,
   output, error message, the npm README/description, or a scaffolded workspace may
   not point at a path, repo or tool the reader does not have. The CLI reads
   `packages/cli/skills/`, generated from `skills/` at build/pack time
   (`scripts/bundle-skills.mjs`) — edit the source under `skills/`, never the copy.
   The other allowed roots are an explicit `PASCO_SKILLS_DIR` and, for developers
   only, the marked workspace checkout; a published install must not depend on
   them. Dated records (CHANGELOG history, sourced research, issue/PR bodies) are
   exempt (AGENTS rule 8).

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
/tmp/schema-venv/bin/pip install jsonschema pyyaml
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

## Escalation and expected latency

**The number published here is measured, not a promise** — this project states its real
merge latency instead of committing to an SLA it cannot control. What follows is the time
from PR opened to PR merged, in hours, over every merged PR in the measurement window.

| Stratum | n | p50 | p90 | max |
|---|---|---|---|---|
| All merged PRs | 103 | 2.4 h | 83.0 h | 407.8 h |
| Maintainer / agent sessions | 80 | 1.6 h | 21.3 h | 407.8 h |
| Dependabot (waiting on the operator's turn) | 23 | 42.8 h | 109.3 h | 116.2 h |

Measured 2026-10-08, n=103 merged PRs (window 2026-08-08 → 2026-10-07), `[MI]`.
Distribution: 65.05% <6 h · 22.33% 6–48 h · 10.68% 2–7 d · 1.94% >7 d.

Read the strata, not the headline: the 83.0 h p90 for *all* PRs is an artifact of the 23
Dependabot PRs, which queue behind the operator's turn. **The closest analog to a third-party
PR — something that waits for the operator to act and is not their own work — is the Dependabot
stratum: 42.8 h p50 / 109.3 h p90.** The 21.3 h stratum is the maintainer's own work,
self-merged without a review gate; don't read it as your expected wait.

**Honest caveat: there are no external PRs yet.** Every PR in this sample was opened by the
maintainer or an agent session, so the number describes *maintenance cadence*, not response
to an outsider. The external stratum will be published here once the first 3 external PRs
exist (tracked in #175). Until then, treat these figures as the optimistic bound, not a
measurement of how this project treats strangers.

Regenerate every number above with `gh` + `python3` — the measurement window is pinned in the query and `--limit` exceeds that window's PR count:

```bash
gh pr list --state merged --limit 500 --search 'merged:2026-08-08..2026-10-07' --json createdAt,mergedAt,author | python3 -c '
import json,sys,math
from datetime import datetime as D
d=json.load(sys.stdin)
h=lambda p:(D.fromisoformat(p["mergedAt"].replace("Z","+00:00"))-D.fromisoformat(p["createdAt"].replace("Z","+00:00"))).total_seconds()/3600
q=lambda v,x:sorted(v)[max(0,math.ceil(x*len(v))-1)] if v else float("nan")
def row(label,v):print(f"{label:<22} n={len(v):>3}  p50={q(v,.5):6.1f}h  p90={q(v,.9):6.1f}h  max={max(v):7.1f}h")
rows=[(p,h(p)) for p in d]
row("all merged PRs",[x for _,x in rows])
row("maintainer/agent",[x for p,x in rows if not p["author"]["login"].startswith("app/")])
row("dependabot",[x for p,x in rows if p["author"]["login"].startswith("app/")])
v=[x for _,x in rows]
for lo,hi,lab in ((0,6,"<6h"),(6,48,"6-48h"),(48,168,"2-7d"),(168,1e9,">7d")):
    c=len([x for x in v if lo<=x<hi]);print(f"{lab:<22} {c:>3}  ({100*c/len(v):5.2f}%)")
'
```

### If your PR stalls

- **Stalled means: no maintainer response after 7 days.** That line is deliberate, not measured:
  response latency is not measurable yet — only 4 of 103 merged PRs carry any response from
  someone other than the author — so we set the threshold and will revisit it when the external
  stratum exists (#175). A 7-day silence is a signal that something was dropped, not normal
  queueing.
- **Where to escalate:** leave **one comment on the PR mentioning `@ChristianLuciani`**.
  The context stays in the thread — there is no separate channel to watch, and no second
  surface to go stale.
- **What happens next is never silence.** A stalled PR gets one of three explicit outcomes:
  a maintainer review, a `help wanted` label plus a note saying what is needed, or a close
  with a stated reason. This is the same discipline our issue triage already commits to
  (community-first §4, ≤48 h close-or-label), applied to the PR side.

## Contributing a platform skill (the special case)

Skills are the living-knowledge layer (D5). Every skill must follow `skills/README.md`:
structure (SKILL.md + research/SOTA-<year>.md + playbook.md + checks.yaml), evidence rule,
GEO section per platform, i18n policy, and the "no empty engagement" rule. Before opening the
PR, run the research using the prompts in `docs/research/` so the skill is defensible.

## Code of conduct

We follow the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful; contributions are
reviewed by humans.
