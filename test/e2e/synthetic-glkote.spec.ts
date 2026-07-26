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

test('the bar renders the compass, one merged verb list, and two actions', async ({ page }) => {
  expect(await page.locator('#ifb-bar .ifb-move').allTextContents())
    .toEqual(['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE', 'Up', 'Down'])
  // The old no-argument commands are ordinary verb-list entries now, staged like anything else.
  const verbs = (await page.locator('#ifb-bar .ifb-verb').allTextContents()).map(v => v.toLowerCase())
  for (const w of ['look', 'inventory', 'take', 'examine', 'again', 'undo', 'save', 'restore']) {
    expect(verbs).toContain(w)
  }
  await expect(page.locator('#ifb-bar .ifb-cmds')).toHaveCount(0)
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

test('a verb tap STAGES and sends nothing until the return key', async ({ page }) => {
  await page.evaluate(() => window.SYN.reset())
  await tapVerb(page, 'Look')
  // Staged in the field where the player can see it...
  expect(await page.inputValue('.Input.LineInput')).toBe('look')
  // ...and emphatically not sent.
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual([])

  await page.locator('#ifb-bar .ifb-enter').click()
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['look'])
})

test('a direction still sends immediately, with no confirmation', async ({ page }) => {
  await page.evaluate(() => window.SYN.reset())
  await tapControl(page, 'ifb-move', 'N')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['north'])
})

test('a staged command is sent exactly once', async ({ page }) => {
  await page.evaluate(() => window.SYN.reset())
  await tapVerb(page, 'Look')
  await page.locator('#ifb-bar .ifb-enter').click()
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['look'])
  // The host cleared the field on submit, so a second press must not resend.
  await page.locator('#ifb-bar .ifb-enter').click()
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['look'])
})

test('the cancel button clears the staged text too', async ({ page }) => {
  await page.evaluate(() => window.SYN.reset())
  await tapVerb(page, 'Take')
  await tapWord(page, 'mailbox')
  expect(await page.inputValue('.Input.LineInput')).toBe('take mailbox')
  await page.locator('#ifb-bar .ifb-cancel').click()
  expect(await page.inputValue('.Input.LineInput')).toBe('')
  await expect(page.locator('.ifb-armed')).toHaveCount(0)
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual([])
})

test('the actions column is rightmost and stacked vertically', async ({ page }) => {
  // No map element on this page, so the toggle is absent \u2014 backspace and cancel remain, in that order.
  expect(await page.locator('#ifb-bar .ifb-actions .ifb').allTextContents()).toEqual(['\u232b', '\u2715'])
  const box = await page.evaluate(() => {
    const lefts = [...document.querySelectorAll<HTMLElement>('#ifb-bar .ifb-actions .ifb')]
      .map(e => Math.round(e.getBoundingClientRect().left))
    const verbs = document.querySelector<HTMLElement>('#ifb-bar .ifb-verbs')!.getBoundingClientRect()
    const actions = document.querySelector<HTMLElement>('#ifb-bar .ifb-actions')!.getBoundingClientRect()
    return { lefts, verbsRight: Math.round(verbs.right), actionsLeft: Math.round(actions.left) }
  })
  expect(box.actionsLeft).toBeGreaterThanOrEqual(box.verbsRight - 1)
  expect(new Set(box.lefts).size).toBe(1)      // one column, so one shared left edge
})

test('verb then word sends the pair, and clears the armed state', async ({ page }) => {
  await tapVerb(page, 'Take')
  expect(await page.locator('.ifb-armed').count()).toBe(1)
  await tapWord(page, 'mailbox')
  expect(await page.inputValue('.Input.LineInput')).toBe('take mailbox')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual([])
  expect(await page.locator('.ifb-armed').count()).toBe(0)
})

test('word order is TAP order', async ({ page }) => {
  // The either-order guarantee was given up deliberately, in exchange for commands longer than two
  // words. Tapping the noun first now reads back in the order tapped.
  await tapWord(page, 'egg')
  await tapVerb(page, 'Examine')
  expect(await page.inputValue('.Input.LineInput')).toBe('egg examine')
})

