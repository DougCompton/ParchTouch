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

/**
 * Shape of the console debugging handle assigned at the bottom of this file. Declared with `typeof`
 * so it cannot drift from the real functions, and so the troubleshooting docs and the end-to-end
 * suite get accurate types. Types are erased, so this costs the bundle nothing.
 */
export interface DebugHandle {
  findLineInput: typeof findLineInput
  inputMode: typeof inputMode
  submitCommand: typeof submitCommand
  dismissMorePrompt: typeof dismissMorePrompt
  decorateBuffer: typeof decorateBuffer
  watchBuffer: typeof watchBuffer
  buildBar: typeof buildBar
  adoptHostFeatures: typeof adoptHostFeatures
  loadVerbs: typeof loadVerbs
  saveVerbs: typeof saveVerbs
  resetVerbs: typeof resetVerbs
  addVerbFromUI: typeof addVerbFromUI
  removeVerbFromUI: typeof removeVerbFromUI
  renderVerbs: typeof renderVerbs
  boot: typeof boot
  stopBoot: typeof stopBoot
  currentState: typeof currentState
}

declare global {
  interface Window {
    /**
     * Console debugging handle — see the assignment at the bottom of this file. Not optional: the
     * module assigns it at load, so it is always present to anything running afterwards.
     */
    IFButtons: DebugHandle
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
 *
 * ONLY `keypress` IS DISPATCHED, AND THAT IS LOAD-BEARING. Do not "restore" keydown/keyup.
 *
 * Measured against both reference hosts, submitting `east` from the same starting room:
 *
 *   host                    keydown+keypress+keyup   keydown only   keypress only
 *   ----------------------  -----------------------  -------------  -------------
 *   modern GlkOte/AsyncGlk  delivered                nothing        delivered
 *   legacy jQuery GlkOte    EMPTY COMMAND SENT       nothing        delivered
 *
 * The legacy failure is the dangerous one and it is caused by the keydown. That host binds its own
 * keydown handler on <body>; our keydown bubbles to it, it clears the input field and submits, so the
 * interpreter reads an empty line ("I beg your pardon?") and the player silently loses a turn — while
 * our later keypress finds nothing left to send. Dispatching keypress alone satisfies both hosts,
 * needs no jQuery, and keeps this host-agnostic (§0.2).
 *
 * keypress is formally deprecated but is still what GlkOte cores listen on. If a future host ever
 * listens only on keydown, add it back behind evidence and a test — not on principle.
 */
function fireKey(el: EventTarget, key: string, keyCode: number): void {
  const e = new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key, code: key })
  try {
    Object.defineProperty(e, 'keyCode', { get: () => keyCode })
    Object.defineProperty(e, 'which', { get: () => keyCode })
    // jQuery derives `which` for keypress from charCode when present, and a jQuery-based host bails
    // on a falsy which — so carry the code here too.
    Object.defineProperty(e, 'charCode', { get: () => keyCode })
  } catch {
    // Already non-configurable on this engine; the key/code properties still carry the intent.
  }
  el.dispatchEvent(e)
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
  // ASSIGN, never append. A host may have left a partial command in the field, and assignment
  // discards that residue in one step. Do NOT clear-then-write: the extra empty-value 'input'
  // event can trip a host's autocomplete for no benefit.
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
 * Wrap words in .ifb-word spans so they can be tapped as nouns. Every insertion goes through a TEXT
 * sink (textContent / createTextNode) and never through an HTML-parsing sink, so story text can
 * never inject markup.
 *
 * Also installs the tap delegation (see ensureWordClicks): decorating without wiring the taps would
 * produce spans that look interactive and do nothing.
 */
export function decorateBuffer(root: Element | null): void {
  if (!root) { return }
  ensureWordClicks(root)
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
          span.textContent = t.text          // text sink only, never an HTML-parsing sink
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

/**
 * Install the single click delegate that turns a .ifb-word tap into tapWord().
 *
 * WHY DELEGATED, AND WHY HERE: a per-span listener would have to be re-attached on every mutation
 * and would leak with the spans. One delegate on the .BufferWindow covers every word, present and
 * future, for free.
 *
 * WHY THE .BufferWindow SPECIFICALLY, and not `document`:
 *  - the .BufferWindow is torn down and rebuilt with the page, so the listener dies with the module
 *    instance that created it. A document-level listener would outlive a module reload and a stale
 *    closure would then submit a second copy of every command.
 *  - it is the single common ancestor of every .BufferLine, so exactly ONE handler ever sees a word
 *    click. Attaching to each line as well would double-fire and re-arm the noun.
 * `data-ifb-clickable` makes re-entry idempotent, so decorateBuffer() and watchBuffer() can both
 * call this on every pass.
 */
function ensureWordClicks(near?: Element | null): void {
  const bw = near?.closest<HTMLElement>('.BufferWindow') ?? bufferWindow()
  if (!bw) { return }
  if (bw.getAttribute('data-ifb-clickable') === '1') { return }
  bw.setAttribute('data-ifb-clickable', '1')
  bw.addEventListener('click', e => {
    const t = e.target
    // One tokenizer-produced word only: normalizeWord tolerates inner spaces, so a multi-word
    // string here could smuggle an Inform command separator into the line.
    if (t instanceof HTMLElement && t.classList.contains('ifb-word')) {
      apply(tapWord(state, t.textContent), t)
    }
  })
}

export function watchBuffer(): boolean {
  const bw = bufferWindow()
  if (!bw) { return false }
  decorateBuffer(bw)

  if (bw.getAttribute('data-ifb-observed') !== '1') {
    bw.setAttribute('data-ifb-observed', '1')
    new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n instanceof Element) { decorateBuffer(n) }
        }
      }
    }).observe(bw, { childList: true, subtree: true })
  }

  ensureWordClicks(bw)
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
  // A removeChild loop, deliberately NOT the ES2020-era bulk child-replacement DOM method: that one
  // needs Safari 14+ and would silently raise the browser floor above the ES2018 target this addon
  // advertises.
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
    // Free text goes through addVerbFromUI -> normalizeVerb, NEVER tapWord.
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
