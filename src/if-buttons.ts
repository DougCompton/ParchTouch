/*
 * if-buttons.ts — touch command overlay for GlkOte-based interactive fiction players.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 *
 * WHY: parser IF needs typed commands, which is painful on a tablet. This adds an on-screen bar and
 * makes every word in the story text tappable, so a session needs no keyboard.
 *
 * THE INTERACTION MODEL, left to right across the bar:
 *   .ifb-moves    the direction pad. Directions SEND immediately — movement is wanted every turn and
 *                 is unambiguous, so confirming it would double the taps for the commonest action. With
 *                 a verb armed the direction is that verb's OBJECT and the pair is sent, so Look then N
 *                 is `look north`. Its centre is ↵ (send what is staged) and its corner the gear.
 *   .ifb-verbs    one editable list holding every other word, from `look` to `take`. A tap STAGES text
 *                 into the host's input and sends nothing; the player reviews it and presses ↵. Verb
 *                 and noun pair in either order — tap Examine then a word, or a word then Examine.
 *   .ifb-actions  ✕ (abandon the composition) and, when a map host is detected, the map toggle. The
 *                 only non-movement controls that act on the spot, because neither sends a command.
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
  createState, clearPending, tapVerb, tapWord, tapDirect, tokenize,
  DEFAULT_VERBS,
  addVerb as addVerbToList, removeVerb as removeVerbFromList, moveVerb as moveVerbInList,
  sanitizeLayouts, layoutNames, activeWords, setActiveWords, emptyLayouts,
  switchLayout as switchLayoutIn, createLayout as createLayoutIn,
  renameLayout as renameLayoutIn, deleteLayout as deleteLayoutIn,
  type CommandState, type TapResult, type LayoutStore,
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
  stageCommand: typeof stageCommand
  cancelPending: typeof cancelPending
  pressEnter: typeof pressEnter
  tapDirection: typeof tapDirection
  dismissMorePrompt: typeof dismissMorePrompt
  decorateBuffer: typeof decorateBuffer
  watchBuffer: typeof watchBuffer
  buildBar: typeof buildBar
  adoptHostFeatures: typeof adoptHostFeatures
  measureBar: typeof measureBar
  loadVerbs: typeof loadVerbs
  saveVerbs: typeof saveVerbs
  loadLayouts: typeof loadLayouts
  saveLayouts: typeof saveLayouts
  listLayouts: typeof listLayouts
  activeLayout: typeof activeLayout
  switchToLayout: typeof switchToLayout
  createLayout: typeof createLayout
  renameActiveLayout: typeof renameActiveLayout
  deleteActiveLayout: typeof deleteActiveLayout
  resetVerbs: typeof resetVerbs
  addVerbFromUI: typeof addVerbFromUI
  removeVerbFromUI: typeof removeVerbFromUI
  moveVerbFromUI: typeof moveVerbFromUI
  selectVerb: typeof selectVerb
  selectedVerbName: typeof selectedVerbName
  moveSelected: typeof moveSelected
  deleteSelected: typeof deleteSelected
  renderVerbs: typeof renderVerbs
  openEditor: typeof openEditor
  closeEditor: typeof closeEditor
  toggleEditor: typeof toggleEditor
  isEditorOpen: typeof isEditorOpen
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

/*
 * Storage keys. LAYOUTS_KEY holds everything now — which layout is in use and the words in each.
 * VERBS_KEY is the ORIGINAL key, still read so that a list saved before layouts existed becomes the
 * default layout rather than being silently lost. Nothing writes it any more.
 */
const LAYOUTS_KEY = 'IFB_Layouts'
const VERBS_KEY = 'IFB_Verbs'

/** label, command */
const MOVES: ReadonlyArray<readonly [string, string]> = [
  ['NW', 'northwest'], ['N', 'north'], ['NE', 'northeast'],
  ['W', 'west'], ['E', 'east'],
  ['SW', 'southwest'], ['S', 'south'], ['SE', 'southeast'],
  ['Up', 'up'], ['Down', 'down'],
]
// Candidate selectors for an OPTIONAL map panel. Deliberately generic — this is capability
// detection, not host detection; narrow it only when a real host is verified (Task 6.5).
const MAP_SELECTORS = '#map, #map-container, .map-container, [data-if-map]'
// Below this, a viewport-pinned panel is moved rather than shrunk: capping its height would collapse it.
const MIN_LIFTED_HEIGHT = 24
// A pointer must travel this far before it counts as a drag rather than a tap, so a slightly shaky
// finger still selects instead of silently reordering.
const MIN_DRAG_PX = 6

