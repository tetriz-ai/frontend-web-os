// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import type { NextConfig } from 'next';

// The security baseline (fwos check web/security): a strict Content-Security-Policy on every page.
// 'unsafe-inline' for styles is needed by Next's runtime; scripts stay same-origin. In development
// Next needs 'unsafe-eval' for fast refresh, so it's added only there.
const dev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${dev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const config: NextConfig = {
  // Type-check the app without its tests, so red runs (tests before code) can still build.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
  // fwos's web profile gives agents their rules; don't let `next dev` write an AGENTS.md too.
  // Next's version-matched docs stay readable at node_modules/next/dist/docs/.
  agentRules: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default config;
