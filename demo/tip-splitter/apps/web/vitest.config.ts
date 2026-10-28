// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// JUnit results go to .fwos/local/results/, where `fwos check` reads them (traceability, states).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    reporters: ['default', 'junit'],
    outputFile: { junit: '../../.fwos/local/results/vitest.xml' },
  },
});
