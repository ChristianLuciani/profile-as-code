# START HERE

Three readers arrive at this repo, and each one breaks in a different place. Pick the
row that is you — the rest of this page is your shortest path, plus the mistake that
row actually makes.

| You are | You start at | The mistake this page prevents |
|---|---|---|
| **[A person with a profile to publish](#route-1--a-person-with-a-profile-to-publish)** | the npm package, no repo needed | editing the wrong YAML file, then wondering why nothing changed |
| **[Someone maintaining or contributing to the engine](#route-2--a-maintainer-or-contributor)** | a clone of this repo | a red CI you cannot read, or a commit that fails the DCO check |
| **[An agent acting for a person](#route-3--an-agent-acting-for-a-person)** | `pasco status --json` | treating a green `validate` as "my new text is published" |

A fourth route is not a reader but a *state*: your workspace already exists and was
born on an older engine — [my workspace is behind](#route-4--my-workspace-is-behind).

Routes 1 and 3 end in the same place: [the full cycle of one change](USER-GUIDE.md#05-the-full-cycle-of-one-change)
— edit → validate → build → **publish** → mark → verify → tag. What the guide never
did was name the seam between step 3 and step 4. (Route 2 ends at a reviewed PR;
a maintainer never publishes a profile.)

## Route 1 — a person with a profile to publish

No account, no repo, no terminal experience assumed. The whole path is two commands
and one file edit.

```sh
npm i -g @profile-as-code/cli     # Node >= 22
pasco init ~/profile-data-<username>
cd ~/profile-data-<username>
pasco validate                    # schema (fails) + drift/geo (warns)
pasco build github-readme         # writes profiles/github-readme/README.md
```

Then publish: copy the generated text for manual platforms, or open a PR against
`<you>/<you>` with the GitHub artifact ([§7](USER-GUIDE.md#7-deploy)) — never a push
to its `main`.

**The mistake this route makes:** editing the wrong file. `bios.yaml` and
`identity.yaml` look identical in a terminal, and a row pasted into the wrong one
fails with a field error that sounds like a schema bug. Read
[your first edit](USER-GUIDE.md#44-your-first-edit-without-an-editor) before the
first `nano`; it has the block → file table and that exact error.

If you later want automation and history, the template repo on-ramp adds both —
[§3 Option A](USER-GUIDE.md#option-a--the-template-repo-recommended).

A fully worked run of this route — every command, the output a first-time user actually
gets, and the traps — is [TUTORIAL.md](TUTORIAL.md).

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
a set of contract gates — including the schema self-test, the documentation
link/anchor gate, generated-artifact freshness (`pnpm gen:*`), the page projection
gate, lint, typecheck, tests, build, the tarball's `pasco` bin, and the DCO trailer
on every commit. Each failing step names itself and prints the command that
reproduces it locally; fix that one, not "CI". The full step list is
[the CI/CD map](ci-cd.md).

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
judges your source of truth, not what is published. In `pasco status --json` the
envelope carries `data.publication[]`, one row per surface, and the three axes answer
three different questions: `artifact` — does the built artifact still match the SSOT;
`sync` — did the SSOT change after the deploy; `limits` — does a platform truncate
this text. A green validate with `artifact: diverges` is the normal state of an
unpublished edit — say so instead of declaring success.

What the engine still cannot verify, and an agent must not imply otherwise: a surface
with no live check reads `attested` (or `unverifiable` when the check could not run),
and `validate` reconciles the **active variant record** (`active[platform]`, including
`drift/active-variant-missing`) but neither validates that variant's text nor compares
it with what the platform is showing.

## Route 4 — my workspace is behind

You land here from Route 1 or 3, with a `profile-data-<username>` that validated on
an engine you installed months ago. Schema releases are **additive**, so nothing is
broken — which is exactly the trap: the workspace keeps validating while it misses
every field and check the new engine knows. This is the order that worked on a real
0.3.0 → 0.3.7 upgrade (#440), with a **receipt** after each step.

A receipt is one line that proves the effect landed — the value read back from the
file or command that should now carry it. **Never the exit code alone.** In that
run, four of six failures were the shell, not the engine: `zsh: command not found:
#` from a pasted comment, a `parse error near ')'` that skipped the edit, and an
edit block that never ran while the commit still reported success. The engine cannot
see any of them; the `grep` can.

1. **Install the engine.** Use the line that matches how you installed it
   ([§2](USER-GUIDE.md#2-install-the-pasco-cli)); the engine is one npm package.

   ```sh
   npm i -g @profile-as-code/cli@latest
   pasco --version                  # receipt: the version you meant to install
   ```

2. **Read the pair, not the binary.** `doctor` names the engine, the schema it
   validates, and whether your workspace loads.

   ```sh
   pasco doctor
   echo "exit $?"                   # receipt: exit 0, and "(valid)" on the line
   ```

   Stop here if it exits `1`: the line names the failing leg (workspace, or a floor
   you have not installed yet).

3. **Declare the floor in `.pascorc`.** The minimum engine your workspace now
   needs — exactly `MAJOR.MINOR.PATCH`, no `^`, `~`, `>=`, `v` or `*`
   ([§3](USER-GUIDE.md#configure-pascorc-optional-but-useful), SPEC §7.6).

   `.pascorc` is JSON (it takes no comments), so the key goes beside `workspace`:

   ```json
   {
     "workspace": ".",
     "engine": "0.3.7"
   }
   ```

   ```sh
   grep -n '"engine"' .pascorc      # receipt: the line you wrote
   pasco doctor                     # receipt: the requirement reads "met"
   ```

   A floor is a *minimum*, not a pin: `validate`, `build`, `export profile` and
   `preview` refuse before doing work when the installed CLI is older, and name the
   upgrade command. An unset floor is not a pass — `doctor` says `absent`.

4. **Adopt the fields the release added.** Additive means opt-in: the workspace
   validates without them and scores lower.

   ```sh
   pasco edit --list                # every addressable row this workspace has
   pasco edit 'positioning.statement.en' --set '<the text you adopted>'
   pasco edit 'positioning.statement.en'   # receipt: prints the value you wrote
   ```

   `pasco edit` reaches the answer-engine fields too (`identity.definition.<lang>`,
   `faq[id=…,lang=…].q|.a`, `faq[id=…].source`), and `pasco edit --create faq` seeds
   a root that does not exist yet (`content/faq.yaml`); the address table and the
   caps are in [§4.4](USER-GUIDE.md#44-your-first-edit-without-an-editor) (#435).
   When you do edit by hand, the receipt is the `grep` **and** `pasco validate`.

5. **Rebuild every artifact.**

   ```sh
   pasco build                      # all platforms; --lang for a language slice
   git diff --stat profiles/        # receipt: the files the new engine rewrote
   grep -rn '<the text you adopted>' profiles/   # receipt: it reached the artifact
   ```

   A byte diff after an engine upgrade is the release doing its job — commit the
   regenerated `profiles/`.

6. **Audit what you would publish.** `audit` is stricter than `validate`: the
   classes it calls FAIL are publishability, not validity (SPEC §7.1).

   ```sh
   pasco audit; echo "exit $?"      # receipt: 0, or the FAIL line that names its path
   ```

7. **See it before publishing it.** One self-contained page, written locally and
   never published.

   ```sh
   pasco preview --no-open          # writes .pasco/preview/index.html
   grep -n '<a distinctive fragment>' .pasco/preview/index.html   # receipt: the matched line
   ```

   Search a short fragment, not the whole sentence: the page HTML-escapes
   punctuation, so an exact multi-line match can miss a text that is present.

8. **Commit, push, and let CI re-read the clean tree** — when the workspace is
   its own repo with a CI workflow (Route 1 is not); otherwise the receipt of this
   step is the clean-tree `pasco doctor` above.

   ```sh
   git add -A && git commit -m "chore: upgrade to the current engine"
   git push -u origin HEAD          # publish the branch
   gh pr create --fill              # open the PR (push alone does not)
   gh pr checks                     # receipt: every check green
   ```

   The workspace's CI is the whole-run receipt — it re-runs `validate` and `build`
   on a clean checkout. No CI on your on-ramp (Options B/C)? The receipt is step 4's
   `pasco validate` and step 5's `git diff` on the committed tree.

A step is not done because the next one succeeded. If a receipt is empty, the write
did not land — redo that step before moving on. The reference version of this path,
with the address table and the authored caps, is
[§8.2](USER-GUIDE.md#821-upgrading-a-workspace-born-on-an-older-engine).

## What this page is not

- Not the reference — [USER-GUIDE.md](USER-GUIDE.md) is, section by section.
- Not the contract — [SPEC.md](SPEC.md) is, decision by decision.
- Not a tutorial for a specific platform — `skills/<platform>/` carries the living
  knowledge per surface. Caps are not there: they live in your workspace's
  `content/checks.yaml`, and the engine defaults are mostly `[?]` until you cite a
  source ([§6](USER-GUIDE.md#platform-caps-at-edit-time)).

If a step here contradicts the guide, the guide wins and this page is the bug.
