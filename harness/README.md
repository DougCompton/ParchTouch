# Local test harness

Runs the two reference hosts with the addon loaded, for manual verification. Vendored hosts and story
files are **git-ignored** — fetch them yourself.

## 1. Fetch the hosts

```bash
cd harness
mkdir -p vendor

# Parchment (MIT) — BUILD FROM SOURCE. Do not use a GitHub release asset: those are a legacy
# build, not the modern AsyncGlk one this addon is verified against (see ../docs/COMPATIBILITY.md).
# --recurse-submodules is essential — asyncglk/emglken/glkote/ifvms/quixe are submodules, and
# without them the build fails on: Could not resolve "../upstream/asyncglk/src/index-common.js"
git clone --depth 1 --recurse-submodules --shallow-submodules \
    https://github.com/curiousdannii/parchment vendor/parchment
cd vendor/parchment && npm install && npm run build && cd ../..
# npm ci does NOT work: upstream ships no package-lock.json.
# Result: vendor/parchment/index.html + vendor/parchment/dist/web/*
# Record the commit you built in ../docs/COMPATIBILITY.md
#
# Quicker alternative if you only want the Z-machine: copy index.html and dist/web/{web.js,web.css,
# jquery.min.js,ie.js,bocfel.js,bocfel.wasm,waiting.gif} from a live deploy such as iplayif.com.

# Parchmap (GPL-3.0)
git clone --depth 1 https://github.com/roylaza/Parchmap vendor/parchmap
# Turn off its Google Analytics BEFORE serving anything — it phones home and stalls when offline:
#   vendor/parchmap/js/Consts.js:  GA_TRACK = true  ->  false
```

## 2. Add a story

Put a Z-machine story in `stories/` (e.g. `zork1.z5`). Story files are copyrighted and are not
committed. Legally distributable options: the Infocom titles Activision released for free, and the
modern catalogue at <https://ifarchive.org>.

## 3. Build the addon

Browsers cannot execute TypeScript, so the harness serves the **built bundle** — the same single
classic script a real deployment installs. Build it once, or leave the watch build running:

```bash
cd ..
npm run build          # one-shot
npm run dev            # or: rebuild dist/glk-touch.js on every save (own terminal)
```

`npm run dev` also emits `dist/glk-touch.js.map`, which is git-ignored; the released bundle from
`scripts/build.sh` has no map.

> On Windows these scripts run `sh`, so use Git Bash (or WSL) — `sh` is not on the PATH in
> PowerShell or cmd.

## 4. Serve

```bash
cd harness
docker compose up            # nginx
# or, no Docker and no dependencies (same prefix mapping):
node ../scripts/serve-harness.mjs [port]
```

| URL | What |
|-----|------|
| <http://localhost:8080/parchment/play.html?story=../stories/advent.z5> | Parchment + the addon |
| <http://localhost:8080/parchmap/play.html?story=games/Advent.z5.js> | Parchmap + the addon |
| <http://localhost:8080/stories/> | the story directory (same-origin, so no CORS proxy) |

**`?story=` must be a path, not a bare filename**, and it is host-specific:

- **Parchment** resolves it with `new URL(story, document.URL)`, i.e. relative to `/parchment/`, so
  the story needs the `../stories/` prefix. A bare `?story=advent.z5` does not merely 404 — Parchment
  derives its loading-pane title with `/([/=])([^/=]+)$/.exec(path)[2]`, which returns `null` for a
  string containing no `/` or `=`, so the page dies with `TypeError: Cannot read properties of null
  (reading '2')` before it fetches anything.
- **Parchmap** links its own games as `play.html?story=games/<Filename>`, and its catalogue ships
  JS-wrapped (`Advent.z5.js`). Whether it also accepts a raw story outside `games/` is still open —
  `docs/COMPATIBILITY.md` question 4.

Both pages load `/dist/glk-touch.js` and `/dist/glk-touch.css` — the exact artifacts a downstream
deployment copies out of a git tag. Serving the real bundle rather than the ESM sources is deliberate:
it removes the "works in dev, broken in dist" failure mode entirely. Reload the page after a rebuild
to pick up a change (`nginx.conf` sends `Cache-Control: no-store` for `/dist/`).

The Parchment page (`parchment/play.html`) is committed here. The Parchmap page needs two tags added
to the vendored copy — see Task 4.4 in the plan and `../docs/INSTALL.md`; that edit lives in the
git-ignored `vendor/` tree, so the harness never commits a modified host.

No Docker? `python3 -m http.server 8080` from this directory also works, but the story-directory JSON
index and the no-store header are nginx-specific.

## Automated verification

Once the hosts are vendored and a story is in `stories/`, the end-to-end suite drives them for real:

```bash
cd ..
npm run build        # e2e serves dist/, the artifact a host actually installs
npm run test:e2e     # Chromium + WebKit
```

It starts its own server (`scripts/serve-harness.mjs`), so Docker is not needed. Findings are recorded
in `../docs/COMPATIBILITY.md`.

`synthetic/glkote.html` is a third, dependency-free host implementing only GlkOte's DOM contract with
no other scripts on the page. It is how the char-input and pager states get deterministic coverage — a
real game will not produce them on demand — and it doubles as the executable form of the
"works with no host application present" claim.
