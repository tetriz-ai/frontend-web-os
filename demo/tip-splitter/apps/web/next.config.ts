// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import type { NextConfig } from 'next';

// Static export (D-7): no server code, any static host works. A static export can't set headers,
// so the Content-Security-Policy ships as a <meta> tag in app/layout.tsx (D-24); headers such as
// frame-ancestors, X-Content-Type-Options and Referrer-Policy are set at the host.
const config: NextConfig = {
  output: 'export',
  // Type-check the app without its tests, so red runs (tests before code) can still build.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
  // fwos's web profile gives agents their rules; don't let `next dev` write an AGENTS.md too.
  // Next's version-matched docs stay readable at node_modules/next/dist/docs/.
  agentRules: false,
};

export default config;
