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

import json
import pathlib
import sys

from jsonschema import Draft202012Validator, SchemaError, ValidationError

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SCHEMA_PATH = REPO_ROOT / "schema" / "profile.schema.json"
FIXTURES_DIR = pathlib.Path(__file__).resolve().parent / "fixtures"


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