let state: CommandState = createState()
let bootTimer: ReturnType<typeof setTimeout> | null = null
let barSizeObserver: ResizeObserver | null = null
let barResizeBound = false
/** The word currently picked out in the settings list; the move and delete buttons act on it. */
let selectedVerb: string | null = null

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

/**
 * Press Return on the host's input exactly as it stands — the centre button of the movement pad.
 *
 * Deliberately does NOT write a value. It submits whatever is already in the field, so it covers the
 * cases a command button cannot: a partially typed line, a "press any key" char prompt, and a pager.
 * Those last two are the states where a tap otherwise appears to do nothing.
 *
 * Leaves any armed verb or noun alone: this is a keyboard passthrough, not a command being built.
 * Returns true only when a Return actually reached a line input.
 */
export function pressEnter(): boolean {
  const mode = inputMode()
  if (mode === 'more') {
    dismissMorePrompt()
    return false
  }
  if (mode === 'char') {
    // A char prompt accepts any key, and Enter is the one this button represents.
    const bw = bufferWindow()
    if (bw) { fireKey(bw, 'Enter', 13) }
    return false
  }
  const el = findLineInput()
  if (!el) { return false }
  el.focus()
  fireKey(el, 'Enter', 13)
  return true
}

/**
 * Write text into the host's input WITHOUT sending it, so the player can review it and press ↵.
 *
 * Assigns rather than appends, for the same reason submitCommand() does: the composed text already
 * contains the whole command, and a host may have left residue in the field.
 */
