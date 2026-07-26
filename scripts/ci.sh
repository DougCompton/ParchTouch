#!/usr/bin/env sh
# All gates, in the order that fails fastest. Deliberately forge-agnostic: call this one script from
# Gitea Actions, GitLab CI, Jenkins, a git pre-push hook, or by hand. No forge-specific config to
# keep in sync.
set -eu

echo "== typecheck ==";      npm run typecheck
echo "== independence ==";   npm run lint:independence
echo "== tests ==";          npm test
echo "== build ==";          npm run build

# E2E runs AFTER the build, because it serves dist/ — the same artifact a host installs. The real-host
# specs skip themselves when harness/vendor/ is absent (see harness/README.md), so this stays green on
# a fresh clone while still covering the addon in real Chromium and WebKit via the synthetic host.
echo "== e2e ==";            npm run test:e2e

echo "== dist is a classic script =="
if grep -nE '^[[:space:]]*(import|export)[[:space:]]' dist/parch-touch.js; then
  echo "FAIL: dist/parch-touch.js contains ESM syntax; hosts load it as a classic script." >&2
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
