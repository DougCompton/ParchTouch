/*
 * docker-library.test.ts — the deployment image's story library.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 *
 * Covers `docker/prepare.mjs` and `docker/library.mjs`, which is where a real reported bug lived: a
 * story added to the mounted share played fine in Parchment and 404'd in Parchmap, because wrapping
 * ran ONCE at container start while the picker listed the volume live. The first describe below is that
 * bug, written as the failing case it was.
 *
 * These modules read their paths from the environment at IMPORT time, so every test imports them fresh
 * against a temporary directory (`vi.resetModules()` + a dynamic import). No container is involved and
 * nothing here touches a real /stories.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LibraryEntry } from '../docker/prepare.d.mts'

let dir: string
let stories: string
let root: string
let games: string

/** A raw Z-machine story: the first byte is its version, which is how it is recognised. */
function zcode(version = 5, size = 512): Buffer {
  const b = Buffer.alloc(size)
  b[0] = version
  b.write('ZORK', 100)
  return b
}

/** A raw Glulx story: magic 'Glul' at offset 0. */
function glulx(size = 512): Buffer {
  const b = Buffer.alloc(size)
  b.write('Glul', 0, 'latin1')
  return b
}

/**
 * A Blorb container: FORM <len> IFRS, then chunks of { id, u32 length, even-padded data }.
 * `exec` is the id of the executable chunk — 'ZCOD' for a Z-machine game, 'GLUL' for a Glulx one.
 * This is the case an extension cannot decide: .blb and .blorb are used for both.
 */
function blorb(exec: 'ZCOD' | 'GLUL'): Buffer {
  const ridx = Buffer.alloc(8 + 4)                 // a minimal, empty resource index
  ridx.write('RIdx', 0, 'latin1')
  ridx.writeUInt32BE(4, 4)
  const game = Buffer.alloc(8 + 64)
  game.write(exec, 0, 'latin1')
  game.writeUInt32BE(64, 4)
  const body = Buffer.concat([Buffer.from('IFRS', 'latin1'), ridx, game])
  const out = Buffer.alloc(8 + body.length)
  out.write('FORM', 0, 'latin1')
  out.writeUInt32BE(body.length, 4)
  body.copy(out, 8)
  return out
}

/** The library entry for one story, failing loudly rather than asserting against `undefined`. */
function entryFor(lib: readonly LibraryEntry[], name: string): LibraryEntry {
  const found = lib.find(s => s.name === name)
  if (!found) { throw new Error(name + ' is not in the scanned library: ' + lib.map(s => s.name).join(', ')) }
  return found
}

/** Import prepare.mjs bound to this test's temporary tree. */
async function loadPrepare() {
  vi.resetModules()
  process.env['PARCHTOUCH_STORIES'] = stories
  process.env['PARCHTOUCH_ROOT'] = root
  process.env['PARCHTOUCH_SEED'] = join(dir, 'no-seed')
  return await import('../docker/prepare.mjs')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'parch-touch-lib-'))
  stories = join(dir, 'stories')
  root = join(dir, 'root')
  games = join(root, 'parchmap', 'games')
  mkdirSync(stories, { recursive: true })
  mkdirSync(join(root, 'parchmap', 'js'), { recursive: true })
  // The pristine list the menu is rebuilt from, in the shape Parchmap ships.
  writeFileSync(join(root, 'parchmap', 'js', 'GameList.bundled.js'),
    'var GameList = [\n    {\n        Title: "Moonglow",\n        Filename: "moonglow.z3.js"\n    }\n];\n')
})

afterEach(() => {
  delete process.env['PARCHTOUCH_STORIES']
  delete process.env['PARCHTOUCH_ROOT']
  delete process.env['PARCHTOUCH_SEED']
  rmSync(dir, { recursive: true, force: true })
})

