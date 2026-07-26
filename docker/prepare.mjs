/*
 * prepare.mjs — make a mounted story library playable by BOTH bundled players.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 *
 * The two players want the same game in different shapes, which is the whole reason this exists:
 *
 *   Parchment  reads a RAW story file over HTTP            -> serve /stories as-is
 *   Parchmap   bundles a legacy core that loads a game by   -> write parchmap/games/<name>.js
 *              <script> injection, as processBase64Zcode('<base64>')
 *
 * So every Z-machine story in the volume is wrapped into Parchmap's shape, and Parchmap's own game menu
 * is regenerated so your library appears in it alongside the games it ships with. The volume itself is
 * never written to — it is expected to be mounted read-only.
 *
 * WRAPPING IS ON DEMAND, NOT ONCE AT BOOT. It used to run only from the entrypoint, which broke the
 * one thing the picker page advertises: the library is listed LIVE from nginx's directory index, so a
 * story dropped into the share appeared immediately, its Parchment link worked (the raw file is served
 * straight from the volume) and its Parchmap link 404'd (nothing had wrapped it since startup). Every
 * entry point here therefore rescans first — see library.mjs, which serves the picker and Parchmap's
 * games directory.
 *
 * FORMAT IS READ FROM THE FILE, NOT THE NAME. `processBase64Zcode` is the legacy core's ZCODE entry
 * point, so a Glulx, TADS, Hugo or SCARE game cannot be wrapped for Parchmap — those still play in
 * Parchment, which has an engine for each. Extensions cannot decide this: `.blb` and `.blorb` are
 * generic Blorb containers holding EITHER a Z-machine or a Glulx game, and a Glulx one wrapped as
 * zcode produces a Parchmap link that loads and then fails. Sniffing the container is exact.
 *
 * Verified: the wrapper output is byte-identical to the games Parchmap ships.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

const STORIES = process.env['GLKTOUCH_STORIES'] ?? '/stories'
const ROOT = process.env['GLKTOUCH_ROOT'] ?? '/usr/share/nginx/html'
const SEED = process.env['GLKTOUCH_SEED'] ?? '/opt/glk-touch/seed'

const PARCHMAP = join(ROOT, 'parchmap')
const GAMES = join(PARCHMAP, 'games')

/*
 * Extensions decide only whether a file is a STORY AT ALL — which of the two players can take it is
 * decided by storyKind() below, from the bytes. Kept broad on purpose: an unknown extension is simply
 * not offered, and Parchment's own page still accepts it by URL or upload.
 */
const STORY_EXTS = new Set([
  '.z1', '.z2', '.z3', '.z4', '.z5', '.z6', '.z7', '.z8', '.zblorb', '.zlb',
  '.blb', '.blorb', '.gblorb', '.glb', '.ulx', '.t3', '.gam', '.hex', '.taf',
])

/** How much of a Blorb to read before giving up on finding its executable chunk. */
const SNIFF_BYTES = 64 * 1024

function u32(buf, at) {
  return at + 4 <= buf.length ? buf.readUInt32BE(at) : 0
}

/**
 * Walk a Blorb's top-level chunks for the executable it carries.
 *
 * Layout: 'FORM', u32 length, 'IFRS', then a flat list of { 4-byte id, u32 length, data } with each
 * chunk padded to an even length. The resource index (RIdx) comes first; the game itself is a ZCOD or
 * GLUL chunk beside it. The loop is bounded because the length fields come from an untrusted file.
 */
function blorbExecutable(buf) {
  const end = Math.min(buf.length, 8 + u32(buf, 4))
  let at = 12
  for (let guard = 0; at + 8 <= end && guard < 1024; guard++) {
    const id = buf.toString('latin1', at, at + 4)
    if (id === 'ZCOD') { return 'zcode' }
    if (id === 'GLUL') { return 'glulx' }
    const len = u32(buf, at + 4)
    if (len <= 0) { break }              // a zero or unreadable length cannot be walked past
    at += 8 + len + (len % 2)
  }
  return 'unknown'
}

/**
 * Which interpreter family a story belongs to, read from its content: 'zcode' (Parchmap can play it),
 * or 'other' (Parchment only). Only 'zcode' is ever wrapped.
 */
export function storyKind(buf) {
  if (!buf || buf.length < 4) { return 'other' }
  if (buf.toString('latin1', 0, 4) === 'FORM' && buf.toString('latin1', 8, 12) === 'IFRS') {
    return blorbExecutable(buf.subarray(0, SNIFF_BYTES)) === 'zcode' ? 'zcode' : 'other'
  }
  if (buf.toString('latin1', 0, 4) === 'Glul') { return 'other' }
  // A raw Z-machine file opens with its version byte. Nothing else this reaches starts 0x01-0x08:
  // Glulx is 'G', TADS 'T', Blorb 'F', Hugo and Adrift both begin well above 8.
  const version = buf[0]
  return version >= 1 && version <= 8 ? 'zcode' : 'other'
}

/** A readable title from a filename: "TheLurkingHorror.z3" -> "The Lurking Horror". */
export function titleOf(file) {
  const stem = basename(file, extname(file)).replace(/\.(z[1-8]|zblorb|zlb|blb|blorb|gblorb|glb|ulx)$/i, '')
  return stem
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim() || stem
}

/**
 * The library as it is RIGHT NOW, with each story classified by reading it.
 *
 * A story that cannot be read is reported as Parchment-only rather than dropped: Parchment fetches it
 * over HTTP and may well succeed where this process could not.
 */
