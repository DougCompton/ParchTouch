import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

type Glue = typeof import('../src/if-buttons')

// if-buttons.ts holds module-level state (the armed verb/noun, the boot timer), so each test needs a
// FRESH instance. vi.resetModules() clears Vitest's module registry so the next dynamic import
// re-evaluates the module — the idiomatic way, and it avoids relying on query-suffix resolution.
//
// stopBoot() cancels the auto-boot retry loop the module starts on load: without it every loadGlue()
// would leave pending timers that could fire mid-test and rebuild the bar, making the suite flaky.
async function loadGlue(): Promise<Glue> {
  document.body.innerHTML = ''
  document.documentElement.className = ''
  vi.resetModules()
  const mod = await import('../src/if-buttons')
  mod.stopBoot()
  return mod
}

interface BufferOpts {
  withInput?: boolean
  bareInput?: boolean
  withMore?: boolean
  moreHidden?: boolean
}

function makeBuffer(lines: string[] = ['West of House.'], opts: BufferOpts = {}): HTMLElement {
  const bw = document.createElement('div')
  bw.className = 'BufferWindow'
  for (const text of lines) {
    const line = document.createElement('div')
    line.className = 'BufferLine'
    line.textContent = text
    bw.appendChild(line)
  }
  if (opts.withInput) {
    const input = document.createElement('input')
    // GlkOte marks a LINE-mode input with both classes; some builds emit only .Input.
    input.className = opts.bareInput ? 'Input' : 'Input LineInput'
    bw.appendChild(input)
  }
  if (opts.withMore) {
    const more = document.createElement('div')
    more.className = 'MorePrompt'
    more.textContent = '— more —'
    // Some builds keep this element permanently and toggle visibility rather than
    // creating/destroying it, so the addon must ignore a hidden one (see Task 5.1).
    if (opts.moreHidden) { more.style.display = 'none' }
    bw.appendChild(more)
  }
  document.body.appendChild(bw)
  return bw
}

function liveInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input.Input')
  if (!el) { throw new Error('test setup: no input element') }
  return el
}

describe('findLineInput', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  it('finds the line input when the game awaits a command', () => {
    makeBuffer(['West of House.'], { withInput: true })
    expect(glue.findLineInput()).not.toBe(null)
  })

  it('returns null when there is no input (char-input or busy)', () => {
    makeBuffer(['Press SPACE to continue.'])
    expect(glue.findLineInput()).toBe(null)
  })

  it('returns the last input when several exist (previous turns echoed)', () => {
    const bw = makeBuffer(['turn one'], { withInput: true })
    const second = document.createElement('input')
    second.className = 'Input LineInput'
    second.dataset['which'] = 'live'
    bw.appendChild(second)
    expect(glue.findLineInput()?.dataset['which']).toBe('live')
  })

  it('prefers .Input.LineInput over a bare .Input when both are present', () => {
    const bw = makeBuffer(['x'])
    const bare = document.createElement('input')
    bare.className = 'Input'
    bare.dataset['which'] = 'bare'
    bw.appendChild(bare)
    const line = document.createElement('input')
    line.className = 'Input LineInput'
    line.dataset['which'] = 'line'
    bw.appendChild(line)
    expect(glue.findLineInput()?.dataset['which']).toBe('line')
  })

  it('falls back to a bare .Input when the host omits the LineInput class', () => {
    makeBuffer(['x'], { withInput: true, bareInput: true })
    expect(glue.findLineInput()).not.toBe(null)
  })
})

describe('inputMode', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  it('reports "line" when a line input is present', () => {
    makeBuffer(['x'], { withInput: true })
    expect(glue.inputMode()).toBe('line')
  })

  it('reports "more" when a MorePrompt is showing, even with an input present', () => {
    makeBuffer(['x'], { withInput: true, withMore: true })
    expect(glue.inputMode()).toBe('more')
  })

  it('reports "char" when there is no input and no MorePrompt', () => {
    makeBuffer(['Press any key.'])
    expect(glue.inputMode()).toBe('char')
  })

  it('ignores a HIDDEN MorePrompt — a host may keep the element and toggle visibility', () => {
    makeBuffer(['x'], { withInput: true, withMore: true, moreHidden: true })
    expect(glue.inputMode()).toBe('line')
  })
})