describe('a story added to the share AFTER the container started', () => {
  it('is playable in Parchmap, not only in Parchment', async () => {
    // THE REPORTED BUG. The startup pass sees only `before`; the picker then lists `after` live from
    // nginx's directory index, so its Parchment link works and its Parchmap link must too.
    writeFileSync(join(stories, 'before.z5'), zcode())
    const prep = await loadPrepare()
    prep.prepare()
    expect(existsSync(join(games, 'before.z5.js'))).toBe(true)

    writeFileSync(join(stories, 'after.z5'), zcode())
    expect(existsSync(join(games, 'after.z5.js'))).toBe(false)   // nothing has wrapped it yet

    // Anything that reads the library brings it into step — this is what the picker requests.
    const { stories: listed, wrapped } = prep.refresh()
    expect(listed.map(s => s.name)).toEqual(['after.z5', 'before.z5'])
    expect(wrapped).toContain('after.z5')
    expect(existsSync(join(games, 'after.z5.js'))).toBe(true)
  })

  it('appears in Parchmap OWN menu too, not just in the picker', async () => {
    const prep = await loadPrepare()
    prep.prepare()
    writeFileSync(join(stories, 'late.z5'), zcode())
    prep.refresh()
    const menu = readFileSync(join(root, 'parchmap', 'js', 'GameList.js'), 'utf8')
    expect(menu).toContain('"Filename": "late.z5.js"')
    expect(menu).toContain('Filename: "moonglow.z3.js"')     // the bundled list is kept, not replaced
  })

  it('is wrapped on demand by a direct request for the wrapped copy', async () => {
    // Parchmap's own menu links straight at games/<name>.js, bypassing the picker entirely.
    const prep = await loadPrepare()
    writeFileSync(join(stories, 'direct.z5'), zcode())
    const target = prep.ensureWrapped('direct.z5')
    expect(target).toBe(join(games, 'direct.z5.js'))
    expect(readFileSync(target as string, 'utf8')).toMatch(/^processBase64Zcode\('[A-Za-z0-9+/=]+'\);$/)
  })
})

describe('the story baked into the image', () => {
  /** Point the seed at a real file, as the Dockerfile does when it decodes Adventure. */
  function withSeed(): string {
    const seed = join(dir, 'seed')
    mkdirSync(seed, { recursive: true })
    writeFileSync(join(seed, 'advent.z5'), zcode(5, 900))
    return seed
  }

  async function loadWithSeed() {
    vi.resetModules()
    process.env['PARCHTOUCH_STORIES'] = stories
    process.env['PARCHTOUCH_ROOT'] = root
    process.env['PARCHTOUCH_SEED'] = withSeed()
    return await import('../docker/prepare.mjs')
  }

  it('is still copied into an empty library, and playable in BOTH players', async () => {
    const prep = await loadWithSeed()
    const { stories: listed } = prep.prepare()
    expect(listed.map(s => s.name)).toEqual(['advent.z5'])
    expect(existsSync(join(stories, 'advent.z5'))).toBe(true)          // Parchment serves this
    expect(existsSync(join(games, 'advent.z5.js'))).toBe(true)         // Parchmap loads this
  })

  it('is NOT re-seeded by a later library read, so deleting it sticks', async () => {
    // Only the startup pass seeds. If every request did, a user who cleared their share would find
    // Adventure back the moment they reloaded the picker.
    const prep = await loadWithSeed()
    prep.prepare()
    rmSync(join(stories, 'advent.z5'))
    expect(prep.refresh().stories).toEqual([])
  })

  it('leaves a library that already has stories alone', async () => {
    writeFileSync(join(stories, 'mine.z5'), zcode())
    const prep = await loadWithSeed()
    expect(prep.prepare().stories.map(s => s.name)).toEqual(['mine.z5'])
    expect(existsSync(join(stories, 'advent.z5'))).toBe(false)
  })
})

