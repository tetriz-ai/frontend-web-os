import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a production build (`next build && next start`), the default row
// that catches packaging bugs. They use their own port (E2E_PORT, default 3210) and never reuse a
// server that's already running unless FWOS_E2E_REUSE=1, so they can't test some other app by
// mistake. Set FWOS_E2E_DEV=1 to run against `next dev` while iterating.
const port = Number(process.env.E2E_PORT ?? 3210);
const dev = process.env.FWOS_E2E_DEV === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['junit', { outputFile: '../../.fwos/local/results/playwright.xml' }]],
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: dev ? `pnpm exec next dev -p ${port}` : `pnpm exec next build && pnpm exec next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: process.env.FWOS_E2E_REUSE === '1',
    timeout: 180_000,
    // fwos's harness (e2e/fwos-*.spec.ts) renders the dev-only screens browser and opens the app as
    // each role and flag setting, so the server under test allows both. Never set these in a real deployment.
    env: { FWOS_SCREENS: '1', FWOS_TEST_ACCESS: '1' },
  },
});
