# Verified hosts

Every claim here was observed against real software, not inferred. Most of it comes from the automated
end-to-end suite (`npm run test:e2e`), which drives **real** hosts in **real browsers** — Chromium and
WebKit — playing a real Z-machine story (Adventure, release 9 / 060321); re-run it to reproduce those.
The build-time findings (Parchment's submodules, its missing lockfile) come from building the Docker
image, which is reproducible with `docker build .`.

**Still outstanding: a physical tablet.** WebKit is iOS Safari's engine family, so the synthetic-event
mechanism is proven there, but real touch input, the software keyboard and viewport behaviour are not.
That is plan Task 5.3 and it needs hardware.

| Host | Version / commit | Verified | `.Input.LineInput`? | Notes |
|------|------------------|----------|---------------------|-------|
| Parchment (modern) | harness: live `iplayif.com` build, fetched 2026-07-25 · Docker image: built from `master` source | 2026-07-25 | **yes** | reference host; MIT; AsyncGlk; engine `bocfel.wasm` |
| Parchmap | `roylaza/Parchmap` `main` @ `f9ecfde`, cloned 2026-07-25 | 2026-07-25 | **yes** | GPL-3.0; legacy Parchment core + jQuery 3.5.1; also provides a map |

---

## Parchment (AsyncGlk) — §0.3 question 1

- **`.Input.LineInput` is emitted: YES.** Exactly one, plus one bare `.Input` alongside it.
- **The line input is a `<textarea>`, not an `<input>`.** This corrects the plan's contract, which
  documents the target as `input.Input.LineInput`. `findLineInput()` works here *only* because it also
  tries the bare-class selector `.Input.LineInput`. **That alternative is load-bearing on the current
  reference host** — the opposite of the plan's assumption that the `input.` form is primary. Do not
  "simplify" it away.
- Contract confirmed present: `.BufferWindow`, `.BufferLine`, `.Input`, `.LineInput`, `.Style_input`.
  There is also a `.BufferWindowInner` element the plan's contract does not mention; the addon does not
  need it, but be aware the scrolling element is not the only wrapper.
- **`.MorePrompt` lifecycle: the class does not exist in this build at all.** It appears nowhere in
  `web.js` and no such element is ever created, so `inputMode()` can only return `'line'` or `'char'`
  here and the pager path is unreachable. It is *not* dead code — see Parchmap below.
- `inputMode()` observed: `'line'` while awaiting a command.
- Verified by tap alone: compass movement, `Look`, `Inv`, verb+noun in **both** orders, verb
  persistence across reload, lossless decoration of the banner text, echoed input never decorated, and
  no third-party network requests.
- Tablet pass (device / OS / browser): **outstanding — needs hardware.**

### Its `parchment_options` keys have changed

The plan documents `default_story`, `lock_story`, `lock_options` and `story_name`. **None of those
exist in the current build.** `web.js` reads its story from the page's own `?story=` query parameter,
and the surviving options are `auto_launch`, `autoplay`, `use_proxy`, `proxy_url`, `lib_path`,
`do_vm_autosave`, `theme_cookie`, `direct_domains`, `set_body_to_page_bg`.

`?story=` must be a **path**, not a bare filename. A bare `?story=advent.z5` does not merely 404 —
Parchment derives its loading-pane title with `/([/=])([^/=]+)$/.exec(path)[2]`, which is `null` for a
string containing no `/` or `=`, so the page dies with `TypeError: Cannot read properties of null
(reading '2')` before fetching anything.

---

## Parchmap — §0.3 questions 2, 3 and 4

- **Does the map update from addon-submitted commands? PASS.** It cannot desync, by construction.
  `Parchmap.GetRoom()` runs from a **200 ms polling loop** and reads the room name out of the rendered
  output (`#windowport .GridLine span`, the status line), with the direction from
  `Input.GetLastDirection()`, which scans echoed `.Style_input`. Both are output-derived, and the echo
  appears however the command was submitted. Parchmap never observes input at all. Verified: tapping
  the compass adds rooms to the map exactly as typing would.
  **Consequence: the plan's Task 6.1 jQuery-dispatch contingency is unnecessary and was not added.**
- **Input-buffer collision: PASS.** Its `Input.js` appends (`val(val() + text)`) where the addon
  assigns. Verified with `ta` pre-loaded in the field: exactly `take building` is submitted, never
  `tatake building`, and the field is empty afterwards.
- **Map container selector: `#map`** — already matched by the addon's existing generic
  `MAP_SELECTORS`. No narrowing was needed, so plan Task 6.5 is moot and detection stays
  capability-based rather than host-based.
- **Story format: `.js`-wrapped, required.** Its catalogue ships 298 games all named like
  `Advent.z5.js`. **Wrapper function: `processBase64Zcode('<base64>')`.** Its own links use
  `play.html?story=games/<Filename>`.
  Whether `?story=` reaches a raw story *outside* `games/` is **still open** — not needed for the addon,
  and it only affects how a downstream deployment serves its library.
- Host features unaffected: its own map toggles and line input remain, and after a reload the addon's
  verbs *and* the host's map data both survive, so the addon's storage does not disturb its `PM_*` keys.
- No third-party requests, with `GA_TRACK = false` (the harness setup flips it; it ships `true`).

### `.MorePrompt` DOES exist here, and the visibility guard matters

Its legacy core emits `.MorePrompt` (present in `lib/main.js` and `css/parchment.css`). More
importantly, **whether a pager appears depends on font metrics**: the same page shows a `.MorePrompt`
at startup in **WebKit** but not in Chromium, and a short or tablet-sized viewport makes it more
likely still.

So on this host `inputMode()` really does return `'more'`, the addon dismisses rather than submitting,
and **the first tap can legitimately be consumed by the pager**. That is correct behaviour — a command
sent while paging would be swallowed — but it is worth knowing when a tap appears to "do nothing".
The `isVisible()` guard in `if-buttons.ts` is what stops a retained-but-hidden pager from deadlocking
input forever; keep it.

### Its own `/commands` are found by POLLING, not by a key event

It reserves `/name` for its own features — `/map`, `/help`, `/notes`, `/theme`, `/goto`, `/see`,
`/note`, `/room-notes`, `/clear`, `/quit`. `Input.Process()` runs from a **200 ms polling loop** and
simply watches the input field; it hooks no key event for these at all.

That decides the interaction, so it is worth stating plainly: **staging the text is the whole gesture,
and the return key must NOT be pressed.** Tapping such a button puts `/map` in the field, the host picks
it up within a fraction of a second, acts on it and clears the field itself — the game never sees the
text. Pressing return first hands it to the interpreter instead, which answers *"That's not a verb I
recognise"*.

Verified: field goes `"/map"` → `""` with no new echo in the buffer. This is also why
`normalizeVerb()` keeps a leading slash; it used to strip it, turning `/note` into `note`.

### It pins panels to the VIEWPORT, which a fixed overlay must account for

Its map panel is `position: fixed; top: 0; bottom: 0` and its game frame `position: fixed; top: 20px;
bottom: 20px`. Padding `.BufferWindow` does nothing for either, so a bar fixed to the bottom of the
screen sat over the map's lower third and the host's own footer.

Three specifics, each of which cost an attempt:

- **`bottom` alone does nothing.** With both `top` and `height` set the element is over-constrained and
  `bottom` is ignored — even with `!important`, no rect moved.
- **Shrink, do not move.** Shifting `top` up clears the bar but pushes the same number of pixels off the
  TOP of the screen: measured 148px of the map and 108px of the game frame. Capping `max-height` is what
  actually works.
- **Shrinking is only half of it.** `#map` leaves its overflow visible, so its room list spilled 67px
  past the correctly-shortened panel and painted over the bar anyway. The panel has to scroll its own
  overflow.

Measured after the fix, at 820x1100 and 1100x820: map, game frame, footer, last output line and the
live input all clear the bar, and nothing is clipped above. On Parchment the same rule adjusts **zero**
elements, because it pins nothing to the viewport bottom.

### Interop hazard: it overwrites the global `Map`

`js/Map.js` declares `var Map = {…}` at global scope, shadowing the native `Map` constructor. This
breaks *test tooling* rather than the addon: Playwright builds its injected script inside the page and
calls `new Map()`, so on this host nearly every Playwright call fails with `Map is not a constructor`.
`test/e2e/helpers.ts` works around it with `shieldNativeMap()`.

The addon is unaffected **because it never reads a host global** (§0.2) — an incidental but real
vindication of that rule.

---

## The one addon defect real-host testing found

Dispatching `keydown` as well as `keypress` made this host submit an **empty command**, silently
costing the player a turn: it binds its own keydown handler on `<body>`, our keydown bubbled to it, and
it cleared the input field before our keypress could be read. Measured, submitting `east` from the same
room:

| host | keydown+keypress+keyup | keydown only | keypress only |
|------|------------------------|--------------|---------------|
| modern GlkOte / AsyncGlk | delivered | nothing | **delivered** |
| legacy jQuery GlkOte | **EMPTY COMMAND SENT** | nothing | **delivered** |

`fireKey()` therefore dispatches **`keypress` only**, and carries the code on `keyCode`, `which` *and*
`charCode` (a jQuery host derives `which` for keypress from `charCode` and bails on a falsy value).
jsdom could not have caught this: it has no host to collide with. Do not restore `keydown` without new
evidence and a test.

---

## Release-asset layout (plan Unknown U8)

The `dist/web/{web.js,web.css,jquery.min.js,ie.js}` layout the plan assumes is what the **live deploy**
serves, and it is correct. It is **not** what the GitHub *release assets* contain:

| Asset | Contents |
|-------|----------|
| `parchment-for-inform7-2025-01-14.zip` | a flat **legacy** build — `parchment.js`, `main.js`, `zvm.js`, `quixe.js`, `processBase64Zcode` JSONP loading. Not AsyncGlk. |
| `parchment-single-file-2025-01-14.zip` | one self-contained 5 MB `parchment.html` |

So vendor the modern build from the live deploy or from a source build, not from a release asset. Also
note `web.js` is loaded as `type="module"`, which is exactly why the addon can be a plain classic
script loaded afterwards: it never joins the host's module graph.

### Building it from source — two things that stop you

Verified by building it in a container:

- **`--recurse-submodules` is required.** `asyncglk`, `emglken`, `glkote`, `ifvms.js` and `quixe` are
  git submodules; a plain shallow clone builds until it dies on
  `Could not resolve "../upstream/asyncglk/src/index-common.js"`.
- **`npm ci` cannot be used.** Upstream ships no `package-lock.json`, so `npm ci` exits with a usage
  error. Use `npm install`.

A source build is also strictly better than the live deploy's assets: it produces every interpreter —
`bocfel` (Z-machine), `glulxe` and `git` (Glulx), `hugo`, `scare`, `tads` — not just the one.

---

## What the jsdom suite covers (no browser)

Complementary, not a substitute: selector precedence and last-match-wins, all three `inputMode()`
states including a pager hidden by inline style / the `hidden` attribute / a stylesheet class, command
assignment and residue replacement, lossless and idempotent decoration, XSS safety, the word list and
its `localStorage` failure modes, named layouts and the migration from the original single-list key, and
booting against a bare GlkOte DOM with no host scripts at all.

Run `npm test` for the current unit count and `npm run test:e2e` for the browser suite; both are gates in
`sh scripts/ci.sh`. Counts are deliberately not quoted here — they go stale faster than anything else in
this file.
