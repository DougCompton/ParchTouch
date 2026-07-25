import { test, expect } from '@playwright/test'
import { bufferText, echoedCommands, tapControl, tapVerb, tapWord } from './helpers'

/*
 * Real-browser tests against a page that implements ONLY GlkOte's DOM contract — no interpreter, no
 * host application, no jQuery, no other scripts. Two things this covers that jsdom cannot:
 *
 *  - Genuine event semantics. jsdom accepts the addon's `keyCode` defineProperty override
 *    unconditionally; a real engine need not. This is plan Unknown U7, and running in webkit (iOS
 *    Safari's engine family) is what de-risks it.
 *  - The §0.2 independence claim, executed rather than asserted: the addon must work in a page where
 *    no other application scripts exist at all.
 *
 * It also makes the protocol states DETERMINISTIC. A real game will not reliably produce char input
 * or a pager on demand, so these paths — which the plan calls the single most important behaviour in
 * the addon — can only be exercised reproducibly here.
 */

const PAGE = '/synthetic/glkote.html'

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(PAGE)
  await page.waitForSelector('#ifb-bar')
  // Stop the boot retry loop so a late timer cannot rebuild the bar mid-test.
  await page.evaluate(() => window.IFButtons.stopBoot())
  ;(page as unknown as { __errors: string[] }).__errors = errors
})

test('boots and decorates a page containing no other application scripts', async ({ page }) => {
  await expect(page.locator('#ifb-bar')).toBeVisible()
  // jQuery is optional (decision D6) and genuinely absent here.
  expect(await page.evaluate(() => 'jQuery' in window)).toBe(false)
  const words = await page.locator('.ifb-word').allTextContents()
  expect(words).toContain('mailbox')
  expect(words).toContain('jewel-encrusted')
  // Unicode property escapes are why the browser floor is ES2018 — an accented noun must be tappable.
  expect(words).toContain('café')
})

test('the bar renders the full compass and the no-argument commands', async ({ page }) => {
  expect(await page.locator('#ifb-bar .ifb-move').allTextContents())
    .toEqual(['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE', 'Up', 'Down'])
  expect(await page.locator('#ifb-bar .ifb-cmd').allTextContents())
    .toEqual(['Look', 'Inv', 'Wait', 'In', 'Out', 'Again', 'Undo', 'Save', 'Restore'])
})

test('a direction tap delivers the command with a real keyCode 13 (U7)', async ({ page }) => {
  await tapControl(page, 'ifb-move', 'N')
  // The host stub only accepts a command when it sees keyCode/which === 13, exactly as a GlkOte host
  // does — so this passing means the synthetic Enter survived a real engine's event dispatch.
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['north'])
  expect(await echoedCommands(page)).toEqual(['north'])
})

test('submits on keypress only — a stray keydown breaks a jQuery-based host', async ({ page }) => {
  /*
   * Regression guard for a defect found only by testing a real host. Dispatching keydown as well makes
   * a legacy jQuery-based GlkOte clear its input field and submit an EMPTY command, silently costing
   * the player a turn. keypress alone is delivered by both a modern and a legacy host.
   */
  await page.evaluate(() => window.SYN.reset())
  await tapControl(page, 'ifb-move', 'N')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['north'])
  expect(await page.evaluate(() => window.SYN.strayKeydowns())).toEqual([])
})

test('every no-argument command maps to its full word', async ({ page }) => {
  for (const [label, cmd] of [['Look', 'look'], ['Inv', 'inventory'], ['Again', 'again']] as const) {
    await tapControl(page, 'ifb-cmd', label)
    expect(await page.evaluate(() => window.SYN.submitted().at(-1))).toBe(cmd)
  }
})

test('verb then word sends the pair, and clears the armed state', async ({ page }) => {
  await tapVerb(page, 'Take')
  expect(await page.locator('.ifb-armed').count()).toBe(1)
  await tapWord(page, 'mailbox')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['take mailbox'])
  expect(await page.locator('.ifb-armed').count()).toBe(0)
})

test('word then verb sends the same pair (either order)', async ({ page }) => {
  await tapWord(page, 'egg')
  expect(await page.locator('.ifb-armed').count()).toBe(1)
  await tapVerb(page, 'Examine')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['examine egg'])
  expect(await page.locator('.ifb-armed').count()).toBe(0)
})

test('a multi-word verb pairs correctly', async ({ page }) => {
  await tapVerb(page, 'Turn on')
  await tapWord(page, 'mailbox')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['turn on mailbox'])
})

test('cancel clears an armed verb and sends nothing', async ({ page }) => {
  await tapVerb(page, 'Take')
  await page.locator('#ifb-bar .ifb-cancel').click()
  expect(await page.locator('.ifb-armed').count()).toBe(0)
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual([])
})

