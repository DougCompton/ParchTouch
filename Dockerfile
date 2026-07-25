# glk-touch — a self-contained, playable interactive-fiction server.
#
# Bundles TWO GlkOte players with the touch overlay already installed, and serves your own story
# library from a mounted volume:
#
#   /parchment/play.html   modern Parchment (MIT, AsyncGlk) — plays Z-machine, Glulx, TADS, Hugo, SCARE
#   /parchmap/play.html    Parchmap (GPL-3.0) — adds an automatic map, route-finding and notes
#   /                      a picker listing everything in your library, with the right link for each
#
#   docker build -t glk-touch .
#   docker run -p 8080:80 -v /srv/if-stories:/stories:ro glk-touch
#
# LICENCE, and it matters. This addon's own files are MIT. Parchment is MIT. Parchmap is GPL-3.0, so
# the IMAGE AS A WHOLE is a combined work conveyed under GPL-3.0 — which is exactly why the addon is
# MIT and not GPL (plan decision D1): MIT is GPL-compatible, so this combination is lawful and these
# files stay MIT inside it. Every upstream licence is copied to /licences in the image. If you want a
# purely MIT artifact, build with --build-arg WITH_PARCHMAP=0.
#
# Story files are NOT baked in beyond Adventure, which is freely distributable. Mount your own library.

# Declared before any FROM so it can select a stage below. Repeated inside the stages that read it.
ARG WITH_PARCHMAP=1

# ── 1. the addon itself, built from this repo ─────────────────────────────────────────────────────
FROM node:20-alpine AS addon
WORKDIR /src
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY scripts/build.sh ./scripts/build.sh
RUN sh scripts/build.sh


# ── 2. Parchment (MIT), built from source ─────────────────────────────────────────────────────────
# NOT from a GitHub release asset: `parchment-for-inform7-*.zip` is a LEGACY build (flat parchment.js,
# JSONP story loading) and `parchment-single-file-*.zip` is one 5MB HTML file. Neither is the modern
# AsyncGlk `dist/web` layout. A source build is, and it also produces every interpreter engine.
#
# --recurse-submodules is essential: asyncglk, emglken, glkote, ifvms.js and quixe are submodules, and
# without them the build fails on `Could not resolve "../upstream/asyncglk/src/index-common.js"`.
FROM node:20-alpine AS parchment
ARG PARCHMENT_REF=master
RUN apk add --no-cache git python3 make g++
RUN git clone --depth 1 --recurse-submodules --shallow-submodules \
      --branch "$PARCHMENT_REF" https://github.com/curiousdannii/parchment /p
WORKDIR /p
# `npm ci` is not usable: upstream ships no package-lock.json.
RUN npm install --no-audit --no-fund && npm run build
# The .map files are a large fraction of the image and are useless in a served build.
RUN find dist -name '*.map' -delete


# ── 3. Parchmap (GPL-3.0), patched for offline use ────────────────────────────────────────────────
FROM alpine:3 AS parchmap-1
ARG PARCHMAP_REF=main
RUN apk add --no-cache git
RUN git clone --depth 1 --branch "$PARCHMAP_REF" https://github.com/roylaza/Parchmap /pm
WORKDIR /pm
RUN set -eux; \
    # It ships Google Analytics enabled, which phones home and stalls page load with no WAN.
    sed -i 's/GA_TRACK *= *true/GA_TRACK = false/' js/Consts.js; \
    grep -q 'GA_TRACK = false' js/Consts.js; \
    # Keep a pristine copy: the entrypoint rebuilds GameList.js from this plus your mounted library.
    cp js/GameList.js js/GameList.bundled.js; \
    # The addon goes in AFTER all of its own scripts, so .BufferWindow exists and its handlers are bound.
    sed -i 's#</body>#\t\t<link rel="stylesheet" href="../dist/glk-touch.css">\n\t\t<script src="../dist/glk-touch.js"></script>\n\t</body>#' play.html; \
    grep -q 'glk-touch.js' play.html


# Excluding Parchmap has to mean its files NEVER ENTER THE IMAGE. Deleting them in a later layer left
# them present in an earlier one — so the image still carried GPL-3.0 code while claiming to be MIT
# only, and was not one byte smaller. Selecting an empty stage instead is what actually excludes it.
FROM alpine:3 AS parchmap-0
RUN mkdir -p /pm

FROM parchmap-${WITH_PARCHMAP} AS parchmap-selected

# ── 4. the server ─────────────────────────────────────────────────────────────────────────────────
FROM nginx:alpine
ARG WITH_PARCHMAP=1
LABEL org.opencontainers.image.title="glk-touch" \
      org.opencontainers.image.description="Touch-playable interactive fiction: GlkOte players with the glk-touch overlay" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

# node is used only by the entrypoint, to base64-wrap stories for Parchmap's legacy core and to
# regenerate its game menu. Doing that in shell would mean fighting busybox base64 line-wrapping.
RUN apk add --no-cache nodejs

WORKDIR /usr/share/nginx/html

# the addon, at /dist/ — the same two files a manual install copies
COPY --from=addon /src/dist/glk-touch.js  /src/dist/glk-touch.css  ./dist/

# Parchment at /parchment/, plus our own minimal play page
COPY --from=parchment /p/index.html ./parchment/index.html
COPY --from=parchment /p/dist       ./parchment/dist
COPY docker/parchment-play.html     ./parchment/play.html

# Parchmap at /parchmap/. With WITH_PARCHMAP=0 this is an empty directory from the stand-in stage, so
# none of its files are in any layer and /parchmap/play.html simply 404s.
COPY --from=parchmap-selected /pm ./parchmap

# Adventure (Crowther & Woods, freely distributable) so the image plays out of the box. Decoded from
# the base64 copy Parchmap ships, so nothing is downloaded for it.
RUN mkdir -p /opt/glk-touch/seed \
 && if [ -f ./parchmap/games/Advent.z5.js ]; then \
      node -e "const fs=require('fs');const m=fs.readFileSync('./parchmap/games/Advent.z5.js','utf8').match(/processBase64Zcode\('([A-Za-z0-9+/=]+)'\)/);if(m)fs.writeFileSync('/opt/glk-touch/seed/advent.z5',Buffer.from(m[1],'base64'));" \
      && [ -s /opt/glk-touch/seed/advent.z5 ]; \
    fi

COPY docker/index.html      ./index.html
COPY docker/nginx.conf      /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.mjs  /opt/glk-touch/entrypoint.mjs
COPY docker/prepare.mjs     /opt/glk-touch/prepare.mjs

# Every upstream licence travels with the code, which is what both MIT and GPL require.
COPY LICENSE /licences/glk-touch.LICENSE
COPY --from=parchment /p/LICENSE /licences/parchment.LICENSE
RUN if [ -f ./parchmap/LICENSE ]; then cp ./parchmap/LICENSE /licences/parchmap.LICENSE; fi  && rmdir ./parchmap 2>/dev/null || true

# Your library. Mount it read-only; the entrypoint only reads from here.
VOLUME ["/stories"]
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/dist/glk-touch.js >/dev/null || exit 1

ENTRYPOINT ["node", "/opt/glk-touch/entrypoint.mjs"]
CMD ["nginx", "-g", "daemon off;"]
