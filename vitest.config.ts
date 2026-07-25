import { defineConfig } from 'vitest/config'

/*
 * Node 22.4+ ships a built-in Web Storage implementation, and Node 25 enables it BY DEFAULT. Without
 * `--localstorage-file` that built-in `globalThis.localStorage` is a null-prototype object with no
 * methods — and because it already exists, vitest's jsdom environment never installs jsdom's real
 * Storage over it (`window === globalThis` here, so jsdom's instance becomes unreachable). The verb
 * persistence tests then die with `localStorage.clear is not a function`.
 *
 * Disabling the built-in in the test worker restores jsdom's genuine Storage, which matters for more
 * than just `clear()`: two tests spy on `Storage.prototype.getItem`/`setItem` to simulate blocked
 * storage. A hand-rolled polyfill would not share jsdom's prototype, those spies would not intercept,
 * and both tests would pass VACUOUSLY while proving nothing.
 *
 * Applied conditionally: on a Node without the built-in (the project's stated Node 20+ floor) the
 * flag does not exist and passing it would abort the worker, so we add it only after detecting the
 * broken global. On such a Node this config is exactly the plain jsdom config.
 */
const builtinWebStorageIsShadowing =
  typeof (globalThis as { localStorage?: unknown }).localStorage === 'object' &&
  typeof (globalThis as { localStorage?: { getItem?: unknown } }).localStorage?.getItem !== 'function'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    // `pool` is pinned alongside execArgv on purpose: execArgv is only delivered to a FORK worker, so
    // if vitest ever changes its default pool this fix would silently stop applying. An explicit
    // `--pool=threads` on the command line still overrides config and WILL fail these 11 tests on a
    // Node with built-in Web Storage — use the documented `npm test`.
    ...(builtinWebStorageIsShadowing
      ? {
          pool: 'forks' as const,
          poolOptions: { forks: { execArgv: ['--no-experimental-webstorage'] } },
        }
      : {}),
  },
})