export function scanLibrary() {
  let names = []
  try {
    names = readdirSync(STORIES)
  } catch {
    return []          // no volume mounted: not an error, just an empty library
  }
  return names
    .filter(n => !n.startsWith('.'))
    .filter(n => STORY_EXTS.has(extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map(name => {
      let kind = 'other'
      try {
        kind = storyKind(readFileSync(join(STORIES, name)))
      } catch (err) {
        console.warn('[glk-touch] could not read ' + name + ': ' + err.message)
      }
      return { name, title: titleOf(name), zcode: kind === 'zcode' }
    })
}

/**
 * Is the wrapped copy already up to date with the story it came from?
 *
 * Existence alone is not enough: replacing a story file with a corrected or different game of the SAME
 * name would otherwise leave Parchmap playing the old one forever, since nothing would ever rewrap it.
 * A source newer than its wrapper wins. If the times cannot be read, treat an existing wrapper as good
 * and leave it alone — that is the case of a game Parchmap ships, which has no source here at all.
 */
function isFresh(source, target) {
  if (!existsSync(target)) { return false }
  try {
    return statSync(target).mtimeMs >= statSync(source).mtimeMs
  } catch {
    return true
  }
}

/** The JSONP text Parchmap's legacy core loads. Byte-identical to the games it ships. */
function wrapperFor(raw) {
  return "processBase64Zcode('" + raw.toString('base64') + "');"
}

export function parchmapPresent() { return existsSync(PARCHMAP) }

/**
 * Ensure the wrapped copy of one story exists, and return its path — or null if it cannot exist.
 *
 * `name` arrives from a URL, so it is matched against the scanned library rather than being joined
 * onto a path: that rejects `../` and anything else not actually in the volume, by construction.
 */
export function ensureWrapped(name, library) {
  if (!parchmapPresent()) { return null }
  const entry = (library ?? scanLibrary()).find(s => s.name === name)
  if (!entry || !entry.zcode) { return null }

  const source = join(STORIES, entry.name)
  const target = join(GAMES, entry.name + '.js')
  if (isFresh(source, target)) { return target }
  try {
    mkdirSync(GAMES, { recursive: true })
    writeFileSync(target, wrapperFor(readFileSync(source)))
    return target
  } catch (err) {
    console.warn('[glk-touch] could not wrap ' + entry.name + ': ' + err.message)
    return null
  }
}

/** Wrap every Z-machine story in the library; returns the names Parchmap can now load. */
export function wrapAll(library) {
  const lib = library ?? scanLibrary()
  if (!parchmapPresent()) { return [] }
  return lib.filter(s => s.zcode && ensureWrapped(s.name, lib) !== null).map(s => s.name)
}

/**
 * Put the mounted library into Parchmap's own menu.
 *
 * Built by APPENDING to the pristine bundled list rather than parsing it: that file is JavaScript
 * (`var GameList = [ … ]`), so re-declaring the variable afterwards is both simpler and immune to any
 * change in its formatting.
 */
export function rewriteGameList(wrapped) {
  const bundled = join(PARCHMAP, 'js', 'GameList.bundled.js')
  const target = join(PARCHMAP, 'js', 'GameList.js')
  if (!existsSync(bundled)) { return }
  try {
    const entries = wrapped.map(name => ({
      Title: titleOf(name),
      Subtitle: 'from your library',
      Author: '',
      Filename: name + '.js',
    }))
    const suffix = entries.length === 0
      ? ''
      : '\n\n/* Added by glk-touch from the mounted story library. */\n'
        + 'GameList = ' + JSON.stringify(entries, null, 4) + '.concat(GameList);\n'
    const next = readFileSync(bundled, 'utf8') + suffix
    // Only write when it actually changed: this runs on every library request, and rewriting an
    // unchanged file would churn its mtime for nothing.
    if (!existsSync(target) || readFileSync(target, 'utf8') !== next) { writeFileSync(target, next) }
  } catch (err) {
    console.warn('[glk-touch] could not update the game menu: ' + err.message)
  }
}

/** Seed Adventure into the library if the volume is empty, so a bare `docker run` still plays. */
function seedIfEmpty(found) {
  if (found.length > 0) { return found }
  const seed = join(SEED, 'advent.z5')
  if (!existsSync(seed)) { return found }
  try {
    mkdirSync(STORIES, { recursive: true })
    copyFileSync(seed, join(STORIES, 'advent.z5'))
    console.log('[glk-touch] library was empty — seeded Adventure')
    return scanLibrary()
  } catch {
    // A read-only mount is the normal case; the picker will simply show what is there.
    console.log('[glk-touch] library is empty and read-only — mount stories at ' + STORIES)
    return found
  }
}

/**
 * Bring everything into step with the volume: classify, wrap, refresh Parchmap's menu.
 *
 * Called at startup AND from every library request, so it must stay cheap for an unchanged library —
 * which it is: a readdir, a read per story, and no writes once the wrapping exists.
 */
export function refresh({ seed = false } = {}) {
  const stories = seed ? seedIfEmpty(scanLibrary()) : scanLibrary()
  const wrapped = wrapAll(stories)
  rewriteGameList(wrapped)
  return { stories, wrapped }
}

/** Startup pass. Seeds the volume if it is empty, and says what it found. */
export function prepare() {
  const { stories, wrapped } = refresh({ seed: true })
  console.log('[glk-touch] ' + stories.length + ' game(s) in ' + STORIES
    + (parchmapPresent() ? ', ' + wrapped.length + ' available to Parchmap' : ''))
  return { stories, wrapped }
}
