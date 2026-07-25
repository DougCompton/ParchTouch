# Local test harness

Runs the two reference hosts with the addon loaded, for manual verification. Vendored hosts and story
files are **git-ignored** — fetch them yourself.

## 1. Fetch the hosts

```bash
cd harness
mkdir -p vendor

# Parchment (MIT) — take the web build from a release:
#   https://github.com/curiousdannii/parchment/releases
# Result: vendor/parchment/index.html + vendor/parchment/dist/web/*
# Record the tag you used in ../docs/COMPATIBILITY.md

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
docker compose up
```

| URL | What |
|-----|------|
| <http://localhost:8080/parchment/play.html?story=zork1.z5> | Parchment + the addon |
| <http://localhost:8080/parchmap/play.html?story=zork1.z5>  | Parchmap + the addon |
| <http://localhost:8080/stories/> | the story directory (same-origin, so no CORS proxy) |

Both pages load `/dist/glk-touch.js` and `/dist/glk-touch.css` — the exact artifacts a downstream
deployment copies out of a git tag. Serving the real bundle rather than the ESM sources is deliberate:
it removes the "works in dev, broken in dist" failure mode entirely. Reload the page after a rebuild
to pick up a change (`nginx.conf` sends `Cache-Control: no-store` for `/dist/`).

The Parchment page (`parchment/play.html`) is committed here. The Parchmap page needs two tags added
to the vendored copy — see Task 4.4 in the plan and `../docs/INSTALL.md`; that edit lives in the
git-ignored `vendor/` tree, so the harness never commits a modified host.

No Docker? `python3 -m http.server 8080` from this directory also works, but the story-directory JSON
index and the no-store header are nginx-specific.
