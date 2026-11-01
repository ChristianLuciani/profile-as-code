# Tutorial — a profile from zero, end to end

A worked run of [Route 1](START-HERE.md#route-1--a-person-with-a-profile-to-publish), written
from the commands and the output a first-time user actually gets. Every command below was run
on a clean machine on **2026-10-31** with `@profile-as-code/cli@0.3.7` and schema **v1.15**;
the numbers (scores, byte counts, warning counts) are that run's readings, not promises — a
different profile produces different ones.

**Covers:** npm install → `pasco init` → first edits → validate/build/preview → check/audit/entity
→ git + tag → deploy and certification, using the `github-readme` renderer and the **person**
flavor. **Does not cover:** the template repo (on-ramp A), the brand flavor, `pasco refine`, or a
real GitHub publish — step 11 simulates the deploy locally so no account is needed.

What you end with: a workspace of four files, two content blocks, a git history with a release
tag, one deploy artifact, a ledger row, and a generated checklist. About **30–45 minutes**.

If a step here contradicts [USER-GUIDE.md](USER-GUIDE.md), the guide wins and this page is the bug.

---

## Step 0 — check what you have

```sh
node -v && npm -v && git --version
```

**Expect** Node `v22` or newer (required), npm 10+, git any recent. `git` is only needed for
step 8 onward; everything before it works without a repository.

## Step 1 — install the CLI

The published package is the user path ([§2](USER-GUIDE.md#2-install-the-pasco-cli)):

```sh
npm i -g @profile-as-code/cli
pasco --version        # → pasco 0.3.7
npm view @profile-as-code/cli version   # → the same number
```

If you already keep a development build of `pasco` on your machine, install into a throwaway
prefix instead so you do not replace it — this is what the measured run did:

```sh
export PASCO_E2E=/tmp/pasco-e2e-prefix
npm i -g --prefix "$PASCO_E2E" @profile-as-code/cli
export PATH="$PASCO_E2E/bin:$PATH"
command -v pasco       # → /tmp/pasco-e2e-prefix/bin/pasco
```

**Why two versions are quoted:** `--version` tells you what the bin is; `npm view` tells you what
the registry published. They must agree — if they do not, the tarball is the problem, not you.

## Step 2 — create your workspace

```sh
pasco init ~/pasco-tutorial-demo
cd ~/pasco-tutorial-demo
find . -type f | sort
```

**Expect four files:**

```
./.pascorc
./content/checks.yaml
./content/identity.yaml
./README.md
```

`init` refuses to overwrite: run it twice and the second run exits `1` with
`init: refusing to scaffold: …/content already exists`. Nothing versions the folder for you —
giving it a repo is the recommended extra, not a requirement.

> The folder name is free-form. A real workspace is named `profile-data-<username>`
> ([§8.3](USER-GUIDE.md#83-multiple-identities-person--brand-multi-workspace)); this tutorial uses
> `pasco-tutorial-demo` so it does not look like a real identity.

## Step 3 — the first edit

`content/identity.yaml` holds facts only — one file maps to one root property
([§4.1](USER-GUIDE.md#41-the-golden-rule-one-file--one-root-property)). Open it and replace the
template with:

```yaml
name: María Demo
location: Quito, Ecuador
definition:
  en: "María Demo is an engineer building demo profiles with profile-as-code."
links:
  - platform: github
    label: GitHub
    role: identity
    url: https://github.com/maria-demo
  - platform: linkedin
    label: LinkedIn
    url: https://linkedin.com/in/maria-demo
```

Two fields carry more weight than they look:

- `role: identity` marks the page that **is** the entity. It becomes the JSON-LD `@id`; without it
  you get `warn: [geo/entity-id]`.
- `definition` is the one sentence an answer engine can quote; it becomes the JSON-LD
  `description`. Without it you get `warn: [geo/canonical-definition]`.

### The classic mistake

Paste a `bios:` block into this file and you get:

```
validate: schema validation failed (D12 fail-on-schema) — 1 violation(s)
  identity: Unrecognized key: "bios"
```

It names the **root property** (`identity`), which is the same as the file only because the
mapping is 1:1 — `bios` belongs in `content/bios.yaml`. The message is actionable once you know
that; it is not the file path the guide historically promised.

## Step 4 — validate, and read the score

```sh
pasco validate; echo "exit=$?"
```

On a fresh workspace with three facts this exits **0** and prints **five** GEO warnings plus one
info note, and an `overall score` in the 55–65 range. That is not a failure and not a grade:

- `schema valid` is the gate. Only a schema violation exits `1`.
- the warnings are a **checklist of what an answer engine would still miss** — semantic anchors,
  an FAQ, more `sameAs` links.
- **the score can go down when you add content.** In the measured run it went 63 → 56 after
  adding a project without `evidence[]`. It measures GEO readiness, not effort (tracked as
  [#399](https://github.com/ChristianLuciani/profile-as-code/issues/399)).

The machine view is one flag away:

```sh
pasco validate --json      # { command, ok, exitCode, data: { workspace, schema, drift, geo } }
pasco doctor               # engine 0.3.7 · schema v1.15 · workspace … (valid) · no engine requirement
```

## Step 5 — build the artifact

```sh
pasco build github-readme
find profiles -type f | sort
cat profiles/github-readme/README.md
```

**Expect** one file, `profiles/github-readme/README.md`. It contains your name, the links as
badges, a project block when you have one, and the experience as `jobTitle`/`worksFor` inside a
**JSON-LD block** — alongside `@id` (from the `role: identity` link), `description` (from
`definition`) and `sameAs` for the rest.

The last lines are generated too:

```
Profile completeness: 3% — 0/5
<!-- generated by profile-as-code pasco build github-readme · 0 projects · 0 publications -->
```

That footer **ships to the surface** — on GitHub it is public. `3%` is the completeness score
([SPEC §20](SPEC.md)); `pasco status --completeness` expands it into the five items. Expect the
`0/5` to lag the percentage: items earn partial credit before any one is fully satisfied.

> `build` also prints `[github-readme] (no texts for this platform+lang)` when you have no bios or
> headlines yet. It means "no base texts", not "no artifact" — the artifact is still written.

## Step 6 — see it without publishing it

```sh
pasco preview --no-open
```

**Expect** a single HTML file at `.pasco/preview/index.html` (about 15 KiB) and a privacy gate
line: `7 rules · 0 findings`. It is self-contained — no `<script>`, no external asset, no server:

```sh
grep -c '<script' .pasco/preview/index.html    # → 0
```

`preview` is not a publication, and the file is disposable — add `.pasco/` to `.gitignore`.

## Step 7 — the three diagnostic commands

```sh
pasco check    # every text against its platform cap (offline)
pasco audit    # findings only: dangling-ref · contradiction · unsourced-claim
pasco entity --jsonld
```

They answer different questions:

| Command | Question | In this run |
|---|---|---|
| `check` | does a text exceed the cap the catalogue declares? | 4 user checks executed; no measured text yet |
| `audit` | do the surfaces still say what the SSOT says? | 0 findings, and it says **why** nothing was measured |
| `entity --jsonld` | what do I paste into a page the engine does not render? | the same JSON-LD the artifact embeds |

`entity` exits `1` when there is no `@id`; here it exits `0` because of `role: identity`.

> `check` and `audit` are honest before they are readable: their human output still carries
> milestone labels (`M3/M4`, `D17/§18.8`). Read the verdict, not the vocabulary.

## Step 8 — git, `diff` and the release tag

On on-ramp B nothing versions the workspace, and `pasco diff` is the one command that needs a
repository:

```sh
pasco diff; echo "exit=$?"
# → exit 1: … is not inside a git repository — pasco diff is git-based (release markers = tags)

git init -b main
pasco preview --no-open    # warns: the destination is in a git work tree and is not ignored
printf '.pasco/\n' > .gitignore
git add -A && git commit -m "chore: initial workspace"
pasco diff                 # → diff since first commit (no release tag found) — no changes
git tag release-2026-10
pasco diff                 # → diff since release tag 'release-2026-10' — no changes
```

The tag is the baseline. The default pattern is `release-*`
([§3 `.pascorc`](USER-GUIDE.md#configure-pascorc-optional-but-useful)); a tag that does not match it
is invisible to `diff`.

## Step 9 — add content and watch drift

Two blocks, in their own files ([§6](USER-GUIDE.md#6-add-entries--update-content)):

```sh
cat > content/experience.yaml <<'EOF'
- id: exp-demo
  role:
    en: Demo Engineer
    es: Ingeniero Demo
  org: Example Corp
  start: "2024-03-01"
  end: "present"
  highlights:
    en:
      - Shipped a demo profile as code.
EOF

cat > content/projects.yaml <<'EOF'
- id: proj-demo
  name: demo-profile
  status: active
  description:
    en: A demo project that renders one profile to every surface.
  links: [https://github.com/maria-demo/demo-profile]
  keywords: [profile, ssot, demo]
  evidence: []
EOF

pasco validate; echo "exit=$?"
```

**Expect `exit 0` with exactly one drift warning:**

```
warn: [drift/url-not-in-identity] URL "https://github.com/maria-demo/demo-profile" lives on a
platform host but is not in identity.links — add it there (contract rule: URLs only from
identity.links) (projects[0].links[0])
```

Add that URL to `identity.links` and the warning disappears. This is the engine's whole point:
a fact that appears on one surface and not in the SSOT is a contradiction an LLM will find.

## Step 10 — build, commit, and read the re-paste list

```sh
pasco build github-readme
git add -A && git commit -m "feat: add experience and a demo project"
pasco diff
```

**Expect** a semantic list — not `git diff`:

```
diff since release tag 'release-2026-10'
  files changed:
    content/experience.yaml → root: experience
    content/identity.yaml → root: identity
    content/projects.yaml → root: projects
    profiles/github-readme/README.md → root: profiles/github-readme/README.md
  hint: texts or facts changed — re-verify deployed profiles (re-paste per platform playbook)
```

That is your **re-paste list**: every surface that still shows the old text. Tag the release once
you have published — step 11 closes with it.

## Step 11 — status, deploy, mark, verify

Before you deploy anything, read the state — a green `validate` never meant published:

```sh
pasco status
# github-readme: never · artifact: matches-SSOT · limits: ok
pasco status --json          # data.publication[] — one row per surface, the same three axes
pasco status --completeness  # expands the 3% — 0/5 footer into its five items
```

Three axes, three questions: `artifact` — does the built file still match the SSOT? `sync` — did
the SSOT change after the last deploy? `limits` — does a platform truncate this text? They are
allowed to disagree: `artifact: matches-SSOT` with `sync: never` is the normal state of an edit
you have not published.

`github-readme` is a **git/API** surface: the artifact is a file you publish
([§7](USER-GUIDE.md#7-deploy)). This step simulates the publish in a local repository, so it needs
no account — the only difference from a real run is that the "profile repo" is local:

```sh
mkdir -p ~/profile-readme-demo && cd ~/profile-readme-demo
git init -b main
cp ~/pasco-tutorial-demo/profiles/github-readme/README.md README.md
git add -A && git commit -s -m "deploy: refresh my GitHub profile"
git switch -c deploy/2026-10-31
git log -1 --format='%b'     # → Signed-off-by: Your Name <you@example.com>
```

Then confirm the deploy in the ledger — `pasco` is the only writer of
`content/deployments.yaml`:

```sh
cd ~/pasco-tutorial-demo
pasco status --mark identity github-readme
```

**Expect** a record with `deployedAt`, a `contentHash`, and:

```
certification: attested (anchor b7979d90… — --verify can judge this record)
```

`attested` means **you said so**. It is not a machine check. Now run the opt-in live check:

```sh
pasco status --verify
```

**Expect** it to fetch once and report the truth about a page that does not exist:

```
identity → github-readme: unverifiable: http-404
```

Two consequences worth knowing before you run it:

- `--verify` is the engine's **only** network path, and it is never implicit in `status`, `build`,
  `validate` or `check`.
- an attempt that fails **replaces** `attested` with `unverifiable: <reason>` — checking can lower
  your certification, and that is the honest reading
  ([#400](https://github.com/ChristianLuciani/profile-as-code/issues/400)).

Finish the loop with the generated view:

```sh
pasco status --write-checklist
cat CHECKLIST.md
git add -A && git commit -m "chore: deploy ledger + checklist view"
```

`CHECKLIST.md` is **generated** — never edit it. Each surface carries its certification token
(`in-sync/attested`, `in-sync/unverifiable: http-404`), so nothing is ever presented as a bare
"in sync".

Close the cycle with the release tag:

```sh
git tag release-2026-11
pasco diff      # → no changes
```

---

## What this run found

The tutorial above is the corrected path. The first run hit these frictions; each is tracked, so a
future reader does not have to rediscover them:

| What surprised the first run | Issue |
|---|---|
| README and USER-GUIDE quoted different published versions; the `--help` command list was incomplete | [#393](https://github.com/ChristianLuciani/profile-as-code/issues/393) |
| `init` creates four files, not the three the table lists; the schema error names the root, not the file | [#394](https://github.com/ChristianLuciani/profile-as-code/issues/394) |
| `pasco --help` points at `packages/cli/README.md`, which an npm install does not have | [#395](https://github.com/ChristianLuciani/profile-as-code/issues/395) |
| `build` says "no texts" while writing an artifact; the completeness footer is published and undocumented | [#396](https://github.com/ChristianLuciani/profile-as-code/issues/396) |
| `check`/`audit` speak in milestone labels, and the empty-scope hint suggests a step you already ran | [#397](https://github.com/ChristianLuciani/profile-as-code/issues/397) |
| `--mark` has three names in two surfaces; `preview` warns about an `--out` you never passed | [#398](https://github.com/ChristianLuciani/profile-as-code/issues/398) |
| adding a project without evidence lowers the GEO score | [#399](https://github.com/ChristianLuciani/profile-as-code/issues/399) |
| `--verify` announces "verified" and downgrades `attested` without warning | [#400](https://github.com/ChristianLuciani/profile-as-code/issues/400) |

## Command coverage

The inventory below is `pasco --help` at CLI **0.3.7** (2026-10-31). *Exercised* means the command
was run in this tutorial and its output is quoted above — not that it was read in the guide.

| Command | Exercised here | Where / why not |
|---|---|---|
| `init` | ✅ person flavor + the refusal path | step 2 |
| `validate` | ✅ text + `--json` | steps 4, 9 |
| `doctor` | ✅ | step 4 |
| `build` | ✅ one platform, default lang | steps 5, 10 |
| `preview` | ✅ `--no-open` | step 6 |
| `diff` | ✅ before git · before the first tag · after a tag | steps 8, 10 |
| `check` | ✅ | step 7 |
| `audit` | ✅ | step 7 |
| `entity` | ✅ `--jsonld` | step 7 |
| `status` | ✅ report · `--json` · `--completeness` · `--mark` · `--verify` · `--write-checklist` | step 11 |
| `edit` | ❌ | writes one contract row; needs a value you mean to publish |
| `refine` | ❌ | PARTIAL (M3): emits an agent task template |
| `discover` | ❌ | reads a public surface over the network and writes nothing |
| `cite-check` | ❌ | needs saved answer-engine answers (NDJSON) |
| `post` | ❌ | MVP subcommands: seed · task · choose · check · export · import · list |
| `presence` | ❌ | the D23 presence board |
| `release plan` | ❌ | ordered fan-out for one release |
| `export profile` | ❌ | normalized profile for programmatic consumers |
| `export ai-policy` | ❌ | writes robots.txt / llms.txt / AI-POLICY.md |
| `skills:export` | ❌ | copies the shipped skills to a harness |
| `build --lang` · all platforms | ❌ | only the default `en` slice and one renderer were built |
| `--workspace <path>` | ❌ | every run resolved the workspace from `.pascorc`/cwd |
| `init --flavor brand` | ❌ | brand flavor is out of scope here |

Not exercised is not a judgement of the command — it is what a first run of Route 1 touches.
Per-command `--help` is the next place to look.

## Where to go next

- **A real publish:** [§7 Deploy by PR](USER-GUIDE.md#deploy-by-pr) — clone `<you>/<you>`, branch,
  `git commit -s`, `gh pr create`, and never push to that repo's `main`.
- **History and automation:** on-ramp A, the template repo
  ([§3](USER-GUIDE.md#option-a--the-template-repo-recommended)) — the same workspace plus CI.
- **More surfaces:** [§6](USER-GUIDE.md#6-add-entries--update-content) for `bios`, `headlines`,
  `projects`, `publications`; `pasco build` without a platform builds every one.
- **The engine's contract:** [SPEC.md](SPEC.md) explains *why* each rule exists.
