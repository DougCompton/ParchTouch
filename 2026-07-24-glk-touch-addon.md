# glk-touch — Touch Command Overlay for GlkOte IF Players

> **For agentic workers:** REQUIRED SUB-SKILL: Use :execute-plan to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **This plan builds a NEW, SEPARATE git repository from an empty directory.** It is self-contained:
> everything needed is below. A companion plan in a *different* repository (the author's `piansible`
> Ansible repo) deploys the result — you do not need it and must not look for it. The only thing that
> crosses that boundary is the release contract in **§0.3**.

**Goal:** A small, MIT-licensed addon with **zero runtime dependencies** that puts on-screen commands (compass,
no-argument commands, verb buttons, tap-a-word-for-nouns) over **any GlkOte-based** interactive-fiction
player, so parser IF is playable on a tablet with no keyboard — working equally in plain **Parchment**
and inside **Parchmap** (where it must coexist with the auto-map).

**Architecture:** **TypeScript ESM source, classic-script bundle.** A **pure logic core**
(`src/command-model.ts` — command pairing, tokenizing, verb-list rules; no DOM) is imported by a **DOM
glue layer** (`src/if-buttons.ts`) that touches only GlkOte's documented contract (`.BufferWindow`,
`.BufferLine`, `.Input.LineInput`, `.MorePrompt`, `.Style_input`), plus a stylesheet. The split is what
makes the interaction rules unit-testable without a browser. esbuild bundles the modules into a single
**IIFE** (`dist/glk-touch.js`), so a host installs it with one plain `<script>` tag — no module loader,
no import map, nothing for the host page to configure. **No runtime dependencies, no framework.** The
addon **never references a specific host** — everything host-specific is feature-detected — so Parchmap
is an *optional* host, never a dependency.

**Tech Stack:** **TypeScript 5.x** (strict) compiled to **ES2018** · esbuild (bundler) · Vitest 2.x +
jsdom (tests) · Node 20+ · MIT licence. Browser floor: Chrome 64+, Safari 11.1+, Firefox 78+, Edge 79+
(set by Unicode property escapes, `/\p{L}/u`, used so accented nouns are tappable).

**Test Runner:** vitest — command: `npm test` (`vitest run`)

---

## §0 Read This First — Full Context for a Cold Start

You are starting in an **empty directory** with no prior conversation. This section is the whole
background; nothing else is required.

### §0.1 What you are building, and why it exists

**Interactive fiction** (IF, "text adventures" — *Zork*, *Trinity*, modern Inform games) is played by
typing commands at a prompt: `go north`, `take lamp`, `examine brass door`. The player types every
turn. That is fine with a keyboard and miserable on a **tablet**, where a software keyboard covers a
third of the screen and you are typing constantly.

**Parchment** is a browser IF interpreter — you can self-host it and play story files in a web page. It
has **no on-screen commands**. **Parchmap** is another browser IF app (it bundles an older Parchment
core) that adds an automatic map, notes and route-finding; its "autocomplete" is **Tab-key** driven, so
it needs a keyboard too. Native mobile IF apps *do* have command buttons, but they cannot read a
server-side story library.

**So this addon fills the gap:** an overlay that adds a compass, common commands and verb buttons to an
existing browser IF player, and makes every word in the story text tappable so you can build
`take lamp` with two taps. The goal is a **full session with zero keystrokes** on a tablet.

**Who uses it:** the author self-hosts a Z-machine story library on a home server and wants to play it
on a tablet from the couch. It is published MIT so it is useful to anyone running a GlkOte-based player.

### §0.2 The one architectural rule: host-agnostic

The addon attaches to **GlkOte**, the display layer that *both* Parchment and Parchmap use — never to a
specific application. This is not stylistic; it is the property that makes the addon independently
useful and keeps its licence clean.

**Therefore, non-negotiably:**
- **Never** read another application's globals or DOM ids (`Global`, `Input`, `Map`, `Consts`,
  `Parchmap`, `GameList`, `Navigator`, `Autocomplete`, `parchment_options`, …).