test('CHAR input mode never silently swallows a command', async ({ page }) => {
  await page.evaluate(() => { window.SYN.reset(); window.SYN.setChar() })
  expect(await page.evaluate(() => window.IFButtons.inputMode())).toBe('char')

  await tapControl(page, 'ifb-move', 'N')
  // The command must NOT be delivered as a line...
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual([])
  // ...and a keypress must reach the host instead, so a "press any key" prompt actually advances.
  expect(await page.evaluate(() => window.SYN.charKeys())).toContain(32)
  expect(await page.evaluate(() => window.IFButtons.submitCommand('look'))).toBe(false)
})

test('a visible MorePrompt is dismissed instead of dropping the command', async ({ page }) => {
  await page.evaluate(() => { window.SYN.reset(); window.SYN.showMore() })
  expect(await page.evaluate(() => window.IFButtons.inputMode())).toBe('more')

  await tapControl(page, 'ifb-move', 'S')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual([])
  // The pager is gone, so the player's next tap lands.
  await expect(page.locator('.MorePrompt')).toHaveCount(0)
  expect(await page.evaluate(() => window.IFButtons.inputMode())).toBe('line')
  await tapControl(page, 'ifb-move', 'S')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['south'])
})

test('a HIDDEN MorePrompt does not deadlock input', async ({ page }) => {
  // A host may keep the element and toggle visibility. Treating a hidden one as active would make
  // inputMode() return 'more' forever and no command would ever be sent again.
  await page.evaluate(() => { window.SYN.reset(); window.SYN.showMore(true) })
  expect(await page.evaluate(() => window.IFButtons.inputMode())).toBe('line')
  await tapControl(page, 'ifb-move', 'E')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['east'])
})

test('the addon prefers .Input.LineInput and tolerates a bare .Input alongside it', async ({ page }) => {
  const which = await page.evaluate(() => {
    window.SYN.reset()
    window.SYN.setLine({ alsoBare: true })
    return window.IFButtons.findLineInput()?.className ?? null
  })
  expect(which).toBe('Input LineInput')
})

test('the addon falls back to a bare .Input when the host omits the LineInput class', async ({ page }) => {
  await page.evaluate(() => { window.SYN.reset(); window.SYN.setLine({ bareOnly: true }) })
  expect(await page.evaluate(() => window.IFButtons.inputMode())).toBe('line')
  await tapControl(page, 'ifb-move', 'W')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['west'])
})

test('works when the line input is an <input> rather than a <textarea>', async ({ page }) => {
  // Modern AsyncGlk uses a textarea; older GlkOte builds use an input. Both must work.
  await page.evaluate(() => { window.SYN.reset(); window.SYN.setLine({ tag: 'input' }) })
  expect(await page.evaluate(() => window.IFButtons.findLineInput()?.tagName)).toBe('INPUT')
  await tapControl(page, 'ifb-move', 'Up')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['up'])
})

test('residue left in the field is replaced, not appended to', async ({ page }) => {
  await page.evaluate(() => {
    window.SYN.reset()
    const el = document.querySelector<HTMLTextAreaElement>('.Input.LineInput')
    if (el) { el.value = 'ta' }        // as if a host had appended a partial command
  })
  await tapVerb(page, 'Take')
  await tapWord(page, 'mailbox')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['take mailbox'])
})

test('echoed player input is never made tappable', async ({ page }) => {
  await tapControl(page, 'ifb-move', 'N')
  await expect(page.locator('.Style_input')).toHaveCount(1)
  // The echo is new DOM, so this also proves the MutationObserver decorates additions without
  // decorating the echo itself.
  expect(await page.locator('.Style_input .ifb-word').count()).toBe(0)
})

test('new output is decorated as it arrives, and stays tappable', async ({ page }) => {
  await page.evaluate(() => { window.SYN.reset(); window.SYN.addLine('A brass lantern sits here.') })
  await expect(page.locator('.ifb-word', { hasText: 'lantern' }).first()).toBeVisible()
  await tapVerb(page, 'Take')
  await tapWord(page, 'lantern')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['take lantern'])
})

test('story text is never parsed as markup', async ({ page }) => {
  await page.evaluate(() => window.SYN.addLine('<img src=x onerror="window.__XSS=1"> A lamp.'))
  await expect(page.locator('.ifb-word', { hasText: 'lamp' }).first()).toBeVisible()
  expect(await page.evaluate(() => 'img' in document.createElement('div') && !!document.querySelector('.BufferWindow img'))).toBe(false)
  expect(await page.evaluate(() => (window as unknown as { __XSS?: number }).__XSS)).toBeUndefined()
  expect(await bufferText(page)).toContain('<img src=x onerror="window.__XSS=1">')
})

