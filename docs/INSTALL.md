# Installing glk-touch

Two tags in any GlkOte-based player's page. No build step for you, no dependencies, no configuration.

## Any host (generic)

Add **before `</body>`**, after the host's own scripts:

```html
<link rel="stylesheet" href="glk-touch.css">
<script src="glk-touch.js"></script>
```

Order matters: the host must have created its `.BufferWindow` before the bar can attach. The addon
polls for up to 20 seconds, so loading it last is enough.

## Parchment

Add the two tags after `web.js`. Nothing else changes; `parchment_options` is untouched.

## Parchmap

Add the two tags to `play.html` before `</body>`, after all of Parchmap's scripts. The addon detects
the map panel automatically, compacts the bar, and adds a **⊞** button to collapse the map.

Also recommended when self-hosting Parchmap: set `GA_TRACK = false` in `js/Consts.js` — it ships with
Google Analytics enabled, which phones home and stalls page load when offline.

## Using it

The bar is three parts, left to right.

**Direction pad** — the only buttons that send on the spot:

```
NW   N   NE   Up
W    ↵   E    Down
SW   S   SE   ⚙
```

**↵** sends whatever is in the input box as it stands. It also advances a *press any key* prompt and
dismisses a `-- more --` pager.

**⚙** opens settings. It **replaces the buttons** rather than appearing beside them — the bar is capped
at three button rows, so there is nowhere to add. Its **✕ Close** button gives the buttons back.

In settings you can:

- **Add** a word, or restore the shipped list with **Defaults**.
- **Tap a word to select it**, then **◀** / **▶** to move it or **Delete** to remove it. Tapping only
  selects — nothing is deleted without that second, deliberate press.
- **Drag a word** to a new position, by mouse or by touch.
- Without a pointer: focus a word and use **Alt+← / Alt+→** to move it, or **Delete** to remove it.

Order is not cosmetic — the strip shows three rows and scrolls, so whichever words come first are the
ones reachable without scrolling.

**Word list** (middle) — one editable list holding both the no-object commands (`look`, `inventory`,
`again`, `undo`, `save`, `restore`, …) and the verbs that take an object (`take`, `examine`, `open`, …).
A tap **stages** text into the input box without sending it; press **↵** to send.

- No object needed: tap `Look`, then **↵**.
- With an object: tap `Take`, then the object's word **in the story text** — either order works, so
  tapping the word first and the verb second composes the same command.
- The list scrolls when it does not fit. The bar is never taller than three buttons.

**Actions** (right, stacked) — neither sends a command, so both act immediately:

- **✕** clears the command being built.
- **⊞** hides/restores the map, on a host that has one.

## Theming

Override the custom properties from the embedding page — no need to edit the CSS:

```css
:root { --ifb-bg: rgba(10,10,10,.95); --ifb-armed: #b8860b; }
```

## Troubleshooting

Open the console: `IFButtons.inputMode()`.

| Result | Meaning |
|--------|---------|
| `ReferenceError` | the script did not load — check the path and that it is not blocked |
| `'line'` | ready; a tap should work |
| `'more'` | the host is paging; a tap dismisses the pager, the next one sends |
| `'char'` | the game wants a single keypress, not a command |