export function stageCommand(text: string): boolean {
  const el = findLineInput()
  if (!el) { return false }
  el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

/** Clear the composition: nothing armed, nothing staged in the field. */
export function cancelPending(): void {
  state = clearPending(state)
  renderArmed(null)
  stageCommand('')
}

/**
 * How a tap reaches the game.
 *
 *  'send'  — deliver immediately. Movement only: a direction is unambiguous and wanted every turn, so
 *            making the player confirm it would double the taps for the commonest action.
 *  'stage' — write the composition into the input and stop. Everything in the verb strip works this
 *            way, so a mis-tap costs nothing and the player sees exactly what will be sent before
 *            pressing ↵.
 */
type Delivery = 'send' | 'stage'

/**
 * A tap on the direction pad.
 *
 * With a verb armed, the direction is that verb's OBJECT, not a movement command: tapping Look then N
 * means `look north`. It used to mean plain `north`, because tapDirect() is defined to drop anything
 * armed — correct when Look was itself a direct command, but silently destructive now that every word
 * is staged and waiting for something to complete it.
 *
 * Either way it SENDS at once. A direction is wanted every turn and is unambiguous, so it is the one
 * thing not worth confirming; routing through tapWord() keeps the verb+object pairing rules in the
 * model rather than duplicating them here.
 */
export function tapDirection(direction: string): void {
  if (state.pendingVerb !== null) {
    apply(tapWord(state, direction), null, 'send')
    return
  }
  apply(tapDirect(state, direction), null, 'send')
}

function apply(res: TapResult, armEl: HTMLElement | null, delivery: Delivery): void {
  state = res.state
  renderArmed(armEl)

  if (delivery === 'send') {
    if (res.command) { submitCommand(res.command) }
    return
  }

  /*
   * Show whatever the composition currently amounts to: the finished command once a pair completes, or
   * the half of it that is armed so far. Reading it out of the model rather than appending to the field
   * is what preserves either-order pairing — tapping "lamp" then Examine still stages "examine lamp"
   * and not "lamp examine".
   */
  const composed = res.command ?? state.pendingVerb ?? state.pendingNoun
  if (composed !== null) { stageCommand(composed) }
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
      apply(tapWord(state, t.textContent), t, 'stage')
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
/** Read whatever is stored, tolerating absence, corruption and the pre-layouts format. */
export function loadLayouts(): LayoutStore {
  try {
    const raw = window.localStorage.getItem(LAYOUTS_KEY)
    if (raw) { return sanitizeLayouts(JSON.parse(raw) as unknown) }
  } catch {
    // Unreadable or unparseable: fall through to the legacy key, then to the defaults.
  }
  try {
    // A list saved before layouts existed becomes the default layout instead of being lost.
    const legacy = window.localStorage.getItem(VERBS_KEY)
    if (legacy) { return sanitizeLayouts(JSON.parse(legacy) as unknown) }
  } catch {
    // As above.
  }
  return emptyLayouts()
}

export function saveLayouts(store: LayoutStore): void {
  try {
    window.localStorage.setItem(LAYOUTS_KEY, JSON.stringify(store))
  } catch {
    // Storage unavailable or full: edits simply won't persist. Not worth interrupting play.
  }
}

/** The words of the layout in use. */
export function loadVerbs(): string[] {
  const words = activeWords(loadLayouts())
  return words.length === 0 && !hasStoredLayouts() ? DEFAULT_VERBS.slice() : words
}

/** Replace the words of the layout in use. */
export function saveVerbs(list: readonly string[]): void {
  saveLayouts(setActiveWords(loadLayouts(), list))
}

/** True when something has actually been stored, as opposed to us falling back to the defaults. */
function hasStoredLayouts(): boolean {
  try {
    return window.localStorage.getItem(LAYOUTS_KEY) !== null
      || window.localStorage.getItem(VERBS_KEY) !== null
  } catch {
    return false
  }
}

// ── layout management ────────────────────────────────────────────────────────────────────────────
export function listLayouts(): string[] { return layoutNames(loadLayouts()) }
export function activeLayout(): string { return loadLayouts().active }

function commitLayouts(next: LayoutStore): void {
  saveLayouts(next)
  renderVerbs()
  renderEditor()
}

export function switchToLayout(name: string): void { commitLayouts(switchLayoutIn(loadLayouts(), name)) }
export function createLayout(name: string): void { commitLayouts(createLayoutIn(loadLayouts(), name)) }
export function renameActiveLayout(to: string): void {
  const store = loadLayouts()
  commitLayouts(renameLayoutIn(store, store.active, to))
}
export function deleteActiveLayout(): void {
  const store = loadLayouts()
  commitLayouts(deleteLayoutIn(store, store.active))
}

/** Restore the shipped words for the layout in use, leaving any other layout alone. */
export function resetVerbs(): void {
  saveLayouts(setActiveWords(loadLayouts(), DEFAULT_VERBS.slice()))
  selectedVerb = null
  renderVerbs()
  renderEditor()
}

export function addVerbFromUI(verb: string): void {
  saveVerbs(addVerbToList(loadVerbs(), verb))
  renderVerbs()
  renderEditor()
}

export function removeVerbFromUI(verb: string): void {
  if (selectedVerb === verb) { selectedVerb = null }
  saveVerbs(removeVerbFromList(loadVerbs(), verb))
  renderVerbs()
  renderEditor()
}

/** Move a word to a new position, then re-render the strip and the settings list. */
export function moveVerbFromUI(verb: string, toIndex: number): void {
  saveVerbs(moveVerbInList(loadVerbs(), verb, toIndex))
  renderVerbs()
  renderEditor()
}

/**
 * Pick out a word in the settings list, or clear the selection with null.
 *
 * Selection exists so that DESTRUCTIVE and REORDERING actions are a deliberate second step. Tapping a
 * word used to delete it outright, which is unforgiving on a touch screen and made the same surface
 * impossible to drag — a drag ends in a tap.
 */
export function selectVerb(verb: string | null): void {
  selectedVerb = verb !== null && loadVerbs().includes(verb) ? verb : null
  renderSelection()
}

export function selectedVerbName(): string | null { return selectedVerb }

/** Reflect the selection in the chips and in whether the actions are usable. */
function renderSelection(): void {
  for (const chip of document.querySelectorAll<HTMLElement>('#ifb-editor .ifb-verbchip')) {
    const on = chip.getAttribute('data-verb') === selectedVerb
    chip.classList.toggle('ifb-selected', on)
    chip.setAttribute('aria-pressed', String(on))
  }
  const has = selectedVerb !== null
  for (const sel of ['.ifb-moveleft', '.ifb-moveright', '.ifb-deleteverb']) {
    const btn = document.querySelector<HTMLButtonElement>('#ifb-editor ' + sel)
    if (btn) { btn.disabled = !has }
  }
}

/** Shift the selected word one place, keeping it selected and focused afterwards. */
export function moveSelected(delta: number): void {
  const verb = selectedVerb
  if (verb === null) { return }
  const at = loadVerbs().indexOf(verb)
  if (at === -1) { return }
  moveVerbFromUI(verb, at + delta)
  document.querySelector<HTMLElement>('#ifb-editor .ifb-verbchip[data-verb="' + verb + '"]')?.focus()
}

/** Remove the selected word. */
export function deleteSelected(): void {
  if (selectedVerb !== null) { removeVerbFromUI(selectedVerb) }
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
    // A host command like `/note` is shown verbatim: capitalising it would only uppercase the slash,
    // and these read as literal commands rather than English words.
    const label = v.startsWith('/') ? v : v.charAt(0).toUpperCase() + v.slice(1)
    host.appendChild(button(label, 'ifb-verb', btn => apply(tapVerb(state, v), btn, 'stage')))
  }
  measureBar()          // a different number of verbs is a different bar height
}

/*
 * A word in the settings list.
 *
 * A real <button>, so it is focusable and clickable for free and satisfies the rule that every control
 * in the bar is a button rather than a clickable div. Tapping it SELECTS it; the move and delete
 * buttons then act on that selection. It is also a drag handle — see enableChipDragging.
 */
function verbChip(verb: string): HTMLButtonElement {
  const chip = button(verb, 'ifb-verbchip', () => {
    // A drag finishes with a pointer-up on this button, which the browser also reports as a click.
    // Without this the reorder would immediately be followed by a selection toggle.
    if (suppressNextChipClick) { suppressNextChipClick = false; return }
    selectVerb(selectedVerb === verb ? null : verb)
  }, verb + ' — tap to select, drag to reorder')
  chip.setAttribute('data-verb', verb)
  chip.setAttribute('aria-pressed', String(selectedVerb === verb))

  chip.addEventListener('keydown', e => {
    // Reordering must not be drag-only, or it is unusable without a pointer.
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      selectVerb(verb)
      moveSelected(e.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeVerbFromUI(verb)
    }
  })

  return chip
}

/** True while a pointer-up should not be treated as a tap, because it ended a drag. */
let suppressNextChipClick = false

/** Index of a chip among its siblings, or -1. */
function chipIndex(chip: Element): number {
  return chip.parentElement ? [...chip.parentElement.children].indexOf(chip) : -1
}

/*
 * Drag-to-reorder, including touch on a tablet.
 *
 * Pointer Events when available, mouse + touch otherwise: the addon advertises Safari 11.1, which
 * predates Pointer Events. HTML5 drag-and-drop is not an option at all — it does nothing on touch,
 * which is the primary target device.
 *
 * The chip is moved through the DOM as the pointer passes its neighbours, so the list previews the
 * result with no ghost element to keep in sync, and the new index is read back from DOM order on
 * release. `touch-action: none` on the chip is what stops the browser scrolling the bar instead of
 * letting the drag through.
 */
function enableChipDragging(list: HTMLElement): void {
  let chip: HTMLElement | null = null
  let originX = 0
  let moved = false

  const pointFrom = (e: Event): { x: number; y: number } | null => {
    const t = (e as TouchEvent).touches
    if (t && t.length > 0) {
      const first = t[0]
      return first ? { x: first.clientX, y: first.clientY } : null
    }
    const m = e as MouseEvent
    return typeof m.clientX === 'number' ? { x: m.clientX, y: m.clientY } : null
  }

  const start = (e: Event): void => {
    const target = e.target
    if (!(target instanceof Element)) { return }
    const found = target.closest<HTMLElement>('.ifb-verbchip')
    if (!found || found.parentElement !== list) { return }
    const p = pointFrom(e)
    chip = found
    originX = p ? p.x : 0
    moved = false
  }

  const move = (e: Event): void => {
    if (!chip) { return }
    const p = pointFrom(e)
    if (!p) { return }
    if (!moved && Math.abs(p.x - originX) < MIN_DRAG_PX) { return }   // still just a tap
    if (!moved) { moved = true; chip.classList.add('ifb-dragging') }
    // Only now claim the gesture, so a tap is left alone entirely.
    if (e.cancelable) { e.preventDefault() }

    // Keep a long list reachable mid-drag by nudging the bar when near its edges.
    const bar = document.getElementById('ifb-bar')
    if (bar) {
      const r = bar.getBoundingClientRect()
      if (p.y < r.top + 36) { bar.scrollTop -= 12 }
      else if (p.y > r.bottom - 36) { bar.scrollTop += 12 }
    }

    const under = document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>('.ifb-verbchip')
    if (!under || under === chip || under.parentElement !== list) { return }
    const box = under.getBoundingClientRect()
    // Insert before or after by which half we are over, so a slow drag does not oscillate.
    list.insertBefore(chip, p.x > box.left + box.width / 2 ? under.nextSibling : under)
  }

  const end = (): void => {
    if (!chip) { return }
    const dropped = chip
    const wasDrag = moved
    chip = null
    moved = false
    if (!wasDrag) { return }                 // a tap: leave it to the click handler to select
    dropped.classList.remove('ifb-dragging')
    suppressNextChipClick = true
    const verb = dropped.getAttribute('data-verb')
    const to = chipIndex(dropped)
    if (verb !== null && to !== -1) {
      selectedVerb = verb                    // a dragged word stays selected
      moveVerbFromUI(verb, to)
      document.querySelector<HTMLElement>('#ifb-editor .ifb-verbchip[data-verb="' + verb + '"]')?.focus()
    }
  }

  if (typeof window.PointerEvent === 'function') {
    list.addEventListener('pointerdown', start)
    list.addEventListener('pointermove', move)
    list.addEventListener('pointerup', end)
    list.addEventListener('pointercancel', end)
  } else {
    list.addEventListener('mousedown', start)
    list.addEventListener('touchstart', start, { passive: false })
    list.addEventListener('mousemove', move)
    list.addEventListener('touchmove', move, { passive: false })
    list.addEventListener('mouseup', end)
    list.addEventListener('touchend', end)
    list.addEventListener('touchcancel', end)
  }
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
  // Close comes FIRST: while the editor is open it replaces the whole control row, so this is the
  // only way back to the buttons — including back to the ⚙ that opened it.
  row.appendChild(button('✕ Close', 'ifb-closeeditor', () => { closeEditor() }, 'Close settings'))
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'ifb-textfield ifb-newverb'
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

  /*
   * Actions on the SELECTED word, sharing the top row. Kept separate from the words themselves because
   * tapping a word used to delete it on the spot — unforgiving on a touch screen, and it made that same
   * surface impossible to drag, since a drag ends in a tap. A tap now only selects; reordering or
   * deleting is a deliberate second press, and both stay disabled until there is something to act on.
   */
  row.appendChild(button('◀', 'ifb-moveleft', () => { moveSelected(-1) },
    'Move the selected word earlier'))
  row.appendChild(button('▶', 'ifb-moveright', () => { moveSelected(1) },
    'Move the selected word later'))
  row.appendChild(button('Delete', 'ifb-deleteverb', () => { deleteSelected() },
    'Delete the selected word'))
  panel.appendChild(row)

  /*
   * Layout management. Its own row because the row above is already full, and because switching sets is
   * a different kind of act from editing the words in one.
   */
  const layouts = document.createElement('div')
  layouts.className = 'ifb-editrow ifb-editlayouts'

  const picker = document.createElement('select')
  picker.className = 'ifb-layoutpicker'
  picker.setAttribute('aria-label', 'Layout in use')
  const current = activeLayout()
  for (const name of listLayouts()) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name              // textContent: a layout name is user input
    if (name === current) { opt.selected = true }
    picker.appendChild(opt)
  }
  picker.addEventListener('change', () => { switchToLayout(picker.value) })
  layouts.appendChild(picker)

  const layoutName = document.createElement('input')
  layoutName.type = 'text'
  layoutName.className = 'ifb-textfield ifb-layoutname'
  layoutName.placeholder = 'layout name'
  layoutName.setAttribute('aria-label', 'Layout name, for New and Rename')
  layoutName.setAttribute('autocapitalize', 'none')
  layouts.appendChild(layoutName)

  layouts.appendChild(button('New', 'ifb-newlayout', () => {
    createLayout(layoutName.value)
    layoutName.value = ''
  }, 'Create a layout with this name, starting from the default words'))
  layouts.appendChild(button('Rename', 'ifb-renamelayout', () => {
    renameActiveLayout(layoutName.value)
    layoutName.value = ''
  }, 'Rename the layout in use'))
  const dropLayout = button('Drop', 'ifb-droplayout', () => { deleteActiveLayout() },
    'Delete the layout in use')
  // There must always be one layout left to play with.
  dropLayout.disabled = listLayouts().length <= 1
  layouts.appendChild(dropLayout)
  panel.appendChild(layouts)

  const list = document.createElement('div')
  list.className = 'ifb-verblist'
  for (const v of loadVerbs()) { list.appendChild(verbChip(v)) }
  enableChipDragging(list)
  panel.appendChild(list)

  renderSelection()      // the list was just rebuilt, so re-apply the highlight and button states
  measureBar()
}