- **Never** branch on "which host am I in?". Feature-detect the *capability* instead ("is there a map
  element?", "is there a line input?").
- The addon must run correctly in a page where **no other application scripts exist at all** — there
  are tests for exactly this.
- A missing feature disables only itself. **Degrade, never throw.**

A shell gate (Phase 7) fails the build if a host-specific identifier appears in the source.

### §0.3 Release contract — what a downstream deployment consumes

A separate deployment (in another repository) vendors this addon at a **git tag** and copies:

| Artifact | Purpose |
|----------|---------|
| `dist/glk-touch.js` | the bundled classic script (one `<script src>` tag) |
| `dist/glk-touch.css` | the stylesheet (one `<link>` tag) |
| `LICENSE` | MIT text, shipped alongside so the licence travels with the files |
| `docs/COMPATIBILITY.md` | **verified findings** the deployment depends on — see below |

`docs/COMPATIBILITY.md` is a **deliverable, not a note**. The deployment specifically needs these
answers, produced in Phases 5–6:

1. Does Parchment's current build emit `.Input.LineInput`, or only `.Input`?
2. Does the map in a map-providing host stay in sync when *the addon* submits a command?
3. Does a map-providing host's own input handling collide with the addon's?
4. For Parchmap's older core: does it load **raw** story files (`zork1.z5`) or require **legacy
   JS-wrapped** ones (`zork1.z5.js`)? If wrapped, what is the wrapper function's name? Does its
   `?story=` parameter accept a relative path outside its own `games/` directory?

Answer 4 changes how the deployment serves the story library, so record it precisely even though it is
not about the addon's own code.

### §0.4 Decisions already taken — do not re-litigate

Settled with the author before this plan was written.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **MIT licence** | It must be reusable by anyone. MIT is also **GPL-compatible**, so a deployment may legally combine it with the GPL-3.0 Parchmap: that *combination* is conveyed under GPL-3.0 while these files stay MIT. **Do not make this repo GPL** "to match" Parchmap — that would defeat the point. |
| D2 | **Verb + tap-a-word** for object commands | Rejected: auto-detecting nouns from prose (the native-app approach) — unreliable across arbitrary IF writing. Tapping the *actual* word the game printed is exact and needs no guessing. |
| D3 | **Sensible default verbs, user-editable** (add / remove / reset, persisted) | Vocabularies differ per game. Rejected for v1: extracting verbs from the story file's Z-machine dictionary — feasible but caveat-heavy (words are stored truncated, e.g. `examin`; flag conventions are Inform-specific and most classics are ZIL). Future work that would *populate* this editable list. |
| D4 | **Support both Parchment and Parchmap**, one codebase | Parchmap brings the map; Parchment brings the current, maintained interpreter. Same GlkOte contract, so one addon serves both — §0.2. |
| D5 | **TypeScript source, IIFE bundle** | Modern Parchment and AsyncGlk (the current GlkOte) are both TypeScript, so this is ecosystem-idiomatic; and this code is null-heavy DOM integration, where `strict` mode catches real bugs. Hosts still get one plain `<script>`. |
| D6 | **No framework** | The addon injects into *someone else's* page: a framework would mean bundle bloat and fighting the host for DOM ownership. Vanilla DOM only. **jQuery is present in both hosts but must stay optional** — a GlkOte host need not ship it, so it may only ever be used behind a feature check. |
| D7 | **Persistence is `localStorage`** | No server, no backend. Consequence the author accepted: verb customisations are per-browser and not backed up. |
| D8 | **Never fork a host** | Rejected: forking Parchment (a real project, `parchment-speech`, does this) — inherits merge burden forever for what is purely an additive UI layer. |

### §0.5 Glossary

| Term | Meaning |
|------|---------|
| **Parser IF** | Interactive fiction driven by typed commands, as opposed to choice/hyperlink fiction. |
| **Story file** | A compiled game. Z-machine story files use extensions `.z1`–`.z8`; **Blorb** packages (story + graphics/sound) use `.zblorb`, `.zlb`, `.blb`. These are the extensions the addon's docs treat as playable. |
| **Z-machine** | The virtual machine Infocom used and Inform still targets; the format of these story files. |
| **Glk** | The standard I/O abstraction for IF interpreters (windows, text styles, line/char input). |
| **GlkOte** | The **JavaScript/DOM implementation of Glk** — it renders the game into HTML and collects input. **This is the addon's only integration surface.** |
| **Line input vs char input** | Glk games ask either for a whole typed line (`> take lamp`) or a **single keypress** ("press any key to continue"). In char mode there is *no input field at all*, so a line command sent then is silently discarded. Handling this correctly is the single most important behaviour in the addon. |
| **`.MorePrompt`** | GlkOte's paging indicator. While it shows, output is paused and input is swallowed — it must be dismissed before a command will land. |
| **AsyncGlk** | The newer, TypeScript GlkOte implementation used by current Parchment. May differ in emitted CSS classes — hence §0.3 question 1. |
| **ZVM / Quixe** | Z-machine and Glulx interpreter engines. Parchmap bundles both. Irrelevant to the addon beyond being what makes a host a host. |
| **Armed** (addon term) | A verb (or word) tapped and waiting for its partner, shown highlighted. Tapping the partner sends the pair. |

---

## Project Analysis

Greenfield repository, so the analysis is of the **integration targets**, not existing code.

- **Frameworks & Versions:** none in the product (D6). Dev-only: TypeScript 5.x, esbuild 0.24.x,
  Vitest 2.x, jsdom 25.x.
- **Language:** **TypeScript**, `strict` plus `noUncheckedIndexedAccess`, compiled to **ES2018**. esbuild
  strips types but does **not** typecheck, so `tsc --noEmit` is a separate, required gate. The feature
  that sets the ES2018 floor is **Unicode property escapes** (`/\p{L}/u`), used so accented nouns
  (*café*) and non-English IF are tappable; there are tests for this.
- **Database & ORM:** none. All persistence is the browser's `localStorage`.
- **UI & Styling:** hand-written CSS with custom properties. No framework, no preprocessor.
- **Authentication:** none — it is a client-side overlay.
- **Key Architectural Patterns:**
  - **Pure core / imperative shell** — `command-model.ts` is total functions returning new state;
    `if-buttons.ts` owns all DOM and side effects.
  - **Feature detection over host detection** — never "am I in Parchmap?", always "is there a map
    element / a line input / a More prompt?".
  - **Degrade, never throw** — a missing selector disables one capability, leaving the rest working.
  - **ESM source, IIFE distribution** — modules with named exports for clean testing and no globals
    between our own files; esbuild emits one classic script. `window.IFButtons` is assigned at runtime
    but **only as a console debugging handle** (the troubleshooting docs use it) — never as the
    interface between our own modules.
- **Integration Targets:**
  - **Parchment** — <https://github.com/curiousdannii/parchment>, MIT, **TypeScript**. Modern build
    serves `index.html` + `dist/web/{web.js,web.css,jquery.min.js,ie.js}`; DOM anchors `#gameport`,
    `#windowport`; config via the `parchment_options` global (`default_story`, `lock_story`,
    `lock_options`, `page_title`) set **before** its scripts load. Display layer is **AsyncGlk**
    (<https://github.com/curiousdannii/asyncglk>, "A Typescript Glk library").
  - **Parchmap** — <https://github.com/roylaza/Parchmap>, **GPL-3.0**, plain JS + **jQuery**, last push
    2024-07-09. Bundles the *legacy* Parchment core (`lib/main.js`, `zvm.js`, `quixe.js`) + jQuery +
    slimscroll. Its `js/Input.js` is the reference implementation of the technique this addon uses.
    `play.html` takes a **`?story=`** parameter. Persists to `localStorage` (`PM_Prefs`, `PM_Save_*`).
    Ships `GA_TRACK = true` (Google Analytics) — the harness turns it off, see Phase 4.
  - **GlkOte** — the display layer both use; its DOM contract is this addon's only real dependency.
- **Current State:** nothing exists. No repo, no code, no tests.

---

## Problem Statement

Parser interactive fiction requires typed commands, which makes it painful on a tablet. No
self-hostable IF interpreter provides on-screen command buttons: Parchment has none, and Parchmap's
autocomplete is Tab-key driven. The one class of software that does — native mobile apps like Text
Fiction — cannot read a server-side library.

---

## Success Criteria

- [ ] Adding **two tags** (`dist/glk-touch.css`, `dist/glk-touch.js`) to a GlkOte page yields a working
      command bar — a **plain classic script**, no module loader, **no runtime dependencies**, no
      host-specific configuration.
- [ ] A full turn — movement, `look`/`inventory`, and a verb+noun action — is possible **by tapping
      only**, with zero keystrokes.
- [ ] Tapping a verb then a word in the story text sends `<verb> <word>`; the reverse order is identical
      in effect.
- [ ] The addon **never drops a command silently**: it detects line-input, char-input ("press any key")
      and `.MorePrompt` paging states and does the right thing in each.
- [ ] Works in **plain Parchment with Parchmap absent entirely**, and inside **Parchmap** where the
      auto-map still updates correctly from overlay-submitted commands.
- [ ] Contains **no reference to any host** in its source — enforced by a grep gate.
- [ ] The verb set ships sensible defaults and is **user-editable** (add/remove/reset), persisted.
- [ ] Story text is treated as untrusted: no markup from prose or from a stored verb can ever be parsed
      as HTML.
- [ ] `npm test` green and `tsc --noEmit` clean, with every applicable edge case covered.
- [ ] A tagged release ships a `dist/` a downstream deployment can pin, plus the §0.3 findings.

---

## Integration Research Findings

The load-bearing knowledge for this addon. Verified against upstream sources (cited at the end).

### A. GlkOte — the only contract this addon depends on

| Hook | Detail | Used for |
|------|--------|----------|
| `.BufferWindow` | host element for scrolling text output | MutationObserver root; bottom padding so the bar doesn't cover text |
| `.BufferLine` | one output line, `white-space: pre-wrap` | unit of word tokenization |
| `input.Input.LineInput` | the `<input>` GlkOte creates for **line** input; the `LineInput` class marks line (not char) mode | **command submission** (set `.value`, fire `input`, simulate Enter) and the *positive* test for line mode |
| `input.Input` | same element on builds that omit `LineInput` | fallback selector |
| `.MorePrompt` | paging indicator — **output is blocked** until dismissed | must be dismissed *before* submitting, else the command is swallowed |
| `.Style_input` | echoed player input | must **not** be tappable; also the channel hosts read to track history |
| `.Style_*` | Glk style classes (normal/emphasized/preformatted/header) | avoid decorating non-prose |
| `GlkOte.extevent(val)` | documented external-event injection | fallback command path if no DOM input exists |
| `Game.accept({type:'line', gen, window, value, terminator})` | the VM's input acceptor | shape of a protocol-level command (fallback) |
| `GlkOte.update()` | VM→display updates incl. per-window input specs (`char`/`line`/`hyperlink`) | how a host knows line vs char mode |
| `recording_handler` | serialises "every command (input and output)" | future automap-style features |

**Why the DOM route is primary, not the protocol:** driving `input.Input` needs no generation/window
bookkeeping and does not break when the protocol version changes. `GlkOte.extevent()` is documented as
the fallback.

**Critical behavioural consequence:** the game is not always awaiting a typed line. On **char input**
there is no `input.Input` at all — a line command sent then does nothing. This is the single most likely
cause of "I tapped and nothing happened", and is covered by dedicated tests.

### B. Parchment — the reference host

| Fact | Consequence |
|------|-------------|
| **MIT** licensed, TypeScript | freely embeddable in a dev harness and in downstream deployments |
| Serves `index.html` + `dist/web/{web.js,web.css,jquery.min.js,ie.js}` | the harness (Phase 4) vendors exactly these |
| `parchment_options` global — `default_story`, `lock_story`, `lock_options`, `page_title` — set **before** its scripts | how the harness loads a story without user interaction |
| DOM anchors `#gameport`, `#windowport` (GlkOte renders here) | the addon attaches to `.BufferWindow` *inside* `#windowport` and appends its bar to `<body>` — Parchment's layout is untouched |
| Won't run from `file://` | the harness must serve over HTTP |
| CORS proxy used **only** for cross-domain stories | same-origin stories in the harness ⇒ no external calls |
| Uses **AsyncGlk** | ⚠️ **unverified**: whether AsyncGlk emits `.Input.LineInput` or only `.Input`. The fallback selector covers it; **Phase 5** verifies empirically |

### C. Parchmap — the second host (optional, GPL-3.0)

| Fact | Consequence |
|------|-------------|
| **GPL-3.0**, created 2024-04-21, last push 2024-07-09, 28 commits, not a fork | usable as a *host* to test against. This addon stays **MIT** — MIT is GPL-compatible, so a downstream deployment may combine them (the combination is conveyed under GPL-3.0; these files remain MIT) |
| `js/Input.js`: `$(".Input.LineInput").val(... + text)` then `$.Event("keypress", {which: 13})`; reads history via `$(".Style_input").get().reverse()` | **independent production confirmation of this addon's technique.** Also the source of the `.Input.LineInput` selector and the "don't decorate `.Style_input`" rule — both **interface facts**, not copied code |
| `js/Input.js` **appends** to the field and clears via `Input.Clear()`; we **assign** `.value` | ⚠️ possible collision → **Phase 6** gate |
| Map is built by reading echoed `.Style_input` from the DOM | ⚠️ so it *should* update from overlay-submitted commands — but if it *also* hooks its own input handler, the map would silently desync → **Phase 6** gate, the highest-risk unknown in this plan |
| `js/Directions.js` is a **parsing table only** (12 directions incl. in/out, `Opposite` links) — no event listeners, no buttons | Parchmap has **no** on-screen commands; this addon is what makes it touch-playable |
| `js/GameList.js` is a **hardcoded array**; `Filename`s look like `moonglow.z3.js` | suggests legacy JS-wrapped stories; verified in **Phase 6**, Task 6.3. Deployment consequence belongs to the companion plan |
| `Consts.js`: `lib_path='lib/'`, `?story=` via `Global.GetUrlParameter("story")`, **`GA_TRACK = true`** | the harness sets `GA_TRACK = false` — Analytics would make external calls during local testing and in any LAN deployment |
| Persists to `localStorage` (`PM_Prefs`, `PM_Save_*`, GameId-keyed) | no server needed to test it; **our** key `IFB_Verbs` must not collide (it doesn't) |
| Globals: `Global`, `Consts`, `Input`, `Map`, `Navigator`, `Autocomplete`, `Parchmap`, `Message`, `GameList`, `Directions`, `MainMenu` | our only global is `window.IFButtons` (debug handle) — **no collision**, and we must never read theirs |

### D. Host-agnostic design — binding rules

| Rule | Enforcement |
|------|-------------|
| **Zero references to any host** — never read `Global`, `Input`, `Map`, `Consts`, `Parchmap`, `GameList`, `Navigator`, `Autocomplete`, `parchment_options`, or host-specific DOM ids | grep gate `scripts/check-independence.sh` (written in Task 7.2, run by Task F.3); must run with Parchmap absent |
| **Depend only on GlkOte's contract** (§A) | present in every GlkOte host — this is what makes it portable |
| **Feature-detect, never assume** — a map panel, a theme, jQuery are all optional | `ifb-host-map` applied only when a map element is found |
| **Degrade, never throw** | tests: null root, no input, blocked storage, corrupt storage |
| **No host-specific forks of these files** | one bundle serves every host |

---

## Repository Structure

```
Create: LICENSE                          — MIT, Copyright (c) 2026 Doug Compton
Create: README.md                        — what it is, install, interaction, verified hosts, dev
Create: .gitignore                       — node_modules/, harness/vendor/, stories
Create: package.json                     — devDeps (typescript, esbuild, vitest, jsdom); no runtime deps
Create: tsconfig.json                    — strict, target ES2018, DOM lib, noEmit
Create: vitest.config.ts                 — jsdom environment
Create: src/command-model.ts             — PURE command/verb logic + shared types (no DOM)
Create: src/if-buttons.ts                — DOM glue: GlkOte hooks, observer, bar, verb editor
Create: src/if-buttons.css               — bar + tappable-word styling, touch sizing, host-map compaction
Create: test/command-model.test.ts       — unit tests, pure logic (Phase 0)
Create: test/dom-glue.test.ts            — unit tests, DOM via jsdom (Phase 0)
Create: harness/README.md                — how to run the two real hosts locally
Create: harness/docker-compose.yml       — nginx serving both hosts, src, dist and a story
Create: harness/nginx.conf               — static server + JSON story index
Create: harness/parchment/play.html      — minimal Parchment page + the addon
Create: harness/stories/.gitkeep         — story files are NOT committed (see README)
Create: dist/glk-touch.js                — COMMITTED build output: esbuild IIFE bundle
Create: dist/glk-touch.css               — COMMITTED build output: copy of src/if-buttons.css
Create: scripts/build.sh                 — esbuild: TS ESM -> dist IIFE bundle + CSS
Create: scripts/check-independence.sh    — gate: no host-specific identifiers in src/
Create: scripts/ci.sh                    — forge-agnostic gate runner (typecheck, test, gates, build)
Create: docs/INSTALL.md                  — copy-paste install for Parchment, Parchmap, generic GlkOte
Create: docs/COMPATIBILITY.md            — verified hosts, versions, findings (a DELIVERABLE, see §0.3)
```

**`dist/` is committed deliberately.** There is no npm registry in the consuming environment: the
deployment copies `dist/` straight out of a git tag. The `dist`-currency gate in `scripts/ci.sh`
(Task 7.3, run by Task F.4) enforces that the committed bundle matches `src/`, so it cannot drift.

**Not committed:** story files (copyright), vendored hosts, `node_modules/`.

---

## Phase 0: Repository Scaffold + Failing Tests

**Goal:** Stand up the repo and write ALL failing tests before any implementation.

### Tasks

- [x] **Task 0.1: Initialise the repository**

  ```bash
  mkdir glk-touch && cd glk-touch
  git init
  mkdir -p src test harness/parchment harness/stories scripts docs dist
  touch harness/stories/.gitkeep
  ```

  File: `package.json`

  ```json
  {
    "name": "glk-touch",
    "version": "0.1.0",
    "description": "On-screen command buttons for GlkOte-based interactive fiction players — play parser IF by touch, no keyboard.",
    "license": "MIT",
    "author": "Doug Compton",
    "type": "module",
    "files": ["dist", "src", "LICENSE", "README.md", "docs"],
    "scripts": {
      "typecheck": "tsc --noEmit",
      "test": "vitest run",
      "test:watch": "vitest",
      "build": "sh scripts/build.sh",
      "dev": "esbuild src/if-buttons.ts --bundle --format=iife --target=es2018 --sourcemap --outfile=dist/glk-touch.js --watch",
      "lint:independence": "sh scripts/check-independence.sh",
      "ci": "sh scripts/ci.sh"
    },
    "devDependencies": {
      "esbuild": "^0.24.0",
      "jsdom": "^25.0.1",
      "typescript": "^5.6.0",
      "vitest": "^2.1.8"
    }
  }
  ```

  `"type": "module"` makes source and tests ES modules — that is what lets the tests import named
  exports directly. Hosts never load the ESM/TS sources; they load the IIFE bundle esbuild produces
  (Phase 7), which is why the only runtime artifact has no imports at all.

  File: `tsconfig.json`

  ```json
  {
    "compilerOptions": {
      "target": "ES2018",
      "lib": ["ES2018", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "moduleResolution": "bundler",
      "strict": true,
      "noUncheckedIndexedAccess": true,
      "noImplicitReturns": true,
      "noFallthroughCasesInSwitch": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "verbatimModuleSyntax": true,
      "isolatedModules": true,
      "skipLibCheck": true,
      "noEmit": true
    },
    "include": ["src", "test", "vitest.config.ts"]
  }
  ```

  `target: ES2018` matches the stated browser floor. `noEmit` because **esbuild** produces the bundle;
  `tsc` is used purely as a typechecker. `noUncheckedIndexedAccess` is deliberate — it forces a guard on
  `inputs[inputs.length - 1]`, which is exactly the class of bug TypeScript is here to catch.

  File: `vitest.config.ts`

  ```typescript
  import { defineConfig } from 'vitest/config'

  export default defineConfig({
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.ts'],
    },
  })
  ```

  File: `.gitignore`

  ```gitignore
  node_modules/
  .DS_Store
  harness/vendor/
  harness/stories/*
  !harness/stories/.gitkeep
  # dev-only by-product of `npm run dev --sourcemap`; the released bundle has no map
  dist/*.map
  ```

  File: `LICENSE` — the standard MIT text, `Copyright (c) 2026 Doug Compton`.

  Run: `npm install`
  Expected: `node_modules/` created; typescript, esbuild, vitest and jsdom installed; no errors.

- [x] **Task 0.2: Write failing tests for the pure command model**

  File: `test/command-model.test.ts`

  ```typescript
  import { describe, it, expect, beforeEach } from 'vitest'
  import {
    normalizeWord, tokenize, createState, tapVerb, tapWord, tapDirect, clearPending,
    normalizeVerb, addVerb, removeVerb,
    MAX_COMMAND_LENGTH, MAX_VERBS, DEFAULT_VERBS,
    type CommandState,
  } from '../src/command-model'

  describe('normalizeWord', () => {
    it('lowercases a plain word', () => {
      expect(normalizeWord('Lamp')).toBe('lamp')
    })

    it('strips trailing and surrounding punctuation', () => {
      expect(normalizeWord('lamp.')).toBe('lamp')
      expect(normalizeWord('lamp,')).toBe('lamp')
      expect(normalizeWord('lamp!')).toBe('lamp')
      expect(normalizeWord('"lamp"')).toBe('lamp')
    })

    it('strips a possessive apostrophe-s', () => {
      expect(normalizeWord("troll's")).toBe('troll')
    })

    it('keeps an internal hyphen', () => {
      expect(normalizeWord('jewel-encrusted')).toBe('jewel-encrusted')
    })

    it('returns empty string for empty, whitespace-only, null or undefined input', () => {
      expect(normalizeWord('')).toBe('')
      expect(normalizeWord('   ')).toBe('')
      expect(normalizeWord(null)).toBe('')
      expect(normalizeWord(undefined)).toBe('')
    })

    it('trims surrounding whitespace', () => {
      expect(normalizeWord('  lamp  ')).toBe('lamp')
    })

    it('returns empty string for punctuation-only input', () => {
      expect(normalizeWord('---')).toBe('')
      expect(normalizeWord('...')).toBe('')
    })

    it('coerces a number to its string form', () => {
      expect(normalizeWord(42)).toBe('42')
    })

    it('preserves accented letters', () => {
      expect(normalizeWord('Café')).toBe('café')
    })

    it('returns empty string for an emoji-only token', () => {
      expect(normalizeWord('🎉')).toBe('')
    })
  })

  describe('tokenize', () => {
    it('splits a sentence into word and non-word tokens', () => {
      const tokens = tokenize('You see a lamp.')
      expect(tokens.filter(t => t.isWord).map(t => t.text)).toEqual(['You', 'see', 'a', 'lamp'])
    })

    it('round-trips to the original string', () => {
      const text = 'West of House. You are standing here!'
      expect(tokenize(text).map(t => t.text).join('')).toBe(text)
    })

    it('marks punctuation and spaces as non-words', () => {
      const tokens = tokenize('a, b')
      expect(tokens.find(t => t.text === ', ')?.isWord).toBe(false)
    })

    it('treats a hyphenated word as one token', () => {
      expect(tokenize('a jewel-encrusted egg').filter(t => t.isWord).map(t => t.text))
        .toContain('jewel-encrusted')
    })

    it('returns an empty array for empty, null or undefined input', () => {
      expect(tokenize('')).toEqual([])
      expect(tokenize(null)).toEqual([])
      expect(tokenize(undefined)).toEqual([])
    })

    it('returns a single non-word token for whitespace only', () => {
      const tokens = tokenize('   ')
      expect(tokens).toHaveLength(1)
      expect(tokens[0]?.isWord).toBe(false)
    })

    it('marks a digits-only string as non-word', () => {
      expect(tokenize('1234').every(t => !t.isWord)).toBe(true)
    })

    it('tokenizes accented words', () => {
      expect(tokenize('the café').filter(t => t.isWord).map(t => t.text)).toEqual(['the', 'café'])
    })

    it('handles a very large paragraph without error', () => {
      const text = ('the lamp is here. ').repeat(2000)
      expect(tokenize(text).filter(t => t.isWord).length).toBe(8000)
    })
  })

  describe('command state machine', () => {
    let state: CommandState
    beforeEach(() => { state = createState() })

    it('tapDirect emits the command immediately', () => {
      expect(tapDirect(state, 'north').command).toBe('north')
    })

    it('tapDirect clears any armed verb', () => {
      const r = tapDirect(tapVerb(state, 'take').state, 'look')
      expect(r.command).toBe('look')
      expect(r.state.pendingVerb).toBe(null)
    })

    it('verb then word emits "<verb> <noun>"', () => {
      const a = tapVerb(state, 'take')
      expect(a.command).toBe(null)
      expect(a.state.pendingVerb).toBe('take')
      expect(tapWord(a.state, 'lamp').command).toBe('take lamp')
    })

    it('clears pending state after emitting a paired command', () => {
      const b = tapWord(tapVerb(state, 'take').state, 'lamp')
      expect(b.state.pendingVerb).toBe(null)
      expect(b.state.pendingNoun).toBe(null)
    })

    it('word then verb emits "<verb> <noun>"', () => {
      const a = tapWord(state, 'lamp')
      expect(a.command).toBe(null)
      expect(a.state.pendingNoun).toBe('lamp')
      expect(tapVerb(a.state, 'examine').command).toBe('examine lamp')
    })

    it('tapping a second verb replaces the first', () => {
      const b = tapVerb(tapVerb(state, 'take').state, 'drop')
      expect(b.command).toBe(null)
      expect(b.state.pendingVerb).toBe('drop')
    })

    it('tapping a second word replaces the first', () => {
      const b = tapWord(tapWord(state, 'lamp').state, 'sword')
      expect(b.command).toBe(null)
      expect(b.state.pendingNoun).toBe('sword')
    })

    it('supports a multi-word verb', () => {
      expect(tapWord(tapVerb(state, 'turn on').state, 'lamp').command).toBe('turn on lamp')
    })

    it('normalizes the tapped word before pairing', () => {
      expect(tapWord(tapVerb(state, 'take').state, 'Lamp.').command).toBe('take lamp')
    })

    it('ignores a word that normalizes to empty', () => {
      const r = tapWord(state, '...')
      expect(r.command).toBe(null)
      expect(r.state.pendingNoun).toBe(null)
    })

    it('ignores an empty or null verb', () => {
      expect(tapVerb(state, '').state.pendingVerb).toBe(null)
      expect(tapVerb(state, null).state.pendingVerb).toBe(null)
    })

    it('ignores an empty or whitespace-only direct command', () => {
      expect(tapDirect(state, '').command).toBe(null)
      expect(tapDirect(state, '   ').command).toBe(null)
    })

    it('clearPending resets both slots', () => {
      expect(clearPending(tapVerb(state, 'take').state).pendingVerb).toBe(null)
    })

    it('clearPending on fresh state is a no-op', () => {
      expect(clearPending(createState())).toEqual(createState())
    })

    it('does not mutate the state passed in', () => {
      const original = createState()
      tapVerb(original, 'take')
      expect(original.pendingVerb).toBe(null)
    })

    it('emits a command at exactly the maximum length', () => {
      const noun = 'a'.repeat(MAX_COMMAND_LENGTH - 'take '.length)
      expect(tapWord(tapVerb(createState(), 'take').state, noun).command)
        .toHaveLength(MAX_COMMAND_LENGTH)
    })

    it('rejects a command one character over the maximum length', () => {
      const noun = 'a'.repeat(MAX_COMMAND_LENGTH)
      expect(tapWord(tapVerb(createState(), 'take').state, noun).command).toBe(null)
    })

    it('does not treat a tapped word as markup', () => {
      const r = tapWord(tapVerb(createState(), 'take').state, '<script>alert(1)</script>')
      expect(r.command === null || !r.command.includes('<script>')).toBe(true)
    })

    it('strips a newline from a tapped word so one tap cannot send two commands', () => {
      expect(tapWord(tapVerb(createState(), 'take').state, 'lamp\nnorth').command)
        .not.toContain('\n')
    })

    it('pairs an accented noun', () => {
      expect(tapWord(tapVerb(createState(), 'examine').state, 'Café').command).toBe('examine café')
    })
  })

  describe('verb list', () => {
    it('ships a non-empty default set including the core verbs', () => {
      expect(DEFAULT_VERBS).toContain('examine')
      expect(DEFAULT_VERBS).toContain('take')
      expect(DEFAULT_VERBS.length).toBeGreaterThan(4)
    })

    it('adds a verb to the end of the list', () => {
      expect(addVerb(['take'], 'dig')).toEqual(['take', 'dig'])
    })

    it('removes a verb', () => {
      expect(removeVerb(['take', 'dig'], 'take')).toEqual(['dig'])
    })

    it('normalizes a verb to lowercase and collapses inner whitespace', () => {
      expect(normalizeVerb('  Turn   ON ')).toBe('turn on')
    })

    it('strips punctuation from a verb', () => {
      expect(normalizeVerb('take!')).toBe('take')
    })

    it('does not add a duplicate verb, case-insensitively', () => {
      expect(addVerb(['take'], 'take')).toEqual(['take'])
      expect(addVerb(['take'], 'TAKE')).toEqual(['take'])
    })

    it('ignores adding an empty, whitespace-only or null verb', () => {
      expect(addVerb(['take'], '')).toEqual(['take'])
      expect(addVerb(['take'], '   ')).toEqual(['take'])
      expect(addVerb(['take'], null)).toEqual(['take'])
    })

    it('removing a verb that is not present is a no-op', () => {
      expect(removeVerb(['take'], 'dig')).toEqual(['take'])
    })

    it('allows removing every verb (empty list is valid)', () => {
      expect(removeVerb(['take'], 'take')).toEqual([])
    })

    it('accepts a verb at exactly the maximum count', () => {
      const list = Array.from({ length: MAX_VERBS - 1 }, (_, i) => 'v' + i)
      expect(addVerb(list, 'last')).toHaveLength(MAX_VERBS)
    })

    it('refuses a verb beyond the maximum count', () => {
      const list = Array.from({ length: MAX_VERBS }, (_, i) => 'v' + i)
      expect(addVerb(list, 'toomany')).toHaveLength(MAX_VERBS)
    })

    it('refuses an absurdly long verb', () => {
      expect(addVerb([], 'a'.repeat(200))).toEqual([])
    })

    it('never stores markup in a verb', () => {
      expect(addVerb([], '<script>alert(1)</script>').join('')).not.toContain('<')
    })

    it('strips newlines from a verb', () => {
      expect(normalizeVerb('take\nnorth')).toBe('take north')
    })

    it('does not mutate the list passed in', () => {
      const original = ['take']
      addVerb(original, 'dig')
      expect(original).toEqual(['take'])
    })

    it('accepts an accented verb', () => {
      expect(addVerb([], 'ouvrir')).toEqual(['ouvrir'])
      expect(normalizeVerb('Écouter')).toBe('écouter')
    })
  })
  ```

- [x] **Task 0.3: Write failing tests for the DOM glue**

  File: `test/dom-glue.test.ts`

  ```typescript
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

  type Glue = typeof import('../src/if-buttons')

  // if-buttons.ts holds module-level state (the armed verb/noun, the boot timer), so each test needs a
  // FRESH instance. vi.resetModules() clears Vitest's module registry so the next dynamic import
  // re-evaluates the module — the idiomatic way, and it avoids relying on query-suffix resolution.
  //
  // stopBoot() cancels the auto-boot retry loop the module starts on load: without it every loadGlue()
  // would leave pending timers that could fire mid-test and rebuild the bar, making the suite flaky.
  async function loadGlue(): Promise<Glue> {
    document.body.innerHTML = ''
    document.documentElement.className = ''
    vi.resetModules()
    const mod = await import('../src/if-buttons')
    mod.stopBoot()
    return mod
  }

  interface BufferOpts {
    withInput?: boolean
    bareInput?: boolean
    withMore?: boolean
    moreHidden?: boolean
  }

  function makeBuffer(lines: string[] = ['West of House.'], opts: BufferOpts = {}): HTMLElement {
    const bw = document.createElement('div')
    bw.className = 'BufferWindow'
    for (const text of lines) {
      const line = document.createElement('div')
      line.className = 'BufferLine'
      line.textContent = text
      bw.appendChild(line)
    }
    if (opts.withInput) {
      const input = document.createElement('input')
      // GlkOte marks a LINE-mode input with both classes; some builds emit only .Input.
      input.className = opts.bareInput ? 'Input' : 'Input LineInput'
      bw.appendChild(input)
    }
    if (opts.withMore) {
      const more = document.createElement('div')
      more.className = 'MorePrompt'
      more.textContent = '— more —'
      // Some builds keep this element permanently and toggle visibility rather than
      // creating/destroying it, so the addon must ignore a hidden one (see Task 5.1).
      if (opts.moreHidden) { more.style.display = 'none' }
      bw.appendChild(more)
    }
    document.body.appendChild(bw)
    return bw
  }

  function liveInput(): HTMLInputElement {
    const el = document.querySelector<HTMLInputElement>('input.Input')
    if (!el) { throw new Error('test setup: no input element') }
    return el
  }

  describe('findLineInput', () => {
    let glue: Glue
    beforeEach(async () => { glue = await loadGlue() })

    it('finds the line input when the game awaits a command', () => {
      makeBuffer(['West of House.'], { withInput: true })
      expect(glue.findLineInput()).not.toBe(null)
    })

    it('returns null when there is no input (char-input or busy)', () => {
      makeBuffer(['Press SPACE to continue.'])
      expect(glue.findLineInput()).toBe(null)
    })

    it('returns the last input when several exist (previous turns echoed)', () => {
      const bw = makeBuffer(['turn one'], { withInput: true })
      const second = document.createElement('input')
      second.className = 'Input LineInput'
      second.dataset['which'] = 'live'
      bw.appendChild(second)
      expect(glue.findLineInput()?.dataset['which']).toBe('live')
    })

    it('prefers .Input.LineInput over a bare .Input when both are present', () => {
      const bw = makeBuffer(['x'])
      const bare = document.createElement('input')
      bare.className = 'Input'
      bare.dataset['which'] = 'bare'
      bw.appendChild(bare)
      const line = document.createElement('input')
      line.className = 'Input LineInput'
      line.dataset['which'] = 'line'
      bw.appendChild(line)
      expect(glue.findLineInput()?.dataset['which']).toBe('line')
    })

    it('falls back to a bare .Input when the host omits the LineInput class', () => {
      makeBuffer(['x'], { withInput: true, bareInput: true })
      expect(glue.findLineInput()).not.toBe(null)
    })
  })

  describe('inputMode', () => {
    let glue: Glue
    beforeEach(async () => { glue = await loadGlue() })

    it('reports "line" when a line input is present', () => {
      makeBuffer(['x'], { withInput: true })
      expect(glue.inputMode()).toBe('line')
    })

    it('reports "more" when a MorePrompt is showing, even with an input present', () => {
      makeBuffer(['x'], { withInput: true, withMore: true })
      expect(glue.inputMode()).toBe('more')
    })

    it('reports "char" when there is no input and no MorePrompt', () => {
      makeBuffer(['Press any key.'])
      expect(glue.inputMode()).toBe('char')
    })

    it('ignores a HIDDEN MorePrompt — a host may keep the element and toggle visibility', () => {
      makeBuffer(['x'], { withInput: true, withMore: true, moreHidden: true })
      expect(glue.inputMode()).toBe('line')
    })
  })

  describe('submitCommand', () => {
    let glue: Glue
    beforeEach(async () => { glue = await loadGlue() })

    it('writes the command into the input and fires Enter with keyCode 13', () => {
      makeBuffer(['x'], { withInput: true })
      const input = liveInput()
      const seen: Array<{ type: string; keyCode: number }> = []
      for (const type of ['keydown', 'keypress', 'keyup']) {
        input.addEventListener(type, e => seen.push({ type, keyCode: (e as KeyboardEvent).keyCode }))
      }
      expect(glue.submitCommand('north')).toBe(true)
      expect(input.value).toBe('north')
      expect(seen.map(s => s.type)).toEqual(['keydown', 'keypress', 'keyup'])
      expect(seen.every(s => s.keyCode === 13)).toBe(true)
    })

    it('fires an input event so host listeners observe the value', () => {
      makeBuffer(['x'], { withInput: true })
      const handler = vi.fn()
      liveInput().addEventListener('input', handler)
      glue.submitCommand('look')
      expect(handler).toHaveBeenCalled()
    })

    it('replaces residue already in the field rather than appending to it', () => {
      makeBuffer(['x'], { withInput: true })
      const input = liveInput()
      input.value = 'ta'                       // a host may have appended a partial command
      glue.submitCommand('take lamp')
      expect(input.value).toBe('take lamp')
    })

    it('returns false and does not throw when no input exists', () => {
      makeBuffer(['Press any key.'])
      expect(() => glue.submitCommand('north')).not.toThrow()
      expect(glue.submitCommand('north')).toBe(false)
    })

    it('dismisses a MorePrompt instead of submitting when paging is pending', () => {
      makeBuffer(['x'], { withInput: true, withMore: true })
      const input = liveInput()
      expect(glue.submitCommand('north')).toBe(false)
      expect(input.value).toBe('')
    })

    it('does not submit an empty or whitespace-only command', () => {
      makeBuffer(['x'], { withInput: true })
      expect(glue.submitCommand('')).toBe(false)
      expect(glue.submitCommand('   ')).toBe(false)
    })
  })

  describe('decorateBuffer', () => {
    let glue: Glue
    beforeEach(async () => { glue = await loadGlue() })

    it('wraps story words in tappable spans', () => {
      const bw = makeBuffer(['You see a brass lamp.'])
      glue.decorateBuffer(bw)
      expect([...bw.querySelectorAll('.ifb-word')].map(n => n.textContent))
        .toEqual(['You', 'see', 'a', 'brass', 'lamp'])
    })

    it('preserves the visible text exactly', () => {
      const bw = makeBuffer(['West of House. You are here!'])
      glue.decorateBuffer(bw)
      expect(bw.textContent).toBe('West of House. You are here!')
    })

    it('is idempotent — decorating twice does not double-wrap', () => {
      const bw = makeBuffer(['a lamp'])
      glue.decorateBuffer(bw)
      glue.decorateBuffer(bw)
      expect(bw.querySelectorAll('.ifb-word').length).toBe(2)
    })

    it('does not decorate echoed player input in a Style_input span', () => {
      const bw = makeBuffer([])
      const line = document.createElement('div')
      line.className = 'BufferLine'
      const echo = document.createElement('span')
      echo.className = 'Style_input'
      echo.textContent = 'take lamp'
      line.appendChild(echo)
      bw.appendChild(line)
      glue.decorateBuffer(bw)
      expect(echo.querySelectorAll('.ifb-word').length).toBe(0)
    })

    it('does not decorate a whole line carrying Style_input itself', () => {
      const bw = makeBuffer([])
      const line = document.createElement('div')
      line.className = 'BufferLine Style_input'
      line.textContent = 'take lamp'
      bw.appendChild(line)
      glue.decorateBuffer(bw)
      expect(line.querySelectorAll('.ifb-word').length).toBe(0)
    })

    it('does not inject markup from story text (XSS safety)', () => {
      const bw = makeBuffer(['<img src=x onerror=alert(1)> lamp'])
      glue.decorateBuffer(bw)
      expect(bw.querySelector('img')).toBe(null)
      expect(bw.textContent).toContain('<img src=x onerror=alert(1)>')
    })

    it('handles an empty buffer and a null root without throwing', () => {
      const bw = makeBuffer([])
      expect(() => glue.decorateBuffer(bw)).not.toThrow()
      expect(() => glue.decorateBuffer(null)).not.toThrow()
    })
  })

  describe('buildBar', () => {
    let glue: Glue
    beforeEach(async () => { glue = await loadGlue() })

    function verbButton(label: RegExp): HTMLButtonElement {
      const btn = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-verb')]
        .find(b => label.test(b.textContent ?? ''))
      if (!btn) { throw new Error('test setup: verb button not found') }
      return btn
    }

    it('renders the button bar once', () => {
      glue.buildBar()
      glue.buildBar()
      expect(document.querySelectorAll('#ifb-bar').length).toBe(1)
    })

    it('renders all ten movement directions', () => {
      glue.buildBar()
      expect([...document.querySelectorAll('#ifb-bar .ifb-move')].map(b => b.textContent))
        .toEqual(['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE', 'Up', 'Down'])
    })

    it('tapping a direction submits that direction', () => {
      makeBuffer(['x'], { withInput: true })
      glue.buildBar()
      const north = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-move')]
        .find(b => b.textContent === 'N')
      north?.click()
      expect(liveInput().value).toBe('north')
    })

    it('tapping a verb then a story word submits the pair', () => {
      const bw = makeBuffer(['a brass lamp'], { withInput: true })
      glue.decorateBuffer(bw)
      glue.buildBar()
      verbButton(/take/i).click()
      const lamp = [...bw.querySelectorAll<HTMLElement>('.ifb-word')]
        .find(n => n.textContent === 'lamp')
      lamp?.click()
      expect(liveInput().value).toBe('take lamp')
    })

    it('marks an armed verb and clears it after use', () => {
      const bw = makeBuffer(['a lamp'], { withInput: true })
      glue.decorateBuffer(bw)
      glue.buildBar()
      const take = verbButton(/take/i)
      take.click()
      expect(take.classList.contains('ifb-armed')).toBe(true)
      bw.querySelector<HTMLElement>('.ifb-word')?.click()
      expect(document.querySelectorAll('.ifb-armed').length).toBe(0)
    })

    it('the cancel button clears an armed verb', () => {
      glue.buildBar()
      verbButton(/take/i).click()
      document.querySelector<HTMLButtonElement>('#ifb-bar .ifb-cancel')?.click()
      expect(document.querySelectorAll('.ifb-armed').length).toBe(0)
    })

    it('gives every icon-only button an accessible name', () => {
      glue.buildBar()
      for (const sel of ['.ifb-cancel', '.ifb-editverbs']) {
        const btn = document.querySelector(`#ifb-bar ${sel}`)
        expect(btn?.getAttribute('aria-label')).toBeTruthy()
      }
    })

    it('every control is a real button element, not a clickable div', () => {
      glue.buildBar()
      const controls = document.querySelectorAll('#ifb-bar .ifb')
      expect(controls.length).toBeGreaterThan(0)
      for (const c of controls) {
        expect(c.tagName).toBe('BUTTON')
        expect(c.getAttribute('type')).toBe('button')
      }
    })
  })

  describe('verb list persistence and editing', () => {
    let glue: Glue
    beforeEach(async () => {
      localStorage.clear()
      glue = await loadGlue()
    })

    it('uses the default verbs when nothing is stored', () => {
      expect(glue.loadVerbs()).toEqual(expect.arrayContaining(['examine', 'take']))
    })

    it('persists an added verb across a reload', async () => {
      glue.saveVerbs(['take', 'dig'])
      const again = await loadGlue()
      expect(again.loadVerbs()).toEqual(['take', 'dig'])
    })

    it('falls back to defaults when stored data is corrupt', () => {
      localStorage.setItem('IFB_Verbs', '{not json')
      expect(glue.loadVerbs()).toContain('take')
    })

    it('falls back to defaults when stored data is not an array of strings', () => {
      localStorage.setItem('IFB_Verbs', JSON.stringify([1, 2, 3]))
      expect(glue.loadVerbs()).toContain('take')
    })

    it('survives localStorage throwing (Safari private mode, blocked storage)', () => {
      // Spy on Storage.prototype rather than redefining window.localStorage: the property may live on
      // Window.prototype in jsdom, in which case getOwnPropertyDescriptor returns undefined and
      // restoring it would throw, breaking the whole suite.
      const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(() => glue.loadVerbs()).not.toThrow()
      expect(glue.loadVerbs()).toContain('take')
      getSpy.mockRestore()
    })

    it('does not throw when saving is blocked', () => {
      const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => glue.saveVerbs(['take'])).not.toThrow()
      setSpy.mockRestore()
    })

    it('renders one verb button per stored verb', () => {
      glue.saveVerbs(['take', 'dig'])
      glue.buildBar()
      expect(document.querySelectorAll('#ifb-bar .ifb-verb').length).toBe(2)
    })

    it('adding a verb through the editor re-renders the bar', () => {
      glue.saveVerbs(['take'])
      glue.buildBar()
      glue.addVerbFromUI('dig')
      expect([...document.querySelectorAll('#ifb-bar .ifb-verb')]
        .map(b => (b.textContent ?? '').toLowerCase())).toContain('dig')
    })

    it('removing a verb through the editor re-renders the bar', () => {
      glue.saveVerbs(['take', 'dig'])
      glue.buildBar()
      glue.removeVerbFromUI('take')
      const labels = [...document.querySelectorAll('#ifb-bar .ifb-verb')]
        .map(b => (b.textContent ?? '').toLowerCase())
      expect(labels).not.toContain('take')
      expect(labels).toContain('dig')
    })

    it('a verb button label is set via textContent, never parsed as HTML', () => {
      glue.saveVerbs(['take'])
      glue.buildBar()
      glue.addVerbFromUI('<b>x</b>')
      expect(document.querySelector('#ifb-bar .ifb-verbs b')).toBe(null)
    })

    it('resetting restores the default verb set', () => {
      glue.saveVerbs(['onlythis'])
      glue.resetVerbs()
      expect(glue.loadVerbs()).toContain('take')
    })
  })

  describe('host independence', () => {
    let glue: Glue
    beforeEach(async () => { glue = await loadGlue() })
    // These tests call boot() explicitly. When boot fails to find a .BufferWindow it schedules a retry,
    // and that timer would otherwise fire during a LATER test and build a bar there — so cancel it.
    afterEach(() => { glue.stopBoot() })

    it('boots against a bare GlkOte DOM with no host scripts present', () => {
      makeBuffer(['West of House.'], { withInput: true })
      expect(() => glue.boot(1)).not.toThrow()
      expect(document.getElementById('ifb-bar')).not.toBe(null)
    })

    it('does not add the host-map class when no map element exists', () => {
      makeBuffer(['x'], { withInput: true })
      glue.boot(1)
      expect(document.documentElement.classList.contains('ifb-host-map')).toBe(false)
    })

    it('adds the host-map class and a map toggle when a map element exists', () => {
      makeBuffer(['x'], { withInput: true })
      const map = document.createElement('div')
      map.id = 'map'
      document.body.appendChild(map)
      glue.boot(1)
      expect(document.documentElement.classList.contains('ifb-host-map')).toBe(true)
      expect(document.querySelector('#ifb-bar .ifb-maptoggle')).not.toBe(null)
    })

    it('the map toggle hides and restores the map element, and reports its state', () => {
      makeBuffer(['x'], { withInput: true })
      const map = document.createElement('div')
      map.id = 'map'
      document.body.appendChild(map)
      glue.boot(1)
      const toggle = document.querySelector<HTMLButtonElement>('#ifb-bar .ifb-maptoggle')
      expect(toggle?.getAttribute('aria-label')).toBeTruthy()
      toggle?.click()
      expect(map.style.display).toBe('none')
      expect(toggle?.getAttribute('aria-pressed')).toBe('true')
      toggle?.click()
      expect(map.style.display).toBe('')
      expect(toggle?.getAttribute('aria-pressed')).toBe('false')
    })

    it('does nothing harmful when there is no BufferWindow at all', () => {
      expect(() => glue.boot(1)).not.toThrow()
      expect(document.getElementById('ifb-bar')).toBe(null)
    })
  })
  ```

- [x] **Task 0.4: Run tests — verify ALL fail**

  Run: `npm test`
  Expected: every test FAILS — `Failed to resolve import '../src/command-model'` and `../src/if-buttons`.

- [x] **Task 0.5: Commit**

  ```bash
  git add -A
  git commit -m "test: failing tests for the touch overlay — command model, DOM glue, host independence"
  ```

### Acceptance Criteria

| ID | Criterion | Maps to Test |
|----|-----------|--------------|
| P0-AC1 | Harness runs and reports failures | Task 0.4 output |
| P0-AC2 | Every command-model behaviour is specified before implementation | `describe('command state machine')`, `describe('verb list')` |
| P0-AC3 | Every GlkOte hook has a test | `describe('findLineInput' / 'inputMode' / 'submitCommand' / 'decorateBuffer' / 'buildBar')` |
| P0-AC4 | Host independence is a tested property, not a claim | `describe('host independence')` |

### Test Scenarios

| ID | Scenario | Input | Expected | Edge Case? |
|----|----------|-------|----------|------------|
| T1 | Direct command | tap `N` | sends `north` | No |
| T2 | Verb then noun | `Take` + "lamp" | `take lamp` | No |
| T3 | Noun then verb | "lamp" + `Examine` | `examine lamp` | No |
| T4 | Multi-word verb | `turn on` + "lamp" | `turn on lamp` | No |
| T5 | Empty word tap | `...` | ignored | Yes — empty |
| T6 | Whitespace command | `"   "` | not submitted | Yes — whitespace |
| T7 | Null/undefined inputs | `null`, `undefined` | `''` / `[]`, no throw | Yes — null |
| T8 | Command at max length | fills to `MAX_COMMAND_LENGTH` | submitted | Yes — boundary |
| T9 | Command over max | one char more | rejected | Yes — boundary |
| T10 | Verb replaced before use | `Take` then `Drop` | only `Drop` armed | Yes — conflict |
| T11 | Noun replaced before use | "lamp" then "sword" | only "sword" armed | Yes — conflict |
| T12 | State immutability | tap on shared state | caller's object unchanged | Yes — aliasing |
| T13 | Newline in tapped word | `lamp\nnorth` | newline stripped | Yes — security |
| T14 | Char-input mode | tap any button | returns false, no throw | Yes — protocol state |
| T15 | MorePrompt pending | tap a direction | pager dismissed, command not injected | Yes — protocol state |
| T16 | Hidden MorePrompt | element present but `display:none` | treated as line mode, command sent | Yes — protocol state |
| T17 | Stale inputs present | 2 `.Input.LineInput` | uses the last | Yes — DOM drift |
| T18 | Both selector forms | `.Input` + `.Input.LineInput` | prefers `LineInput` | Yes — selector precision |
| T19 | Host omits `LineInput` | bare `.Input` | falls back | Yes — version drift |
| T20 | Residue in the field | `ta` present, then submit | replaced, not appended | Yes — host conflict |
| T21 | XSS in story text | `<img onerror=…>` | literal text, no element | Yes — security |
| T22 | XSS in tapped word | `<script>…` | never in a command | Yes — security |
| T23 | Echoed input in a span | `.Style_input` span | not decorated | Yes — correctness |
| T24 | Echoed input on the line | `.BufferLine.Style_input` | not decorated | Yes — correctness |
| T25 | Double decoration | decorate twice | no double-wrap | Yes — idempotence |
| T26 | Text preservation | decorate a line | `textContent` unchanged | Yes — correctness |
| T27 | Empty buffer / null root | no lines / `null` | no throw | Yes — empty |
| T28 | Very large paragraph | 2000 sentences | tokenizes, no timeout | Yes — large input |
| T29 | Unicode noun / verb | `Café`, `Écouter` | handled | Yes — unicode |
| T30 | Emoji-only token | `🎉` | ignored | Yes — unicode |
| T31 | Type coercion | `normalizeWord(42)` | `'42'` | Yes — coercion |
| T32 | Possessive / hyphen | `troll's`, `jewel-encrusted` | `troll`, kept whole | Yes — parsing |
| T33 | Bar built twice | `buildBar()` ×2 | one `#ifb-bar` | Yes — idempotence |
| T34 | Duplicate verb | `TAKE` when `take` present | ignored | Yes — conflict |
| T35 | Verb count boundary | at / over `MAX_VERBS` | accepted / refused | Yes — boundary |
| T35b | Verb length boundary | 200-char verb | refused | Yes — large input |
| T36 | Corrupt stored verbs | `{not json`, `[1,2,3]` | defaults | Yes — data error |
| T37 | localStorage read blocked | `getItem` throws | defaults, no throw | Yes — platform |
| T38 | localStorage write blocked | `setItem` throws | no throw | Yes — platform |
| T39 | No host scripts present | bare GlkOte DOM | boots, bar renders | Yes — independence |
| T40 | No map element | plain host | no `ifb-host-map` | Yes — host detection |
| T41 | Map element present | `#map` exists | compacts + adds toggle | Yes — host detection |
| T42 | No BufferWindow at all | empty document | no throw, no bar | Yes — empty |
| T43 | Icon-only buttons (⚙ ✕ ⊞) | inspect the bar | each has a non-empty `aria-label` | Yes — a11y |
| T44 | Control semantics | inspect the bar | every `.ifb` is a real `<button type="button">` | Yes — a11y |
| T45 | Map toggle state | tap ⊞ twice | `aria-pressed` flips true → false | Yes — a11y |

