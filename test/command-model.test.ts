import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeWord, tokenize, createState, tapVerb, tapWord, tapDirect, clearPending,
  normalizeVerb, addVerb, removeVerb, moveVerb,
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
