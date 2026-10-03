#!/usr/bin/env bash
# Self-test for the DCO gate (D21). Proves the gate against fixtures covering every
# verdict before CI trusts it on a real PR — same shape as scripts/dep-gate/test.mjs (D20).
#
# Usage: bash scripts/dco-check/test.sh
# Exit:  0 = every fixture got the expected verdict · 1 = at least one did not

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check="$here/check.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q
git -C "$tmp" config user.name "Fixture Author"
git -C "$tmp" config user.email "fixture@example.com"
git -C "$tmp" config commit.gpgsign false

pass=0
failed=0

judge() { # judge <want-exit> <label> <base> <head>
  local want="$1" label="$2" b="$3" h="$4" got=0
  ( cd "$tmp" && bash "$check" "$b" "$h" ) >"$tmp/out" 2>&1 || got=$?
  if [ "$got" -eq "$want" ]; then
    printf 'ok   — %s\n' "$label"
    pass=$((pass + 1))
  else
    printf 'FAIL — %s (expected exit %s, got %s)\n' "$label" "$want" "$got"
    sed 's/^/       /' "$tmp/out"
    failed=$((failed + 1))
  fi
}

commit() { git -C "$tmp" "$@"; }
stage() { printf '%s\n' "$1" >"$tmp/$1"; commit add "$1" >/dev/null; }

# The base commit every case is measured against.
stage base.txt
commit commit -q -s -m "chore: fixture base"

# 1 — a correctly signed commit
stage a.txt
commit commit -q -s -m "feat: signed"
judge 0 "signed commit passes" HEAD~1 HEAD

# 2 — no trailer at all
stage b.txt
commit commit -q -m "feat: unsigned"
judge 1 "unsigned commit fails" HEAD~1 HEAD

# 3 — trailer present, but signed off by somebody else
stage c.txt
commit commit -q -m "feat: wrong signer" -m "Signed-off-by: Someone Else <else@example.com>"
judge 1 "sign-off by a different identity fails" HEAD~1 HEAD

# 4 — bot author, never signed off: exempt by design (Dependabot)
stage d.txt
git -C "$tmp" -c user.name="dependabot[bot]" \
  -c user.email="49699333+dependabot[bot]@users.noreply.github.com" \
  commit -q -m "chore(deps): bump something"
judge 0 "bot author is exempt" HEAD~1 HEAD

# 5 — an empty range passes vacuously (nothing in the range claimed a false verdict)
judge 0 "empty range passes vacuously" HEAD HEAD

# 6 — an unresolvable range refuses instead of passing silently (fail closed)
judge 2 "unresolvable range refuses (exit 2)" HEAD does-not-exist

printf '\ndco-check self-test: %s passed, %s failed\n' "$pass" "$failed"
[ "$failed" -eq 0 ]
