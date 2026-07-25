/**
 * Pure command model for the touch addon — no DOM, no storage, no side effects.
 *
 * PHASE 0 STUB: signatures only. Every function body throws so that the frozen
 * test suite fails for FEATURE reasons rather than module-resolution reasons.
 * Phase 1 replaces these bodies with the real implementation.
 */

/** A single slice of story text: either a tappable word or the glue between words. */
export interface Token {
  readonly text: string
  readonly isWord: boolean
}

/** The two half-commands the player can have armed at any moment. */
export interface CommandState {
  readonly pendingVerb: string | null
  readonly pendingNoun: string | null
}

/** The outcome of one tap: the next state, plus a command to send if one completed. */
export interface TapResult {
  readonly state: CommandState
  readonly command: string | null
}

/** Longest command string the addon will ever submit to the interpreter. */
export const MAX_COMMAND_LENGTH = 120

/** Most verbs the player may keep in the bar. */
export const MAX_VERBS = 40

/** Longest single verb the addon will store. */
export const MAX_VERB_LENGTH = 30

/**
 * STUB: intentionally empty so no verb-list test can accidentally pass in Phase 0.
 * Phase 1 populates the real default set.
 */
export const DEFAULT_VERBS: readonly string[] = []

/** Loose inputs the model must tolerate (tests pass `null`, `undefined` and numbers). */
type LooseInput = string | number | null | undefined

export function normalizeWord(_input: LooseInput): string {
  throw new Error('not implemented')
}

export function normalizeVerb(_input: LooseInput): string {
  throw new Error('not implemented')
}

export function tokenize(_input: LooseInput): Token[] {
  throw new Error('not implemented')
}

export function createState(): CommandState {
  throw new Error('not implemented')
}

export function clearPending(_state: CommandState): CommandState {
  throw new Error('not implemented')
}

export function tapVerb(_state: CommandState, _verb: LooseInput): TapResult {
  throw new Error('not implemented')
}

export function tapWord(_state: CommandState, _word: LooseInput): TapResult {
  throw new Error('not implemented')
}

export function tapDirect(_state: CommandState, _command: LooseInput): TapResult {
  throw new Error('not implemented')
}

export function addVerb(_list: readonly string[], _verb: LooseInput): string[] {
  throw new Error('not implemented')
}

export function removeVerb(_list: readonly string[], _verb: LooseInput): string[] {
  throw new Error('not implemented')
}