---

## Phase 1: Pure Command Model

**Goal:** Implement `src/command-model.ts` so all of `test/command-model.test.ts` passes.

### Tasks

- [x] **Task 1.1: Implement the model**

  File: `src/command-model.ts`

  ```typescript
  /*
   * command-model.ts — pure command-building logic for the glk-touch overlay.
   *
   * SPDX-License-Identifier: MIT
   * Copyright (c) 2026 Doug Compton
   *
   * NO DOM, NO globals, NO side effects: every function is a pure transform, which is what makes the
   * interaction rules unit-testable without a browser. All DOM/GlkOte contact lives in if-buttons.ts.
   * State is immutable — each tap returns a NEW state plus the command to send (or null when the tap
   * only armed something).
   *
   * Hosts never load this file: esbuild bundles it with if-buttons.ts into one classic script.
   * Targets ES2018+ (Unicode property escapes, /\p{L}/u) so accented nouns are tappable.
   */

  /** One run of text from the story, flagged as a tappable word or as separator/punctuation. */
  export interface Token {
    readonly text: string
    readonly isWord: boolean
  }

  /** A verb or a noun may be "armed", waiting for its partner tap. Never both at once. */
  export interface CommandState {
    readonly pendingVerb: string | null
    readonly pendingNoun: string | null
  }

  /** Result of a tap: the next state, plus a command to send if the tap completed one. */
  export interface TapResult {
    readonly state: CommandState
    readonly command: string | null
  }

  /** Anything a caller might hand us from the DOM or from storage. */
  type Loose = string | number | null | undefined

  // Z-machine parsers accept short lines; this also bounds anything pathological arriving from story
  // text (a "word" is only as trustworthy as the game that printed it).
  export const MAX_COMMAND_LENGTH = 120

  // Default verb set. Core verbs cover the large majority of turns; the player can add or remove any
  // of them, because vocabularies differ per game (decision D3).
  export const DEFAULT_VERBS: readonly string[] = [
    'examine', 'take', 'drop', 'open', 'close', 'read', 'search',
    'push', 'pull', 'turn on', 'turn off', 'unlock', 'wear', 'enter',
  ]
  export const MAX_VERBS = 40
  export const MAX_VERB_LENGTH = 30

  function str(v: Loose): string {
    return (v === null || v === undefined) ? '' : String(v)
  }

  /**
   * Lowercase, trim, strip surrounding punctuation/quotes and a trailing possessive.
   * Keeps internal hyphens (jewel-encrusted) and non-ASCII letters (café).
   */
  export function normalizeWord(word: Loose): string {
    let s = str(word).trim().toLowerCase()
    if (!s) { return '' }
    s = s.replace(/\s+/g, ' ')            // collapse newlines: one tap must never send two commands
    s = s.replace(/['’]s\b/g, '')    // possessive
    s = s.replace(/[^\p{L}\p{N} -]/gu, '')
    s = s.replace(/^[\s-]+|[\s-]+$/g, '')
    return s
  }

  /** As normalizeWord, but verbs may be multi-word ("turn on"), so inner single spaces survive. */
  export function normalizeVerb(verb: Loose): string {
    let s = str(verb).trim().toLowerCase()
    if (!s) { return '' }
    s = s.replace(/\s+/g, ' ')
    s = s.replace(/[^\p{L}\p{N} -]/gu, '')
    s = s.replace(/^[\s-]+|[\s-]+$/g, '')
    return s
  }

  /**
   * Split text into ordered tokens, marking which are tappable words. Concatenating token.text
   * reproduces the input exactly — required so decoration is lossless.
   */
  export function tokenize(text: Loose): Token[] {
    const s = str(text)
    if (s === '') { return [] }
    const tokens: Token[] = []
    // A word must start with a letter; bare digits are not useful nouns to tap.
    const re = /\p{L}[\p{L}\p{N}]*(?:-[\p{L}\p{N}]+)*/gu
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) { tokens.push({ text: s.slice(last, m.index), isWord: false }) }
      tokens.push({ text: m[0], isWord: true })
      last = m.index + m[0].length
    }
    if (last < s.length) { tokens.push({ text: s.slice(last), isWord: false }) }
    return tokens
  }

  export function createState(): CommandState {
    return { pendingVerb: null, pendingNoun: null }
  }

  export function clearPending(_state?: CommandState): CommandState {
    return createState()
  }

  function result(state: CommandState, command: string | null): TapResult {
    if (command !== null && command.length > MAX_COMMAND_LENGTH) {
      // Refuse rather than send a truncated command that would confuse the parser.
      return { state: createState(), command: null }
    }
    return { state, command }
  }

  export function tapVerb(state: CommandState, verb: Loose): TapResult {
    const v = normalizeVerb(verb)
    if (!v) { return result(state, null) }
    if (state.pendingNoun) { return result(createState(), v + ' ' + state.pendingNoun) }
    return result({ pendingVerb: v, pendingNoun: null }, null)
  }

  export function tapWord(state: CommandState, word: Loose): TapResult {
    const n = normalizeWord(word)
    if (!n) { return result(state, null) }
    if (state.pendingVerb) { return result(createState(), state.pendingVerb + ' ' + n) }
    return result({ pendingVerb: null, pendingNoun: n }, null)
  }

  /** A self-contained command (direction, look, inventory…): send now, drop anything armed. */
  export function tapDirect(state: CommandState, command: Loose): TapResult {
    const c = str(command).trim()
    if (!c) { return result(createState(), null) }
    return result(createState(), c.replace(/\s+/g, ' '))
  }

  export function addVerb(list: readonly string[], verb: Loose): string[] {
    const v = normalizeVerb(verb)
    const out = list.slice()
    if (!v || v.length > MAX_VERB_LENGTH || out.length >= MAX_VERBS) { return out }
    if (out.indexOf(v) !== -1) { return out }
    out.push(v)
    return out
  }

  export function removeVerb(list: readonly string[], verb: Loose): string[] {
    const v = normalizeVerb(verb)
    return list.filter(x => x !== v)
  }
  ```

  > `clearPending` takes an optional, unused parameter so callers can keep passing the current state
  > (readable at call sites, and matches the tests). `noUnusedParameters` is satisfied by the `_` prefix.

