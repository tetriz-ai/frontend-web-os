// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a production build (`next build`, a static export in out/, served by
// scripts/serve-static.mjs because `next start` can't serve an export; D-24), the default row that
// catches packaging bugs. They use their own port (E2E_PORT, default 3210) and never reuse a
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
    command: dev ? `pnpm exec next dev -p ${port}` : `pnpm exec next build && node scripts/serve-static.mjs out ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: process.env.FWOS_E2E_REUSE === '1',
    timeout: 180_000,
  },
});
