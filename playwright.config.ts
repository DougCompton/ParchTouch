import { defineConfig, devices } from '@playwright/test'

/*
 * End-to-end config. These tests exist to cover what jsdom structurally cannot:
 *
 *  - REAL event semantics. The addon submits a command by assigning `.value` and dispatching a
 *    synthetic KeyboardEvent whose `keyCode` is forced to 13 via defineProperty. jsdom accepts that
 *    unconditionally; a real engine need not. Plan Unknown U7 rates this Medium-high because the
 *    tablet is the primary target device.
 *  - WEBKIT. iOS Safari is the strictest environment the addon must work in and the one the author
 *    actually plays on. Playwright's webkit is the same engine family, so running the suite there
 *    de-risks U7 well before anyone picks up an iPad. It is NOT a substitute for real hardware —
 *    touch input, the software keyboard and viewport behaviour still need a device (plan Task 5.3).
 *  - REAL HOSTS. Only a real GlkOte build can answer what classes it actually emits, which is what
 *    Unknowns U1-U6 are about.
 *
 * Timeouts are generous on purpose: a real host loads a >1MB wasm interpreter before any DOM the
 * addon can attach to exists.
 */
export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  /*
   * Capped deliberately. Each real-host spec boots a full interpreter with a >1MB wasm payload, and at
   * the default worker count (cores/2) four of them start at once across the chromium and webkit
   * projects — enough CPU contention to time out the wait for the addon to attach. A flaky suite is
   * worth less than a slower one.
   */
  workers: 3,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 150_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://127.0.0.1:8080',
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  /*
   * The harness pages depend on the prefix mapping in harness/nginx.conf, so a plain static server
   * rooted anywhere would 404. serve-harness.mjs reproduces that mapping with no Docker and no
   * dependencies. It serves dist/, so `npm run build` must have run first — scripts/ci.sh orders it
   * that way.
   */
  webServer: {
    command: 'node scripts/serve-harness.mjs 8080',
    url: 'http://127.0.0.1:8080/dist/parch-touch.js',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
})
