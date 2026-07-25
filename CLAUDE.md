# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`glk-touch` — a touch command overlay (compass, no-argument commands, editable verb buttons, tappable
story words) injected into an existing **GlkOte**-based browser interactive-fiction player via two
tags. Zero runtime dependencies, no framework, ES2018 IIFE bundle. MIT.

Read [README.md](README.md) for user-facing behaviour and
[2026-07-24-glk-touch-addon.md](2026-07-24-glk-touch-addon.md) — the full implementation plan (§0 is
the cold-start briefing; phases and numbered tasks are referenced by commit messages and by code
comments such as "see Task 5.1").

## Commands

```bash
npm test                    # vitest + jsdom. Do NOT pass --pool=threads (see below)
npm test -- test/dom-glue.test.ts          # one file
npm test -- -t 'inputMode'                 # one describe/it by name
npm run test:watch
npm run typecheck           # tsc --noEmit — esbuild strips types but never checks them
npm run lint:independence   # grep gate: fails if src/ names a specific host
npm run build               # dist/glk-touch.js + dist/glk-touch.css
npm run dev                 # esbuild --watch (also emits a git-ignored .map)
npm run test:e2e            # playwright: (chromium + webkit) against REAL hosts
npx playwright test --project=webkit parchmap.spec        # one project + one spec
npx playwright test -g 'MAP UPDATES'                      # one test by name
sh scripts/ci.sh            # every gate, fail-fastest order — this is the release gate
```

`build`, `lint:independence` and `ci` shell out to `sh`. On Windows run them from **Git Bash or WSL**;
`sh` is not on PATH in PowerShell or cmd. The Bash tool here is Git Bash, so it can run them.

## Non-negotiable constraints

These are architectural contracts, not preferences — breaking one breaks the product or the release.

1. **Host-agnostic (plan §0.2).** The addon attaches to GlkOte's DOM contract and nothing else. Never
   read another application's globals or ids, never branch on "which host am I in?". Feature-detect
   the *capability* (`MAP_SELECTORS`, "is there a line input?"). A missing feature disables only
   itself — degrade, never throw. It must run in a page with no other application scripts at all;
   `test/dom-glue.test.ts` → `describe('host independence')` and `scripts/check-independence.sh`
   enforce this.
2. **`dist/` is committed on purpose.** A downstream deployment copies `dist/glk-touch.js`,
   `dist/glk-touch.css`, `LICENSE` and `docs/COMPATIBILITY.md` straight out of a git tag — no npm
   registry. `scripts/ci.sh` fails on `git status --porcelain -- dist/`, so **rebuild and commit
   `dist/` in the same change as any `src/` edit**.
3. **The bundle must stay a classic script.** `scripts/ci.sh` greps `dist/` for `import`/`export`;
   hosts load it with a bare `<script src>`.
4. **Browser floor is ES2018** (Chrome 64+, Safari 11.1+, Firefox 78+, Edge 79+), set by Unicode
   property escapes `/\p{L}/u` so accented and non-English nouns are tappable. Do not reach for newer
   DOM APIs — e.g. `renderEditor()` uses a `removeChild` loop rather than bulk child replacement
   precisely because the latter needs Safari 14+.
5. **`docs/COMPATIBILITY.md` is a deliverable, not a note.** A downstream deployment consumes it. It
   is now filled in from automated real-host runs; keep it in step with what `npm run test:e2e`
   actually proves. Still outstanding: a physical tablet (plan Task 5.3).
6. **Submit with `keypress` ONLY.** `fireKey()` deliberately dispatches no `keydown`/`keyup`. Adding
   `keydown` makes a legacy jQuery-based GlkOte clear its input field and submit an **empty** command,
   silently costing the player a turn — its own body-keydown handler runs before our keypress can be
   read. `keypress` alone is delivered by both a modern AsyncGlk host and a legacy one. The measurement
   table is in the `fireKey()` comment; jsdom cannot catch this, only the e2e suite can.

## Architecture

Two source files, split so the interaction rules are testable without a browser:

- [src/command-model.ts](src/command-model.ts) — **pure logic core.** No DOM, no globals, no side
  effects. Immutable `CommandState`; every tap returns a new state plus a command to send or `null`
  when the tap only *armed* something. Verb/noun pairing works in either order; tokenizing is
  lossless (concatenating `Token.text` reproduces the input); length and verb-count caps live here.
- [src/if-buttons.ts](src/if-buttons.ts) — **all DOM/GlkOte contact**, the bar UI, verb persistence,
  boot. esbuild bundles it (entry point) plus the model into one IIFE.
- [src/if-buttons.css](src/if-buttons.css) — themeable via `--ifb-*` custom properties overridden
  from the embedding page; `.ifb-host-map` / `.ifb-map-collapsed` on `<html>` drive map compaction.

`window.IFButtons` is a **console debugging handle only** (the troubleshooting table in
`docs/INSTALL.md` tells users to call `IFButtons.inputMode()`). Internal calls use ESM imports.

