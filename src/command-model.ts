/*
 * command-model.ts — pure command-building logic for the ParchTouch overlay.
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
/*
 * One editable list holds BOTH kinds of word, because the UI no longer distinguishes them: every entry
 * here stages text into the input, and the player presses Return to send it. So a no-argument command
 * ("look") and a verb that wants a noun ("take") differ only in whether the player taps a word next.
 *
 * Ordered most-used first: the strip is capped at three rows and scrolls, so early entries are the ones
 * always visible without scrolling.
 */
export const DEFAULT_VERBS: readonly string[] = [
  'look', 'inventory', 'examine', 'take', 'drop', 'open', 'close', 'in', 'out',
  'read', 'search', 'push', 'pull', 'turn on', 'turn off', 'unlock', 'wear', 'enter',
  'wait', 'again', 'undo', 'save', 'restore',
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

  /*
   * A LEADING SLASH IS MEANINGFUL and is kept. Some hosts reserve `/name` for their own features —
   * notes, goto, route-finding — and stripping it silently turned `/note` into `note`, which the game
   * then rejected as an unknown verb. Exactly one slash survives, and only at the front: everything
   * after it is normalized as usual, so `/note!!` is still `/note` and a bare `/` is still nothing.
   *
   * Deliberately NOT extended to normalizeWord(). A word tapped out of story text must never be able
   * to acquire a leading slash and address a host command.
   */
  const slash = s.startsWith('/') ? '/' : ''
  s = s.slice(slash.length)

  s = s.replace(/[^\p{L}\p{N} -]/gu, '')
  s = s.replace(/^[\s-]+|[\s-]+$/g, '')
  return s === '' ? '' : slash + s
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
export function tapDirect(_state: CommandState, command: Loose): TapResult {
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

/*
 * ── Building a command word by word ──────────────────────────────────────────────────────────────
 *
 * A command is a LIST OF WORDS in the order they were tapped, and the whole list is what gets sent.
 * That is what makes `unlock door with key` reachable: tap Unlock, the door, With, the key.
 *
 * This replaced a verb+noun PAIRING model, which could only ever produce two words — and worse, a
 * third tap silently discarded the first two, because completing a pair reset the state and the next
 * tap began a fresh command.
 *
 * The cost, accepted deliberately: word order is now tap order, so tapping a noun and then a verb
 * gives `lamp examine` rather than `examine lamp`. The pairing functions above still exist and are
 * still specified by their own tests — they are simply no longer how the DOM layer composes.
 */

/** Append a word. Refuses to exceed MAX_COMMAND_LENGTH rather than send something truncated. */
export function appendToken(words: readonly string[], token: Loose): string[] {
  const t = str(token).trim().replace(/\s+/g, ' ')
  if (t === '') { return words.slice() }
  const next = words.concat([t])
  if (commandText(next).length > MAX_COMMAND_LENGTH) { return words.slice() }
  return next
}

/** Drop the most recently added word, so one mis-tap costs one tap to undo. */
export function dropLastToken(words: readonly string[]): string[] {
  return words.slice(0, Math.max(0, words.length - 1))
}

/** The command as the game will see it. */
export function commandText(words: readonly string[]): string {
  return words.join(' ')
}

/*
 * ── Named layouts ────────────────────────────────────────────────────────────────────────────────
 *
 * One word list is not enough: vocabularies differ per game (decision D3), which is the whole reason
 * the list is editable. A player can keep several named sets — "Zork", "modern" — and switch between
 * them, rather than re-pruning the same list for every story.
 *
 * Layouts are chosen by name rather than derived from the story, deliberately: one set often suits a
 * whole family of games, and not every host puts a story name in the URL to key off.
 *
 * All of this is pure data transformation, so the rules live here and stay testable without a browser.
 */

/** The whole persisted collection: which layout is in use, and the words in each. */
export interface LayoutStore {
  readonly active: string
  readonly sets: Readonly<Record<string, readonly string[]>>
}

export const MAX_LAYOUTS = 12
export const MAX_LAYOUT_NAME = 24
/** The name a migrated or first-run layout gets. */
export const DEFAULT_LAYOUT = 'Default'

/**
 * Layout names are shown on a control and used as storage keys, so they are trimmed, collapsed and
 * bounded. Letters, digits, spaces and hyphens survive; everything else is dropped, which also means a
 * name can never carry markup.
 */
export function normalizeLayoutName(name: Loose): string {
  let s = str(name).trim()
  if (!s) { return '' }
  s = s.replace(/\s+/g, ' ')
  s = s.replace(/[^\p{L}\p{N} -]/gu, '')
  s = s.replace(/^[\s-]+|[\s-]+$/g, '')
  return s.slice(0, MAX_LAYOUT_NAME)
}

/** A usable store built from anything at all — unparsed JSON, a legacy array, or junk. */
export function emptyLayouts(): LayoutStore {
  return { active: DEFAULT_LAYOUT, sets: { [DEFAULT_LAYOUT]: DEFAULT_VERBS.slice() } }
}

/**
 * Coerce unknown data into a valid store, discarding anything malformed.
 *
 * Also accepts the ORIGINAL shape — a bare array of words — so a list saved before layouts existed
 * becomes the default layout instead of being thrown away.
 */
export function sanitizeLayouts(raw: unknown): LayoutStore {
  // The pre-layouts format: just the words.
  if (Array.isArray(raw)) {
    const words = raw.filter((v): v is string => typeof v === 'string').map(v => normalizeVerb(v))
      .filter(v => v !== '')
    return words.length === 0
      ? emptyLayouts()
      : { active: DEFAULT_LAYOUT, sets: { [DEFAULT_LAYOUT]: words } }
  }

  if (raw === null || typeof raw !== 'object') { return emptyLayouts() }
  const obj = raw as { active?: unknown; sets?: unknown }
  if (obj.sets === null || typeof obj.sets !== 'object' || Array.isArray(obj.sets)) {
    return emptyLayouts()
  }

  const sets: Record<string, string[]> = {}
  for (const [rawName, rawWords] of Object.entries(obj.sets as Record<string, unknown>)) {
    const name = normalizeLayoutName(rawName)
    if (name === '' || Object.keys(sets).length >= MAX_LAYOUTS) { continue }
    if (!Array.isArray(rawWords)) { continue }
    sets[name] = rawWords.filter((v): v is string => typeof v === 'string')
      .map(v => normalizeVerb(v)).filter(v => v !== '')
  }
  if (Object.keys(sets).length === 0) { return emptyLayouts() }

  const wanted = normalizeLayoutName(typeof obj.active === 'string' ? obj.active : '')
  const active = wanted !== '' && wanted in sets ? wanted : (Object.keys(sets)[0] ?? DEFAULT_LAYOUT)
  return { active, sets }
}

/** Names of every layout, in insertion order. */
export function layoutNames(store: LayoutStore): string[] {
  return Object.keys(store.sets)
}

/** The words of the layout in use. */
export function activeWords(store: LayoutStore): string[] {
  return (store.sets[store.active] ?? []).slice()
}

/** Replace the words of the layout in use. */
export function setActiveWords(store: LayoutStore, words: readonly string[]): LayoutStore {
  return { active: store.active, sets: { ...store.sets, [store.active]: words.slice() } }
}

/** Switch to another layout. An unknown name leaves the store untouched. */
export function switchLayout(store: LayoutStore, name: Loose): LayoutStore {
  const n = normalizeLayoutName(name)
  if (n === '' || !(n in store.sets)) { return store }
  return { active: n, sets: store.sets }
}

/**
 * Add a layout and switch to it. New layouts start from the shipped defaults, so a fresh one is never
 * empty and pruning one game's list cannot surprise you in another.
 */
export function createLayout(store: LayoutStore, name: Loose): LayoutStore {
  const n = normalizeLayoutName(name)
  if (n === '' || n in store.sets || layoutNames(store).length >= MAX_LAYOUTS) { return store }
  return { active: n, sets: { ...store.sets, [n]: DEFAULT_VERBS.slice() } }
}

/** Rename a layout, keeping its position and its words. */
export function renameLayout(store: LayoutStore, from: Loose, to: Loose): LayoutStore {
  const a = normalizeLayoutName(from)
  const b = normalizeLayoutName(to)
  if (a === '' || b === '' || !(a in store.sets)) { return store }
  if (a === b) { return store }
  if (b in store.sets) { return store }            // never silently merge two layouts

  const sets: Record<string, readonly string[]> = {}
  for (const [name, words] of Object.entries(store.sets)) {
    sets[name === a ? b : name] = words
  }
  return { active: store.active === a ? b : store.active, sets }
}

/** Remove a layout. The last one is never removed — there must always be something to play with. */
export function deleteLayout(store: LayoutStore, name: Loose): LayoutStore {
  const n = normalizeLayoutName(name)
  if (n === '' || !(n in store.sets) || layoutNames(store).length <= 1) { return store }

  const sets: Record<string, readonly string[]> = {}
  for (const [key, words] of Object.entries(store.sets)) {
    if (key !== n) { sets[key] = words }
  }
  const active = store.active === n ? (Object.keys(sets)[0] ?? DEFAULT_LAYOUT) : store.active
  return { active, sets }
}

/**
 * Move a word to a new position, returning a new list.
 *
 * Order is not cosmetic: the bar shows three rows and scrolls, so whichever words come first are the
 * ones reachable without scrolling. This is what lets a player put their own favourites in reach.
 *
 * `toIndex` is clamped into range and counted AFTER the word is lifted out, which is what makes
 * "move one place right" simply `from + 1`. An unknown word, or a move to where it already is, returns
 * an unchanged copy.
 */
export function moveVerb(list: readonly string[], verb: Loose, toIndex: number): string[] {
  const v = normalizeVerb(verb)
  const out = list.slice()
  const from = out.indexOf(v)
  if (from === -1) { return out }
  if (!Number.isFinite(toIndex)) { return out }

  const to = Math.max(0, Math.min(out.length - 1, Math.trunc(toIndex)))
  if (to === from) { return out }
  out.splice(from, 1)
  out.splice(to, 0, v)
  return out
}
