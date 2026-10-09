#!/usr/bin/env python3
"""Contract self-test for schema/profile.schema.json (D3).

Validates that the schema itself is a valid JSON Schema and that every fixture
under scripts/schema-check/fixtures/ behaves as expected:
  - fixtures named `valid-*.json` must validate
  - fixtures named `invalid-*.json` must be rejected

Run:  python3 scripts/schema-check/check.py   (requires: pip install jsonschema)
Exit code 0 = contract OK, 1 = failure. Used by CI (see .github/workflows/ci.yml)
and locally by contributors before touching the schema.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

from jsonschema import Draft202012Validator, SchemaError, ValidationError

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SCHEMA_PATH = REPO_ROOT / "schema" / "profile.schema.json"
FIXTURES_DIR = pathlib.Path(__file__).resolve().parent / "fixtures"
REGISTRY_PATH = REPO_ROOT / "platforms" / "registry.yaml"
GENERATED_PLATFORMS = REPO_ROOT / "packages" / "core" / "src" / "generated" / "platforms.gen.ts"
SPEC_PATH = REPO_ROOT / "docs" / "SPEC.md"
README_PATH = REPO_ROOT / "README.md"
GEN_OPEN = "<!-- gen:platform-families -->"
GEN_STATUS_OPEN = "<!-- gen:platform-status -->"
GEN_CLOSE = "<!-- /gen -->"
ARITHMETIC_RE = re.compile(
    r"^(\d+(?: \+ \d+)*) = (\d+) extras; (\d+) \+ (\d+) = \*\*(\d+)\*\*\.$", re.MULTILINE
)
# A backticked slug in a family-table cell (notes may carry `[?]`/`[MI]`, which
# this deliberately does not match).
SLUG_RE = re.compile(r"`([a-z0-9][a-z0-9-]*)`")


def load_registry() -> dict | None:
    """Parse `platforms/registry.yaml`; None (with a FAIL) when it cannot."""
    try:
        import yaml  # noqa: PLC0415 — optional dependency, reported explicitly
    except ImportError:
        print(
            "FAIL: PyYAML is required for the platform-registry assertions "
            "(pip install jsonschema pyyaml)"
        )
        return None
    try:
        return yaml.safe_load(REGISTRY_PATH.read_text())
    except (OSError, yaml.YAMLError) as exc:
        print(f"FAIL: cannot read {REGISTRY_PATH.relative_to(REPO_ROOT)}: {exc}")
        return None


def generated_slugs() -> list[str] | None:
    """`PLATFORM_SLUGS` from the committed projection; None (with a FAIL) otherwise."""
    try:
        source = GENERATED_PLATFORMS.read_text()
    except OSError as exc:
        print(f"FAIL: cannot read {GENERATED_PLATFORMS.relative_to(REPO_ROOT)}: {exc}")
        return None
    match = re.search(r"export const PLATFORM_SLUGS = \[(.*?)\] as const;", source, re.DOTALL)
    if match is None:
        print("FAIL: platforms.gen.ts has no PLATFORM_SLUGS array")
        return None
    return re.findall(r'"([^"]+)"', match.group(1))


def generated_block(path: pathlib.Path, marker: str) -> str | None:
    """The text between `<!-- marker -->` and `<!-- /gen -->`; None when absent."""
    try:
        source = path.read_text()
    except OSError as exc:
        print(f"FAIL: cannot read {path.relative_to(REPO_ROOT)}: {exc}")
        return None
    start = source.find(marker)
    if start == -1:
        print(f"FAIL: {path.relative_to(REPO_ROOT)} is missing the {marker} marker")
        return None
    end = source.find(GEN_CLOSE, start + len(marker))
    if end == -1:
        print(f"FAIL: {path.relative_to(REPO_ROOT)} is missing {GEN_CLOSE} after {marker}")
        return None
    return source[start + len(marker) : end]


def check_spec_table(spec_block: str, members_by_family: dict, backlog_by_family: dict) -> int:
    """The SPEC §6 family table BODY must match the registry (issue #154 review F1).

    The count arithmetic is asserted separately; this closes the table itself — a
    mutated or reordered members/backlog cell, or a dropped/renamed family row,
    fails here, so the Python gate's claim to check the generated SPEC block holds
    even without the node gate's byte comparison.
    """
    seen = set()
    rows = 0
    for line in spec_block.splitlines():
        line = line.strip()
        if not line.startswith("|") or "Family (label)" in line or set(line) <= set("|-: "):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) != 5:
            print(f"FAIL: SPEC.md family table row is malformed: {line}")
            return 1
        family = cells[0].strip("`")
        seen.add(family)
        got_members = SLUG_RE.findall(cells[3])
        got_backlog = SLUG_RE.findall(cells[4])
        exp_members = members_by_family.get(family)
        exp_backlog = backlog_by_family.get(family)
        if exp_members is None or exp_backlog is None:
            print(f"FAIL: SPEC.md family table has a row for undeclared family `{family}`")
            return 1
        if got_members != exp_members or got_backlog != exp_backlog:
            print(
                f"FAIL: SPEC.md family table row `{family}` disagrees with the registry — "
                f"members {got_members} vs {exp_members}, backlog {got_backlog} vs {exp_backlog} "
                "— run `pnpm gen:platforms`"
            )
            return 1
        rows += 1
    missing = sorted(set(members_by_family) - seen)
    if missing or rows != len(members_by_family):
        print(
            "FAIL: SPEC.md family table is missing declared families: "
            + (", ".join(missing) if missing else "—")
        )
        return 1
    print(f"PASS: SPEC.md family table matches the registry ({rows} families)")
    return 0


def check_registry(platform_enum: list[str]) -> int:
    """Registry ↔ enum ↔ generated ↔ docs must agree (issue #154).

    Returns 0 on success, 1 on the first disagreement. The depth is deliberate:
    the node gate (`scripts/gen-platforms/gen.mjs --check`) proves the projection
    is fresh, this self-test proves the *inputs* the projection claims to read
    actually agree — so a green node gate over a drifted registry is impossible.
    """
    registry = load_registry()
    if registry is None:
        return 1
    platforms = registry.get("platforms")
    if not isinstance(platforms, dict) or not platforms:
        print("FAIL: platforms/registry.yaml has no non-empty `platforms` mapping")
        return 1

    platform_enum_set = set(platform_enum)
    unknown = sorted(s for s, p in platforms.items() if p.get("status") not in ("member", "backlog"))
    if unknown:
        print(
            "FAIL: platforms/registry.yaml entries without a valid status "
            f"(member | backlog): {', '.join(unknown)}"
        )
        return 1
    members = {s: p for s, p in platforms.items() if p.get("status") == "member"}
    backlog = {s: p for s, p in platforms.items() if p.get("status") == "backlog"}
    missing = sorted(platform_enum_set - set(members))
    surplus = sorted(set(members) - platform_enum_set)
    backlog_in_enum = sorted(set(backlog) & platform_enum_set)
    if missing or surplus or backlog_in_enum:
        print(
            "FAIL: platforms/registry.yaml and $defs/platform.enum disagree — "
            + ("enum members without a status:member entry: " + ", ".join(missing) + ". " if missing else "")
            + ("status:member slugs outside the enum: " + ", ".join(surplus) + ". " if surplus else "")
            + ("status:backlog slugs that ARE enum entries: " + ", ".join(backlog_in_enum) if backlog_in_enum else "")
        )
        return 1
    print(f"PASS: registry covers $defs/platform.enum ({len(members)} members, {len(backlog)} backlog)")

    postiz = registry.get("postiz") or {}
    postiz_members = [s for s, p in members.items() if p.get("origin") == "postiz"]
    if postiz.get("count") != len(postiz_members):
        print(
            f"FAIL: registry postiz.count is {postiz.get('count')!r} but "
            f"{len(postiz_members)} entries declare origin: postiz"
        )
        return 1
    print(f"PASS: registry postiz.count == origin:postiz entries ({len(postiz_members)})")

    slugs = generated_slugs()
    if slugs is None:
        return 1
    if slugs != platform_enum:
        for i, (a, b) in enumerate(zip(slugs, platform_enum)):
            if a != b:
                print(
                    f"FAIL: platforms.gen.ts PLATFORM_SLUGS[{i}] is {a!r} but the enum has {b!r} — "
                    "run `pnpm gen:platforms`"
                )
                return 1
        print(
            "FAIL: platforms.gen.ts PLATFORM_SLUGS has "
            f"{len(slugs)} entries but the enum has {len(platform_enum)} — run `pnpm gen:platforms`"
        )
        return 1
    print(f"PASS: platforms.gen.ts PLATFORM_SLUGS == enum ({len(slugs)} entries)")

    spec_block = generated_block(SPEC_PATH, GEN_OPEN)
    if spec_block is None:
        return 1
    match = ARITHMETIC_RE.search(spec_block)
    if match is None:
        print("FAIL: SPEC.md generated block has no count arithmetic line")
        return 1
    counts = [int(n) for n in match.group(1).split(" + ")]
    extras, postiz_total, free_total, total = (int(match.group(i)) for i in (2, 3, 4, 5))
    if sum(counts) != extras:
        print(f"FAIL: SPEC.md arithmetic groups sum to {sum(counts)} but declare {extras} extras")
        return 1
    if postiz_total != postiz["count"] or free_total != extras or total != len(platform_enum):
        print(
            "FAIL: SPEC.md arithmetic disagrees with the registry — "
            f"postiz {postiz_total}, extras {free_total}, total {total} "
            f"(registry: {postiz['count']} + {len(platform_enum) - postiz['count']} = {len(platform_enum)})"
        )
        return 1
    print(f"PASS: SPEC.md generated count arithmetic == registry ({total} total)")

    families = registry.get("families") or {}
    members_by_family = {
        fid: [s for s in members if members[s].get("family") == fid] for fid in families
    }
    backlog_by_family = {
        fid: [s for s in backlog if backlog[s].get("family") == fid] for fid in families
    }
    if check_spec_table(spec_block, members_by_family, backlog_by_family) != 0:
        return 1

    readme_block = generated_block(README_PATH, GEN_STATUS_OPEN)
    if readme_block is None:
        return 1
    extras_total = len(platform_enum) - postiz["count"]
    for needle in (
        f"**{len(platform_enum)}**",
        f"({postiz['count']} Postiz + {extras_total} operator extras)",
    ):
        if needle not in readme_block:
            print(
                f"FAIL: README.md generated block is missing {needle!r} "
                "— run `pnpm gen:platforms`"
            )
            return 1
    print(f"PASS: README.md generated counts match the registry ({len(platform_enum)} total)")
    return 0


def main() -> int:
    schema = json.loads(SCHEMA_PATH.read_text())

    # 1. The schema itself must be a valid JSON Schema (draft 2020-12).
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        print(f"FAIL: schema is not a valid JSON Schema: {exc.message}")
        return 1
    print(f"PASS: schema/{SCHEMA_PATH.name} is a valid JSON Schema")

    # 1b. Platform-set dedup contract (D16): check.platform MUST equal
    #     ["all", ...$defs/platform.enum]. Keeps the two enums from drifting.
    try:
        platform_enum = schema["$defs"]["platform"]["enum"]
        check_def = schema["$defs"]["check"]  # checks.items is a $ref to this
        check_enum = check_def["properties"]["platform"]["enum"]
    except KeyError as exc:
        print(f"FAIL: schema structure changed, dedup guard cannot resolve paths: {exc}")
        return 1
    expected = ["all", *platform_enum]
    if check_enum != expected:
        missing = sorted(set(expected) - set(check_enum))
        surplus = sorted(set(check_enum) - set(expected))
        print(
            "FAIL: check.platform enum drifted from $defs/platform — "
            f"expected ['all', ...platform] ({len(expected)}), got {len(check_enum)}. "
            + ("Missing: " + ", ".join(missing) if missing else "")
            + ("Surplus: " + ", ".join(surplus) if surplus else "")
        )
        return 1
    print(f"PASS: check.platform enum == ['all', ...platform] ({len(expected)} entries)")

    # 1b2. The platform description carries a running "<N> total"; its LAST value
    #      must match the enum size. This hand-authored count cannot be generated
    #      without rewriting reviewed prose, so it is gated instead (issue #154).
    description = schema["$defs"]["platform"].get("description", "")
    totals = re.findall(r"(\d+) total", description)
    if not totals or int(totals[-1]) != len(platform_enum):
        print(
            "FAIL: $defs/platform.description last '<N> total' is "
            f"{totals[-1] if totals else '<missing>'!r} but the enum has {len(platform_enum)} "
            "members — update the description line"
        )
        return 1
    print(f"PASS: platform description total == enum size ({len(platform_enum)})")

    # 1c. Registry ↔ enum ↔ generated ↔ docs (issue #154): the machine-readable
    #     metadata home must agree with the reviewed contract and the committed
    #     projections, naming the exact pair that drifts.
    if check_registry(platform_enum) != 0:
        return 1

    # 2. Every fixture must behave as its name promises.
    validator = Draft202012Validator(schema)
    failures = 0
    for fixture in sorted(FIXTURES_DIR.glob("*.json")):
        data = json.loads(fixture.read_text())
        should_fail = fixture.name.startswith("invalid-")
        try:
            validator.validate(data)
        except ValidationError as exc:
            if should_fail:
                print(f"PASS (rejected): {fixture.name} — {exc.message}")
            else:
                print(f"FAIL: {fixture.name} rejected unexpectedly — {exc.message}")
                failures += 1
        else:
            if should_fail:
                print(f"FAIL: {fixture.name} expected rejection but validated")
                failures += 1
            else:
                print(f"PASS (accepted): {fixture.name}")

    if failures:
        print(f"schema contract FAILED ({failures} problem(s))")
        return 1
    print("schema contract OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