### The GlkOte contract — the entire integration surface

| Hook | Used for |
|------|----------|
| `.BufferWindow` | MutationObserver root, click-delegation host, bottom padding |
| `.BufferLine` | unit of word tokenization (`data-ifb-done` marks it processed) |
| `.Input.LineInput`, else bare `.Input` | command submission, and the positive test for line mode. **Current AsyncGlk uses a `<textarea>`, and emits a bare `.Input` alongside it** — so the selector must not insist on `input.` |
| `.MorePrompt` | paging indicator — dismissed before submitting |
| `.Style_input` | echoed player input — deliberately *not* made tappable |

Behaviours that look incidental but are load-bearing (each has tests):

- **`inputMode()` gates every send.** `more` → dismiss the pager and refuse; `char` → dispatch a
  space keypress to `.BufferWindow` and refuse; `line` → deliver. `submitCommand()` returns `true`
  only on actual delivery and **never silently drops a command**.
- **`.MorePrompt` visibility, not presence.** Some hosts keep the element and toggle it; treating a
  hidden one as active would deadlock input forever. `isVisible()` avoids `offsetParent` (always null
  in jsdom) on purpose.
- **The live line input is the *last* match** — hosts leave earlier turns' inputs in the DOM.
- **Click delegation is installed on `.BufferWindow`, not `document`.** The listener must die with
  the module instance; a document-level one would outlive a reload and double-submit. `data-ifb-*`
  attributes keep re-entry idempotent.
- **Story text only ever goes through text sinks** (`textContent`, `createTextNode`) — never an
  HTML-parsing sink.
- **`localStorage` (`IFB_Verbs`) access is always wrapped in try/catch** and degrades to
  `DEFAULT_VERBS` on throw, corrupt data, or non-array data.
- **`submitCommand` assigns the field value, never appends,** and does not clear-then-write (the
  extra empty `input` event can trip a host's autocomplete).
- **The Enter code is carried on `keyCode`, `which` AND `charCode`.** A jQuery host derives `which` for
  keypress from `charCode` and bails on a falsy value, so all three must agree.

### Vitest config quirk — do not "simplify" it

[vitest.config.ts](vitest.config.ts) conditionally forces `pool: 'forks'` with
`--no-experimental-webstorage` when it detects Node's built-in Web Storage shadowing jsdom's. Without
it, 11 verb-persistence tests either crash or — worse — pass **vacuously**, because two of them spy on
`Storage.prototype`. An explicit `--pool=threads` on the command line overrides the config and breaks
them; use plain `npm test`.

## Local harness (real-host verification)

`harness/` runs real Parchment and Parchmap against the **built bundle** (never the ESM sources), so
"works in dev, broken in dist" cannot happen. Vendored hosts (`harness/vendor/`) and story files
(`harness/stories/*`) are git-ignored — fetch them per [harness/README.md](harness/README.md), and
turn Parchmap's `GA_TRACK` off before serving anything offline.

Serve it either way — the URL-prefix mapping is identical and must be kept in sync between the two:

```bash
cd harness && docker compose up          # nginx, harness/nginx.conf
node scripts/serve-harness.mjs [port]    # dependency-free equivalent, default 8080
```

`harness/parchment/play.html` is committed; the Parchmap page needs its two tags added inside the
git-ignored `vendor/` tree, so no modified host is ever committed.

### End-to-end suite ([test/e2e/](test/e2e/))

Three specs, run in Chromium **and WebKit** (iOS Safari's engine family — the tablet is the point):

- `synthetic-glkote.spec.ts` — [harness/synthetic/glkote.html](harness/synthetic/glkote.html), a
  dependency-free page implementing only the GlkOte contract with no other scripts. Always runs. It is
  where char-input and pager states get **deterministic** coverage (a real game will not produce them
  on demand) and the executable form of the "works with no host application" claim.
- `parchment.spec.ts` / `parchmap.spec.ts` — real hosts, real story. **Skip themselves** when
  `harness/vendor/` is absent, so a fresh clone stays green.

Gotchas, all handled in [test/e2e/helpers.ts](test/e2e/helpers.ts):

- **Parchmap overwrites the global `Map`** (`var Map = {…}`), which breaks Playwright itself — its
  injected script calls `new Map()`. `shieldNativeMap()` must run *before* `goto()`. The addon is
  immune because it never reads a host global, which is rather the point of §0.2.
- **A pager can consume the first tap** on a legacy host, and whether one appears depends on font
  metrics — WebKit paginates where Chromium does not. `ensureLineMode()` drains it so tests start from
  a real line prompt. This is correct addon behaviour, not a bug.
- Real-host describes are `mode: 'serial'` and `workers` is capped at 3: each boots a >1MB wasm
  interpreter, and the default worker count starves them into timeouts.
- E2E serves `dist/`, so **`npm run build` must precede it** — `scripts/ci.sh` orders it that way.
