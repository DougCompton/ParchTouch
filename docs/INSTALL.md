# Installing ParchTouch

Two tags in Parchment's page — or Parchmap's, or any other GlkOte-based player's. No build step for
you, no dependencies, no configuration.

> **Not running a player yet?** There is a Docker image that bundles two of them with the overlay
> already installed and serves your own story library — see
> [Run it as a server](../README.md#run-it-as-a-server-docker). This page is for adding the overlay to a
> player you host yourself.

## Any host (generic)

Add **before `</body>`**, after the host's own scripts:

```html
<link rel="stylesheet" href="parch-touch.css">
<script src="parch-touch.js"></script>
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

### Layouts

Vocabularies differ per game, so the word list is not one list — it is a set of named **layouts** you
switch between. Settings has a picker plus a name box:

- **New** creates a layout with that name, starting from a copy of the shipped words, and switches to it.
- **Rename** renames the one in use.
- **Drop** deletes it. The last remaining layout can never be dropped, and **Defaults** restores the
  shipped words for the layout in use only — it leaves your other layouts alone.

Which layout is active is remembered too, so reopening a game comes back to the set you were using.
Everything is stored in the browser under `IFB_Layouts`, per browser and not backed up (there is no
server). A list saved before layouts existed is migrated into a layout called `Default` rather than
being lost.

### Host commands starting with `/`

Some hosts reserve `/name` for their own features — Parchmap uses `/map`, `/help`, `/notes`, `/theme`,
`/goto`, `/see`, `/note`, `/room-notes`, `/clear`, `/quit`. You can add these as buttons like any other
word, and the leading slash is preserved.

**Do not press ↵ for them.** Such a host detects its own commands by watching the input box, so tapping
the button is the whole interaction — the host picks it up within a fraction of a second and clears the
box itself. Pressing ↵ hands the text to the *game* instead, which will just say it does not recognise
the verb.

A few of Parchmap's commands take an argument terminated by a semicolon (`/goto kitchen;`), which you
can finish by tapping a word and then typing the `;` — or add the whole thing as its own button.

**Word list** (middle) — one editable list holding both the no-object commands (`look`, `inventory`,
`again`, `undo`, `save`, `restore`, …) and the verbs that take an object (`take`, `examine`, `open`, …).
A tap **stages** text into the input box without sending it; press **↵** to send.

Every tap **appends a word to the end**, in tap order, so the length of a command is not limited to
two words:

- No object needed: tap `Look`, then **↵**.
- With a **direction** as the object: tap `Look`, then a compass button — that is sent at once, so
  `Look` then `N` sends `look north`. Directions never need **↵**; they always finish the command.
- With an object: tap `Take`, then the object's word **in the story text**, then **↵**.
- With a preposition: `Unlock` → "door" → `With` → "key" → **↵** sends `unlock door with key`. Add
  `with`, `at`, `in`, `on`, `to`, `under` and friends to your word list once and every such command is
  reachable by tapping.
- **Tap order is literal.** Earlier versions of this addon paired a verb and a noun in either order;
  that had to go to allow commands longer than two words, since a third tap has no unambiguous slot
  to fill. Tap the verb first. Tapping "lamp" then `Examine` now stages `lamp examine`.
- The list scrolls when it does not fit. The bar is never taller than three buttons.

**Actions** (right, stacked) — none of them sends a command, so all act immediately:

- **⌫** removes the last word tapped, leaving the rest of the command alone.
- **✕** clears the command being built entirely.
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
