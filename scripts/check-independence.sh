#!/usr/bin/env sh
# The addon must not know any particular host exists (§0.2). Fails if a host-specific identifier
# appears in the source. Checked against src/ only: docs and the harness may name hosts freely.
set -eu

if grep -nE '\b(Parchmap|GameList|Navigator|Autocomplete|Consts|parchment_options)\b' src/*.ts; then
  echo "FAIL: host-specific reference found in src/ — the addon must stay host-agnostic." >&2
  exit 1
fi
echo "OK: no host-specific references in src/"
