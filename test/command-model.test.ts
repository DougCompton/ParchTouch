import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeWord, tokenize, createState, tapVerb, tapWord, tapDirect, clearPending,
  normalizeVerb, addVerb, removeVerb, moveVerb,
  appendToken, dropLastToken, commandText,
  sanitizeLayouts, emptyLayouts, layoutNames, activeWords, setActiveWords,
  switchLayout, createLayout, renameLayout, deleteLayout,
  normalizeLayoutName, MAX_LAYOUTS, MAX_LAYOUT_NAME, DEFAULT_LAYOUT,
  MAX_COMMAND_LENGTH, MAX_VERBS, DEFAULT_VERBS,
  type CommandState,
} from '../src/command-model'

describe('normalizeWord', () => {
  it('lowercases a plain word', () => {
    expect(normalizeWord('Lamp')).toBe('lamp')
  })

  it('strips trailing and surrounding punctuation', () => {
    expect(normalizeWord('lamp.')).toBe('lamp')
    expect(normalizeWord('lamp,')).toBe('lamp')
    expect(normalizeWord('lamp!')).toBe('lamp')
    expect(normalizeWord('"lamp"')).toBe('lamp')
  })

  it('strips a possessive apostrophe-s', () => {
    expect(normalizeWord("troll's")).toBe('troll')
  })

  it('keeps an internal hyphen', () => {
    expect(normalizeWord('jewel-encrusted')).toBe('jewel-encrusted')
  })

  it('returns empty string for empty, whitespace-only, null or undefined input', () => {
    expect(normalizeWord('')).toBe('')
    expect(normalizeWord('   ')).toBe('')
    expect(normalizeWord(null)).toBe('')
    expect(normalizeWord(undefined)).toBe('')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeWord('  lamp  ')).toBe('lamp')
  })

  it('returns empty string for punctuation-only input', () => {
    expect(normalizeWord('---')).toBe('')
    expect(normalizeWord('...')).toBe('')
  })

  it('coerces a number to its string form', () => {
    expect(normalizeWord(42)).toBe('42')
  })

  it('preserves accented letters', () => {
    expect(normalizeWord('Café')).toBe('café')
  })

  it('returns empty string for an emoji-only token', () => {
    expect(normalizeWord('🎉')).toBe('')
  })
})

describe('tokenize', () => {
  it('splits a sentence into word and non-word tokens', () => {
    const tokens = tokenize('You see a lamp.')
    expect(tokens.filter(t => t.isWord).map(t => t.text)).toEqual(['You', 'see', 'a', 'lamp'])
  })

  it('round-trips to the original string', () => {
    const text = 'West of House. You are standing here!'
    expect(tokenize(text).map(t => t.text).join('')).toBe(text)
  })

  it('marks punctuation and spaces as non-words', () => {
    const tokens = tokenize('a, b')
    expect(tokens.find(t => t.text === ', ')?.isWord).toBe(false)
  })

  it('treats a hyphenated word as one token', () => {
    expect(tokenize('a jewel-encrusted egg').filter(t => t.isWord).map(t => t.text))
      .toContain('jewel-encrusted')
  })

  it('returns an empty array for empty, null or undefined input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize(null)).toEqual([])
    expect(tokenize(undefined)).toEqual([])
  })

  it('returns a single non-word token for whitespace only', () => {
    const tokens = tokenize('   ')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.isWord).toBe(false)
  })

  it('marks a digits-only string as non-word', () => {
    expect(tokenize('1234').every(t => !t.isWord)).toBe(true)
  })

  it('tokenizes accented words', () => {
    expect(tokenize('the café').filter(t => t.isWord).map(t => t.text)).toEqual(['the', 'café'])
  })

  it('handles a very large paragraph without error', () => {
    const text = ('the lamp is here. ').repeat(2000)
    expect(tokenize(text).filter(t => t.isWord).length).toBe(8000)
  })
})

