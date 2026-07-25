# glk-touch

On-screen commands for **GlkOte**-based interactive fiction players — play parser IF by touch, with no
keyboard.

Parser IF means typing a command every turn, which is miserable on a tablet where a software keyboard
covers a third of the screen. `glk-touch` overlays a compass, the common no-argument commands, and an
editable set of verbs onto an existing browser IF player, and makes every word in the story text
tappable — so a whole session needs zero keystrokes.

MIT licensed. **Zero runtime dependencies**, no framework, one plain `<script>` tag.

## Install

Two tags, added before `</body>` and after the host's own scripts:

```html
<link rel="stylesheet" href="glk-touch.css">
<script src="glk-touch.js"></script>
```

That is the whole installation — no module loader, no import map, no host-specific configuration.
Copy `dist/glk-touch.js` and `dist/glk-touch.css` out of a release tag. Full notes, including
per-host specifics and theming, are in [docs/INSTALL.md](docs/INSTALL.md).

## Using it

- **Move:** tap a compass direction, or `Up` / `Down`.
- **Object commands:** tap a verb (`Take`), then tap the object's word **in the story text** — either
  order works, and **✕** cancels. Tapping the word the game actually printed is exact, so there is no
  guessing at nouns.
- **Edit the verbs:** **⚙** adds, removes, or restores the defaults. Saved per browser.

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

Two details worth knowing, both established by testing real builds rather than assumed: the line input
is a **`<textarea>`** in current AsyncGlk (so the selector must not insist on `input.`), and the command
is submitted with a **`keypress` only** — adding `keydown` makes a legacy jQuery-based host clear its
field and submit an empty command. See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
| `.Style_input` | echoed player input — deliberately *not* made tappable |

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
npm test                    # 103 unit tests, vitest + jsdom
npm run test:e2e            # 49 end-to-end tests x (Chromium + WebKit), real hosts
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