describe('submitCommand', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  // CORRECTED against real-host evidence. This test originally required the sequence
  // ['keydown', 'keypress', 'keyup']. Measured against both reference hosts, that sequence makes a
  // legacy jQuery-based GlkOte submit an EMPTY command and silently cost the player a turn: it binds
  // its own keydown handler on <body>, our keydown bubbles to it, and it clears the field before our
  // keypress can be read. `keypress` alone is delivered correctly by BOTH a modern AsyncGlk host and a
  // legacy one, so that is now the contract. The full measurement table is in the fireKey() comment in
  // src/if-buttons.ts, and test/e2e/*.spec.ts is the real-browser proof.
  it('writes the command into the input and fires Enter with keyCode 13', () => {
    makeBuffer(['x'], { withInput: true })
    const input = liveInput()
    const seen: Array<{ type: string; keyCode: number }> = []
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.addEventListener(type, e => seen.push({ type, keyCode: (e as KeyboardEvent).keyCode }))
    }
    expect(glue.submitCommand('north')).toBe(true)
    expect(input.value).toBe('north')
    expect(seen.map(s => s.type)).toEqual(['keypress'])
    expect(seen.every(s => s.keyCode === 13)).toBe(true)
  })

  it('never fires keydown, which makes a jQuery-based host submit an empty command', () => {
    makeBuffer(['x'], { withInput: true })
    const input = liveInput()
    const types: string[] = []
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.addEventListener(type, e => types.push(e.type))
    }
    glue.submitCommand('north')
    expect(types).toEqual(['keypress'])
  })

  it('carries the Enter code on which and charCode, not only keyCode', () => {
    // A jQuery host derives `which` for keypress from charCode and bails on a falsy value, so all
    // three must agree or the command is dropped.
    makeBuffer(['x'], { withInput: true })
    const seen: Array<{ keyCode: number; which: number; charCode: number }> = []
    liveInput().addEventListener('keypress', e => {
      const k = e as KeyboardEvent
      seen.push({ keyCode: k.keyCode, which: k.which, charCode: k.charCode })
    })
    glue.submitCommand('north')
    expect(seen).toEqual([{ keyCode: 13, which: 13, charCode: 13 }])
  })

  it('fires an input event so host listeners observe the value', () => {
    makeBuffer(['x'], { withInput: true })
    const handler = vi.fn()
    liveInput().addEventListener('input', handler)
    glue.submitCommand('look')
    expect(handler).toHaveBeenCalled()
  })

  it('replaces residue already in the field rather than appending to it', () => {
    makeBuffer(['x'], { withInput: true })
    const input = liveInput()
    input.value = 'ta'                       // a host may have appended a partial command
    glue.submitCommand('take lamp')
    expect(input.value).toBe('take lamp')
  })

  it('returns false and does not throw when no input exists', () => {
    makeBuffer(['Press any key.'])
    expect(() => glue.submitCommand('north')).not.toThrow()
    expect(glue.submitCommand('north')).toBe(false)
  })

  it('dismisses a MorePrompt instead of submitting when paging is pending', () => {
    makeBuffer(['x'], { withInput: true, withMore: true })
    const input = liveInput()
    expect(glue.submitCommand('north')).toBe(false)
    expect(input.value).toBe('')
  })

  it('does not submit an empty or whitespace-only command', () => {
    makeBuffer(['x'], { withInput: true })
    expect(glue.submitCommand('')).toBe(false)
    expect(glue.submitCommand('   ')).toBe(false)
  })
})

