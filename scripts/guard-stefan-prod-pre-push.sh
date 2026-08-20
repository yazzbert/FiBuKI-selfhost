#!/usr/bin/env bash
# Pre-push guard for stefan-prod (fork issue #49).
#
# stefan-prod is merge-only. A commit authored directly on it may touch only
# the self-host lane. Product changes go through a feat/* branch and an
# upstream PR. This is a tripwire, not a wall: bypass one push with
#   ALLOW_STEFAN_PROD=1 git push
#
# Install:  cp scripts/guard-stefan-prod-pre-push.sh .git/hooks/pre-push
#           chmod +x .git/hooks/pre-push
set -euo pipefail

[ "${ALLOW_STEFAN_PROD:-0}" = "1" ] && exit 0

LANE_B='^(functions/src/selfhost/|lib/selfhost/|deploy/|scripts/|docs/selfhost|docker-compose|Dockerfile|\.github/workflows/forward-stefan-prod\.yml|\.env\.example|\.gitignore)'
ZERO="0000000000000000000000000000000000000000"

while read -r _local_ref local_sha remote_ref remote_sha; do
  [ "$remote_ref" = "refs/heads/stefan-prod" ] || continue
  [ "$local_sha" = "$ZERO" ] && continue

  if [ "$remote_sha" = "$ZERO" ]; then
    range="$local_sha"
  else
    range="$remote_sha..$local_sha"
  fi

  # A commit that already lives on a feat/* branch or upstream main is not
  # "authored on stefan-prod" - merging those in is exactly what the branch
  # is for. Only commits reachable from nowhere else are judged.
  exclude=$(git for-each-ref --format='%(objectname)' \
    refs/remotes/fork/feat/ refs/heads/feat/ refs/remotes/origin/main \
    refs/remotes/fork/main)

  bad=0
  # shellcheck disable=SC2086
  for c in $(git rev-list --no-merges "$range" --not $exclude); do
    viol=$(git diff-tree --no-commit-id --name-only -r "$c" | grep -vE "$LANE_B" || true)
    if [ -n "$viol" ]; then
      echo "BLOCKED: commit ${c:0:8} was authored directly on stefan-prod and touches product paths:" >&2
      echo "$viol" | head -5 | sed 's/^/  /' >&2
      bad=1
    fi
  done

  if [ "$bad" = "1" ]; then
    echo "" >&2
    echo "Product changes go through a feat/* branch and an upstream PR (fork issue #49)." >&2
    echo "Bypass once: ALLOW_STEFAN_PROD=1 git push" >&2
    exit 1
  fi
done

exit 0