test('the verb list persists across a reload', async ({ page }) => {
  await page.evaluate(() => { window.IFButtons.saveVerbs(['take', 'dig']) })
  await page.reload()
  await page.waitForSelector('#ifb-bar')
  await page.evaluate(() => window.IFButtons.stopBoot())
  expect(await page.locator('#ifb-bar .ifb-verb').allTextContents()).toEqual(['Take', 'Dig'])
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('no map element means no map affordance at all', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.classList.contains('ifb-host-map'))).toBe(false)
  await expect(page.locator('#ifb-bar .ifb-maptoggle')).toHaveCount(0)
})

test('every control is a real button, and icon-only ones are labelled', async ({ page }) => {
  const controls = await page.evaluate(() =>
    [...document.querySelectorAll('#ifb-bar .ifb')].map(c => ({
      tag: c.tagName,
      type: c.getAttribute('type'),
      text: (c.textContent ?? '').trim(),
      label: c.getAttribute('aria-label'),
    })))
  expect(controls.length).toBeGreaterThan(0)
  for (const c of controls) {
    expect(c.tag).toBe('BUTTON')
    expect(c.type).toBe('button')
    // A glyph gives a screen reader nothing to announce, so icon-only controls need a real name.
    if (['✕', '⚙', '⊞', '↵'].includes(c.text)) { expect(c.label).toBeTruthy() }
  }
})

test('buttons meet the 44px touch target the stylesheet promises', async ({ page }) => {
  // The CSS is a deliverable the jsdom suite cannot check, since jsdom does no layout.
  const tooSmall = await page.evaluate(() =>
    [...document.querySelectorAll('#ifb-bar .ifb')]
      .map(el => ({ text: (el.textContent ?? '').trim(), h: el.getBoundingClientRect().height }))
      .filter(b => b.h < 44))
  expect(tooSmall).toEqual([])
})

test('the bar is at most three buttons tall', async ({ page }) => {
  const m = await page.evaluate(() => {
    const bar = document.getElementById('ifb-bar')
    if (!bar) { return null }
    const cs = getComputedStyle(document.documentElement)
    const btn = Number.parseFloat(cs.getPropertyValue('--ifb-btn-h'))
    const gap = Number.parseFloat(cs.getPropertyValue('--ifb-gap'))
    const rows = Number.parseFloat(cs.getPropertyValue('--ifb-rows'))
    return {
      height: bar.getBoundingClientRect().height,
      budget: rows * btn + (rows - 1) * gap + 16,   // + the bar's own 8px top/bottom padding
      rows, btn,
    }
  })
  if (!m) { throw new Error('no bar') }
  expect(m.rows).toBe(3)
  // Three rows of targets plus the gaps between them, and not a pixel more.
  expect(m.height).toBeLessThanOrEqual(m.budget + 1)
  // ...and it really is using the space, not collapsed to nothing.
  expect(m.height).toBeGreaterThanOrEqual(m.btn)
})