describe('command state machine', () => {
  let state: CommandState
  beforeEach(() => { state = createState() })

  it('tapDirect emits the command immediately', () => {
    expect(tapDirect(state, 'north').command).toBe('north')
  })

  it('tapDirect clears any armed verb', () => {
    const r = tapDirect(tapVerb(state, 'take').state, 'look')
    expect(r.command).toBe('look')
    expect(r.state.pendingVerb).toBe(null)
  })

  it('verb then word emits "<verb> <noun>"', () => {
    const a = tapVerb(state, 'take')
    expect(a.command).toBe(null)
    expect(a.state.pendingVerb).toBe('take')
    expect(tapWord(a.state, 'lamp').command).toBe('take lamp')
  })

  it('clears pending state after emitting a paired command', () => {
    const b = tapWord(tapVerb(state, 'take').state, 'lamp')
    expect(b.state.pendingVerb).toBe(null)
    expect(b.state.pendingNoun).toBe(null)
  })

  it('word then verb emits "<verb> <noun>"', () => {
    const a = tapWord(state, 'lamp')
    expect(a.command).toBe(null)
    expect(a.state.pendingNoun).toBe('lamp')
    expect(tapVerb(a.state, 'examine').command).toBe('examine lamp')
  })

  it('tapping a second verb replaces the first', () => {
    const b = tapVerb(tapVerb(state, 'take').state, 'drop')
    expect(b.command).toBe(null)
    expect(b.state.pendingVerb).toBe('drop')
  })

  it('tapping a second word replaces the first', () => {
    const b = tapWord(tapWord(state, 'lamp').state, 'sword')
    expect(b.command).toBe(null)
    expect(b.state.pendingNoun).toBe('sword')
  })

  it('supports a multi-word verb', () => {
    expect(tapWord(tapVerb(state, 'turn on').state, 'lamp').command).toBe('turn on lamp')
  })

  it('normalizes the tapped word before pairing', () => {
    expect(tapWord(tapVerb(state, 'take').state, 'Lamp.').command).toBe('take lamp')
  })

  it('ignores a word that normalizes to empty', () => {
    const r = tapWord(state, '...')
    expect(r.command).toBe(null)
    expect(r.state.pendingNoun).toBe(null)
  })

  it('ignores an empty or null verb', () => {
    expect(tapVerb(state, '').state.pendingVerb).toBe(null)
    expect(tapVerb(state, null).state.pendingVerb).toBe(null)
  })

  it('ignores an empty or whitespace-only direct command', () => {
    expect(tapDirect(state, '').command).toBe(null)
    expect(tapDirect(state, '   ').command).toBe(null)
  })

  it('clearPending resets both slots', () => {
    expect(clearPending(tapVerb(state, 'take').state).pendingVerb).toBe(null)
  })

  it('clearPending on fresh state is a no-op', () => {
    expect(clearPending(createState())).toEqual(createState())
  })

  it('does not mutate the state passed in', () => {
    const original = createState()
    tapVerb(original, 'take')
    expect(original.pendingVerb).toBe(null)
  })

  it('emits a command at exactly the maximum length', () => {
    const noun = 'a'.repeat(MAX_COMMAND_LENGTH - 'take '.length)
    expect(tapWord(tapVerb(createState(), 'take').state, noun).command)
      .toHaveLength(MAX_COMMAND_LENGTH)
  })

  it('rejects a command one character over the maximum length', () => {
    const noun = 'a'.repeat(MAX_COMMAND_LENGTH)
    expect(tapWord(tapVerb(createState(), 'take').state, noun).command).toBe(null)
  })

  it('does not treat a tapped word as markup', () => {
    const r = tapWord(tapVerb(createState(), 'take').state, '<script>alert(1)</script>')
    expect(r.command === null || !r.command.includes('<script>')).toBe(true)
  })

  it('strips a newline from a tapped word so one tap cannot send two commands', () => {
    expect(tapWord(tapVerb(createState(), 'take').state, 'lamp\nnorth').command)
      .not.toContain('\n')
  })

  it('pairs an accented noun', () => {
    expect(tapWord(tapVerb(createState(), 'examine').state, 'Café').command).toBe('examine café')
  })
})