test('a four-word command can be built by tapping', async ({ page }) => {
  await page.evaluate(() => {
    window.SYN.reset()
    window.IFButtons.saveVerbs(['unlock', 'with'])
    window.IFButtons.renderVerbs()
    window.SYN.addLine('A locked door. A brass key.')
  })
  await tapVerb(page, 'Unlock')
  await tapWord(page, 'door')
  await tapVerb(page, 'With')
  await tapWord(page, 'key')
  expect(await page.inputValue('.Input.LineInput')).toBe('unlock door with key')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual([])

  await page.locator('#ifb-bar .ifb-enter').click()
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['unlock door with key'])
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('⌫ removes the last word without abandoning the command', async ({ page }) => {
  await page.evaluate(() => { window.SYN.reset(); window.SYN.addLine('A door here.') })
  await tapVerb(page, 'Take')
  await tapWord(page, 'door')
  expect(await page.inputValue('.Input.LineInput')).toBe('take door')
  await page.locator('#ifb-bar .ifb-dropword').click()
  expect(await page.inputValue('.Input.LineInput')).toBe('take')
  await page.locator('#ifb-bar .ifb-cancel').click()
  expect(await page.inputValue('.Input.LineInput')).toBe('')
})

test('a multi-word verb pairs correctly', async ({ page }) => {
  await tapVerb(page, 'Turn on')
  await tapWord(page, 'mailbox')
  expect(await page.inputValue('.Input.LineInput')).toBe('turn on mailbox')
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
  await page.locator('#ifb-bar .ifb-enter').click()
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
  await page.locator('#ifb-bar .ifb-enter').click()
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

test('buttons that will not fit scroll inside the bar rather than growing it', async ({ page }) => {
  // A tablet in portrait is narrow enough that the default verb list needs more than three rows.
  // Measured widths with the 23 default verbs: 1280px and 900px fit in <=3 rows and do not scroll;
  // 820px and below overflow. Both halves of that are the specified behaviour, so assert both.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(150)
  const wide = await page.evaluate(() => {
    const bar = document.getElementById('ifb-bar')!
    return { h: Math.round(bar.getBoundingClientRect().height), scroll: bar.scrollHeight }
  })
  expect(wide.scroll).toBeLessThanOrEqual(wide.h + 2)     // roomy: nothing to scroll

  await page.setViewportSize({ width: 820, height: 1100 })
  await page.waitForTimeout(150)
  const narrow = await page.evaluate(() => {
    const bar = document.getElementById('ifb-bar')!
    const cs = getComputedStyle(document.documentElement)
    const rows = Number.parseFloat(cs.getPropertyValue('--ifb-rows'))
    const btn = Number.parseFloat(cs.getPropertyValue('--ifb-btn-h'))
    const gap = Number.parseFloat(cs.getPropertyValue('--ifb-gap'))
    return {
      h: Math.round(bar.getBoundingClientRect().height),
      scroll: bar.scrollHeight,
      overflowY: getComputedStyle(bar).overflowY,
      budget: rows * btn + (rows - 1) * gap + 16,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  // Still capped at three rows...
  expect(narrow.h).toBeLessThanOrEqual(narrow.budget + 1)
  // ...with the remainder reachable by scrolling the bar, not by the bar getting taller.
  expect(narrow.scroll).toBeGreaterThan(narrow.h + 5)
  expect(narrow.overflowY).toMatch(/auto|scroll/)
  // And it must never push the page sideways.
  expect(narrow.pageScrollsSideways).toBe(false)
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
    const others = [...document.querySelectorAll<HTMLElement>('#ifb-bar .ifb-verbs, #ifb-bar .ifb-actions')]
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

test('the settings editor replaces the buttons, and Close brings them back', async ({ page }) => {
  const row = page.locator('#ifb-bar .ifb-row')
  const editor = page.locator('#ifb-editor')
  await expect(row).toBeVisible()
  await expect(editor).toBeHidden()

  await page.locator('#ifb-bar .ifb-editverbs').click()
  // In place of, not alongside.
  await expect(row).toBeHidden()
  await expect(editor).toBeVisible()
  await expect(page.locator('#ifb-editor .ifb-closeeditor')).toBeVisible()
  await expect(page.locator('#ifb-editor .ifb-newverb')).toBeVisible()

  await page.locator('#ifb-editor .ifb-closeeditor').click()
  await expect(row).toBeVisible()
  await expect(editor).toBeHidden()
  // The buttons work again.
  await page.evaluate(() => window.SYN.reset())
  await tapControl(page, 'ifb-move', 'N')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['north'])
})

test('the editor honours the three-row cap and scrolls instead of growing', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 1100 })
  // A deterministic list that cannot fit: the default 23 words DO fit in three rows now that the chips
  // carry only the word, so relying on the defaults would make this assertion depend on chip width.
  await page.evaluate(() => {
    window.IFButtons.saveVerbs(Array.from({ length: 40 }, (_, i) => 'word' + i))
    window.IFButtons.renderVerbs()
    window.IFButtons.openEditor()
  })
  await page.waitForTimeout(200)
  const m = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const capped = Number.parseFloat(cs.getPropertyValue('--ifb-rows')) * Number.parseFloat(cs.getPropertyValue('--ifb-btn-h'))
      + (Number.parseFloat(cs.getPropertyValue('--ifb-rows')) - 1) * Number.parseFloat(cs.getPropertyValue('--ifb-gap')) + 16
    const bar = document.getElementById('ifb-bar')!
    return {
      capped,
      h: Math.round(bar.getBoundingClientRect().height),
      scroll: bar.scrollHeight,
      reserved: Number.parseFloat(cs.getPropertyValue('--ifb-bar-height')),
    }
  })
  expect(m.h).toBeLessThanOrEqual(m.capped + 1)
  expect(m.reserved).toBe(m.h)           // the reservation follows the editor too
  expect(m.scroll).toBeGreaterThan(m.h)  // the overflow scrolls rather than growing the bar
  await page.locator('#ifb-editor .ifb-closeeditor').click()
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('adding a verb from the editor keeps it open and updates both lists', async ({ page }) => {
  await page.evaluate(() => window.IFButtons.saveVerbs(['take']))
  await page.evaluate(() => window.IFButtons.renderVerbs())
  await page.locator('#ifb-bar .ifb-editverbs').click()
  await page.locator('#ifb-editor .ifb-newverb').fill('dig')
  await page.locator('#ifb-editor .ifb-addverb').click()
  await expect(page.locator('#ifb-editor')).toBeVisible()
  expect(await page.locator('#ifb-editor .ifb-verbchip').count()).toBe(2)
  await page.locator('#ifb-editor .ifb-closeeditor').click()
  const verbs = (await page.locator('#ifb-bar .ifb-verb').allTextContents()).map(v => v.toLowerCase())
  expect(verbs).toEqual(['take', 'dig'])
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

async function openSettingsWith(page: import('@playwright/test').Page, words: string[]) {
  await page.evaluate(w => {
    window.IFButtons.saveVerbs(w)
    window.IFButtons.renderVerbs()
    window.IFButtons.openEditor()
  }, words)
  await expect(page.locator('#ifb-editor .ifb-verbchip')).toHaveCount(words.length)
}

const chipOrder = (page: import('@playwright/test').Page) =>
  page.locator('#ifb-editor .ifb-verbchip').allTextContents()

test('a word can be dragged to a new position with a mouse', async ({ page }) => {
  await openSettingsWith(page, ['look', 'take', 'dig'])
  const from = await page.locator('#ifb-editor .ifb-verbchip[data-verb="look"]').boundingBox()
  const to = await page.locator('#ifb-editor .ifb-verbchip[data-verb="dig"]').boundingBox()
  if (!from || !to) { throw new Error('chips not laid out') }

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // Past the halfway point of the last chip, so it lands after it.
  await page.mouse.move(to.x + to.width * 0.9, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()

  expect(await chipOrder(page)).toEqual(['take', 'dig', 'look'])
  expect(await page.evaluate(() => window.IFButtons.loadVerbs())).toEqual(['take', 'dig', 'look'])
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('a drag does not also toggle the selection when it ends', async ({ page }) => {
  // A drag finishes with a pointer-up on the chip, which the browser also reports as a click.
  await openSettingsWith(page, ['look', 'take', 'dig'])
  const from = await page.locator('#ifb-editor .ifb-verbchip[data-verb="look"]').boundingBox()
  const to = await page.locator('#ifb-editor .ifb-verbchip[data-verb="take"]').boundingBox()
  if (!from || !to) { throw new Error('chips not laid out') }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width * 0.9, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()
  // The dragged word stays selected — it is not toggled off by the trailing click.
  expect(await page.evaluate(() => window.IFButtons.selectedVerbName())).toBe('look')
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('a tap without movement selects rather than reordering', async ({ page }) => {
  await openSettingsWith(page, ['look', 'take', 'dig'])
  await page.locator('#ifb-editor .ifb-verbchip[data-verb="take"]').click()
  expect(await page.evaluate(() => window.IFButtons.selectedVerbName())).toBe('take')
  expect(await chipOrder(page)).toEqual(['look', 'take', 'dig'])
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('a word can be dragged by TOUCH, as on a tablet', async ({ page }) => {
  await openSettingsWith(page, ['look', 'take', 'dig'])
  /*
   * A tablet does NOT deliver raw TouchEvents to this code. In any browser with Pointer Events — which
   * is every current one — a finger produces pointerdown/move/up with pointerType 'touch', and that is
   * the branch the addon registers. So drive exactly that. (The touch-event fallback in the source is
   * only reachable on Safari 11.1-12, which predates Pointer Events and which Playwright cannot run.)
   */
  const ok = await page.evaluate(() => {
    const grab = document.querySelector<HTMLElement>('#ifb-editor .ifb-verbchip[data-verb="look"]')
    const target = document.querySelector<HTMLElement>('#ifb-editor .ifb-verbchip[data-verb="dig"]')
    if (!grab || !target) { return 'missing elements' }
    const at = (el: HTMLElement, fx: number) => {
      const r = el.getBoundingClientRect()
      return { clientX: r.left + r.width * fx, clientY: r.top + r.height / 2 }
    }
    const fire = (type: string, el: HTMLElement, p: { clientX: number; clientY: number }) => {
      el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, ...p,
      }))
    }
    fire('pointerdown', grab, at(grab, 0.5))
    fire('pointermove', grab, at(target, 0.9))
    fire('pointerup', grab, at(target, 0.9))
    return 'ok'
  })
  expect(ok).toBe('ok')
  expect(await chipOrder(page)).toEqual(['take', 'dig', 'look'])
  expect(await page.evaluate(() => window.IFButtons.loadVerbs())).toEqual(['take', 'dig', 'look'])
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('touch-action is none on a word, so a touch drag is not stolen by scrolling', async ({ page }) => {
  await openSettingsWith(page, ['look', 'take'])
  const ta = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#ifb-editor .ifb-verbchip')!).touchAction)
  expect(ta).toBe('none')
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('the move buttons reorder the selected word', async ({ page }) => {
  await openSettingsWith(page, ['look', 'take', 'dig'])
  await page.locator('#ifb-editor .ifb-verbchip[data-verb="dig"]').click()
  await page.locator('#ifb-editor .ifb-moveleft').click()
  expect(await chipOrder(page)).toEqual(['look', 'dig', 'take'])
  await page.locator('#ifb-editor .ifb-moveleft').click()
  expect(await chipOrder(page)).toEqual(['dig', 'look', 'take'])
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('the actions are disabled until a word is selected', async ({ page }) => {
  await openSettingsWith(page, ['look', 'take'])
  for (const c of ['ifb-moveleft', 'ifb-moveright', 'ifb-deleteverb']) {
    await expect(page.locator('#ifb-editor .' + c)).toBeDisabled()
  }
  await page.locator('#ifb-editor .ifb-verbchip[data-verb="take"]').click()
  for (const c of ['ifb-moveleft', 'ifb-moveright', 'ifb-deleteverb']) {
    await expect(page.locator('#ifb-editor .' + c)).toBeEnabled()
  }
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('reordering changes which words are reachable without scrolling', async ({ page }) => {
  // The point of reordering: the strip shows three rows and scrolls, so order decides what is in reach.
  await openSettingsWith(page, ['look', 'take', 'dig'])
  await page.locator('#ifb-editor .ifb-verbchip[data-verb="dig"]').click()
  await page.locator('#ifb-editor .ifb-moveleft').click()
  await page.locator('#ifb-editor .ifb-moveleft').click()
  await page.locator('#ifb-editor .ifb-closeeditor').click()
  expect((await page.locator('#ifb-bar .ifb-verb').allTextContents()).map(v => v.toLowerCase()))
    .toEqual(['dig', 'look', 'take'])
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('the settings top row is one button tall and holds every control on one line', async ({ page }) => {
  await openSettingsWith(page, ['look', 'take', 'dig'])
  for (const width of [820, 600]) {
    await page.setViewportSize({ width, height: 1100 })
    await page.waitForTimeout(150)
    const m = await page.evaluate(() => {
      const px = (v: string) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v))
      const row = document.querySelector<HTMLElement>('#ifb-editor .ifb-editrow')!
      const kids = [...row.children] as HTMLElement[]
      return {
        btnH: px('--ifb-btn-h'),
        rowH: Math.round(row.getBoundingClientRect().height),
        chipH: Math.round(document.querySelector('#ifb-editor .ifb-verbchip')!.getBoundingClientRect().height),
        inputH: Math.round(document.querySelector('#ifb-editor .ifb-newverb')!.getBoundingClientRect().height),
        inputW: Math.round(document.querySelector('#ifb-editor .ifb-newverb')!.getBoundingClientRect().width),
        lines: new Set(kids.map(k => Math.round(k.getBoundingClientRect().top))).size,
        controls: kids.length,
      }
    })
    // One button tall, same as a chip row — the input used to make this row stand out.
    expect(m.rowH).toBe(m.btnH)
    expect(m.chipH).toBe(m.btnH)
    expect(m.inputH).toBe(m.btnH)
    // Close, the text box, Add, Defaults, and the three actions.
    expect(m.controls).toBe(7)
    expect(m.lines).toBe(1)          // the text box gives up width rather than wrapping the row
    expect(m.inputW).toBeGreaterThan(40)
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('the move and delete actions live in that top row', async ({ page }) => {
  await openSettingsWith(page, ['look', 'take'])
  for (const c of ['ifb-moveleft', 'ifb-moveright', 'ifb-deleteverb']) {
    await expect(page.locator('#ifb-editor .ifb-editrow > .' + c)).toHaveCount(1)
  }
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('a verb then a direction sends the pair, not a bare direction', async ({ page }) => {
  // Reported bug: tapping Look then N went north and discarded the verb.
  await page.evaluate(() => {
    window.SYN.reset()
    window.IFButtons.saveVerbs(['look', 'take'])
    window.IFButtons.renderVerbs()
  })
  await tapVerb(page, 'Look')
  expect(await page.inputValue('.Input.LineInput')).toBe('look')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual([])

  await tapControl(page, 'ifb-move', 'N')
  // Composed and sent on the spot — no return key needed for a direction.
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['look north'])
  await expect(page.locator('.ifb-armed')).toHaveCount(0)

  // And the next direction is plain movement again.
  await tapControl(page, 'ifb-move', 'S')
  expect(await page.evaluate(() => window.SYN.submitted())).toEqual(['look north', 'south'])
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('layouts keep a separate word list, and survive a reload', async ({ page }) => {
  await page.evaluate(() => {
    window.IFButtons.saveVerbs(['take'])
    window.IFButtons.createLayout('Zork')
    window.IFButtons.saveVerbs(['dig', 'climb'])
    window.IFButtons.openEditor()
  })
  const picker = page.locator('#ifb-editor .ifb-layoutpicker')
  await expect(picker).toHaveValue('Zork')
  await expect(page.locator('#ifb-editor .ifb-verbchip')).toHaveCount(2)

  // Switching layout swaps the strip.
  await picker.selectOption('Default')
  expect((await page.locator('#ifb-bar .ifb-verb').allTextContents()).map(v => v.toLowerCase()))
    .toEqual(['take'])

  // Both the words and the active choice survive a reload.
  await picker.selectOption('Zork')
  await page.reload()
  await page.waitForSelector('#ifb-bar')
  await page.evaluate(() => window.IFButtons.stopBoot())
  expect(await page.evaluate(() => window.IFButtons.activeLayout())).toBe('Zork')
  expect((await page.locator('#ifb-bar .ifb-verb').allTextContents()).map(v => v.toLowerCase()))
    .toEqual(['dig', 'climb'])

  await page.evaluate(() => {
    window.IFButtons.deleteActiveLayout()
    window.IFButtons.resetVerbs()
  })
})

test('a layout can be created, renamed and dropped from settings', async ({ page }) => {
  await page.evaluate(() => window.IFButtons.openEditor())
  await page.locator('#ifb-editor .ifb-layoutname').fill('Zork')
  await page.locator('#ifb-editor .ifb-newlayout').click()
  await expect(page.locator('#ifb-editor .ifb-layoutpicker')).toHaveValue('Zork')

  await page.locator('#ifb-editor .ifb-layoutname').fill('Zork I')
  await page.locator('#ifb-editor .ifb-renamelayout').click()
  await expect(page.locator('#ifb-editor .ifb-layoutpicker')).toHaveValue('Zork I')

  await page.locator('#ifb-editor .ifb-droplayout').click()
  await expect(page.locator('#ifb-editor .ifb-layoutpicker')).toHaveValue('Default')
  // Only one left, so it can no longer be dropped.
  await expect(page.locator('#ifb-editor .ifb-droplayout')).toBeDisabled()
  await page.evaluate(() => window.IFButtons.resetVerbs())
})

test('the page raised no uncaught errors', async ({ page }) => {
  await tapControl(page, 'ifb-move', 'N')
  await tapVerb(page, 'Take')
  await tapWord(page, 'mailbox')
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([])
})