- [x] **Task 1.2: Typecheck and run the model tests**

  Run: `npm run typecheck`
  Expected: zero errors.

  Run: `npm test -- test/command-model.test.ts`
  Expected: all PASS, 0 failures. The DOM-glue tests still fail — `src/if-buttons.ts` does not exist yet.

- [x] **Task 1.3: Commit**

  ```bash
  git add src/command-model.ts
  git commit -m "feat: pure command model — verb/noun pairing, tokenizer, verb list rules"
  ```

### Acceptance Criteria

| ID | Criterion | Maps to Test |
|----|-----------|--------------|
| P1-AC1 | Verb+noun pairing works in both orders | `it('verb then word emits …')`, `it('word then verb emits …')` |
| P1-AC2 | Direct commands send immediately and clear armed state | `it('tapDirect clears any armed verb')` |
| P1-AC3 | Tapped words are normalized | `it('normalizes the tapped word before pairing')` |
| P1-AC4 | Tokenizing is lossless | `it('round-trips to the original string')` |
| P1-AC5 | Over-length commands refused, not truncated | `it('rejects a command one character over…')` |
| P1-AC6 | No tap can smuggle a second command | `it('strips a newline from a tapped word…')` |
| P1-AC7 | State and verb lists are never mutated in place | `it('does not mutate the state passed in')`, `it('does not mutate the list passed in')` |
| P1-AC8 | Verb list rules: duplicates, bounds, markup | `describe('verb list')` |
| P1-AC9 | Types are sound under `strict` | Task 1.2 `npm run typecheck` |

