# glk-touch

On-screen commands for **GlkOte**-based interactive fiction players — play parser IF by touch, with no
keyboard.

Parser IF means typing a command every turn, which is miserable on a tablet where a software keyboard
covers a third of the screen. `glk-touch` overlays a direction pad and an editable word list onto an
existing browser IF player, and makes every word in the story text tappable — so a whole session needs
zero keystrokes.

MIT licensed. **Zero runtime dependencies**, no framework, one plain `<script>` tag.

---

## Install

The addon itself is always the same two tags, added **before `</body>`** and **after the host's own
scripts**:

```html
<link rel="stylesheet" href="glk-touch.css">
<script src="glk-touch.js"></script>
```

No module loader, no import map, no host-specific configuration. Order matters only because the host
must have created its `.BufferWindow` before the bar can attach — and even then the addon polls for up
to 20 seconds, so loading it last is always enough.

Pick the path that matches your situation:

- **[Docker — a ready-made server](#run-it-as-a-server-docker)** — one command, both players, nothing to
  install but Docker. **Start here if you just want to play**, especially on a tablet.
- **[A. You already run Parchment, Parchmap or another GlkOte player](#a-adding-it-to-a-player-you-already-run)** — two files, two tags, done.
- **[B. Starting from nothing, with Parchment](#b-from-scratch-with-parchment)** — the current, maintained interpreter.
- **[C. Starting from nothing, with Parchmap](#c-from-scratch-with-parchmap)** — adds an automatic map, route-finding and notes.

The manual paths (A, B, C) all assume you are **serving over HTTP**. No GlkOte player runs from a
`file://` URL, so `python3 -m http.server 8080` (or nginx, or Caddy) in the directory you set up is a
required step, not an optional one. The Docker image handles that for you.

### Get the two files

Either way you install, you need `glk-touch.js` and `glk-touch.css`:

```bash
git clone https://github.com/DougCompton/ParchTouch
# dist/glk-touch.js and dist/glk-touch.css are committed — no build step needed
```

`dist/` is committed deliberately, so you can copy the two files straight out of a checkout or a git
tag. If you would rather build them yourself: `npm install && npm run build`.

---

### A. Adding it to a player you already run

1. Copy `dist/glk-touch.js` and `dist/glk-touch.css` next to the host's own assets.
2. Open the page the game is played on and add the two tags before `</body>`, after every one of the
   host's scripts. Adjust the two `href`/`src` paths to wherever you put the files.
3. Reload. A command bar appears at the bottom, and words in the story text become tappable.

That is the whole change. Nothing about the host's own configuration, story library or markup needs to
change, and the addon adds exactly one global (`window.IFButtons`, a console debugging handle).

Host-specific notes:

| Host | Where to add the tags |
|------|-----------------------|
| **Parchment** | after `web.js` in `index.html` (or your own play page) |
| **Parchmap** | in `play.html`, after all of `js/*.js` — the addon then detects the map panel automatically, compacts the bar and adds a **⊞** button to collapse the map |
| **Anything else GlkOte-based** | last in `<body>`; nothing else is required |

If the bar does not appear, open the console and run `IFButtons.inputMode()` — the
[troubleshooting table](docs/INSTALL.md#troubleshooting) explains each answer.

---

### B. From scratch with Parchment

[Parchment](https://github.com/curiousdannii/parchment) is MIT-licensed and actively maintained. It is
the reference host for this addon.

#### 1. Get a Parchment web build

You need the `dist/web/` layout — `web.js`, `web.css`, `jquery.min.js`, `ie.js`, plus the interpreter
engines it loads on demand (`bocfel.js` + `bocfel.wasm` for Z-machine; `glulxe.js`/`quixe.js` for
Glulx), `waiting.gif`, and `dist/fonts/` (optional — without it the game plays fine but the console
logs font 404s).

**Build it from source** — this is the reliable route, and produces every engine:

```bash
git clone https://github.com/curiousdannii/parchment
cd parchment
npm install
npm run build          # produces dist/web/
```

> **Do not use the GitHub release assets for this.** Verified against the 2025.1.14 release:
> `parchment-for-inform7-*.zip` contains a *legacy* build (flat `parchment.js`, JSONP story loading —
> not the modern AsyncGlk core), and `parchment-single-file-*.zip` is one self-contained 5 MB
> `parchment.html`. Neither has the `dist/web/` layout. See
> [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

#### 2. Lay out a directory to serve

```
site/
  index.html                 <- Parchment's own page, from the build
  dist/web/                  <- copied from the Parchment build
      web.js  web.css  jquery.min.js  ie.js
      bocfel.js  bocfel.wasm  waiting.gif
  dist/fonts/                <- optional; silences console 404s
  glk-touch.js               <- from this repo's dist/
  glk-touch.css
  stories/
      advent.z5              <- your story files, raw and unwrapped
```

Story files stay **same-origin** (`stories/…`), which keeps Parchment from routing them through its
CORS proxy — so the whole thing works offline.

#### 3. Add the addon — either to Parchment's own page, or to your own

**Simplest: use the `index.html` that came with the build.** Add the two tags to it and change nothing
else:

```html
    <link rel="stylesheet" href="glk-touch.css">   <!-- before </head> -->
</head>
...
    <script src="glk-touch.js"></script>           <!-- before </body> -->
</body>
```

That page already has everything Parchment needs, including its story-picker UI. Both this and the
minimal page below are verified working.

**Or write your own minimal play page** — useful if you want to drop the picker and go straight into a
story. Save as `play.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>IF</title>

<script>
  // Options that exist in the current build. Note the story is NOT set here — see step 4.
  window.parchment_options = { use_proxy: 0 }
</script>

<link rel="stylesheet" href="dist/web/web.css">
<link rel="stylesheet" href="glk-touch.css">
</head>
<body>
<div id="gameport">
  <div id="about"></div>
  <div id="windowport"></div>
  <div id="loadingpane" style="display:none"><em>Loading…</em></div>
  <div id="errorpane" style="display:none"><div id="errorcontent"></div></div>
</div>

<script src="dist/web/jquery.min.js"></script>
<script src="dist/web/ie.js" nomodule></script>
<script src="dist/web/web.js" type="module"></script>

<!-- glk-touch: last, after the host's scripts -->
<script src="glk-touch.js"></script>
</body>
</html>
```

`web.js` is a module, which is exactly why the addon can be a plain classic script loaded afterwards —
it never joins the host's module graph.

#### 4. Serve it, and open a story

```bash
cd site && python3 -m http.server 8080
```

Then open **`http://localhost:8080/play.html?story=stories/advent.z5`** (or `index.html?story=…` if you
took the simpler route above).

> **`?story=` must be a path, not a bare filename.** The current build reads the story from the page's
> own query string. A bare `?story=advent.z5` does not merely 404 — Parchment derives its loading-pane
> title with `/([/=])([^/=]+)$/.exec(path)[2]`, which is `null` for a string containing no `/` or `=`,
> so the page dies with `TypeError: Cannot read properties of null (reading '2')` before it fetches
> anything. Always include the directory: `?story=stories/advent.z5`.
>
> The older `parchment_options` keys `default_story`, `lock_story`, `lock_options` and `story_name`
> **no longer exist** in this build.

Tap a compass direction. If the game moves, you are done.

---

### C. From scratch with Parchmap

[Parchmap](https://github.com/roylaza/Parchmap) is **GPL-3.0**. It bundles an older Parchment core plus
an automatic map, route-finding and notes. This addon stays MIT; MIT is GPL-compatible, so the
*combination* is conveyed under GPL-3.0 while these files remain MIT.

#### 1. Clone it and turn off Analytics

```bash
git clone --depth 1 https://github.com/roylaza/Parchmap site
cd site
```

Then edit `js/Consts.js`:

```js
const GA_TRACK = false;   // ships as true — it phones home and stalls page load when offline
```

Do this **before serving anything**, especially on a LAN.

#### 2. Add the addon

Copy `glk-touch.js` and `glk-touch.css` into the Parchmap directory, then add the two tags to
`play.html` immediately before `</body>` — after all of Parchmap's own `js/*.js`:

```html
  <link rel="stylesheet" href="glk-touch.css">
  <script src="glk-touch.js"></script>
</body>
```

The addon finds Parchmap's `#map` panel by generic capability detection, compacts the bar to leave the
prose room, and adds a **⊞** button that collapses the map.

#### 3. Add stories — these must be JS-wrapped

Parchmap's bundled core does **not** load raw story files. Its catalogue ships 298 games all named like
`Advent.z5.js`, and each is a single line:

```js
processBase64Zcode('<the story file, base64-encoded>');
```

To add your own story, wrap it:

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('advent.z5').toString('base64');fs.writeFileSync('games/Advent.z5.js',\"processBase64Zcode('\"+b+\"');\")"
```

To make it appear in the menu, add an entry to `js/GameList.js`:

```js
{
    Title: "Adventure",
    Subtitle: "aka Colossal Cave",
    Author: "Crowther & Woods",
    Filename: "Advent.z5.js"
},
```

#### 4. Serve it and play

```bash
python3 -m http.server 8080
```

Open **`http://localhost:8080/play.html?story=games/Advent.z5.js`**, or pick the game from the menu at
`index.html`.

> On a legacy core like this one, the opening text often paginates, and **the first tap may be consumed
> dismissing the pager** rather than sending a command. That is deliberate: a command sent while the
> pager is showing would be swallowed by the host. Tap again.

---

## Run it as a server (Docker)

The shortest route to playable IF on a tablet: one image containing **both** players with the overlay
already installed, serving your own story library. Nothing to install but Docker — no Node, no npm, no
hunting down and vendoring a player by hand.

### Run it

```bash
git clone https://github.com/DougCompton/ParchTouch && cd ParchTouch
docker build -t glk-touch .
docker run -d --name glk-touch -p 8080:80 -v /srv/if-stories:/stories:ro glk-touch
```

Open **<http://localhost:8080/>**. From the tablet, use the server's own address on your network —
`http://192.168.1.20:8080/` — since playing from the couch is the whole point.

You do not even need a library to start:

```bash
docker run -d -p 8080:80 glk-touch      # seeds Adventure into an empty library
```

### …or with Compose

`compose.yaml` is in the repo:

```bash
STORIES=/srv/if-stories docker compose up -d --build
```

| Variable | Default | What |
|----------|---------|------|
| `STORIES` | `./stories` | directory of story files to serve |
| `PORT` | `8080` | host port to publish |

### What you get

| Path | What |
|------|------|
| `/` | a picker listing your library, with the right link per game |
| `/parchment/play.html` | modern Parchment: Z-machine, Glulx, TADS, Hugo and SCARE |
| `/parchmap/play.html` | Parchmap: adds the automatic map, route-finding and notes |

### Your story library

Drop **raw, unconverted** story files into the directory you mount — `advent.z5`, `zork1.z5`,
`Trinity.z4`, a `.zblorb`, a Glulx `.ulx`. The container reconciles the two players' disagreement about
the same game for you: at start-up it wraps every Z-machine story into the `processBase64Zcode` form
Parchmap's legacy core requires, and **injects your library into Parchmap's own game menu** beside the
games it ships with. The volume is only ever read from, so mount it `:ro`.

- The picker reads the library **live**, so a game you drop in appears on the next page reload.
- A **restart** is what makes a new game reach Parchmap, since that is when the wrapping happens.
- Glulx, TADS, Hugo and SCARE games play in Parchment. Parchmap is Z-machine only, and the picker says
  so per game rather than offering a link that would fail.

### Playing something that is not in the library

The front page also has, below the list:

- **Play from URL** — paste a link to a story file.
- **Upload from this device…** — pick a file off the tablet or laptop.

Both open in **Parchment with the touch bar**, by handing off to Parchment's own picker page at
`/parchment/`, which has the overlay injected at build time. An upload is read by Parchment's own loader
and never reaches the server; a local file cannot be passed to a page through a URL, so there is nothing
to reimplement here.

Two caveats worth knowing:

- **Parchmap can take neither.** Its bundled core loads a JS-wrapped copy from the library, so a URL or
  an upload is Parchment-only.
- A **cross-origin URL needs internet.** Parchment fetches `ifarchive.org` (and its mirrors) directly,
  but routes anything else through its CORS proxy. A same-origin URL — anything on this server — is
  fetched directly and works offline, as does the library itself.

### Build options

| Build arg | Default | What |
|-----------|---------|------|
| `WITH_PARCHMAP` | `1` | `0` leaves Parchmap out of **every layer** — a purely MIT image, ~200 MB instead of ~385 MB, losing only the map |
| `PARCHMENT_REF` | `master` | branch or tag of Parchment to build |
| `PARCHMAP_REF` | `main` | branch or tag of Parchmap to vendor |

```bash
docker build --build-arg WITH_PARCHMAP=0 -t glk-touch:mit .
```

To pick up a new version of the addon, rebuild and recreate the container; the addon is always built
from your working tree. Add `--no-cache` to also refresh the upstream players.

### Worth knowing

- **The first build takes a few minutes.** Parchment is built from source — its published release
  assets are a *legacy* build, not the modern AsyncGlk one — including its git submodules and every
  wasm interpreter. Later builds reuse the cache.
- The image has a healthcheck, so `docker ps` shows `healthy` once it is actually serving.
- It speaks plain HTTP on port 80 inside the container. Put it behind your own reverse proxy for TLS.
- Story files are not baked in beyond Adventure (Crowther & Woods), which is freely distributable.

**Licence, and it matters here.** These files are MIT and Parchment is MIT, but Parchmap is GPL-3.0, so
the default image is a combined work conveyed under **GPL-3.0** — which is precisely why this addon is
MIT rather than GPL: MIT is GPL-compatible, so the combination is lawful and these files stay MIT within
it. Every upstream licence is copied to `/licences` in the image. Build with
`--build-arg WITH_PARCHMAP=0` for a genuinely MIT-only artifact.

## Using it

The bar has three parts, left to right.

**The direction pad** — the only buttons that send immediately, because movement is wanted every turn
and needs no confirming:

```
NW   N   NE   Up
W    ↵   E    Down
SW   S   SE   ⚙
```

- **↵** sends whatever is currently in the input box. It also advances a *press any key* prompt and
  dismisses a `-- more --` pager, which is what to reach for when a tap seems to do nothing.
- With a word already selected, a direction becomes its object: `Look` then `N` sends `look north`.
  Directions are always sent at once, so they never need **↵**.
- **⚙** opens settings, which **takes the place of the buttons** so it has room; its **✕ Close**
  button brings them back. There you can add a word, and **tap a word to select it** then use
  **◀ ▶** to reorder or **Delete** to remove it. You can also just **drag a word** to a new position,
  by mouse or by touch. Order matters: the strip shows three rows and scrolls, so the words you put
  first are the ones you can reach without scrolling.
- **Layouts:** the word list is one of several named sets you switch between in settings — keep a
  `Zork` layout and a `modern` one rather than re-pruning for every story. New layouts start from the
  shipped words; the active choice is remembered across reloads.
- Words may start with **`/`**, so a host's own commands (`/map`, `/notes`, …) work as buttons too.
  Those are claimed by the host rather than the game, so just tap them — **no ↵**. See
  [docs/INSTALL.md](docs/INSTALL.md).

**The word list** (middle) — one editable list of everything else: `look`, `inventory`, `take`,
`examine`, `again`, `undo`, `save` and so on. Tapping one **stages** text into the input box and sends
nothing, so you can see exactly what will be sent and change your mind for free. Press **↵** to send it.

- For a command that needs no object, one tap then **↵**: `Look` → `look` → send.
- For one that takes an object, tap the word **in the story text**: `Take` then "lamp" stages
  `take lamp`. **Either order works** — tapping "lamp" then `Examine` stages `examine lamp`, not
  `lamp examine`.
- The list scrolls if it does not fit; the bar itself is never more than three buttons tall.

**The actions column** (right) — the two controls that never send a command, so they act at once:

- **✕** abandons whatever you were building and clears the input box.
- **⊞** hides and restores the map, and appears only on a host that has one.

Theming, the full troubleshooting table and per-host notes are in [docs/INSTALL.md](docs/INSTALL.md).

## How it works

The addon attaches to **GlkOte** — the JavaScript/DOM implementation of Glk that browser IF
interpreters render through — and to nothing else. Its entire integration surface is GlkOte's
documented DOM contract:

| Hook | Used for |
|------|----------|
| `.BufferWindow` | MutationObserver root; bottom padding so the bar never covers text |
| `.BufferLine` | the unit of word tokenization |
| `.Input.LineInput` (or bare `.Input`) | command submission, and the positive test for line mode |
| `.MorePrompt` | paging indicator — dismissed before submitting, so no command is swallowed |
| `.Style_input` | echoed player input — deliberately *not* made tappable |

Two details worth knowing, both established by testing real builds rather than assumed: the line input
is a **`<textarea>`** in current AsyncGlk (so the selector must not insist on `input.`), and the command
is submitted with a **`keypress` only** — adding `keydown` makes a legacy jQuery-based host clear its
field and submit an empty command. See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

Because that contract is what makes a host a host, one bundle serves any GlkOte player. The addon
**never names a specific host** and never branches on "which host am I in?" — every host-specific
thing (a map panel, a theme, jQuery) is *feature-detected*, and a missing feature disables only
itself. It **works with or without** a map-providing host: if a map element is present the bar
compacts and gains a **⊞** collapse toggle; if not, that behaviour simply never appears. A grep gate
(`npm run lint:independence`) fails the build if a host-specific identifier reaches `src/`.

The code splits into a **pure logic core** (`src/command-model.ts` — command pairing, tokenizing,
verb rules; no DOM at all) and a **DOM glue layer** (`src/if-buttons.ts`). That split is what makes
the interaction rules testable without a browser. esbuild bundles both into one ES2018 IIFE.

Browser floor: Chrome 64+, Safari 11.1+, Firefox 78+, Edge 79+ — set by Unicode property escapes
(`/\p{L}/u`), used so accented nouns (*café*) and non-English IF are tappable.

## Verified hosts

See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

Both Parchment (modern AsyncGlk) and Parchmap are verified automatically, in Chromium and WebKit,
playing a real story. **A physical tablet is still outstanding** — WebKit proves the event mechanism
but not real touch input or the software keyboard.

## Development

```bash
npm install
npm test                    # unit tests, vitest + jsdom
npm run test:e2e            # end-to-end, Chromium + WebKit, against real hosts
npm run typecheck           # tsc --noEmit; esbuild strips types but does not check them
npm run lint:independence   # fails if src/ names a specific host
npm run build               # dist/glk-touch.js (IIFE) + dist/glk-touch.css
sh scripts/ci.sh            # every gate, in fail-fastest order
```

The end-to-end suite exists because jsdom cannot prove two things: that a synthetic Enter really
reaches a host in a live engine, and what classes a real GlkOte build actually emits. It runs in
**WebKit** as well as Chromium — WebKit being iOS Safari's engine family, and a tablet being the point
of this addon. Real-host tests skip themselves when `harness/vendor/` is absent, so a fresh clone stays
green on the synthetic host alone; see [harness/README.md](harness/README.md) to vendor the hosts.

`sh scripts/ci.sh` is deliberately forge-agnostic — call it from any CI, a pre-push hook, or by hand.
On Windows run the `sh`-based scripts from **Git Bash** or WSL; `sh` is not on the PATH in PowerShell
or cmd.

`dist/` is **committed on purpose**: a downstream deployment copies it straight out of a git tag, with
no npm registry in the loop. `scripts/ci.sh` enforces that the committed bundle matches `src/`, so it
cannot drift.

To verify against the two real hosts locally, see [harness/README.md](harness/README.md).

## Licence

MIT — Copyright (c) 2026 Doug Compton. See [LICENSE](LICENSE).

MIT is GPL-compatible, so a deployment may legally combine this addon with a GPL-3.0 host: that
*combination* is conveyed under GPL-3.0 while these files stay MIT.
