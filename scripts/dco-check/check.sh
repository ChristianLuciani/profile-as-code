#!/usr/bin/env bash
# DCO gate (D21, issue #95): every non-bot, non-merge commit in a PR must carry a
# Developer's Certificate of Origin sign-off whose email matches the commit author.
#
# Bot authors are exempt by design: Dependabot cannot sign off, and blocking it
# would block every dependency PR.
#
# Usage: scripts/dco-check/check.sh <base-sha> <head-sha>
# Exit:  0 = every commit in the range is certified
#        1 = at least one commit is missing or has a mismatched sign-off
#        2 = the range cannot be resolved — the gate refuses instead of passing
#            (an unresolvable range must never be reported as "certified")
#
# Self-test: scripts/dco-check/test.sh (runs before this in CI, dep-gate shape).

set -euo pipefail

base="${1:?usage: check.sh <base-sha> <head-sha>}"
head="${2:?usage: check.sh <base-sha> <head-sha>}"

# Fail closed: without both commits there is nothing to judge, and a silent pass
# would certify a range nobody looked at.
for rev in "$base" "$head"; do
  git rev-parse --verify --quiet "${rev}^{commit}" >/dev/null || {
    echo "dco: cannot resolve '$rev' — refusing to judge this range (exit 2)" >&2
    exit 2
  }
done

normalize() { tr '[:upper:]' '[:lower:]'; }

fail=0
# --no-merges skips merge commits, matching other DCO checkers. Accepted limitation:
# content a merge commit authors through conflict resolution is not covered — the
# commits the merge brings in still are, and they are where the work lives.
while read -r sha; do
  [ -n "$sha" ] || continue

  author="$(git show -s --format='%ae' "$sha" | normalize)"

  case "$author" in
    *"[bot]"*|*dependabot*)
      echo "skip (bot author): $(git show -s --format='%h' "$sha") <$author>"
      continue
      ;;
  esac

  signers="$(git show -s --format='%B' "$sha" \
    | sed -n 's/^[Ss]igned-off-by:[[:space:]]*.*<\([^>]*\)>.*$/\1/p' \
    | normalize)"

  if [ -z "$signers" ]; then
    echo "MISSING sign-off: $(git show -s --format='%h' "$sha") <$author>"
    echo "  fix: git commit --amend -s  (adds the trailer from your git identity)"
    fail=1
  elif ! printf '%s\n' "$signers" | grep -qxF "$author"; then
    echo "MISMATCHED sign-off: $(git show -s --format='%h' "$sha") authored by <$author>"
    echo "  signed off by: $(printf '%s' "$signers" | tr '\n' ' ')"
    echo "  fix: amend the trailer so it matches your commit identity"
    fail=1
  fi
done < <(git rev-list --no-merges "${base}..${head}")

if [ "$fail" -eq 0 ]; then
  echo "dco: every commit in $(git rev-parse --short "$base")..$(git rev-parse --short "$head") carries a valid sign-off"
fi
exit "$fail"
