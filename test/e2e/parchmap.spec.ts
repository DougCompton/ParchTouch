import { test, expect } from '@playwright/test'
import {
  HAVE_PARCHMAP, SETUP_HINT,
  control, echoedViaLocators, ensureLineMode, shieldNativeMap, waitForAddonViaLocators,
} from './helpers'

/*
 * Verification against REAL Parchmap — plan Phase 6, the crux of the "coexists with a map-providing
 * host" claim. Parchmap is a second, independent GlkOte host that also drives the same input element
 * and reads the same output, so it is where interference would show up.
 *
 * NOTE ON TECHNIQUE: this spec uses ONLY locator APIs, never page.evaluate(). Parchmap declares a
 * global `var Map = {…}` which shadows the native Map constructor, and Playwright's result serializer
 * calls `new Map()` in the page — so every evaluate() on this host throws "Map is not a constructor",
 * including `evaluate(() => 1)`. The addon is immune because it never reads a host global (§0.2);
 * only the test harness has to work around it. See helpers.ts.
 *
 * Skips when the vendored host is absent (git-ignored — it is GPL-3.0 software we do not redistribute)
 * or when its play.html has not had the two addon tags added. See harness/README.md.
 */
test.describe('real Parchmap (legacy core + auto-map)', () => {
  test.skip(!HAVE_PARCHMAP, SETUP_HINT)
  test.slow()
  test.describe.configure({ mode: 'serial' })

  // Its catalogue ships JS-wrapped stories, and it links its own games as ?story=games/<Filename>.
  const PAGE = '/parchmap/play.html?story=games/Advent.z5.js'

  const rooms = (page: import('@playwright/test').Page) =>
    page.locator('#map #rooms-list #container > div')

  test.beforeEach(async ({ page }) => {
    // Must run before goto: Parchmap's global `var Map` otherwise breaks Playwright itself.
    await shieldNativeMap(page)
    await page.goto(PAGE)
    await waitForAddonViaLocators(page)
    /*
     * This host paginates its opening text when it overflows the window, and whether it does depends
     * on font metrics — WebKit shows a .MorePrompt here where Chromium does not. The addon then
     * correctly dismisses rather than submitting, which consumes a tap. Drain it so each test starts
     * from a genuine line prompt. (evaluate() works here only because of shieldNativeMap above.)
     */
    await ensureLineMode(page)
  })

  test('the addon boots inside Parchmap and decorates its story text', async ({ page }) => {
    await expect(page.locator('#ifb-bar')).toBeVisible()
    await expect(control(page, 'ifb-move', 'N')).toHaveCount(1)
    expect(await page.locator('.ifb-word').count()).toBeGreaterThan(20)
  })

  test('the map capability is detected generically, with no host named (U6, P6-AC4)', async ({ page }) => {
    /*
     * Answer to Unknown U6: Parchmap's map container is `id="map"`, which the addon's existing generic
     * MAP_SELECTORS list ('#map, #map-container, .map-container, [data-if-map]') already matches. No
     * narrowing was needed — the plan's Task 6.5 contingency turned out to be unnecessary, and the
     * detection stays capability-based rather than host-based.
     */
    await expect(page.locator('#map')).toHaveCount(1)
    await expect(page.locator('html')).toHaveClass(/ifb-host-map/)
    await expect(page.locator('#ifb-bar .ifb-maptoggle')).toHaveCount(1)
    // A toggle must expose its state before first use.
    await expect(page.locator('#ifb-bar .ifb-maptoggle')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('#ifb-bar .ifb-maptoggle')).toHaveAttribute('aria-label', /map/i)
  })

  test('THE MAP UPDATES from addon-submitted commands (U1, P6-AC1)', async ({ page }) => {
    /*
     * The highest-risk unknown in the plan: if Parchmap hooked its own input handler, an
     * addon-submitted command would move the game WITHOUT updating the map — a silently wrong map,
     * worse than no map.
     *
     * It cannot happen. Parchmap never observes input at all: Parchmap.GetRoom() runs from a 200ms
     * polling loop and reads the room name out of the RENDERED OUTPUT (`#windowport .GridLine span`,
     * the status line), with the direction from `Input.GetLastDirection()` which scans echoed
     * `.Style_input`. Both are output-derived, and the echo appears however the command was submitted.
     * This test is the empirical confirmation.
     */
    await expect.poll(() => rooms(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
    const before = await rooms(page).count()

    await control(page, 'ifb-move', 'N').click()
    await expect.poll(() => echoedViaLocators(page), { timeout: 20_000 }).toContain('north')

    // A new room must be added to the map purely as a result of a TAP.
    await expect.poll(() => rooms(page).count(), { timeout: 30_000 }).toBeGreaterThan(before)
  })

  test('several tap-driven moves keep the map in step (P6-T1)', async ({ page }) => {
    await expect.poll(() => rooms(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
    const before = await rooms(page).count()

    for (const dir of ['N', 'S', 'N'] as const) {
      await control(page, 'ifb-move', dir).click()
      await page.waitForTimeout(1200)
    }
    await expect.poll(() => echoedViaLocators(page), { timeout: 20_000 })
      .toEqual(expect.arrayContaining(['north', 'south']))
    // Revisiting a room must not duplicate it, so assert growth without over-specifying the count.
    await expect.poll(() => rooms(page).count(), { timeout: 30_000 }).toBeGreaterThan(before)
  })

  test('no input-buffer collision: residue is replaced, not concatenated (U4, P6-AC2)', async ({ page }) => {
    /*
     * Parchmap's own Input.js APPENDS to the field (`$(".Input.LineInput").val(val() + text)`) and
     * clears via Input.Clear(); the addon ASSIGNS. Assignment is the guard. A collision would produce
     * a merged command like "tatake building".
     */
    await page.locator('.Input.LineInput').fill('ta')
    await page.locator('#ifb-bar .ifb-verb').filter({ hasText: /^Take$/ }).click()
    await page.locator('.ifb-word').filter({ hasText: /^building$/ }).first().click()
    await page.locator('#ifb-bar .ifb-enter').click()

    await expect.poll(() => echoedViaLocators(page), { timeout: 20_000 }).toContain('take building')
    const echoed = await echoedViaLocators(page)
    expect(echoed.some(c => /^tatake/.test(c))).toBe(false)
    // The field is left clean for the next turn.
    await expect(page.locator('.Input.LineInput')).toHaveValue('')
  })

  test('the bar does not cover the map or the game frame', async ({ page }) => {
    /*
     * The regression this exists for: this host pins its map panel (fixed, top:0 bottom:0) and its game
     * frame (fixed, top:20 bottom:20) to the VIEWPORT. Padding .BufferWindow does nothing for those, so
     * the bar sat over the map's lower third and the host's own footer — "it hides the whole bottom".
     *
     * Note the fix must SHRINK them, not move them: both have a fixed height, so shifting `top` up
     * clears the bar but pushes an equal number of pixels off the top of the screen instead (measured:
     * 148px of the map, 108px of the game frame).
     */
    const m = await page.evaluate(() => {
      const bar = document.getElementById('ifb-bar')!.getBoundingClientRect()
      const edge = (sel: string) => {
        const el = document.querySelector(sel)
        if (!el) { return null }
        const r = el.getBoundingClientRect()
        return { belowBar: Math.round(r.bottom - bar.top), clippedAbove: Math.max(0, -Math.round(r.top)) }
      }
      return { map: edge('#map'), game: edge('#parchment'), lifted: document.querySelectorAll('[data-ifb-lifted]').length }
    })
    expect(m.lifted).toBeGreaterThan(0)          // this host needs the adjustment
    for (const panel of [m.map, m.game]) {
      expect(panel).not.toBeNull()
      expect(panel!.belowBar).toBeLessThanOrEqual(1)    // nothing under the bar
      expect(panel!.clippedAbove).toBe(0)               // and nothing pushed off the top either
    }
  })

  test('the map toggle collapses and restores the map (P6-AC4)', async ({ page }) => {
    const toggle = page.locator('#ifb-bar .ifb-maptoggle')
    await expect(page.locator('#map')).toBeVisible()

    await toggle.click()
    await expect(page.locator('#map')).toBeHidden()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await toggle.click()
    await expect(page.locator('#map')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  test('echoed input stays untappable, so a tap cannot resend an old command (P2-AC8)', async ({ page }) => {
    await control(page, 'ifb-move', 'N').click()
    await expect.poll(() => echoedViaLocators(page), { timeout: 20_000 }).toContain('north')
    // Parchmap READS .Style_input to build its map, so decorating it would also risk corrupting that.
    await expect(page.locator('.Style_input .ifb-word')).toHaveCount(0)
  })

  test("the addon's storage does not disturb the host's own persistence (P6-T7)", async ({ page }) => {
    // Asserted behaviourally rather than by reading localStorage, since evaluate() is unusable here:
    // after a reload the addon's verbs AND the host's map must both survive.
    await expect.poll(() => rooms(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
    await control(page, 'ifb-move', 'N').click()
    await expect.poll(() => rooms(page).count(), { timeout: 30_000 }).toBeGreaterThan(1)

    await page.reload()
    await waitForAddonViaLocators(page)
    await ensureLineMode(page)

    // The addon still works...
    await expect(page.locator('#ifb-bar .ifb-verb').first()).toBeAttached()
    // ...and the host's own map data was not clobbered by the IFB_Verbs key.
    await expect.poll(() => rooms(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
  })

  test('the host keeps its own controls and layout (P6-AC5)', async ({ page }) => {
    // The addon appends its bar to <body> and touches only .BufferWindow's padding, so the host's own
    // UI must be untouched.
    await expect(page.locator('#toggle-map-anim')).toHaveCount(1)
    await expect(page.locator('#toggle-map-2way')).toHaveCount(1)
    await expect(page.locator('.Input.LineInput')).toHaveCount(1)
  })

  test('no third-party requests, including Analytics (P6-AC6)', async ({ page }) => {
    /*
     * Parchmap ships GA_TRACK = true; the harness setup flips it to false (harness/README.md), because
     * Analytics would phone home during local testing and in any LAN deployment.
     */
    const external: string[] = []
    page.on('request', r => {
      const h = new URL(r.url()).hostname
      if (h && h !== '127.0.0.1' && h !== 'localhost') { external.push(r.url()) }
    })
    await control(page, 'ifb-move', 'N').click()
    await page.waitForTimeout(2500)
    expect(external).toEqual([])
  })
})