test('extra buttons make the bar scroll rather than grow', async ({ page }) => {
  const before = await page.evaluate(() => document.getElementById('ifb-bar')!.getBoundingClientRect().height)
  // Far more verbs than can fit in three rows.
  await page.evaluate(() => {
    window.IFButtons.saveVerbs(Array.from({ length: 30 }, (_, i) => 'verb' + i))
    window.IFButtons.renderVerbs()
  })
  const after = await page.evaluate(() => {
    const bar = document.getElementById('ifb-bar')!
    return {
      height: bar.getBoundingClientRect().height,
      scrollHeight: bar.scrollHeight,
      overflowY: getComputedStyle(bar).overflowY,
    }
  })
  // The bar did not get taller...
  expect(after.height).toBeLessThanOrEqual(before + 1)
  // ...the content overflows and is reachable by scrolling instead.
  expect(after.scrollHeight).toBeGreaterThan(after.height + 5)
  expect(after.overflowY).toMatch(/auto|scroll/)
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('the reservation matches the bar exactly, so nothing is hidden', async ({ page }) => {
  const m = await page.evaluate(() => {
    const bar = document.getElementById('ifb-bar')!
    return {
      barHeight: Math.ceil(bar.getBoundingClientRect().height),
      reserved: Number.parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--ifb-bar-height')),
    }
  })
  // Measured, not guessed: a fixed guess under-reserved by ~180px and buried the live input line.
  expect(m.reserved).toBe(m.barHeight)
})

test('a full buffer never leaves output or the input under the bar', async ({ page }) => {
  // The regression this exists for: with a hardcoded reservation, 173px of output including the live
  // input sat beneath the overlay AND was unreachable, because the buffer was already at its end.
  await page.setViewportSize({ width: 820, height: 1100 })
  await page.evaluate(() => {
    for (let i = 0; i < 60; i++) {
      window.SYN.addLine('You are in a maze of twisty little passages, all alike. ' + i)
    }
    const bw = document.querySelector<HTMLElement>('.BufferWindow')!
    bw.scrollTop = bw.scrollHeight            // as a player at the newest line would be
  })
  await page.waitForTimeout(250)
  const m = await page.evaluate(() => {
    const barTop = document.getElementById('ifb-bar')!.getBoundingClientRect().top
    const lines = [...document.querySelectorAll('.BufferLine')]
    const last = lines[lines.length - 1]!.getBoundingClientRect()
    const input = document.querySelector('.Input.LineInput')!.getBoundingClientRect()
    const bw = document.querySelector<HTMLElement>('.BufferWindow')!
    return {
      lastHiddenBy: Math.round(last.bottom - barTop),
      inputHiddenBy: Math.round(input.bottom - barTop),
      atEnd: bw.scrollHeight - bw.scrollTop - bw.clientHeight < 4,
    }
  })
  expect(m.atEnd).toBe(true)          // the reader is at the newest output
  expect(m.lastHiddenBy).toBeLessThanOrEqual(0)
  expect(m.inputHiddenBy).toBeLessThanOrEqual(0)
})

test('the movement pad is laid out NW/N/NE/Up, W/↵/E/Down, SW/S/SE/gear', async ({ page }) => {
  const pos = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#ifb-bar .ifb-moves > *')].map(b => {
      const r = b.getBoundingClientRect()
      return {
        label: (b.textContent ?? '').trim(),
        cls: b.className.replace('ifb ', ''),
        x: Math.round(r.left), y: Math.round(r.top),
      }
    }))
  const at = (l: string) => {
    const f = pos.find(p => p.label === l)
    if (!f) { throw new Error('no pad button labelled ' + l + ' (have: ' + pos.map(p => p.label).join(',') + ')') }
    return f
  }
  const rows = [...new Set(pos.map(p => p.y))].sort((a, b) => a - b)
  const cols = [...new Set(pos.map(p => p.x))].sort((a, b) => a - b)
  expect(rows).toHaveLength(3)
  expect(cols).toHaveLength(4)

  const cell = (label: string) => [rows.indexOf(at(label).y), cols.indexOf(at(label).x)]
  expect(cell('NW')).toEqual([0, 0]);   expect(cell('N')).toEqual([0, 1])
  expect(cell('NE')).toEqual([0, 2]);   expect(cell('Up')).toEqual([0, 3])
  expect(cell('W')).toEqual([1, 0]);    expect(cell('↵')).toEqual([1, 1])
  expect(cell('E')).toEqual([1, 2]);    expect(cell('Down')).toEqual([1, 3])
  expect(cell('SW')).toEqual([2, 0]);   expect(cell('S')).toEqual([2, 1])
  expect(cell('SE')).toEqual([2, 2]);   expect(cell('⚙')).toEqual([2, 3])
})

test('the pad is the leftmost thing in the bar, everything else to its right', async ({ page }) => {
  const m = await page.evaluate(() => {
    const pad = document.querySelector<HTMLElement>('#ifb-bar .ifb-moves')!.getBoundingClientRect()
    const others = [...document.querySelectorAll<HTMLElement>('#ifb-bar .ifb-verbs, #ifb-bar .ifb-cmds')]
      .map(g => ({ cls: g.className, left: Math.round(g.getBoundingClientRect().left) }))
    return { padLeft: Math.round(pad.left), padRight: Math.round(pad.right), others }
  })
  expect(m.others.length).toBeGreaterThan(0)
  for (const o of m.others) {
    expect(o.left).toBeGreaterThanOrEqual(m.padRight - 1)
  }
})

test('↵ submits the field as it stands, without rewriting it', async ({ page }) => {
  await page.evaluate(() => {
    window.SYN.reset()
    const el = document.querySelector<HTMLTextAreaElement>('.Input.LineInput')!
    el.value = 'take mailbox'          // as if half-typed
  })
  await page.locator('#ifb-bar .ifb-enter').click()
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['take mailbox'])
})

test('↵ advances a char prompt rather than doing nothing', async ({ page }) => {
  await page.evaluate(() => { window.SYN.reset(); window.SYN.setChar() })
  await page.locator('#ifb-bar .ifb-enter').click()
  expect(await page.evaluate(() => window.SYN.charKeys())).toContain(13)
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual([])
})

test('↵ dismisses a pager rather than doing nothing', async ({ page }) => {
  await page.evaluate(() => { window.SYN.reset(); window.SYN.showMore() })
  await page.locator('#ifb-bar .ifb-enter').click()
  await expect(page.locator('.MorePrompt')).toHaveCount(0)
  expect(await page.evaluate(() => window.IFButtons.inputMode())).toBe('line')
})

test('the page raised no uncaught errors', async ({ page }) => {
  await tapControl(page, 'ifb-move', 'N')
  await tapVerb(page, 'Take')
  await tapWord(page, 'mailbox')
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([])
})