describe('which player a story is offered to', () => {
  it('is read from the file, not its extension', async () => {
    const prep = await loadPrepare()
    expect(prep.storyKind(zcode(3))).toBe('zcode')
    expect(prep.storyKind(zcode(8))).toBe('zcode')
    expect(prep.storyKind(blorb('ZCOD'))).toBe('zcode')
    expect(prep.storyKind(glulx())).toBe('other')
    expect(prep.storyKind(blorb('GLUL'))).toBe('other')
    expect(prep.storyKind(Buffer.from('TADS2 bin\n', 'latin1'))).toBe('other')
    expect(prep.storyKind(Buffer.alloc(0))).toBe('other')
    expect(prep.storyKind(Buffer.from([0, 0, 0, 0]))).toBe('other')   // version 0 is not a story
  })

  it('does not offer Parchmap a .blb holding a GLULX game', async () => {
    // The extension says nothing: .blb and .blorb wrap either format. Wrapping a Glulx game as zcode
    // produced a link that loaded Parchmap and then failed inside its interpreter.
    writeFileSync(join(stories, 'modern.blb'), blorb('GLUL'))
    writeFileSync(join(stories, 'classic.blb'), blorb('ZCOD'))
    const prep = await loadPrepare()
    const lib = prep.scanLibrary()
    expect(entryFor(lib, 'modern.blb').zcode).toBe(false)
    expect(entryFor(lib, 'classic.blb').zcode).toBe(true)

    prep.refresh()
    expect(existsSync(join(games, 'classic.blb.js'))).toBe(true)
    expect(existsSync(join(games, 'modern.blb.js'))).toBe(false)
  })

  it('refuses to wrap a story Parchmap cannot play, however it is asked', async () => {
    writeFileSync(join(stories, 'story.ulx'), glulx())
    const prep = await loadPrepare()
    expect(prep.ensureWrapped('story.ulx')).toBe(null)
    expect(prep.refresh().wrapped).toEqual([])
  })

  it('ignores files that are not stories at all', async () => {
    writeFileSync(join(stories, 'notes.txt'), 'not a story')
    writeFileSync(join(stories, '.hidden.z5'), zcode())
    writeFileSync(join(stories, 'real.z5'), zcode())
    const prep = await loadPrepare()
    expect(prep.scanLibrary().map(s => s.name)).toEqual(['real.z5'])
  })
})

describe('wrapping', () => {
  it('produces exactly what Parchmap own catalogue contains', async () => {
    const raw = zcode(5, 300)
    writeFileSync(join(stories, 'a.z5'), raw)
    const prep = await loadPrepare()
    prep.refresh()
    expect(readFileSync(join(games, 'a.z5.js'), 'utf8'))
      .toBe("processBase64Zcode('" + raw.toString('base64') + "');")
  })

  it('leaves an up-to-date wrapped file alone rather than rewriting it every request', async () => {
    writeFileSync(join(stories, 'a.z5'), zcode())
    const prep = await loadPrepare()
    prep.refresh()
    const wrapped = join(games, 'a.z5.js')
    const first = statSync(wrapped).mtimeMs
    prep.refresh()
    expect(statSync(wrapped).mtimeMs).toBe(first)
  })

  it('rewraps when the story file itself was replaced', async () => {
    // Drop a corrected copy of the same game in and Parchmap must play the NEW one. Keying only on
    // existence left it playing the old bytes forever, because nothing would ever wrap it again.
    writeFileSync(join(stories, 'game.z5'), zcode(5, 100))
    const prep = await loadPrepare()
    prep.refresh()
    const wrapped = join(games, 'game.z5.js')
    const before = readFileSync(wrapped, 'utf8')

    const replacement = zcode(5, 200)
    replacement.write('REVISED', 20)
    writeFileSync(join(stories, 'game.z5'), replacement)
    // mtime resolution is coarse enough on some filesystems to tie; make the source unambiguously newer.
    const later = new Date(Date.now() + 4000)
    utimesSync(join(stories, 'game.z5'), later, later)

    prep.refresh()
    const after = readFileSync(wrapped, 'utf8')
    expect(after).not.toBe(before)
    expect(after).toBe("processBase64Zcode('" + replacement.toString('base64') + "');")
  })

  it('never overwrites a game Parchmap ships, which has no source in the volume', async () => {
    mkdirSync(games, { recursive: true })
    writeFileSync(join(games, 'Shipped.z5.js'), "processBase64Zcode('SHIPPED');")
    const prep = await loadPrepare()
    prep.refresh()
    expect(readFileSync(join(games, 'Shipped.z5.js'), 'utf8')).toBe("processBase64Zcode('SHIPPED');")
  })

  it('rewrites the menu only when it changed', async () => {
    writeFileSync(join(stories, 'a.z5'), zcode())
    const prep = await loadPrepare()
    prep.refresh()
    const menu = join(root, 'parchmap', 'js', 'GameList.js')
    const first = readFileSync(menu, 'utf8')
    prep.refresh()
    expect(readFileSync(menu, 'utf8')).toBe(first)
  })

  it('does nothing at all when Parchmap is not in the image', async () => {
    // Built with WITH_PARCHMAP=0: no parchmap directory exists, and that must degrade, not throw.
    rmSync(join(root, 'parchmap'), { recursive: true, force: true })
    writeFileSync(join(stories, 'a.z5'), zcode())
    const prep = await loadPrepare()
    expect(prep.parchmapPresent()).toBe(false)
    expect(() => prep.refresh()).not.toThrow()
    expect(prep.refresh().wrapped).toEqual([])
    expect(prep.ensureWrapped('a.z5')).toBe(null)
  })

  it('survives a volume that is not there', async () => {
    rmSync(stories, { recursive: true, force: true })
    const prep = await loadPrepare()
    expect(prep.scanLibrary()).toEqual([])
    expect(() => prep.refresh()).not.toThrow()
  })
})

