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
| Tag | `v0.4.0` (2026-11-04) |
| URL | `https://raw.githubusercontent.com/ChristianLuciani/profile-as-code/v0.4.0/schema/profile.schema.json` |
| Schema version | `v1.16` (the schema's own `$id`) |
| sha256 | `d6b06b57f1106885ee0467d8aa8009e098b04fe0a5ffad34b97455bc4417fe2f` |

```sh
curl -sSfL https://raw.githubusercontent.com/ChristianLuciani/profile-as-code/v0.4.0/schema/profile.schema.json \
  -o profile.schema.json
sha256sum profile.schema.json          # Linux; macOS: shasum -a 256 profile.schema.json
```

A tag is immutable, so a consumer that pins `v0.4.0` and checks the hash gets the
same bytes forever. The tag-pinned raw URL is the only published form: a
floating ref (`main`) or any private path is refused by the gate and may not
appear on this surface (AGENTS.md rule 9).

## The current contract — v2.0, not yet published

`main` carries schema **v2.0** (D27, #498: `visibility` optional with absent =
`private` on `credentials[]`, `artifacts[]`, `projects[]` and `experience[]`;
`achievements[]` keeps it required). The `v0.4.0` tag still carries **v1.16**
(the additive `achievements[]` release), so `current` in
`schema/consumer-contract.json` says `published: false` with `artifact: null`
and a note naming the checkout; `released` names `v0.4.0`. The earlier artifact —
**v1.15 at `v0.3.7`** — stays valid forever for a consumer that pins it.

| Field | Value |
|---|---|
| Schema version | `v2.0` |
| sha256 | `f82f5f88413495d335abfeb9acd3f2d880a1ca5a64b8b98fbec1136b8e900d26` |
| Published artifact | none yet — the next release publishes these bytes |

A v1.x workspace still validates against v2.0 unchanged; the **default**
changed, so its published output changes until it runs `pasco migrate` once.
That command writes `visibility: public` on every `credentials`, `artifacts`,
`projects` and `experience` row that lacks the field (comments and layout
preserved; idempotent). `pasco doctor --contract-delta` reports the rows still
missing it.

A profile that declares no `achievements[]` validates identically against `v1.16`
and `v0.3.7`; the block is additive by construction. `pasco log` writes one row
(`visibility: private` by default; no clock, so an absent `--date` is `undated`)
and `pasco achievements` reads the log — with `--since`/`--until` when a period is
wanted — without writing anything.

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
§7.5) or any object in that shape. The printed `$id` names the contract version,
not a byte-image: `…/v2.0/…` for the current `main` checkout (above; the next
release publishes these bytes), `…/v1.16/…` for the released `v0.4.0` artifact,
and `…/v1.15/…` for the earlier `v0.3.7` artifact, which stays valid forever for
a consumer that pins it. When the
exact bytes matter, compare the sha256 in
`schema/consumer-contract.json`; the `$id` alone does not pin them.
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
