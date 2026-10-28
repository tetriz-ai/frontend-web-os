// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// A small, hand-written service worker (D-13): the calculator keeps working offline after one
// visit (AC-calc-20). Navigations are network-first, falling back to the cache; hashed
// /_next/static files are cache-first; other same-origin GETs are cached as they're fetched.

const CACHE = 'tip-splitter-v1';
const SHELL = ['/', '/index.html'];

/** Same-origin /_next/static URLs referenced by an HTML page (the chunk names are hashed). */
function assetsIn(html) {
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) urls.add(match[1]);
  return [...urls];
}

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  const page = await cache.match('/');
  if (!page) return;
  const assets = assetsIn(await page.clone().text());
  await Promise.all(assets.map((url) => cache.add(url).catch(() => undefined)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// The page reports the files it loaded before this worker controlled it.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache-urls' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((url) => {
    try {
      return new URL(url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        urls.map((url) =>
          cache.match(url).then((hit) => hit || cache.add(url).catch(() => undefined)),
        ),
      ),
    ),
  );
});

async function fromCache(cache, request) {
  // Next's router data files carry a cache-busting _rsc query; the file is the same without it.
  const ignoreSearch = new URL(request.url).searchParams.has('_rsc');
  const hit = await cache.match(request, { ignoreSearch });
  if (hit || request.mode !== 'navigate') return hit;
  // Only a page load falls back to the app shell; a data fetch gets the network error.
  return (await cache.match(request, { ignoreSearch: true })) || cache.match('/');
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  // Known offline: skip the doomed request (it would log a network error in the page console).
  if (self.navigator.onLine === false) {
    const cached = await fromCache(cache, request);
    if (cached) return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await fromCache(cache, request);
    if (hit) return hit;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// Next's router checks a route with a HEAD request before prefetching it; offline, answer it from
// the cached GET so the check doesn't fail.
async function head(request) {
  const cache = await caches.open(CACHE);
  const cachedHead = async () => {
    const hit = await cache.match(request.url);
    return hit ? new Response(null, { status: hit.status, headers: hit.headers }) : undefined;
  };
  if (self.navigator.onLine === false) {
    const cached = await cachedHead();
    if (cached) return cached;
  }
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await cachedHead();
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'HEAD') {
    event.respondWith(head(request));
    return;
  }
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
