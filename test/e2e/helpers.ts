import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'

const ROOT = resolve(import.meta.dirname, '..', '..')

/*
 * The vendored hosts and story files are git-ignored by design (a host is someone else's licensed
 * software; a story file is copyrighted). So a fresh clone has neither, and the real-host specs must
 * SKIP rather than fail — otherwise `npm run test:e2e` is red for everyone who has not run the
 * harness setup, and a red-by-default suite gets ignored.
 *
 * The synthetic-host spec has no such dependency and always runs, so the addon never lacks
 * real-browser cover.
 */
export const HAVE_PARCHMENT = existsSync(resolve(ROOT, 'harness/vendor/parchment/dist/web/web.js'))
export const HAVE_PARCHMAP = existsSync(resolve(ROOT, 'harness/vendor/parchmap/play.html'))
export const HAVE_STORY = existsSync(resolve(ROOT, 'harness/stories/advent.z5'))

export const SETUP_HINT = 'see harness/README.md — vendored host or story file not present'

/**
 * Test control surface of harness/synthetic/glkote.html. NOT part of the addon's contract — the
 * addon neither knows nor cares that it exists; it only lets a spec put the stub host into a
 * specific protocol state on demand.
 */
export interface SyntheticHost {
  setLine(opts?: { alsoBare?: boolean; bareOnly?: boolean; tag?: 'input' | 'textarea' }): Element | null
  setChar(): null
  showMore(hidden?: boolean): Element
  hideMore(): void
  clearInputs(): void
  addLine(text: string): Element
  /** Commands the stub host actually received via a keyCode-13 submission. */
  submitted(): string[]
  /** Key codes the stub host received while in char-input mode. */
  charKeys(): number[]
  /** Keydowns seen on the line input — a jQuery-based host breaks on these, so there must be none. */
  strayKeydowns(): number[]
  reset(): void
}

declare global {
  interface Window {
    SYN: SyntheticHost
  }
}

/**
 * Wait until the addon has attached and decorated real story text.
 *
 * Waits for ATTACHED rather than visible: a real host loads a >1MB wasm interpreter first, and while
 * several workers do that at once a decorated word can be attached and non-empty yet not yet pass
 * Playwright's visibility check. Presence in the DOM is what the addon guarantees; visibility is the
 * host's layout, asserted separately where it actually matters.
 */
export async function waitForAddon(page: Page, timeout = 120_000): Promise<void> {
  await page.waitForSelector('#ifb-bar', { state: 'attached', timeout })
  await page.waitForSelector('.ifb-word', { state: 'attached', timeout })
  await page.waitForFunction(() => document.querySelectorAll('.ifb-word').length > 5, undefined, { timeout })
}

/**
 * Drain any pending pager so the game is actually awaiting a command.
 *
 * REAL FINDING, not test scaffolding: a legacy GlkOte core paginates its opening text whenever it
 * overflows the window, and whether it does depends on font metrics — the same page shows a
 * `.MorePrompt` at startup in WebKit but not in Chromium, and a short/tablet viewport makes it much
 * more likely. The addon then behaves exactly as specified: while a pager is showing it dismisses it
 * and refuses to submit, because a command sent then would be swallowed. So the FIRST tap can
 * legitimately be consumed by the pager, and any test that assumes tap-one-submits is wrong rather
 * than the addon being wrong.
 */
export async function ensureLineMode(page: Page, tries = 12): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const mode = await page.evaluate(() => window.IFButtons.inputMode())
    if (mode === 'line') { return }
    if (mode === 'more') { await page.evaluate(() => window.IFButtons.dismissMorePrompt()) }
    await page.waitForTimeout(400)
  }
  throw new Error('host never reached line-input mode; still ' +
    await page.evaluate(() => window.IFButtons.inputMode()))
}

/** Tap a compass/no-argument button by its exact visible label. */
export async function tapControl(page: Page, cls: string, label: string): Promise<void> {
  const clicked = await page.evaluate(
    ([c, l]) => {
      const btn = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .' + c)]
        .find(b => (b.textContent ?? '').trim() === l)
      if (!btn) { return false }
      btn.click()
      return true
    },
    [cls, label] as const,
  )
  if (!clicked) { throw new Error(`no .${cls} control labelled "${label}" in the bar`) }
}

