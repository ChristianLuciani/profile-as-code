# START HERE

Three readers arrive at this repo, and each one breaks in a different place. Pick the
row that is you — the rest of this page is your shortest path, plus the mistake that
row actually makes.

| You are | You start at | The mistake this page prevents |
|---|---|---|
| **[A person with a profile to publish](#route-1--a-person-with-a-profile-to-publish)** | the npm package, no repo needed | editing the wrong YAML file, then wondering why nothing changed |
| **[Someone maintaining or contributing to the engine](#route-2--a-maintainer-or-contributor)** | a clone of this repo | a red CI you cannot read, or a commit that fails the DCO check |
| **[An agent acting for a person](#route-3--an-agent-acting-for-a-person)** | `pasco status --json` | treating a green `validate` as "my new text is published" |

Every route ends in the same place: [the full cycle of one change](USER-GUIDE.md#05-the-full-cycle-of-one-change)
— edit → validate → build → **publish** → mark → verify → tag. Step 4 is the one the
old docs assumed you already knew.

## Route 1 — a person with a profile to publish

No account, no repo, no terminal experience assumed. The whole path is one command
plus one file edit.

```sh
npm i -g @profile-as-code/cli     # Node >= 22
pasco init ~/profile-data-<username>
cd ~/profile-data-<username>
pasco validate                    # schema (fails) + drift/geo (warns)
pasco build github-readme         # writes profiles/github-readme/README.md
```

Then publish: copy the generated text for manual platforms, or commit the GitHub
artifact into your `<you>/<you>` repo ([§7](USER-GUIDE.md#7-deploy)).

**The mistake this route makes:** editing the wrong file. `bios.yaml` and
`identity.yaml` look identical in a terminal, and a row pasted into the wrong one
fails with a field error that sounds like a schema bug. Read
[your first edit](USER-GUIDE.md#44-your-first-edit-without-an-editor) before the
first `nano`; it has the block → file table and that exact error.

If you later want automation and history, the template repo on-ramp adds both —
[§3 Option A](USER-GUIDE.md#option-a--the-template-repo-recommended).

## Route 2 — a maintainer or contributor

The engine is a pnpm monorepo; `docs/SPEC.md` is the contract and `AGENTS.md` is the
working map. Behavior changes update the SPEC first.

```sh
git clone https://github.com/ChristianLuciani/profile-as-code
cd profile-as-code && pnpm install
pnpm test && pnpm typecheck && pnpm lint

git worktree add ../pasco-<topic> -b <branch>   # never work on main
```

Commit with `-s` (DCO: every commit carries a `Signed-off-by` trailer — CI enforces
it), push the branch, open the PR, and let the human merge.

**The mistake this route makes:** reading "CI failed" as one thing. The PR pipeline is
a set of contract gates, and each one names what it checked: schema self-test, the
documentation link/anchor gate, generated-artifact freshness (`pnpm gen:*`), typecheck,
tests, build, the tarball's `pasco` bin, and the DCO trailer. Fix the gate that
failed — [CONTRIBUTING.md](../CONTRIBUTING.md) lists them with the command that
reproduces each locally.

If your change is to a document, run the page projection too — `pnpm site` regenerates
`site/docs/` and gates every page. The Markdown is the only committed copy.

## Route 3 — an agent acting for a person

Start from the machine-readable surfaces, never from a rendered page:

```sh
pasco validate --json     # schema (FAIL, exit 1) + drift/geo (WARN, exit 0) — D12
pasco status --json       # per surface: sync · artifact · limits  (publication truth)
pasco check --json        # platform caps: does any text exceed the declared limit
```

**The mistake this route makes:** reporting "done" from `validate` alone. `validate`
judges your source of truth, not what is published:
`status.publication.artifact` answers *does the built artifact still match the SSOT*,
`sync` answers *did the SSOT change after the deploy*, and `limits` answers *does a
platform truncate this text*. A green validate with `artifact: diverges` is the normal
state of an unpublished edit — say so instead of declaring success.

Two things the engine cannot verify today, and an agent must not imply otherwise:
the live variant a platform is actually showing stays `attested` unless a live check
ran, and `validate` does not look at the active variant at all.

## What this page is not

- Not the reference — [USER-GUIDE.md](USER-GUIDE.md) is, section by section.
- Not the contract — [SPEC.md](SPEC.md) is, decision by decision.
- Not a tutorial for a specific platform — `skills/<platform>/` carries the living
  knowledge per surface, and the caps come from the platform's own declaration.

If a step here contradicts the guide, the guide wins and this page is the bug.