describe('host commands beginning with a slash', () => {
  // Some hosts reserve /name for their own features (notes, goto, route-finding). Stripping the slash
  // silently turned /note into note, which the game then rejected as an unknown verb.
  it('keeps a leading slash on a verb', () => {
    expect(normalizeVerb('/note')).toBe('/note')
    expect(normalizeVerb('/goto')).toBe('/goto')
    expect(normalizeVerb('/room-notes')).toBe('/room-notes')
  })

  it('still normalizes everything after the slash', () => {
    expect(normalizeVerb('  /NOTE!!  ')).toBe('/note')
    expect(normalizeVerb('/see   me')).toBe('/see me')
    expect(normalizeVerb('/note\nx')).toBe('/note x')
  })

  it('keeps only one slash, and only at the front', () => {
    expect(normalizeVerb('//note')).toBe('/note')
    expect(normalizeVerb('no/te')).toBe('note')       // an inner slash is still punctuation
  })

  it('a bare slash is still nothing', () => {
    expect(normalizeVerb('/')).toBe('')
    expect(normalizeVerb('///')).toBe('')
    expect(normalizeVerb('/!!')).toBe('')
  })

  it('a slash command can be added to the list and removed again', () => {
    expect(addVerb(['take'], '/note')).toEqual(['take', '/note'])
    expect(removeVerb(['take', '/note'], '/note')).toEqual(['take'])
    expect(addVerb(['/note'], '/NOTE')).toEqual(['/note'])   // still de-duplicated
  })

  it('a slash command can be reordered like any other word', () => {
    expect(moveVerb(['take', '/note'], '/note', 0)).toEqual(['/note', 'take'])
  })

  it('a slash command pairs with a tapped noun', () => {
    expect(tapWord(tapVerb(createState(), '/goto').state, 'Kitchen').command).toBe('/goto kitchen')
  })

  it('a TAPPED WORD can never acquire a leading slash', () => {
    // Story text must not be able to address a host command.
    expect(normalizeWord('/note')).toBe('note')
    expect(normalizeWord('/')).toBe('')
  })

  it('a slash command still obeys the length and count limits', () => {
    expect(addVerb([], '/' + 'a'.repeat(200))).toEqual([])
    expect(normalizeVerb('/' + 'a'.repeat(5))).toBe('/aaaaa')
  })
})

describe('building a command word by word', () => {
  it('appends words in tap order', () => {
    let w: string[] = []
    for (const t of ['unlock', 'door', 'with', 'key']) { w = appendToken(w, t) }
    expect(commandText(w)).toBe('unlock door with key')
  })

  it('keeps a multi-word entry as one token', () => {
    expect(commandText(appendToken(appendToken([], 'turn on'), 'lamp'))).toBe('turn on lamp')
  })

  it('ignores an empty, whitespace-only, null or undefined word', () => {
    for (const junk of ['', '   ', null, undefined]) {
      expect(appendToken(['take'], junk)).toEqual(['take'])
    }
  })

  it('collapses inner whitespace in a word', () => {
    expect(appendToken([], '  turn   on ')).toEqual(['turn on'])
  })

  it('refuses a word that would exceed the command length limit', () => {
    const long = 'a'.repeat(MAX_COMMAND_LENGTH - 5)
    const w = appendToken(['take'], long)
    expect(commandText(w).length).toBeLessThanOrEqual(MAX_COMMAND_LENGTH)
    // and refusing leaves the command untouched rather than truncating it
    expect(appendToken(w, 'more')).toEqual(w)
  })

  it('accepts a command exactly at the limit', () => {
    const w = appendToken(['take'], 'a'.repeat(MAX_COMMAND_LENGTH - 'take '.length))
    expect(commandText(w)).toHaveLength(MAX_COMMAND_LENGTH)
  })

  it('dropLastToken removes only the last word', () => {
    expect(dropLastToken(['unlock', 'door', 'with'])).toEqual(['unlock', 'door'])
  })

  it('dropLastToken on an empty command is a no-op', () => {
    expect(dropLastToken([])).toEqual([])
  })

  it('commandText of nothing is the empty string', () => {
    expect(commandText([])).toBe('')
  })

  it('neither mutates the list passed in', () => {
    const original = ['take', 'lamp']
    appendToken(original, 'now')
    dropLastToken(original)
    expect(original).toEqual(['take', 'lamp'])
  })
})