describe('decorateBuffer', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  it('wraps story words in tappable spans', () => {
    const bw = makeBuffer(['You see a brass lamp.'])
    glue.decorateBuffer(bw)
    expect([...bw.querySelectorAll('.ifb-word')].map(n => n.textContent))
      .toEqual(['You', 'see', 'a', 'brass', 'lamp'])
  })

  it('preserves the visible text exactly', () => {
    const bw = makeBuffer(['West of House. You are here!'])
    glue.decorateBuffer(bw)
    expect(bw.textContent).toBe('West of House. You are here!')
  })

  it('is idempotent — decorating twice does not double-wrap', () => {
    const bw = makeBuffer(['a lamp'])
    glue.decorateBuffer(bw)
    glue.decorateBuffer(bw)
    expect(bw.querySelectorAll('.ifb-word').length).toBe(2)
  })

  it('does not decorate echoed player input in a Style_input span', () => {
    const bw = makeBuffer([])
    const line = document.createElement('div')
    line.className = 'BufferLine'
    const echo = document.createElement('span')
    echo.className = 'Style_input'
    echo.textContent = 'take lamp'
    line.appendChild(echo)
    bw.appendChild(line)
    glue.decorateBuffer(bw)
    expect(echo.querySelectorAll('.ifb-word').length).toBe(0)
  })

  it('does not decorate a whole line carrying Style_input itself', () => {
    const bw = makeBuffer([])
    const line = document.createElement('div')
    line.className = 'BufferLine Style_input'
    line.textContent = 'take lamp'
    bw.appendChild(line)
    glue.decorateBuffer(bw)
    expect(line.querySelectorAll('.ifb-word').length).toBe(0)
  })

  it('does not inject markup from story text (XSS safety)', () => {
    const bw = makeBuffer(['<img src=x onerror=alert(1)> lamp'])
    glue.decorateBuffer(bw)
    expect(bw.querySelector('img')).toBe(null)
    expect(bw.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('handles an empty buffer and a null root without throwing', () => {
    const bw = makeBuffer([])
    expect(() => glue.decorateBuffer(bw)).not.toThrow()
    expect(() => glue.decorateBuffer(null)).not.toThrow()
  })
})

describe('buildBar', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  function verbButton(label: RegExp): HTMLButtonElement {
    const btn = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-verb')]
      .find(b => label.test(b.textContent ?? ''))
    if (!btn) { throw new Error('test setup: verb button not found') }
    return btn
  }

  it('renders the button bar once', () => {
    glue.buildBar()
    glue.buildBar()
    expect(document.querySelectorAll('#ifb-bar').length).toBe(1)
  })

  it('renders all ten movement directions', () => {
    glue.buildBar()
    expect([...document.querySelectorAll('#ifb-bar .ifb-move')].map(b => b.textContent))
      .toEqual(['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE', 'Up', 'Down'])
  })

  it('tapping a direction submits that direction', () => {
    makeBuffer(['x'], { withInput: true })
    glue.buildBar()
    const north = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-move')]
      .find(b => b.textContent === 'N')
    north?.click()
    expect(liveInput().value).toBe('north')
  })

  it('tapping a verb then a story word submits the pair', () => {
    const bw = makeBuffer(['a brass lamp'], { withInput: true })
    glue.decorateBuffer(bw)
    glue.buildBar()
    verbButton(/take/i).click()
    const lamp = [...bw.querySelectorAll<HTMLElement>('.ifb-word')]
      .find(n => n.textContent === 'lamp')
    lamp?.click()
    expect(liveInput().value).toBe('take lamp')
  })

  it('marks an armed verb and clears it after use', () => {
    const bw = makeBuffer(['a lamp'], { withInput: true })
    glue.decorateBuffer(bw)
    glue.buildBar()
    const take = verbButton(/take/i)
    take.click()
    expect(take.classList.contains('ifb-armed')).toBe(true)
    bw.querySelector<HTMLElement>('.ifb-word')?.click()
    expect(document.querySelectorAll('.ifb-armed').length).toBe(0)
  })

  it('the cancel button clears an armed verb', () => {
    glue.buildBar()
    verbButton(/take/i).click()
    document.querySelector<HTMLButtonElement>('#ifb-bar .ifb-cancel')?.click()
    expect(document.querySelectorAll('.ifb-armed').length).toBe(0)
  })

  it('gives every icon-only button an accessible name', () => {
    glue.buildBar()
    for (const sel of ['.ifb-cancel', '.ifb-editverbs']) {
      const btn = document.querySelector(`#ifb-bar ${sel}`)
      expect(btn?.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('every control is a real button element, not a clickable div', () => {
    glue.buildBar()
    const controls = document.querySelectorAll('#ifb-bar .ifb')
    expect(controls.length).toBeGreaterThan(0)
    for (const c of controls) {
      expect(c.tagName).toBe('BUTTON')
      expect(c.getAttribute('type')).toBe('button')
    }
  })
})

describe('verb list persistence and editing', () => {
  let glue: Glue
  beforeEach(async () => {
    localStorage.clear()
    glue = await loadGlue()
  })

  it('uses the default verbs when nothing is stored', () => {
    expect(glue.loadVerbs()).toEqual(expect.arrayContaining(['examine', 'take']))
  })

  it('persists an added verb across a reload', async () => {
    glue.saveVerbs(['take', 'dig'])
    const again = await loadGlue()
    expect(again.loadVerbs()).toEqual(['take', 'dig'])
  })

  it('falls back to defaults when stored data is corrupt', () => {
    localStorage.setItem('IFB_Verbs', '{not json')
    expect(glue.loadVerbs()).toContain('take')
  })

  it('falls back to defaults when stored data is not an array of strings', () => {
    localStorage.setItem('IFB_Verbs', JSON.stringify([1, 2, 3]))
    expect(glue.loadVerbs()).toContain('take')
  })

  it('survives localStorage throwing (Safari private mode, blocked storage)', () => {
    // Spy on Storage.prototype rather than redefining window.localStorage: the property may live on
    // Window.prototype in jsdom, in which case getOwnPropertyDescriptor returns undefined and
    // restoring it would throw, breaking the whole suite.
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => glue.loadVerbs()).not.toThrow()
    expect(glue.loadVerbs()).toContain('take')
    getSpy.mockRestore()
  })

  it('does not throw when saving is blocked', () => {
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => glue.saveVerbs(['take'])).not.toThrow()
    setSpy.mockRestore()
  })

  it('renders one verb button per stored verb', () => {
    glue.saveVerbs(['take', 'dig'])
    glue.buildBar()
    expect(document.querySelectorAll('#ifb-bar .ifb-verb').length).toBe(2)
  })

  it('adding a verb through the editor re-renders the bar', () => {
    glue.saveVerbs(['take'])
    glue.buildBar()
    glue.addVerbFromUI('dig')
    expect([...document.querySelectorAll('#ifb-bar .ifb-verb')]
      .map(b => (b.textContent ?? '').toLowerCase())).toContain('dig')
  })

  it('removing a verb through the editor re-renders the bar', () => {
    glue.saveVerbs(['take', 'dig'])
    glue.buildBar()
    glue.removeVerbFromUI('take')
    const labels = [...document.querySelectorAll('#ifb-bar .ifb-verb')]
      .map(b => (b.textContent ?? '').toLowerCase())
    expect(labels).not.toContain('take')
    expect(labels).toContain('dig')
  })

  it('a verb button label is set via textContent, never parsed as HTML', () => {
    glue.saveVerbs(['take'])
    glue.buildBar()
    glue.addVerbFromUI('<b>x</b>')
    expect(document.querySelector('#ifb-bar .ifb-verbs b')).toBe(null)
  })

  it('resetting restores the default verb set', () => {
    glue.saveVerbs(['onlythis'])
    glue.resetVerbs()
    expect(glue.loadVerbs()).toContain('take')
  })
})

describe('pressEnter', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  it('presses Return on the field without changing what is in it', () => {
    makeBuffer(['x'], { withInput: true })
    const input = liveInput()
    input.value = 'take lamp'          // half-typed, or left there by the host
    const seen: string[] = []
    input.addEventListener('keypress', e => seen.push(String((e as KeyboardEvent).keyCode)))
    expect(glue.pressEnter()).toBe(true)
    expect(input.value).toBe('take lamp')   // submitted AS IS — never rewritten
    expect(seen).toEqual(['13'])
  })

  it('submits an empty field without throwing', () => {
    makeBuffer(['x'], { withInput: true })
    expect(glue.pressEnter()).toBe(true)
    expect(liveInput().value).toBe('')
  })

  it('advances a char prompt instead, and reports nothing was submitted', () => {
    const bw = makeBuffer(['Press any key.'])
    const seen: number[] = []
    bw.addEventListener('keypress', e => seen.push((e as KeyboardEvent).keyCode))
    expect(glue.pressEnter()).toBe(false)
    expect(seen).toEqual([13])
  })

  it('dismisses a pager instead, and reports nothing was submitted', () => {
    makeBuffer(['x'], { withInput: true, withMore: true })
    expect(glue.pressEnter()).toBe(false)
    expect(liveInput().value).toBe('')
  })

  it('does not disturb an armed verb — it is a keyboard passthrough, not a command', () => {
    const bw = makeBuffer(['a lamp'], { withInput: true })
    glue.decorateBuffer(bw)
    glue.buildBar()
    const take = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-verb')]
      .find(b => /^take$/i.test(b.textContent ?? ''))
    take?.click()
    expect(glue.currentState().pendingVerb).toBe('take')
    glue.pressEnter()
    expect(glue.currentState().pendingVerb).toBe('take')
  })

  it('does not throw when there is no input and no buffer at all', () => {
    expect(() => glue.pressEnter()).not.toThrow()
    expect(glue.pressEnter()).toBe(false)
  })
})

describe('staging and cancelling', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  it('stageCommand writes the text into the field WITHOUT sending it', () => {
    makeBuffer(['x'], { withInput: true })
    const input = liveInput()
    const keys: string[] = []
    input.addEventListener('keypress', e => keys.push(e.type))
    expect(glue.stageCommand('take lamp')).toBe(true)
    expect(input.value).toBe('take lamp')
    expect(keys).toEqual([])            // nothing submitted
  })

  it('stageCommand fires an input event so a host autocomplete can react', () => {
    makeBuffer(['x'], { withInput: true })
    const handler = vi.fn()
    liveInput().addEventListener('input', handler)
    glue.stageCommand('take')
    expect(handler).toHaveBeenCalled()
  })

  it('stageCommand replaces rather than appends', () => {
    makeBuffer(['x'], { withInput: true })
    const input = liveInput()
    input.value = 'residue'
    glue.stageCommand('look')
    expect(input.value).toBe('look')
  })

  it('stageCommand reports failure when there is no input to stage into', () => {
    makeBuffer(['Press any key.'])
    expect(glue.stageCommand('look')).toBe(false)
  })

  it('a verb tap stages the verb and sends nothing', () => {
    makeBuffer(['a lamp'], { withInput: true })
    glue.buildBar()
    const input = liveInput()
    const keys: string[] = []
    input.addEventListener('keypress', e => keys.push(e.type))
    const look = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-verb')]
      .find(b => /^look$/i.test(b.textContent ?? ''))
    look?.click()
    expect(input.value).toBe('look')
    expect(keys).toEqual([])
  })

  it('a verb+noun pair stages the whole command and still sends nothing', () => {
    const bw = makeBuffer(['a lamp'], { withInput: true })
    glue.decorateBuffer(bw)
    glue.buildBar()
    const input = liveInput()
    const keys: string[] = []
    input.addEventListener('keypress', e => keys.push(e.type))
    const take = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-verb')]
      .find(b => /^take$/i.test(b.textContent ?? ''))
    take?.click()
    expect(input.value).toBe('take')
    ;[...bw.querySelectorAll<HTMLElement>('.ifb-word')].find(n => n.textContent === 'lamp')?.click()
    expect(input.value).toBe('take lamp')
    expect(keys).toEqual([])
  })

  it('a direction still sends immediately — movement needs no confirmation', () => {
    makeBuffer(['x'], { withInput: true })
    glue.buildBar()
    const input = liveInput()
    const keys: number[] = []
    input.addEventListener('keypress', e => keys.push((e as KeyboardEvent).keyCode))
    const north = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-move')]
      .find(b => b.textContent === 'N')
    north?.click()
    expect(input.value).toBe('north')
    expect(keys).toEqual([13])
  })

  it('cancelPending clears the armed state AND the staged text', () => {
    const bw = makeBuffer(['a lamp'], { withInput: true })
    glue.decorateBuffer(bw)
    glue.buildBar()
    const take = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-verb')]
      .find(b => /^take$/i.test(b.textContent ?? ''))
    take?.click()
    expect(liveInput().value).toBe('take')
    glue.cancelPending()
    expect(liveInput().value).toBe('')
    expect(glue.currentState().pendingVerb).toBe(null)
    expect(document.querySelectorAll('.ifb-armed').length).toBe(0)
  })

  it('the cancel button clears the staged text', () => {
    makeBuffer(['x'], { withInput: true })
    glue.buildBar()
    const look = [...document.querySelectorAll<HTMLButtonElement>('#ifb-bar .ifb-verb')]
      .find(b => /^look$/i.test(b.textContent ?? ''))
    look?.click()
    expect(liveInput().value).toBe('look')
    document.querySelector<HTMLButtonElement>('#ifb-bar .ifb-cancel')?.click()
    expect(liveInput().value).toBe('')
  })

  it('cancelPending does not throw when there is no input', () => {
    expect(() => glue.cancelPending()).not.toThrow()
  })
})

describe('settings editor', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  it('is closed to begin with', () => {
    glue.buildBar()
    expect(glue.isEditorOpen()).toBe(false)
    expect(document.getElementById('ifb-bar')?.classList.contains('ifb-editing')).toBe(false)
  })

  it('the gear opens it, and it takes the place of the control row', () => {
    glue.buildBar()
    document.querySelector<HTMLButtonElement>('#ifb-bar .ifb-editverbs')?.click()
    expect(glue.isEditorOpen()).toBe(true)
    // A single class on the bar swaps the two; the row is still in the DOM, just not shown.
    expect(document.getElementById('ifb-bar')?.classList.contains('ifb-editing')).toBe(true)
    expect(document.querySelector('#ifb-bar .ifb-row')).not.toBe(null)
  })

  it('is populated before it is shown, so it never flashes empty', () => {
    glue.buildBar()
    glue.openEditor()
    // add field, Add, Defaults, Close, plus one chip per verb
    expect(document.querySelector('#ifb-editor .ifb-newverb')).not.toBe(null)
    expect(document.querySelector('#ifb-editor .ifb-closeeditor')).not.toBe(null)
    expect(document.querySelectorAll('#ifb-editor .ifb-verbchip').length).toBe(glue.loadVerbs().length)
  })

  it('has a Close button that gives the buttons back', () => {
    glue.buildBar()
    glue.openEditor()
    expect(glue.isEditorOpen()).toBe(true)
    document.querySelector<HTMLButtonElement>('#ifb-editor .ifb-closeeditor')?.click()
    expect(glue.isEditorOpen()).toBe(false)
    expect(document.getElementById('ifb-bar')?.classList.contains('ifb-editing')).toBe(false)
  })

  it('the gear toggles rather than only opening', () => {
    glue.buildBar()
    const gear = document.querySelector<HTMLButtonElement>('#ifb-bar .ifb-editverbs')
    gear?.click()
    expect(glue.isEditorOpen()).toBe(true)
    gear?.click()
    expect(glue.isEditorOpen()).toBe(false)
  })

  it('gives the Close button an accessible name', () => {
    glue.buildBar()
    glue.openEditor()
    expect(document.querySelector('#ifb-editor .ifb-closeeditor')?.getAttribute('aria-label'))
      .toBeTruthy()
  })

  it('stays open while verbs are added and removed, and tracks the list', () => {
    glue.saveVerbs(['take'])
    glue.buildBar()
    glue.openEditor()
    glue.addVerbFromUI('dig')
    expect(glue.isEditorOpen()).toBe(true)
    expect(document.querySelectorAll('#ifb-editor .ifb-verbchip').length).toBe(2)
    glue.removeVerbFromUI('take')
    expect(document.querySelectorAll('#ifb-editor .ifb-verbchip').length).toBe(1)
    expect(glue.isEditorOpen()).toBe(true)
  })

  it('does not throw when there is no bar to open it in', () => {
    expect(() => glue.openEditor()).not.toThrow()
    expect(() => glue.closeEditor()).not.toThrow()
    expect(glue.isEditorOpen()).toBe(false)
  })
})

