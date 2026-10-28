// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import babelParser from '@babel/eslint-parser';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/checks/fixtures/**', '**/templates/**', '**/starter/**', 'examples/**', 'demo/**', '**/*.d.mts'],
  },
  {
    files: ['plugin/**/*.{ts,tsx}', 'scripts/**/*.{ts,mjs}', '*.config.ts'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript'] } },
      },
    },
    // TypeScript's strict compiler owns type resolution and undefined identifiers.
    // Babel parses syntax without depending on a particular TypeScript compiler release.
    rules: {
      'constructor-super': 'error',
      'no-async-promise-executor': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-dupe-keys': 'error',
      'no-fallthrough': 'error',
      'no-sparse-arrays': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'valid-typeof': 'error',
    },
  },
];
