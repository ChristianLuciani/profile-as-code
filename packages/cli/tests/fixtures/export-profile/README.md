# `export-profile` fixture — a fork of core's `complete` workspace

This directory is the workspace `packages/cli/tests/export-profile.test.ts` runs
`pasco export profile` against, and the `golden.json` next to it is the exact
`--json` payload it must produce (with `<commit>` and `<version>` substituted by
the test, the only values that move with a commit or a release).

**Provenance — accepted coupling.** The `content/` tree is `packages/core/tests/
fixtures/complete/content/` plus:

- **added** `faq.yaml` and `languages.yaml` — the `complete` fixture predates the
  answer surface (v1.10) and never declared spoken languages; the golden has to
  cover both roots;
- **modified** `projects.yaml` (one `artifactRefs` row — the #333 witness) and
  `publications.yaml` (an explicit `url` beside its DOI).

The copy is deliberate, not an oversight: building the workspace at test time
from core's fixture would make the golden bytes depend on every future edit of
that fixture (a change there would silently rewrite the contract bytes or fail the
golden for an unrelated reason), while a committed golden is the point of the
test. **The cost is that a schema change has to be applied here too** — this file
is the declaration of that coupling. When `complete` gains a root the golden
should cover, copy the change and regenerate:

```sh
pnpm --filter @profile-as-code/cli build
COMMIT=$(git -C packages/cli/tests/fixtures/export-profile rev-parse HEAD)
VERSION=$(node -p "require('./packages/cli/package.json').version")
node packages/cli/dist/index.js export profile --json \
  --workspace packages/cli/tests/fixtures/export-profile \
  | sed "s/$COMMIT/<commit>/; s/$VERSION/<version>/" \
  > packages/cli/tests/fixtures/export-profile/golden.json
```

`golden.json` is excluded from the formatter (`biome.json`): it pins the bytes the
CLI prints, and the formatter would collapse arrays and change them.