describe('settings: select, move, delete', () => {
  let glue: Glue
  beforeEach(async () => {
    localStorage.clear()
    glue = await loadGlue()
    glue.saveVerbs(['look', 'take', 'dig'])
    glue.buildBar()
    glue.openEditor()
  })

  const chips = () => [...document.querySelectorAll<HTMLButtonElement>('#ifb-editor .ifb-verbchip')]
  const chip = (v: string) =>
    document.querySelector<HTMLButtonElement>('#ifb-editor .ifb-verbchip[data-verb="' + v + '"]')

  it('lists one chip per word, in list order', () => {
    expect(chips().map(c => c.textContent)).toEqual(['look', 'take', 'dig'])
  })

  it('tapping a word SELECTS it instead of deleting it', () => {
    chip('take')?.click()
    expect(glue.selectedVerbName()).toBe('take')
    expect(chip('take')?.classList.contains('ifb-selected')).toBe(true)
    expect(chip('take')?.getAttribute('aria-pressed')).toBe('true')
    // The word is emphatically still there — the old behaviour removed it on this very click.
    expect(glue.loadVerbs()).toEqual(['look', 'take', 'dig'])
  })

  it('tapping the selected word again clears the selection', () => {
    chip('take')?.click()
    chip('take')?.click()
    expect(glue.selectedVerbName()).toBe(null)
    expect(document.querySelectorAll('#ifb-editor .ifb-selected').length).toBe(0)
  })

  it('selecting a different word moves the highlight', () => {
    chip('take')?.click()
    chip('dig')?.click()
    expect(glue.selectedVerbName()).toBe('dig')
    expect(document.querySelectorAll('#ifb-editor .ifb-selected').length).toBe(1)
  })

  it('the move and delete buttons are unusable until something is selected', () => {
    const btn = (c: string) => document.querySelector<HTMLButtonElement>('#ifb-editor .' + c)
    for (const c of ['ifb-moveleft', 'ifb-moveright', 'ifb-deleteverb']) {
      expect(btn(c)?.disabled).toBe(true)
    }
    chip('take')?.click()
    for (const c of ['ifb-moveleft', 'ifb-moveright', 'ifb-deleteverb']) {
      expect(btn(c)?.disabled).toBe(false)
    }
  })

  it('the right button moves the selected word one place later', () => {
    chip('look')?.click()
    document.querySelector<HTMLButtonElement>('#ifb-editor .ifb-moveright')?.click()
    expect(glue.loadVerbs()).toEqual(['take', 'look', 'dig'])
  })

  it('the left button moves the selected word one place earlier', () => {
    chip('dig')?.click()
    document.querySelector<HTMLButtonElement>('#ifb-editor .ifb-moveleft')?.click()
    expect(glue.loadVerbs()).toEqual(['look', 'dig', 'take'])
  })

  it('the word stays selected after a move, so it can be moved again', () => {
    chip('dig')?.click()
    const left = () => document.querySelector<HTMLButtonElement>('#ifb-editor .ifb-moveleft')
    left()?.click()
    expect(glue.selectedVerbName()).toBe('dig')
    left()?.click()
    expect(glue.loadVerbs()).toEqual(['dig', 'look', 'take'])
  })

  it('moving past either end is a no-op, not a crash or a lost word', () => {
    chip('look')?.click()
    document.querySelector<HTMLButtonElement>('#ifb-editor .ifb-moveleft')?.click()
    expect(glue.loadVerbs()).toEqual(['look', 'take', 'dig'])
    chip('dig')?.click()
    document.querySelector<HTMLButtonElement>('#ifb-editor .ifb-moveright')?.click()
    expect(glue.loadVerbs()).toEqual(['look', 'take', 'dig'])
  })

  it('the delete button removes only the selected word, and clears the selection', () => {
    chip('take')?.click()
    document.querySelector<HTMLButtonElement>('#ifb-editor .ifb-deleteverb')?.click()
    expect(glue.loadVerbs()).toEqual(['look', 'dig'])
    expect(glue.selectedVerbName()).toBe(null)
  })

  it('reordering is reflected in the verb strip, not just the editor', () => {
    chip('dig')?.click()
    document.querySelector<HTMLButtonElement>('#ifb-editor .ifb-moveleft')?.click()
    expect([...document.querySelectorAll('#ifb-bar .ifb-verb')].map(b => (b.textContent ?? '').toLowerCase()))
      .toEqual(['look', 'dig', 'take'])
  })

  it('Alt+Arrow on a focused word reorders it without a pointer', () => {
    chip('look')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }))
    expect(glue.loadVerbs()).toEqual(['take', 'look', 'dig'])
  })

  it('a plain Arrow key does not reorder — only Alt does', () => {
    chip('look')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(glue.loadVerbs()).toEqual(['look', 'take', 'dig'])
  })

  it('Delete on a focused word removes it', () => {
    chip('take')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(glue.loadVerbs()).toEqual(['look', 'dig'])
  })

  it('selecting a word that is not in the list is ignored', () => {
    glue.selectVerb('nonesuch')
    expect(glue.selectedVerbName()).toBe(null)
  })

  it('deleting the selected word through the API clears the selection', () => {
    glue.selectVerb('take')
    glue.removeVerbFromUI('take')
    expect(glue.selectedVerbName()).toBe(null)
  })

  it('every chip is a real button, as the bar requires', () => {
    for (const c of chips()) {
      expect(c.tagName).toBe('BUTTON')
      expect(c.getAttribute('type')).toBe('button')
      expect(c.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('moveSelected and deleteSelected do nothing with no selection', () => {
    expect(() => { glue.moveSelected(1); glue.deleteSelected() }).not.toThrow()
    expect(glue.loadVerbs()).toEqual(['look', 'take', 'dig'])
  })
})

describe('actions column', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  it('holds the cancel button, and no separate commands group exists', () => {
    glue.buildBar()
    expect(document.querySelector('#ifb-bar .ifb-actions .ifb-cancel')).not.toBe(null)
    expect(document.querySelector('#ifb-bar .ifb-cmds')).toBe(null)
    expect(document.querySelectorAll('#ifb-bar .ifb-cmd').length).toBe(0)
  })

  it('receives the map toggle when a map host is detected', () => {
    makeBuffer(['x'], { withInput: true })
    const map = document.createElement('div')
    map.id = 'map'
    document.body.appendChild(map)
    glue.boot(1)
    expect(document.querySelector('#ifb-bar .ifb-actions .ifb-maptoggle')).not.toBe(null)
    glue.stopBoot()
  })

  it('is the last group in the row, after the verbs', () => {
    glue.buildBar()
    const groups = [...document.querySelectorAll('#ifb-bar .ifb-group')]
      .map(g => g.className.replace('ifb-group ', ''))
    expect(groups).toEqual(['ifb-moves', 'ifb-verbs', 'ifb-actions'])
  })
})

describe('movement pad composition', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  it('puts ↵ and the settings gear inside the pad, not the verb strip', () => {
    glue.buildBar()
    expect(document.querySelector('#ifb-bar .ifb-moves .ifb-enter')).not.toBe(null)
    expect(document.querySelector('#ifb-bar .ifb-moves .ifb-editverbs')).not.toBe(null)
    // The gear used to live with the verbs and be re-created on every re-render.
    expect(document.querySelector('#ifb-bar .ifb-verbs .ifb-editverbs')).toBe(null)
  })

  it('keeps exactly one settings gear across verb re-renders', () => {
    glue.buildBar()
    glue.addVerbFromUI('dig')
    glue.removeVerbFromUI('dig')
    glue.renderVerbs()
    expect(document.querySelectorAll('#ifb-bar .ifb-editverbs').length).toBe(1)
  })

  it('leaves .ifb-move as the ten directions only', () => {
    glue.buildBar()
    // Enter and the gear share the pad but must not be mistaken for directions.
    expect([...document.querySelectorAll('#ifb-bar .ifb-move')].map(b => b.textContent))
      .toEqual(['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE', 'Up', 'Down'])
  })

  it('the pad is the first group in the bar', () => {
    glue.buildBar()
    const groups = [...document.querySelectorAll('#ifb-bar .ifb-group')]
    expect(groups[0]?.classList.contains('ifb-moves')).toBe(true)
  })

  it('gives ↵ an accessible name', () => {
    glue.buildBar()
    expect(document.querySelector('#ifb-bar .ifb-enter')?.getAttribute('aria-label')).toBeTruthy()
  })
})

