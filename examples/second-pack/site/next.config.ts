import type { NextConfig } from 'next';

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

const config: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: csp }] }];
  },
};

export default config;
