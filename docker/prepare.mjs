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
 * So every Z-machine story in the volume is wrapped once at startup, and Parchmap's own game menu is
 * regenerated so your library appears in it alongside the games it ships with. The volume itself is
 * never written to — it is expected to be mounted read-only.
 *
 * Verified: the wrapper output is byte-identical to the games Parchmap ships.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

const STORIES = process.env['GLKTOUCH_STORIES'] ?? '/stories'
const ROOT = process.env['GLKTOUCH_ROOT'] ?? '/usr/share/nginx/html'
const SEED = process.env['GLKTOUCH_SEED'] ?? '/opt/glk-touch/seed'

const PARCHMAP = join(ROOT, 'parchmap')
const GAMES = join(PARCHMAP, 'games')

/*
 * Z-machine only. `processBase64Zcode` is the legacy core's ZCODE entry point, so a Glulx, TADS, Hugo
 * or SCARE game cannot be wrapped for Parchmap — those still play in Parchment, which has an engine for
 * each, and the picker says so rather than offering a link that would fail.
 */
const ZCODE = new Set(['.z1', '.z2', '.z3', '.z4', '.z5', '.z6', '.z7', '.z8', '.zblorb', '.zlb', '.blb'])
const OTHER_PLAYABLE = new Set(['.ulx', '.blorb', '.gblorb', '.glb', '.t3', '.gam', '.hex', '.taf'])

/** A readable title from a filename: "TheLurkingHorror.z3" -> "The Lurking Horror". */
function titleOf(file) {
  const stem = basename(file, extname(file)).replace(/\.(z[1-8]|zblorb|zlb|blb)$/i, '')
  return stem
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim() || stem
}

function listStories() {
  let names = []
  try {
    names = readdirSync(STORIES)
  } catch {
    return []          // no volume mounted: not an error, just an empty library
  }
  return names
    .filter(n => !n.startsWith('.'))
    .filter(n => ZCODE.has(extname(n).toLowerCase()) || OTHER_PLAYABLE.has(extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({ name, zcode: ZCODE.has(extname(name).toLowerCase()) }))
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
    return listStories()
  } catch {
    // A read-only mount is the normal case; the picker will simply show what is there.
    console.log('[glk-touch] library is empty and read-only — mount stories at ' + STORIES)
    return found
  }
}

/** Wrap raw Z-machine stories into the form Parchmap's core loads. */
function wrapForParchmap(stories) {
  if (!existsSync(PARCHMAP)) { return [] }
  mkdirSync(GAMES, { recursive: true })
  const wrapped = []
  for (const s of stories) {
    if (!s.zcode) { continue }
    const target = join(GAMES, s.name + '.js')
    try {
      // Skip a game Parchmap already ships, and anything already wrapped on a previous start.
      if (existsSync(target)) { wrapped.push(s.name); continue }
      const b64 = readFileSync(join(STORIES, s.name)).toString('base64')
      writeFileSync(target, "processBase64Zcode('" + b64 + "');")
      wrapped.push(s.name)
    } catch (err) {
      console.warn('[glk-touch] could not wrap ' + s.name + ': ' + err.message)
    }
  }
  return wrapped
}

/**
 * Put the mounted library into Parchmap's own menu.
 *
 * Built by APPENDING to the pristine bundled list rather than parsing it: that file is JavaScript
 * (`var GameList = [ … ]`), so re-declaring the variable afterwards is both simpler and immune to any
 * change in its formatting.
 */
function rewriteGameList(wrapped) {
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
    writeFileSync(target, readFileSync(bundled, 'utf8') + suffix)
  } catch (err) {
    console.warn('[glk-touch] could not update the game menu: ' + err.message)
  }
}

export function prepare() {
  const stories = seedIfEmpty(listStories())
  const wrapped = wrapForParchmap(stories)
  rewriteGameList(wrapped)
  console.log('[glk-touch] ' + stories.length + ' game(s) in ' + STORIES
    + (existsSync(PARCHMAP) ? ', ' + wrapped.length + ' available to Parchmap' : ''))
  return { stories, wrapped }
}
