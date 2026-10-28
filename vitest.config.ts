// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['plugin/**/tests/**/*.test.ts', 'scripts/tests/**/*.test.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    maxWorkers: 2,
    // The tests run git. A developer's global or system config (a shared core.hooksPath, commit
    // signing, an identity) must not change what they do, and nothing they do may reach it.
    // Host-session detection is opt-in in tests, independent of the parent agent runtime.
    env: {
      CODEX_THREAD_ID: '',
      CODEX_SESSION_ID: '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'fwos test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'fwos test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  },
});
