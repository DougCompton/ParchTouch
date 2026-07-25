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

- Compass + Up/Down: one tap each.
- `Look`, `Inv`, `Wait`, `In`, `Out`, `Again`, `Undo`, `Save`, `Restore`: one tap each.
- **Object commands:** tap a verb (`Take`), then tap the object's word **in the story text**. Either
  order works. **✕** cancels an armed verb.
- **⚙** edits the verb buttons (add / remove / restore defaults). Saved per browser.

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