### Test Scenarios

Covered by T1–T13, T28–T32, T34–T35 (written in Phase 0, passing here).

---

## Phase 2: DOM Glue — GlkOte Hooks

**Goal:** Implement `src/if-buttons.ts` so all of `test/dom-glue.test.ts` passes: find the live line
input, respect input mode and paging, make words tappable, build the bar and verb editor, and detect
host capabilities without naming any host.

### Tasks

- [x] **Task 2.1: Implement the glue**

  File: `src/if-buttons.ts`

  ```typescript
  /*
   * if-buttons.ts — touch command overlay for GlkOte-based interactive fiction players.
   *
   * SPDX-License-Identifier: MIT
   * Copyright (c) 2026 Doug Compton
   *
   * WHY: parser IF needs typed commands, which is painful on a tablet. This adds an on-screen bar
   * (compass + no-argument commands + editable verbs) and makes every word in the story text tappable,
   * so a session needs no keyboard: tap a VERB then the object's WORD (either order) and the command is
   * sent as if typed.
   *
   * HOW IT INTEGRATES — no fork of any host, no patched engine. It relies only on GlkOte's documented
   * DOM contract:
   *   .BufferWindow        host element for scrolling text output   -> MutationObserver root
   *   .BufferLine          one line of output                       -> unit of word decoration
   *   .Input.LineInput     the <input> for LINE input               -> command submission target
   *   .Input               same element on builds without LineInput -> fallback selector
   *   .MorePrompt          paging indicator; output is BLOCKED      -> dismiss before sending
   *   .Style_input         echoed player input                      -> must NOT be decorated
   *
   * HOST-AGNOSTIC BY DESIGN (§0.2): nothing here names a particular player. Anything host-specific (a
   * map panel, a theme, jQuery) is feature-detected, and a missing feature disables only itself. The
   * overlay must run in a page where no other application scripts exist at all.
   *
   * IMPORTANT — the game is not always awaiting a typed line. On CHAR input ("press any key") there is
   * no line input element, and while a .MorePrompt shows, output is paused. submitCommand() therefore
   * checks inputMode() first and NEVER silently drops a command.
   *
   * Documented fallback (not needed in practice): GlkOte also exposes GlkOte.extevent() and accepts
   * protocol events shaped { type:'line', gen, window, value, terminator }. Driving the DOM input is
   * preferred: no generation/window bookkeeping, and it survives protocol changes.
   */

  import {
    createState, clearPending, tapVerb, tapWord, tapDirect, tokenize, normalizeVerb,
    DEFAULT_VERBS,
    addVerb as addVerbToList, removeVerb as removeVerbFromList,
    type CommandState, type TapResult,
  } from './command-model'

  /** Which kind of input the game is waiting for, if any. */
  export type InputMode = 'line' | 'char' | 'more'

  declare global {
    interface Window {
      /** Console debugging handle — see the assignment at the bottom of this file. */
      IFButtons?: Record<string, unknown>
    }
  }

  const VERBS_KEY = 'IFB_Verbs'

  /** label, command */
  const MOVES: ReadonlyArray<readonly [string, string]> = [
    ['NW', 'northwest'], ['N', 'north'], ['NE', 'northeast'],
    ['W', 'west'], ['E', 'east'],
    ['SW', 'southwest'], ['S', 'south'], ['SE', 'southeast'],
    ['Up', 'up'], ['Down', 'down'],
  ]
  const NOARG: ReadonlyArray<readonly [string, string]> = [
    ['Look', 'look'], ['Inv', 'inventory'], ['Wait', 'wait'], ['In', 'in'], ['Out', 'out'],
    ['Again', 'again'], ['Undo', 'undo'], ['Save', 'save'], ['Restore', 'restore'],
  ]
  // Candidate selectors for an OPTIONAL map panel. Deliberately generic — this is capability
  // detection, not host detection; narrow it only when a real host is verified (Task 6.5).
  const MAP_SELECTORS = '#map, #map-container, .map-container, [data-if-map]'

  let state: CommandState = createState()
  let bootTimer: ReturnType<typeof setTimeout> | null = null

  // ── GlkOte inspection ────────────────────────────────────────────────────────────────────────
  function bufferWindow(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.BufferWindow')
  }

  /**
   * The live line input is the LAST match: hosts leave earlier turns' echoed inputs in the DOM, so
   * "first match" would target a dead element. Prefer .LineInput, which marks LINE mode; fall back to
   * a bare .Input for builds that omit it.
   */
  export function findLineInput(): HTMLInputElement | null {
    let inputs = document.querySelectorAll<HTMLInputElement>('input.Input.LineInput, .Input.LineInput')
    if (inputs.length === 0) {
      inputs = document.querySelectorAll<HTMLInputElement>('input.Input, .Input')
    }
    return inputs.length === 0 ? null : (inputs[inputs.length - 1] ?? null)
  }

  /**
   * Some hosts CREATE and DESTROY the More prompt; others keep the element and toggle visibility. If
   * we treated a hidden one as active, inputMode() would return 'more' forever and NO command would
   * ever be sent — a total failure. So test visibility, not mere presence.
   *
   * Deliberately avoids offsetParent (always null in jsdom, which would break the tests) and uses the
   * hidden attribute + inline style + computed style, all of which jsdom reports faithfully.
   */
  function isVisible(el: Element | null): boolean {
    if (!el) { return false }
    if (!(el instanceof HTMLElement)) { return true }
    if (el.hidden) { return false }
    if (el.style.display === 'none') { return false }
    const cs = window.getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') { return false }
    return true
  }

  function morePrompt(): HTMLElement | null {
    const el = document.querySelector<HTMLElement>('.MorePrompt')
    return isVisible(el) ? el : null
  }

  /**
   * 'more' -> paging pending, output blocked
   * 'line' -> game awaits a typed command (the normal case)
   * 'char' -> game awaits a single keypress; there is no input element
   */
  export function inputMode(): InputMode {
    if (morePrompt()) { return 'more' }
    if (findLineInput()) { return 'line' }
    return 'char'
  }

  // ── sending input ────────────────────────────────────────────────────────────────────────────
  /**
   * Hosts listen for Enter by keyCode. Synthetic KeyboardEvents cannot set keyCode through the
   * constructor, so the getters are overridden — the standard approach for driving such widgets.
   */
  function fireKey(el: EventTarget, key: string, keyCode: number): void {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, key, code: key })
      try {
        Object.defineProperty(e, 'keyCode', { get: () => keyCode })
        Object.defineProperty(e, 'which', { get: () => keyCode })
      } catch {
        // Already non-configurable on this engine; the key/code properties still carry the intent.
      }
      el.dispatchEvent(e)
    }
  }

  export function dismissMorePrompt(): boolean {
    const more = morePrompt()
    if (!more) { return false }
    more.click()
    const bw = bufferWindow()
    if (bw) { fireKey(bw, ' ', 32) }
    return true
  }

  /** Send a command as if typed. Returns true ONLY if it was actually delivered. */
  export function submitCommand(command: string | null | undefined): boolean {
    const cmd = (command ?? '').trim()
    if (!cmd) { return false }

    const mode = inputMode()
    if (mode === 'more') {
      dismissMorePrompt()        // the command would be swallowed; the user taps again
      return false
    }
    if (mode === 'char') {
      const bw = bufferWindow()  // no line input: the game wants one key
      if (bw) { fireKey(bw, ' ', 32) }
      return false
    }

    const el = findLineInput()
    if (!el) { return false }
    el.focus()
    // ASSIGN, never append. A host may have left a partial command in the field (Parchmap's own
    // Input.js appends), and assignment discards that residue in one step. Do NOT clear-then-write:
    // the extra empty-value 'input' event can trip a host's autocomplete for no benefit.
    el.value = cmd
    el.dispatchEvent(new Event('input', { bubbles: true }))
    fireKey(el, 'Enter', 13)
    return true
  }

  function apply(res: TapResult, armEl: HTMLElement | null): void {
    state = res.state
    renderArmed(armEl)
    if (res.command) { submitCommand(res.command) }
  }

  function renderArmed(armEl: HTMLElement | null): void {
    for (const el of document.querySelectorAll('.ifb-armed')) { el.classList.remove('ifb-armed') }
    if (armEl && (state.pendingVerb || state.pendingNoun)) { armEl.classList.add('ifb-armed') }
  }

  // ── word decoration ──────────────────────────────────────────────────────────────────────────
  /**
   * Wrap words in .ifb-word spans so they can be tapped as nouns. textContent only — never innerHTML
   * — so story text can never inject markup.
   */
  export function decorateBuffer(root: Element | null): void {
    if (!root) { return }
    const lines: Element[] = root.classList.contains('BufferLine')
      ? [root]
      : [...root.querySelectorAll('.BufferLine')]

    for (const line of lines) {
      if (line.getAttribute('data-ifb-done') === '1') { continue }
      line.setAttribute('data-ifb-done', '1')
      // A host may put the echoed-input style on the LINE element rather than an inner span; the
      // per-text-node walk below only inspects ancestors *below* the line, so check the line too.
      if (line.classList.contains('Style_input')) { continue }

      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      const textNodes: Text[] = []
      while (walker.nextNode()) { textNodes.push(walker.currentNode as Text) }

      for (const node of textNodes) {
        if (isInsideSkipped(node, line)) { continue }
        const tokens = tokenize(node.nodeValue)
        if (!tokens.some(t => t.isWord)) { continue }

        const frag = document.createDocumentFragment()
        for (const t of tokens) {
          if (t.isWord) {
            const span = document.createElement('span')
            span.className = 'ifb-word'
            span.textContent = t.text          // never innerHTML
            frag.appendChild(span)
          } else {
            frag.appendChild(document.createTextNode(t.text))
          }
        }
        node.parentNode?.replaceChild(frag, node)
      }
    }
  }

  /** True if this text node sits inside echoed input or something already decorated. */
  function isInsideSkipped(node: Node, line: Element): boolean {
    let p = node.parentNode
    while (p && p !== line) {
      if (p instanceof Element &&
          (p.classList.contains('Style_input') || p.classList.contains('ifb-word'))) {
        return true
      }
      p = p.parentNode
    }
    return false
  }

  export function watchBuffer(): boolean {
    const bw = bufferWindow()
    if (!bw) { return false }
    decorateBuffer(bw)

    if (!bw.getAttribute('data-ifb-observed')) {
      bw.setAttribute('data-ifb-observed', '1')
      new MutationObserver(mutations => {
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            if (n instanceof Element) { decorateBuffer(n) }
          }
        }
      }).observe(bw, { childList: true, subtree: true })
    }

    if (!bw.getAttribute('data-ifb-clickable')) {
      bw.setAttribute('data-ifb-clickable', '1')
      bw.addEventListener('click', e => {
        const t = e.target
        if (t instanceof HTMLElement && t.classList.contains('ifb-word')) {
          apply(tapWord(state, t.textContent), t)
        }
      })
    }
    return true
  }

  // ── verb list (persisted per browser) ────────────────────────────────────────────────────────
  // localStorage can throw (private mode, blocked storage, quota), so every access is guarded — a
  // failure must degrade to the defaults, never break the bar.
  export function loadVerbs(): string[] {
    try {
      const raw = window.localStorage.getItem(VERBS_KEY)
      if (!raw) { return DEFAULT_VERBS.slice() }
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) { return DEFAULT_VERBS.slice() }
      const clean = parsed
        .filter((v): v is string => typeof v === 'string' && normalizeVerb(v) !== '')
        .map(v => normalizeVerb(v))
      if (clean.length === 0 && parsed.length > 0) { return DEFAULT_VERBS.slice() }
      return clean
    } catch {
      return DEFAULT_VERBS.slice()
    }
  }

  export function saveVerbs(list: readonly string[]): void {
    try {
      window.localStorage.setItem(VERBS_KEY, JSON.stringify(list))
    } catch {
      // Storage unavailable or full: the list simply won't persist. Not worth interrupting play.
    }
  }

  export function resetVerbs(): void {
    try { window.localStorage.removeItem(VERBS_KEY) } catch { /* nothing to undo */ }
    renderVerbs()
    renderEditor()
  }

  export function addVerbFromUI(verb: string): void {
    saveVerbs(addVerbToList(loadVerbs(), verb))
    renderVerbs()
    renderEditor()
  }

  export function removeVerbFromUI(verb: string): void {
    saveVerbs(removeVerbFromList(loadVerbs(), verb))
    renderVerbs()
    renderEditor()
  }

  // ── UI ───────────────────────────────────────────────────────────────────────────────────────
  /**
   * `ariaLabel` is required for icon-only buttons: a glyph like ⚙ gives a screen reader nothing to
   * announce, and these are the only controls the addon adds to someone else's page.
   */
  function button(
    label: string,
    cls: string,
    onTap: (btn: HTMLButtonElement) => void,
    ariaLabel?: string,
  ): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ifb ' + cls
    b.textContent = label            // textContent: labels can come from user input
    if (ariaLabel) { b.setAttribute('aria-label', ariaLabel) }
    b.addEventListener('click', () => onTap(b))
    return b
  }

  export function renderVerbs(): void {
    const host = document.querySelector<HTMLElement>('#ifb-bar .ifb-verbs')
    if (!host) { return }
    while (host.firstChild) { host.removeChild(host.firstChild) }
    for (const v of loadVerbs()) {
      const label = v.charAt(0).toUpperCase() + v.slice(1)
      host.appendChild(button(label, 'ifb-verb', btn => apply(tapVerb(state, v), btn)))
    }
    host.appendChild(button('⚙', 'ifb-editverbs', () => toggleEditor(), 'Edit verb buttons'))
  }

  function renderEditor(): void {
    const panel = document.getElementById('ifb-editor')
    if (!panel) { return }
    // removeChild loop, not replaceChildren(): the latter needs Safari 14+ and would silently raise
    // the browser floor above the ES2018 target this addon advertises.
    while (panel.firstChild) { panel.removeChild(panel.firstChild) }

    const row = document.createElement('div')
    row.className = 'ifb-editrow'
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'ifb-newverb'
    input.placeholder = 'add a verb, e.g. dig'
    input.setAttribute('aria-label', 'New verb')   // a placeholder is not an accessible name
    input.setAttribute('autocapitalize', 'none')
    row.appendChild(input)
    row.appendChild(button('Add', 'ifb-addverb', () => {
      addVerbFromUI(input.value)
      input.value = ''
    }))
    row.appendChild(button('Defaults', 'ifb-resetverbs', () => resetVerbs()))
    panel.appendChild(row)

    const list = document.createElement('div')
    list.className = 'ifb-verblist'
    for (const v of loadVerbs()) {
      const chip = button(v + '  ✕', 'ifb-verbchip', () => removeVerbFromUI(v))
      chip.title = 'Remove ' + v
      list.appendChild(chip)
    }
    panel.appendChild(list)
  }

  function toggleEditor(): void {
    const panel = document.getElementById('ifb-editor')
    if (!panel) { return }
    panel.classList.toggle('ifb-open')
    if (panel.classList.contains('ifb-open')) { renderEditor() }
  }

  export function buildBar(): HTMLElement {
    const existing = document.getElementById('ifb-bar')
    if (existing) { return existing }

    const bar = document.createElement('div')
    bar.id = 'ifb-bar'

    const moves = document.createElement('div')
    moves.className = 'ifb-group ifb-moves'
    for (const [label, cmd] of MOVES) {
      moves.appendChild(button(label, 'ifb-move', () => apply(tapDirect(state, cmd), null)))
    }
    bar.appendChild(moves)

    const verbs = document.createElement('div')
    verbs.className = 'ifb-group ifb-verbs'
    bar.appendChild(verbs)

    const cmds = document.createElement('div')
    cmds.className = 'ifb-group ifb-cmds'
    for (const [label, cmd] of NOARG) {
      cmds.appendChild(button(label, 'ifb-cmd', () => apply(tapDirect(state, cmd), null)))
    }
    cmds.appendChild(button('✕', 'ifb-cancel', () => {
      state = clearPending(state)
      renderArmed(null)
    }, 'Cancel the armed verb or noun'))
    bar.appendChild(cmds)

    const editor = document.createElement('div')
    editor.id = 'ifb-editor'
    bar.appendChild(editor)

    document.body.appendChild(bar)
    renderVerbs()
    return bar
  }

  /**
   * Optional host capability: a map panel. If one exists, compact the bar and offer a toggle so the
   * prose stays readable on a tablet. Pure capability detection — no host is named (§0.2).
   */
  export function adoptHostFeatures(): void {
    const mapPane = document.querySelector<HTMLElement>(MAP_SELECTORS)
    if (!mapPane) { return }
    document.documentElement.classList.add('ifb-host-map')
    const cmds = document.querySelector<HTMLElement>('#ifb-bar .ifb-cmds')
    if (!cmds || cmds.querySelector('.ifb-maptoggle')) { return }
    const toggle = button('⊞', 'ifb-maptoggle', btn => {
      const collapsed = document.documentElement.classList.toggle('ifb-map-collapsed')
      mapPane.style.display = collapsed ? 'none' : ''
      btn.setAttribute('aria-pressed', String(collapsed))
    }, 'Show or hide the map')
    toggle.setAttribute('aria-pressed', 'false')   // a toggle must expose its state before first use
    cmds.appendChild(toggle)
  }

  // ── boot ─────────────────────────────────────────────────────────────────────────────────────
  /** Hosts render the game asynchronously, so poll briefly for .BufferWindow. */
  export function boot(triesLeft: number): boolean {
    if (watchBuffer()) {
      buildBar()
      adoptHostFeatures()
      return true
    }
    if (triesLeft > 0) {
      bootTimer = setTimeout(() => boot(triesLeft - 1), 500)
    }
    return false
  }

  /** Cancel a pending boot retry. Exported so tests do not leak timers between cases. */
  export function stopBoot(): void {
    if (bootTimer !== null) {
      clearTimeout(bootTimer)
      bootTimer = null
    }
  }

  /** Inspect the armed verb/noun from the console when debugging. */
  export function currentState(): CommandState { return state }

  // Console debugging handle ONLY (the troubleshooting docs use `IFButtons.inputMode()`). Never the
  // interface between our own modules — those use ESM imports.
  window.IFButtons = {
    findLineInput, inputMode, submitCommand, dismissMorePrompt, decorateBuffer, watchBuffer,
    buildBar, adoptHostFeatures, loadVerbs, saveVerbs, resetVerbs, addVerbFromUI, removeVerbFromUI,
    renderVerbs, boot, stopBoot, currentState,
  }

  if (document.readyState !== 'loading') {
    boot(40)
  } else {
    document.addEventListener('DOMContentLoaded', () => boot(40))
  }
  ```