/*
 * The editor takes the place of the buttons rather than sitting alongside them.
 *
 * WHY: the bar is capped at three button rows, so a panel stacked underneath would either blow that
 * budget or be squeezed to nothing. Swapping the control row out gives the editor the whole bar, and
 * the player gets the buttons back with its Close button. The state lives as a class on #ifb-bar so a
 * single CSS rule swaps the two, with no inline styles to unpick.
 */
export function openEditor(): void {
  const bar = document.getElementById('ifb-bar')
  if (!bar) { return }
  renderEditor()                 // build the contents BEFORE showing, so nothing flashes empty
  bar.classList.add('ifb-editing')
  measureBar()
}

export function closeEditor(): void {
  const bar = document.getElementById('ifb-bar')
  if (!bar) { return }
  bar.classList.remove('ifb-editing')
  measureBar()
}

export function isEditorOpen(): boolean {
  return document.getElementById('ifb-bar')?.classList.contains('ifb-editing') ?? false
}

export function toggleEditor(): void {
  if (isEditorOpen()) { closeEditor() } else { openEditor() }
}

export function buildBar(): HTMLElement {
  const existing = document.getElementById('ifb-bar')
  if (existing) { return existing }

  const bar = document.createElement('div')
  bar.id = 'ifb-bar'

  /*
   * One row holding the pad and everything else, with the verb editor as a separate full-width panel
   * beneath it. Without this wrapper the bar was a single wrapping flex line, so the verb and command
   * groups dropped BELOW the pad once they ran out of width instead of staying to its right.
   */
  const row = document.createElement('div')
  row.className = 'ifb-row'

  /*
   * The movement pad, a 4x3 grid laid out by the stylesheet:
   *
   *     NW   N   NE   Up
   *     W    ↵    E    Down
   *     SW   S   SE   (gear)
   *
   * ↵ and the gear are NOT .ifb-move — only the ten directions carry that class, so anything
   * asking "what are the movement buttons?" still gets exactly the compass. DOM order is the ten
   * directions, then ↵, then the gear; the stylesheet places them, so reading order and tab order
   * differ slightly in the middle row. Acceptable for a touch pad, and the alternative is fragile
   * sibling-index CSS.
   */
  const moves = document.createElement('div')
  moves.className = 'ifb-group ifb-moves'
  for (const [label, cmd] of MOVES) {
    moves.appendChild(button(label, 'ifb-move', () => { tapDirection(cmd) }))
  }
  // Labelled with the return glyph, not the word "Enter": `enter` is also one of the default VERBS
  // (go in / board), and two adjacent buttons reading "Enter" with different behaviour is a trap.
  // Icon-only, so the accessible name carries the meaning — as with ✕, ⚙ and ⊞.
  moves.appendChild(button('↵', 'ifb-enter', () => { pressEnter() },
    'Press Enter — submit the input as it stands, or advance a prompt'))
  moves.appendChild(button('⚙', 'ifb-editverbs', () => { toggleEditor() }, 'Settings — edit the word list'))
  row.appendChild(moves)

  const verbs = document.createElement('div')
  verbs.className = 'ifb-group ifb-verbs'
  row.appendChild(verbs)

  /*
   * The two immediate actions, stacked vertically at the right-hand end. They are the only controls
   * outside the pad that act on the spot rather than staging text: ✕ abandons the composition, and the
   * map toggle is a view control that never touches the game. Everything else that used to live here —
   * look, inventory, again, undo, save, restore and the rest — is now an ordinary entry in the verb
   * list, staged like any other word and sent with ↵.
   */
  const actions = document.createElement('div')
  actions.className = 'ifb-group ifb-actions'
  actions.appendChild(button('✕', 'ifb-cancel', () => { cancelPending() },
    'Clear the command being built'))
  row.appendChild(actions)

  bar.appendChild(row)

  const editor = document.createElement('div')
  editor.id = 'ifb-editor'
  bar.appendChild(editor)

  document.body.appendChild(bar)
  renderVerbs()
  watchBarSize(bar)
  return bar
}