describe('bar height reservation', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })

  // The real assertion — that no story text ever ends up underneath the bar — needs layout, so it
  // lives in the end-to-end suite. jsdom reports every box as zero-sized, so what matters here is
  // that measuring degrades quietly instead of writing a nonsense reservation.
  it('does nothing and does not throw when there is no bar', () => {
    expect(() => glue.measureBar()).not.toThrow()
    expect(glue.measureBar()).toBe(0)
    expect(document.documentElement.style.getPropertyValue('--ifb-bar-height')).toBe('')
  })

  it('does not write a zero reservation when the engine reports no layout', () => {
    // A 0px reservation would be worse than the stylesheet fallback: the bar would cover the text.
    glue.buildBar()
    expect(glue.measureBar()).toBe(0)
    expect(document.documentElement.style.getPropertyValue('--ifb-bar-height')).toBe('')
  })

  it('reserves the measured height when the engine does report layout', () => {
    glue.buildBar()
    const bar = document.getElementById('ifb-bar')
    if (!bar) { throw new Error('test setup: no bar') }
    bar.getBoundingClientRect = () => ({ height: 231, width: 800, top: 0, left: 0, right: 800,
      bottom: 231, x: 0, y: 0, toJSON: () => ({}) })
    expect(glue.measureBar()).toBe(231)
    expect(document.documentElement.style.getPropertyValue('--ifb-bar-height')).toBe('231px')
  })

  it('keeps a reader pinned to the newest line when the reservation grows', () => {
    const bw = makeBuffer(['x'], { withInput: true })
    glue.buildBar()
    const bar = document.getElementById('ifb-bar')
    if (!bar) { throw new Error('test setup: no bar') }
    // jsdom does no layout, so stand in for a buffer scrolled to its end.
    Object.defineProperty(bw, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(bw, 'clientHeight', { value: 400, configurable: true })
    bw.scrollTop = 600
    bar.getBoundingClientRect = () => ({ height: 300, width: 800, top: 0, left: 0, right: 800,
      bottom: 300, x: 0, y: 0, toJSON: () => ({}) })
    glue.measureBar()
    expect(bw.scrollTop).toBe(1000)
  })

  it('leaves the scroll position alone when the reader has scrolled back', () => {
    const bw = makeBuffer(['x'], { withInput: true })
    glue.buildBar()
    const bar = document.getElementById('ifb-bar')
    if (!bar) { throw new Error('test setup: no bar') }
    Object.defineProperty(bw, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(bw, 'clientHeight', { value: 400, configurable: true })
    bw.scrollTop = 100                       // reading back through earlier output
    bar.getBoundingClientRect = () => ({ height: 300, width: 800, top: 0, left: 0, right: 800,
      bottom: 300, x: 0, y: 0, toJSON: () => ({}) })
    glue.measureBar()
    expect(bw.scrollTop).toBe(100)
  })
})

