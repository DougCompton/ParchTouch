# Verified hosts

> ## ⚠ STATUS: NOT YET VERIFIED — DO NOT PIN A RELEASE AGAINST THIS FILE
>
> Every `<placeholder>` below is still unfilled. Nothing in this file has been observed against a
> running host yet: the checks require a browser, the two vendored hosts, a story file and a physical
> tablet, none of which the automated implementation pass could provide.
>
> This file is a **deliverable**, not a note — a downstream deployment depends on the answers here
> (see §0.3 of the plan). Fill it in by running the plan's **Phase 5** (Parchment) and **Phase 6**
> (Parchmap) checklists against `harness/`, then delete this banner.
>
> `Task F.5` of the plan fails while any `<placeholder>` remains.

| Host | Version / commit | Verified | `.Input.LineInput`? | Notes |
|------|------------------|----------|---------------------|-------|
| Parchment | `<tag>` | `<date>` | `<yes/no>` | reference host; MIT; AsyncGlk |
| Parchmap | `<sha>` | `<date>` | yes | GPL-3.0; also provides a map |

## Parchment (AsyncGlk)

- `inputMode()` observed behaviour: `<observed>`
- `.MorePrompt` lifecycle: **`<destroyed on dismiss / kept and hidden>`** — if kept and hidden, the
  `isVisible()` guard in `if-buttons.ts` is load-bearing; do not remove it.
- Tablet pass (device / OS / browser): `<result>`

## Parchmap

- Map updates from addon-submitted commands: `<PASS/FAIL + how verified>`
- Input-buffer collision with its `Input.js`: `<PASS/FAIL>`
- Map container selector matched by `MAP_SELECTORS`: `<selector>`
- Story format accepted: `<raw / .js-wrapped>`; wrapper function: `<name or n/a>`
- `?story=` accepts a path outside `games/`: `<yes/no>`

---

## What HAS been verified (automated, jsdom — not a real host)

These are covered by the 101-test suite (`npm test`) against jsdom, and by `tsc --noEmit`. They are
evidence about the addon's own logic, **not** about any real host's DOM:

- `.Input.LineInput` preferred over bare `.Input`; last match wins when several exist; bare `.Input`
  accepted as a fallback when a build omits the `LineInput` class.
- `inputMode()` returns `more` / `line` / `char` correctly, and treats a `.MorePrompt` that is hidden
  by inline `display:none`, by the `hidden` attribute, or by a stylesheet class as **not** showing —
  so a host that keeps the element and toggles visibility cannot deadlock input.
- `submitCommand()` assigns (never appends to) the field, fires an `input` event, then
  `keydown`/`keypress`/`keyup` with `keyCode` 13; returns `true` only on actual delivery.
- In `char` mode a space keypress (`keyCode` 32) is dispatched to `.BufferWindow` instead, and the
  command is refused rather than silently dropped.
- Story text is never parsed as HTML; echoed input (`.Style_input`, on a span or on the line itself)
  is never made tappable; decoration is lossless and idempotent.
- Verb list persists to `localStorage` under `IFB_Verbs`, and degrades to defaults on corrupt data,
  non-array data, or storage that throws on read or write.
- The addon boots against a bare GlkOte DOM with **no** host scripts present, and adds map-related
  behaviour only when a map element is actually found.