/*
 * Give the bar its own strip of the viewport, so it cannot cover host UI.
 *
 * Padding .BufferWindow is enough for the story text, but only for the story text. A host is free to
 * pin other panels to the VIEWPORT, and those ignore both body padding and anything done to the buffer.
 * Measured on a real map-providing host at 820x1100: its map panel (fixed, top:0 bottom:0) and its game
 * frame (fixed, top:20 bottom:20) both ran to the bottom of the screen, so the bar sat on top of the
 * map's lower third and its own footer — "it hides the whole bottom".
 *
 * The rule is capability-based, not host-based (§0.2): anything pinned to the viewport that reaches
 * into the bar's strip gets moved out of it. Which property to change depends on which edge is pinned,
 * and getting that wrong is why the obvious attempts fail:
 *   - top pinned AND tall enough  -> cap max-height. Setting `bottom` alone does nothing, because an
 *     element with both top and height set is over-constrained and `bottom` is ignored.
 *   - top pinned but short        -> shift `top` up instead, since capping height would collapse it.
 *   - top auto (bottom-anchored)  -> raise `bottom`.
 *
 * Every run first undoes its own previous work, so it always measures the host's natural layout and
 * stays correct across resizes, rotations and bar-height changes. Failures are swallowed per element:
 * a host layout we cannot help is left exactly as it was rather than half-adjusted.
 */
