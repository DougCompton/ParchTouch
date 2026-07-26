import { test, expect } from '@playwright/test'
import {
  HAVE_PARCHMENT, HAVE_STORY, SETUP_HINT,
  bufferText, echoedCommands, ensureLineMode, tapControl, tapVerb, tapWord, waitForAddon,
} from './helpers'

/*
 * Verification against REAL modern Parchment (the AsyncGlk-based build the live iplayif.com deploy
 * serves), playing a real Z-machine story. This is plan Phase 5, and it is the only thing that can
 * answer what a real GlkOte build actually emits.
 *
 * Skips when the vendored host or story is absent — both are git-ignored on purpose (a host is
 * someone else's licensed software, a story file is copyrighted), so a fresh clone has neither and a
 * red-by-default suite would just get ignored. See harness/README.md.
 */
test.describe('real Parchment (AsyncGlk)', () => {
  test.skip(!HAVE_PARCHMENT || !HAVE_STORY, SETUP_HINT)

  // A >1MB wasm interpreter loads before any DOM the addon can attach to exists.
  test.slow()

  /*
   * Serial, not parallel. Every test in here boots a full interpreter; running them concurrently made
   * startup contend for CPU badly enough to time out a wait. Real-host specs are inherently heavy, so
   * trade wall-clock for determinism — a flaky suite is worth less than a slow one. The synthetic spec
   * stays fully parallel and covers the same behaviours quickly.
   */
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await page.goto('/parchment/play.html?story=../stories/advent.z5')
    await waitForAddon(page)
    // A legacy-style pager can consume the first tap; make the starting state deterministic.
    await ensureLineMode(page)
  })

  test('the addon boots and the bar renders over a real host (P5-AC1)', async ({ page }) => {
    await expect(page.locator('#ifb-bar')).toBeVisible()
    expect(await page.locator('#ifb-bar .ifb-move').allTextContents())
      .toEqual(['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE', 'Up', 'Down'])
    // Real story prose became tappable.
    expect(await page.locator('.ifb-word').count()).toBeGreaterThan(20)
    expect(await bufferText(page)).toContain('Welcome to Adventure!')
  })

  test('the GlkOte contract this addon depends on holds — and LineInput IS emitted (U2)', async ({ page }) => {
    const dom = await page.evaluate(() => ({
      bufferWindows: document.querySelectorAll('.BufferWindow').length,
      bufferLines: document.querySelectorAll('.BufferLine').length,
      inputs: [...document.querySelectorAll('.Input')].map(e => ({ tag: e.tagName, cls: e.className })),
      lineInputs: document.querySelectorAll('.Input.LineInput').length,
      styleInput: document.querySelectorAll('.Style_input').length >= 0,
      found: (() => { const el = window.IFButtons.findLineInput(); return el && { tag: el.tagName, cls: el.className } })(),
      mode: window.IFButtons.inputMode(),
    }))

    expect(dom.bufferWindows).toBe(1)
    expect(dom.bufferLines).toBeGreaterThan(0)
    // §0.3 question 1: yes, the current build emits .Input.LineInput.
    expect(dom.lineInputs).toBe(1)
    expect(dom.mode).toBe('line')

    /*
     * IMPORTANT contract correction. The plan documents the submission target as `input.Input.LineInput`
     * — an <input> element. This build uses a <textarea>, and emits TWO of them: a bare `.Input` plus
     * the `.Input.LineInput`. The addon only works here because findLineInput() also tries the
     * bare-class selector `.Input.LineInput` alongside `input.Input.LineInput`. That alternative is
     * therefore LOAD-BEARING on the current reference host — the opposite of the plan's assumption
     * that the `input.` form is primary. Do not "simplify" it away.
     */
    expect(dom.found?.tag).toBe('TEXTAREA')
    expect(dom.found?.cls).toContain('LineInput')
    expect(dom.inputs.every(i => i.tag === 'TEXTAREA')).toBe(true)
    expect(dom.inputs.length).toBe(2)
  })

  test('a compass tap moves the game (P5-AC2)', async ({ page }) => {
    expect(await bufferText(page)).toContain('End Of Road')
    await tapControl(page, 'ifb-move', 'N')
    await expect.poll(() => bufferText(page)).toContain('>north')
    expect(await echoedCommands(page)).toContain('north')
    // The game actually moved rather than merely echoing.
    expect(await bufferText(page)).toContain('Forest')
  })

  test('Look and Inventory work by tap alone (P5-AC2)', async ({ page }) => {
    await tapVerb(page, 'Inventory')
    await page.locator('#ifb-bar .ifb-enter').click()
    await expect.poll(() => echoedCommands(page)).toContain('inventory')
    await expect.poll(() => bufferText(page)).toMatch(/carrying|empty[- ]handed/i)
  })

  test('verb then a tapped noun sends the pair to the real interpreter (P5-AC2)', async ({ page }) => {
    await tapVerb(page, 'Take')
    expect(await page.locator('.ifb-armed').count()).toBe(1)
    await tapWord(page, 'building')
    await page.locator('#ifb-bar .ifb-enter').click()
    await expect.poll(() => echoedCommands(page)).toContain('take building')
    // The interpreter parsed it as a real command rather than rejecting it as unknown wording.
    expect(await bufferText(page)).not.toMatch(/don't know the word|not a verb I recognise/i)
    expect(await page.locator('.ifb-armed').count()).toBe(0)
  })

  test('a command of several words can be built by tapping', async ({ page }) => {
    // What tap-order append is for: the old pairing model could only ever produce two words, and a
    // third tap discarded the first two.
    await page.evaluate(() => {
      window.IFButtons.saveVerbs(['look', 'at'])
      window.IFButtons.renderVerbs()
    })
    await tapVerb(page, 'Look')
    await tapVerb(page, 'At')
    await tapWord(page, 'building')
    expect(await page.inputValue('.Input.LineInput')).toBe('look at building')
    await page.locator('#ifb-bar .ifb-enter').click()
    await expect.poll(() => echoedCommands(page)).toContain('look at building')
    await page.evaluate(() => window.IFButtons.resetVerbs())
  })

  test('echoed player input is never made tappable (P2-AC8 on a real host)', async ({ page }) => {
    await tapControl(page, 'ifb-move', 'N')
    await expect.poll(() => echoedCommands(page)).toContain('north')
    // The host writes the echo into .Style_input; decorating it would let a tap re-send old input.
    expect(await page.locator('.Style_input .ifb-word').count()).toBe(0)
  })

  test('decoration preserves the story text exactly', async ({ page }) => {
    // Adventure's banner has punctuation, parentheses and digits — a lossy tokenizer would corrupt it.
    const text = await bufferText(page)
    expect(text).toContain('(Please type HELP for instructions and information.)')
    expect(text).toContain('By Will Crowther (1976) and Don Woods (1977)')
  })

  test('this build emits no .MorePrompt at all (U3)', async ({ page }) => {
    /*
     * Answer to Unknown U3 for the CURRENT build: `MorePrompt` appears nowhere in web.js, and no
     * element with that class is ever created. So on modern Parchment inputMode() can only return
     * 'line' or 'char', and the pager-dismissal path is unreachable.
     *
     * That does NOT make the path dead code: legacy GlkOte cores — including the one Parchmap bundles
     * — do emit .MorePrompt, and the isVisible() guard still protects against a host that keeps the
     * element and toggles visibility. Deterministic coverage of both lives in
     * synthetic-glkote.spec.ts, which can force the state on demand.
     */
    await tapVerb(page, 'Look')
    await page.locator('#ifb-bar .ifb-enter').click()
    await expect.poll(() => echoedCommands(page)).toContain('look')
    expect(await page.locator('.MorePrompt').count()).toBe(0)
    expect(await page.evaluate(() => window.IFButtons.inputMode())).toBe('line')
  })

  test('no map element in this host, so no map affordance (P2-AC11)', async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.classList.contains('ifb-host-map'))).toBe(false)
    await expect(page.locator('#ifb-bar .ifb-maptoggle')).toHaveCount(0)
  })

  test('verb edits persist across a reload on a real host (P5-AC5)', async ({ page }) => {
    await page.evaluate(() => window.IFButtons.saveVerbs(['take', 'dig']))
    await page.reload()
    await waitForAddon(page)
    expect(await page.locator('#ifb-bar .ifb-verb').allTextContents()).toEqual(['Take', 'Dig'])
    await page.evaluate(() => window.IFButtons.resetVerbs())
  })

  test('the bar does not cover the story text (P3-AC2)', async ({ page }) => {
    const gap = await page.evaluate(() => {
      const bw = document.querySelector<HTMLElement>('.BufferWindow')
      return bw ? Number.parseInt(getComputedStyle(bw).paddingBottom, 10) : null
    })
    // The addon's stylesheet reserves --ifb-bar-height on the host's own scrolling element.
    expect(gap).toBeGreaterThanOrEqual(100)
  })

  test('needs no viewport adjustment, and gets none', async ({ page }) => {
    // The counterpart to the Parchmap case: this host pins nothing to the viewport bottom, so the
    // generic rule must leave it completely alone rather than mutating layout for no reason.
    expect(await page.evaluate(() => document.querySelectorAll('[data-ifb-lifted]').length)).toBe(0)
  })

  test('makes no third-party network requests (P5-AC6)', async ({ page }) => {
    const external: string[] = []
    page.on('request', r => {
      const h = new URL(r.url()).hostname
      if (h && h !== '127.0.0.1' && h !== 'localhost') { external.push(r.url()) }
    })
    await tapControl(page, 'ifb-move', 'N')
    await tapVerb(page, 'Take')
    await tapWord(page, 'building')
    await page.waitForTimeout(1500)
    expect(external).toEqual([])
  })

  test('a full turn is possible by tapping only, with zero keystrokes (Success Criterion 2)', async ({ page }) => {
    // Movement, a no-argument command, and a verb+noun action — the plan's definition of a full turn.
    await tapControl(page, 'ifb-move', 'N')
    await expect.poll(() => echoedCommands(page)).toContain('north')
    await tapVerb(page, 'Look')
    await page.locator('#ifb-bar .ifb-enter').click()
    await expect.poll(() => echoedCommands(page)).toContain('look')
    await tapVerb(page, 'Examine')
    await tapWord(page, 'forest')
    await page.locator('#ifb-bar .ifb-enter').click()
    await expect.poll(() => echoedCommands(page)).toContain('examine forest')

    const echoed = await echoedCommands(page)
    expect(echoed).toEqual(['north', 'look', 'examine forest'])
  })
})
