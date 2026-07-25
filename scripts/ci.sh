#!/usr/bin/env sh
# All gates, in the order that fails fastest. Deliberately forge-agnostic: call this one script from
# Gitea Actions, GitLab CI, Jenkins, a git pre-push hook, or by hand. No forge-specific config to
# keep in sync.
set -eu

echo "== typecheck ==";      npm run typecheck
echo "== independence ==";   npm run lint:independence
echo "== tests ==";          npm test
echo "== build ==";          npm run build

echo "== dist is a classic script =="
if grep -nE '^[[:space:]]*(import|export)[[:space:]]' dist/glk-touch.js; then
  echo "FAIL: dist/glk-touch.js contains ESM syntax; hosts load it as a classic script." >&2
  exit 1
fi

echo "== dist matches src =="
# --porcelain covers UNTRACKED files too: `git diff` alone would silently pass on a first build
# where dist/ has never been committed.
if [ -n "$(git status --porcelain -- dist/)" ]; then
  echo "FAIL: dist/ is stale or uncommitted — run 'npm run build' and commit the result." >&2
  git status --short -- dist/
  exit 1
fi

echo "ALL GATES PASSED"
