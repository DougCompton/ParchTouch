/*
 * library.mjs — the small HTTP helper that keeps the mounted library live.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 *
 * WHY THIS EXISTS. The picker lists the volume live from nginx's directory index, so a story dropped
 * into the share appears on a reload with no restart. Parchment then plays it straight away, because
 * nginx serves the raw file. Parchmap could not: its legacy core loads a JS-wrapped copy that only
 * existed if the entrypoint had run since the file appeared. One player worked and the other 404'd —
 * for exactly the stories a user is most likely to have just added.
 *
 * Two routes, both nginx-proxied from 127.0.0.1 (see docker/nginx.conf):
 *
 *   GET /library.json            the library, each story marked with which players can take it —
 *                                and, as a side effect, everything wrapped and the menu refreshed
 *   GET /parchmap/games/<n>.js   a wrapped story, generated on the spot if it is not on disk yet.
 *                                nginx only falls back here when the static file is MISSING, so a
 *                                game Parchmap ships and anything already wrapped never reach us.
 *
 * It listens on the LOOPBACK interface only: nothing here is meant to be reachable from outside the
 * container, and binding it publicly would expose a filesystem read that nginx is already gating.
 *
 * It must never take the container down with it. A failure to bind is logged and the process carries
 * on serving — the picker falls back to nginx's directory index, and Parchmap keeps whatever was
 * wrapped at startup. Degrade, never throw.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { refresh, ensureWrapped, parchmapPresent } from './prepare.mjs'

const PORT = Number(process.env['PARCHTOUCH_HELPER_PORT'] ?? 8091)
const HOST = '127.0.0.1'

/** The prefix nginx proxies wrapped-story requests under. */
const GAMES_PREFIX = '/parchmap/games/'

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/**
 * The library, in the shape the picker renders.
 *
 * `players` rather than a bare `zcode` flag: the picker should not have to know which player needs
 * which format, and it cannot sniff a file's contents from the browser anyway.
 */
function libraryPayload() {
  const { stories } = refresh()
  const hasParchmap = parchmapPresent()
  return {
    parchmap: hasParchmap,
    stories: stories.map(s => ({
      name: s.name,
      title: s.title,
      players: hasParchmap && s.zcode ? ['parchment', 'parchmap'] : ['parchment'],
    })),
  }
}

function handle(req, res) {
  // A relative URL is enough to parse the path; the host is irrelevant to a loopback-only server.
  const path = new URL(req.url ?? '/', 'http://localhost').pathname

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'GET only')
    return
  }

  if (path === '/library.json') {
    sendJson(res, 200, libraryPayload())
    return
  }

  if (path.startsWith(GAMES_PREFIX)) {
    // decodeURIComponent because nginx forwards the request target still encoded, and a story called
    // "A Mind Forever Voyaging.z5" reaches us as %20. A malformed escape is a bad request, not a crash.
    let file
    try {
      file = decodeURIComponent(path.slice(GAMES_PREFIX.length))
    } catch {
      sendText(res, 400, 'bad request')
      return
    }
    // Its own links are games/<story>.js, so strip the wrapper suffix to get back to the story name.
    // ensureWrapped() then matches that against the real library, which is what rejects traversal.
    const name = file.replace(/\.js$/, '')
    const target = ensureWrapped(name)
    if (!target) {
      sendText(res, 404, 'no such Z-machine story in the library')
      return
    }
    try {
      const body = readFileSync(target)
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': body.length,
        // Generated from a mutable volume: a replaced story file must not be masked by a cached copy.
        'Cache-Control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch (err) {
      sendText(res, 500, 'could not read the wrapped story: ' + err.message)
    }
    return
  }

  sendText(res, 404, 'not found')
}

/** Start the helper. Returns the server, or null if it could not listen. */
export function startLibraryServer() {
  let server
  try {
    server = createServer((req, res) => {
      try {
        handle(req, res)
      } catch (err) {
        // One bad request must not stop the helper answering the next one.
        console.warn('[ParchTouch] library request failed: ' + (err?.message ?? err))
        if (!res.headersSent) { sendText(res, 500, 'internal error') }
      }
    })
  } catch (err) {
    console.warn('[ParchTouch] library helper unavailable: ' + (err?.message ?? err))
    return null
  }
  server.on('error', err => {
    console.warn('[ParchTouch] library helper stopped listening: ' + (err?.message ?? err)
      + ' — the picker will fall back to the directory index')
  })
  server.listen(PORT, HOST, () => {
    console.log('[ParchTouch] library helper on http://' + HOST + ':' + PORT)
  })
  // Do not hold the process open on its own account; nginx is what keeps the container alive.
  server.unref()
  return server
}

export { handle as handleLibraryRequest, libraryPayload }