function reserveViewportBottom(barTop: number, barHeight: number): void {
  // Undo the previous pass so what we measure below is the host's own layout, not ours.
  for (const el of document.querySelectorAll<HTMLElement>('[data-ifb-lifted]')) {
    el.style.removeProperty('max-height')
    el.style.removeProperty('bottom')
    el.style.removeProperty('top')
    el.style.removeProperty('overflow-y')
    el.removeAttribute('data-ifb-lifted')
  }
  if (barHeight <= 0) { return }

  const bar = document.getElementById('ifb-bar')
  const candidates: HTMLElement[] = [document.body, ...document.querySelectorAll<HTMLElement>('body *')]

  for (const el of candidates) {
    try {
      if (el === bar || bar?.contains(el)) { continue }
      const cs = window.getComputedStyle(el)
      if (cs.position !== 'fixed') { continue }        // only the viewport-pinned can ignore everything else

      const rect = el.getBoundingClientRect()
      const overlap = rect.bottom - barTop
      if (overlap <= 1 || rect.height < 8) { continue }

      const topPinned = cs.top !== 'auto'
      if (topPinned && rect.height - overlap >= MIN_LIFTED_HEIGHT) {
        el.style.setProperty('max-height', Math.round(rect.height - overlap) + 'px', 'important')
      } else if (topPinned) {
        // Too short to shrink without collapsing it, so move it instead.
        const top = Number.parseFloat(cs.top)
        if (!Number.isFinite(top)) { continue }
        el.style.setProperty('top', Math.round(top - overlap) + 'px', 'important')
      } else {
        const bottom = Number.parseFloat(cs.bottom)
        el.style.setProperty('bottom', Math.round((Number.isFinite(bottom) ? bottom : 0) + barHeight) + 'px', 'important')
      }
      el.setAttribute('data-ifb-lifted', '1')
    } catch {
      // A host layout we cannot adjust is left alone. Degrade, never throw (§0.2).
    }
  }

  /*
   * Shortening a panel is only half the job. If its content is taller than the panel and the panel does
   * not clip, that content paints straight over the bar anyway — a map host's room list did exactly
   * this, spilling 67px past a correctly-shortened map. Letting the panel scroll its own overflow keeps
   * the content reachable instead of hiding it.
   *
   * Must be a SECOND pass: clientHeight only reflects the new height after the cap above is applied.
   * Only touched when the host left overflow visible, so a deliberate `hidden` or an existing scroller
   * is never overridden.
   */
  for (const el of document.querySelectorAll<HTMLElement>('[data-ifb-lifted]')) {
    try {
      if (window.getComputedStyle(el).overflowY !== 'visible') { continue }
      if (el.scrollHeight <= el.clientHeight + 2) { continue }
      el.style.setProperty('overflow-y', 'auto', 'important')
    } catch {
      // As above: leave a layout we cannot help exactly as it was.
    }
  }
}