- [x] **Task 2.2: Typecheck, then run the glue tests**

  Run: `npm run typecheck`
  Expected: zero errors.

  Run: `npm test -- test/dom-glue.test.ts`
  Expected: all PASS.

- [x] **Task 2.3: Run the whole suite**

  Run: `npm test`
  Expected: all PASS in both files.

- [x] **Task 2.4: Commit**

  ```bash
  git add src/if-buttons.ts
  git commit -m "feat: GlkOte DOM glue — command injection, paging/char-mode safety, tappable words, verb editor"
  ```

### Acceptance Criteria

| ID | Criterion | Maps to Test |
|----|-----------|--------------|
| P2-AC1 | Commands reach the live line input with keyCode 13 | `it('writes the command into the input and fires Enter…')` |
| P2-AC2 | `.Input.LineInput` preferred, bare `.Input` fallback, last match wins | the five `findLineInput` tests |
| P2-AC3 | Paging dismissed instead of dropping a command | `it('dismisses a MorePrompt instead of submitting…')` |
| P2-AC4 | A hidden More prompt does not deadlock input | `it('ignores a HIDDEN MorePrompt…')` |
| P2-AC5 | Char-input mode never silently swallows a tap | `it('returns false and does not throw when no input exists')` |
| P2-AC6 | Field residue is replaced, not appended | `it('replaces residue already in the field…')` |
| P2-AC7 | Words tappable, losslessly and safely | `it('preserves the visible text exactly')`, `it('does not inject markup…')` |
| P2-AC8 | Echoed input not tappable, in a span or on the line | the two `Style_input` tests |
| P2-AC9 | Decoration and bar are idempotent | `it('is idempotent…')`, `it('renders the button bar once')` |
| P2-AC10 | Verb editor add/remove/reset/persist, storage failures survived | `describe('verb list persistence and editing')` |
| P2-AC11 | Boots with no host scripts; map features only when present | `describe('host independence')` |
| P2-AC12 | Types are sound under `strict` | Task 2.2 `npm run typecheck` |
| P2-AC13 | Controls are real buttons and icon-only ones have accessible names | `it('gives every icon-only button an accessible name')`, `it('every control is a real button element…')`, `it('…reports its state')` |

### Test Scenarios

Covered by T14–T27, T33, T36–T42.

---

## Phase 3: Stylesheet

**Goal:** Touch-sized, themeable by the host, never covering the story text, and compact when a host
provides a map.

### Tasks

- [x] **Task 3.1: Write the stylesheet**

  File: `src/if-buttons.css`

  ```css
  /*
   * if-buttons.css — styling for the glk-touch overlay.
   *
   * SPDX-License-Identifier: MIT
   * Copyright (c) 2026 Doug Compton
   *
   * Constraints, all tablet-driven:
   *   - every target >= 44px (comfortable tap size on iOS and Android)
   *   - the fixed bar must NOT cover story text -> .BufferWindow gets matching bottom padding
   *   - respect the home-indicator inset via env(safe-area-inset-bottom)
   *   - "armed" (a verb waiting for a noun) must be obvious at a glance
   *   - the bar scrolls internally on small viewports instead of growing without bound
   *   - hosts vary in theme, so colours come from custom properties and can be overridden by the
   *     embedding page without editing this file
   */

  :root {
    --ifb-bar-height: 190px;
    --ifb-bg: rgba(24, 24, 24, 0.94);
    --ifb-btn: #2c2c2c;
    --ifb-btn-active: #444;
    --ifb-armed: #0a63c2;
    --ifb-armed-border: #4c9be8;
    --ifb-text: #eee;
    --ifb-border: #555;
  }

  #ifb-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
    box-sizing: border-box;
    max-height: 45vh;
    overflow-y: auto;
    padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
    align-items: flex-start;
    background: var(--ifb-bg);
    border-top: 1px solid var(--ifb-border);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    touch-action: manipulation;   /* stop double-tap-to-zoom stealing taps */
  }

  .ifb-group { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }

  /* compass as a 3-wide grid; Up/Down wrap onto the end naturally */
  .ifb-moves {
    display: grid;
    grid-template-columns: repeat(3, minmax(52px, 1fr));
    gap: 6px;
    flex: 0 0 auto;
  }

  .ifb {
    min-width: 52px;
    min-height: 44px;
    padding: 6px 12px;
    border: 1px solid var(--ifb-border);
    border-radius: 8px;
    background: var(--ifb-btn);
    color: var(--ifb-text);
    font-size: 15px;
    line-height: 1.2;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  .ifb:active { background: var(--ifb-btn-active); }
  .ifb:focus-visible { outline: 2px solid var(--ifb-armed-border); outline-offset: 2px; }

  .ifb.ifb-armed,
  .ifb-word.ifb-armed {
    background: var(--ifb-armed);
    border-color: var(--ifb-armed-border);
    color: #fff;
  }

  .ifb-cancel { font-size: 18px; }
  .ifb-editverbs, .ifb-maptoggle { font-size: 17px; }

  /* Tappable story words: no permanent decoration (that would wreck the prose), only feedback. */
  .ifb-word { cursor: pointer; border-radius: 3px; padding: 1px 0; }
  .ifb-word:active { background: var(--ifb-armed); color: #fff; }

  /* Reserve room so the fixed bar never hides the latest output. The host owns .BufferWindow's
     layout, so only padding is touched. */
  .BufferWindow { padding-bottom: var(--ifb-bar-height) !important; }

  /* Verb editor — hidden until ⚙ is tapped, so it costs no space during play. */
  #ifb-editor { display: none; flex: 1 0 100%; padding: 8px 0 0; border-top: 1px solid #3a3a3a; }
  #ifb-editor.ifb-open { display: block; }
  .ifb-editrow { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .ifb-newverb {
    flex: 1 1 160px;
    min-height: 44px;
    padding: 6px 10px;
    font-size: 16px;                 /* >=16px stops iOS zooming the page on focus */
    border: 1px solid var(--ifb-border);
    border-radius: 8px;
    background: #1e1e1e;
    color: var(--ifb-text);
  }
  .ifb-verblist { display: flex; gap: 6px; flex-wrap: wrap; }
  .ifb-verbchip { font-size: 14px; }

  /* A host that provides a map (optional capability): give the bar less vertical room and allow the
     map to be collapsed for reading. .ifb-host-map is set by if-buttons.ts on detection. */
  .ifb-host-map { --ifb-bar-height: 150px; }
  .ifb-host-map #ifb-bar { max-height: 38vh; }
  .ifb-host-map .ifb { min-height: 40px; font-size: 14px; }
  .ifb-map-collapsed .ifb-maptoggle {
    background: var(--ifb-armed);
    border-color: var(--ifb-armed-border);
    color: #fff;
  }

  /* Landscape phones / short viewports: shrink the reserved strip. */
  @media (max-height: 500px) {
    :root { --ifb-bar-height: 130px; }
    #ifb-bar { max-height: 40vh; }
    .ifb { min-height: 40px; padding: 4px 10px; font-size: 14px; }
  }
  ```

