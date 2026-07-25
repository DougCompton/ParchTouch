/*
 * serve-harness.mjs — a dependency-free static server for the local harness.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 *
 * WHY THIS EXISTS: the harness pages reference paths that only make sense under the prefix mapping
 * nginx.conf + docker-compose.yml set up (/parchment-vendor/ is really harness/vendor/parchment/, and
 * so on). A plain `python -m http.server` rooted anywhere therefore 404s. This reproduces exactly the
 * same mapping with no Docker and no dependencies, which is what lets the Playwright suite drive the
 * real hosts in CI.
 *
 * Keep the PREFIXES table in sync with harness/nginx.conf and harness/docker-compose.yml.
 *
 * Usage: node scripts/serve-harness.mjs [port]        (default 8080)
 */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat, readdir } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = Number(process.argv[2] ?? process.env['HARNESS_PORT'] ?? 8080)

/** URL prefix -> directory on disk. Longest prefix wins, so order does not matter. */
const PREFIXES = [
  ['/dist/', join(ROOT, 'dist')],
  ['/synthetic/', join(ROOT, 'harness', 'synthetic')],
  ['/parchment-vendor/', join(ROOT, 'harness', 'vendor', 'parchment')],
  ['/parchment/', join(ROOT, 'harness', 'parchment')],
  ['/parchmap/', join(ROOT, 'harness', 'vendor', 'parchmap')],
  ['/stories/', join(ROOT, 'harness', 'stories')],
]

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

/** Story files and anything unrecognised: octet-stream, matching nginx's default_type. */
function contentType(path) {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** Map a URL path to a file, or null if it escapes its prefix root (traversal guard). */
function resolvePath(urlPath) {
  let best = null
  for (const [prefix, dir] of PREFIXES) {
    if (urlPath.startsWith(prefix) && (!best || prefix.length > best[0].length)) {
      best = [prefix, dir]
    }
  }
  if (!best) { return null }
  const [prefix, dir] = best
  const rel = normalize(decodeURIComponent(urlPath.slice(prefix.length)))
  const full = resolve(dir, rel)
  // resolve() has already collapsed any ../ — confirm we are still inside the mapped directory.
  if (full !== dir && !full.startsWith(dir + sep)) { return null }
  return full
}

const server = createServer(async (req, res) => {
  const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname
  const file = resolvePath(urlPath)

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('404 — no prefix mapping for ' + urlPath + '\n')
    return
  }

  try {
    const info = await stat(file)

    if (info.isDirectory()) {
      // nginx serves /stories/ with `autoindex_format json`; mirror that so a page can list stories.
      const names = await readdir(file)
      const body = JSON.stringify(names.map(n => ({ name: n })))
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(body)
      return
    }

    const headers = { 'Content-Type': contentType(file), 'Content-Length': String(info.size) }
    // Never cache the addon: `npm run dev` rewrites it on every save.
    if (urlPath.startsWith('/dist/')) { headers['Cache-Control'] = 'no-store' }
    res.writeHead(200, headers)
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('404 — not found: ' + urlPath + '\n')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('harness serving on http://127.0.0.1:' + PORT + '/')
  for (const [prefix, dir] of PREFIXES) {
    console.log('  ' + prefix.padEnd(20) + '-> ' + dir)
  }
})