/**
 * Reserve exactly as much room for the bar as it actually occupies.
 *
 * WHY THIS IS NOT A FIXED NUMBER. The bar is a fixed overlay, so the story text has to be padded out
 * from underneath it. The stylesheet's original 190px guess was wrong: a full bar measures 369px on a
 * portrait tablet, which left 173px of output — including the live input line — permanently hidden
 * beneath the overlay AND unreachable, because the buffer was already scrolled to its end. Measuring
 * removes the guess, and keeps working when the verb list changes, the editor opens, a map host
 * shrinks the targets, or the device rotates.
 *
 * The stylesheet caps the bar at three button rows and scrolls beyond that, so what is reserved can
 * never run away either.
 *
 * Returns the height applied, or 0 when there is no bar or no layout to measure (jsdom reports every
 * box as zero-sized, so this degrades to doing nothing there).
 */
export function measureBar(): number {
  const bar = document.getElementById('ifb-bar')
  if (!bar) { return 0 }
  const height = Math.ceil(bar.getBoundingClientRect().height)
  if (height <= 0) { return 0 }

  const root = document.documentElement
  const next = height + 'px'
  if (root.style.getPropertyValue('--ifb-bar-height') === next) { return height }

  // Growing the padding lengthens the scrollable area, which would otherwise strand a reader who was
  // looking at the newest line. Keep them pinned to the end if that is where they already were.
  const bw = bufferWindow()
  const wasAtEnd = bw !== null && bw.scrollHeight - bw.scrollTop - bw.clientHeight < 4
  root.style.setProperty('--ifb-bar-height', next)
  if (bw && wasAtEnd) { bw.scrollTop = bw.scrollHeight }

  // The padding above only moves the story text. Host panels pinned to the viewport need moving too.
  reserveViewportBottom(bar.getBoundingClientRect().top, height)
  return height
}

