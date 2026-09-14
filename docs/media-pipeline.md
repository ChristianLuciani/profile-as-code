# Media pipeline — engine-side contract (M8, D17/D19)

> Issue #48, step 3. The evidence REGISTRY (§18) declares pointers; this doc is the
> transport: how `path`-locator bytes travel from the private workspace to a public
> deploy surface without the engine ever owning the binaries (D14).

## The pipeline

```
workspace media/ ──(collectMedia: sha256 + bytes)──▶ renderer assets/ output ──▶ deploy playbook ──▶ public surface
      ▲                                                   │
      └── PASCO_EVIDENCE_ROOT (external, per-machine)      └── profiles/<platform>/assets/ + manifest.json
```

1. **Workspace declares pointers** (`artifacts[].locator`: `{ url }` XOR `{ path }`,
   §18.3 capability matrix). The engine never copies media into the workspace — media
   either lives in `media/` (versioned) or resolves externally.
2. **`collectMedia(profile, workspace)`** — the single bundler: public `path`-locator
   artifacts only (§18.5 — private/unlisted never leave the workspace), sha256 + bytes
   computed, verified against a declared `artifact.checksum` (mismatch = error), sorted
   deterministically by registry id.
3. **Renderer declares** which targets its text references (`render(slice, { assets })`
   → `assets: string[]`, the §15.2 slot). A path locator with NO bundle entry stays
   link-free — byte-identical to the pre-M8 output; the README never references dead bytes.
4. **Build copies exactly the referenced targets** into `profiles/<platform>/assets/`
   and writes `assets/manifest.json` (the compile-time checksum record). The `assets/`
   dir is rebuilt clean each run — the output dir stays a pure function of the workspace
   (§15.1: same input → same bytes).
5. **Deploy playbook commits BOTH** `README.md` and `assets/` to the deploy repo (git
   deploySpec, D9). A deploy-relative link `assets/<id>/<basename>` resolves only on the
   public surface — never a private raw URL.

## Locator resolution rules

| Path form | Meaning | Base | Missing file |
|---|---|---|---|
| `media/…` | in-workspace (the SSOT) | workspace root | **error** (`media-missing-workspace`) |
| anything else | external | `PASCO_EVIDENCE_ROOT` env → gitignored `.pasco/local.toml` (`evidence_root = "…"`) | **warn** (`media-external-missing`) — local-only, CI-degradable |

- Containment: a resolved path must stay inside its base (workspace root or evidence
  root) — escapes fail with `media-path-unsafe` (error).
- `PASCO_EVIDENCE_ROOT` is per-machine state, never committed (the D14 lesson applied to
  config). CI without a checksummed mirror simply skips external assets (warn) —
  the render stays valid, the link simply does not appear.

## Targets and the manifest

- Target layout: `assets/<id>/<basename>` — per-artifact dirs (ids are core-checked
  unique, so targets are collision-free and reviewable in deploy-repo diffs).
- `assets/manifest.json` (written only when ≥ 1 asset is bundled):

```json
{
  "version": 1,
  "platform": "github-readme",
  "lang": "en",
  "assets": [
    { "id": "reel-local", "target": "assets/reel-local/reel-2025.mp4", "sha256": "…", "bytes": 12345, "origin": "workspace" }
  ]
}
```

- `origin` is `workspace` (bytes came from `media/`) or `external` (bytes came from the
  evidence root — bundled locally, CI-degradable).

## The `checksum` field on artifacts

`checksum: "sha256:<hex>"` is the user's **integrity promise for immutable artifacts**
(a dataset, a document — §18.6). `collectMedia` verifies it against the bytes on disk:
match → silent; mismatch → error and the asset is NOT bundled. For mutable media (photos,
reels) omit it — the manifest records the compile-time sha256 either way.

## Size guidance & git-lfs

- `pasco check` warns at **> 50 MB** (`media-oversize`); GitHub hard-blocks files at
  **100 MB**.
- For files you expect to version in the workspace: **git-lfs** is the operator's choice
  (the engine never mutates your repo). Workspace setup:

```bash
git lfs install
git lfs track "media/**/*.{mp4,zip,psd}"
git add .gitattributes
```

- CI notes: a git-lfs workspace needs `git lfs install` in CI (GitHub Actions checkout
  with `lfs: true`); the engine treats lfs pointers as regular files — `pasco check`
  reads bytes, so a smudged pointer file would checksum the POINTER. Run `pasco check`
  after checkout with lfs enabled (the checksum promise makes this visible).
- Alternative for big/rarely-versioned media: external hosting + `url` locator (live-link
  check joins M3/M4). Do not hot-link private workspaces (§18.3).

## Symlink / stow (§18.7 — power-user convenience only)

Git stores a symlink as its target text: absolute external targets break on CI and fresh
clones. Stowing an external media dir into `media/` works locally; `pasco check` WARNs
(`media-symlink-external`) when a workspace locator resolves through a symlink outside the
workspace without a declared checksum. Declaring the sha256 makes the promise verifiable
wherever the bytes actually live. Symlinks are never the canonical mechanism.

## Deploy verification (github-readme playbook, media steps)

1. `pasco build github-readme` → check the human output `media pipeline` findings.
2. `pasco check` — must be exit 0 (errors fail the deploy; warns are documented tradeoffs).
3. Commit `profiles/github-readme/` **including** `assets/` (+ `.gitattributes` if lfs).
4. After merge/deploy: open the README on the public surface and confirm at least one
   `assets/…` link resolves (the manifest `sha256` is the provenance record).