describe('the library helper HTTP surface', () => {
  /** Drive the request handler directly: no socket, no port, no ordering to race on. */
  async function request(url: string, method = 'GET') {
    vi.resetModules()
    process.env['PARCHTOUCH_STORIES'] = stories
    process.env['PARCHTOUCH_ROOT'] = root
    process.env['PARCHTOUCH_SEED'] = join(dir, 'no-seed')
    const { handleLibraryRequest } = await import('../docker/library.mjs')
    return await new Promise<{ status: number, headers: Record<string, string>, body: string }>(resolve => {
      const chunks: Buffer[] = []
      const res = {
        headersSent: false,
        statusCode: 0,
        headers: {} as Record<string, string>,
        writeHead(status: number, headers: Record<string, string>) {
          this.statusCode = status
          this.headers = headers
          this.headersSent = true
        },
        end(body?: Buffer | string) {
          if (body) { chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body)) }
          resolve({ status: this.statusCode, headers: this.headers, body: Buffer.concat(chunks).toString('utf8') })
        },
      }
      handleLibraryRequest({ url, method }, res)
    })
  }

  it('reports which players can take each story', async () => {
    writeFileSync(join(stories, 'classic.z5'), zcode())
    writeFileSync(join(stories, 'modern.ulx'), glulx())
    const res = await request('/library.json')
    expect(res.status).toBe(200)
    const lib = JSON.parse(res.body)
    expect(lib.parchmap).toBe(true)
    expect(lib.stories).toEqual([
      { name: 'classic.z5', title: 'classic', players: ['parchment', 'parchmap'] },
      { name: 'modern.ulx', title: 'modern', players: ['parchment'] },
    ])
  })

  it('is never cached — the volume is mutable', async () => {
    const res = await request('/library.json')
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('serves a wrapped story that did not exist when the request arrived', async () => {
    writeFileSync(join(stories, 'fresh.z5'), zcode(5, 128))
    const res = await request('/parchmap/games/fresh.z5.js')
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toContain('javascript')
    expect(res.body).toMatch(/^processBase64Zcode\('/)
    expect(existsSync(join(games, 'fresh.z5.js'))).toBe(true)   // cached on disk for nginx next time
  })

  it('decodes a percent-escaped name, so a title with spaces works', async () => {
    writeFileSync(join(stories, 'A Mind Forever Voyaging.z5'), zcode())
    const res = await request('/parchmap/games/A%20Mind%20Forever%20Voyaging.z5.js')
    expect(res.status).toBe(200)
  })

  it('refuses a path that escapes the library', async () => {
    // The name is matched against the scanned volume rather than joined onto a path, so traversal
    // cannot resolve — including the encoded form, which is what would slip past a naive check.
    for (const attack of [
      '/parchmap/games/../../../etc/passwd',
      '/parchmap/games/..%2f..%2f..%2fetc%2fpasswd',
      '/parchmap/games/%2e%2e%2fGameList.js',
    ]) {
      const res = await request(attack)
      expect(res.status).toBe(404)
      expect(res.body).not.toContain('processBase64Zcode')
    }
  })

  it('404s a story that is not in the library, and one Parchmap cannot play', async () => {
    writeFileSync(join(stories, 'modern.ulx'), glulx())
    expect((await request('/parchmap/games/absent.z5.js')).status).toBe(404)
    expect((await request('/parchmap/games/modern.ulx.js')).status).toBe(404)
  })

  it('rejects a malformed escape rather than throwing', async () => {
    expect((await request('/parchmap/games/%E0%A4%A.js')).status).toBe(400)
  })

  it('refuses a method that would change something', async () => {
    expect((await request('/library.json', 'DELETE')).status).toBe(405)
  })

  it('404s anything else', async () => {
    expect((await request('/../../etc/passwd')).status).toBe(404)
    expect((await request('/')).status).toBe(404)
  })
})
