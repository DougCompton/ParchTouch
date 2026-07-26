#!/usr/bin/env sh
# Bundle the TypeScript ESM sources into ONE classic script, so a host installs the addon with a
# single <script> tag — no module loader, no import map, nothing to configure.
#
# esbuild strips types but does NOT typecheck: `npm run typecheck` (tsc --noEmit) is a separate,
# required gate. See scripts/ci.sh.
set -eu

mkdir -p dist

OUT=dist/parch-touch.js

npx esbuild src/if-buttons.ts \
  --bundle \
  --format=iife \
  --target=es2018 \
  --outfile="$OUT"

# esbuild only preserves comments marked @license, @preserve or //!, so an SPDX-only header in the
# source would be stripped. MIT requires the notice to travel with the code, so it is prepended here
# unconditionally.
#
# Prepended with cat rather than passed as `--banner:js`: a MULTI-LINE argv value is silently
# truncated when it crosses `npx` on Windows, which drops every later flag including --outfile —
# esbuild then writes the bundle to stdout and this script would exit 0 having produced nothing.
{
  printf '%s\n' \
    '/*! ParchTouch — on-screen commands for Parchment and other GlkOte interactive fiction players.' \
    ' * SPDX-License-Identifier: MIT' \
    ' * Copyright (c) 2026 Doug Compton' \
    ' */'
  cat "$OUT"
} > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

cp src/if-buttons.css dist/parch-touch.css

# Fail loudly rather than reporting success on an empty or missing artifact — the failure mode above
# was silent, and a downstream deployment pins whatever is committed here.
for f in "$OUT" dist/parch-touch.css; do
  if [ ! -s "$f" ]; then
    echo "FAIL: $f was not produced." >&2
    exit 1
  fi
done

echo "built dist/parch-touch.js and dist/parch-touch.css"