/** Tap a verb button, matched case-insensitively on its label. */
export async function tapVerb(page: Page, verb: string): Promise<void> {
  const clicked = await page.evaluate(v => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-verb')]
      .find(b => (b.textContent ?? '').trim().toLowerCase() === v.toLowerCase())
    if (!btn) { return false }
    btn.click()
    return true
  }, verb)
  if (!clicked) { throw new Error(`no verb button labelled "${verb}"`) }
}

/** Tap a decorated word in the story text, matched on its normalized text. */
export async function tapWord(page: Page, word: string): Promise<void> {
  const clicked = await page.evaluate(w => {
    const el = [...document.querySelectorAll<HTMLElement>('.ifb-word')]
      .find(n => (n.textContent ?? '').trim().toLowerCase() === w.toLowerCase())
    if (!el) { return false }
    el.click()
    return true
  }, word)
  if (!clicked) { throw new Error(`no tappable word "${word}" in the buffer`) }
}

/*
 * ── Locator-only variants ────────────────────────────────────────────────────────────────────────
 *
 * Some hosts cannot be driven with page.evaluate() at all. Parchmap declares a global `var Map = {…}`
 * that SHADOWS the native Map constructor, and Playwright's own result serializer calls `new Map()`
 * in the page — so every evaluate() there fails with "Map is not a constructor", even
 * `evaluate(() => 1)`. Locator APIs use a different path and work fine, so real-host specs for such a
 * host must stay locator-only. This is an interop hazard worth knowing about, not an addon defect:
 * the addon itself never reads a host global (§0.2), which is exactly why it is unaffected.
 */

/**
 * Make a host that overwrites the global `Map` testable.
 *
 * Parchmap declares `var Map = {…}` at global scope, shadowing the native Map constructor. Playwright
 * builds its InjectedScript inside the page and calls `new Map()` there, so on such a host almost
 * every Playwright call fails with "Map is not a constructor" — including `evaluate(() => 1)` and
 * `locator.allTextContents()`.
 *
 * This installs an accessor for `window.Map` BEFORE any host script runs. Reads get a Proxy that is
 * constructible as the real Map (so Playwright works) but resolves property reads to the host's own
 * object first (so `Map.Draw`, `Map.Rooms`, `Map.CurrentRoom` keep working). The host's
 * `var Map = {…}` assignment lands in the setter rather than clobbering the constructor.
 *
 * This is TEST-HARNESS ONLY. It patches the host page, never the addon — the addon is unaffected by
 * the collision precisely because it never reads a host global (§0.2). Must be called before goto().
 */
export async function shieldNativeMap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeMap = Map
    let host: Record<string | symbol, unknown> | null = null

    const proxy = new Proxy(NativeMap, {
      get(target, prop, recv) {
        if (host && prop in host) { return host[prop] }
        return Reflect.get(target, prop, recv)
      },
      set(target, prop, value) {
        if (host) { host[prop] = value; return true }
        return Reflect.set(target, prop, value)
      },
      has(target, prop) {
        return (host !== null && prop in host) || Reflect.has(target, prop)
      },
      construct(target, args) {
        return Reflect.construct(target, args)   // a genuine Map, so Playwright is satisfied
      },
    })

    Object.defineProperty(window, 'Map', {
      configurable: true,
      get: () => proxy,
      set: (v: Record<string | symbol, unknown>) => { host = v },
    })
  })
}

/** Wait for the addon to attach, using locators only (safe on a host that breaks evaluate()). */
export async function waitForAddonViaLocators(page: Page, timeout = 120_000): Promise<void> {
  await page.waitForSelector('#ifb-bar', { state: 'attached', timeout })
  await page.waitForSelector('.ifb-word', { state: 'attached', timeout })
}

/** Echoed player input, read without evaluate(). */
export async function echoedViaLocators(page: Page): Promise<string[]> {
  const raw = await page.locator('.Style_input').allTextContents()
  return raw.map(t => t.replace(/^>/, '').trim()).filter(Boolean)
}

/** Tap a bar control by exact label, without evaluate(). */
export function control(page: Page, cls: string, label: string) {
  return page.locator(`#ifb-bar .${cls}`).filter({ hasText: new RegExp(`^${label}$`) })
}

/** Everything the host has echoed as player input, oldest first. */
export function echoedCommands(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.Style_input')]
      .map(e => (e.textContent ?? '').replace(/^>/, '').trim())
      .filter(Boolean))
}

/** Collapsed visible text of the scrolling buffer. */
export function bufferText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bw = document.querySelector<HTMLElement>('.BufferWindow')
    return (bw?.innerText ?? '').replace(/\s+/g, ' ').trim()
  })
}