/**
 * Keep the reservation in step with the bar. ResizeObserver is the accurate signal but postdates the
 * advertised floor (it needs Safari 13.1 where the addon claims 11.1), so it is feature-detected and a
 * window resize listener plus the explicit calls from the render paths cover the rest.
 */
function watchBarSize(bar: HTMLElement): void {
  measureBar()
  if (typeof ResizeObserver === 'function') {
    barSizeObserver?.disconnect()
    barSizeObserver = new ResizeObserver(() => { measureBar() })
    barSizeObserver.observe(bar)
  }
  if (!barResizeBound) {
    barResizeBound = true
    window.addEventListener('resize', () => { measureBar() })
  }
}

/**
 * Optional host capability: a map panel. If one exists, compact the bar and offer a toggle so the
 * prose stays readable on a tablet. Pure capability detection — no host is named (§0.2).
 */
export function adoptHostFeatures(): void {
  const mapPane = document.querySelector<HTMLElement>(MAP_SELECTORS)
  if (!mapPane) { return }
  document.documentElement.classList.add('ifb-host-map')
  const actions = document.querySelector<HTMLElement>('#ifb-bar .ifb-actions')
  if (!actions || actions.querySelector('.ifb-maptoggle')) { return }
  const toggle = button('⊞', 'ifb-maptoggle', btn => {
    const collapsed = document.documentElement.classList.toggle('ifb-map-collapsed')
    mapPane.style.display = collapsed ? 'none' : ''
    btn.setAttribute('aria-pressed', String(collapsed))
  }, 'Show or hide the map')
  toggle.setAttribute('aria-pressed', 'false')   // a toggle must expose its state before first use
  actions.appendChild(toggle)
  measureBar()          // .ifb-host-map shrinks the targets, so the bar is a different height now
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
  findLineInput, inputMode, submitCommand, stageCommand, cancelPending, pressEnter, tapDirection,
  dismissMorePrompt, decorateBuffer, watchBuffer,
  buildBar, adoptHostFeatures, measureBar, loadVerbs, saveVerbs,
  loadLayouts, saveLayouts, listLayouts, activeLayout, switchToLayout,
  createLayout, renameActiveLayout, deleteActiveLayout, resetVerbs, addVerbFromUI,
  removeVerbFromUI, moveVerbFromUI, selectVerb, selectedVerbName, moveSelected, deleteSelected,
  renderVerbs, openEditor, closeEditor, toggleEditor, isEditorOpen,
  boot, stopBoot, currentState,
}

if (document.readyState !== 'loading') {
  boot(40)
} else {
  document.addEventListener('DOMContentLoaded', () => boot(40))
}