describe('host independence', () => {
  let glue: Glue
  beforeEach(async () => { glue = await loadGlue() })
  // These tests call boot() explicitly. When boot fails to find a .BufferWindow it schedules a retry,
  // and that timer would otherwise fire during a LATER test and build a bar there — so cancel it.
  afterEach(() => { glue.stopBoot() })

  it('boots against a bare GlkOte DOM with no host scripts present', () => {
    makeBuffer(['West of House.'], { withInput: true })
    expect(() => glue.boot(1)).not.toThrow()
    expect(document.getElementById('ifb-bar')).not.toBe(null)
  })

  it('does not add the host-map class when no map element exists', () => {
    makeBuffer(['x'], { withInput: true })
    glue.boot(1)
    expect(document.documentElement.classList.contains('ifb-host-map')).toBe(false)
  })

  it('adds the host-map class and a map toggle when a map element exists', () => {
    makeBuffer(['x'], { withInput: true })
    const map = document.createElement('div')
    map.id = 'map'
    document.body.appendChild(map)
    glue.boot(1)
    expect(document.documentElement.classList.contains('ifb-host-map')).toBe(true)
    expect(document.querySelector('#ifb-bar .ifb-maptoggle')).not.toBe(null)
  })

  it('the map toggle hides and restores the map element, and reports its state', () => {
    makeBuffer(['x'], { withInput: true })
    const map = document.createElement('div')
    map.id = 'map'
    document.body.appendChild(map)
    glue.boot(1)
    const toggle = document.querySelector<HTMLButtonElement>('#ifb-bar .ifb-maptoggle')
    expect(toggle?.getAttribute('aria-label')).toBeTruthy()
    toggle?.click()
    expect(map.style.display).toBe('none')
    expect(toggle?.getAttribute('aria-pressed')).toBe('true')
    toggle?.click()
    expect(map.style.display).toBe('')
    expect(toggle?.getAttribute('aria-pressed')).toBe('false')
  })

  it('does nothing harmful when there is no BufferWindow at all', () => {
    expect(() => glue.boot(1)).not.toThrow()
    expect(document.getElementById('ifb-bar')).toBe(null)
  })
})
