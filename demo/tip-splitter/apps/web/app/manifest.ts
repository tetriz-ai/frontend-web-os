// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import type { MetadataRoute } from 'next';

// AC-calc-21: the web manifest, emitted as /manifest.webmanifest by the static export (D-7).
// No icons: the identity slot is blank (GAP-1). No colours: they'd need raw values in source.
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tip Splitter',
    short_name: 'Tip Splitter',
    start_url: '/',
    display: 'standalone',
  };
}
