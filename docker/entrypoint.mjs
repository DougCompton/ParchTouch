/*
 * entrypoint.mjs — prepare the story library, then hand over to the server.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 *
 * Preparation must not be able to stop the container from serving: a library that cannot be wrapped
 * still plays perfectly well in Parchment, so a failure here is reported and then ignored.
 *
 * nginx replaces this process rather than being supervised by it, so it keeps PID 1 and `docker stop`
 * reaches it directly.
 */
import { spawn } from 'node:child_process'
import { prepare } from './prepare.mjs'
import { startLibraryServer } from './library.mjs'

try {
  prepare()
} catch (err) {
  console.warn('[glk-touch] library preparation failed, serving anyway: ' + (err?.message ?? err))
}

/*
 * The startup pass above only covers the volume AS IT IS NOW. This keeps it live: the helper rescans
 * per request, so a story added to the share later is wrapped for Parchmap the moment the picker lists
 * it, rather than 404ing until the next restart. It binds loopback only, and a failure to start is not
 * fatal — see library.mjs.
 */
startLibraryServer()

const argv = process.argv.slice(2)
const cmd = argv.length > 0 ? argv : ['nginx', '-g', 'daemon off;']

const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => child.kill(sig))
}