describe('named layouts', () => {
  const store = (active: string, sets: Record<string, string[]>) => ({ active, sets })

  describe('normalizeLayoutName', () => {
    it('trims and collapses whitespace', () => {
      expect(normalizeLayoutName('  My   Zork  ')).toBe('My Zork')
    })

    it('keeps letters, digits, spaces and hyphens', () => {
      expect(normalizeLayoutName('Zork-2 modern')).toBe('Zork-2 modern')
    })

    it('drops anything that could be markup', () => {
      expect(normalizeLayoutName('<b>x</b>')).toBe('bxb')
      expect(normalizeLayoutName('a"b\'c')).toBe('abc')
    })

    it('bounds the length', () => {
      expect(normalizeLayoutName('n'.repeat(200))).toHaveLength(MAX_LAYOUT_NAME)
    })

    it('returns empty for nothing usable', () => {
      for (const v of ['', '   ', '!!!', '---', null, undefined]) {
        expect(normalizeLayoutName(v)).toBe('')
      }
    })
  })

  describe('sanitizeLayouts', () => {
    it('accepts a well-formed store', () => {
      const s = sanitizeLayouts({ active: 'B', sets: { A: ['take'], B: ['look'] } })
      expect(layoutNames(s)).toEqual(['A', 'B'])
      expect(s.active).toBe('B')
    })

    it('MIGRATES the original bare-array format into the default layout', () => {
      // A list saved before layouts existed must not be lost.
      const s = sanitizeLayouts(['take', 'dig'])
      expect(s.active).toBe(DEFAULT_LAYOUT)
      expect(activeWords(s)).toEqual(['take', 'dig'])
    })

    it('falls back to the shipped defaults for junk of every shape', () => {
      for (const junk of [null, undefined, 42, 'nope', [], [1, 2, 3], {}, { sets: null },
        { sets: [] }, { sets: { A: 'not an array' } }]) {
        const s = sanitizeLayouts(junk)
        expect(layoutNames(s)).toEqual([DEFAULT_LAYOUT])
        expect(activeWords(s).length).toBeGreaterThan(4)
      }
    })

    it('drops unusable layout names and non-string words', () => {
      const s = sanitizeLayouts({ active: 'A', sets: { A: ['take', 7, null, 'dig'], '!!!': ['x'] } })
      expect(layoutNames(s)).toEqual(['A'])
      expect(activeWords(s)).toEqual(['take', 'dig'])
    })

    it('normalizes the words it keeps', () => {
      expect(activeWords(sanitizeLayouts({ active: 'A', sets: { A: ['  TAKE ', '/Note!'] } })))
        .toEqual(['take', '/note'])
    })

    it('repairs an active name that does not exist', () => {
      const s = sanitizeLayouts({ active: 'missing', sets: { A: ['take'] } })
      expect(s.active).toBe('A')
    })

    it('caps how many layouts it will accept', () => {
      const sets: Record<string, string[]> = {}
      for (let i = 0; i < MAX_LAYOUTS + 5; i++) { sets['L' + i] = ['take'] }
      expect(layoutNames(sanitizeLayouts({ active: 'L0', sets })).length).toBe(MAX_LAYOUTS)
    })

    it('an empty word list is a valid layout, not junk', () => {
      const s = sanitizeLayouts({ active: 'A', sets: { A: [] } })
      expect(layoutNames(s)).toEqual(['A'])
      expect(activeWords(s)).toEqual([])
    })
  })

  describe('changing layouts', () => {
    it('createLayout adds it, switches to it, and starts from the defaults', () => {
      const s = createLayout(emptyLayouts(), 'Zork')
      expect(s.active).toBe('Zork')
      expect(layoutNames(s)).toEqual([DEFAULT_LAYOUT, 'Zork'])
      expect(activeWords(s)).toContain('take')      // a copy of the shipped words, never empty
    })

    it('createLayout refuses a duplicate, an unusable name, or one too many', () => {
      const one = createLayout(emptyLayouts(), 'Zork')
      expect(layoutNames(createLayout(one, 'Zork'))).toEqual([DEFAULT_LAYOUT, 'Zork'])
      expect(layoutNames(createLayout(one, '  '))).toEqual([DEFAULT_LAYOUT, 'Zork'])
      let full = emptyLayouts()
      for (let i = 0; i < MAX_LAYOUTS + 3; i++) { full = createLayout(full, 'L' + i) }
      expect(layoutNames(full).length).toBe(MAX_LAYOUTS)
    })

    it('switchLayout changes the active one, and ignores an unknown name', () => {
      const s = createLayout(emptyLayouts(), 'Zork')
      expect(switchLayout(s, DEFAULT_LAYOUT).active).toBe(DEFAULT_LAYOUT)
      expect(switchLayout(s, 'nope').active).toBe('Zork')
    })

    it('setActiveWords only touches the layout in use', () => {
      const s = setActiveWords(createLayout(store('A', { A: ['take'], B: ['look'] }), 'C'), ['dig'])
      expect(s.sets['C']).toEqual(['dig'])
      expect(s.sets['A']).toEqual(['take'])
      expect(s.sets['B']).toEqual(['look'])
    })

    it('renameLayout keeps the words and follows the active name', () => {
      const s = renameLayout(store('A', { A: ['take'], B: ['look'] }), 'A', 'Zork')
      expect(layoutNames(s)).toEqual(['Zork', 'B'])      // position preserved
      expect(s.sets['Zork']).toEqual(['take'])
      expect(s.active).toBe('Zork')
    })

    it('renameLayout never merges two layouts', () => {
      const s = store('A', { A: ['take'], B: ['look'] })
      expect(renameLayout(s, 'A', 'B')).toBe(s)
      expect(renameLayout(s, 'A', 'A')).toBe(s)
      expect(renameLayout(s, 'missing', 'X')).toBe(s)
    })

    it('deleteLayout removes it and picks a survivor as active', () => {
      const s = deleteLayout(store('A', { A: ['take'], B: ['look'] }), 'A')
      expect(layoutNames(s)).toEqual(['B'])
      expect(s.active).toBe('B')
    })

    it('deleteLayout never removes the last one', () => {
      const s = store('A', { A: ['take'] })
      expect(deleteLayout(s, 'A')).toBe(s)
    })

    it('none of these mutate the store passed in', () => {
      const original = store('A', { A: ['take'], B: ['look'] })
      const snapshot = JSON.stringify(original)
      createLayout(original, 'C')
      renameLayout(original, 'A', 'Z')
      deleteLayout(original, 'B')
      switchLayout(original, 'B')
      setActiveWords(original, ['dig'])
      expect(JSON.stringify(original)).toBe(snapshot)
    })
  })
})

