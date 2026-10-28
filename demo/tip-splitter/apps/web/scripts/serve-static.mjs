// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// A small, dependency-free static server for the Next.js export (D-24), used by Playwright because
// `next start` can't serve `output: 'export'`. Usage: node scripts/serve-static.mjs <dir> <port>
// `/` maps to index.html, `/x` to x.html (or x/index.html); anything missing is a 404.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'out');
const port = Number(process.argv[3] ?? 3210);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The file for a URL path, or null. Never resolves outside the root. */
async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const base = normalize(join(root, decoded));
  if (base !== root && !base.startsWith(root + sep)) return null;
  const candidates = decoded.endsWith('/')
    ? [join(base, 'index.html')]
    : [base, `${base}.html`, join(base, 'index.html')];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

async function send(res, status, file, method) {
  const { size } = await stat(file);
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': size,
    'X-Content-Type-Options': 'nosniff',
  });
  if (method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const file = await resolveFile(pathname);
    if (file) {
      await send(res, 200, file, req.method);
      return;
    }
    const notFound = join(root, '404.html');
    if (await isFile(notFound)) await send(res, 404, notFound, req.method);
    else res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  } catch {
    if (!res.headersSent) res.writeHead(500).end();
    else res.destroy();
  }
});

server.listen(port, () => {
  console.log(`Serving ${root} on http://localhost:${port}`);
});
