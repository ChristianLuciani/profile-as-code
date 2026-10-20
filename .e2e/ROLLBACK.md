# Rollback — E2E dogfood, Christian Luciani

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: cómo revertir cada superficie tocada por el run (perfil publicado, rama del workspace, ledger) · No cubre: las superficies manuales que nunca se pegaron (no hay nada que revertir) ni el historial de edición de cada plataforma · as_of: 2026-10-20
> Si una pieza no aparece, no asumas que no existe: reportá el hueco.

## Surface: GitHub profile README (`ChristianLuciani/ChristianLuciani`, `README.md`, `main`)

Baseline verified 2026-10-19: branch head `2e317e6` = live README content.

```sh
# 1) Put the exact bytes back through the same protected path that deployed them
gh api --method PUT repos/ChristianLuciani/ChristianLuciani/contents/README.md \
  -f message="revert: profile README back to 2e317e6 (rollback E2E dogfood 2026-10-19)" \
  -f content="$(base64 < /tmp/live-profile-readme.md | tr -d '\n')" \
  -f branch=main
# (the SHA is not needed: replacing an existing file with new content is a normal commit)

# 2) Verify: the file on main digests identically to the baseline capture
gh api repos/ChristianLuciani/ChristianLuciani/contents/README.md --jq .sha
# compare with:
git hash-object /tmp/live-profile-readme.md
```

Alternative (no API): paste the old text in the GitHub web editor, or
`git revert <deploy-commit>` from a clone of the profile repo.

## Surface: workspace (`profile-data`)

Every write lives on a **branch**, never on `main`, until the human merges. Rollback = do not merge,
or revert the commits:

```sh
git checkout main                 # nothing landed here during the run
git branch -D e2e/dogfood-<date>  # discard the session's branch
```

Deploy-ledger rows written by `pasco status --mark` live in `content/deployments.yaml`
(committed by `pasco`, never hand-edited). To undo a wrong mark, replace the file with the
version from the commit before the ledger commit:

```sh
git checkout <sha-before-ledger> -- content/deployments.yaml
```

## Known non-reversible (or hard-to-reverse) actions in this run

| Action | Reversibility |
|---|---|
| GitHub profile README deploy | Full — baseline bytes captured at `/tmp/live-profile-readme.md` + the API `contents` history |
| Workspace commits (branch) | Full — branch deleted, `main` untouched |
| Any paste on LinkedIn / Upwork / X / ResearchGate / Substack / Patreon | **Partial** — the platform keeps its own edit history; the previous text is only what you have copied locally. This is why **Step L3 asks you to paste the old text back into `content/` if you dislike the new one**, and why the old values are listed in `old-values.md` |
| `git tag release-*` | Reversible (`git tag -d` + `git push --delete`) |
