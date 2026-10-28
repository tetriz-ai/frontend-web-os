// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

'use client';

import { useEffect } from 'react';

// Registers the offline service worker (public/sw.js, D-13) in production builds only. Once a
// worker is ready, it's told which same-origin files this page already loaded, so the ones fetched
// before it took control (scripts, styles, router data) are cached too (AC-calc-20).
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (cancelled) return;
        const urls = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(`${location.origin}/`));
        registration.active?.postMessage({ type: 'cache-urls', urls });
      })
      .catch(() => {
        // Offline support is an enhancement; the app works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