- [x] **Task 3.2: Confirm no regressions**

  Run: `npm test`
  Expected: all PASS (CSS isn't under test; this proves nothing broke).

- [x] **Task 3.3: Commit**

  ```bash
  git add src/if-buttons.css
  git commit -m "feat: touch-sized stylesheet with themeable tokens and host-map compaction"
  ```

### Acceptance Criteria

| ID | Criterion | Verified by |
|----|-----------|-------------|
| P3-AC1 | Every button ≥44px tall | `min-height: 44px`; P3-T1 |
| P3-AC2 | The bar never covers the latest story text | `.BufferWindow` padding; P3-T1 |
| P3-AC3 | Armed state obvious | class applied (tested in Phase 2); colour checked in P3-T1 |
| P3-AC4 | Short/landscape viewports usable | `@media (max-height: 500px)`; P3-T2 |
| P3-AC5 | Colours overridable by the host page | custom properties on `:root`; P3-T7 |
| P3-AC6 | Keyboard focus visible | `:focus-visible` outline; P3-T5 |

### Test Scenarios

| ID | Scenario | Expected | Edge Case? |
|----|----------|----------|------------|
| P3-T1 | Portrait tablet | bar visible, text not covered, armed state legible | No |
| P3-T2 | Landscape / short viewport | reduced height, still usable | Yes — boundary |
| P3-T3 | Very long wrapped paragraph | words tappable, layout intact | Yes — large input |
| P3-T4 | Device with home indicator | bar sits above the inset | Yes — platform |
| P3-T5 | Focus by keyboard | visible outline | Yes — a11y |
| P3-T6 | iOS focus on the verb input | no page zoom (16px font) | Yes — platform |
| P3-T7 | Host overrides `--ifb-bg` | bar restyles without editing our CSS | Yes — integration |

---

## Phase 4: Local Dev Harness — the two real hosts

**Goal:** Run **real Parchment** and **real Parchmap** locally with the addon loaded, so Phases 5–6
verify against actual software rather than jsdom. Neither host works from `file://`, so both are served
over HTTP.

### Tasks

- [x] **Task 4.1: Harness documentation**

  File: `harness/README.md`

  ```markdown
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

  ## 3. Serve

  ```bash
  docker compose up
  ```

  | URL | What |
  |-----|------|
  | <http://localhost:8080/parchment/play.html?story=zork1.z5> | Parchment + the addon (ESM src) |
  | <http://localhost:8080/parchmap/play.html?story=zork1.z5>  | Parchmap + the addon (ESM src) |
  | <http://localhost:8080/stories/> | the story directory (same-origin, so no CORS proxy) |

  Both pages load the **ESM sources** from `/shared/` for a fast edit-reload loop. To verify what
  actually ships, switch a page to the bundle (`../dist/glk-touch.js`, one classic `<script>`) — Task
  5.4 requires doing this at least once.

  No Docker? `python3 -m http.server 8080` from this directory also works.
  ```

  File: `harness/docker-compose.yml`

  ```yaml
  # Local-only harness. Serves both hosts, the addon (both as ESM source and as the built bundle), and
  # the story directory from ONE origin, so Parchment never engages its CORS proxy.
  services:
    harness:
      image: nginx:alpine
      ports:
        - "8080:80"
      volumes:
        - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
        - ./vendor/parchment:/usr/share/nginx/html/parchment-vendor:ro
        - ./vendor/parchmap:/usr/share/nginx/html/parchmap:ro
        - ./parchment:/usr/share/nginx/html/parchment:ro
        - ../dist:/usr/share/nginx/html/dist:ro
        - ./stories:/usr/share/nginx/html/stories:ro
  ```

  Only `dist/` is mounted, not `src/`: the browser cannot execute TypeScript, and pointing the harness
  at the **same artifact a real deployment installs** removes the "works in dev, broken in dist" failure
  mode. `npm run dev` rebuilds it on every save.

  File: `harness/nginx.conf`

  ```nginx
  server {
      listen 80;
      root /usr/share/nginx/html;
      index index.html;

      location /stories/ {
          autoindex on;
          autoindex_format json;
          default_type application/octet-stream;
      }

      # Never cache the addon while developing it — `npm run dev` rewrites these on every save.
      location /dist/ { add_header Cache-Control "no-store"; }

      location / { try_files $uri $uri/ =404; }
  }
  ```

- [ ] **Task 4.2: Start the watch build**

  Browsers cannot execute `.ts`, so the harness serves the bundle. The `dev` script (already defined in
  `package.json`, Task 0.1) rebuilds it on every save:

  ```bash
  npm run dev      # leave running in its own terminal
  ```
  Expected: `dist/glk-touch.js` (+ `.js.map`) written, and rewritten on each save of `src/`.

  A browser reload then picks up the change, and because the harness loads the **same artifact a real
  deployment installs**, the "works in dev, broken in dist" failure mode cannot occur.

  > `dist/glk-touch.js.map` is a dev-only by-product of `--sourcemap`. Add it to `.gitignore` so the
  > `dist` currency gate (Task 7.3) does not fail on it: the released bundle is built by
  > `scripts/build.sh`, which emits no map.

- [x] **Task 4.3: Minimal Parchment host page**

  File: `harness/parchment/play.html`

  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Parchment + glk-touch</title>

  <!--
    parchment_options is Parchment's supported config global and MUST be set BEFORE its scripts load.
    default_story is resolved SAME-ORIGIN (/stories/...), so Parchment never routes the story through
    its CORS proxy — the harness works offline. ?story= is restricted to a bare filename so this page
    cannot be turned into a proxy for arbitrary remote files.
  -->
  <script>
  (function () {
    var raw = new URLSearchParams(location.search).get('story') || ''
    var safe = /^[A-Za-z0-9 ._'()-]+$/.test(raw) && raw.indexOf('..') === -1 ? raw : ''
    if (safe) {
      window.parchment_options = {
        default_story: ['../stories/' + encodeURIComponent(safe)],
        lock_story: 1, lock_options: 1, page_title: 0
      }
    }
  })()
  </script>

  <link rel="stylesheet" href="../parchment-vendor/dist/web/web.css">
  <link rel="stylesheet" href="../dist/glk-touch.css">
  </head>
  <body>
  <div id="gameport">
    <div id="about"></div>
    <div id="windowport"></div>
    <div id="loadingpane" style="display:none"><p>Loading story…</p></div>
    <div id="errorpane" style="display:none"><div id="errorcontent"></div></div>
  </div>

  <script src="../parchment-vendor/dist/web/jquery.min.js"></script>
  <script nomodule src="../parchment-vendor/dist/web/ie.js"></script>
  <script type="module" src="../parchment-vendor/dist/web/web.js"></script>

  <!-- the addon: the same single classic script a real deployment installs -->
  <script src="../dist/glk-touch.js"></script>
  </body>
  </html>
  ```

- [ ] **Task 4.4: Load the addon into Parchmap's page**

  Append to `harness/vendor/parchmap/play.html`, immediately before `</body>` — **after** all of
  Parchmap's own scripts, so `.BufferWindow` exists and its handlers are already bound:

  ```html
  <!-- glk-touch (MIT) loaded into Parchmap (GPL-3.0) for local verification. -->
  <link rel="stylesheet" href="../dist/glk-touch.css">
  <script src="../dist/glk-touch.js"></script>
  ```

  This edit lives in the git-ignored `vendor/` tree — the harness never commits a modified host.
  Downstream deployments make the same change; see `docs/INSTALL.md`.

- [x] **Task 4.5: Commit**

  ```bash
  git add harness/
  git commit -m "chore: local harness serving real Parchment and Parchmap with the built bundle"
  ```

---

## Phase 5: Verify against Parchment

**Goal:** Confirm the addon works in the modern reference host, and settle the two DOM unknowns.

### Tasks

- [ ] **Task 5.1: Confirm the DOM contract in modern Parchment**

  Build once (`npm run build`), start the harness, open the Parchment page, and in the console:

  ```javascript
  document.querySelectorAll('.BufferWindow').length          // expect 1
  document.querySelectorAll('.BufferLine').length            // expect > 0
  document.querySelectorAll('.Input.LineInput').length       // ? AsyncGlk may omit LineInput
  document.querySelectorAll('.Input').length                 // expect >= 1 while awaiting a command
  IFButtons.inputMode()                                      // expect 'line'
  ```

  Then answer the **More-prompt question**, which decides whether the visibility guard is load-bearing:
  trigger long output (`verbose` then `look`, or a long `read`), and while the pager shows:

  ```javascript
  document.querySelectorAll('.MorePrompt').length            // 1 while paging
  IFButtons.inputMode()                                      // expect 'more'
  // dismiss the pager, then:
  document.querySelectorAll('.MorePrompt').length            // 0 if destroyed, 1 if merely hidden
  IFButtons.inputMode()                                      // MUST be 'line' either way
  ```

  Record both outcomes in `docs/COMPATIBILITY.md`. If the element persists while hidden, the `isVisible`
  guard is what keeps the addon working — note that explicitly so nobody "simplifies" it away later.

- [ ] **Task 5.2: Manual play-through, tap only**

  ```
  1. Tap N/S/E/W          -> the game moves
  2. Tap Look, Inv        -> correct responses
  3. Tap Take, tap a noun -> "take <noun>" is submitted
  4. Tap a noun, tap Examine -> "examine <noun>"
  5. Trigger long output  -> a MorePrompt appears; a tap dismisses it, the next tap sends
  6. Reach a "press any key" prompt -> a tap advances it
  7. ⚙ -> add "dig", remove "wear", reload -> changes persisted
  8. Devtools Network -> no third-party requests
  ```

- [ ] **Task 5.3: Check the tablet, not just the desktop**

  Repeat Task 5.2 steps 1–4 and 7 on a **real iPad or Android tablet** pointed at the harness. This is
  the one place synthetic-event behaviour can differ from desktop (iOS is stricter), and it is the
  primary target device — a desktop-only pass is not evidence.

- [ ] **Task 5.4: Verify the shipped bundle, not just the source**

  The harness already loads `dist/glk-touch.js`, so confirm the artifact is the real thing:

  ```bash
  npm run build
  grep -cE '^\s*(import|export)\b' dist/glk-touch.js    # expect 0 — it must be a classic script
  ```
  Reload the harness page with devtools open: no module-loading errors, bar renders, a tap works.

- [ ] **Task 5.5: Record findings**

  File: `docs/COMPATIBILITY.md`

  ```markdown
  # Verified hosts

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
  ```

- [ ] **Task 5.6: Commit**

  ```bash
  git add docs/COMPATIBILITY.md
  git commit -m "docs: record verified behaviour against Parchment"
  ```

### Acceptance Criteria

| ID | Criterion | Maps to |
|----|-----------|---------|
| P5-AC1 | The addon boots and the bar renders in real Parchment | Task 5.1 |
| P5-AC2 | A full turn is possible by tapping only | Task 5.2 steps 1–4 |
| P5-AC3 | Paging and char-input states behave | Task 5.2 steps 5–6 |
| P5-AC4 | The `.MorePrompt` lifecycle question is answered and recorded | Task 5.1, Task 5.5 |
| P5-AC5 | Verb edits persist | Task 5.2 step 7 |
| P5-AC6 | No external requests | Task 5.2 step 8 |
| P5-AC7 | Works on a real tablet, not only a desktop browser | Task 5.3 |
| P5-AC8 | The **bundle** works, and contains no import/export | Task 5.4 |

---

## Phase 6: Verify against Parchmap — the two real risks

**Goal:** Prove the addon coexists with a host that *also* drives the same input element and reads the
same output. These checks are the crux of the "works with Parchmap" claim.

### Tasks

- [ ] **Task 6.1: Does the map update when *we* submit the command?**

  Parchmap builds its map by reading echoed input from the DOM
  (`$($(".Style_input").get().reverse())`), which appears **however** the command was submitted — so it
  should work. But if it *additionally* hooks its own input handler, addon-submitted commands would move
  the game **without updating the map**: a silently wrong map, worse than no map.

  Test: open the Parchmap harness page and move **only by tapping** the compass.

  ```
  PASS: the map gains a room per tap, exactly as typing would
  FAIL: the game moves but the map stays put or mis-links rooms
  ```

  If FAIL, find what it listens for and match that mechanism:
  ```bash
  grep -rn "keypress\|keydown\|\.on(\|\.bind(\|Style_input\|Update\|AddRoom" \
    harness/vendor/parchmap/js/Map.js harness/vendor/parchmap/js/Input.js \
    harness/vendor/parchmap/js/Parchmap.js
  ```
  Its own `Input.js` uses a **jQuery** `keypress` with `which: 13`. jQuery handlers do fire on native
  events, so our native dispatch should already reach it. If a jQuery-specific path proves necessary,
  add an **optional** dispatch guarded by feature detection — jQuery detection, never host detection,
  so §0.2 still holds:

  ```typescript
  // in submitCommand(), after the native dispatch.
  // `as unknown as` because Window has no jQuery member — a direct cast is rejected for
  // insufficient overlap. This is jQuery *capability* detection, not host detection (§0.2).
  type JQueryLike = (el: Element) => { trigger: (e: unknown) => void }
  const jq = (window as unknown as { jQuery?: JQueryLike }).jQuery
  if (typeof jq === 'function') {
    try {
      jq(el).trigger(new KeyboardEvent('keypress', { bubbles: true }))
    } catch {
      // optional compatibility path only
    }
  }
  ```

  **If this path is added it needs its own tests** (add to `test/dom-glue.test.ts`): one asserting the
  jQuery dispatch is attempted when a `window.jQuery` stub exists, and one asserting `submitCommand`
  still returns `true` and does not throw when `window.jQuery` is absent.

- [ ] **Task 6.2: Does its input handling collide with ours?**

  Parchmap **appends** to the field and clears via `Input.Clear()`; we **assign**.

  Test: type `ta` into the field, then tap `Take` and a noun.
  ```
  PASS: exactly "take <noun>" is submitted; the field is empty afterwards
  FAIL: doubled or merged text, e.g. "tatake lamp"
  ```
  Assignment is the guard (covered by unit test T20); confirm it holds against the live host.

- [ ] **Task 6.3: Story format and `?story=` reach**

  Parchmap's `GameList` entries look like `moonglow.z3.js` (legacy JS-wrapped stories) and its
  `upload.php` appends `.js`. Establish what its bundled core actually accepts — a **downstream
  deployment depends on this answer** (§0.3 question 4):

  ```bash
  cd harness/vendor/parchmap
  grep -rn "GameFilename\|games/\|processBase64\|createElement('script')" js/ lib/main.js | head -40
  grep -rn "story\|zcode\|base64\|responseType\|arraybuffer" lib/main.js | head -40
  ```
  Then try, in order: `play.html?story=zork1.z5` (raw, same dir), `?story=../stories/zork1.z5` (outside
  `games/`), and a wrapped `zork1.z5.js` if raw fails.

  Record in `docs/COMPATIBILITY.md`: which forms load, whether `?story=` accepts a relative path outside
  `games/`, and the wrapper function name if wrapping is required.

- [ ] **Task 6.4: Coexistence and layout**

  ```
  1. ⊞ collapses the map; prose reflows; ⊞ again restores it
  2. Prose + map + bar remain usable at tablet size (test at 768x1024 and 1024x768)
  3. Its Tab-autocomplete still works when a keyboard is attached
  4. Its notes and prefs still save (localStorage PM_* keys untouched by IFB_Verbs)
  5. Devtools Network: no google-analytics.com (GA_TRACK=false), no other third-party requests
  ```

- [ ] **Task 6.5: Narrow the map selector, record findings, commit**

  Find the real map container and narrow `MAP_SELECTORS` if the generic list is over-broad:
  ```bash
  grep -n 'id="map\|class="map' harness/vendor/parchmap/index.html harness/vendor/parchmap/play.html
  ```
  Fill in the Parchmap rows of `docs/COMPATIBILITY.md`, then:

  ```bash
  npm test && npm run typecheck
  git add docs/COMPATIBILITY.md src/ test/
  git commit -m "docs: verify coexistence with Parchmap (map sync, input collision, story format)"
  ```

### Acceptance Criteria

| ID | Criterion | Maps to |
|----|-----------|---------|
| P6-AC1 | **The map updates from addon-submitted commands** | Task 6.1 |
| P6-AC2 | No input-buffer collision | Task 6.2 |
| P6-AC3 | Story-format and `?story=` behaviour documented for the deployment | Task 6.3 |
| P6-AC4 | Map collapse works; tablet layout usable | Task 6.4 (1–2) |
| P6-AC5 | The host's own features still work | Task 6.4 (3–4) |
| P6-AC6 | No third-party requests | Task 6.4 (5) |
| P6-AC7 | Any jQuery dispatch added stays optional, feature-detected **and tested** | Task 6.1 |
| P6-AC8 | Tests and typecheck still green after any fix | Task 6.5 |

### Test Scenarios

| ID | Scenario | Expected | Edge Case? |
|----|----------|----------|------------|
| P6-T1 | Tap-driven movement ×3 | 3 rooms added, correctly linked | No |
| P6-T2 | Verb + noun by tap | exact command; field cleared | No |
| P6-T3 | Residue in the field | no concatenation | Yes — host conflict |
| P6-T4 | Map collapse | hides/restores, no layout break | No |
| P6-T5 | `.MorePrompt` on this host | dismissed first | Yes — protocol state |
| P6-T6 | Char input on this host | keypress sent | Yes — protocol state |
| P6-T7 | Verb edits under this host | persist; `PM_*` keys untouched | Yes — persistence |
| P6-T8 | Offline (WAN blocked) | page fully loads | Yes — network error |
| P6-T9 | Raw vs wrapped story | documented which loads | Yes — data format |
| P6-T10 | Tablet portrait and landscape | usable in both | Yes — boundary |
| P6-T11 | jQuery absent (if the fallback was added) | no throw, still returns true | Yes — optional dependency |

---

## Phase 7: Package and Release

**Goal:** Produce a pinnable artifact, gates any forge can run, and copy-paste install docs.

### Tasks

- [x] **Task 7.1: Build script**

  File: `scripts/build.sh`

  ```bash
  #!/usr/bin/env sh
  # Bundle the TypeScript ESM sources into ONE classic script, so a host installs the addon with a
  # single <script> tag — no module loader, no import map, nothing to configure.
  #
  # esbuild strips types but does NOT typecheck: `npm run typecheck` (tsc --noEmit) is a separate,
  # required gate. See scripts/ci.sh.
  set -eu

  mkdir -p dist

  # An explicit banner, not --legal-comments: esbuild only preserves comments marked @license,
  # @preserve or //!, so an SPDX-only header would be stripped. MIT requires the notice to travel
  # with the code, so state it unconditionally.
  BANNER='/*! glk-touch — on-screen commands for GlkOte interactive fiction players.
   * SPDX-License-Identifier: MIT
   * Copyright (c) 2026 Doug Compton
   */'

  npx esbuild src/if-buttons.ts \
    --bundle \
    --format=iife \
    --target=es2018 \
    --banner:js="$BANNER" \
    --outfile=dist/glk-touch.js

  cp src/if-buttons.css dist/glk-touch.css

  echo "built dist/glk-touch.js and dist/glk-touch.css"
  ```

- [x] **Task 7.2: Independence gate**

  File: `scripts/check-independence.sh`

  ```bash
  #!/usr/bin/env sh
  # The addon must not know any particular host exists (§0.2). Fails if a host-specific identifier
  # appears in the source. Checked against src/ only: docs and the harness may name hosts freely.
  set -eu

  if grep -nE '\b(Parchmap|GameList|Navigator|Autocomplete|Consts|parchment_options)\b' src/*.ts; then
    echo "FAIL: host-specific reference found in src/ — the addon must stay host-agnostic." >&2
    exit 1
  fi
  echo "OK: no host-specific references in src/"
  ```

  > `Navigator` is on the list as a host global. If a legitimate DOM use of `navigator` is ever needed,
  > the lowercase form does not match this word-boundary pattern, so no exception is required.

- [x] **Task 7.3: Forge-agnostic CI runner**

  File: `scripts/ci.sh`

  ```bash
  #!/usr/bin/env sh
  # All gates, in the order that fails fastest. Deliberately forge-agnostic: call this one script from
  # Gitea Actions, GitLab CI, Jenkins, a git pre-push hook, or by hand. No forge-specific config to
  # keep in sync.
  set -eu

  echo "== typecheck ==";      npm run typecheck
  echo "== independence ==";   npm run lint:independence
  echo "== tests ==";          npm test
  echo "== build ==";          npm run build

  echo "== dist is a classic script =="
  if grep -nE '^[[:space:]]*(import|export)[[:space:]]' dist/glk-touch.js; then
    echo "FAIL: dist/glk-touch.js contains ESM syntax; hosts load it as a classic script." >&2
    exit 1
  fi

  echo "== dist matches src =="
  # --porcelain covers UNTRACKED files too: `git diff` alone would silently pass on a first build
  # where dist/ has never been committed.
  if [ -n "$(git status --porcelain -- dist/)" ]; then
    echo "FAIL: dist/ is stale or uncommitted — run 'npm run build' and commit the result." >&2
    git status --short -- dist/
    exit 1
  fi

  echo "ALL GATES PASSED"
  ```

  Run: `sh scripts/ci.sh`
  Expected: ends with `ALL GATES PASSED`.

- [x] **Task 7.4: Install documentation**

  File: `docs/INSTALL.md`

  ```markdown
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
  ```

- [x] **Task 7.5: README**

  File: `README.md` — cover, in this order: one-sentence description; the two-tag install; the
  tap-a-verb-then-a-word interaction in three lines; verified hosts (link `docs/COMPATIBILITY.md`);
  "how it works" naming **only** GlkOte's contract and stating plainly that it **works with or without**
  a map-providing host; development (`npm test`, `npm run typecheck`, `sh scripts/ci.sh`,
  `harness/README.md`); licence (MIT, Doug Compton).

  > A screenshot or GIF is genuinely valuable here but must be captured by a human from the harness —
  > record it as a follow-up rather than blocking the release.

- [ ] **Task 7.6: Tag a release**

  Order matters: `ci.sh` checks that `dist/` is committed, so build and commit **before** running it —
  on a first release `dist/` is untracked and the gate would fail otherwise.

  ```bash
  npm run build
  git add -A
  git commit -m "chore: release v0.1.0 — bundle, install docs, gates"
  sh scripts/ci.sh        # dist/ is now committed, so the currency gate passes
  git tag -a v0.1.0 -m "glk-touch v0.1.0 — tap-only commands for GlkOte IF players"
  ```

  A downstream deployment pins **this tag** and copies the §0.3 artifacts.

### Acceptance Criteria

| ID | Criterion | Maps to |
|----|-----------|---------|
| P7-AC1 | `dist/` is a classic-script IIFE built from `src/`, licence header intact | Task 7.1, Task 7.3 |
| P7-AC2 | The independence gate passes and is runnable anywhere | Task 7.2, Task 7.3 |
| P7-AC3 | All gates run from one forge-agnostic script | Task 7.3 |
| P7-AC4 | Install is two tags, documented for both hosts and generically | Task 7.4 |
| P7-AC5 | Troubleshooting explains each `inputMode()` value | Task 7.4 |
| P7-AC6 | A pinnable tag exists with the §0.3 artifacts | Task 7.6 |

---

## Phase Final: Quality Gate

- [x] **Task F.1: Typecheck**

  Run: `npm run typecheck`
  Expected: zero errors.

- [x] **Task F.2: Full test suite**

  Run: `npm test`
  Expected: all PASS, zero failures, zero skipped.

- [ ] **Task F.3: Independence gate**

  Run: `npm run lint:independence`
  Expected: `OK: no host-specific references in src/`

  Then confirm empirically: load the Parchment harness page (no Parchmap scripts present) and play a
  full turn by tapping only.

- [x] **Task F.4: All gates in one run**

  Run: `sh scripts/ci.sh`
  Expected: ends with `ALL GATES PASSED` — this also proves `dist/` is current and import-free.

- [ ] **Task F.5: Both hosts still pass manual verification**

  Re-run the Phase 5.2 and Phase 6.4 checklists against the harness. Expected: all steps pass, and
  `docs/COMPATIBILITY.md` has no unfilled `<placeholders>`.

- [x] **Task F.6: Final commit**

  ```bash
  git add -A
  git commit -m "chore: quality gate — typecheck, tests, independence, bundle, host verification"
  ```

---

## Unknowns

| # | Unknown | Impact | Resolved by |
|---|---------|--------|-------------|
| U1 | **Does Parchmap's map update from addon-submitted commands?** | **Highest** — a silently wrong map is worse than none | Task 6.1 (with a feature-detected, tested jQuery dispatch as the fix) |
| U2 | Does modern Parchment (AsyncGlk) emit `.Input.LineInput` or only `.Input`? | Medium — the fallback covers it, but `inputMode()`'s precision differs | Task 5.1 |
| U3 | Is `.MorePrompt` destroyed on dismissal, or kept and hidden? | Medium — if kept, the `isVisible()` guard is the only thing preventing a permanent input deadlock | Task 5.1 |
| U4 | Input-buffer collision with Parchmap's append-style `Input.js` | Medium — assignment is the guard | Task 6.2 |
| U5 | Story format Parchmap's legacy core accepts (raw vs `.js`-wrapped) and whether `?story=` reaches outside `games/` | Medium — affects the *deployment*, not the addon | Task 6.3 |
| U6 | Parchmap's real map-container selector | Low — narrow `MAP_SELECTORS` once known | Task 6.5 |
| U7 | iOS Safari: does `.value` + synthetic Enter reach the host? Android Chrome is near-certain; iPadOS is stricter about synthetic events | **Medium-high** — it is the primary target device | Task 5.3 on real hardware |
| U8 | Parchment release tarball layout (`dist/web/…`) — read from `master`, not a release artifact | Low | Task 4.1 |

---

## Self-Review Checklist

1. **Spec coverage** — cold-start context (§0), addon core (Phases 1–3), verb editor (D3, Phases 1–2),
   real-host harness (Phase 4), works with Parchment (Phase 5), works with Parchmap (Phase 6), works
   *without* any host (independence tests + Task F.3), packaging for the deployment (Phase 7). No gaps
   against the stated goal.
2. **AC ↔ Test mapping** — every AC names a test or a numbered manual task. Phases 3, 5, 6 ACs that
   cannot be unit-tested (CSS metrics, real-host behaviour, device touch) map to explicit manual
   scenarios with exact commands, not fabricated automated tests.
3. **Edge case coverage** — empty/null (T5, T7, T27, T42) · boundary (T8, T9, T35, P3-T2) · whitespace
   (T6) · special chars/security (T13, T21, T22) · conflict/duplicate (T10, T11, T20, T25, T33, T34) ·
   storage/data errors (T36, T37, T38) · concurrency/aliasing (T12, T17) · large input (T28, P3-T3) ·
   unicode (T29, T30) · coercion (T31) · platform (P3-T4, P3-T6, U7/Task 5.3) · protocol state (T14,
   T15, T16, T18, T19) · accessibility (T43, T44, T45, P3-T5) · **auth: N/A** — a client-side overlay
   with no accounts, server or secrets ·
   **RTL: partial** — `\p{L}` covers RTL scripts so behaviour is correct; no test asserts visual bidi
   order, as no RTL Z-machine stories are in scope.
4. **Placeholder scan** — no TBD/TODO. Values that cannot be known in advance are explicitly
   parameterised, each with the command that produces it: the Parchment release tag, the Parchmap
   commit SHA, and the `docs/COMPATIBILITY.md` findings. Task F.5 fails if any remain unfilled.
5. **Cross-phase consistency** — model exports (`normalizeWord`, `normalizeVerb`, `tokenize`,
   `createState`, `clearPending`, `tapVerb`, `tapWord`, `tapDirect`, `addVerb`, `removeVerb`,
   `DEFAULT_VERBS`, `MAX_COMMAND_LENGTH`, `MAX_VERBS`, `MAX_VERB_LENGTH`, `Token`, `CommandState`,
   `TapResult`) match the test imports exactly; glue exports (`findLineInput`, `inputMode`,
   `submitCommand`, `dismissMorePrompt`, `decorateBuffer`, `watchBuffer`, `buildBar`,
   `adoptHostFeatures`, `loadVerbs`, `saveVerbs`, `resetVerbs`, `addVerbFromUI`, `removeVerbFromUI`,
   `renderVerbs`, `boot`, `stopBoot`, `currentState`, `InputMode`) match every call in `dom-glue.test.ts`
   and the `window.IFButtons` handle;
   `TapResult` is the single result shape from all three tap functions; file paths are `src/*.ts` and
   `test/*.test.ts` throughout; phase cross-references verified (harness = 4, Parchment = 5,
   Parchmap = 6, packaging = 7).
6. **Commands are exact** — every `Run:` line is literal with its expected output.
7. **Deviations from the plan template** — the repo is greenfield, so "analyse the codebase first" was
   applied to the *integration targets*. Phase Final replaces a bundler/type-generation step with the
   typecheck, independence, classic-script and dist-currency gates, which are the meaningful invariants
   for an addon with no runtime dependencies.

---

## Sources

- [curiousdannii/parchment](https://github.com/curiousdannii/parchment) — MIT, **TypeScript**; release/web-build layout, single-file build, Site Generator
- [curiousdannii/asyncglk](https://github.com/curiousdannii/asyncglk) — "AsyncGlk: A Typescript Glk library"; the display layer current Parchment uses
- [Parchment `index.html`](https://github.com/curiousdannii/parchment/blob/master/index.html) — `#gameport`, `#windowport`, `dist/web/*` layout
- [Installing and Using Parchment Offline](https://groups.google.com/g/parchment/c/-BQsqdq6Wgo) — `parchment_options` (`default_story`, `lock_options`, `lock_story`, `page_title`)
- [GlkOte documentation](https://eblong.com/zarf/glk/glkote/docs.html) — JSON protocol, `{type:'line', gen, window, value, terminator}`, `extevent()`, `update()` input specs, `recording_handler`
- [GlkOte stylesheet](https://github.com/erkyrath/glkote) — `.BufferWindow`, `.BufferLine`, `.Input`, `.MorePrompt`, `.Style_*`
- [Parchment Proxy](https://iplayif.com/proxy/) — the CORS proxy is used only for cross-domain stories
- [roylaza/Parchmap](https://github.com/roylaza/Parchmap) — GPL-3.0, plain JS + jQuery; tree, activity, `fork: false`
  - [`js/Input.js`](https://github.com/roylaza/Parchmap/blob/main/js/Input.js) — `.Input.LineInput` injection, `$.Event("keypress", {which:13})`, `.Style_input` history reading
  - [`js/Directions.js`](https://github.com/roylaza/Parchmap/blob/main/js/Directions.js) — 12-direction parsing table, no button UI
  - [`js/GameList.js`](https://github.com/roylaza/Parchmap/blob/main/js/GameList.js) — hardcoded array, `.js`-suffixed filenames
  - [`lib/`](https://github.com/roylaza/Parchmap/tree/main/lib) — legacy Parchment core (`main.js`, `zvm.js`, `quixe.js`, `resourcemap.js`)
- [GNU GPL v3 §5](https://www.gnu.org/licenses/gpl-3.0.html#section5) — MIT/GPL combination: the aggregate/combined-work distinction