describe('moveVerb', () => {
  it('moves a verb one place later', () => {
    expect(moveVerb(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
  })

  it('moves a verb one place earlier', () => {
    expect(moveVerb(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'c', 'b'])
  })

  it('moves a verb to the front and to the back', () => {
    expect(moveVerb(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(moveVerb(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
  })

  it('clamps an index past either end instead of losing the verb', () => {
    expect(moveVerb(['a', 'b', 'c'], 'b', -5)).toEqual(['b', 'a', 'c'])
    expect(moveVerb(['a', 'b', 'c'], 'b', 99)).toEqual(['a', 'c', 'b'])
  })

  it('moving to the position it already holds changes nothing', () => {
    expect(moveVerb(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
  })

  it('normalizes the verb before looking for it', () => {
    expect(moveVerb(['turn on', 'b'], '  TURN   ON ', 1)).toEqual(['b', 'turn on'])
  })

  it('a verb that is not in the list is a no-op', () => {
    expect(moveVerb(['a', 'b'], 'zzz', 0)).toEqual(['a', 'b'])
  })

  it('handles an empty list and a single-item list', () => {
    expect(moveVerb([], 'a', 0)).toEqual([])
    expect(moveVerb(['a'], 'a', 5)).toEqual(['a'])
  })

  it('ignores a non-finite index', () => {
    expect(moveVerb(['a', 'b'], 'a', Number.NaN)).toEqual(['a', 'b'])
    expect(moveVerb(['a', 'b'], 'a', Number.POSITIVE_INFINITY)).toEqual(['a', 'b'])
  })

  it('truncates a fractional index rather than throwing', () => {
    expect(moveVerb(['a', 'b', 'c'], 'a', 1.9)).toEqual(['b', 'a', 'c'])
  })

  it('does not mutate the list passed in', () => {
    const original = ['a', 'b', 'c']
    moveVerb(original, 'a', 2)
    expect(original).toEqual(['a', 'b', 'c'])
  })

  it('ignores null and undefined verbs', () => {
    expect(moveVerb(['a', 'b'], null, 0)).toEqual(['a', 'b'])
    expect(moveVerb(['a', 'b'], undefined, 0)).toEqual(['a', 'b'])
  })
})

describe('verb list', () => {
  it('ships a non-empty default set including the core verbs', () => {
    expect(DEFAULT_VERBS).toContain('examine')
    expect(DEFAULT_VERBS).toContain('take')
    expect(DEFAULT_VERBS.length).toBeGreaterThan(4)
  })

  it('adds a verb to the end of the list', () => {
    expect(addVerb(['take'], 'dig')).toEqual(['take', 'dig'])
  })

  it('removes a verb', () => {
    expect(removeVerb(['take', 'dig'], 'take')).toEqual(['dig'])
  })

  it('normalizes a verb to lowercase and collapses inner whitespace', () => {
    expect(normalizeVerb('  Turn   ON ')).toBe('turn on')
  })

  it('strips punctuation from a verb', () => {
    expect(normalizeVerb('take!')).toBe('take')
  })

  it('does not add a duplicate verb, case-insensitively', () => {
    expect(addVerb(['take'], 'take')).toEqual(['take'])
    expect(addVerb(['take'], 'TAKE')).toEqual(['take'])
  })

  it('ignores adding an empty, whitespace-only or null verb', () => {
    expect(addVerb(['take'], '')).toEqual(['take'])
    expect(addVerb(['take'], '   ')).toEqual(['take'])
    expect(addVerb(['take'], null)).toEqual(['take'])
  })

  it('removing a verb that is not present is a no-op', () => {
    expect(removeVerb(['take'], 'dig')).toEqual(['take'])
  })

  it('allows removing every verb (empty list is valid)', () => {
    expect(removeVerb(['take'], 'take')).toEqual([])
  })

  it('accepts a verb at exactly the maximum count', () => {
    const list = Array.from({ length: MAX_VERBS - 1 }, (_, i) => 'v' + i)
    expect(addVerb(list, 'last')).toHaveLength(MAX_VERBS)
  })

  it('refuses a verb beyond the maximum count', () => {
    const list = Array.from({ length: MAX_VERBS }, (_, i) => 'v' + i)
    expect(addVerb(list, 'toomany')).toHaveLength(MAX_VERBS)
  })

  it('refuses an absurdly long verb', () => {
    expect(addVerb([], 'a'.repeat(200))).toEqual([])
  })

  it('never stores markup in a verb', () => {
    expect(addVerb([], '<script>alert(1)</script>').join('')).not.toContain('<')
  })

  it('strips newlines from a verb', () => {
    expect(normalizeVerb('take\nnorth')).toBe('take north')
  })

  it('does not mutate the list passed in', () => {
    const original = ['take']
    addVerb(original, 'dig')
    expect(original).toEqual(['take'])
  })

  it('accepts an accented verb', () => {
    expect(addVerb([], 'ouvrir')).toEqual(['ouvrir'])
    expect(normalizeVerb('Écouter')).toBe('écouter')
  })
})
