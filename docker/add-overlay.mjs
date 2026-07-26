/*
 * add-overlay.mjs — add the two parch-touch tags to a host's HTML page.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 *
 * Used at image build time on a player's own page. A script rather than sed: the replacement contains
 * quotes, slashes and a newline, all of which have to be escaped differently for sed, for the shell and
 * for the Dockerfile parser — and getting one wrong there produced a Dockerfile that would not parse.
 *
 *   node add-overlay.mjs <html-file> [prefix]
 *
 * `prefix` is how the page reaches /dist/ — "../" from a page served out of a subdirectory.
 * Idempotent: a page that already has the tags is left alone.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
const prefix = process.argv[3] ?? '../'
if (!file) {
  console.error('usage: add-overlay.mjs <html-file> [prefix]')
  process.exit(2)
}

let html = readFileSync(file, 'utf8')

if (html.includes('parch-touch.js')) {
  console.log('[ParchTouch] ' + file + ' already has the overlay')
  process.exit(0)
}
if (!html.includes('</head>') || !html.includes('</body>')) {
  console.error('[ParchTouch] ' + file + ' has no </head> or </body> to inject into')
  process.exit(1)
}

// The script goes LAST in the body, after the host's own scripts, so .BufferWindow already exists.
html = html
  .replace('</head>', '    <link rel="stylesheet" href="' + prefix + 'dist/parch-touch.css">\n</head>')
  .replace('</body>', '    <script src="' + prefix + 'dist/parch-touch.js"></script>\n</body>')

writeFileSync(file, html)

if (!readFileSync(file, 'utf8').includes('parch-touch.js')) {
  console.error('[ParchTouch] injection into ' + file + ' did not take')
  process.exit(1)
}
console.log('[ParchTouch] overlay added to ' + file)
