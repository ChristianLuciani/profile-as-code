# Tutorial — a profile from zero, end to end

A worked run of [Route 1](START-HERE.md#route-1--a-person-with-a-profile-to-publish), written
from the commands and the output a first-time user actually gets. **Part 1** was run on a clean
machine on **2026-10-31** with `@profile-as-code/cli@0.3.7` and schema **v1.15**; **Part 2**
(the rest of the command inventory) was measured on **2026-11-01**, same CLI, on the workspace
Part 1 left behind. The numbers (scores, byte counts, warning counts) are those runs' readings,
not promises — a different profile produces different ones.

**Covers:** npm install → `pasco init` → first edits → validate/build/preview → check/audit/entity
→ git + tag → deploy and certification, using the `github-readme` renderer and the **person**
flavor. **Part 2** exercises every remaining command in `pasco --help` 0.3.7 plus the variants:
`edit` · `refine` · `discover` · `cite-check` · `post` · `presence` · `release plan` ·
`export profile` · `export ai-policy` · `skills:export` · `build --lang` / all platforms ·
`--workspace` · `init --flavor brand`. **Does not cover:** the template repo (on-ramp A) or a
real GitHub publish — step 11 simulates the deploy locally so no account is needed.

What you end with: the Part 1 workspace (four files, a git history with a release tag, one deploy
artifact, a ledger row, a generated checklist) plus the Part 2 workspace (`headlines`/`bios`/
`positioning`/`releases`, `posts/`, a brand sibling, and the AI-policy artifacts). About
**30–45 minutes** for Part 1; Part 2 is a command tour, not a second build-from-zero.

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
- **the score is a readiness average, and a code with nothing to measure is `n/a`.** The measured
  0.3.7 run went 63 → 56 after adding a project without `evidence[]` — the regression
  [#399](https://github.com/ChristianLuciani/profile-as-code/issues/399), now fixed. An
  `n/a` code carries no weight, so that addition no longer moves the score; adding a fact can still
  move it when it changes a ratio a code measures.

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

> With no bios or headlines yet, the measured 0.3.7 run printed
> `[github-readme] (no texts for this platform+lang)`, which read as "no artifact"; it never meant
> that. [#396](https://github.com/ChristianLuciani/profile-as-code/issues/396) rewords it (PR
> #405) to `0 base texts — bios/headlines — for this platform+lang; the artifact is still written
> from the declared facts`.

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

The tutorial above is the corrected path. The first run (CLI 0.3.7, 2026-10-31) hit these
frictions; the #395–#400 set is fixed by PRs #404, #405 and #406, and the table stays as the
record of that run:

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

## Part 2 — the rest of the inventory

Measured on **2026-11-01** on the workspace Part 1 left behind, same
`@profile-as-code/cli@0.3.7`. Part 1 walked Route 1; this part walks the rows it left pending.
The workspace gained the files each command needs (`headlines.yaml`, `bios.yaml`,
`positioning.yaml`, `releases.yaml`, `posts/`) and a brand sibling (`~/pasco-brand-demo`). Every
block below is a command that ran and the lines it printed.

> **Version note.** `main` is ahead of the published `0.3.7` (53 commits on 2026-11-01): #395–#400
> were fixed by #403–#410 and are closed, but **not released**. The output here is what a user
> installs from npm today; where `main` already changed a message, the text says so.

### M12 — `edit`: read, preview, write, refuse

`edit` addresses **one row** with a contract path, never a file:
`headlines[platform=…,lang=…].text`. It does not create rows, so the first step is the YAML.

```sh
cat > content/headlines.yaml <<'YAML'
- platform: github-readme
  lang: en
  text: Engineer building demo profiles with profile-as-code.
YAML
pasco edit 'headlines[platform=github-readme,lang=en].text'
pasco edit 'headlines[platform=github-readme,lang=en].text' \
  --set "Engineer building demo profiles — profile-as-code." --check
pasco edit 'headlines[platform=github-readme,lang=en].text' \
  --set "Engineer building demo profiles — profile-as-code."
```

The read prints `current:` and the §19 surface impact (`never` while no ledger record exists).
`--check` prints the **rendered** lines that change (`- ### …` / `+ ### …`), not the YAML; the
write adds `written: yes` and `validates: yes`. The refusals are the contract: a `--set` with a
line break is usage (exit `2`), a 0-row address exits `1` and lists `available:`, and a missing
selector exits `2` with the grammar.

**Finding the address.** `pasco edit --list` prints every addressable row of the loaded
workspace — read-only, deterministic, and built by the same constructors resolution uses, so it
never teaches a path the command would reject ([#411](https://github.com/ChristianLuciani/profile-as-code/issues/411)).
It is on `main` and **not yet in the published 0.3.7** this walkthrough measured, so expect the
next release to carry it:

```sh
pasco edit --list                  # every block, one address per line
pasco edit --list headlines        # scope: positioning | headlines | bios | identity.links
pasco edit --list --json           # { addresses: [{ address, kind, readOnly }], warnings }
```

Link rows print `(read-only)`; a link row whose platform cannot be expressed is a warning, a
label the grammar cannot express is dropped so the row is listed by its platform when that
resolves to one row, and any address that resolves to more than one row (a duplicate
headline/bio, a label-less link sharing its platform) is a warning — never an address that
would not parse. An empty workspace prints the header alone. `--list` with `--set`, `--check` or an
address is usage (exit `2`). `pasco edit --help` still prints the four address *shapes*.

### M13 — `export profile`: deterministic, no clock

```sh
pasco export profile --json > /tmp/p1.json
pasco export profile --json > /tmp/p2.json
cmp /tmp/p1.json /tmp/p2.json && echo IDENTICAL
pasco export profile --json --now 2026-10-31T00:00:00Z | grep generatedAt
pasco export profile --json --now 2026-02-31T00:00:00Z; echo "exit=$?"
```

Two runs are byte-identical; `generatedAt` is `null` unless `--now` pins it verbatim; the
impossible date is a real-calendar failure (exit `1`), not a normalized `2026-03-03`. `profile` is
`load()` normalized: every declared root plus `bios/…/faq/releases: []`; optional object roots
(`positioning`, `active`) are absent when undeclared.

### M14 — `skills:export`: list, copy, overlay

```sh
pasco skills:export --list
pasco skills:export /tmp/pasco-skills-out
pasco skills:export /tmp/pasco-skills-out; echo "exit=$?"
pasco skills:export /tmp/pasco-skills-out --force
```

`--list` reports 14 channels (12 with `SKILL.md`; `linkedin` and `x` are post-only). A non-empty
destination refuses with `1`; `--force` overlays, never deletes. The destination may not sit inside
the shipped tree.

### M15 — `build --lang es` and all platforms

With `es` content in `headlines`, `bios` and `positioning`:

```sh
pasco build --lang es
pasco build
```

Both write **three** artifacts — `github-readme/README.md`, `linkedin.md`, `x.md` — and report
`empty renders removed (45)`: 49 platforms minus the brand-only `github-org` minus the three with
content. The other renderers are bio-driven and return empty without a bio row; only
`github-readme` renders from the facts alone. The `es` run renders the `es` headline/statement/bio
(no fallback), but **`artifactPath()` has no `lang`**: the next `build` overwrites the same paths,
so the `es` artifact does not survive. For GitHub that is correct (one README per repo); for the
paste surfaces it is a silent loss, and §5 of the guide does not say it.

### M16 — `export ai-policy`: check, write, refuse a stale list

```sh
pasco export ai-policy --check
pasco export ai-policy --out /tmp/pasco-ai-policy
```

`--check` reads registry data (no workspace) and exits `0` with 11 crawlers: 7 retrieval allowed,
4 training blocked. `--out` writes `robots.txt` (two named groups, **no** `User-agent: *`),
`llms.txt` (name, definition, canonical URL, `faq[]`, `publications[]`) and `AI-POLICY.md`; two
runs are byte-identical. An existing file that lacks the generator marker is refused unless
`--force`. Patching one crawler's `source` out of the installed bundle makes `--check` exit `1`
with `unsourced · gptbot — no operator page`; the generator refuses to write a list it would
reject.

### M17 — `presence` and `release plan`

`presence` needs `content/releases.yaml`; `release plan` exits `1` without it. A release row is
`{id, version, date, surfaces[], changedUnits[]}`; surfaces are registry slugs of any kind, and the
state is derived from `deployments[key][surface]` vs the unit hash.

```sh
pasco presence
pasco release plan
```

With one release over `github-repo-meta`, `github-readme`, `linkedin` and `hacker-news`, the board
shows four `never` rows; the plan orders `repo-meta → profile → distribution`. The valid units
`headlines:github-readme:en`, `experience:exp-demo` and `projects:proj-demo` are reported as
"is not an SSOT unit — fix the release row" **because they have no deploy record on that
surface**. That is the 0.3.7 reading: a missing record is `never`, not an invalid row.
[#408](https://github.com/ChristianLuciani/profile-as-code/issues/408) was fixed by #413 after this
run — `main` now names the pending fan-out, and the released binary still prints the old wording.

### M18 — `discover`: a public surface, nothing written

```sh
pasco discover https://dev.to/ben
pasco discover https://dev.to/ben --json
```

The command is read-only (`wrote: false`; `content/` unchanged) and closed-allowlist (a host
outside it is `host-not-allowed` with no request). It builds a provisional profile from the
surface's **schema.org `Person`/`Organization` JSON-LD and its links** — never prose. A GitHub
profile has no such node, so `pasco discover https://github.com/<you>` exits `1` with `no surface
declared an entity name`; the project site's JSON-LD is `SoftwareApplication`, so it does not
qualify either. On `dev.to/ben` it reads 5 facts, lists `experience` as absent, and reports **40
`unsourced-claim` WARN** — badges, counters and the copyright line, not claims about the person.
That is the `isQuantitativeClaim` heuristic applied to the whole page; the signal-to-noise is the
finding (the audit classes are `contradiction`/`dangling-ref` FAIL, `unsourced-claim` WARN).

### M19 — `cite-check`: saved answers, a malformed line is exit 2

```sh
pasco cite-check /tmp/answers.ndjson
```

One JSON object per line: `{engine?, askedAt?, question?, answer, citations[]}`; `answer` and
`citations` are required. Blank lines are ignored but keep their line numbers. `María Demo` matches
`name@0-10` (accent-insensitive) and `citation-url` when the citation is the declared identity URL;
`malformed NDJSON at line N (field)` is exit `2`, never a skipped answer. A non-citation is data:
exit `0`.

### M20 — `post`: seed → task → choose → check → export → import → list

```sh
pasco post seed demo-post --text /tmp/post-seed.md --format short
pasco post task demo-post --channel linkedin,x --variants 2
pasco post choose demo-post --channel linkedin --variant linkedin-1 --text /tmp/linkedin-1.md
pasco post choose demo-post --channel x --variant x-1 --text /tmp/x-1.md
pasco post check demo-post
pasco post export demo-post --out /tmp/postiz.json --type draft --date 2026-11-01T12:00:00Z
pasco post import /tmp/import-posts --channel linkedin
pasco post list
```

The store is `posts/` (outside `content/` and the schema). `task` writes the agent bundle — seed,
facts, skill, channel rules — and never calls a model; `choose` records the body under
`posts/<id>/<channel>/<variant>.md`; `check` gates max-chars, URLs against the SSOT, `{{fact:…}}`
refs and claims; `export` reads `postiz.yaml` (`channels: {linkedin: …, x: …}`) and writes the
`POST /posts` payload (or a paste checklist for a paste channel); `import` turns historical `.md`
into `imported-*` seeds. Short rules exist only for `linkedin` and `x`; every other channel here is
long-form (`devto`, `ghost`, `hashnode`, `listmonk`, `medium`, `substack`, `wordpress`), and
`task --channel devto` says so with exit `2`. `import` records `sync: published` with `url: null` —
a reasonable assumption for a historical post, but a state not derived from a remote record.

### M21 — `refine` (PARTIAL): template and `--choose`

```sh
pasco refine linkedin --variants 2
pasco refine linkedin --choose linkedin-en-1
```

Without `--choose` it prints the agent task (facts, skill, existing texts, anchors) and writes
nothing. With `--choose` it writes **only** `content/active.yaml`; the body is workspace input at
`profiles/<platform>/variants/<id>.md`. Once chosen, `build <platform>` writes that body verbatim,
and `edit` names the variant instead of promising a change the SSOT text cannot reach. The
template has two defects: the experience line renders a langMap role as `[object Object]`, and the
example ids are hardcoded `gh-en-*` for every platform. A `--choose` for a missing body still
records the choice and `build` falls back to the deterministic render with a warning.

### M22 — `init --flavor brand`

```sh
pasco init ~/pasco-brand-demo --flavor brand
cd ~/pasco-brand-demo
pasco validate
pasco build github-org --lang en
pasco check
```

The scaffold writes `content/{identity,socialHandles,newsletter,podcast,press,audiences,flavor,checks}.yaml`
plus `README.md` and `.pascorc`; it validates with only `name`. `build github-org` is brand-only and
writes `# <name>`, tagline, mission, logo, one badge per **claimed** handle, `## Links`, an
`Organization` JSON-LD block and a footer with claimed/pending/press counts. `check` runs the brand
handle matrix (`claimed`/`pending`, `handle-claimed`/`handle-consistent`). The scaffold's commented
`- platform: website` is **not** a valid platform slug, so uncommenting it fails `validate`; the
`github-org` badge table knows `website`, the enum does not.

### M23 — `--workspace` and resolution from outside

Resolution is `--workspace` → `.pascorc` in the current directory → cwd; the `.pascorc`'s
`workspace` resolves relative to the `.pascorc`'s directory.

```sh
cd /tmp/pasco-outside
pasco doctor              # invalid: no content/
pasco doctor --workspace ~/pasco-tutorial-demo   # valid
cd /tmp/pasco-pointer     # .pascorc: {"workspace": "<absolute path to the workspace>"}
pasco doctor              # the pointer wins over cwd
pasco doctor --workspace ~/pasco-brand-demo      # the flag wins over the pointer
cd ~/pasco-tutorial-demo/content
pasco doctor              # invalid: …/content/content
pasco doctor --workspace ..   # valid
```

The trap is real: `.pascorc` is read **only** in the directory you run from, never upward. From a
subdirectory, pass `--workspace ..` (or `--workspace <root>`); a relative flag resolves against
cwd. An invalid path exits `1` and names the missing `content/` directory.

### What Part 2 found

| Friction (repro in the section) | Tracking |
|---|---|
| `edit` has no discovery surface: the address is learned from help, a usage error or a 0-row read | [#411](https://github.com/ChristianLuciani/profile-as-code/issues/411) — fixed on `main` (`edit --list`, PR #424); not in the measured 0.3.7 |
| `refine` renders a langMap role as `[object Object]` (M21) | [#415](https://github.com/ChristianLuciani/profile-as-code/issues/415) |
| `refine` hardcodes `gh-en-*` examples for every platform (M21) | [#415](https://github.com/ChristianLuciani/profile-as-code/issues/415) |
| `usage: usage: …` on `skills:export` and `refine`; `export ai-policy: refusing…` drops the `pasco` prefix (M14, M16, M21) | [#416](https://github.com/ChristianLuciani/profile-as-code/issues/416) |
| the brand scaffold's `platform: website` is not a valid slug (M22) | [#417](https://github.com/ChristianLuciani/profile-as-code/issues/417) |
| `discover` needs `Person`/`Organization` JSON-LD; a GitHub profile and the project site fail (M18) | [#418](https://github.com/ChristianLuciani/profile-as-code/issues/418) |
| `discover` reports page chrome as `unsourced-claim`: 40 WARN, 0 profile claims on dev.to (M18) | [#419](https://github.com/ChristianLuciani/profile-as-code/issues/419) |
| `build --lang` overwrites the same `profiles/` paths; the last build wins (M15) | [#420](https://github.com/ChristianLuciani/profile-as-code/issues/420) |
| `release plan --json` has no `order`; the human column is positional (M17) | [#421](https://github.com/ChristianLuciani/profile-as-code/issues/421) |
| `post` short supports only `linkedin`/`x`, and the help does not list it (M20) | [#422](https://github.com/ChristianLuciani/profile-as-code/issues/422) |
| `post import` asserts `sync: published` with `url: null` (M20) | [#423](https://github.com/ChristianLuciani/profile-as-code/issues/423) |
| the published `0.3.7` is 53 commits behind `main`: #395–#400 are fixed and closed but unreleased, so old wording (`(no texts…)`, the `geo/evidence-claims` detail) still appears | note, no issue |

## Command coverage

The inventory below is `pasco --help` at CLI **0.3.7** (2026-10-31; Part 2 measured 2026-11-01).
*Exercised* means the command was run in this tutorial and its output is quoted above — not that it
was read in the guide.

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
| `edit` | ✅ read · `--set --check` · write · refusals · `--json` | Part 2 · M12 |
| `refine` | ✅ PARTIAL: template · `--choose` · active variant | Part 2 · M21 |
| `discover` | ✅ on a surface with schema.org `Person` JSON-LD | Part 2 · M18 (GitHub profiles have none) |
| `cite-check` | ✅ NDJSON fixture; a malformed line is exit 2 | Part 2 · M19 |
| `post` | ✅ seed · task · choose · check · export · import · list | Part 2 · M20 |
| `presence` | ✅ empty board + a board with one release | Part 2 · M17 |
| `release plan` | ✅ ordered fan-out; reproduces #408 | Part 2 · M17 |
| `export profile` | ✅ `--json` · determinism · `--now` | Part 2 · M13 |
| `export ai-policy` | ✅ `--check` · `--out` · a missing source is exit 1 | Part 2 · M16 |
| `skills:export` | ✅ `--list` · export · `--force` | Part 2 · M14 |
| `build --lang` · all platforms | ✅ the `es` slice + all 49 platforms | Part 2 · M15 |
| `--workspace <path>` | ✅ precedence and resolution from outside | Part 2 · M23 |
| `init --flavor brand` | ✅ scaffold · `build github-org` · `check` | Part 2 · M22 |

Every row is now exercised. The `Where` column points at the measured step; per-command
`--help` is still the first place to look for a flag the tour did not need.

## Where to go next

- **A real publish:** [§7 Deploy by PR](USER-GUIDE.md#deploy-by-pr) — clone `<you>/<you>`, branch,
  `git commit -s`, `gh pr create`, and never push to that repo's `main`.
- **History and automation:** on-ramp A, the template repo
  ([§3](USER-GUIDE.md#option-a--the-template-repo-recommended)) — the same workspace plus CI.
- **More surfaces:** [§6](USER-GUIDE.md#6-add-entries--update-content) for `bios`, `headlines`,
  `projects`, `publications`; `pasco build` without a platform builds every one.
- **The engine's contract:** [SPEC.md](SPEC.md) explains *why* each rule exists.
