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
