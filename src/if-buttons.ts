/**
 * DOM glue between the pure command model and a GlkOte-rendered page.
 *
 * PHASE 0 STUB: signatures only. Every function body throws so that the frozen
 * test suite fails for FEATURE reasons rather than module-resolution reasons.
 * `stopBoot()` is the single exception — the test harness calls it in every
 * `beforeEach`, so a throw there would abort setup instead of exercising a test.
 *
 * The stub has NO module-level side effects: it does not boot, does not touch
 * `document`, and does not publish a global. Phase 2 adds the real behaviour.
 */

import type { CommandState } from './command-model'

/** Which Glk input state the page is currently in. */
export type InputMode = 'line' | 'char' | 'more'

export function findLineInput(): HTMLInputElement | null {
  throw new Error('not implemented')
}

export function inputMode(): InputMode {
  throw new Error('not implemented')
}

export function submitCommand(_command: string): boolean {
  throw new Error('not implemented')
}

export function dismissMorePrompt(): boolean {
  throw new Error('not implemented')
}

export function decorateBuffer(_root: HTMLElement | null): void {
  throw new Error('not implemented')
}

export function watchBuffer(_root: HTMLElement | null): void {
  throw new Error('not implemented')
}

export function buildBar(): void {
  throw new Error('not implemented')
}

export function adoptHostFeatures(): void {
  throw new Error('not implemented')
}

export function loadVerbs(): string[] {
  throw new Error('not implemented')
}

export function saveVerbs(_verbs: readonly string[]): void {
  throw new Error('not implemented')
}

export function resetVerbs(): void {
  throw new Error('not implemented')
}

export function addVerbFromUI(_verb: string): void {
  throw new Error('not implemented')
}

export function removeVerbFromUI(_verb: string): void {
  throw new Error('not implemented')
}

export function renderVerbs(): void {
  throw new Error('not implemented')
}

export function currentState(): CommandState {
  throw new Error('not implemented')
}

export function boot(_attempt?: number): void {
  throw new Error('not implemented')
}

export function stopBoot(): void {
  /* stub: nothing to cancel */
}
