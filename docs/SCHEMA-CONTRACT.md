# Consuming the contract without the engine (#348)

A consumer may need to **validate a profile** — a CI job, a site build, a
database import — without installing the `pasco` CLI, cloning this repository,
or depending on a user's workspace. This page is the distribution contract for
that reader.

The contract is `schema/profile.schema.json` (JSON Schema draft 2020-12, D3).
Its published identity is a **URL plus a sha256**, recorded machine-readably in
[`schema/consumer-contract.json`](../schema/consumer-contract.json). Verifying
the hash and validating against the bytes it names is the whole procedure; no
engine, no network at validation time beyond the one download.

## The released artifact

The immutable copy at a published release tag:

| Field | Value |
|---|---|
| Tag | `v0.3.6` (2026-10-27) |
| URL | `https://raw.githubusercontent.com/ChristianLuciani/profile-as-code/v0.3.6/schema/profile.schema.json` |
| Schema version | `v1.13` (the schema's own `$id`) |
| sha256 | `275340ffe2e011581810131b23b72472016ec90278e85fce6d44b4e7e7ccbb10` |

```sh
curl -sSfL https://raw.githubusercontent.com/ChristianLuciani/profile-as-code/v0.3.6/schema/profile.schema.json \
  -o profile.schema.json
sha256sum profile.schema.json          # Linux; macOS: shasum -a 256 profile.schema.json
```

A tag is immutable, so a consumer that pins `v0.3.6` and checks the hash gets the
same bytes forever. The tag-pinned raw URL is the only published form: a
floating ref (`main`) or any private path is refused by the gate and may not
appear on this surface (AGENTS.md rule 9).

## The current contract — no published artifact yet

The repository's `main` carries schema **v1.15**, which adds `releases[]`
(optional, D23) on top of v1.14's `publication.kind`. **No released tag contains
it**, so there is no published URL for
those bytes: the manifest records them with `current.published: false` and
`current.artifact: null`. That is a declared condition, not a missing link.

| Field | Value |
|---|---|
| Schema version | `v1.15` |
| sha256 | `838a14f8fe580dcfa63b2c148b6fb642d3713f3c686db00c6c49f8dd2cde97f9` |
| Published artifact | **none** — use a repository checkout |

If you need v1.15 today, check the repository out at a commit whose
`schema/profile.schema.json` hashes to that value (any commit; the hash is the
identity) — a checkout, not a published artifact. The next release publishes it
at a tag and the manifest's `released` block moves with it.

**`publication.kind` cannot be validated against the released v0.3.6 artifact.**
That file is schema v1.13, and `$defs.publication` has `additionalProperties:
false`, so a row carrying `kind` is rejected. A profile that declares no `kind`
validates unchanged against v1.13; a consumer that needs `kind` or
`releases[]` must use a v1.15 checkout (verify the hash above) until the next tag.

## Validating a profile

Any draft 2020-12 validator works. Example with the Python `jsonschema` package
(the same implementation the repo's own contract self-test uses):

```sh
python3 -m pip install jsonschema
python3 - <<'PY'
import json, jsonschema
schema = json.load(open("profile.schema.json"))
profile = json.load(open("profile.json"))
jsonschema.Draft202012Validator(schema).validate(profile)
print("profile validates against", schema["$id"])
PY
```

`profile.json` is the `profile` object of `pasco export profile --json` (SPEC
§7.5) or any object in that shape. The printed `$id` names the file you fetched
(`…/v1.13/…` for the released artifact, `…/v1.15/…` for the current checkout).
A consumer that uses the CLI for the payload and a standalone validator for the
check is the intended split: the CLI produces, the schema verifies.

## What this contract does NOT cover

- **It is not `load()`.** JSON Schema validates the object's structure; `core`
  re-checks cross-file invariants the schema cannot express — unique entry ids,
  the `locator` XOR, dangling `artifactRefs`, ledger keys/surfaces, duplicate
  composite keys — and those need the engine (D12).
- **Engine behavior.** Drift (`driftCheck`), GEO (`geoCheck`), `audit`,
  `completeness`, renderers and deploy state are behavior, not schema.
- **`.pascorc` and the engine gate** (SPEC §7.6): a workspace's required engine
  version is a CLI concern and is not part of the profile object.
- **The `export profile` envelope** (SPEC §7.5): `schemaVersion: "1"`, `engine`
  and `source` are the payload contract around `profile`, not profile fields.
- **Visibility filtering** (SPEC §18.5): renderer-owned; the normalized profile
  is the SSOT, not a public surface.

## How the pin stays honest (offline)

`node scripts/schema-contract/check.mjs --check` runs in CI with **no network**
(D19):

- it recomputes the sha256 of the committed `schema/profile.schema.json` and
  refuses a manifest that disagrees — a schema edit that forgot to regenerate
  `schema/consumer-contract.json` fails CI;
- it refuses a `current` block that claims a publication it cannot join:
  `published` must be a boolean, `published: false` must carry `artifact: null`
  and a note, and `published: true` must carry a public raw URL;
- it reads the immutable copy at the released tag from **local git** and refuses
  a moved tag, a wrong version label, a malformed tag/hash, or any URL that is
  not the exact public tag-pinned raw URL;
- a release pin that is no longer the newest reachable tag only **warns** — the
  release prep moves it, and a dated published artifact stays correct forever.

After a schema edit, recompute the manifest with the same script:
`node scripts/schema-contract/check.mjs --write` (add `--tag vX.Y.Z` when the
release tags a newer contract). It computes both hashes locally, enforces the
same tag existence AND reachability as `--check`, and derives publication rather
than inventing it: if the tag carries the current bytes the `current` block
becomes published with the tag URL; otherwise it stays unpublished with a note.
A not-yet-published artifact is therefore never claimed.

The self-test (`scripts/schema-contract/test.mjs`) proves each refusal, including
the CLI rows end-to-end against a synthesized git repository (`--write` reachable
vs unreachable tag, drift, missing tag). SPEC §7.7 is the contract; this page is
the reading copy.
