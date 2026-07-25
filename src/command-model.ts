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
